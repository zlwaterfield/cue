import type { Item } from '../../shared/types'
import type { Repository } from '../repository'

/**
 * Client side of the planned sync protocol (see docs/SYNC.md). Not wired to a real
 * server yet — the desktop MVP ships local-only — but the engine is complete and
 * exercised in tests against `MemorySyncServer`, which proves the repository can be
 * extended with a remote adapter without touching the editor.
 */

export interface PushResult {
  /** Versions the server has durably stored (or already had something newer for). */
  accepted: Array<{ id: string; version: string }>
}

export interface PullResult {
  records: Item[]
  cursor: string
  hasMore: boolean
}

/** The transport a real backend (HTTPS + auth) implements. */
export interface SyncTransport {
  push(deviceId: string, records: Item[]): Promise<PushResult>
  pull(cursor: string | null, limit: number): Promise<PullResult>
}

export type SyncStatus =
  | { state: 'idle'; lastSyncedAt: number | null }
  | { state: 'syncing' }
  | { state: 'offline'; retryAt: number }
  | { state: 'error'; message: string; retryAt: number }

export class SyncEngine {
  private running: Promise<void> | null = null
  private failures = 0
  status: SyncStatus = { state: 'idle', lastSyncedAt: null }

  constructor(
    private readonly repo: Repository,
    private readonly transport: SyncTransport,
    private readonly hooks: {
      onRemoteChanges?: (items: Item[]) => void
      onStatus?: (status: SyncStatus) => void
      now?: () => number
    } = {},
    private readonly batchSize = 200
  ) {}

  /** Push everything pending, then pull everything new. Safe to call repeatedly. */
  sync(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  private setStatus(status: SyncStatus): void {
    this.status = status
    this.hooks.onStatus?.(status)
  }

  private async run(): Promise<void> {
    const now = this.hooks.now ?? Date.now
    this.setStatus({ state: 'syncing' })
    try {
      await this.pushAll()
      await this.pullAll()
      this.failures = 0
      this.setStatus({ state: 'idle', lastSyncedAt: now() })
    } catch (error) {
      this.failures += 1
      // Exponential backoff with a ceiling; the pending queue is durable, so a
      // failed attempt loses nothing.
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.failures, 6))
      const message = error instanceof Error ? error.message : String(error)
      this.setStatus(
        /network|fetch|offline/i.test(message)
          ? { state: 'offline', retryAt: now() + delay }
          : { state: 'error', message, retryAt: now() + delay }
      )
      throw error
    }
  }

  private async pushAll(): Promise<void> {
    for (;;) {
      const pending = this.repo.pendingChanges(this.batchSize)
      if (!pending.length) return
      const { accepted } = await this.transport.push(this.repo.deviceId, pending)
      this.repo.acknowledge(accepted)
      if (accepted.length === 0) throw new Error('Server accepted no changes')
      if (pending.length < this.batchSize) return
    }
  }

  private async pullAll(): Promise<void> {
    for (;;) {
      const cursor = this.repo.getMeta('sync_cursor')
      const { records, cursor: next, hasMore } = await this.transport.pull(cursor, this.batchSize)
      const { applied } = this.repo.applyRemote(records)
      // The cursor only advances after the batch is durably merged.
      this.repo.setMeta('sync_cursor', next)
      if (applied.length) this.hooks.onRemoteChanges?.(applied)
      if (!hasMore) return
    }
  }
}
