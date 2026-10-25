import { AppState, type AppStateStatus } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import type { ItemStore } from '@shared/itemStore'
import type { Repository } from '@shared/repository'
import { errorMessage, OfflineError, SessionError, SyncEngine, SyncError, type SessionEnd } from '@shared/sync/engine'
import { DELETE_FAILED, SIGN_IN_FAILED, SYNC_OFFLINE } from '@shared/sync/status'
import { SupabaseSync, type Account, type SessionStore, type SyncConfig } from '@shared/sync/supabase'
import type { SignInMethod, SyncResult, SyncState } from '@shared/types'
import { backgroundTask } from '../../modules/cue-native'
import { Store } from './store'

/**
 * Sync on iPhone, as on the Mac: off by default, and Cue works the same either way. Until
 * someone turns it on, the Supabase client isn't created and nothing touches the network.
 * Turning it on uploads the notes already on this phone to the account; turning it off
 * stops syncing, and every note stays here.
 *
 * The protocol, merge rules, outbox and engine are the Mac's own (`shared/sync`). What's
 * different is the lifecycle: iOS suspends apps soon after they leave the screen, so edits
 * are pushed the moment a line is done or the app goes to the background, and everything
 * is pulled again the moment it comes back.
 */

/** The Mac's `SyncState`, plus the first download onto this phone. */
export interface SyncStatus extends SyncState {
  /** The first download of this account to this phone hasn't finished yet. */
  downloading: boolean
  /** During that download: today ± 7 days have already arrived. */
  recent: boolean
}

interface Ended {
  email: string
  reason: SessionEnd
  method?: SignInMethod
}

const ACCOUNT = 'sync_account'
/** The account this database last synced with; switching accounts re-uploads everything. */
const SYNCED_WITH = 'sync_user'
const CURSOR = 'sync_cursor'
/** The first download of this account to this phone hasn't finished, even across relaunches. */
const JOINING = 'sync_joining'
/** The session the server ended, kept so Settings can still offer to sign in again after a relaunch. */
const ENDED = 'sync_ended'

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

const ENDED_MESSAGES: Record<SessionEnd, string> = {
  expired: 'Your sync session ended. Sign in again to keep syncing.',
  deleted: 'Your account was deleted on another device. Notes on this iPhone stay here.'
}

const NO_SERVER = 'Sync isn’t available in this build.'

/** Where supabase-js keeps the session (`storageKey`) and a pending PKCE verifier. */
const SESSION_KEYS = ['session', 'session-code-verifier']

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
    available: false,
    email: null,
    status: 'off',
    lastSyncedAt: null,
    pending: 0,
    message: null,
    needsSignIn: false,
    previousEmail: null,
    previousMethod: null,
    downloading: false,
    recent: false
  })
  private client: SupabaseSync | null = null
  private engine: SyncEngine | null = null
  private account: Account | null = null
  private message: string | null = null
  private ended: Ended | null
  /** The first download hasn't finished: this engine's first sync completes it. */
  private joining = false
  private recent = false
  private checkedAt = 0
  private verifiedAt = 0
  /** Sign-ins that can make a session (a code, or Apple), numbered as they start. */
  private signInsStarted = 0
  /** Every sign-in numbered up to this was cancelled (`cancelSignIn`): its late answer is ignored. */
  private cancelledThrough = 0
  /** A cancelled sign-in forgetting its session. The next sign-in waits for it, so it can't forget that one's. */
  private forgetting: Promise<void> = Promise.resolve()
  private appState = (AppState.currentState ?? 'active') as AppStateStatus

  constructor(
    private readonly repo: Repository,
    private readonly store: ItemStore,
    private readonly config: SyncConfig | null
  ) {
    this.ended = this.readEnded()
  }

  /** Resume syncing if this phone was signed in. */
  start(): void {
    AppState.addEventListener('change', (next) => this.onAppState(next))
    const account = this.config ? this.readAccount() : null
    if (!account) {
      // Signed out, or a fresh install: the Keychain can outlive the app, so forget any
      // session left there without loading the client.
      const store = keychainSessionStore()
      for (const key of SESSION_KEYS) store.remove(key)
      this.emit()
      return
    }
    // The notes are already on the phone; start talking to the server once the first
    // screen is up.
    this.account = account
    this.emit()
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
    if (!engine) return { ok: false, error: 'Sync is off.' }
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
    return attempt(() => this.connect().sendCode(email.trim()), SIGN_IN_FAILED)
  }

  async verifyCode(email: string, code: string): Promise<SyncResult> {
    const current = ++this.signInsStarted
    return attempt(async () => {
      await this.forgetting
      await this.finishSignIn(current, await this.connect().verifyCode(email.trim(), code.replace(/\s+/g, '')))
    }, SIGN_IN_FAILED)
  }

  /**
   * Sign in with Apple: the system sheet, then the sync server checks Apple's identity
   * token. Apple gets only a hash of the nonce, so a token can't be replayed. Cancelled,
   * it resolves with an empty error: there's nothing to explain.
   */
  async signInWithApple(): Promise<SyncResult> {
    if (!this.config) return { ok: false, error: NO_SERVER }
    const current = ++this.signInsStarted
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
      await this.forgetting
      await this.finishSignIn(current, await this.connect().signInWithApple(token, nonce))
    }, SIGN_IN_FAILED)
  }

  /** Sign-in was closed: an answer still on its way mustn't turn sync on. */
  cancelSignIn(): void {
    this.cancelledThrough = this.signInsStarted
  }

  /** Stop syncing on this phone. Every note stays here and keeps working. */
  async signOut(): Promise<void> {
    // Settings shows Off at once; a request still in flight finishes (or times out) after.
    const ending = this.end({ forget: true })
    this.message = null
    this.setEnded(null)
    this.emit()
    await ending
    await this.client?.signOut().catch((error) => console.warn('Sign out failed', error))
  }

  async deleteAccount(): Promise<SyncResult> {
    const client = this.client
    if (!client || !this.account) return { ok: false, error: 'Sync is off.' }
    const result = await attempt(() => client.deleteAccount(), DELETE_FAILED)
    if (!result.ok) return result
    this.repo.deleteMeta(SYNCED_WITH)
    this.repo.deleteMeta(CURSOR)
    this.repo.deleteMeta(JOINING)
    await this.signOut()
    return result
  }

  /* ------------------------------------------------------------ Internals */

  /** Turn sync on with the account the server just signed in, unless sign-in was cancelled meanwhile. */
  private async finishSignIn(current: number, account: Account): Promise<void> {
    if (current <= this.cancelledThrough) {
      // Forget the session the server just made; nothing was queued or uploaded. Unless a
      // newer sign-in has started since, or finished: the client's session is that one's now.
      if (current === this.signInsStarted && !this.account) {
        const client = this.client
        this.forgetting = (async () => {
          await client?.signOut().catch((error) => console.warn('Sign out failed', error))
        })()
        await this.forgetting
      }
      throw new SignInCancelled()
    }
    this.signedIn(account)
  }

  private signedIn(account: Account): void {
    if (this.repo.getMeta(SYNCED_WITH) !== account.id) {
      // First sync for this database with this account: upload everything it has.
      this.repo.queueAll()
      this.repo.setMeta(CURSOR, '0')
      this.repo.setMeta(JOINING, '1')
      this.repo.setMeta(SYNCED_WITH, account.id)
    }
    this.message = null
    this.begin(account)
  }

  private begin(account: Account): void {
    const client = this.connect()
    this.repo.setMeta(ACCOUNT, JSON.stringify(account))
    this.account = account
    this.setEnded(null)
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
          if (this.engine !== engine) return
          this.recent = true
          this.emit()
        },
        onStatus: (_status, error) => {
          if (this.engine !== engine) return
          if (this.joining && engine.lastSyncedAt) {
            this.joining = false
            this.repo.deleteMeta(JOINING)
          }
          this.message = error && !(error instanceof OfflineError) ? errorMessage(error) : null
          this.emit()
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
    this.recent = cursor !== '0'
    engine.start()
    this.emit()
  }

  /** Stop syncing. With `forget`, this phone no longer counts as signed in. */
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

  /** Create the Supabase client on first use. */
  private connect(): SupabaseSync {
    if (this.client) return this.client
    if (!this.config) throw new SyncError(NO_SERVER)
    const client = new SupabaseSync(this.config, keychainSessionStore())
    // The server ended the session: it expired or was revoked, or the account was deleted
    // elsewhere. Sync stops, every note stays, and Settings offers to sign in again.
    client.onSignedOut((reason) => {
      const account = this.account
      if (!account) return
      this.setEnded({ email: account.email, reason, method: account.method })
      void this.end({ forget: true })
      this.emit()
    })
    this.client = client
    return client
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
    const engine = this.engine
    const ended = this.config && !this.account ? this.ended : null
    this.state.set({
      available: !!this.config,
      email: this.account?.email ?? null,
      // Signed in, the engine starts once the first screen is up.
      status: engine ? engine.status : this.account ? 'idle' : 'off',
      lastSyncedAt: engine?.lastSyncedAt ?? null,
      pending: this.account ? this.repo.pendingCount() : 0,
      message: ended ? ENDED_MESSAGES[ended.reason] : this.message,
      needsSignIn: !!ended,
      // A deleted account can't be signed back in to; turning sync on starts afresh.
      previousEmail: ended?.reason === 'expired' ? ended.email : null,
      previousMethod: ended?.reason === 'expired' ? (ended.method ?? 'email') : null,
      downloading: !!engine && !engine.lastSyncedAt && this.joining,
      recent: this.recent
    })
  }
}

/** Sign-in was closed before the server answered. */
class SignInCancelled extends Error {}

/** Run an account action. Failures come back in words, never as raw server text; a cancelled sign-in, with none. */
async function attempt(fn: () => Promise<void>, fallback?: string): Promise<SyncResult> {
  try {
    await fn()
    return { ok: true }
  } catch (error) {
    if (error instanceof SignInCancelled) return { ok: false, error: '' }
    return { ok: false, error: errorMessage(error, fallback) }
  }
}
