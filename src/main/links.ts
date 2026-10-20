import { DatabaseSync } from 'node:sqlite'
import { fetchPreview, type LinkPreview } from '../shared/links'

/**
 * Previews for lines that are only a link, fetched once and kept on this Mac in their own
 * file, apart from the notes: they're a cache, never synced or backed up. The page's icon
 * is stored with its preview, so a preview draws at once, offline too, and the window
 * never loads anything from the web itself.
 *
 * A stored preview is handed out at once and refreshed in the background once it's old.
 * A page that couldn't be reached is tried again after a while; until then its line shows
 * the link's address.
 */

const FRESH_FOR = 14 * 24 * 60 * 60_000
const RETRY_AFTER = 60 * 60_000
const AT_ONCE = 3
const ICON_TIMEOUT = 5000
const ICON_MAX_BYTES = 200_000

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export class LinkPreviews {
  private db: DatabaseSync
  private read
  private write
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
    this.db.exec(`CREATE TABLE IF NOT EXISTS previews (
      url TEXT PRIMARY KEY,
      preview TEXT,
      fetched_at INTEGER NOT NULL
    )`)
    this.read = this.db.prepare('SELECT preview, fetched_at FROM previews WHERE url = ?')
    this.write = this.db.prepare('INSERT OR REPLACE INTO previews (url, preview, fetched_at) VALUES (?, ?, ?)')
  }

  /** The stored preview for a link (null until its page has answered), fetching it if it's due. */
  get(url: string): LinkPreview | null {
    if (!/^https?:\/\//i.test(url) || url.length > 2048) return null
    const row = this.stored(url)
    if (!row || Date.now() - row.fetchedAt > (row.preview ? FRESH_FOR : RETRY_AFTER)) this.request(url)
    return row?.preview ?? null
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      // already closed
    }
  }

  private stored(url: string): { preview: LinkPreview | null; fetchedAt: number } | null {
    try {
      const row = this.read.get(url) as { preview: string | null; fetched_at: number } | undefined
      return row ? { preview: row.preview ? (JSON.parse(row.preview) as LinkPreview) : null, fetchedAt: row.fetched_at } : null
    } catch (error) {
      console.warn('Couldn’t read a link preview', error)
      return null
    }
  }

  private request(url: string): void {
    if (this.loading.has(url) || this.queue.includes(url)) return
    this.queue.push(url)
    this.pump()
  }

  private pump(): void {
    while (this.loading.size < AT_ONCE && this.queue.length) {
      const url = this.queue.shift()!
      this.loading.add(url)
      void this.load(url)
        .catch(() => null)
        .then((preview) => {
          this.loading.delete(url)
          this.save(url, preview)
          this.pump()
        })
    }
  }

  private async load(url: string): Promise<LinkPreview> {
    const preview = await fetchPreview(url, this.fetch as never)
    return { ...preview, icon: preview.icon ? await this.iconData(preview.icon) : null }
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
      if (Number(res.headers.get('content-length') ?? 0) > ICON_MAX_BYTES) return null
      const bytes = Buffer.from(await res.arrayBuffer())
      return bytes.length && bytes.length <= ICON_MAX_BYTES ? `data:${type};base64,${bytes.toString('base64')}` : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  private save(url: string, preview: LinkPreview | null): void {
    // A page that was reachable before and isn't right now keeps its preview.
    const previous = preview ? null : this.stored(url)?.preview
    const kept = preview ?? previous ?? null
    try {
      this.write.run(url, kept ? JSON.stringify(kept) : null, Date.now())
    } catch (error) {
      console.warn('Couldn’t store a link preview', error)
    }
    this.onPreview(url, kept)
  }
}
