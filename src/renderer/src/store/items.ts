import { buildOutline, type Row } from '@shared/outline'
import type { ISODate, Item } from '@shared/types'
import { backend, type Backend } from '../data/backend'

/**
 * In-memory item store for the days currently loaded in the renderer.
 *
 * Edits apply here synchronously (so typing never waits on anything) and are
 * written behind to the repository in small batches. Components subscribe per item
 * or per day so a keystroke re-renders exactly one row.
 */

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
    private readonly backend: Backend,
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
      await this.backend.saveItems(batch)
      this.failures = 0
      this.inflight = null
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

  /** Last-chance save while the window unloads. Re-sends any in-flight batch (saves are idempotent). */
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

  discard(ids: string[]): void {
    for (const id of ids) this.pending.delete(id)
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
  readonly persistence: PersistenceQueue

  constructor(private readonly backend: Backend) {
    this.persistence = new PersistenceQueue(backend)
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
   * Records written to the database by someone else (import today, sync later).
   * They already won in storage, so any older local snapshot still queued for those
   * items is dropped rather than written over them.
   */
  applyExternal(items: Item[]): void {
    this.persistence.discard(items.map((i) => i.id))
    this.ingest(items)
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

export const itemStore = new ItemStore(backend)
