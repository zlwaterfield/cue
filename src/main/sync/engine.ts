import type { Item } from '../../shared/types'
import type { Repository } from '../repository'

/**
 * The client half of the sync protocol (docs/SYNC.md): push the outbox, then pull
 * everything newer than a durable cursor. It knows nothing about Supabase; the
 * transport does. Tests run it against `MemorySyncServer`.
 *
 * It's built to stay out of the way. Runs are single-flight. Local edits are batched
 * into one push shortly after typing pauses. Remote rows are merged in small
 * transactions that yield between batches, so saves from the editor are never stuck
 * behind a large download. Every failure is retried with backoff, and nothing is lost
 * because the outbox and cursor live in SQLite.
 */

export interface PushResult {
  /** The account's highest seq before and after this push. */
  before: number
  after: number
}

export interface PullResult {
  records: Item[]
  cursor: number
  hasMore: boolean
}

export interface SyncTransport {
  /** Store records, newest version wins. Every record counts as accepted unless this throws. */
  push(records: Item[]): Promise<PushResult>
  /** Records changed after `since`, oldest first. */
  pull(since: number, limit: number): Promise<PullResult>
}

/** The server couldn't be reached. Shown as "Offline" rather than as an error. */
export class OfflineError extends Error {}

export type EngineStatus = 'idle' | 'syncing' | 'offline' | 'error'

export interface EngineHooks {
  /** Records from other devices, after they're stored. */
  onRemoteChanges?: (items: Item[]) => void
  onStatus?: (status: EngineStatus, error: Error | null) => void
}

export interface EngineTiming {
  /** Quiet period after a local edit before pushing, so a burst of typing is one request. */
  debounce: number
  /** Push at least this often during continuous typing. */
  maxWait: number
  /** First retry after a failure; doubles up to `maxBackoff`. */
  backoff: number
  maxBackoff: number
  /** Safety-net pull in case a realtime hint was missed. */
  poll: number
  batchSize: number
}

const DEFAULT_TIMING: EngineTiming = {
  debounce: 600,
  maxWait: 3000,
  backoff: 1000,
  maxBackoff: 60_000,
  poll: 5 * 60_000,
  batchSize: 500
}

const CURSOR = 'sync_cursor'

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

export class SyncEngine {
  private readonly timing: EngineTiming
  private active: Promise<void> | null = null
  private next: Promise<void> | null = null
  private pushTimer: NodeJS.Timeout | null = null
  private burstStartedAt: number | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private needsPull = true
  private hintSeq = 0
  private failures = 0
  private stopped = false
  status: EngineStatus = 'idle'
  lastSyncedAt: number | null = null

  constructor(
    private readonly repo: Repository,
    private readonly transport: SyncTransport,
    private readonly hooks: EngineHooks = {},
    timing: Partial<EngineTiming> = {}
  ) {
    this.timing = { ...DEFAULT_TIMING, ...timing }
  }

  /** Begin syncing: once now, then on every trigger until `stop`. */
  start(): void {
    this.stopped = false
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => this.remoteChange(), this.timing.poll)
    void this.sync().catch(() => {})
  }

  /** Stop scheduling and wait for any run in progress. Pending changes stay queued. */
  async stop(): Promise<void> {
    this.stopped = true
    for (const timer of [this.pushTimer, this.retryTimer]) if (timer) clearTimeout(timer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pushTimer = this.retryTimer = this.pollTimer = null
    this.burstStartedAt = null
    await Promise.allSettled([this.active, this.next])
  }

  /** A local edit was saved. Pushes once typing pauses, or after `maxWait` at the latest. */
  localChange(): void {
    // While failing, the retry timer owns the schedule; typing shouldn't add requests.
    if (this.stopped || this.failures > 0) return
    const now = Date.now()
    this.burstStartedAt ??= now
    const delay = Math.max(0, Math.min(this.timing.debounce, this.burstStartedAt + this.timing.maxWait - now))
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      this.burstStartedAt = null
      void this.execute().catch(() => {})
    }, delay)
  }

  /**
   * Something may have changed on the server. With a `seq` (a realtime hint), pull
   * only if it's past our cursor; our own pushes echo back and are skipped this way.
   * Without one (reconnect, periodic check), pull to be sure.
   */
  remoteChange(seq?: number): void {
    if (this.stopped) return
    if (seq === undefined) this.needsPull = true
    else if (seq > this.cursor()) this.hintSeq = Math.max(this.hintSeq, seq)
    else return
    void this.execute().catch(() => {})
  }

  /**
   * Push and pull now, after any run in progress. Resolves when done, rejects if it
   * failed (a retry is already scheduled). Also used for "Sync Now", wake, and focus.
   */
  sync(): Promise<void> {
    this.needsPull = true
    this.failures = 0
    return this.execute()
  }

  /** Push pending changes now (pulling only if a hint is waiting). */
  flush(): Promise<void> {
    this.failures = 0
    return this.execute()
  }

  /** Single flight: one run at a time, and requests made during a run share one follow-up. */
  private execute(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (!this.active) {
      // Claim the slot before the run starts, so a trigger fired from inside it
      // (e.g. a hint delivered during the push) queues behind it instead of racing it.
      this.active = Promise.resolve()
        .then(() => this.run())
        .finally(() => (this.active = null))
      return this.active
    }
    this.next ??= this.active
      .catch(() => {})
      .then(() => {
        this.next = null
        return this.execute()
      })
    return this.next
  }

  private async run(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    // Retries keep showing "offline" or "error" until one succeeds, rather than flickering.
    if (this.status === 'idle') this.setStatus('syncing', null)
    try {
      await this.pushAll()
      if (this.needsPull || this.hintSeq > this.cursor()) {
        this.needsPull = false
        await this.pullAll()
      }
      this.failures = 0
      this.lastSyncedAt = Date.now()
      this.setStatus('idle', null)
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught))
      this.needsPull = true
      this.failures += 1
      this.setStatus(error instanceof OfflineError ? 'offline' : 'error', error)
      if (!this.stopped) {
        const base = Math.min(this.timing.maxBackoff, this.timing.backoff * 2 ** (this.failures - 1))
        // Jitter so devices that lost the network together don't retry in lockstep.
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null
          void this.execute().catch(() => {})
        }, base * (0.75 + Math.random() * 0.5))
      }
      throw error
    }
  }

  private async pushAll(): Promise<void> {
    for (;;) {
      const batch = this.repo.pendingChanges(this.timing.batchSize)
      if (!batch.length) return
      const cursor = this.cursor()
      const { before, after } = await this.transport.push(batch)
      // Only the versions that were sent are acknowledged; edits made meanwhile stay queued.
      this.repo.acknowledge(batch)
      if (after < cursor) {
        // The server has less than we've already seen: it was reset or restored.
        // Start over so both sides end up with everything.
        this.repo.queueAll()
        this.repo.setMeta(CURSOR, '0')
        this.needsPull = true
        continue
      }
      if (before === cursor) {
        // Nothing arrived from other devices since our last pull, so everything up to
        // `after` is what we just sent. Skip pulling our own changes back.
        this.repo.setMeta(CURSOR, String(after))
      } else {
        this.needsPull = true
      }
      if (batch.length < this.timing.batchSize) return
      await yieldToEventLoop()
    }
  }

  private async pullAll(): Promise<void> {
    for (;;) {
      const { records, cursor, hasMore } = await this.transport.pull(this.cursor(), this.timing.batchSize)
      const { applied } = this.repo.applyRemote(records)
      // The cursor only advances once the batch is stored.
      this.repo.setMeta(CURSOR, String(cursor))
      if (applied.length) this.hooks.onRemoteChanges?.(applied)
      if (!hasMore) return
      await yieldToEventLoop()
    }
  }

  private cursor(): number {
    return Number(this.repo.getMeta(CURSOR) ?? 0)
  }

  private setStatus(status: EngineStatus, error: Error | null): void {
    if (status === this.status && !error) return
    this.status = status
    this.hooks.onStatus?.(status, error)
  }
}
