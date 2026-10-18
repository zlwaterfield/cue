import type { ISODate, Item } from '../types'

/**
 * Application-level undo. Every user action — typing, completion, conversion,
 * reorder, move to another day, deletion — is one entry holding before/after copies
 * of the items it touched plus the selection on either side. Undo and redo are new
 * writes (with new versions), which keeps them correct under synchronization, and
 * they reverse only what the action changed (see `revert`).
 */

export type SelectionSnapshot =
  | { kind: 'none' }
  | { kind: 'text'; id: string; start: number; end: number }
  | { kind: 'blocks'; date: ISODate; anchor: string; focus: string }

export interface UndoEntry {
  label: string
  changes: Array<{ before: Item | null; after: Item }>
  selectionBefore: SelectionSnapshot
  selectionAfter: SelectionSnapshot
  coalesceKey?: string
  at: number
  sealed?: boolean
}

const COALESCE_MS = 1200
const LIMIT = 1000

export class UndoManager {
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []

  record(entry: UndoEntry): void {
    if (!entry.changes.length) return
    const top = this.undoStack[this.undoStack.length - 1]
    if (
      entry.coalesceKey &&
      top &&
      !top.sealed &&
      top.coalesceKey === entry.coalesceKey &&
      entry.at - top.at < COALESCE_MS
    ) {
      for (const change of entry.changes) {
        const existing = top.changes.find((c) => c.after.id === change.after.id)
        if (existing) existing.after = change.after
        else top.changes.push(change)
      }
      top.selectionAfter = entry.selectionAfter
      top.at = entry.at
    } else {
      this.undoStack.push(entry)
      if (this.undoStack.length > LIMIT) this.undoStack.shift()
    }
    this.redoStack = []
  }

  /** Stop the current typing run from absorbing further keystrokes. */
  seal(): void {
    const top = this.undoStack[this.undoStack.length - 1]
    if (top) top.sealed = true
  }

  popUndo(): UndoEntry | undefined {
    const entry = this.undoStack.pop()
    if (entry) {
      entry.sealed = true
      this.redoStack.push(entry)
    }
    return entry
  }

  popRedo(): UndoEntry | undefined {
    const entry = this.redoStack.pop()
    if (entry) this.undoStack.push(entry)
    return entry
  }

  top(): UndoEntry | undefined {
    return this.undoStack[this.undoStack.length - 1]
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }
}

/** What `revert` reads: the editor's item store. */
export interface RevertSource {
  get(id: string): Item | undefined
  isLoaded(date: ISODate): boolean
}

/** Fields that only make sense together: undo restores a group whole, or leaves it. */
const GROUPS: Array<Array<keyof Item>> = [['date', 'parentId', 'position'], ['type'], ['text'], ['done'], ['deleted']]

const same = (a: Item, b: Item, group: Array<keyof Item>): boolean => group.every((key) => Object.is(a[key], b[key]))
const pick = (item: Item, group: Array<keyof Item>): Partial<Item> => Object.fromEntries(group.map((key) => [key, item[key]]))

/**
 * The records that undo (or redo) an entry on top of the items as they are now. Only
 * the fields the action changed are reversed, and only where they still hold what the
 * action left, so undo never takes back a newer edit made on another device. A line
 * deleted elsewhere since stays deleted. Returns nothing if there's nothing left to do.
 */
export function revert(changes: UndoEntry['changes'], direction: 'undo' | 'redo', store: RevertSource): Item[] {
  const out: Item[] = []
  for (const { before, after } of changes) {
    const from = direction === 'undo' ? after : before
    const to = direction === 'undo' ? before : after
    const now = store.get(after.id)
    if (!from) {
      // Redo a creation: bring the line back unless it's here already.
      if (!now) out.push(after)
      continue
    }
    if (!to) {
      // Undo a creation: the line goes, unless it has been changed since.
      if (now && GROUPS.every((group) => same(now, from, group))) out.push({ ...now, deleted: true })
      continue
    }
    // Missing from a day that's loaded, though this action didn't delete it: deleted elsewhere.
    if (!now && !from.deleted && store.isLoaded(from.date)) continue
    const base = now ?? from
    let next = base
    for (const group of GROUPS) {
      // Untouched by this action, or changed again since: leave it as it is now.
      if (same(from, to, group) || !same(base, from, group)) continue
      next = { ...next, ...pick(to, group) }
    }
    if (next !== base) out.push(next)
  }
  return out
}
