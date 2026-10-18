import type { ISODate, Item } from '../types'

/**
 * Application-level undo. Every user action — typing, completion, conversion,
 * reorder, move to another day, deletion — is one entry holding before/after copies
 * of the items it touched plus the selection on either side. Undo and redo are new
 * writes (with new versions), which keeps them correct under synchronization.
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
