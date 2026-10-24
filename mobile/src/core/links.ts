import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { openDatabaseSync } from 'expo-sqlite'
import { fetchPreview, type LinkPreview } from '@shared/links'

/**
 * Previews for lines that are only a link, fetched once and kept on this phone. They're
 * a cache, not notes: they never sync.
 *
 * A preview is shown from the cache at once and refreshed in the background once it's
 * old. A page that couldn't be reached is tried again after a while; until then its line
 * shows the link's address.
 */

const FRESH_FOR = 14 * 24 * 60 * 60_000
const RETRY_AFTER = 60 * 60_000
const AT_ONCE = 3

interface Entry {
  preview: LinkPreview | null
  fetchedAt: number
}

const db = openDatabaseSync('links.sqlite')
db.execSync(`CREATE TABLE IF NOT EXISTS previews (
  url TEXT PRIMARY KEY,
  preview TEXT,
  fetched_at INTEGER NOT NULL
)`)
const read = db.prepareSync('SELECT preview, fetched_at FROM previews WHERE url = ?')
const write = db.prepareSync('INSERT OR REPLACE INTO previews (url, preview, fetched_at) VALUES (?, ?, ?)')

const memory = new Map<string, Entry | null>()
const listeners = new Map<string, Set<() => void>>()
const queue: string[] = []
const loading = new Set<string>()

function stored(url: string): Entry | null {
  if (memory.has(url)) return memory.get(url)!
  let entry: Entry | null = null
  try {
    const result = read.executeSync<{ preview: string | null; fetched_at: number }>([url])
    const row = result.getFirstSync()
    result.resetSync()
    if (row) entry = { preview: row.preview ? (JSON.parse(row.preview) as LinkPreview) : null, fetchedAt: row.fetched_at }
  } catch (error) {
    console.warn('Couldn’t read a link preview', error)
  }
  memory.set(url, entry)
  return entry
}

function due(entry: Entry | null): boolean {
  if (!entry) return true
  return Date.now() - entry.fetchedAt > (entry.preview ? FRESH_FOR : RETRY_AFTER)
}

function request(url: string): void {
  if (loading.has(url) || queue.includes(url)) return
  queue.push(url)
  pump()
}

function pump(): void {
  while (loading.size < AT_ONCE && queue.length) {
    const url = queue.shift()!
    loading.add(url)
    void fetchPreview(url, fetch as never)
      .then(
        (preview) => preview,
        () => null
      )
      .then((preview) => {
        loading.delete(url)
        save(url, preview)
        pump()
      })
  }
}

function save(url: string, preview: LinkPreview | null): void {
  const previous = memory.get(url)
  // A page that was reachable before and isn't right now keeps its preview.
  const entry: Entry = { preview: preview ?? previous?.preview ?? null, fetchedAt: Date.now() }
  memory.set(url, entry)
  try {
    write.executeSync([url, entry.preview ? JSON.stringify(entry.preview) : null, entry.fetchedAt]).resetSync()
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
    if (url && due(stored(url))) request(url)
  }, [url])
  return preview
}
