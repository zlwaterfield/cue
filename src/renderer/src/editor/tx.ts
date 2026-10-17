import { generateNKeysBetween } from 'fractional-indexing'
import { uuidv7 } from '@shared/ids'
import { buildOutline, type Row } from '@shared/outline'
import type { ISODate, Item } from '@shared/types'
import type { ItemStore } from '../store/items'

const MAX_KEY_LENGTH = 48

/**
 * A draft over the item store. Operations read the *rendered* structure (so orphans
 * and other sync artifacts behave exactly as they look), stage changes in an
 * overlay, and the controller commits the result as one undoable step.
 */
export class Tx {
  readonly changes = new Map<string, { before: Item | null; after: Item }>()
  private overlay = new Map<string, Item>()
  private outlines = new Map<ISODate, Row[]>()

  constructor(
    private readonly store: ItemStore,
    readonly now = Date.now()
  ) {}

  /* ---------------------------------------------------------------- Records */

  get(id: string): Item | undefined {
    const staged = this.overlay.get(id)
    if (staged) return staged.deleted ? undefined : staged
    return this.store.get(id)
  }

  put(item: Item): void {
    const existing = this.changes.get(item.id)
    const before = existing ? existing.before : (this.store.get(item.id) ?? null)
    this.changes.set(item.id, { before, after: item })
    this.overlay.set(item.id, item)
    this.outlines.clear()
  }

  update(id: string, patch: Partial<Item>): Item | undefined {
    const current = this.get(id)
    if (!current) return undefined
    let changed = false
    for (const key in patch) {
      if (!Object.is(patch[key as keyof Item], current[key as keyof Item])) {
        changed = true
        break
      }
    }
    if (!changed) return current
    const next = { ...current, ...patch }
    this.put(next)
    return next
  }

  create(fields: Partial<Item> & { date: ISODate }): Item {
    const item: Item = {
      id: uuidv7(this.now),
      parentId: null,
      position: 'a0',
      type: 'text',
      text: '',
      done: false,
      createdAt: this.now,
      updatedAt: this.now,
      deleted: false,
      version: '',
      ...fields
    }
    this.put(item)
    return item
  }

  /** Net changes (dropping edits that ended where they started). */
  netChanges(): Array<{ before: Item | null; after: Item }> {
    return [...this.changes.values()].filter(({ before, after }) => {
      if (!before) return !after.deleted
      return (
        before.date !== after.date ||
        before.parentId !== after.parentId ||
        before.position !== after.position ||
        before.type !== after.type ||
        before.text !== after.text ||
        before.done !== after.done ||
        before.deleted !== after.deleted
      )
    })
  }

  /* -------------------------------------------------------------- Structure */

  itemsOn(date: ISODate): Item[] {
    const out: Item[] = []
    for (const item of this.store.itemsOn(date)) if (!this.overlay.has(item.id)) out.push(item)
    for (const item of this.overlay.values()) if (item.date === date && !item.deleted) out.push(item)
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

  rowIndex(id: string): { rows: Row[]; index: number } {
    const item = this.get(id)
    if (!item) return { rows: [], index: -1 }
    const rows = this.outline(item.date)
    return { rows, index: rows.findIndex((r) => r.id === id) }
  }

  depthOf(id: string): number {
    const { rows, index } = this.rowIndex(id)
    return index === -1 ? 0 : rows[index].depth
  }

  /** Effective (rendered) parent. */
  parentOf(id: string): string | null {
    const { rows, index } = this.rowIndex(id)
    return index === -1 ? null : rows[index].parentId
  }

  children(parentId: string | null, date: ISODate): Item[] {
    return this.outline(date)
      .filter((r) => r.parentId === parentId)
      .map((r) => this.get(r.id)!)
  }

  lastChildId(parentId: string | null, date: ISODate): string | null {
    const kids = this.children(parentId, date)
    return kids.length ? kids[kids.length - 1].id : null
  }

  /** The item and all of its descendants, in visual order. */
  subtreeIds(id: string): string[] {
    const { rows, index } = this.rowIndex(id)
    if (index === -1) return []
    const out = [id]
    for (let i = index + 1; i < rows.length && rows[i].depth > rows[index].depth; i++) out.push(rows[i].id)
    return out
  }

  /** Top-most items of a selection (items whose parent is not also selected), in order. */
  roots(ids: string[]): string[] {
    const set = new Set(ids)
    const first = ids.map((id) => this.get(id)).find(Boolean)
    if (!first) return []
    const dates = [...new Set(ids.map((id) => this.get(id)?.date).filter(Boolean) as ISODate[])]
    const out: string[] = []
    for (const date of dates) {
      for (const row of this.outline(date)) {
        if (set.has(row.id) && !(row.parentId && set.has(row.parentId))) out.push(row.id)
      }
    }
    return out
  }

  /**
   * Position `ids` (in order) under `parentId` on `date`, directly after sibling
   * `after` — `null` for first, `'end'` for last. Generates fractional keys between
   * the neighbors; if neighbors collide (possible after concurrent offline edits)
   * the sibling list is re-keyed first.
   */
  place(ids: string[], date: ISODate, parentId: string | null, after: string | null | 'end'): void {
    if (!ids.length) return
    const moving = new Set(ids)
    const siblingsNow = (): Item[] => this.children(parentId, date).filter((s) => !moving.has(s.id))
    let siblings = siblingsNow()
    const indexFor = (list: Item[]): number => {
      if (after === 'end') return list.length
      if (after === null) return 0
      const at = list.findIndex((s) => s.id === after)
      return at === -1 ? list.length : at + 1
    }
    const keysFor = (list: Item[]): string[] => {
      const index = indexFor(list)
      const prev = index > 0 ? list[index - 1].position : null
      const next = index < list.length ? list[index].position : null
      if (prev !== null && next !== null && prev >= next) throw new Error('collision')
      return generateNKeysBetween(prev, next, ids.length)
    }
    let keys: string[]
    try {
      keys = keysFor(siblings)
      // Repeated inserts into one gap lengthen keys; re-space before they grow unwieldy.
      if (keys.some((k) => k.length > MAX_KEY_LENGTH)) throw new Error('long key')
    } catch {
      this.rekey(siblings)
      siblings = siblingsNow()
      keys = keysFor(siblings)
    }
    ids.forEach((id, i) => this.update(id, { date, parentId, position: keys[i] }))
  }

  private rekey(siblings: Item[]): void {
    const keys = generateNKeysBetween(null, null, siblings.length)
    siblings.forEach((s, i) => this.update(s.id, { position: keys[i] }))
  }
}
