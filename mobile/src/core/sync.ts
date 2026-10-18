import { AppState, type AppStateStatus } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type { ItemStore } from '@shared/itemStore'
import type { Repository } from '@shared/repository'
import { OfflineError, SyncEngine } from '@shared/sync/engine'
import { SupabaseSync, type Account, type SessionStore, type SyncConfig } from '@shared/sync/supabase'
import type { SyncResult } from '@shared/types'
import { backgroundTask } from '../../modules/cue-native'
import { Store } from './store'

/**
 * Sync on iPhone. Unlike the Mac, where sync is optional, the phone works only signed in:
 * the notes here are a local copy of the account, the database is how it stays fast and
 * works offline, and signing out removes them from the phone.
 *
 * The protocol, merge rules, outbox and engine are the Mac's own (`shared/sync`). What's
 * different is the lifecycle: iOS suspends apps soon after they leave the screen, so edits
 * are pushed the moment a line is done or the app goes to the background, and everything
 * is pulled again the moment it comes back.
 */

export type SyncPhase = 'starting' | 'signedOut' | 'signedIn'

export interface SyncStatus {
  phase: SyncPhase
  email: string | null
  status: 'idle' | 'syncing' | 'offline' | 'error'
  lastSyncedAt: number | null
  /** Local changes not yet uploaded. */
  pending: number
  /** The first download of this account to this phone hasn't finished yet. */
  downloading: boolean
  /** Why sync stopped or failed, in words a person can act on. */
  message: string | null
}

const ACCOUNT = 'sync_account'
/** The account whose notes are in this database. */
const SYNCED_WITH = 'sync_user'
const CURSOR = 'sync_cursor'

/** Faster than the Mac's 600 ms / 3 s: a phone is put down mid-thought. */
const TIMING = { debounce: 450, maxWait: 2000 }

/** The Supabase session lives in the Keychain, readable only on this device. */
function keychainSessionStore(): SessionStore {
  const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }
  const removed = new Set<string>()
  const name = (key: string): string => `cue.${key.replace(/[^\w.-]/g, '_')}`
  return {
    get: (key) => (removed.has(key) ? null : SecureStore.getItem(name(key), options)),
    set: (key, value) => {
      removed.delete(key)
      SecureStore.setItem(name(key), value, options)
    },
    remove: (key) => {
      removed.add(key)
      void SecureStore.deleteItemAsync(name(key), options)
    }
  }
}

export class MobileSync {
  readonly state = new Store<SyncStatus>({
    phase: 'starting',
    email: null,
    status: 'idle',
    lastSyncedAt: null,
    pending: 0,
    downloading: false,
    message: null
  })
  private readonly client: SupabaseSync | null
  private engine: SyncEngine | null = null
  private account: Account | null = null
  private appState = (AppState.currentState ?? 'active') as AppStateStatus

  constructor(
    private readonly repo: Repository,
    private readonly store: ItemStore,
    config: SyncConfig | null
  ) {
    this.client = config ? new SupabaseSync(config, keychainSessionStore()) : null
    // The server ended the session: signed out everywhere, or the account was deleted.
    this.client?.onSignedOut(() => {
      if (!this.account) return
      void this.end({ forget: true }).then(() =>
        this.emit({ phase: 'signedOut', message: 'You were signed out. Sign in again to keep syncing.' })
      )
    })
  }

  get available(): boolean {
    return !!this.client
  }

  /** Resume the account this phone was signed in to, if any. */
  start(): void {
    AppState.addEventListener('change', (next) => this.onAppState(next))
    const account = this.readAccount()
    if (!this.client) {
      this.emit({ phase: 'signedOut', message: 'This build of Cue has no sync server.' })
      return
    }
    if (!account) {
      // A fresh install: the Keychain can outlive the app, so forget any old session.
      void this.client.signOut().catch(() => {})
      this.emit({ phase: 'signedOut' })
      return
    }
    // Show the notes already on the phone right away; start talking to the server once
    // the first screen is up.
    this.account = account
    this.emit({ phase: 'signedIn' })
    requestAnimationFrame(() => setTimeout(() => this.account === account && this.begin(account), 0))
  }

  /* ------------------------------------------------------------ Triggers */

  /** A local edit was stored. */
  localChange(): void {
    this.engine?.localChange()
  }

  /** A line is finished (the keyboard went away, or focus moved on): send it now. */
  flushSoon(): void {
    const engine = this.engine
    if (!engine) return
    void this.store.persistence.settle().then(() => engine.flush().catch(() => {}))
  }

  syncNow(): Promise<SyncResult> {
    const engine = this.engine
    if (!engine) return Promise.resolve({ ok: false, error: 'Not signed in.' })
    return attempt(() => engine.sync())
  }

  private onAppState(next: AppStateStatus): void {
    const previous = this.appState
    this.appState = next
    if (next === 'active') {
      this.client?.setForeground(true)
      // Hints sent while suspended were missed, and the socket is reconnecting: pull now.
      if (previous !== 'active') void this.engine?.sync().catch(() => {})
      return
    }
    if (previous === 'active') void this.pushBeforeSuspend()
    if (next === 'background') this.client?.setForeground(false)
  }

  /** Store and upload the last edits while iOS still gives us time. */
  private async pushBeforeSuspend(): Promise<void> {
    const release = await backgroundTask()
    try {
      await this.store.persistence.settle()
      const engine = this.engine
      if (engine && this.repo.pendingCount() > 0) {
        await Promise.race([engine.flush().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 20_000))])
      }
    } finally {
      release()
    }
  }

  /* ------------------------------------------------------------- Account */

  async sendCode(email: string): Promise<SyncResult> {
    const client = this.client
    if (!client) return { ok: false, error: 'This build of Cue has no sync server.' }
    return attempt(() => client.sendCode(email.trim()))
  }

  async verifyCode(email: string, code: string): Promise<SyncResult> {
    const client = this.client
    if (!client) return { ok: false, error: 'This build of Cue has no sync server.' }
    return attempt(async () => {
      const account = await client.verifyCode(email.trim(), code.replace(/\s+/g, ''))
      const previous = this.repo.getMeta(SYNCED_WITH)
      if (previous !== account.id) {
        // Notes left by another account (signed out by the server) leave with it.
        if (previous) this.clearLocal()
        this.repo.setMeta(CURSOR, '0')
        this.repo.setMeta(SYNCED_WITH, account.id)
      }
      this.begin(account)
    })
  }

  /** Local changes the server doesn't have yet, including any still being saved. */
  unsent(): number {
    return this.repo.pendingCount() + (this.store.persistence.hasPending() ? 1 : 0)
  }

  /** Try to upload everything before signing out. Resolves with what's still unsent. */
  async drain(timeout = 8000): Promise<number> {
    await this.store.persistence.settle()
    const engine = this.engine
    if (engine && this.repo.pendingCount() > 0) {
      await Promise.race([engine.flush().catch(() => {}), new Promise((resolve) => setTimeout(resolve, timeout))])
    }
    return this.unsent()
  }

  /** Sign out of this phone. Its copy of the notes is removed; the account keeps them. */
  async signOut(): Promise<void> {
    await this.end({ forget: true })
    this.clearLocal()
    this.emit({ phase: 'signedOut', message: null })
    await this.client?.signOut().catch((error) => console.warn('Sign out failed', error))
  }

  async deleteAccount(): Promise<SyncResult> {
    const client = this.client
    if (!client || !this.account) return { ok: false, error: 'Not signed in.' }
    const result = await attempt(() => client.deleteAccount())
    if (result.ok) await this.signOut()
    return result
  }

  /* ------------------------------------------------------------ Internals */

  private begin(account: Account): void {
    const client = this.client!
    this.repo.setMeta(ACCOUNT, JSON.stringify(account))
    this.account = account
    const engine = new SyncEngine(
      this.repo,
      client,
      {
        onRemoteChanges: (items) => this.store.applyExternal(items),
        onStatus: (_status, error) => {
          if (this.engine !== engine) return
          this.emit({ message: error && !(error instanceof OfflineError) ? error.message : null })
        }
      },
      TIMING
    )
    this.engine = engine
    client.setForeground(AppState.currentState === 'active')
    void client.listen(account, (seq) => engine.remoteChange(seq)).catch((error) => console.warn('Sync hints unavailable', error))
    engine.start()
    this.emit({ phase: 'signedIn', message: null })
  }

  private async end(options: { forget?: boolean } = {}): Promise<void> {
    const engine = this.engine
    this.engine = null
    this.account = null
    if (options.forget) this.repo.deleteMeta(ACCOUNT)
    this.client?.unlisten()
    await engine?.stop()
  }

  private clearLocal(): void {
    this.store.reset()
    this.repo.clearNotes()
    this.repo.deleteMeta(SYNCED_WITH)
    this.repo.deleteMeta(CURSOR)
  }

  private readAccount(): Account | null {
    try {
      const value = JSON.parse(this.repo.getMeta(ACCOUNT) ?? 'null') as Account | null
      return value && typeof value.id === 'string' && typeof value.email === 'string' ? value : null
    } catch {
      return null
    }
  }

  private emit(patch: Partial<SyncStatus> = {}): void {
    const engine = this.engine
    this.state.set({
      email: this.account?.email ?? null,
      status: engine ? engine.status : 'idle',
      lastSyncedAt: engine?.lastSyncedAt ?? null,
      pending: this.account ? this.repo.pendingCount() : 0,
      downloading: !!engine && !engine.lastSyncedAt && this.repo.getMeta(CURSOR) === '0',
      ...patch
    })
  }
}

async function attempt(fn: () => Promise<void>): Promise<SyncResult> {
  try {
    await fn()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
