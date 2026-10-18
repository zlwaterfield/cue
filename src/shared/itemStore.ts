import { buildOutline, type Row } from './outline'
import type { CueBridge, ISODate, Item } from './types'

/**
 * In-memory item store for the days currently loaded in the editor.
 *
 * Edits apply here synchronously (so typing never waits on anything) and are
 * written behind to the repository in small batches. Components subscribe per item
 * or per day so a keystroke re-renders exactly one row.
 */

/** Where the store reads and writes: the repository, over IPC on the Mac and in process on iPhone. */
export type StoreBackend = Pick<CueBridge, 'loadDates' | 'saveItems' | 'saveItemsSync'>

type Listener = () => void

function structurallyEqual(a: Item, b: Item): boolean {
  return a.date === b.date && a.parentId === b.parentId && a.position === b.position && a.deleted === b.deleted
}

export type SaveState = { state: 'saved' } | { state: 'pending' } | { state: 'error'; message: string }

/** Write-behind queue. Coalesces per item; retries with backoff; flushes synchronously on close. */
export class PersistenceQueue {
  private pending = new Map<string, Item>()
  private inflight: Item[] | null = null
  private inflightDone: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private failures = 0
  private listeners = new Set<Listener>()
  status: SaveState = { state: 'saved' }

  constructor(
    private readonly backend: StoreBackend,
    /** Called when a batch is stored, with the version stored for each item that changed. */
    private readonly onSaved: (batch: Item[], versions: Map<string, string>) => void = () => {},
    private readonly delay = 40
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setStatus(status: SaveState): void {
    if (status.state === this.status.state && status.state !== 'error') return
    this.status = status
    for (const l of this.listeners) l()
  }

  enqueue(items: Item[]): void {
    for (const item of items) this.pending.set(item.id, item)
    if (this.status.state === 'saved') this.setStatus({ state: 'pending' })
    this.schedule(this.delay)
  }

  private schedule(delay: number): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delay)
  }

  async flush(): Promise<void> {
    if (this.inflight || !this.pending.size) return
    const batch = [...this.pending.values()]
    this.pending.clear()
    this.inflight = batch
    let done!: () => void
    this.inflightDone = new Promise((resolve) => (done = resolve))
    try {
      const saved = await this.backend.saveItems(batch)
      this.failures = 0
      this.inflight = null
      this.onSaved(batch, new Map(saved.map((s) => [s.id, s.version])))
      if (this.pending.size) this.schedule(this.delay)
      else this.setStatus({ state: 'saved' })
    } catch (error) {
      this.inflight = null
      // Re-queue anything not superseded by a newer edit, then back off.
      for (const item of batch) if (!this.pending.has(item.id)) this.pending.set(item.id, item)
      this.failures += 1
      this.setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) })
      this.schedule(Math.min(30_000, 250 * 2 ** this.failures))
    } finally {
      this.inflightDone = null
      done()
    }
  }

  /**
   * Resolve once everything edited so far is in the database (or has failed and
   * is queued for retry). Used before reading from storage, e.g. search.
   */
  async settle(): Promise<void> {
    for (let i = 0; i < 5 && (this.inflight || this.pending.size); i++) {
      if (this.inflightDone) await this.inflightDone
      if (this.pending.size && this.status.state !== 'error') {
        if (this.timer) {
          clearTimeout(this.timer)
          this.timer = null
        }
        await this.flush()
      } else if (!this.inflightDone) return
    }
  }

  /** Last-chance save while the app closes. Re-sends any in-flight batch (saves are idempotent). */
  flushSync(): void {
    const batch = new Map<string, Item>()
    for (const item of this.inflight ?? []) batch.set(item.id, item)
    for (const item of this.pending.values()) batch.set(item.id, item)
    if (!batch.size) return
    this.pending.clear()
    try {
      this.backend.saveItemsSync([...batch.values()])
    } catch (error) {
      console.error('Final save failed', error)
    }
  }

  /** Drop edits not yet stored (the account they belong to is being removed). */
  discard(): void {
    this.pending.clear()
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.setStatus({ state: 'saved' })
  }

  /** An edit to this item is waiting to be sent to storage. */
  isPending(id: string): boolean {
    return this.pending.has(id)
  }

  /** An edit to this item is on its way to storage right now. */
  isInflight(id: string): boolean {
    return !!this.inflight?.some((item) => item.id === id)
  }

  hasPending(): boolean {
    return this.pending.size > 0 || this.inflight !== null
  }
}

export class ItemStore {
  private items = new Map<string, Item>()
  private byDate = new Map<ISODate, Set<string>>()
  private outlines = new Map<ISODate, Row[]>()
  private loaded = new Set<ISODate>()
  private loading = new Map<ISODate, Promise<void>>()
  private itemListeners = new Map<string, Set<Listener>>()
  private dateListeners = new Map<ISODate, Set<Listener>>()
  /** Records from elsewhere that arrived while a local save of the same item was in flight. */
  private racing = new Map<string, Item>()
  readonly persistence: PersistenceQueue

  constructor(private readonly backend: StoreBackend) {
    this.persistence = new PersistenceQueue(backend, (batch, versions) => this.settleRaces(batch, versions))
  }

  /* ---------------------------------------------------------------- Queries */

  get(id: string): Item | undefined {
    return this.items.get(id)
  }

  isLoaded(date: ISODate): boolean {
    return this.loaded.has(date)
  }

  itemsOn(date: ISODate): Item[] {
    const ids = this.byDate.get(date)
    if (!ids) return []
    const out: Item[] = []
    for (const id of ids) {
      const item = this.items.get(id)
      if (item) out.push(item)
    }
    return out
  }

  outline(date: ISODate): Row[] {
    let rows = this.outlines.get(date)
    if (!rows) {
      rows = buildOutline(this.itemsOn(date))
      this.outlines.set(date, rows)
    }
    return rows
  }

  /* ---------------------------------------------------------- Subscriptions */

  subscribeItem(id: string, listener: Listener): () => void {
    let set = this.itemListeners.get(id)
    if (!set) this.itemListeners.set(id, (set = new Set()))
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (!set!.size) this.itemListeners.delete(id)
    }
  }

  subscribeDate(date: ISODate, listener: Listener): () => void {
    let set = this.dateListeners.get(date)
    if (!set) this.dateListeners.set(date, (set = new Set()))
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (!set!.size) this.dateListeners.delete(date)
    }
  }

  /* ---------------------------------------------------------------- Loading */

  async ensureLoaded(dates: ISODate[]): Promise<void> {
    const waits: Promise<void>[] = []
    const missing: ISODate[] = []
    for (const date of new Set(dates)) {
      if (this.loaded.has(date)) continue
      const inFlight = this.loading.get(date)
      if (inFlight) waits.push(inFlight)
      else missing.push(date)
    }
    if (missing.length) {
      const request = this.backend.loadDates(missing).then(
        (items) => {
          for (const date of missing) {
            this.loaded.add(date)
            this.loading.delete(date)
          }
          // Local edits made while loading (rare) take precedence over stored rows.
          this.ingest(items.filter((i) => !this.items.has(i.id)), missing)
        },
        (error) => {
          // Let a later navigation try again.
          for (const date of missing) this.loading.delete(date)
          throw error
        }
      )
      for (const date of missing) this.loading.set(date, request)
      waits.push(request)
    }
    await Promise.all(waits)
  }

  /**
   * Merge records that did not originate from this editor (initial load, import,
   * future sync). Not undoable and not re-persisted.
   */
  ingest(items: Item[], touchedDates: ISODate[] = []): void {
    const dirtyDates = new Set<ISODate>(touchedDates)
    const dirtyItems = new Set<string>()
    for (const item of items) {
      const prev = this.items.get(item.id)
      if (prev) {
        this.removeFromIndex(prev)
        dirtyDates.add(prev.date)
      }
      if (!item.deleted && this.loaded.has(item.date)) {
        this.items.set(item.id, item)
        this.addToIndex(item)
        dirtyDates.add(item.date)
      } else {
        this.items.delete(item.id)
      }
      dirtyItems.add(item.id)
    }
    this.notify(dirtyItems, dirtyDates)
  }

  /**
   * Records written to the database by someone else (sync, import). An item with an
   * unsent edit keeps it: that edit will be stored with a newer version and win
   * everywhere, so what's under the caret never changes as you type. If the edit is
   * already in flight, the stored version decides once the save returns.
   */
  applyExternal(items: Item[]): void {
    const apply: Item[] = []
    for (const item of items) {
      if (this.persistence.isPending(item.id)) continue
      if (this.persistence.isInflight(item.id)) this.racing.set(item.id, item)
      else apply.push(item)
    }
    this.ingest(apply)
  }

  private settleRaces(batch: Item[], versions: Map<string, string>): void {
    if (!this.racing.size) return
    const apply: Item[] = []
    for (const { id } of batch) {
      const remote = this.racing.get(id)
      if (!remote) continue
      this.racing.delete(id)
      // The remote record won in storage unless our save stored something newer.
      const stored = versions.get(id)
      if (!this.persistence.isPending(id) && (!stored || stored < remote.version)) apply.push(remote)
    }
    this.ingest(apply)
  }

  /** Forget everything in memory, e.g. when an account signs out and its notes leave the device. */
  reset(): void {
    const items = new Set(this.items.keys())
    const dates = new Set([...this.loaded, ...this.byDate.keys()])
    this.persistence.discard()
    this.items.clear()
    this.byDate.clear()
    this.loaded.clear()
    this.loading.clear()
    this.racing.clear()
    this.notify(items, dates)
  }

  /* ---------------------------------------------------------------- Writes */

  /** Apply local edits: update memory, notify subscribers, queue for persistence. */
  commit(changes: Item[]): void {
    if (!changes.length) return
    const dirtyDates = new Set<ISODate>()
    const dirtyItems = new Set<string>()
    for (const next of changes) {
      const prev = this.items.get(next.id)
      if (prev && !structurallyEqual(prev, next)) {
        this.removeFromIndex(prev)
        dirtyDates.add(prev.date)
      }
      if (next.deleted) {
        if (prev) this.removeFromIndex(prev)
        this.items.delete(next.id)
        dirtyDates.add(next.date)
      } else {
        // Indexed even if the day isn't loaded yet; loading never overwrites local edits.
        this.items.set(next.id, next)
        if (!prev || !structurallyEqual(prev, next)) {
          this.addToIndex(next)
          dirtyDates.add(next.date)
        }
      }
      dirtyItems.add(next.id)
    }
    this.persistence.enqueue(changes)
    this.notify(dirtyItems, dirtyDates)
  }

  private addToIndex(item: Item): void {
    let set = this.byDate.get(item.date)
    if (!set) this.byDate.set(item.date, (set = new Set()))
    set.add(item.id)
  }

  private removeFromIndex(item: Item): void {
    this.byDate.get(item.date)?.delete(item.id)
  }

  private notify(items: Set<string>, dates: Set<ISODate>): void {
    for (const date of dates) this.outlines.delete(date)
    for (const id of items) for (const l of this.itemListeners.get(id) ?? []) l()
    for (const date of dates) for (const l of this.dateListeners.get(date) ?? []) l()
  }
}
