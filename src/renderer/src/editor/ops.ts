import type { LineSpec } from '@shared/markdown'
import type { ISODate, ItemType } from '@shared/types'
import type { Tx } from './tx'

/**
 * Structural editing operations. Each takes a draft transaction and returns where
 * the caret should go afterwards (or `null` when the operation does not apply, so
 * the keystroke can fall through to native behavior).
 *
 * Outliner conventions:
 *  - Enter at the end of an item with children inserts its first child.
 *  - Outdent keeps the item in place visually: following siblings become its children.
 *  - Moving or deleting an item always takes its children along.
 */

export interface CaretFocus {
  id: string
  start: number
  end?: number
}

/** Enter: split the item at the selection, or insert above when at the very start. */
export function splitAt(tx: Tx, id: string, start: number, end = start): CaretFocus | null {
  const item = tx.get(id)
  if (!item) return null
  const text = item.text.slice(0, start) + item.text.slice(end)
  const parent = tx.parentOf(id)

  if (start === 0 && text.length > 0) {
    const siblings = tx.children(parent, item.date)
    const index = siblings.findIndex((s) => s.id === id)
    if (text !== item.text) tx.update(id, { text })
    const created = tx.create({ date: item.date, type: item.type })
    tx.place([created.id], item.date, parent, index > 0 ? siblings[index - 1].id : null)
    return { id, start: 0 }
  }

  tx.update(id, { text: text.slice(0, start) })
  const created = tx.create({ date: item.date, type: item.type, text: text.slice(start) })
  if (tx.children(id, item.date).length) tx.place([created.id], item.date, id, null)
  else tx.place([created.id], item.date, parent, id)
  return { id: created.id, start: 0 }
}

/** Enter on an empty item: outdent, then drop the list formatting, then add a line. */
export function enterOnEmpty(tx: Tx, id: string): CaretFocus | null {
  const item = tx.get(id)
  if (!item) return null
  if (tx.depthOf(id) > 0) {
    outdent(tx, [id])
    return { id, start: 0 }
  }
  if (item.type !== 'text') {
    tx.update(id, { type: 'text' })
    return { id, start: 0 }
  }
  return splitAt(tx, id, 0)
}

/** Backspace at the start: remove formatting, then indentation, then merge upward. */
export function backspaceAtStart(tx: Tx, id: string): CaretFocus | null {
  const item = tx.get(id)
  if (!item) return null
  if (item.type !== 'text') {
    tx.update(id, { type: 'text' })
    return { id, start: 0 }
  }
  if (tx.depthOf(id) > 0) {
    outdent(tx, [id])
    return { id, start: 0 }
  }
  const { rows, index } = tx.rowIndex(id)
  if (index <= 0) {
    // First line of the day: an empty line simply goes away if others follow it.
    if (item.text === '' && rows.length > 1 && !tx.children(id, item.date).length) {
      tx.update(id, { deleted: true })
      return { id: rows[1].id, start: 0 }
    }
    return null
  }
  const prev = tx.get(rows[index - 1].id)!
  const offset = prev.text.length
  const children = tx.children(id, item.date).map((c) => c.id)
  tx.update(prev.id, { text: prev.text + item.text })
  tx.update(id, { deleted: true })
  if (children.length) tx.place(children, item.date, prev.id, 'end')
  return { id: prev.id, start: offset }
}

/** Forward-delete at the end: pull the next line's text up into this one. */
export function deleteAtEnd(tx: Tx, id: string): CaretFocus | null {
  const item = tx.get(id)
  if (!item) return null
  const { rows, index } = tx.rowIndex(id)
  if (index === -1 || index >= rows.length - 1) return null
  const nextRow = rows[index + 1]
  const next = tx.get(nextRow.id)!
  const offset = item.text.length
  const grandchildren = tx.children(next.id, item.date).map((c) => c.id)
  tx.update(id, { text: item.text + next.text })
  tx.update(next.id, { deleted: true })
  if (grandchildren.length) tx.place(grandchildren, item.date, id, nextRow.parentId === id ? null : 'end')
  return { id, start: offset }
}

/** Indent each selected root under its previous sibling. All-or-nothing. */
export function indent(tx: Tx, ids: string[]): boolean {
  const roots = tx.roots(ids)
  if (!roots.length) return false
  const rootSet = new Set(roots)
  for (const id of roots) {
    const item = tx.get(id)!
    const siblings = tx.children(tx.parentOf(id), item.date)
    const index = siblings.findIndex((s) => s.id === id)
    if (index === 0) return false
    if (index > 0 && rootSet.has(siblings[index - 1].id)) continue
  }
  for (const id of roots) {
    const item = tx.get(id)!
    const siblings = tx.children(tx.parentOf(id), item.date)
    const index = siblings.findIndex((s) => s.id === id)
    if (index <= 0) continue
    const newParent = siblings[index - 1].id
    tx.place([id], item.date, newParent, 'end')
  }
  return true
}

/** Outdent each selected root one level, keeping visual order stable. */
export function outdent(tx: Tx, ids: string[]): boolean {
  let changed = false
  for (const id of tx.roots(ids)) {
    const item = tx.get(id)!
    const parent = tx.parentOf(id)
    if (parent === null) continue
    const siblings = tx.children(parent, item.date)
    const following = siblings.slice(siblings.findIndex((s) => s.id === id) + 1).map((s) => s.id)
    tx.place([id], item.date, tx.parentOf(parent), parent)
    if (following.length) tx.place(following, item.date, id, 'end')
    changed = true
  }
  return changed
}

/**
 * Move the selection one slot up or down among items at the same depth. At the
 * edge of a sibling list it continues into the neighboring parent's children.
 */
export function moveVertical(tx: Tx, ids: string[], direction: -1 | 1): boolean {
  let roots = tx.roots(ids)
  if (!roots.length) return false
  const first = tx.get(roots[0])!
  const parent = tx.parentOf(roots[0])
  const date = first.date
  const siblings = tx.children(parent, date)
  const indices = roots.map((id) => siblings.findIndex((s) => s.id === id))
  const contiguous = indices.every((v, i) => v !== -1 && (i === 0 || v === indices[i - 1] + 1))
  if (!contiguous) roots = [roots[0]]
  const firstIndex = siblings.findIndex((s) => s.id === roots[0])
  const lastIndex = siblings.findIndex((s) => s.id === roots[roots.length - 1])

  if (direction === -1) {
    if (firstIndex > 0) {
      tx.place(roots, date, parent, firstIndex >= 2 ? siblings[firstIndex - 2].id : null)
      return true
    }
    if (parent === null) return false
    const parentSiblings = tx.children(tx.parentOf(parent), date)
    const p = parentSiblings.findIndex((s) => s.id === parent)
    if (p <= 0) return false
    tx.place(roots, date, parentSiblings[p - 1].id, 'end')
    return true
  }

  if (lastIndex < siblings.length - 1) {
    tx.place(roots, date, parent, siblings[lastIndex + 1].id)
    return true
  }
  if (parent === null) return false
  const parentSiblings = tx.children(tx.parentOf(parent), date)
  const p = parentSiblings.findIndex((s) => s.id === parent)
  if (p === -1 || p >= parentSiblings.length - 1) return false
  tx.place(roots, date, parentSiblings[p + 1].id, null)
  return true
}

/** Move the selection (with children) to the end of another day. Returns moved roots. */
export function moveToDate(tx: Tx, ids: string[], date: ISODate): string[] {
  const roots = tx.roots(ids).filter((id) => tx.get(id)!.date !== date)
  for (const root of roots) {
    for (const id of tx.subtreeIds(root)) tx.update(id, { date })
    tx.place([root], date, null, 'end')
  }
  return roots
}

/** Drag and drop: place the selection (with children) at an exact spot. */
export function dropAt(tx: Tx, ids: string[], date: ISODate, parentId: string | null, after: string | null | 'end'): boolean {
  const roots = tx.roots(ids)
  if (!roots.length) return false
  const moving = new Set(roots.flatMap((r) => tx.subtreeIds(r)))
  if (parentId && moving.has(parentId)) return false
  for (const root of roots) {
    for (const id of tx.subtreeIds(root)) if (id !== root) tx.update(id, { date })
  }
  tx.place(roots, date, parentId, after)
  return true
}

export function remove(tx: Tx, ids: string[]): void {
  for (const root of tx.roots(ids)) {
    for (const id of tx.subtreeIds(root)) tx.update(id, { deleted: true })
  }
}

export function setType(tx: Tx, ids: string[], type: ItemType): void {
  for (const id of ids) tx.update(id, { type })
}

/** ⌘↩: complete/reopen to-dos; anything else becomes a to-do first. */
export function toggleDone(tx: Tx, ids: string[]): 'completed' | 'reopened' | 'converted' | null {
  const items = ids.map((id) => tx.get(id)).filter((i) => i !== undefined)
  if (!items.length) return null
  const todos = items.filter((i) => i.type === 'todo')
  if (!todos.length) {
    for (const item of items) tx.update(item.id, { type: 'todo', done: false })
    return 'converted'
  }
  const allDone = todos.every((t) => t.done)
  for (const todo of todos) tx.update(todo.id, { done: !allDone })
  return allDone ? 'reopened' : 'completed'
}

export function toggleTodo(tx: Tx, ids: string[]): void {
  const items = ids.map((id) => tx.get(id)).filter((i) => i !== undefined)
  const allTodo = items.every((i) => i.type === 'todo')
  for (const item of items) tx.update(item.id, { type: allTodo ? 'bullet' : 'todo' })
}

/**
 * Lay out parsed lines as items. Depth-0 lines become siblings placed after
 * `anchor` (or at `start` of `parent` when anchor is null, or the end when 'end');
 * deeper lines nest under the line above them. Returns the created ids.
 */
function placeLines(
  tx: Tx,
  date: ISODate,
  parent: string | null,
  anchor: string | null | 'end',
  lines: LineSpec[],
  stack: string[] = []
): string[] {
  const created: string[] = []
  let first = true
  for (const line of lines) {
    const depth = Math.min(line.depth, stack.length)
    const parentId = depth === 0 ? parent : stack[depth - 1]
    const after: string | null | 'end' = stack[depth] ?? (depth === 0 ? (first ? anchor : 'end') : null)
    const item = tx.create({ date, type: line.type, done: line.type === 'todo' && line.done, text: line.text })
    tx.place([item.id], date, parentId, after)
    stack[depth] = item.id
    stack.length = depth + 1
    created.push(item.id)
    first = false
  }
  return created
}

/** Paste several lines into an item at the selection, like a document would. */
export function pasteLines(tx: Tx, id: string, start: number, end: number, lines: LineSpec[]): CaretFocus | null {
  const item = tx.get(id)
  if (!item || !lines.length) return null
  const before = item.text.slice(0, start)
  const after = item.text.slice(end)
  const [head, ...rest] = lines
  const adopt = before === '' && after === '' && item.type === 'text' && head.type !== 'text'
  // Mid-sentence, the first line is inserted as written; on an empty line its marker applies.
  const headText = adopt || before === '' ? head.text : (head.raw ?? head.text)
  tx.update(id, {
    text: before + headText + (rest.length ? '' : after),
    ...(adopt ? { type: head.type, done: head.done } : {})
  })
  if (!rest.length) return { id, start: before.length + headText.length }

  // Like Enter: an item with children continues into its first child, so the pasted
  // lines (and the rest of the line) stay directly below the caret.
  const created = tx.children(id, item.date).length
    ? placeLines(tx, item.date, id, null, rest)
    : placeLines(tx, item.date, tx.parentOf(id), id, rest, [id])
  const lastId = created[created.length - 1]
  const last = tx.get(lastId)!
  tx.update(lastId, { text: last.text + after })
  return { id: lastId, start: last.text.length }
}

/** Insert parsed lines as new items after `afterId` (or at the end of the day). */
export function insertLinesAfter(tx: Tx, date: ISODate, afterId: string | null, lines: LineSpec[]): string[] {
  if (!lines.length) return []
  if (afterId) {
    const anchorRoot = tx.get(afterId)
    if (anchorRoot) return placeLines(tx, date, tx.parentOf(afterId), afterId, lines, [afterId])
  }
  return placeLines(tx, date, null, 'end', lines)
}
