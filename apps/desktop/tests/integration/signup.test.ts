import { describe, expect, it } from 'vitest'
import { SupabaseSync } from '@shared/sync/supabase'
import { signInCode, syncServer, testEmail } from '../syncServer'

/**
 * Signing up, against the local stack. A new address's account is made by Supabase Auth's own
 * signup, with a temporary password, and no Cue account may keep one
 * (supabase/migrations/20261117000000_code_signup.sql). Run with `pnpm test:sync`.
 */

function memoryStore(): { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void } {
  const values = new Map<string, string>()
  return { get: (k) => values.get(k) ?? null, set: (k, v) => void values.set(k, v), remove: (k) => void values.delete(k) }
}

/** Signs in with an emailed code, returning the account id and its access token. */
async function signIn(email: string): Promise<{ id: string; token: string }> {
  const store = memoryStore()
  const client = new SupabaseSync(syncServer!, store)
  // An address can request a code once a second.
  await client.sendCode(email).catch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await client.sendCode(email)
  })
  const { id } = await client.verifyCode(email, await signInCode(email))
  return { id, token: (JSON.parse(store.get('session')!) as { access_token: string }).access_token }
}

describe.skipIf(!syncServer)('signing up', { timeout: 30_000 }, () => {
  const auth = `${syncServer?.url}/auth/v1`
  const headers = { apikey: syncServer?.key ?? '', 'Content-Type': 'application/json' }
  const PASSWORD = 'correct-horse-battery'

  const passwordSignIn = (email: string): Promise<Response> =>
    fetch(`${auth}/token?grant_type=password`, { method: 'POST', headers, body: JSON.stringify({ email, password: PASSWORD }) })

  it('makes an account for a new address with an emailed code, and signs it in again', async () => {
    const email = testEmail('new')
    const { id } = await signIn(email)
    expect((await signIn(email)).id).toBe(id)
  })

  it('refuses a password set once signed in', async () => {
    const email = testEmail('later')
    const { token } = await signIn(email)
    const set = await fetch(`${auth}/user`, { method: 'PUT', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ password: PASSWORD }) })
    expect(set.ok).toBe(false)
    expect((await passwordSignIn(email)).ok).toBe(false)
  })

  it('gives a password signup no session, and its password never signs in, even once the address’s owner has', async () => {
    const email = testEmail('squat')
    const signup = await fetch(`${auth}/signup`, { method: 'POST', headers, body: JSON.stringify({ email, password: PASSWORD }) })
    expect(signup.ok).toBe(true)
    const body = (await signup.json()) as { access_token?: string; refresh_token?: string }
    expect(body.access_token).toBeUndefined()
    expect(body.refresh_token).toBeUndefined()
    expect((await passwordSignIn(email)).ok).toBe(false)

    // The confirmation went to the address, not to whoever signed it up.
    await signInCode(email)
    await signIn(email)
    expect((await passwordSignIn(email)).ok).toBe(false)
  })
})
