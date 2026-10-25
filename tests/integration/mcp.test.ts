import { createHash, randomBytes } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SyncEngine } from '../../core/sync/engine'
import { SupabaseSync, type Account } from '../../core/sync/supabase'
import { todayISO } from '../../core/dates'
import type { Repository } from '../../core/repository'
import { signInCode, syncServer, testEmail } from '../syncServer'
import { memoryRepo } from '../unit/helpers'

/**
 * The MCP server as an assistant uses it, against the local stack (docs/MCP.md): it
 * registers itself, the person approves it on the consent page, it trades the code for
 * a token, and its edits reach a signed-in Mac through sync like any device's.
 */

const REDIRECT = 'http://127.0.0.1:9/callback'

describe.skipIf(!syncServer)('MCP server', { timeout: 30_000 }, () => {
  const mcpUrl = `${syncServer?.url}/functions/v1/mcp`
  const auth = `${syncServer?.url}/auth/v1`
  let mac: { repo: Repository; client: SupabaseSync; account: Account; engine: SyncEngine }
  let site: SupabaseClient
  let clientId: string
  let token: { access_token: string; refresh_token: string }
  let rpcId = 0

  async function mcp(method: string, params?: object, bearer = token.access_token): Promise<Response> {
    return fetch(mcpUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
    })
  }

  async function tool(name: string, args: object): Promise<string> {
    const response = await mcp('tools/call', { name, arguments: args })
    expect(response.status).toBe(200)
    const { result } = await response.json()
    expect(result.isError).toBeUndefined()
    return result.content[0].text
  }

  beforeAll(async () => {
    // The Mac: signed in with an emailed code, syncing, listening for changes.
    const values = new Map<string, string>()
    const store = { get: (k: string) => values.get(k) ?? null, set: (k: string, v: string) => void values.set(k, v), remove: (k: string) => void values.delete(k) }
    const client = new SupabaseSync(syncServer!, store)
    const email = testEmail('mcp')
    await client.sendCode(email)
    const account = await client.verifyCode(email, await signInCode(email))
    const repo = memoryRepo()
    const engine = new SyncEngine(repo, { push: (r) => client.push(r), pull: (s, l) => client.pull(s, l) })
    mac = { repo, client, account, engine }
    await client.listen(account, (seq) => engine.remoteChange(seq))
    engine.start()

    // The website, signed in as the same person, for the consent page.
    const session = JSON.parse(values.get('session')!)
    site = createClient(syncServer!.url, syncServer!.key, { auth: { persistSession: false, autoRefreshToken: false } })
    await site.auth.setSession(session)
  }, 60_000)

  afterAll(async () => {
    mac.client.unlisten()
    await mac.engine.stop()
  })

  it('tells a client without a token where to sign in', async () => {
    const response = await fetch(mcpUrl, { method: 'POST', body: '{}' })
    expect(response.status).toBe(401)
    const challenge = response.headers.get('www-authenticate')!
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)![1]
    const metadata = await (await fetch(metadataUrl)).json()
    expect(metadata).toMatchObject({ resource: mcpUrl, authorization_servers: [auth] })
    const server = await (await fetch(`${auth}/.well-known/openid-configuration`)).json()
    expect(server.registration_endpoint).toBe(`${auth}/oauth/clients/register`)
  })

  it('connects an assistant with OAuth: register, consent, token', async () => {
    const registered = await fetch(`${auth}/oauth/clients/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Test Assistant', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' })
    })
    expect(registered.status).toBe(201)
    clientId = (await registered.json()).client_id

    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const authorize = await fetch(
      `${auth}/oauth/authorize?` +
        new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' }),
      { redirect: 'manual' }
    )
    const consentPage = new URL(authorize.headers.get('location')!)
    expect(consentPage.pathname).toBe('/oauth/consent')
    const authorizationId = consentPage.searchParams.get('authorization_id')!

    // What the consent page does once the person is signed in.
    const { data: details, error } = await site.auth.oauth.getAuthorizationDetails(authorizationId)
    expect(error).toBeNull()
    expect(details).toMatchObject({ client: { name: 'Test Assistant' }, user: { id: mac.account.id } })
    const { data: approved } = await site.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    const back = new URL(approved!.redirect_url)
    expect(back.searchParams.get('state')).toBe('s1')

    const exchanged = await fetch(`${auth}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier })
    })
    expect(exchanged.status).toBe(200)
    token = await exchanged.json()
    expect(token.access_token).toBeTruthy()
  })

  it('speaks MCP with that token', async () => {
    const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect((await init.json()).result.serverInfo.name).toBe('cue')
    const note = await fetch(mcpUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })
    expect(note.status).toBe(202) // a notification gets no answer
    const list = await (await mcp('tools/list')).json()
    expect(list.result.tools).toHaveLength(5)
  })

  it('adds a to-do that shows up on the Mac within moments, then checks it off', async () => {
    const today = todayISO()
    const added = await tool('add_lines', { date: today, markdown: '- [ ] Water the plants' })
    const id = /\{#([0-9a-f-]{36})\}/.exec(added)![1]
    await vi.waitFor(() => expect(mac.repo.get(id)?.text).toBe('Water the plants'), { timeout: 5000, interval: 20 })

    await tool('update_lines', { ids: [id], done: true })
    await vi.waitFor(() => expect(mac.repo.get(id)?.done).toBe(true), { timeout: 5000, interval: 20 })
    expect(await tool('get_day', { date: today })).toContain(`- [x] Water the plants {#${id}}`)
    expect(await tool('search', { query: 'plants' })).toContain('Water the plants')
  })

  it('can’t delete, even calling the database directly with its token', async () => {
    const rpc = (name: string, body: object): Promise<Response> =>
      fetch(`${syncServer!.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: syncServer!.key, authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    expect((await rpc('sync_delete_account', {})).status).toBe(403)
    // Nor agree to the terms on anyone's behalf.
    expect((await rpc('accept_terms', { version: '2026-10-24' })).status).toBe(403)
    const line = mac.repo.allItems().find((i) => !i.deleted)!
    const tombstone = { ...line, deleted: true, version: line.version.replace(/^0/, 'z') }
    expect((await rpc('sync_push', { records: [tombstone] })).status).toBe(403)
    // Postgres reads these as true too.
    for (const deleted of ['t', 'TRUE', 'yes', 'on', '1', ' true ']) {
      expect((await rpc('sync_push', { records: [{ ...tombstone, deleted }] })).status, `deleted: ${JSON.stringify(deleted)}`).toBe(403)
    }
    // The account and the line are still there.
    await mac.engine.sync()
    expect(mac.repo.get(line.id)?.deleted).toBe(false)
    expect(await tool('get_day', { date: line.date })).toContain(line.id)
  })

  it('can’t take over the account through Supabase Auth', async () => {
    const headers = { apikey: syncServer!.key, authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' }
    // A password would sign in without the assistant's claim, so no account can have one.
    const password = await fetch(`${auth}/user`, { method: 'PUT', headers, body: JSON.stringify({ password: 'correct-horse-battery' }) })
    expect(password.ok).toBe(false)
    const signIn = await fetch(`${auth}/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: syncServer!.key, 'content-type': 'application/json' },
      body: JSON.stringify({ email: mac.account.email, password: 'correct-horse-battery' })
    })
    expect(signIn.ok).toBe(false)
    // A new address must be confirmed from the current one too (secure email change).
    await fetch(`${auth}/user`, { method: 'PUT', headers, body: JSON.stringify({ email: testEmail('takeover') }) })
    const user = await (await fetch(`${auth}/user`, { headers })).json()
    expect(user.email).toBe(mac.account.email)
  })

  it('reads and writes only the signed-in person’s notes', async () => {
    const theirs = mac.repo.allItems()[0]
    const stranger = createClient(syncServer!.url, syncServer!.key, { auth: { persistSession: false } })
    const email = testEmail('mcp-other')
    await stranger.auth.signInWithOtp({ email })
    const { data } = await stranger.auth.verifyOtp({ email, token: await signInCode(email), type: 'email' })
    const response = await mcp('tools/call', { name: 'update_lines', arguments: { ids: [theirs.id], done: false } }, data.session!.access_token)
    expect((await response.json()).result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/No line with id/) }] })
  })

  it('refuses a forged or expired token', async () => {
    const [header, , signature] = token.access_token.split('.')
    const claims = JSON.parse(Buffer.from(token.access_token.split('.')[1], 'base64url').toString())
    const forged = `${header}.${Buffer.from(JSON.stringify({ ...claims, sub: crypto.randomUUID() })).toString('base64url')}.${signature}`
    const forgedCall = await mcp('tools/call', { name: 'get_day', arguments: { date: todayISO() } }, forged)
    expect(forgedCall.status).toBe(401)
    expect(forgedCall.headers.get('www-authenticate')).toMatch(/error="invalid_token"/)
    const expired = `${header}.${Buffer.from(JSON.stringify({ ...claims, exp: 1 })).toString('base64url')}.${signature}`
    expect((await mcp('tools/list', {}, expired)).status).toBe(401)
  })

  it('keeps the assistant’s claim when its token is refreshed', async () => {
    const refreshed = await fetch(`${auth}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: clientId })
    })
    expect(refreshed.status).toBe(200)
    token = await refreshed.json()
    const claims = JSON.parse(Buffer.from(token.access_token.split('.')[1], 'base64url').toString())
    expect(claims.client_id).toBe(clientId)
  })

  it('lists the connection on the site and disconnects it', async () => {
    const { data: grants } = await site.auth.oauth.listGrants()
    expect(grants!.map((g) => g.client.name)).toContain('Test Assistant')
    await site.auth.oauth.revokeGrant({ clientId })
    const refresh = await fetch(`${auth}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: clientId })
    })
    expect(refresh.ok).toBe(false)
  })
})
