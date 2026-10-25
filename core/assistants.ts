/**
 * Where an assistant connects to Cue over MCP, and the pages about it (`site/assistants`,
 * `site/oauth/consent`). Settings → Assistants shows them on the Mac and the iPhone. An
 * assistant works with the account, so they need sync on. See docs/MCP.md.
 */
export const ASSISTANTS_URL = 'https://www.usecue.today/assistants'

/** The hosted sync server, which the site serves as www.usecue.today/mcp (`site/vercel.json`). */
const HOSTED = 'https://oxjcfsgwzpnajxrkwiai.supabase.co'

export interface AssistantUrls {
  /** Where an assistant connects. */
  mcp: string
  /** Lists the connected assistants, each with Disconnect. Null where it isn't known. */
  connected: string | null
}

/**
 * Where an assistant connects for an account on `server`, this build's sync server. The
 * hosted one is reached through Cue's own domain. Any other (the local stack, a project of
 * your own) is reached at its function, the URL the function names when `CUE_MCP_URL`
 * isn't set; its consent page could be anywhere, so there's no link to it.
 */
export function assistantUrls(server: string): AssistantUrls {
  const url = server.replace(/\/+$/, '')
  return url === HOSTED
    ? { mcp: 'https://www.usecue.today/mcp', connected: 'https://www.usecue.today/oauth/consent' }
    : { mcp: `${url}/functions/v1/mcp`, connected: null }
}
