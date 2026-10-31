import { DatabaseSync } from 'node:sqlite'
import { fetchPage, type LinkPage, type LinkPreview } from '@shared/links'

/**
 * Previews for lines that are only a link, fetched once and kept on this Mac in their own
 * file, apart from the notes: they're a cache, never synced or backed up. The page's icon
 * is stored with its preview, so a preview draws at once, offline too, and the window
 * never loads anything from the web itself.
 *
 * A stored preview is handed out at once and refreshed in the background once it's old.
 * A page that couldn't be reached is tried again after a while; until then its line shows
 * the link's address.
 *
 * Each page also keeps what the Links list finds it by (`linkSearchText`): its title,
 * description and the start of its text. Links that no line has shown yet, such as one
 * in the middle of a sentence, are fetched for that in the background (`fill`), behind
 * any preview a line on screen is waiting for.
 */

const FRESH_FOR = 14 * 24 * 60 * 60_000
const RETRY_AFTER = 60 * 60_000
const FILL_RETRY_AFTER = 24 * 60 * 60_000
const AT_ONCE = 3
const ICON_TIMEOUT = 5000
const ICON_MAX_BYTES = 200_000
const SCHEMA = 2

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export class LinkPreviews {
  private db: DatabaseSync
  private read
  private write
  private searchable
  private queue: string[] = []
  private loading = new Set<string>()

  constructor(
    file: string,
    private fetch: Fetch,
    private onPreview: (url: string, preview: LinkPreview | null) => void
  ) {
    try {
      this.db = new DatabaseSync(file)
    } catch (error) {
      console.error('Couldn’t open the link preview cache', error)
      this.db = new DatabaseSync(':memory:')
    }
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version === 1) {
      // Previews from before the Links list keep their icons; `fill` reads their pages again for search.
      this.db.exec(`ALTER TABLE previews ADD COLUMN search TEXT; PRAGMA user_version = ${SCHEMA};`)
    } else if (version !== SCHEMA) {
      // It's only a cache: a file from any other version starts over.
      this.db.exec(`DROP TABLE IF EXISTS previews;
        CREATE TABLE previews (
          url TEXT PRIMARY KEY,
          preview TEXT,
          fetched_at INTEGER NOT NULL,
          failed INTEGER NOT NULL DEFAULT 0,
          search TEXT
        );
        PRAGMA user_version = ${SCHEMA};`)
    }
    this.read = this.db.prepare('SELECT preview, fetched_at, failed, search FROM previews WHERE url = ?')
    this.write = this.db.prepare('INSERT OR REPLACE INTO previews (url, preview, fetched_at, failed, search) VALUES (?, ?, ?, ?, ?)')
    this.searchable = this.db.prepare('SELECT url, search FROM previews WHERE search IS NOT NULL')
  }

  /** The stored preview for a link (null until its page has answered), fetching it if it's due. */
  get(url: string): LinkPreview | null {
    if (!/^https?:\/\//i.test(url) || url.length > 2048) return null
    const row = this.stored(url)
    // A page that didn't answer last time is tried again sooner, even if it has an older preview.
    if (!row || Date.now() - row.fetchedAt > (row.preview && !row.failed ? FRESH_FOR : RETRY_AFTER)) this.request(url, true)
    return row?.preview ?? null
  }

  /**
   * Read the pages of links the Links list can't find by their page yet: never fetched, or
   * kept from before it existed. A page that didn't answer is left for a day, so a dead
   * link isn't asked for every time. These go behind every preview a line is waiting for.
   */
  fill(urls: string[]): void {
    for (const url of urls) {
      if (!/^https?:\/\//i.test(url) || url.length > 2048) continue
      const row = this.stored(url)
      if (row && (row.search !== null || (row.failed && Date.now() - row.fetchedAt < FILL_RETRY_AFTER))) continue
      this.request(url, false)
    }
  }

  /** What each page that's been read is found by, by URL. */
  searchText(): Map<string, string> {
    try {
      return new Map((this.searchable.all() as Array<{ url: string; search: string }>).map((r) => [r.url, r.search]))
    } catch (error) {
      console.warn('Couldn’t read what links are found by', error)
      return new Map()
    }
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      // already closed
    }
  }

  private stored(url: string): { preview: LinkPreview | null; fetchedAt: number; failed: boolean; search: string | null } | null {
    try {
      const row = this.read.get(url) as { preview: string | null; fetched_at: number; failed: number; search: string | null } | undefined
      if (!row) return null
      return {
        preview: row.preview ? (JSON.parse(row.preview) as LinkPreview) : null,
        fetchedAt: row.fetched_at,
        failed: !!row.failed,
        search: row.search
      }
    } catch (error) {
      console.warn('Couldn’t read a link preview', error)
      return null
    }
  }

  /** A line on screen waiting for its preview goes first (`soon`); filling in for search, last. */
  private request(url: string, soon: boolean): void {
    if (this.loading.has(url)) return
    const queued = this.queue.indexOf(url)
    if (queued >= 0) {
      if (!soon) return
      this.queue.splice(queued, 1)
    }
    if (soon) this.queue.unshift(url)
    else this.queue.push(url)
    this.pump()
  }

  private pump(): void {
    while (this.loading.size < AT_ONCE && this.queue.length) {
      const url = this.queue.shift()!
      this.loading.add(url)
      void this.load(url)
        .catch(() => null)
        .then((page) => {
          this.loading.delete(url)
          this.save(url, page)
          this.pump()
        })
    }
  }

  private async load(url: string): Promise<LinkPage> {
    const { preview, search } = await fetchPage(url, this.fetch as never)
    return { preview: { ...preview, icon: preview.icon ? await this.iconData(preview.icon) : null }, search }
  }

  /** A page's icon as a data URL, or null if it isn't a small image. */
  private async iconData(url: string): Promise<string | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ICON_TIMEOUT)
    try {
      const res = await this.fetch(url, { signal: controller.signal, redirect: 'follow' })
      if (!res.ok) return null
      let type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      // Favicons are often served without an image type.
      if (!type.startsWith('image/') && /\.ico(?:$|\?)/i.test(url)) type = 'image/x-icon'
      if (!type.startsWith('image/') || type.includes('svg')) return null
      if (Number(res.headers.get('content-length') ?? 0) > ICON_MAX_BYTES || !res.body) return null
      // Read up to the limit and no further, whatever the server says the size is.
      const chunks: Uint8Array[] = []
      let size = 0
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > ICON_MAX_BYTES) {
          void reader.cancel().catch(() => {})
          return null
        }
        chunks.push(value)
      }
      return size ? `data:${type};base64,${Buffer.concat(chunks).toString('base64')}` : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  private save(url: string, page: LinkPage | null): void {
    // A page that was reachable before and isn't right now keeps its preview, and what it's found by.
    const previous = page ? null : this.stored(url)
    const kept = page?.preview ?? previous?.preview ?? null
    const search = page?.search ?? previous?.search ?? null
    try {
      this.write.run(url, kept ? JSON.stringify(kept) : null, Date.now(), page ? 0 : 1, search)
    } catch (error) {
      console.warn('Couldn’t store a link preview', error)
    }
    this.onPreview(url, kept)
  }
}
