import type { Item } from '../../shared/types'
import type { PullResult, PushResult, SyncTransport } from './engine'

/**
 * Reference implementation of the server half of the sync protocol, in memory.
 * A production server (docs/SYNC.md) implements exactly this logic over Postgres:
 *
 *  - one row per item, replaced only by a strictly newer version (LWW)
 *  - a monotonically increasing sequence number per accepted write
 *  - pull(cursor) returns current rows whose sequence is greater than the cursor
 */
export class MemorySyncServer {
  private rows = new Map<string, { record: Item; seq: number }>()
  private seq = 0
  online = true

  transport(): SyncTransport {
    return {
      push: async (_deviceId, records) => this.push(records),
      pull: async (cursor, limit) => this.pull(cursor, limit)
    }
  }

  push(records: Item[]): PushResult {
    if (!this.online) throw new Error('network unavailable')
    const accepted: PushResult['accepted'] = []
    for (const record of records) {
      const existing = this.rows.get(record.id)
      if (!existing || record.version > existing.record.version) {
        this.seq += 1
        this.rows.set(record.id, { record: { ...record }, seq: this.seq })
      }
      // Accepted either way: the server now holds this version or a newer one.
      accepted.push({ id: record.id, version: record.version })
    }
    return { accepted }
  }

  pull(cursor: string | null, limit: number): PullResult {
    if (!this.online) throw new Error('network unavailable')
    const after = cursor ? Number(cursor) : 0
    const changed = [...this.rows.values()].filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq)
    const page = changed.slice(0, limit)
    const last = page.length ? page[page.length - 1].seq : after
    return { records: page.map((r) => ({ ...r.record })), cursor: String(last), hasMore: changed.length > limit }
  }

  snapshot(): Item[] {
    return [...this.rows.values()].map((r) => r.record)
  }
}
