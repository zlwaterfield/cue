import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorMessage, OfflineError, SessionError, SyncError, type SessionEnd } from '../../core/sync/engine'
import { SupabaseSync, transportError, type SessionStore } from '../../core/sync/supabase'

const PAUSED = 'Sync paused. Cue will keep trying.'

describe('sync errors in words', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps every failed request to copy without server text', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fk = 'insert or update on table "items" violates foreign key constraint "items_user_id_fkey"'
    const cases: Array<[status: number, error: { message: string; code?: string }, kind: Function, extra?: unknown]> = [
      [0, { message: 'TypeError: fetch failed net::ERR_CONNECTION_RESET' }, OfflineError],
      [0, { message: 'AbortError: The request timed out.' }, OfflineError],
      [409, { message: fk, code: '23503' }, SessionError, 'deleted'],
      [401, { message: 'JWT expired', code: 'PGRST301' }, SessionError, 'expired'],
      [401, { message: 'No suitable key or wrong key type', code: 'PGRST303' }, SessionError, 'expired'],
      [403, { message: 'Not signed in', code: '28000' }, SessionError, 'expired'],
      [403, { message: 'permission denied for function sync_push', code: '42501' }, SessionError, 'expired'],
      [503, { message: 'upstream connect error' }, SyncError],
      [409, { message: 'duplicate key value violates unique constraint "items_pkey"', code: '23505' }, SyncError],
      [400, { message: 'invalid input syntax for type bigint', code: '22P02' }, SyncError]
    ]
    for (const [status, error, kind, reason] of cases) {
      const mapped = transportError(error, status)
      expect(mapped).toBeInstanceOf(kind)
      if (reason) expect((mapped as SessionError).reason).toBe(reason)
      expect(mapped.message).not.toMatch(/net::|abort|violates|constraint|JWT|sync_push|syntax|upstream|\(\d+\)/i)
    }
    expect(transportError({ message: 'x' }, 503).message).toBe('The sync server isn’t responding. Cue will keep trying.')
    expect(transportError({ message: 'x', code: '23505' }, 409).message).toBe(PAUSED)
    // The raw error still reaches the console for whoever is debugging.
    expect(warn).toHaveBeenCalledWith('Sync request failed', 409, expect.objectContaining({ code: '23505' }))
  })

  it('shows a generic pause for anything unexpected', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(errorMessage(new TypeError('Cannot destructure property "before" of null'))).toBe(PAUSED)
    expect(errorMessage('SQLITE_BUSY: database is locked', 'Couldn’t sign in.')).toBe('Couldn’t sign in.')
    expect(errorMessage(new SyncError('That code is wrong or has expired.'))).toBe('That code is wrong or has expired.')
  })
})

/* ------------------------------------------------- Confirming a refused session */

const SESSION = {
  access_token: 'header.eyJzdWIiOiJ1c2VyLTEifQ.signature',
  refresh_token: 'refresh-1',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'user-1', email: 'me@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' }
}

type Answer = Response | 'network'

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' } })

/** A signed-in client whose auth server gives the answers for `/user` and token refresh. */
function signedIn(answers: { user: Answer; refresh?: Answer }) {
  const values = new Map([['session', JSON.stringify(SESSION)]])
  const store: SessionStore = { get: (k) => values.get(k) ?? null, set: (k, v) => void values.set(k, v), remove: (k) => void values.delete(k) }
  const calls: string[] = []
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const { pathname } = new URL(String(input))
    calls.push(pathname)
    const answer = pathname.endsWith('/user') ? answers.user : pathname.endsWith('/token') ? (answers.refresh ?? json(500, {})) : new Response(null, { status: 204 })
    if (answer === 'network') throw new TypeError('fetch failed')
    return answer.clone()
  }
  const client = new SupabaseSync({ url: 'http://sync.test', key: 'key', fetch }, store)
  const ended: SessionEnd[] = []
  client.onSignedOut((reason) => ended.push(reason))
  return { client, ended, calls, session: () => values.get('session') ?? null }
}

describe('checkSession', () => {
  it('signs out with "deleted" when the account is gone', async () => {
    const { client, ended, session } = signedIn({ user: json(403, { code: 'user_not_found', message: 'User from sub claim in JWT does not exist' }) })
    await client.checkSession('deleted')
    expect(ended).toEqual(['deleted'])
    expect(session()).toBeNull()
  })

  it('says "deleted" even when the refused request only looked like an expired session', async () => {
    const { client, ended } = signedIn({ user: json(403, { code: 'user_not_found', message: 'gone' }) })
    await client.checkSession('expired')
    expect(ended).toEqual(['deleted'])
  })

  it('refreshes a token the server refused, and signs out only if that fails too', async () => {
    const expired = signedIn({
      user: json(403, { code: 'bad_jwt', message: 'invalid JWT: token is expired' }),
      refresh: json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' })
    })
    await expired.client.checkSession('expired')
    expect(expired.ended).toEqual(['expired'])
    expect(expired.calls).toContain('/auth/v1/token')

    const renewed = signedIn({
      user: json(403, { code: 'bad_jwt', message: 'invalid JWT: token is expired' }),
      refresh: json(200, { ...SESSION, access_token: 'header.eyJzdWIiOiJ1c2VyLTEifQ.renewed', refresh_token: 'refresh-2' })
    })
    await renewed.client.checkSession('expired')
    expect(renewed.ended).toEqual([])
    expect(renewed.session()).toContain('refresh-2')
  })

  it('never signs out over network trouble, server errors or rate limits', async () => {
    for (const user of ['network', json(500, { message: 'boom' }), json(502, {}), json(429, { code: 'over_request_rate_limit', message: 'slow down' })] as Answer[]) {
      const { client, ended, session } = signedIn({ user })
      await client.checkSession('expired')
      expect(ended).toEqual([])
      expect(session()).not.toBeNull()
    }
    // A session that's fine stays, whatever the refused request suggested.
    const fine = signedIn({ user: json(200, SESSION.user) })
    await fine.client.checkSession('deleted')
    expect(fine.ended).toEqual([])
  })
})

describe('Sign in with Apple on the Mac', () => {
  function apple(answer: Answer) {
    const values = new Map<string, string>()
    const store: SessionStore = { get: (k) => values.get(k) ?? null, set: (k, v) => void values.set(k, v), remove: (k) => void values.delete(k) }
    const asked: URL[] = []
    const fetch = async (input: RequestInfo | URL): Promise<Response> => {
      asked.push(new URL(String(input)))
      if (answer === 'network') throw new TypeError('fetch failed')
      return answer.clone()
    }
    return { client: new SupabaseSync({ url: 'http://sync.test', key: 'key', fetch }, store), asked, values }
  }

  it('asks the server for Apple’s page, with a PKCE challenge and the way back to this Mac', async () => {
    const page = 'https://appleid.apple.com/auth/authorize?client_id=app.cue.signin&state=abc'
    const { client, asked, values } = apple(new Response(null, { status: 302, headers: { Location: page } }))
    expect(await client.appleSignInUrl('http://127.0.0.1:51234/auth/callback')).toBe(page)
    const authorize = asked[0]
    expect(authorize.pathname).toBe('/auth/v1/authorize')
    expect(authorize.searchParams.get('provider')).toBe('apple')
    expect(authorize.searchParams.get('redirect_to')).toBe('http://127.0.0.1:51234/auth/callback')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('s256')
    // The verifier stays here; only this client can exchange the code that comes back.
    expect([...values.keys()].some((key) => key.includes('code-verifier'))).toBe(true)
  })

  it('says so in Cue when the server doesn’t offer it, or can’t be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const msg of ['Unsupported provider: provider is not enabled', 'Unsupported provider: missing OAuth secret']) {
      const { client } = apple(json(400, { code: 400, error_code: 'validation_failed', msg }))
      await expect(client.appleSignInUrl('http://127.0.0.1:1/auth/callback')).rejects.toThrow(
        'This sync server doesn’t offer Sign in with Apple. Use your email instead.'
      )
    }
    const offline = apple('network')
    await expect(offline.client.appleSignInUrl('http://127.0.0.1:1/auth/callback')).rejects.toBeInstanceOf(OfflineError)
    const broken = apple(json(400, { error_code: 'bad_oauth_state', msg: 'nope' }))
    await expect(broken.client.appleSignInUrl('http://127.0.0.1:1/auth/callback')).rejects.toThrow('Couldn’t sign in. Try again in a moment.')
  })
})
