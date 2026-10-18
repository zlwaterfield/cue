import type { Item } from '../../shared/types'
import { OfflineError, type PullResult, type PushResult, type SyncTransport } from './engine'

/**
 * The server half of the sync protocol, in memory, for tests. It mirrors
 * `sync_push` and `sync_pull` in supabase/migrations exactly:
 *
 *  - one row per item, replaced only by a strictly newer version (LWW)
 *  - every accepted write gets the next sequence number
 *  - pull(since) returns current rows whose sequence is greater than `since`
 */
export class MemorySyncServer {
  private rows = new Map<string, { record: Item; seq: number }>()
  private seq = 0
  private listeners = new Set<(seq: number) => void>()
  online = true
  requests = 0

  transport(): SyncTransport {
    return {
      push: async (records) => this.push(records),
      pull: async (since, limit) => this.pull(since, limit)
    }
  }

  /** Realtime hints: called with the latest seq after every push that changed something. */
  subscribe(listener: (seq: number) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  push(records: Item[]): PushResult {
    this.request()
    const before = this.seq
    for (const record of records) {
      const existing = this.rows.get(record.id)
      if (!existing || record.version > existing.record.version) {
        this.seq += 1
        this.rows.set(record.id, { record: { ...record }, seq: this.seq })
      }
    }
    const after = this.seq
    if (after > before) for (const listener of this.listeners) listener(after)
    return { before, after }
  }

  pull(since: number, limit: number): PullResult {
    this.request()
    const changed = [...this.rows.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq)
    const page = changed.slice(0, limit)
    return {
      records: page.map((r) => ({ ...r.record })),
      cursor: page.length ? page[page.length - 1].seq : since,
      hasMore: changed.length > limit
    }
  }

  /** Forget everything, as if restored from an empty backup. */
  reset(): void {
    this.rows.clear()
    this.seq = 0
  }

  snapshot(): Item[] {
    return [...this.rows.values()].map((r) => r.record)
  }

  private request(): void {
    this.requests += 1
    if (!this.online) throw new OfflineError('network unavailable')
  }
}
