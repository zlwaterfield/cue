import { isISODate } from './dates'
import { HybridLogicalClock, parseVersion } from './hlc'
import { transaction, type SqlDatabase, type SqlStatement } from './sqlite'
import { fold, searchTerms } from './text'
import { DEFAULT_SETTINGS, ITEM_TYPES, type ISODate, type Item, type SearchResult, type Settings } from './types'

/**
 * The storage boundary. The editor never touches SQL; it reads and writes whole
 * item records through this repository (over IPC on the Mac, directly on iPhone).
 * Everything sync needs lives here:
 *
 *  - every local write is stamped with a hybrid-logical-clock `version`
 *  - every local write is recorded in the `outbox` in the same transaction
 *  - deletions are tombstones, never row removals
 *  - `applyRemote` merges records from elsewhere with deterministic last-write-wins
 *
 * A sync engine is therefore a loop of `pendingChanges` → push → `acknowledge`, and
 * pull → `applyRemote`. See docs/SYNC.md.
 */

interface ItemRow {
  id: string
  date: string
  parent_id: string | null
  position: string
  type: string
  text: string
  done: number
  created_at: number
  updated_at: number
  deleted: number
  version: string
}

const COLUMNS = 'id, date, parent_id, position, type, text, done, created_at, updated_at, deleted, version'
const MAX_TEXT = 100_000

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    date: row.date,
    parentId: row.parent_id,
    position: row.position,
    type: row.type as Item['type'],
    text: row.text,
    done: row.done === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
    version: row.version
  }
}

export class ValidationError extends Error {}

/** 64 random bits in base 36: the HLC node id that keeps this device's versions unique. */
function newDeviceId(): string {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return BigInt('0x' + hex).toString(36).padStart(13, '0')
}

/** Normalize and validate a record arriving from the renderer, an import, or a peer. */
export function validateItem(input: unknown): Item {
  const value = input as Partial<Item> | null
  if (!value || typeof value !== 'object') throw new ValidationError('Item must be an object')
  const { id, date, parentId, position, type, text, done, createdAt, updatedAt, deleted, version } = value
  if (typeof id !== 'string' || id.length < 1 || id.length > 100) throw new ValidationError('Invalid item id')
  if (!isISODate(date)) throw new ValidationError(`Invalid date for item ${id}`)
  if (parentId !== null && parentId !== undefined && (typeof parentId !== 'string' || parentId === id)) {
    throw new ValidationError(`Invalid parent for item ${id}`)
  }
  if (typeof position !== 'string' || position.length < 1 || position.length > 200) {
    throw new ValidationError(`Invalid position for item ${id}`)
  }
  if (!ITEM_TYPES.includes(type as Item['type'])) throw new ValidationError(`Invalid type for item ${id}`)
  if (typeof text !== 'string') throw new ValidationError(`Invalid text for item ${id}`)
  const now = Date.now()
  return {
    id,
    date,
    parentId: parentId ?? null,
    position,
    type: type as Item['type'],
    text: text.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT),
    done: done === true,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : now,
    updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : now,
    deleted: deleted === true,
    version: typeof version === 'string' ? version : ''
  }
}

function sameContent(a: Item, b: Item): boolean {
  return (
    a.date === b.date &&
    a.parentId === b.parentId &&
    a.position === b.position &&
    a.type === b.type &&
    a.text === b.text &&
    a.done === b.done &&
    a.deleted === b.deleted
  )
}

/** Whether `next` changes only the text of `existing`, as typing does. Sync waits for typing to pause. */
export function isTextOnlyChange(existing: Item, next: Item): boolean {
  return (
    existing.date === next.date &&
    existing.parentId === next.parentId &&
    existing.position === next.position &&
    existing.type === next.type &&
    existing.done === next.done &&
    existing.deleted === next.deleted
  )
}

export interface RepositoryOptions {
  clock?: () => number
}

export class Repository {
  readonly deviceId: string
  private readonly hlc: HybridLogicalClock
  private readonly clock: () => number
  private readonly stmts: {
    get: SqlStatement
    upsert: SqlStatement
    outboxPut: SqlStatement
    outboxDelete: SqlStatement
    outboxAck: SqlStatement
    outboxCount: SqlStatement
    metaGet: SqlStatement
    metaPut: SqlStatement
    metaDelete: SqlStatement
    range: SqlStatement
    dates: SqlStatement
    openTodoDates: SqlStatement
  }

  constructor(
    private readonly db: SqlDatabase,
    options: RepositoryOptions = {}
  ) {
    this.clock = options.clock ?? Date.now
    this.stmts = {
      get: db.prepare(`SELECT ${COLUMNS} FROM items WHERE id = ?`),
      upsert: db.prepare(`
        INSERT INTO items (${COLUMNS}, search_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          date = excluded.date,
          parent_id = excluded.parent_id,
          position = excluded.position,
          type = excluded.type,
          text = excluded.text,
          done = excluded.done,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted = excluded.deleted,
          version = excluded.version,
          search_text = excluded.search_text
      `),
      outboxPut: db.prepare(
        'INSERT INTO outbox (item_id, version) VALUES (?, ?) ON CONFLICT (item_id) DO UPDATE SET version = excluded.version'
      ),
      outboxDelete: db.prepare('DELETE FROM outbox WHERE item_id = ?'),
      outboxAck: db.prepare('DELETE FROM outbox WHERE item_id = ? AND version = ?'),
      outboxCount: db.prepare('SELECT count(*) AS n FROM outbox'),
      metaGet: db.prepare('SELECT value FROM meta WHERE key = ?'),
      metaPut: db.prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
      ),
      metaDelete: db.prepare('DELETE FROM meta WHERE key = ?'),
      range: db.prepare(
        `SELECT ${COLUMNS} FROM items WHERE deleted = 0 AND date >= ? AND date <= ? ORDER BY date, position, id`
      ),
      dates: db.prepare('SELECT DISTINCT date FROM items WHERE deleted = 0 AND date >= ? AND date <= ? ORDER BY date'),
      openTodoDates: db.prepare(
        "SELECT DISTINCT date FROM items WHERE deleted = 0 AND type = 'todo' AND done = 0 AND date >= ? AND date <= ? ORDER BY date"
      )
    }

    let deviceId = this.getMeta('device_id')
    if (!deviceId) {
      deviceId = newDeviceId()
      this.setMeta('device_id', deviceId)
    }
    this.deviceId = deviceId
    this.hlc = new HybridLogicalClock(deviceId, this.clock)
    this.hlc.observe(this.getMeta('hlc'))
    const max = db.prepare('SELECT max(version) AS v FROM items').get() as { v: string | null }
    this.hlc.observe(max.v)
  }

  /* ------------------------------------------------------------------ Reads */

  get(id: string): Item | null {
    const row = this.stmts.get.get(id) as ItemRow | undefined
    return row ? toItem(row) : null
  }

  loadDates(dates: ISODate[]): Item[] {
    const valid = [...new Set(dates)].filter(isISODate)
    if (!valid.length) return []
    const out: Item[] = []
    // Chunk to stay well inside SQLite's bound-parameter limit.
    for (let i = 0; i < valid.length; i += 200) {
      const chunk = valid.slice(i, i + 200)
      const rows = this.db
        .prepare(
          `SELECT ${COLUMNS} FROM items WHERE deleted = 0 AND date IN (${chunk.map(() => '?').join(',')})`
        )
        .all(...chunk) as unknown as ItemRow[]
      for (const row of rows) out.push(toItem(row))
    }
    return out
  }

  loadRange(from: ISODate, to: ISODate): Item[] {
    return (this.stmts.range.all(from, to) as unknown as ItemRow[]).map(toItem)
  }

  datesWithItems(from: ISODate, to: ISODate): ISODate[] {
    return (this.stmts.dates.all(from, to) as Array<{ date: string }>).map((r) => r.date)
  }

  /** Days in the range with an unfinished to-do, oldest first. */
  datesWithOpenTodos(from: ISODate, to: ISODate): ISODate[] {
    return (this.stmts.openTodoDates.all(from, to) as Array<{ date: string }>).map((r) => r.date)
  }

  /** All rows, optionally including tombstones, ordered for export. */
  allItems(options: { includeDeleted?: boolean } = {}): Item[] {
    const where = options.includeDeleted ? '' : 'WHERE deleted = 0'
    return (
      this.db.prepare(`SELECT ${COLUMNS} FROM items ${where} ORDER BY date, position, id`).all() as unknown as ItemRow[]
    ).map(toItem)
  }

  /** Case- and accent-insensitive search; every term must appear. Newest days first. */
  search(query: string, limit = 50): SearchResult[] {
    const terms = searchTerms(query)
    if (!terms.length) return []
    const where = terms.map(() => 'instr(search_text, ?) > 0').join(' AND ')
    const rows = this.db
      .prepare(
        `SELECT id, date, type, done, text FROM items WHERE deleted = 0 AND ${where}
         ORDER BY date DESC, position, id LIMIT ?`
      )
      .all(...terms, Math.max(1, Math.min(limit, 500))) as Array<{
      id: string
      date: string
      type: string
      done: number
      text: string
    }>
    return rows.map((r) => ({ id: r.id, date: r.date, type: r.type as Item['type'], done: r.done === 1, text: r.text }))
  }

  /* ----------------------------------------------------------------- Writes */

  /**
   * Persist local edits. Each changed record is stamped with a new version and
   * queued in the outbox, atomically. Unchanged records are ignored so re-saves
   * don't generate sync traffic.
   */
  saveItems(inputs: unknown[]): Item[] {
    // Validate per record: one malformed item must never block every other save.
    const items: Item[] = []
    for (const input of inputs) {
      try {
        items.push(validateItem(input))
      } catch (error) {
        console.error('Skipping invalid item', error instanceof Error ? error.message : error)
      }
    }
    if (!items.length) return []
    return transaction(this.db, () => {
      const saved: Item[] = []
      let lastVersion: string | null = null
      for (const input of items) {
        const existing = this.get(input.id)
        if (existing && sameContent(existing, input)) continue
        const version = this.hlc.now()
        const item: Item = {
          ...input,
          createdAt: existing ? existing.createdAt : input.createdAt,
          updatedAt: this.clock(),
          version
        }
        this.write(item)
        this.stmts.outboxPut.run(item.id, version)
        saved.push(item)
        lastVersion = version
      }
      if (lastVersion) this.setMeta('hlc', lastVersion)
      return saved
    })
  }

  /**
   * Merge records from another replica (sync pull, backup import). A record wins
   * only if its version is newer than the stored one, so applying the same batch
   * twice, or applying an old backup, can never duplicate, revert, or resurrect.
   *
   * Records pulled from the sync server are already there, so they leave the outbox.
   * Records from anywhere else (`upload: true`, e.g. an imported backup) join it so
   * they reach the server too.
   */
  applyRemote(inputs: unknown[], options: { upload?: boolean } = {}): { applied: Item[]; skipped: number } {
    const applied: Item[] = []
    let skipped = 0
    let newest: string | null = null
    transaction(this.db, () => {
      for (const input of inputs) {
        let record: Item
        try {
          record = validateItem(input)
        } catch {
          skipped += 1
          continue
        }
        // A malformed version could sort above every real one and pin the item forever.
        if (!parseVersion(record.version)) {
          skipped += 1
          continue
        }
        const existing = this.get(record.id)
        if (existing && existing.version >= record.version) {
          skipped += 1
          continue
        }
        this.write(record)
        if (options.upload) this.stmts.outboxPut.run(record.id, record.version)
        else this.stmts.outboxDelete.run(record.id)
        this.hlc.receive(record.version)
        applied.push(record)
        if (!newest || record.version > newest) newest = record.version
      }
      const stored = this.getMeta('hlc')
      if (newest && (!stored || newest > stored)) this.setMeta('hlc', newest)
    })
    return { applied, skipped }
  }

  /** Local changes awaiting upload. */
  pendingChanges(limit = 500): Item[] {
    return (
      this.db
        .prepare(
          `SELECT ${COLUMNS.split(', ').map((c) => `items.${c}`).join(', ')}
           FROM outbox JOIN items ON items.id = outbox.item_id
           ORDER BY outbox.version LIMIT ?`
        )
        .all(limit) as unknown as ItemRow[]
    ).map(toItem)
  }

  /** Mark uploaded versions as synced. Newer local edits stay queued. */
  acknowledge(pairs: Array<{ id: string; version: string }>): void {
    transaction(this.db, () => {
      for (const { id, version } of pairs) this.stmts.outboxAck.run(id, version)
    })
  }

  /** How many items have changes not yet uploaded. */
  pendingCount(): number {
    return (this.stmts.outboxCount.get() as { n: number }).n
  }

  /** Queue every item, tombstones included, for upload (e.g. on joining a sync account). */
  queueAll(): void {
    this.db.exec(
      'INSERT INTO outbox (item_id, version) SELECT id, version FROM items WHERE true ON CONFLICT (item_id) DO UPDATE SET version = excluded.version'
    )
  }

  private write(item: Item): void {
    this.stmts.upsert.run(
      item.id,
      item.date,
      item.parentId,
      item.position,
      item.type,
      item.text,
      item.done ? 1 : 0,
      item.createdAt,
      item.updatedAt,
      item.deleted ? 1 : 0,
      item.version,
      item.deleted ? '' : fold(item.text)
    )
  }

  /* ------------------------------------------------------------- Meta/settings */

  getMeta(key: string): string | null {
    const row = this.stmts.metaGet.get(key) as { value: string } | undefined
    return row ? row.value : null
  }

  setMeta(key: string, value: string): void {
    this.stmts.metaPut.run(key, value)
  }

  deleteMeta(key: string): void {
    this.stmts.metaDelete.run(key)
  }

  getSettings(): Settings {
    const raw = this.getMeta('settings')
    let stored: Partial<Settings> = {}
    try {
      stored = raw ? JSON.parse(raw) : {}
    } catch {
      stored = {}
    }
    const theme = ['system', 'light', 'dark'].includes(stored.theme as string) ? stored.theme! : DEFAULT_SETTINGS.theme
    const weekStartsOn = stored.weekStartsOn === 0 || stored.weekStartsOn === 1 ? stored.weekStartsOn : DEFAULT_SETTINGS.weekStartsOn
    const looseEnds = typeof stored.looseEnds === 'boolean' ? stored.looseEnds : DEFAULT_SETTINGS.looseEnds
    const saveTabShortcut = typeof stored.saveTabShortcut === 'boolean' ? stored.saveTabShortcut : DEFAULT_SETTINGS.saveTabShortcut
    return { theme, weekStartsOn, looseEnds, saveTabShortcut }
  }

  setSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.getSettings(), ...patch }
    this.setMeta('settings', JSON.stringify(next))
    return this.getSettings()
  }
}
