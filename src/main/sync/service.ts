import type { Item, SyncResult, SyncState } from '../../shared/types'
import type { Repository } from '../repository'
import { OfflineError, SyncEngine, type SyncTransport } from './engine'
import type { Account, SessionStore, SupabaseSync, SyncConfig } from './supabase'

/**
 * Sync's lifecycle and the state the UI shows. Sync is off by default. Until someone
 * signs in, this class does nothing: the Supabase client isn't loaded and nothing
 * touches the network. Cue on one Mac works exactly the same either way.
 */

/** The sync server connection, as the service needs it (`SupabaseSync`, or a fake in tests). */
export type SyncClient = Pick<SupabaseSync, 'sendCode' | 'verifyCode' | 'onSignedOut' | 'signOut' | 'deleteAccount' | 'listen' | 'unlisten'> &
  SyncTransport

export interface SyncServiceOptions {
  config: SyncConfig | null
  /** Encrypts the stored session (the macOS Keychain via `safeStorage`). */
  cipher?: { encrypt(text: string): string; decrypt(text: string): string }
  onState: (state: SyncState) => void
  onRemoteChanges: (items: Item[]) => void
  /** Overridable for tests. */
  connect?: (config: SyncConfig, store: SessionStore) => Promise<SyncClient>
}

const ACCOUNT = 'sync_account'
/** The account this database last synced with; switching accounts re-uploads everything. */
const SYNCED_WITH = 'sync_user'
const CURSOR = 'sync_cursor'
const SESSION_PREFIX = 'sync_session:'

/** Pull when coming back to the app if the last sync is older than this. */
const STALE_AFTER = 60_000

export class SyncService {
  private client: Promise<SyncClient> | null = null
  private engine: SyncEngine | null = null
  private started = false
  private account: Account | null = null
  private message: string | null = null

  constructor(
    private readonly repo: Repository,
    private readonly options: SyncServiceOptions
  ) {}

  /** Resume syncing if this Mac was signed in. Call once the window is interactive. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const stored = this.readAccount()
    if (!stored || !this.options.config) return
    try {
      await this.begin(stored)
    } catch (error) {
      console.error('Sync failed to start', error)
    }
  }

  state(): SyncState {
    const engine = this.engine
    return {
      available: !!this.options.config,
      email: this.account?.email ?? null,
      status: engine ? engine.status : 'off',
      lastSyncedAt: engine?.lastSyncedAt ?? null,
      pending: this.account ? this.repo.pendingCount() : 0,
      message: this.message
    }
  }

  /* ----------------------------------------------------------- Triggers */

  /** A local edit was saved. */
  localChange(): void {
    this.engine?.localChange()
  }

  /** The app came back to the foreground or the Mac woke up. */
  resume(): void {
    const engine = this.engine
    if (!engine) return
    const stale = !engine.lastSyncedAt || Date.now() - engine.lastSyncedAt > STALE_AFTER
    if (stale || engine.status === 'offline' || engine.status === 'error') void engine.sync().catch(() => {})
  }

  /** Signed in, online as far as we know, and holding changes the server doesn't have. */
  hasUnsentChanges(): boolean {
    return !!this.engine && this.engine.status !== 'offline' && this.repo.pendingCount() > 0
  }

  /** Push what's pending, waiting at most `timeout` ms. Used when quitting. */
  async flush(timeout: number): Promise<void> {
    if (!this.engine) return
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      this.engine.flush().catch(() => {}),
      new Promise((resolve) => (timer = setTimeout(resolve, timeout)))
    ])
    clearTimeout(timer)
  }

  async syncNow(): Promise<SyncResult> {
    if (!this.engine) return { ok: false, error: 'Sync is off.' }
    return attempt(() => this.engine!.sync())
  }

  /* ------------------------------------------------------------- Account */

  async sendCode(email: string): Promise<SyncResult> {
    return attempt(async () => {
      const client = await this.connect()
      await client.sendCode(email.trim())
    })
  }

  async verifyCode(email: string, code: string): Promise<SyncResult> {
    return attempt(async () => {
      const client = await this.connect()
      const account = await client.verifyCode(email.trim(), code.replace(/\s+/g, ''))
      if (this.repo.getMeta(SYNCED_WITH) !== account.id) {
        // First sync for this database with this account: upload everything it has.
        this.repo.queueAll()
        this.repo.setMeta(CURSOR, '0')
        this.repo.setMeta(SYNCED_WITH, account.id)
      }
      this.message = null
      await this.begin(account)
    })
  }

  /** Stop syncing on this Mac. Local notes are untouched and keep working. */
  async signOut(): Promise<void> {
    await this.end({ forget: true })
    this.message = null
    this.emit()
    await (await this.loaded())?.signOut().catch((error) => console.error('Sign out failed', error))
  }

  async deleteAccount(): Promise<SyncResult> {
    const client = await this.loaded()
    if (!client || !this.account) return { ok: false, error: 'Sync is off.' }
    const result = await attempt(() => client.deleteAccount())
    if (!result.ok) return result
    this.repo.deleteMeta(SYNCED_WITH)
    this.repo.deleteMeta(CURSOR)
    await this.signOut()
    return result
  }

  /* ------------------------------------------------------------ Internals */

  private async begin(account: Account): Promise<void> {
    await this.end()
    const client = await this.connect()
    this.repo.setMeta(ACCOUNT, JSON.stringify(account))
    this.account = account
    const engine = new SyncEngine(this.repo, client, {
      onRemoteChanges: (items) => this.options.onRemoteChanges(items),
      onStatus: (_status, error) => {
        if (this.engine !== engine) return
        this.message = error && !(error instanceof OfflineError) ? error.message : null
        this.emit()
      }
    })
    this.engine = engine
    void client.listen(account, (seq) => engine.remoteChange(seq)).catch((error) => console.error('Sync hints unavailable', error))
    engine.start()
    this.emit()
  }

  /** Stop syncing. With `forget`, this Mac no longer counts as signed in. */
  private async end(options: { forget?: boolean } = {}): Promise<void> {
    const engine = this.engine
    this.engine = null
    this.account = null
    if (options.forget) this.repo.deleteMeta(ACCOUNT)
    ;(await this.loaded())?.unlisten()
    await engine?.stop()
  }

  /** Load the Supabase client on first use (once, however many calls race to it). */
  private connect(): Promise<SyncClient> {
    const config = this.options.config
    if (!config) return Promise.reject(new Error('Sync isn’t available in this build.'))
    const connect = this.options.connect ?? (async (c, s) => new (await import('./supabase')).SupabaseSync(c, s))
    if (!this.client) {
      this.client = connect(config, this.sessionStore()).then((client) => {
        // The server ended the session (signed out everywhere, or account deleted elsewhere).
        client.onSignedOut(() => {
          if (!this.account) return
          this.message = 'You were signed out. Sign in again to keep syncing.'
          void this.end({ forget: true }).then(() => this.emit())
        })
        return client
      })
      this.client.catch(() => (this.client = null))
    }
    return this.client
  }

  /** The client, if it has been loaded. */
  private async loaded(): Promise<SyncClient | null> {
    return (await this.client?.catch(() => null)) ?? null
  }

  private sessionStore(): SessionStore {
    const cipher = this.options.cipher
    return {
      get: (key) => {
        const value = this.repo.getMeta(SESSION_PREFIX + key)
        if (value === null || !cipher) return value
        try {
          return cipher.decrypt(value)
        } catch {
          return null
        }
      },
      set: (key, value) => this.repo.setMeta(SESSION_PREFIX + key, cipher ? cipher.encrypt(value) : value),
      remove: (key) => this.repo.deleteMeta(SESSION_PREFIX + key)
    }
  }

  private readAccount(): Account | null {
    try {
      const value = JSON.parse(this.repo.getMeta(ACCOUNT) ?? 'null') as Account | null
      return value && typeof value.id === 'string' && typeof value.email === 'string' ? value : null
    } catch {
      return null
    }
  }

  private emit(): void {
    this.options.onState(this.state())
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
