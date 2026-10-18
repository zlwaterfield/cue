import { Keyboard, type TextInputInstance } from 'react-native'
import * as Haptics from 'expo-haptics'
import { addDays, friendlyDate, todayISO } from '@shared/dates'
import * as ops from '@shared/editor/ops'
import { dropTarget, subtreeEnd } from '@shared/editor/geometry'
import { rollover } from '@shared/editor/rollover'
import { Tx } from '@shared/editor/tx'
import { revert, UndoManager, type SelectionSnapshot, type UndoEntry } from '@shared/editor/undo'
import { uuidv7 } from '@shared/ids'
import { parseMarkdownLines } from '@shared/markdown'
import type { ISODate, Item, ItemType } from '@shared/types'
import { itemStore, sync } from '../core/app'
import { dismissToast, showToast, ui } from '../core/ui'
import { DayLayout } from './layout'

/**
 * The phone's editor: focus, typing, Return and Backspace, the line commands behind
 * taps, swipes and the keyboard toolbar, drag and drop, and undo. Structural edits are the
 * Mac's own operations (`shared/editor/ops`) run over the same draft transaction, so a line
 * behaves the same way on both. React renders state; this decides what happens.
 */

type Focus = { id: string; start: number; end?: number } | null | void

interface Caret {
  start: number
  end: number
}

/** Markdown typed at the start of a line formats it, like on the Mac. */
const AUTOFORMAT: Record<ItemType, Array<[RegExp, ItemType, boolean]>> = {
  text: [
    [/^(?:- ?)?\[ ?\] $/, 'todo', false],
    [/^(?:- ?)?\[[xX]\] $/, 'todo', true],
    [/^[-*•] $/, 'bullet', false]
  ],
  bullet: [
    [/^\[ ?\] $/, 'todo', false],
    [/^\[[xX]\] $/, 'todo', true]
  ],
  todo: []
}

function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function commonSuffix(a: string, b: string, limit: number): number {
  let i = 0
  while (i < a.length - limit && i < b.length - limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

export interface Scroller {
  /** Bring a line into view above the keyboard. */
  reveal(date: ISODate, id: string): void
}

export class Editor {
  readonly undo = new UndoManager()
  private inputs = new Map<string, TextInputInstance>()
  private carets = new Map<string, Caret>()
  private pending: { id: string; start: number; end: number } | null = null
  private frame = 0
  /** Each day's blank last line has an id ready, so typing into it turns it into that item. */
  private ghosts = new Map<ISODate, string>()
  private layouts = new Map<ISODate, DayLayout>()
  private toastEntry: UndoEntry | undefined
  /**
   * Markdown that just became formatting ("- " → a bullet), until the input shows the
   * shorter text. React Native drops a text change that crosses a keystroke in flight, so
   * fast typing can arrive with the marker still in front; it's taken off again here.
   */
  private stripped = new Map<string, string>()
  /** The old today's page after midnight, until it can follow to the new today. */
  private following: ISODate | null = null
  scroller: Scroller | null = null

  constructor() {
    itemStore.onReset(() => this.reset())
    itemStore.onExternal((applied) => this.onExternal(applied))
  }

  /**
   * The notes on this phone were removed (signed out, or another account signed in).
   * Nothing from before may act on whoever's notes come next: no undo history, no ghost
   * ids, no caret, no page left on a day from the previous account.
   */
  private reset(): void {
    this.undo.clear()
    this.toastEntry = undefined
    this.ghosts.clear()
    this.layouts.clear()
    this.carets.clear()
    this.stripped.clear()
    this.pending = null
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.following = null
    const today = todayISO()
    ui.set({ today, date: today, focusedId: null, toast: null, flash: null, dragging: false })
  }

  /* ============================================================== Days */

  layout(date: ISODate): DayLayout {
    let layout = this.layouts.get(date)
    if (!layout) {
      layout = new DayLayout(date, () => this.ghostId(date))
      this.layouts.set(date, layout)
    }
    return layout
  }

  ghostId(date: ISODate): string {
    let id = this.ghosts.get(date)
    if (!id) {
      id = uuidv7()
      this.ghosts.set(date, id)
    }
    return id
  }

  isGhost(id: string): boolean {
    for (const ghost of this.ghosts.values()) if (ghost === id) return !itemStore.get(id)
    return false
  }

  private ghostDate(id: string): ISODate | undefined {
    for (const [date, ghost] of this.ghosts) if (ghost === id) return date
    return undefined
  }

  async goTo(date: ISODate): Promise<void> {
    await itemStore.ensureLoaded([date])
    if (ui.get().focusedId) Keyboard.dismiss()
    ui.set({ date })
    void itemStore.ensureLoaded([addDays(date, -1), addDays(date, 1)])
  }

  /** Open a line's day and point the line out (from search). */
  async show(id: string, date: ISODate): Promise<void> {
    await this.goTo(date)
    ui.set({ flash: { id, at: Date.now() } })
    this.scroller?.reveal(date, id)
  }

  /**
   * Keep "today" right when the app stays open past midnight (every 30 s, and when the app
   * comes back). Titles and the Today pill move on at once; the old today's page follows
   * only once no line is being edited or dragged (see `rollover`).
   */
  checkToday(): void {
    const { today, date, focusedId, dragging } = ui.get()
    const next = rollover({ today, page: date, following: this.following }, todayISO(), !!focusedId || dragging)
    this.following = next.following
    if (next.today !== today) void itemStore.ensureLoaded([next.today]).then(() => ui.set({ today: next.today }))
    if (next.page !== date) void this.goTo(next.page)
  }

  /* ============================================================= Focus */

  register(id: string, input: TextInputInstance | null): void {
    if (!input) return
    this.inputs.set(id, input)
    // A line just created for the caret (Return) takes it as it mounts, like autoFocus,
    // rather than a frame later.
    if (this.pending?.id === id) {
      if (this.frame) cancelAnimationFrame(this.frame)
      this.frame = 0
      this.apply()
    }
  }

  unregister(id: string, input: TextInputInstance | null): void {
    if (this.inputs.get(id) !== input) return
    this.inputs.delete(id)
    if (ui.get().focusedId !== id) return
    // A line removed while being edited (deleted, moved, its page replaced) never reports
    // a blur. Unless it's back a frame later, the caret is on whichever line took it, or
    // nowhere, so the toolbar never acts on a line that isn't there.
    requestAnimationFrame(() => {
      if (ui.get().focusedId === id && !this.inputs.has(id)) this.leave(id, this.focusedInput())
    })
  }

  /** The line whose input has focus, as far as JavaScript knows (its focus event may be on the way). */
  private focusedInput(): string | null {
    for (const [id, input] of this.inputs) if (input.isFocused()) return id
    return null
  }

  /** The line being edited is gone from the page: stop editing it. */
  private leave(id: string, next: string | null = null): void {
    this.undo.seal()
    this.stripped.delete(id)
    if (this.pending?.id === id) this.pending = null
    ui.set({ focusedId: next })
  }

  /** Put the caret in a line once it's rendered (it may have just been created). */
  focus(id: string, start: number, end = start): void {
    this.pending = { id, start, end }
    this.carets.set(id, { start, end })
    this.schedule()
  }

  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.apply()
    })
  }

  /** Focus the pending line if it's on screen (else its registration will). */
  private apply(): void {
    const pending = this.pending
    const input = pending && this.inputs.get(pending.id)
    if (!pending || !input) return
    this.pending = null
    if (!input.isFocused()) input.focus()
    input.setSelection(pending.start, pending.end)
    const date = itemStore.get(pending.id)?.date ?? this.ghostDate(pending.id)
    if (date) this.scroller?.reveal(date, pending.id)
  }

  onFocus(id: string): void {
    if (ui.get().focusedId !== id) this.undo.seal()
    ui.set({ focusedId: id })
  }

  onBlur(id: string): void {
    this.undo.seal()
    this.stripped.delete(id)
    if (ui.get().focusedId === id) ui.set({ focusedId: null })
    // A finished line goes to other devices now, not after the typing pause.
    sync.flushSoon()
  }

  onSelection(id: string, caret: Caret): void {
    this.carets.set(id, caret)
  }

  caretOf(id: string): Caret {
    const length = itemStore.get(id)?.text.length ?? 0
    const caret = this.carets.get(id)
    return caret ? { start: Math.min(caret.start, length), end: Math.min(caret.end, length) } : { start: length, end: length }
  }

  private snapshot(): SelectionSnapshot {
    const id = ui.get().focusedId
    if (!id || !itemStore.get(id)) return { kind: 'none' }
    return { kind: 'text', id, ...this.caretOf(id) }
  }

  private restore(snapshot: SelectionSnapshot): void {
    if (snapshot.kind !== 'text') return
    const item = itemStore.get(snapshot.id)
    if (!item) return
    if (item.date !== ui.get().date) {
      void this.goTo(item.date).then(() => this.focus(snapshot.id, snapshot.start, snapshot.end))
      return
    }
    this.focus(snapshot.id, snapshot.start, snapshot.end)
  }

  /* ====================================================== Transactions */

  /** Run an edit as one undoable step: stage it in a draft, commit it, then place the caret. */
  commit(label: string, fn: (tx: Tx) => Focus, options: { coalesce?: string; before?: SelectionSnapshot; animate?: ISODate } = {}): boolean {
    const before = options.before ?? this.snapshot()
    const tx = new Tx(itemStore)
    const result = fn(tx)
    const changes = tx.netChanges()
    if (!changes.length && !result) return false
    if (options.animate) this.layout(options.animate).animateNextChange()
    if (changes.length) itemStore.commit(changes.map((c) => c.after))
    if (result) this.focus(result.id, result.start, result.end ?? result.start)
    if (changes.length) {
      if (ui.get().toast?.undo) dismissToast()
      this.undo.record({
        label,
        changes,
        selectionBefore: before,
        selectionAfter: result ? { kind: 'text', id: result.id, start: result.start, end: result.end ?? result.start } : before,
        coalesceKey: options.coalesce,
        at: Date.now()
      })
    }
    return changes.length > 0
  }

  undoAction(): void {
    const entry = this.undo.popUndo()
    if (!entry) return
    dismissToast()
    this.replay(entry, 'undo')
  }

  redoAction(): void {
    const entry = this.undo.popRedo()
    if (!entry) return
    this.replay(entry, 'redo')
  }

  /** Reverse (or redo) only what the entry changed, leaving newer edits from other devices alone. */
  private replay(entry: UndoEntry, direction: 'undo' | 'redo'): void {
    const records = revert(entry.changes, direction, itemStore)
    if (!records.length) {
      showToast('Already changed on another device')
      return
    }
    itemStore.commit(records)
    // Lands only on a line that's still there.
    this.restore(direction === 'undo' ? entry.selectionBefore : entry.selectionAfter)
  }

  /** The toast's Undo: only undoes the action it announced. */
  undoToast(): void {
    dismissToast()
    if (this.toastEntry && this.undo.top() === this.toastEntry) this.undoAction()
    this.toastEntry = undefined
  }

  private announce(message: string): void {
    showToast(message, { undo: true })
    this.toastEntry = this.undo.top()
  }

  /**
   * Lines changed on another device. If the one being edited was deleted, or moved off this
   * page, the keyboard goes (there's nothing left to type into) and a toast says why; a
   * deletion can be undone from it, which brings the line back everywhere.
   */
  private onExternal(applied: Item[]): void {
    const id = ui.get().focusedId
    const record = id ? applied.find((item) => item.id === id) : undefined
    if (!id || !record || itemStore.get(id)?.date === ui.get().date) return
    const caret = this.carets.get(id) ?? { start: record.text.length, end: record.text.length }
    this.leave(id)
    Keyboard.dismiss()
    if (record.deleted) {
      this.undo.record({
        label: 'Delete',
        changes: [{ before: { ...record, deleted: false }, after: record }],
        selectionBefore: { kind: 'text', id, ...caret },
        selectionAfter: { kind: 'none' },
        at: Date.now()
      })
      this.announce('Deleted on another device')
    } else {
      const label = friendlyDate(record.date, ui.get().today).replace(/^(Today|Tomorrow|Yesterday)$/, (m) => m.toLowerCase())
      showToast(`Moved to ${label} on another device`)
    }
  }

  /* ============================================================ Typing */

  onChangeText(id: string, date: ISODate, text: string): void {
    const strip = this.stripped.get(id)
    if (strip !== undefined) {
      if (text.startsWith(strip)) text = text.slice(strip.length)
      else this.stripped.delete(id)
    }
    const item = itemStore.get(id)
    if (!item) {
      if (this.isGhost(id)) this.typeIntoGhost(id, date, text)
      return
    }
    const previous = item.text
    if (text === previous) return
    if (/[\r\n]/.test(text)) {
      this.pasteInto(id, previous, text)
      return
    }
    const before: SelectionSnapshot = { kind: 'text', id, ...this.caretOf(id) }
    this.commit('Typing', (tx) => void tx.update(id, { text }), { coalesce: `text:${id}`, before })
    this.autoformat(id, previous, text)
  }

  /** The blank last line becomes a real item, keeping its id, its view and the keyboard. */
  private typeIntoGhost(id: string, date: ISODate, text: string): void {
    const clean = text.replace(/[\r\n]+/g, ' ')
    if (!clean) return
    this.undo.seal()
    this.ghosts.set(date, uuidv7())
    this.commit(
      'Typing',
      (tx) => {
        tx.create({ id, date, text: clean })
        tx.place([id], date, null, 'end')
      },
      { coalesce: `text:${id}`, before: { kind: 'none' } }
    )
    this.autoformat(id, '', clean)
  }

  private autoformat(id: string, previous: string, text: string): void {
    const item = itemStore.get(id)
    if (!item || text.length !== previous.length + 1) return
    const typedAt = commonPrefix(previous, text)
    for (const [pattern, type, done] of AUTOFORMAT[item.type]) {
      const prefix = text.slice(0, typedAt + 1)
      if (!pattern.test(prefix)) continue
      this.undo.seal()
      // No caret placement: the input keeps the caret's distance from the end of the line,
      // which is right after the marker that just went away.
      this.commit(type === 'todo' ? 'Format as to-do' : 'Format as bullet', (tx) => {
        tx.update(id, { type, done, text: text.slice(prefix.length) })
      })
      this.stripped.set(id, prefix)
      Haptics.selectionAsync()
      return
    }
  }

  /** Pasted lines become items, nested the way they were written. */
  private pasteInto(id: string, previous: string, text: string): void {
    const start = commonPrefix(previous, text)
    const suffix = commonSuffix(previous, text, start)
    const inserted = text.slice(start, text.length - suffix)
    const end = previous.length - suffix
    const lines = parseMarkdownLines(inserted)
    this.undo.seal()
    if (lines.length <= 1) {
      const flat = previous.slice(0, start) + inserted.replace(/[\r\n]+/g, ' ').trim() + previous.slice(end)
      this.commit('Paste', (tx) => {
        tx.update(id, { text: flat })
        return { id, start: flat.length - suffix }
      })
      return
    }
    this.commit('Paste', (tx) => ops.pasteLines(tx, id, start, end, lines))
  }

  /** Return: split the line at the caret (or leave an empty list item). */
  onSubmit(id: string): void {
    const item = itemStore.get(id)
    if (!item) return
    this.undo.seal()
    const caret = this.caretOf(id)
    if (item.text === '') this.commit('New line', (tx) => ops.enterOnEmpty(tx, id))
    else this.commit('New line', (tx) => ops.splitAt(tx, id, caret.start, caret.end))
  }

  /** Backspace at the very start: drop the marker, then the indent, then join the line above. */
  onBackspace(id: string, date: ISODate): void {
    const caret = this.caretOf(id)
    if (caret.start !== 0 || caret.end !== 0) return
    if (this.isGhost(id)) {
      const rows = itemStore.outline(date)
      const last = rows[rows.length - 1]
      if (last) this.focus(last.id, itemStore.get(last.id)!.text.length)
      return
    }
    this.undo.seal()
    this.commit('Delete', (tx) => ops.backspaceAtStart(tx, id))
  }

  /* ================================================ Line commands */

  /** Tapping a marker: a bullet becomes a to-do, a to-do is checked off or reopened. */
  tapMarker(id: string): void {
    const item = itemStore.get(id)
    if (!item) return
    if (item.type === 'bullet') {
      this.commit('Convert', (tx) => ops.setType(tx, [id], 'todo'))
      Haptics.selectionAsync()
    } else if (item.type === 'todo') {
      this.complete(id)
    } else {
      this.focus(id, 0)
    }
  }

  /** Swiping right: text and bullets become to-dos; to-dos are completed or reopened. */
  advance(id: string): void {
    const item = itemStore.get(id)
    if (!item) return
    if (item.type !== 'todo') {
      this.commit('Convert', (tx) => ops.setType(tx, [id], 'todo'))
      Haptics.selectionAsync()
      return
    }
    this.complete(id)
  }

  private complete(id: string): void {
    let result: ReturnType<typeof ops.toggleDone> = null
    this.commit('Complete', (tx) => void (result = ops.toggleDone(tx, [id])))
    if (result === 'completed') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    else Haptics.selectionAsync()
  }

  /**
   * Make the day's blank last line a real (empty) item, so it can be formatted or indented
   * before anything is typed. It keeps its id, so its view and the keyboard stay put.
   */
  private materialize(tx: Tx, id: string): boolean {
    if (tx.get(id)) return true
    const date = this.ghostDate(id)
    if (!date) return false
    this.ghosts.set(date, uuidv7())
    tx.create({ id, date })
    tx.place([id], date, null, 'end')
    return true
  }

  /** The toolbar's type buttons: a button turns its type on, or back to plain text. */
  toggleType(id: string, type: 'todo' | 'bullet'): void {
    const current = itemStore.get(id)?.type ?? 'text'
    const next: ItemType = current === type ? 'text' : type
    const caret = this.caretOf(id)
    this.commit('Convert', (tx) => {
      if (!this.materialize(tx, id)) return null
      ops.setType(tx, [id], next)
      return { id, ...caret }
    })
    Haptics.selectionAsync()
  }

  indent(id: string): void {
    const caret = this.caretOf(id)
    const indented = this.commit('Indent', (tx) => (this.materialize(tx, id) && ops.indent(tx, [id]) ? { id, ...caret } : null))
    if (!indented) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
  }

  outdent(id: string): void {
    const caret = this.caretOf(id)
    if (!this.commit('Outdent', (tx) => (ops.outdent(tx, [id]) ? { id, ...caret } : null))) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
  }

  remove(id: string): void {
    const item = itemStore.get(id)
    if (!item) return
    const focused = ui.get().focusedId === id
    const next = focused ? this.neighborAfterRemoval(id) : null
    this.commit('Delete', (tx) => {
      ops.remove(tx, [id])
      return next
    })
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    this.announce('Deleted')
  }

  async moveTo(id: string, date: ISODate): Promise<void> {
    const item = itemStore.get(id)
    if (!item) return
    const today = ui.get().today
    if (item.date === date) {
      showToast(`Already on ${friendlyDate(date, today)}`)
      return
    }
    const before = this.snapshot()
    await itemStore.ensureLoaded([date])
    if (!itemStore.get(id)) return
    const focused = ui.get().focusedId === id
    const next = focused ? this.neighborAfterRemoval(id) : null
    const moved = this.commit(
      'Move',
      (tx) => {
        const roots = ops.moveToDate(tx, [id], date)
        return roots.length ? next : null
      },
      { before }
    )
    if (!moved) return
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    const label = friendlyDate(date, today).replace(/^(Today|Tomorrow|Yesterday)$/, (m) => m.toLowerCase())
    this.announce(`Moved to ${label}`)
  }

  /** Move to tomorrow, or a day later if the line is already there or beyond. */
  moveToTomorrow(id: string): Promise<void> {
    const item = itemStore.get(id)
    if (!item) return Promise.resolve()
    const tomorrow = addDays(ui.get().today, 1)
    return this.moveTo(id, item.date < tomorrow ? tomorrow : addDays(item.date, 1))
  }

  /** The line the caret moves to when the focused line leaves the page. */
  private neighborAfterRemoval(id: string): Focus {
    const item = itemStore.get(id)!
    const rows = itemStore.outline(item.date)
    const index = rows.findIndex((r) => r.id === id)
    const end = subtreeEnd(rows, index)
    const next = rows[end]
    if (next) return { id: next.id, start: 0 }
    const prev = rows[index - 1]
    if (prev) return { id: prev.id, start: itemStore.get(prev.id)!.text.length }
    return { id: this.ghostId(item.date), start: 0 }
  }

  /* ===================================================== Shared to Cue */

  /**
   * Links and text shared from other apps, added to the end of today, each one its own
   * undoable step. A link becomes one line; text keeps its lines and list markers, as a
   * paste does. The newest glows if today is on screen; otherwise a toast says where it went.
   */
  receiveShared(texts: string[]): void {
    const { today } = ui.get()
    let last: string | null = null
    for (const text of texts) {
      const lines = parseMarkdownLines(text)
      if (!lines.length) continue
      let created: string[] = []
      this.undo.seal()
      this.commit('Add from Share', (tx) => void (created = ops.insertLinesAfter(tx, today, null, lines)))
      last = created[0] ?? last
    }
    if (!last) return
    const id = last
    if (ui.get().date === today) {
      ui.set({ flash: { id, at: Date.now() } })
      requestAnimationFrame(() => this.scroller?.reveal(today, id))
    } else {
      showToast(texts.length === 1 ? 'Added to today from Share' : `Added ${texts.length} to today from Share`)
    }
  }

  /* ===================================================== Drag and drop */

  /**
   * A dragged line (with its children) was released. `index` is the gap among the other
   * lines and `depth` the indent it was dragged to, both already settled on the UI thread.
   */
  drop(date: ISODate, id: string, index: number, depth: number): void {
    const target = dropTarget(itemStore.outline(date), id, index, depth)
    if (!target) return
    const { parentId, after } = target
    const caret = ui.get().focusedId === id ? { id, ...this.caretOf(id) } : null
    this.commit('Move', (tx) => (ops.dropAt(tx, [id], date, parentId, after) ? caret : null), { animate: date })
  }
}

export const editor = new Editor()
