import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ISODate, Item } from '../types'
import { OfflineError, SessionError, SyncError, type PullResult, type PushResult, type SessionEnd, type SyncTransport } from './engine'
import { DELETE_FAILED, SIGN_IN_FAILED, SYNC_PAUSED } from './status'

/**
 * Everything that talks to Supabase: email sign-in, the push/pull transport, and
 * realtime hints. The Mac app loads this module only once someone turns sync on, so a
 * signed-out Cue for Mac never loads it or touches the network.
 */

export interface SyncConfig {
  url: string
  key: string
  /** HTTP client; the Mac app passes Electron's `net.fetch` (Chromium's network stack). */
  fetch?: typeof fetch
}

/**
 * Where the auth session lives: SQLite meta encrypted with the Keychain on the Mac,
 * the Keychain itself on iPhone.
 */
export interface SessionStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export interface Account {
  id: string
  email: string
}

/** No request waits forever. Sign-in gets 10 s; a sync batch (500 rows, about 150 KB) gets 20 s. */
export const AUTH_TIMEOUT = 10_000
export const REQUEST_TIMEOUT = 20_000

/**
 * Give every request a deadline, covering the whole response, body included, so a
 * connection that stalls halfway can't hang sync. A timed-out request fails like a lost
 * connection: postgrest-js reports it as status 0, auth-js as a retryable fetch error.
 */
export function withTimeout(fetcher: typeof fetch): typeof fetch {
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const controller = new AbortController()
    // Settles only on abort. Racing it means even a fetch that ignores its signal gives up.
    let fail: (reason: unknown) => void = () => {}
    const aborted = new Promise<never>((_, reject) => (fail = reject))
    aborted.catch(() => {})
    const abort = (reason: unknown): void => {
      fail(reason)
      controller.abort(reason)
    }
    const caller = init.signal
    if (caller?.aborted) abort(caller.reason)
    else caller?.addEventListener('abort', () => abort(caller.reason), { once: true })
    const timer = setTimeout(() => abort(timeoutError()), url.includes('/auth/v1/') ? AUTH_TIMEOUT : REQUEST_TIMEOUT)
    try {
      const response = await Promise.race([fetcher(input, { ...init, signal: controller.signal }), aborted])
      const body = [101, 204, 205, 304].includes(response.status) ? null : await Promise.race([response.text(), aborted])
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } finally {
      clearTimeout(timer)
    }
  }
}

function timeoutError(): Error {
  const error = new Error('The request timed out.')
  error.name = 'AbortError'
  return error
}

export class SupabaseSync implements SyncTransport {
  private readonly client: SupabaseClient
  private listening = 0
  /** Why the session is ending, while `checkSession` decides. */
  private ending: SessionEnd | null = null

  constructor(config: SyncConfig, store: SessionStore) {
    this.client = createClient(config.url, config.key, {
      global: { fetch: withTimeout(config.fetch ?? ((input, init) => fetch(input, init))) },
      auth: {
        storage: {
          getItem: (key) => store.get(key),
          setItem: (key, value) => store.set(key, value),
          removeItem: (key) => store.remove(key)
        },
        storageKey: 'session',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    })
  }

  /* ------------------------------------------------------------------ Auth */

  /** Email a six-digit code. New addresses get an account automatically. */
  async sendCode(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
    if (error) throw friendlyAuthError(error)
  }

  async verifyCode(email: string, code: string): Promise<Account> {
    const { data, error } = await this.client.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) throw friendlyAuthError(error)
    if (!data.user) throw new SyncError('Sign-in didn’t complete. Try again.')
    return { id: data.user.id, email: data.user.email ?? email }
  }

  /**
   * Called if the server ends the session: it expired or was revoked (signed out
   * everywhere), or the account was deleted elsewhere.
   */
  onSignedOut(callback: (reason: SessionEnd) => void): void {
    this.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') callback(this.ending ?? 'expired')
    })
  }

  /**
   * A request was refused for its session (`SessionError`): ask the auth server whether
   * the session still stands, and sign out on this device only if it clearly doesn't.
   * An expired token gets one refresh first. Network trouble and server errors never
   * sign anyone out.
   */
  async checkSession(reason: SessionEnd): Promise<void> {
    this.ending = reason
    try {
      const { error } = await this.client.auth.getUser()
      if (!error || !sessionGone(error)) return
      if (error.code === 'user_not_found') this.ending = 'deleted'
      else {
        const { error: refreshError } = await this.client.auth.refreshSession()
        if (!refreshError || !sessionGone(refreshError)) return
      }
      await this.client.auth.signOut({ scope: 'local' })
    } finally {
      this.ending = null
    }
  }

  /**
   * Keep the session fresh only while the app is on screen. React Native timers don't run
   * in the background, so the iPhone app pauses refreshing there and resumes on return.
   */
  setForeground(foreground: boolean): void {
    if (foreground) void this.client.auth.startAutoRefresh()
    else void this.client.auth.stopAutoRefresh()
  }

  /** Sign out on this device only; other devices stay signed in. */
  async signOut(): Promise<void> {
    await this.client.auth.signOut({ scope: 'local' })
  }

  /** Delete the account and its server copy. Sign out afterwards. */
  async deleteAccount(): Promise<void> {
    const { error, status } = await this.client.rpc('sync_delete_account')
    if (!error) return
    const failure = transportError(error, status)
    throw failure instanceof OfflineError ? failure : new SyncError(DELETE_FAILED)
  }

  /* ------------------------------------------------------------- Transport */

  async push(records: Item[]): Promise<PushResult> {
    const { data, error, status } = await this.client.rpc('sync_push', { records })
    if (error) throw transportError(error, status)
    return data as PushResult
  }

  async pull(since: number, limit: number): Promise<PullResult> {
    const { data, error, status } = await this.client.rpc('sync_pull', { since, max_rows: limit })
    if (error) throw transportError(error, status)
    return data as PullResult
  }

  /** A date range straight from the table; row-level security limits it to this account. */
  async pullDates(from: ISODate, to: ISODate): Promise<Item[]> {
    const { data, error, status } = await this.client
      .from('items')
      .select('id,date,parentId:parent_id,position,type,text,done,createdAt:created_at,updatedAt:updated_at,deleted,version')
      .gte('date', from)
      .lte('date', to)
      .limit(1000)
      // The engine retries with its own backoff.
      .retry(false)
    if (error) throw transportError(error, status)
    return data as Item[]
  }

  /* -------------------------------------------------------------- Realtime */

  /**
   * Listen for "something changed" hints on the account's private channel. Called
   * with the new seq for each hint, and with nothing whenever the channel (re)connects,
   * since hints sent while disconnected are lost. `onLive` follows whether the channel
   * is connected, so the engine can check more often while it isn't.
   */
  async listen(account: Account, onChange: (seq?: number) => void, onLive?: (live: boolean) => void): Promise<void> {
    const generation = ++this.listening
    // Load the stored session first: a private channel rejects a join made without it.
    await this.client.realtime.setAuth()
    if (generation !== this.listening) return
    this.client
      .channel(`sync:${account.id}`, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, ({ payload }) => {
        const seq = Number((payload as { seq?: unknown } | undefined)?.seq)
        onChange(Number.isFinite(seq) ? seq : undefined)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          onLive?.(true)
          onChange()
        } else onLive?.(false)
      })
  }

  unlisten(): void {
    this.listening += 1
    void this.client.removeAllChannels()
  }
}

/** Codes PostgREST and the migration use for a token or session the server won't accept. */
const SESSION_CODES = ['PGRST301', 'PGRST303', '28000']

/** What a failed request means, in words. The raw error goes to the console, never the UI. */
export function transportError(error: { message: string; code?: string }, status: number): SyncError {
  // postgrest-js reports a failed fetch (no network, DNS, TLS, a timeout) as status 0.
  if (status === 0) return new OfflineError('Can’t reach the sync server. Check your connection.')
  // The only foreign key is the account itself: it no longer exists.
  if (error.code === '23503') return new SessionError('deleted')
  if (status === 401 || status === 403 || SESSION_CODES.includes(error.code ?? '')) return new SessionError('expired')
  if (status >= 500) return new SyncError('The sync server isn’t responding. Cue will keep trying.')
  console.warn('Sync request failed', status, error)
  return new SyncError(SYNC_PAUSED)
}

/** Answers that mean the session is over. Rate limits, network trouble and server errors don't. */
function sessionGone(error: { status?: number; code?: string; name?: string }): boolean {
  return (
    error.name === 'AuthSessionMissingError' ||
    [401, 403, 404].includes(error.status ?? 0) ||
    ['user_not_found', 'session_not_found', 'session_expired', 'refresh_token_not_found', 'refresh_token_already_used'].includes(error.code ?? '')
  )
}

function friendlyAuthError(error: { message: string; code?: string; status?: number; name?: string }): SyncError {
  if ((error.status ?? 0) >= 500) return new SyncError('The sync server isn’t responding. Try again in a moment.')
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return new OfflineError('Can’t reach the sync server. Check your connection.')
  }
  switch (error.code) {
    case 'otp_expired':
      return new SyncError('That code is wrong or has expired. Check it, or send a new one.')
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return new SyncError('Too many codes requested. Wait a minute, then try again.')
    case 'email_address_invalid':
    case 'validation_failed':
      return new SyncError('That doesn’t look like an email address.')
  }
  console.warn('Sign-in failed', error)
  return new SyncError(SIGN_IN_FAILED)
}
