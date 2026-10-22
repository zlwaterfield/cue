import type { ISODate, Item } from '../types.ts'

/**
 * What the MCP tools read and write: one person's notes on the sync server. Reads see
 * live lines only. Writes go through `sync_push`, like any device, so every signed-in
 * Mac and iPhone picks them up within moments.
 */
export interface Notes {
  itemsOn(dates: ISODate[]): Promise<Item[]>
  items(ids: string[]): Promise<Item[]>
  todos(from: ISODate, to: ISODate, includeDone: boolean): Promise<Item[]>
  search(terms: string[], limit: number): Promise<Item[]>
  push(items: Item[]): Promise<void>
}

/** The token was refused (expired, revoked, or not a Cue session): sign in again. */
export class Unauthorized extends Error {}

const COLUMNS =
  'id,date,parentId:parent_id,position,type,text,done,createdAt:created_at,updatedAt:updated_at,deleted,version'
const MAX_ROWS = 1000

/**
 * `Notes` over Supabase's REST API with the person's own access token, so row-level
 * security decides what's visible exactly as it does for the apps.
 */
export class SupabaseNotes implements Notes {
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  itemsOn(dates: ISODate[]): Promise<Item[]> {
    return this.select(`date=in.(${dates.join(',')})`)
  }

  items(ids: string[]): Promise<Item[]> {
    return this.select(`id=in.(${ids.join(',')})`)
  }

  todos(from: ISODate, to: ISODate, includeDone: boolean): Promise<Item[]> {
    const done = includeDone ? '' : '&done=is.false'
    return this.select(`type=eq.todo&date=gte.${from}&date=lte.${to}${done}&order=date,position,id`)
  }

  search(terms: string[], limit: number): Promise<Item[]> {
    // Quoted, so commas and parentheses in a term are literal. LIKE's own wildcards are
    // stripped rather than escaped through two layers of quoting.
    const quote = (term: string): string => `"*${term.replace(/[\\"%_*]/g, '')}*"`
    const all = terms.map((t) => `text.ilike.${quote(t)}`).join(',')
    return this.select(`and=(${encodeURIComponent(all)})&order=date.desc,position,id`, limit)
  }

  async push(items: Item[]): Promise<void> {
    await this.request('rpc/sync_push', { method: 'POST', body: JSON.stringify({ records: items }) })
  }

  private async select(filter: string, limit = MAX_ROWS): Promise<Item[]> {
    const rows = await this.request(`items?select=${COLUMNS}&deleted=is.false&${filter}&limit=${limit}`)
    return rows as Item[]
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetcher(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: this.key, authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }
    })
    if (response.status === 401) throw new Unauthorized()
    if (!response.ok) {
      console.error(`Supabase ${response.status}: ${await response.text()}`)
      throw new Error('Cue couldn’t reach your notes. Try again in a moment.')
    }
    return response.json()
  }
}
