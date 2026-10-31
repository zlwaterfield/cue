import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { openDatabaseSync } from 'expo-sqlite'
import { collectLinks, filterLinks, type LinkEntry } from '@shared/linkList'
import { fetchPage, type LinkPage, type LinkPreview } from '@shared/links'
import { repo } from './app'

/**
 * Previews for lines that are only a link, fetched once and kept on this phone. They're
 * a cache, not notes: they never sync.
 *
 * A preview is shown from the cache at once and refreshed in the background once it's
 * old. A page that couldn't be reached is tried again after a while; until then its line
 * shows the link's address.
 *
 * Each page also keeps what the Links list finds it by (`linkSearchText`). Links no line
 * has shown yet are read for that in the background (`fillLinks`), behind any preview a
 * line on screen is waiting for. The Mac does the same (`apps/desktop/src/main/links.ts`).
 */

const FRESH_FOR = 14 * 24 * 60 * 60_000
const RETRY_AFTER = 60 * 60_000
const FILL_RETRY_AFTER = 24 * 60 * 60_000
const AT_ONCE = 3

interface Entry {
  preview: LinkPreview | null
  fetchedAt: number
  failed: boolean
  /** What the Links list finds the page by; null until its page has been read for it. */
  search: string | null
}

const db = openDatabaseSync('links.sqlite')
db.execSync(`CREATE TABLE IF NOT EXISTS previews (
  url TEXT PRIMARY KEY,
  preview TEXT,
  fetched_at INTEGER NOT NULL
)`)
if ((db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0) < 1) {
  // Previews from before the Links list keep their icons; `fillLinks` reads their pages again.
  db.execSync(`ALTER TABLE previews ADD COLUMN failed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE previews ADD COLUMN search TEXT;
    PRAGMA user_version = 1;`)
}
const read = db.prepareSync('SELECT preview, fetched_at, failed, search FROM previews WHERE url = ?')
const write = db.prepareSync('INSERT OR REPLACE INTO previews (url, preview, fetched_at, failed, search) VALUES (?, ?, ?, ?, ?)')
const searchable = db.prepareSync('SELECT url, search FROM previews WHERE search IS NOT NULL')

const memory = new Map<string, Entry | null>()
const listeners = new Map<string, Set<() => void>>()
const queue: string[] = []
const loading = new Set<string>()

function stored(url: string): Entry | null {
  if (memory.has(url)) return memory.get(url)!
  let entry: Entry | null = null
  try {
    const result = read.executeSync<{ preview: string | null; fetched_at: number; failed: number; search: string | null }>([url])
    const row = result.getFirstSync()
    result.resetSync()
    if (row) {
      entry = {
        preview: row.preview ? (JSON.parse(row.preview) as LinkPreview) : null,
        fetchedAt: row.fetched_at,
        failed: !!row.failed,
        search: row.search
      }
    }
  } catch (error) {
    console.warn('Couldn’t read a link preview', error)
  }
  memory.set(url, entry)
  return entry
}

function due(entry: Entry | null): boolean {
  if (!entry) return true
  return Date.now() - entry.fetchedAt > (entry.preview && !entry.failed ? FRESH_FOR : RETRY_AFTER)
}

/** A line on screen waiting for its preview goes first (`soon`); filling in for search, last. */
function request(url: string, soon: boolean): void {
  if (loading.has(url)) return
  const queued = queue.indexOf(url)
  if (queued >= 0) {
    if (!soon) return
    queue.splice(queued, 1)
  }
  if (soon) queue.unshift(url)
  else queue.push(url)
  pump()
}

function pump(): void {
  while (loading.size < AT_ONCE && queue.length) {
    const url = queue.shift()!
    loading.add(url)
    void fetchPage(url, fetch as never)
      .then(
        (page) => page,
        () => null
      )
      .then((page) => {
        loading.delete(url)
        save(url, page)
        pump()
      })
  }
}

function save(url: string, page: LinkPage | null): void {
  const previous = stored(url)
  // A page that was reachable before and isn't right now keeps its preview, and what it's found by.
  const entry: Entry = {
    preview: page?.preview ?? previous?.preview ?? null,
    fetchedAt: Date.now(),
    failed: !page,
    search: page?.search ?? previous?.search ?? null
  }
  memory.set(url, entry)
  try {
    write.executeSync([url, entry.preview ? JSON.stringify(entry.preview) : null, entry.fetchedAt, entry.failed ? 1 : 0, entry.search]).resetSync()
  } catch (error) {
    console.warn('Couldn’t store a link preview', error)
  }
  for (const listener of listeners.get(url) ?? []) listener()
}

function subscribe(url: string, listener: () => void): () => void {
  let set = listeners.get(url)
  if (!set) listeners.set(url, (set = new Set()))
  set.add(listener)
  return () => {
    set.delete(listener)
    if (!set.size) listeners.delete(url)
  }
}

/** A link's preview, or null until (or unless) its page has one. */
export function useLinkPreview(url: string | null): LinkPreview | null {
  const sub = useCallback((listener: () => void) => (url ? subscribe(url, listener) : () => {}), [url])
  const preview = useSyncExternalStore(sub, () => (url ? (stored(url)?.preview ?? null) : null))
  useEffect(() => {
    if (url && due(stored(url))) request(url, true)
  }, [url])
  return preview
}

/**
 * Read the pages of links the Links list can't find by their page yet: never fetched, or
 * kept from before it existed. A page that didn't answer is left for a day.
 */
function fill(urls: string[]): void {
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url) || url.length > 2048) continue
    const entry = stored(url)
    if (entry && (entry.search !== null || (entry.failed && Date.now() - entry.fetchedAt < FILL_RETRY_AFTER))) continue
    request(url, false)
  }
}

/** Every link written, newest first, or those matching `query` by their line or their page. */
export function listLinks(query: string, limit = 1000): LinkEntry[] {
  const all = collectLinks(repo.linkLines())
  // Opening the list reads, in the background, the pages it can't find links by yet.
  if (!query.trim()) fill(all.map((l) => l.url))
  const pages = new Map<string, string>()
  try {
    const result = searchable.executeSync<{ url: string; search: string }>([])
    for (const row of result.getAllSync()) pages.set(row.url, row.search)
    result.resetSync()
  } catch (error) {
    console.warn('Couldn’t read what links are found by', error)
  }
  return filterLinks(all, query, (url) => pages.get(url), limit)
}

/**
 * Links written on the Mac, or before the Links list, are read for it a while after
 * launch, so searching them works before the list is ever opened.
 */
setTimeout(() => fill(collectLinks(repo.linkLines()).map((l) => l.url)), 30_000)
