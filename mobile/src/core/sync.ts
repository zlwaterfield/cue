import { AppState, type AppStateStatus } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import type { ItemStore } from '@shared/itemStore'
import type { Repository } from '@shared/repository'
import { errorMessage, OfflineError, SessionError, SyncEngine, SyncError, type SessionEnd } from '@shared/sync/engine'
import { DELETE_FAILED, SIGN_IN_FAILED, SYNC_OFFLINE } from '@shared/sync/status'
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
  /** Local changes not yet uploaded. Kept current while offline or paused. */
  pending: number
  /** The first download of this account to this phone hasn't finished yet. */
  downloading: boolean
  /** During that download: today ± 7 days have already arrived. */
  recent: boolean
  /** Why sync stopped or failed, in words a person can act on. Never raw server text. */
  message: string | null
}

const ACCOUNT = 'sync_account'
/** The account whose notes are in this database. */
const SYNCED_WITH = 'sync_user'
const CURSOR = 'sync_cursor'
/** The first download of this account to this phone hasn't finished, even across relaunches. */
const JOINING = 'sync_joining'

/** Faster than the Mac's 600 ms / 3 s: a phone is put down mid-thought. */
const TIMING = { debounce: 450, maxWait: 2000 }
/** Ask the auth server about a refused session at most this often. */
const CHECK_EVERY = 30_000
/**
 * On launch and coming back, ask whether the session still stands, at most this often.
 * Pulls succeed for a deleted account (there's just nothing new), so a phone that only
 * reads would otherwise keep saying "Synced just now".
 */
const VERIFY_EVERY = 30 * 60_000
/** When the server ends the session, sign-in shows once typing has paused this long. */
const TYPING_PAUSE = 1000

const ENDED_MESSAGES: Record<SessionEnd, string> = {
  expired: 'Your sync session ended. Sign in again to keep syncing.',
  deleted: 'Your account was deleted on another device.'
}

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
    recent: false,
    message: null
  })
  private readonly client: SupabaseSync | null
  private engine: SyncEngine | null = null
  private account: Account | null = null
  /** The first download hasn't finished: this engine's first sync completes it. */
  private joining = false
  private checkedAt = 0
  private verifiedAt = 0
  private lastEdit = 0
  private signInTimer: ReturnType<typeof setTimeout> | null = null
  private appState = (AppState.currentState ?? 'active') as AppStateStatus

  constructor(
    private readonly repo: Repository,
    private readonly store: ItemStore,
    config: SyncConfig | null
  ) {
    this.client = config ? new SupabaseSync(config, keychainSessionStore()) : null
    // The server ended the session: it expired or was revoked, or the account was deleted.
    // The notes stay until someone signs in, so unsent edits aren't lost.
    this.client?.onSignedOut((reason) => {
      if (!this.account) return
      void this.end({ forget: true })
      this.showSignIn(ENDED_MESSAGES[reason])
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
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (this.account !== account) return
        this.begin(account)
        this.verifySession()
      }, 0)
    )
  }

  /* ------------------------------------------------------------ Triggers */

  /** A local edit was stored. `soon` for anything but typing, which goes without the typing pause. */
  localChange(options?: { soon?: boolean }): void {
    this.lastEdit = Date.now()
    const engine = this.engine
    if (!engine) return
    engine.localChange(options)
    // Nothing goes out while offline or paused, so keep the waiting count current.
    if (engine.status === 'offline' || engine.status === 'error') this.emit()
  }

  /** A line is finished (the keyboard went away, or focus moved on): send it now. */
  flushSoon(): void {
    const engine = this.engine
    if (!engine) return
    void this.store.persistence.settle().then(() => engine.flush().catch(() => {}))
  }

  /** Offline, this fails with "Offline. Changes will sync when you’re back online." */
  async syncNow(): Promise<SyncResult> {
    const engine = this.engine
    if (!engine) return { ok: false, error: 'Not signed in.' }
    try {
      await engine.sync()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof OfflineError ? SYNC_OFFLINE : errorMessage(error) }
    }
  }

  private onAppState(next: AppStateStatus): void {
    const previous = this.appState
    this.appState = next
    if (next === 'active') {
      this.client?.setForeground(true)
      // Hints sent while suspended were missed, and the socket is reconnecting: pull now.
      if (previous !== 'active') {
        void this.engine?.sync().catch(() => {})
        this.verifySession()
      }
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
    return attempt(() => client.sendCode(email.trim()), SIGN_IN_FAILED)
  }

  async verifyCode(email: string, code: string): Promise<SyncResult> {
    const client = this.client
    if (!client) return { ok: false, error: 'This build of Cue has no sync server.' }
    return attempt(async () => {
      this.signedIn(await client.verifyCode(email.trim(), code.replace(/\s+/g, '')))
    }, SIGN_IN_FAILED)
  }

  /**
   * Sign in with Apple: the system sheet, then the sync server checks Apple's identity
   * token. Apple gets only a hash of the nonce, so a token can't be replayed. Cancelled,
   * it resolves with an empty error: there's nothing to explain.
   */
  async signInWithApple(): Promise<SyncResult> {
    const client = this.client
    if (!client) return { ok: false, error: 'This build of Cue has no sync server.' }
    const nonce = Crypto.randomUUID()
    let token: string | null
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce)
      })
      token = credential.identityToken
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'ERR_REQUEST_CANCELED') return { ok: false, error: '' }
      console.warn('Sign in with Apple failed', error)
      // Most often there's no Apple Account on the phone, and its prompt was closed.
      if (code === 'ERR_REQUEST_UNKNOWN') return { ok: false, error: 'Sign in with Apple didn’t finish. Check that this iPhone is signed in to an Apple Account, or use your email.' }
      return { ok: false, error: SIGN_IN_FAILED }
    }
    return attempt(async () => {
      if (!token) throw new SyncError(SIGN_IN_FAILED)
      this.signedIn(await client.signInWithApple(token, nonce))
    }, SIGN_IN_FAILED)
  }

  /** Local changes the server doesn't have yet, including any still being saved. */
  unsent(): number {
    return this.repo.pendingCount() + (this.store.persistence.hasPending() ? 1 : 0)
  }

  /**
   * Signed out by the server with changes it never received. Signing in to a different
   * account, or to one that was deleted, removes them. 0 while signed in.
   */
  unsentFromPreviousAccount(): number {
    return !this.account && this.repo.getMeta(SYNCED_WITH) ? this.repo.pendingCount() : 0
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
    // The engine stops at once, so nothing in flight can write after the notes are gone.
    this.cancelSignIn()
    const ending = this.end({ forget: true })
    this.clearLocal()
    this.emit({ phase: 'signedOut', message: null })
    await ending
    await this.client?.signOut().catch((error) => console.warn('Sign out failed', error))
  }

  async deleteAccount(): Promise<SyncResult> {
    const client = this.client
    if (!client || !this.account) return { ok: false, error: 'Not signed in.' }
    const result = await attempt(() => client.deleteAccount(), DELETE_FAILED)
    if (result.ok) await this.signOut()
    return result
  }

  /* ------------------------------------------------------------ Internals */

  private signedIn(account: Account): void {
    const previous = this.repo.getMeta(SYNCED_WITH)
    if (previous !== account.id) {
      // Notes left by another account (signed out by the server) leave with it.
      if (previous) this.clearLocal()
      this.repo.setMeta(CURSOR, '0')
      this.repo.setMeta(JOINING, '1')
      this.repo.setMeta(SYNCED_WITH, account.id)
    }
    this.begin(account)
  }

  private begin(account: Account): void {
    const client = this.client!
    this.cancelSignIn()
    this.repo.setMeta(ACCOUNT, JSON.stringify(account))
    this.account = account
    // The cursor moves on with every page, so a download cut short by a relaunch is
    // remembered in meta. Today ± 7 days were stored before the cursor first moved.
    const cursor = this.repo.getMeta(CURSOR)
    this.joining = cursor === '0' || this.repo.getMeta(JOINING) === '1'
    const engine = new SyncEngine(
      this.repo,
      client,
      {
        onRemoteChanges: (items) => this.store.applyExternal(items),
        onRecentReady: () => {
          if (this.engine === engine) this.emit({ recent: true })
        },
        onStatus: (_status, error) => {
          if (this.engine !== engine) return
          if (this.joining && engine.lastSyncedAt) {
            this.joining = false
            this.repo.deleteMeta(JOINING)
          }
          this.emit({ message: error && !(error instanceof OfflineError) ? errorMessage(error) : null })
          if (error instanceof SessionError) this.checkSession(client, error.reason)
        }
      },
      TIMING
    )
    this.engine = engine
    client.setForeground(AppState.currentState === 'active')
    void client.listen(account, (seq) => engine.remoteChange(seq), (live) => engine.setLive(live)).catch((error) => {
      console.warn('Sync hints unavailable', error)
      engine.setLive(false)
    })
    engine.start()
    this.emit({ phase: 'signedIn', recent: cursor !== '0', message: null })
  }

  private async end(options: { forget?: boolean } = {}): Promise<void> {
    const engine = this.engine
    this.engine = null
    this.account = null
    if (options.forget) this.repo.deleteMeta(ACCOUNT)
    this.client?.unlisten()
    await engine?.stop()
  }

  /**
   * The server refused the session. Ask the auth server (an expired token gets one
   * refresh), at most every `CHECK_EVERY`; if the session is over, `onSignedOut` follows.
   */
  private checkSession(client: SupabaseSync, reason: SessionEnd): void {
    if (Date.now() - this.checkedAt < CHECK_EVERY) return
    this.checkedAt = Date.now()
    void client.checkSession(reason).catch((error) => console.warn('Couldn’t check the sync session', error))
  }

  /** Ask the auth server whether the session still stands, at most every `VERIFY_EVERY`. */
  private verifySession(): void {
    const client = this.client
    if (!client || !this.engine || Date.now() - this.verifiedAt < VERIFY_EVERY) return
    this.verifiedAt = Date.now()
    void client.checkSession('expired').catch((error) => console.warn('Couldn’t check the sync session', error))
  }

  /**
   * The server ended the session: show sign-in with the reason, but only once typing has
   * paused, so the screen never changes under someone mid-word. Edits made meanwhile are
   * stored and stay until the next sign-in, like any other unsent change.
   */
  private showSignIn(message: string): void {
    this.cancelSignIn()
    const wait = this.lastEdit + TYPING_PAUSE - Date.now()
    if (wait > 0) this.signInTimer = setTimeout(() => this.showSignIn(message), wait)
    else this.emit({ phase: 'signedOut', message })
  }

  private cancelSignIn(): void {
    if (this.signInTimer) clearTimeout(this.signInTimer)
    this.signInTimer = null
  }

  private clearLocal(): void {
    this.store.reset()
    this.repo.clearNotes()
    this.repo.deleteMeta(SYNCED_WITH)
    this.repo.deleteMeta(CURSOR)
    this.repo.deleteMeta(JOINING)
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
      downloading: !!engine && !engine.lastSyncedAt && this.joining,
      ...patch
    })
  }
}

/** Run an account action. Failures come back in words, never as raw server text. */
async function attempt(fn: () => Promise<void>, fallback?: string): Promise<SyncResult> {
  try {
    await fn()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error, fallback) }
  }
}
