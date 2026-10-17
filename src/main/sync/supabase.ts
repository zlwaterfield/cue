import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Item } from '../../shared/types'
import { OfflineError, type PullResult, type PushResult, type SyncTransport } from './engine'

/**
 * Everything that talks to Supabase: email sign-in, the push/pull transport, and
 * realtime hints. This module is loaded only once someone turns sync on, so a
 * signed-out Cue never loads it or touches the network.
 */

export interface SyncConfig {
  url: string
  key: string
  /** HTTP client; the app passes Electron's `net.fetch` (Chromium's network stack). */
  fetch?: typeof fetch
}

/** Where the auth session lives (SQLite meta, encrypted with the macOS Keychain). */
export interface SessionStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export interface Account {
  id: string
  email: string
}

export class SupabaseSync implements SyncTransport {
  private readonly client: SupabaseClient
  private listening = 0

  constructor(config: SyncConfig, store: SessionStore) {
    this.client = createClient(config.url, config.key, {
      global: config.fetch ? { fetch: config.fetch } : {},
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
    if (!data.user) throw new Error('Sign-in didn’t complete. Try again.')
    return { id: data.user.id, email: data.user.email ?? email }
  }

  /** Called if the server ends the session (e.g. the account was deleted elsewhere). */
  onSignedOut(callback: () => void): void {
    this.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') callback()
    })
  }

  /** Sign out on this Mac only; other devices stay signed in. */
  async signOut(): Promise<void> {
    await this.client.auth.signOut({ scope: 'local' })
  }

  /** Delete the account and its server copy. Sign out afterwards. */
  async deleteAccount(): Promise<void> {
    const { error, status } = await this.client.rpc('sync_delete_account')
    if (error) throw transportError(error, status)
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

  /* -------------------------------------------------------------- Realtime */

  /**
   * Listen for "something changed" hints on the account's private channel. Called
   * with the new seq for each hint, and with nothing whenever the channel (re)connects,
   * since hints sent while disconnected are lost.
   */
  async listen(account: Account, onChange: (seq?: number) => void): Promise<void> {
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
        if (status === 'SUBSCRIBED') onChange()
      })
  }

  unlisten(): void {
    this.listening += 1
    void this.client.removeAllChannels()
  }
}

function transportError(error: { message: string; code?: string }, status: number): Error {
  // postgrest-js reports a failed fetch (no network, DNS, TLS) as status 0.
  if (status === 0) return new OfflineError(error.message)
  if (status === 401 || status === 403) return new Error('Your sync session has expired. Sign in again.')
  if (status >= 500) return new Error(`The sync server isn’t responding (${status}).`)
  return new Error(error.message)
}

function friendlyAuthError(error: { message: string; code?: string; status?: number; name?: string }): Error {
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return new OfflineError('Can’t reach the sync server. Check your connection.')
  }
  switch (error.code) {
    case 'otp_expired':
      return new Error('That code is wrong or has expired. Check it, or send a new one.')
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return new Error('Too many codes requested. Wait a minute, then try again.')
    case 'email_address_invalid':
    case 'validation_failed':
      return new Error('That doesn’t look like an email address.')
  }
  return new Error(error.message)
}
