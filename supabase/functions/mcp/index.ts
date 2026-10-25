import { handleMessage, type JsonRpcRequest } from '../../../core/mcp/server.ts'
import { SupabaseNotes, Unauthorized } from '../../../core/mcp/notes.ts'

/**
 * Cue's MCP endpoint: POST JSON-RPC to /functions/v1/mcp with a Supabase access token.
 * Hosted, people reach it as www.usecue.today/mcp, which the site proxies here
 * (site/vercel.json).
 * Assistants get that token by OAuth from Supabase Auth, with consent given on
 * usecue.today/oauth/consent. A request without a usable token gets a 401 that points
 * to this resource's metadata, which is how an MCP client finds where to sign in.
 * See docs/MCP.md.
 */

/** Where this function reaches the database (inside Supabase's network locally). */
const API = Deno.env.get('SUPABASE_URL')!
/** Where people reach this project. The same as API when hosted. */
const PUBLIC = Deno.env.get('CUE_PUBLIC_URL') ?? API
const KEY = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_ANON_KEY')!
/** The URL assistants connect to, which discovery must name exactly (CUE_MCP_URL when hosted). */
const RESOURCE = Deno.env.get('CUE_MCP_URL') ?? `${PUBLIC}/functions/v1/mcp`
const METADATA = `${RESOURCE}/.well-known/oauth-protected-resource`

// Browser-based clients (such as the MCP Inspector) call from other origins.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'www-authenticate'
}

Deno.serve(async (request) => {
  const path = new URL(request.url).pathname
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (path.endsWith('/.well-known/oauth-protected-resource')) {
    return json({
      resource: RESOURCE,
      authorization_servers: [`${PUBLIC}/auth/v1`],
      bearer_methods_supported: ['header'],
      resource_name: 'Cue'
    })
  }
  // Stateless and JSON-only: there's no event stream to GET.
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS' } })

  const token = /^Bearer (.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token) return unauthorized()
  // Refuse a token that's plainly unusable before doing anything. The signature is checked
  // by the database on every read and write, so nothing private is ever returned without it.
  if (!looksValid(token)) return unauthorized('invalid_token')

  let body: JsonRpcRequest | JsonRpcRequest[]
  try {
    body = await request.json()
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
  }
  const notes = new SupabaseNotes(API, KEY, token)
  try {
    const messages = Array.isArray(body) ? body : [body]
    const replies = (await Promise.all(messages.map((m) => handleMessage(m, notes)))).filter((r) => r !== null)
    if (!replies.length) return new Response(null, { status: 202, headers: CORS })
    return json(Array.isArray(body) ? replies : replies[0])
  } catch (error) {
    if (error instanceof Unauthorized) return unauthorized('invalid_token')
    console.error(error)
    return json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }, 500)
  }
})

/** An unexpired access token for a signed-in person. */
function looksValid(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.role === 'authenticated' && typeof payload.exp === 'number' && payload.exp * 1000 > Date.now()
  } catch {
    return false
  }
}

function unauthorized(error?: string): Response {
  const challenge = `Bearer resource_metadata="${METADATA}"${error ? `, error="${error}"` : ''}`
  return json({ error: error ?? 'unauthorized' }, 401, { 'www-authenticate': challenge })
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, ...headers, 'content-type': 'application/json' } })
}
