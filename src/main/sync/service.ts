import type { Repository } from '../../shared/repository'
import { errorMessage, OfflineError, SessionError, SyncEngine, SyncError, type SessionEnd, type SyncTransport } from '../../shared/sync/engine'
import { DELETE_FAILED, SIGN_IN_FAILED, SYNC_OFFLINE } from '../../shared/sync/status'
import type { Account, SessionStore, SupabaseSync, SyncConfig } from '../../shared/sync/supabase'
import type { Item, SyncResult, SyncState } from '../../shared/types'

/**
 * Sync's lifecycle and the state the UI shows. Sync is off by default. Until someone
 * signs in, this class does nothing: the Supabase client isn't loaded and nothing
 * touches the network. Cue on one Mac works exactly the same either way.
 */

/** The sync server connection, as the service needs it (`SupabaseSync`, or a fake in tests). */
export type SyncClient = Pick<
  SupabaseSync,
  'sendCode' | 'verifyCode' | 'onSignedOut' | 'checkSession' | 'signOut' | 'deleteAccount' | 'listen' | 'unlisten'
> &
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

interface Ended {
  email: string
  reason: SessionEnd
}

const ACCOUNT = 'sync_account'
/** The account this database last synced with; switching accounts re-uploads everything. */
const SYNCED_WITH = 'sync_user'
const CURSOR = 'sync_cursor'
/** The session the server ended, kept so Settings can still offer to sign in again after a restart. */
const ENDED = 'sync_ended'
const SESSION_PREFIX = 'sync_session:'

/** Pull when coming back to the app if the last sync is older than this. */
const STALE_AFTER = 60_000
/** Ask the auth server about a refused session at most this often. */
const CHECK_EVERY = 30_000
/**
 * On launch and coming back, ask whether the session still stands, at most this often.
 * Pulls succeed for a deleted account (there's just nothing new), so a Mac that only
 * reads would otherwise keep saying "Synced just now".
 */
const VERIFY_EVERY = 30 * 60_000

const ENDED_MESSAGES: Record<SessionEnd, string> = {
  expired: 'Your sync session ended. Sign in again to keep syncing.',
  deleted: 'Your account was deleted on another device. Notes on this Mac stay here.'
}

export class SyncService {
  private client: Promise<SyncClient> | null = null
  private engine: SyncEngine | null = null
  private started = false
  private account: Account | null = null
  private message: string | null = null
  private ended: Ended | null
  private checkedAt = 0
  private verifiedAt = 0
  private shownPending = 0

  constructor(
    private readonly repo: Repository,
    private readonly options: SyncServiceOptions
  ) {
    this.ended = this.readEnded()
  }

  /** Resume syncing if this Mac was signed in. Call once the window is interactive. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const stored = this.readAccount()
    if (!stored || !this.options.config) return
    try {
      await this.begin(stored)
      this.verifySession()
    } catch (error) {
      console.error('Sync failed to start', error)
    }
  }

  state(): SyncState {
    const engine = this.engine
    const ended = this.options.config && !this.account ? this.ended : null
    return {
      available: !!this.options.config,
      email: this.account?.email ?? null,
      status: engine ? engine.status : 'off',
      lastSyncedAt: engine?.lastSyncedAt ?? null,
      pending: this.account ? this.repo.pendingCount() : 0,
      message: ended ? ENDED_MESSAGES[ended.reason] : this.message,
      needsSignIn: !!ended,
      // A deleted account can't be signed back in to; turning sync on starts afresh.
      previousEmail: ended?.reason === 'expired' ? ended.email : null
    }
  }

  /** Signed in, so saves go to the server too. */
  isOn(): boolean {
    return !!this.engine
  }

  /* ----------------------------------------------------------- Triggers */

  /** A local edit was saved. `soon` for anything but typing, which goes without the typing pause. */
  localChange(options?: { soon?: boolean }): void {
    const engine = this.engine
    if (!engine) return
    engine.localChange(options)
    // Nothing goes out while offline or paused, so keep the waiting count current.
    if ((engine.status === 'offline' || engine.status === 'error') && this.repo.pendingCount() !== this.shownPending) this.emit()
  }

  /** The app came back to the foreground or the Mac woke up. */
  resume(): void {
    const engine = this.engine
    if (!engine) return
    const stale = !engine.lastSyncedAt || Date.now() - engine.lastSyncedAt > STALE_AFTER
    if (stale || engine.status === 'offline' || engine.status === 'error') void engine.sync().catch(() => {})
    if (stale) this.verifySession()
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
    const engine = this.engine
    if (!engine) return { ok: false, error: 'Sync is off.' }
    try {
      await engine.sync()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof OfflineError ? SYNC_OFFLINE : errorMessage(error) }
    }
  }

  /* ------------------------------------------------------------- Account */

  async sendCode(email: string): Promise<SyncResult> {
    return attempt(async () => {
      const client = await this.connect()
      await client.sendCode(email.trim())
    }, SIGN_IN_FAILED)
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
    }, SIGN_IN_FAILED)
  }

  /** Stop syncing on this Mac. Local notes are untouched and keep working. */
  async signOut(): Promise<void> {
    // Settings shows Off at once; a request still in flight finishes (or times out) after.
    const ending = this.end({ forget: true })
    this.message = null
    this.setEnded(null)
    this.emit()
    await ending
    await (await this.loaded())?.signOut().catch((error) => console.error('Sign out failed', error))
  }

  async deleteAccount(): Promise<SyncResult> {
    const client = await this.loaded()
    if (!client || !this.account) return { ok: false, error: 'Sync is off.' }
    const result = await attempt(() => client.deleteAccount(), DELETE_FAILED)
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
    this.setEnded(null)
    const engine = new SyncEngine(this.repo, client, {
      onRemoteChanges: (items) => this.options.onRemoteChanges(items),
      onStatus: (_status, error) => {
        if (this.engine !== engine) return
        this.message = error && !(error instanceof OfflineError) ? errorMessage(error) : null
        this.emit()
        if (error instanceof SessionError) this.checkSession(client, error.reason)
      }
    })
    this.engine = engine
    void client.listen(account, (seq) => engine.remoteChange(seq), (live) => engine.setLive(live)).catch((error) => {
      console.error('Sync hints unavailable', error)
      engine.setLive(false)
    })
    engine.start()
    this.emit()
  }

  /** Stop syncing. With `forget`, this Mac no longer counts as signed in. */
  private async end(options: { forget?: boolean } = {}): Promise<void> {
    const engine = this.engine
    this.engine = null
    this.account = null
    if (options.forget) this.repo.deleteMeta(ACCOUNT)
    // Stop first: from here on, a request still in flight can't write anything.
    const stopping = engine?.stop()
    ;(await this.loaded())?.unlisten()
    await stopping
  }

  /**
   * The server refused the session. Ask the auth server, at most every `CHECK_EVERY`;
   * if the session is over, the client signs out and `onSignedOut` ends sync.
   */
  private checkSession(client: SyncClient, reason: SessionEnd): void {
    if (Date.now() - this.checkedAt < CHECK_EVERY) return
    this.checkedAt = Date.now()
    void client.checkSession(reason).catch((error) => console.error('Couldn’t check the sync session', error))
  }

  /** Ask the auth server whether the session still stands, at most every `VERIFY_EVERY`. */
  private verifySession(): void {
    if (!this.engine || Date.now() - this.verifiedAt < VERIFY_EVERY) return
    this.verifiedAt = Date.now()
    void this.loaded()
      .then((client) => client?.checkSession('expired'))
      .catch((error) => console.error('Couldn’t check the sync session', error))
  }

  /** Load the Supabase client on first use (once, however many calls race to it). */
  private connect(): Promise<SyncClient> {
    const config = this.options.config
    if (!config) return Promise.reject(new SyncError('Sync isn’t available in this build.'))
    const connect = this.options.connect ?? (async (c, s) => new (await import('../../shared/sync/supabase')).SupabaseSync(c, s))
    if (!this.client) {
      this.client = connect(config, this.sessionStore()).then((client) => {
        // The server ended the session: it expired or was revoked, or the account was
        // deleted elsewhere. Sync stops, every note stays, and Settings offers to sign in again.
        client.onSignedOut((reason) => {
          const account = this.account
          if (!account) return
          this.setEnded({ email: account.email, reason })
          void this.end({ forget: true })
          this.emit()
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

  private readEnded(): Ended | null {
    try {
      const value = JSON.parse(this.repo.getMeta(ENDED) ?? 'null') as Ended | null
      return value && typeof value.email === 'string' && (value.reason === 'expired' || value.reason === 'deleted') ? value : null
    } catch {
      return null
    }
  }

  private setEnded(ended: Ended | null): void {
    if (!ended && !this.ended) return
    this.ended = ended
    if (ended) this.repo.setMeta(ENDED, JSON.stringify(ended))
    else this.repo.deleteMeta(ENDED)
  }

  private emit(): void {
    const state = this.state()
    this.shownPending = state.pending
    this.options.onState(state)
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
