import { flushSync } from 'react-dom'
import { COMMANDS_BY_ID } from '@shared/commands'
import { uuidv7 } from '@shared/ids'
import { addDays, friendlyDate, nextWeekday, startOfWeek, todayISO, weekViewDates } from '@shared/dates'
import { linesToMarkdown, parseMarkdownLines, type LineSpec } from '@shared/markdown'
import type { ISODate, ItemType, Settings } from '@shared/types'
import { backend } from '../data/backend'
import { itemStore } from '../store/items'
import { syncState } from '../store/sync'
import { dismissToast, showToast, ui, type Selection, type View } from '../store/ui'
import { caretLine, getOffsets, isTextInput, placeCaretAtX, scrollIntoViewIfNeeded, setOffsets } from './dom'
import { refreshCaret } from './caret'
import { flash } from './highlights'
import { commandFor, isMac } from './keys'
import * as ops from '@shared/editor/ops'
import { Tx } from '@shared/editor/tx'
import { revert, UndoManager, type SelectionSnapshot, type UndoEntry } from '@shared/editor/undo'

/**
 * The editor controller: owns focus, caret movement across items, block selection,
 * keyboard handling, undo/redo, and the implementation of every command. React
 * components render state; this decides what happens.
 */

const GHOST = 'ghost:'
export const ghostId = (date: ISODate): string => GHOST + date
export const isGhost = (id: string): boolean => id.startsWith(GHOST)
const ghostDate = (id: string): ISODate => id.slice(GHOST.length)

type FocusResult = ops.CaretFocus | SelectionSnapshot | null | void

interface CaretMemo {
  id: string
  start: number
  end: number
}

const AUTOFORMAT: Record<ItemType, Array<[RegExp, ItemType, boolean]>> = {
  text: [
    [/^(?:- ?)?\[ ?\] /, 'todo', false],
    [/^(?:- ?)?\[[xX]\] /, 'todo', true],
    [/^[-*•] /, 'bullet', false]
  ],
  bullet: [
    [/^\[ ?\] /, 'todo', false],
    [/^\[[xX]\] /, 'todo', true]
  ],
  todo: []
}

class EditorController {
  readonly undo = new UndoManager()
  private els = new Map<string, HTMLElement>()
  private goalX: number | null = null
  private lastText: CaretMemo | null = null
  private lastFocusByDate = new Map<ISODate, CaretMemo>()
  private lastExecuted = { id: '', at: 0, source: '' }
  private toastEntry: UndoEntry | undefined
  private navigationSeq = 0
  private selectionCache: { selection: Selection | null; ids: Set<string> } = { selection: null, ids: new Set() }
  composing = false
  sink: HTMLElement | null = null

  /* ============================================================ Registry */

  register(id: string, el: HTMLElement | null): void {
    if (el) this.els.set(id, el)
  }

  unregister(id: string, el: HTMLElement | null): void {
    if (this.els.get(id) === el) {
      this.els.delete(id)
      if (el === document.activeElement) this.composing = false
    }
  }

  element(id: string): HTMLElement | undefined {
    return this.els.get(id)
  }

  /* ================================================================ View */

  datesFor(view: View, today = ui.get().today, settings: Settings = ui.get().settings): ISODate[] {
    return view.mode === 'week' ? weekViewDates(today, settings.weekStartsOn) : [view.date]
  }

  visibleDates(): ISODate[] {
    return this.datesFor(ui.get().view)
  }

  primaryDate(): ISODate {
    const { view, today } = ui.get()
    return view.mode === 'day' ? view.date : today
  }

  private dateOf(id: string): ISODate | undefined {
    return isGhost(id) ? ghostDate(id) : itemStore.get(id)?.date
  }

  private isVisible(id: string): boolean {
    const date = this.dateOf(id)
    return !!date && this.visibleDates().includes(date) && (isGhost(id) || !!itemStore.get(id))
  }

  /** Rows in visual order across visible days; empty days contribute their blank line. */
  private navOrder(): string[] {
    const out: string[] = []
    for (const date of this.visibleDates()) {
      const rows = itemStore.outline(date)
      for (const row of rows) out.push(row.id)
      if (!rows.length) out.push(ghostId(date))
    }
    return out
  }

  private neighbor(id: string, direction: -1 | 1): string | undefined {
    const order = this.navOrder()
    const index = order.indexOf(id)
    if (index !== -1) return order[index + direction]
    if (isGhost(id)) {
      // The trailing blank line of a non-empty day sits after its last row.
      const rows = itemStore.outline(ghostDate(id))
      if (!rows.length) return undefined
      const last = order.indexOf(rows[rows.length - 1].id)
      return direction === -1 ? order[last] : order[last + 1]
    }
    return undefined
  }

  /* =============================================================== Focus */

  focusText(id: string, start: number, end = start, options: { scroll?: boolean } = {}): boolean {
    const el = this.els.get(id)
    if (!el) return false
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    setOffsets(el, start, end)
    if (options.scroll !== false) scrollIntoViewIfNeeded(el)
    this.noteFocus(id, start, end)
    return true
  }

  focusEnd(id: string): boolean {
    const length = isGhost(id) ? 0 : (itemStore.get(id)?.text.length ?? 0)
    return this.focusText(id, length)
  }

  private focusAtX(id: string, x: number, line: 'first' | 'last'): void {
    const el = this.els.get(id)
    if (!el) return
    scrollIntoViewIfNeeded(el)
    el.focus({ preventScroll: true })
    placeCaretAtX(el, x, line)
    const offsets = getOffsets(el)
    this.noteFocus(id, offsets?.start ?? 0, offsets?.end ?? 0)
  }

  private noteFocus(id: string, start: number, end: number): void {
    const selection = ui.get().selection
    if (selection.kind !== 'text' || selection.id !== id) ui.set({ selection: { kind: 'text', id } })
    this.lastText = { id, start, end }
  }

  /** Called from the editable's focus event (e.g. a click). */
  onEditableFocus(id: string): void {
    const selection = ui.get().selection
    if (selection.kind !== 'text' || selection.id !== id) {
      this.undo.seal()
      ui.set({ selection: { kind: 'text', id } })
    }
  }

  onEditableBlur(): void {
    this.undo.seal()
    // A composition can't outlive its editable.
    this.composing = false
  }

  /** Track the caret so commands from the palette or menu know their target. */
  onSelectionChange = (): void => {
    const active = document.activeElement as HTMLElement | null
    if (!active || !active.isContentEditable) return
    const id = active.dataset.editableId
    if (!id) return
    const offsets = getOffsets(active)
    if (offsets) this.lastText = { id, start: offsets.start, end: offsets.end }
  }

  /** Where to put the caret when nothing in particular is requested. */
  focusDefault(): void {
    const date = this.primaryDate()
    const memo = this.lastFocusByDate.get(date)
    if (memo && this.isVisible(memo.id) && this.focusText(memo.id, memo.start, memo.end)) return
    this.focusText(ghostId(date), 0)
  }

  /** Re-focus the last edited position (after an overlay closes). */
  restoreFocus(): void {
    const selection = ui.get().selection
    if (selection.kind === 'blocks') {
      this.sink?.focus({ preventScroll: true })
      return
    }
    if (this.lastText && this.isVisible(this.lastText.id)) {
      if (this.focusText(this.lastText.id, this.lastText.start, this.lastText.end, { scroll: false })) return
    }
    this.focusDefault()
  }

  /** Leave block selection and go back to editing its focus row. */
  restoreFocusToText(): void {
    const selection = ui.get().selection
    if (selection.kind === 'blocks' && itemStore.get(selection.focus)) this.focusEnd(selection.focus)
    else ui.set({ selection: { kind: 'none' } })
  }

  snapshot(): SelectionSnapshot {
    const selection = ui.get().selection
    if (selection.kind === 'blocks') return { ...selection }
    const active = document.activeElement as HTMLElement | null
    const id = active?.dataset?.editableId
    if (id && this.els.get(id) === active) {
      const offsets = getOffsets(active!)
      if (offsets) return { kind: 'text', id, start: offsets.start, end: offsets.end }
    }
    if (this.lastText) return { kind: 'text', ...this.lastText }
    return { kind: 'none' }
  }

  restore(snapshot: SelectionSnapshot): void {
    if (snapshot.kind === 'none') return
    if (snapshot.kind === 'blocks') {
      if (!itemStore.get(snapshot.anchor) || !itemStore.get(snapshot.focus)) return
      if (!this.visibleDates().includes(snapshot.date)) {
        void this.navigate({ mode: 'day', date: snapshot.date }, { focus: snapshot })
        return
      }
      this.selectBlocks(snapshot.date, snapshot.anchor, snapshot.focus)
      return
    }
    const date = this.dateOf(snapshot.id)
    if (!date) return
    if (!this.visibleDates().includes(date)) {
      void this.navigate({ mode: 'day', date }, { focus: snapshot })
      return
    }
    this.focusText(snapshot.id, snapshot.start, snapshot.end)
  }

  private applyFocus(result: FocusResult): void {
    if (!result) return
    if ('kind' in result) this.restore(result)
    else this.focusText(result.id, result.start, result.end ?? result.start)
  }

  /* ======================================================== Transactions */

  /**
   * Run an edit as one undoable step: stage it in a draft, commit to the store,
   * render synchronously, then place the caret.
   */
  commit(
    label: string,
    fn: (tx: Tx) => FocusResult,
    options: { coalesce?: string; before?: SelectionSnapshot; keepSelection?: boolean } = {}
  ): boolean {
    const before = options.before ?? this.snapshot()
    const tx = new Tx(itemStore)
    const result = fn(tx)
    const changes = tx.netChanges()
    if (!changes.length && !result) return false
    flushSync(() => {
      if (changes.length) itemStore.commit(changes.map((c) => c.after))
    })
    if (options.keepSelection) this.restore(before)
    else this.applyFocus(result)
    refreshCaret()
    if (changes.length && ui.get().toast?.undo) dismissToast()
    if (changes.length) {
      this.undo.record({
        label,
        changes,
        selectionBefore: before,
        selectionAfter: this.snapshot(),
        coalesceKey: options.coalesce,
        at: Date.now()
      })
    }
    return changes.length > 0
  }

  /** The toast's Undo button: only undoes the action it announced. */
  undoToast(): void {
    dismissToast()
    if (this.toastEntry && this.undo.top() === this.toastEntry) this.undoAction()
    this.toastEntry = undefined
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
    flushSync(() => {
      itemStore.commit(records)
    })
    // Lands only on a line that's still there.
    this.restore(direction === 'undo' ? entry.selectionBefore : entry.selectionAfter)
    refreshCaret()
  }

  /* ===================================================== Block selection */

  selectBlocks(date: ISODate, anchor: string, focus: string): void {
    this.undo.seal()
    const active = document.activeElement as HTMLElement | null
    if (active && active !== this.sink && active.isContentEditable) active.blur()
    this.sink?.focus({ preventScroll: true })
    window.getSelection()?.removeAllRanges()
    ui.set({ selection: { kind: 'blocks', date, anchor, focus } })
    const el = this.els.get(focus)
    if (el) scrollIntoViewIfNeeded(el)
  }

  /** Rows covered by a block selection, always including descendants. */
  selectedIds(selection: Selection = ui.get().selection): string[] {
    if (selection.kind !== 'blocks') return []
    const rows = itemStore.outline(selection.date)
    const a = rows.findIndex((r) => r.id === selection.anchor)
    const b = rows.findIndex((r) => r.id === selection.focus)
    if (a === -1 || b === -1) return []
    const lo = Math.min(a, b)
    let hi = Math.max(a, b)
    let minDepth = Infinity
    for (let i = lo; i <= hi; i++) minDepth = Math.min(minDepth, rows[i].depth)
    while (hi + 1 < rows.length && rows[hi + 1].depth > minDepth) hi++
    return rows.slice(lo, hi + 1).map((r) => r.id)
  }

  isSelected(id: string, selection: Selection): boolean {
    if (selection.kind !== 'blocks') return false
    if (this.selectionCache.selection !== selection) {
      this.selectionCache = { selection, ids: new Set(this.selectedIds(selection)) }
    }
    return this.selectionCache.ids.has(id)
  }

  /** Items a command applies to: the block selection, else the item being edited. */
  targets(): string[] {
    const selection = ui.get().selection
    if (selection.kind === 'blocks') return this.selectedIds(selection)
    const id = selection.kind === 'text' ? selection.id : this.lastText?.id
    if (id && itemStore.get(id)) return [id]
    return []
  }

  /* ================================================================ Keys */

  onItemKeyDown(e: React.KeyboardEvent<HTMLElement>, id: string): void {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || ui.get().overlay) return
    const el = this.els.get(id)
    const item = itemStore.get(id)
    if (!el || !item) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    const plain = !mod && !e.altKey && !e.ctrlKey
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
    if (!(vertical && plain && !e.shiftKey)) this.goalX = null
    const offsets = getOffsets(el) ?? { start: 0, end: 0, backward: false }
    const text = el.textContent ?? ''
    const collapsed = offsets.start === offsets.end

    if (e.key === 'Enter' && plain) {
      e.preventDefault()
      this.undo.seal()
      if (text === '') this.commit('New line', (tx) => ops.enterOnEmpty(tx, id))
      else this.commit('New line', (tx) => ops.splitAt(tx, id, offsets.start, offsets.end))
      return
    }

    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault()
      const caret = { id, start: offsets.start, end: offsets.end }
      if (e.shiftKey) this.commit('Outdent', (tx) => (ops.outdent(tx, [id]) ? caret : null))
      else this.commit('Indent', (tx) => (ops.indent(tx, [id]) ? caret : null))
      return
    }

    if (e.key === 'Backspace' && plain && !e.shiftKey && collapsed && offsets.start === 0) {
      e.preventDefault()
      this.undo.seal()
      this.commit('Delete', (tx) => ops.backspaceAtStart(tx, id))
      return
    }

    if (e.key === 'Delete' && plain && collapsed && offsets.end === text.length) {
      e.preventDefault()
      this.undo.seal()
      this.commit('Delete', (tx) => ops.deleteAtEnd(tx, id))
      return
    }

    if (vertical && e.altKey && !mod && !e.shiftKey) {
      e.preventDefault()
      const caret = { id, start: offsets.start, end: offsets.end }
      this.commit('Move', (tx) => (ops.moveVertical(tx, [id], e.key === 'ArrowUp' ? -1 : 1) ? caret : null))
      return
    }

    if (vertical && plain) {
      const up = e.key === 'ArrowUp'
      const line = caretLine(el)
      if (e.shiftKey) {
        const atEdge = up ? line.first && offsets.start === 0 : line.last && offsets.end === text.length
        if (atEdge) {
          e.preventDefault()
          const next = this.neighbor(id, up ? -1 : 1)
          const focus = next && !isGhost(next) && itemStore.get(next)?.date === item.date ? next : id
          this.selectBlocks(item.date, id, focus)
        }
        return
      }
      if (up ? line.first : line.last) {
        const target = this.neighbor(id, up ? -1 : 1)
        if (target) {
          e.preventDefault()
          if (this.goalX === null) this.goalX = line.x
          this.focusAtX(target, this.goalX, up ? 'last' : 'first')
        } else if (!up) {
          e.preventDefault()
          this.focusText(ghostId(item.date), 0)
        }
      }
      return
    }

    if (e.key === 'ArrowLeft' && plain && !e.shiftKey && collapsed && offsets.start === 0) {
      const target = this.neighbor(id, -1)
      if (target) {
        e.preventDefault()
        this.focusEnd(target)
      }
      return
    }

    if (e.key === 'ArrowRight' && plain && !e.shiftKey && collapsed && offsets.end === text.length) {
      const target = this.neighbor(id, 1)
      if (target) {
        e.preventDefault()
        this.focusText(target, 0)
      }
      return
    }

    if (e.key === 'Escape' && !mod && !e.shiftKey) {
      e.preventDefault()
      this.selectBlocks(item.date, id, id)
      return
    }

    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
      if (text.length === 0 || (offsets.start === 0 && offsets.end === text.length)) {
        e.preventDefault()
        this.selectAllOn(item.date)
      }
    }
  }

  onGhostKeyDown(e: React.KeyboardEvent<HTMLElement>, date: ISODate): void {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || ui.get().overlay) return
    const id = ghostId(date)
    const mod = isMac ? e.metaKey : e.ctrlKey
    const plain = !mod && !e.altKey && !e.ctrlKey && !e.shiftKey
    const el = this.els.get(id)
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      return
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'Backspace') && plain) {
      const target = this.neighbor(id, -1)
      e.preventDefault()
      if (!target) return
      if (e.key === 'ArrowUp' && el) {
        if (this.goalX === null) this.goalX = caretLine(el).x
        this.focusAtX(target, this.goalX, 'last')
      } else this.focusEnd(target)
      return
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && plain) {
      const target = this.neighbor(id, 1)
      e.preventDefault()
      if (!target) return
      if (e.key === 'ArrowDown' && el) {
        if (this.goalX === null) this.goalX = caretLine(el).x
        this.focusAtX(target, this.goalX, 'first')
      } else this.focusText(target, 0)
      return
    }
    this.goalX = null
    if (e.key === 'Escape') {
      e.preventDefault()
      const rows = itemStore.outline(date)
      if (rows.length) this.selectBlocks(date, rows[rows.length - 1].id, rows[rows.length - 1].id)
    }
  }

  /** Window-level keys: global shortcuts and block-selection mode. */
  onGlobalKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing) return
    const state = ui.get()
    const command = commandFor(e)

    if (state.overlay) {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.closeOverlay()
      } else if (command === 'palette.open' || command === 'search.open' || command === 'help.shortcuts') {
        e.preventDefault()
        this.execute(command, 'key')
      }
      return
    }

    if (state.dragging) return

    if (state.selection.kind === 'blocks' && this.onBlockKeyDown(e)) return

    if (command) {
      if ((command === 'edit.undo' || command === 'edit.redo') && isTextInput(e.target)) return
      e.preventDefault()
      this.execute(command, 'key')
      return
    }

    // Typing with nothing focused lands in today's blank line.
    const active = document.activeElement
    if ((!active || active === document.body || active === this.sink) && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      if (state.selection.kind !== 'blocks') {
        this.focusDefault()
      }
    }
  }

  private onBlockKeyDown(e: KeyboardEvent): boolean {
    const selection = ui.get().selection
    if (selection.kind !== 'blocks') return false
    const mod = isMac ? e.metaKey : e.ctrlKey
    const rows = itemStore.outline(selection.date)
    const ids = this.selectedIds(selection)
    if (!ids.length) {
      ui.set({ selection: { kind: 'none' } })
      return false
    }
    const focusIndex = rows.findIndex((r) => r.id === selection.focus)
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
    const up = e.key === 'ArrowUp'

    if (vertical && !mod && !e.altKey) {
      e.preventDefault()
      if (e.shiftKey) {
        const next = rows[focusIndex + (up ? -1 : 1)]
        if (next) this.selectBlocks(selection.date, selection.anchor, next.id)
        return true
      }
      const edge = up ? ids[0] : ids[ids.length - 1]
      const target = this.neighbor(edge, up ? -1 : 1)
      if (!target) return true
      if (isGhost(target)) this.focusText(target, 0)
      else this.selectBlocks(itemStore.get(target)!.date, target, target)
      return true
    }

    if (vertical && e.altKey && !mod) {
      e.preventDefault()
      this.commit('Move', (tx) => (ops.moveVertical(tx, ids, up ? -1 : 1) ? { ...selection } : null))
      return true
    }

    switch (e.key) {
      case 'Enter':
        if (mod) return false
        e.preventDefault()
        this.focusEnd(selection.focus)
        return true
      case 'Escape':
        e.preventDefault()
        this.focusEnd(selection.focus)
        return true
      case 'Backspace':
      case 'Delete':
        if (e.altKey) return false
        e.preventDefault()
        this.deleteTargets(ids)
        return true
      case 'Tab':
        e.preventDefault()
        if (e.shiftKey) this.commit('Outdent', (tx) => (ops.outdent(tx, ids) ? { ...selection } : null))
        else this.commit('Indent', (tx) => (ops.indent(tx, ids) ? { ...selection } : null))
        return true
    }

    if (mod && !e.altKey && !e.shiftKey) {
      const key = e.key.toLowerCase()
      if (key === 'a') {
        e.preventDefault()
        this.selectAllOn(selection.date)
        return true
      }
      if (key === 'c' || key === 'x') {
        e.preventDefault()
        void this.copyBlocks(key === 'x')
        return true
      }
      if (key === 'v') {
        e.preventDefault()
        void this.pasteBlocks()
        return true
      }
    }
    return false
  }

  private selectAllOn(date: ISODate): void {
    const rows = itemStore.outline(date)
    if (rows.length) this.selectBlocks(date, rows[0].id, rows[rows.length - 1].id)
  }

  /* =============================================================== Input */

  onItemInput(id: string, el: HTMLElement): void {
    if (this.composing) return
    let text = el.textContent ?? ''
    if (/[\r\n]/.test(text)) {
      const offsets = getOffsets(el)
      text = text.replace(/[\r\n]+/g, ' ')
      el.textContent = text
      if (offsets) setOffsets(el, offsets.start)
    }
    const item = itemStore.get(id)
    if (!item || item.text === text) return
    const before: SelectionSnapshot =
      this.lastText?.id === id ? { kind: 'text', ...this.lastText } : { kind: 'text', id, start: 0, end: 0 }
    this.commit(
      'Typing',
      (tx) => {
        tx.update(id, { text })
      },
      { coalesce: `text:${id}`, before }
    )
    this.autoformat(id, el)
  }

  private autoformat(id: string, el: HTMLElement): void {
    const item = itemStore.get(id)
    const offsets = getOffsets(el)
    if (!item || !offsets) return
    for (const [pattern, type, done] of AUTOFORMAT[item.type]) {
      const match = pattern.exec(item.text)
      if (match && offsets.start === match[0].length) {
        this.undo.seal()
        this.commit(type === 'todo' ? 'Format as to-do' : 'Format as bullet', (tx) => {
          tx.update(id, { type, done, text: item.text.slice(match[0].length) })
          return { id, start: 0 }
        })
        return
      }
    }
  }

  onGhostInput(date: ISODate, el: HTMLElement): void {
    if (this.composing) return
    const text = (el.textContent ?? '').replace(/[\r\n]+/g, ' ')
    if (!text) return
    const offset = getOffsets(el)?.start ?? text.length
    el.textContent = ''
    // The new item's id is minted up front so the typing that follows coalesces
    // with its creation into a single undo step.
    const id = uuidv7()
    this.undo.seal()
    this.commit(
      'Typing',
      (tx) => {
        tx.create({ id, date, text })
        tx.place([id], date, null, 'end')
        return { id, start: offset }
      },
      { coalesce: `text:${id}`, before: { kind: 'text', id: ghostId(date), start: 0, end: 0 } }
    )
    const created = this.els.get(id)
    if (created) this.autoformat(id, created)
  }

  onCompositionStart(): void {
    this.composing = true
  }

  onCompositionEnd(id: string, el: HTMLElement): void {
    this.composing = false
    if (isGhost(id)) this.onGhostInput(ghostDate(id), el)
    else this.onItemInput(id, el)
  }

  /* =========================================================== Clipboard */

  onItemPaste(e: React.ClipboardEvent<HTMLElement>, id: string): void {
    const text = e.clipboardData.getData('text/plain')
    e.preventDefault()
    if (!text) return
    const el = this.els.get(id)
    const item = itemStore.get(id)
    if (!el || !item) return
    const lines = parseMarkdownLines(text)
    const offsets = getOffsets(el) ?? { start: item.text.length, end: item.text.length }
    if (lines.length > 1 || (lines.length === 1 && item.text === '' && lines[0].type !== 'text')) {
      this.undo.seal()
      this.commit('Paste', (tx) => ops.pasteLines(tx, id, offsets.start, offsets.end, lines))
      return
    }
    document.execCommand('insertText', false, text.replace(/[\r\n]+/g, ' ').trim())
  }

  onGhostPaste(e: React.ClipboardEvent<HTMLElement>, date: ISODate): void {
    const text = e.clipboardData.getData('text/plain')
    e.preventDefault()
    const lines = parseMarkdownLines(text)
    if (!lines.length) return
    this.insertLines(date, null, lines)
  }

  private insertLines(date: ISODate, afterId: string | null, lines: LineSpec[]): void {
    this.undo.seal()
    this.commit('Paste', (tx) => {
      const created = ops.insertLinesAfter(tx, date, afterId, lines)
      const last = created[created.length - 1]
      return last ? { id: last, start: tx.get(last)!.text.length } : null
    })
  }

  private markdownFor(ids: string[]): string {
    if (!ids.length) return ''
    const date = itemStore.get(ids[0])!.date
    const set = new Set(ids)
    const rows = itemStore.outline(date).filter((r) => set.has(r.id))
    const base = Math.min(...rows.map((r) => r.depth))
    return linesToMarkdown(
      rows.map((r) => {
        const item = itemStore.get(r.id)!
        return { depth: r.depth - base, type: item.type, done: item.done, text: item.text }
      })
    )
  }

  async copyBlocks(cut: boolean): Promise<void> {
    const ids = this.selectedIds()
    if (!ids.length) return
    await backend.clipboardWrite(this.markdownFor(ids))
    const live = ids.filter((id) => itemStore.get(id))
    if (cut && live.length) this.deleteTargets(live, 'Cut')
  }

  async pasteBlocks(): Promise<void> {
    const selection = ui.get().selection
    if (selection.kind !== 'blocks') return
    const lines = parseMarkdownLines(await backend.clipboardRead())
    if (!lines.length) return
    const ids = this.selectedIds(selection)
    const roots = new Tx(itemStore).roots(ids)
    this.insertLines(selection.date, roots[roots.length - 1] ?? null, lines)
  }

  /** DOM copy/cut events while a block selection is active (e.g. from the Edit menu). */
  onDocumentClipboard = (e: ClipboardEvent): void => {
    if (ui.get().selection.kind !== 'blocks' || isTextInput(e.target)) return
    const ids = this.selectedIds()
    if (!ids.length) return
    if (e.type === 'paste') {
      e.preventDefault()
      const lines = parseMarkdownLines(e.clipboardData?.getData('text/plain') ?? '')
      const selection = ui.get().selection as Extract<Selection, { kind: 'blocks' }>
      const roots = new Tx(itemStore).roots(ids)
      if (lines.length) this.insertLines(selection.date, roots[roots.length - 1] ?? null, lines)
      return
    }
    e.preventDefault()
    e.clipboardData?.setData('text/plain', this.markdownFor(ids))
    if (e.type === 'cut') this.deleteTargets(ids, 'Cut')
  }

  /* ============================================================ Commands */

  execute(id: string, source: 'key' | 'menu' | 'palette' = 'palette'): void {
    // A menu key equivalent and the page's own key handler can both fire for one
    // press, in either order. Ignore the echo from the other source.
    const now = performance.now()
    const last = this.lastExecuted
    if (source !== 'palette' && last.id === id && last.source !== source && now - last.at < 200) return
    this.lastExecuted = { id, at: now, source }

    // Menu commands act on the document, so an open overlay steps aside first.
    const overlayCommands = ['palette.open', 'search.open', 'help.shortcuts', 'app.settings', 'app.about', 'edit.undo', 'edit.redo']
    if (source === 'menu' && ui.get().overlay && COMMANDS_BY_ID[id] && !overlayCommands.includes(id)) this.closeOverlay()

    const { today } = ui.get()
    switch (id) {
      case 'palette.open':
        this.toggleOverlay({ kind: 'palette', mode: 'commands' })
        return
      case 'search.open':
        this.toggleOverlay({ kind: 'palette', mode: 'search' })
        return
      case 'help.shortcuts':
        this.toggleOverlay({ kind: 'shortcuts' })
        return
      case 'app.settings':
        this.openOverlay({ kind: 'settings' })
        return
      case 'app.about':
        this.openOverlay({ kind: 'about' })
        return
      case 'go.today':
        void this.navigate({ mode: 'day', date: today })
        return
      case 'go.tomorrow':
        void this.navigate({ mode: 'day', date: addDays(today, 1) })
        return
      case 'go.week':
        void this.navigate({ mode: 'week' })
        return
      case 'go.prevDay':
      case 'go.nextDay': {
        const view = ui.get().view
        const target = this.targets()[0]
        const base = view.mode === 'day' ? view.date : (target ? itemStore.get(target)!.date : today)
        void this.navigate({ mode: 'day', date: addDays(base, id === 'go.prevDay' ? -1 : 1) })
        return
      }
      case 'go.date':
        this.openOverlay({ kind: 'palette', mode: 'date', dateAction: 'go' })
        return
      case 'edit.undo':
      case 'edit.redo':
        if (isTextInput(document.activeElement)) {
          document.execCommand(id === 'edit.undo' ? 'undo' : 'redo')
          return
        }
        if (id === 'edit.undo') this.undoAction()
        else this.redoAction()
        return
      case 'item.create':
        this.createItem()
        return
      case 'move.date':
        if (!this.targets().length) return
        this.openOverlay({ kind: 'palette', mode: 'date', dateAction: 'move' })
        return
      case 'export.markdown':
        void backend.exportMarkdown().then((r) => {
          if (r.ok) showToast(`Exported ${r.count} ${r.count === 1 ? 'day' : 'days'} as Markdown`)
          else if (r.error) showToast(r.error)
        })
        return
      case 'export.json':
        void backend.exportJSON().then((r) => {
          if (r.ok) showToast('Backup saved')
          else if (r.error) showToast(r.error)
        })
        return
      case 'import.json':
        void backend.importJSON().then((r) => {
          if (r.ok) showToast(r.applied ? `Imported ${r.applied} ${r.applied === 1 ? 'item' : 'items'}` : 'Nothing new to import')
          else if (r.error) showToast(r.error)
        })
        return
      case 'app.revealData':
        void backend.revealDataFolder()
        return
      case 'sync.now':
        if (!syncState.get().email) {
          this.openOverlay({ kind: 'settings' })
          return
        }
        void backend.sync.syncNow().then((r) => showToast(r.ok ? 'Synced' : r.error))
        return
      case 'theme.system':
      case 'theme.light':
      case 'theme.dark':
        void this.updateSettings({ theme: id.slice('theme.'.length) as Settings['theme'] })
        return
    }

    const ids = this.targets()
    if (!ids.length) return
    const keep = { keepSelection: true }
    switch (id) {
      case 'item.toggleDone':
        this.commit('Complete', (tx) => void ops.toggleDone(tx, ids), keep)
        return
      case 'item.toggleTodo':
        this.commit('Convert', (tx) => ops.toggleTodo(tx, ids), keep)
        return
      case 'item.toText':
      case 'item.toBullet':
      case 'item.toTodo': {
        const type = ({ 'item.toText': 'text', 'item.toBullet': 'bullet', 'item.toTodo': 'todo' } as const)[id]
        this.commit('Convert', (tx) => ops.setType(tx, ids, type), keep)
        return
      }
      case 'item.indent':
        this.commit('Indent', (tx) => void ops.indent(tx, ids), keep)
        return
      case 'item.outdent':
        this.commit('Outdent', (tx) => void ops.outdent(tx, ids), keep)
        return
      case 'item.moveUp':
      case 'item.moveDown':
        this.commit('Move', (tx) => void ops.moveVertical(tx, ids, id === 'item.moveUp' ? -1 : 1), keep)
        return
      case 'item.delete':
        this.deleteTargets(ids)
        return
      case 'item.select': {
        const date = itemStore.get(ids[0])!.date
        this.selectBlocks(date, ids[0], ids[ids.length - 1])
        return
      }
      case 'move.today':
        void this.moveTargets(today)
        return
      case 'move.tomorrow': {
        const from = itemStore.get(ids[0])!.date
        const tomorrow = addDays(today, 1)
        void this.moveTargets(from < tomorrow ? tomorrow : addDays(from, 1))
        return
      }
      case 'move.nextWeekday':
        void this.moveTargets(nextWeekday(today))
        return
      case 'move.nextWeek':
        void this.moveTargets(addDays(startOfWeek(today, ui.get().settings.weekStartsOn), 7))
        return
    }
  }

  private createItem(): void {
    const ids = this.targets()
    const selection = ui.get().selection
    if (ids.length && selection.kind === 'text') {
      const id = ids[0]
      const length = itemStore.get(id)!.text.length
      this.commit('New line', (tx) => ops.splitAt(tx, id, length))
      return
    }
    this.focusText(ghostId(this.primaryDate()), 0)
  }

  /** Where focus goes after the targeted rows leave their day (delete or move). */
  private focusAfterRemoval(ids: string[]): ops.CaretFocus | SelectionSnapshot {
    const date = itemStore.get(ids[0])!.date
    const rows = itemStore.outline(date)
    // Children leave with their parents, so they can't receive the caret.
    const tx = new Tx(itemStore)
    const set = new Set(ids.flatMap((id) => tx.subtreeIds(id)))
    const first = rows.findIndex((r) => set.has(r.id))
    let last = first
    while (last + 1 < rows.length && set.has(rows[last + 1].id)) last++
    const blocks = ui.get().selection.kind === 'blocks'
    const next = rows.slice(last + 1).find((r) => !set.has(r.id))
    const prev = rows.slice(0, first).reverse().find((r) => !set.has(r.id))
    if (blocks) {
      const pick = next ?? prev
      if (pick) return { kind: 'blocks', date, anchor: pick.id, focus: pick.id }
    }
    if (prev && !next) return { id: prev.id, start: itemStore.get(prev.id)!.text.length }
    if (next) return { id: next.id, start: blocks ? itemStore.get(next.id)!.text.length : 0 }
    if (prev) return { id: prev.id, start: itemStore.get(prev.id)!.text.length }
    return { id: ghostId(date), start: 0 }
  }

  deleteTargets(ids: string[], label = 'Delete'): void {
    if (!ids.length) return
    const focus = this.focusAfterRemoval(ids)
    this.commit(label, (tx) => {
      ops.remove(tx, ids)
      return focus
    })
  }

  async moveTargets(date: ISODate): Promise<void> {
    const ids = this.targets()
    if (!ids.length) return
    const source = itemStore.get(ids[0])!.date
    const today = ui.get().today
    if (source === date) {
      showToast(`Already on ${friendlyDate(date, today)}`)
      return
    }
    const before = this.snapshot()
    await itemStore.ensureLoaded([date])
    const live = ids.filter((id) => itemStore.get(id))
    if (!live.length) return
    const focus = this.focusAfterRemoval(live)
    const moved = this.commit(
      'Move',
      (tx) => {
        const roots = ops.moveToDate(tx, live, date)
        return roots.length ? focus : null
      },
      { before }
    )
    if (moved) {
      const label = friendlyDate(date, today).replace(/^(Today|Tomorrow|Yesterday)$/, (m) => m.toLowerCase())
      showToast(`Moved to ${label}`, { undo: true })
      this.toastEntry = this.undo.top()
    }
  }

  /* ========================================================== Navigation */

  private rememberFocus(): void {
    const memo = this.lastText
    if (!memo) return
    const date = this.dateOf(memo.id)
    if (date) this.lastFocusByDate.set(date, memo)
  }

  async navigate(view: View, options: { focus?: FocusResult } = {}): Promise<void> {
    const seq = ++this.navigationSeq
    this.rememberFocus()
    await itemStore.ensureLoaded(this.datesFor(view))
    // A later navigation started while this one was loading; it wins.
    if (seq !== this.navigationSeq) return
    const current = ui.get().view
    const changed = current.mode !== view.mode || (view.mode === 'day' && current.mode === 'day' && current.date !== view.date)
    flushSync(() => {
      ui.set({ view, selection: { kind: 'none' } })
    })
    if (changed) {
      const scroller = document.querySelector('.scroller')
      if (scroller) scroller.scrollTop = 0
    }
    if (options.focus) {
      this.applyFocus(options.focus)
      // The target may have moved or gone; never leave the caret nowhere.
      const active = document.activeElement as HTMLElement | null
      if (!active || (!active.isContentEditable && active !== this.sink)) this.focusDefault()
    } else if (this.lastText && this.isVisible(this.lastText.id)) {
      this.focusText(this.lastText.id, this.lastText.start, this.lastText.end)
    } else this.focusDefault()
    refreshCaret()
    this.prefetch(view)
  }

  private prefetch(view: View): void {
    const { today } = ui.get()
    const around = view.mode === 'day' ? [addDays(view.date, -1), addDays(view.date, 1)] : [addDays(today, -1)]
    void itemStore.ensureLoaded(around)
  }

  /** Open a search result: its day (keeping the week view if it's visible), caret on the match. */
  async openItem(id: string, date: ISODate, match: [number, number]): Promise<void> {
    const inWeek = ui.get().view.mode === 'week' && this.datesFor({ mode: 'week' }).includes(date)
    const view: View = inWeek ? { mode: 'week' } : { mode: 'day', date }
    await this.navigate(view, { focus: { id, start: match[1] } })
    const el = this.els.get(id)
    if (el) flash(el, match[0], match[1])
  }

  /* ============================================================ Overlays */

  openOverlay(overlay: NonNullable<ReturnType<typeof ui.get>['overlay']>): void {
    if (ui.get().selection.kind !== 'blocks') this.lastText = this.snapshotText() ?? this.lastText
    ui.set({ overlay })
  }

  private snapshotText(): CaretMemo | null {
    const s = this.snapshot()
    return s.kind === 'text' ? { id: s.id, start: s.start, end: s.end } : null
  }

  toggleOverlay(overlay: NonNullable<ReturnType<typeof ui.get>['overlay']>): void {
    const current = ui.get().overlay
    if (current && current.kind === overlay.kind && (current.kind !== 'palette' || (overlay.kind === 'palette' && current.mode === overlay.mode))) {
      this.closeOverlay()
      return
    }
    this.openOverlay(overlay)
  }

  closeOverlay(): void {
    if (!ui.get().overlay) return
    flushSync(() => ui.set({ overlay: null }))
    this.restoreFocus()
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const settings = await backend.setSettings(patch)
    // Load any newly visible days first so the week never flashes empty.
    await itemStore.ensureLoaded(this.datesFor(ui.get().view, ui.get().today, settings))
    ui.set({ settings })
  }

  /* ================================================================ Init */

  async init(): Promise<void> {
    const settings = await backend.getSettings()
    ui.set({ settings, today: todayISO() })
    await itemStore.ensureLoaded([...this.visibleDates(), addDays(ui.get().today, -1)])

    window.addEventListener('keydown', this.onGlobalKeyDown)
    document.addEventListener('selectionchange', this.onSelectionChange)
    document.addEventListener('copy', this.onDocumentClipboard)
    document.addEventListener('cut', this.onDocumentClipboard)
    document.addEventListener('paste', this.onDocumentClipboard)
    window.addEventListener('beforeunload', () => itemStore.persistence.flushSync())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void itemStore.persistence.flush()
      this.checkToday()
    })
    window.addEventListener('focus', () => this.checkToday())
    backend.onCommand((id) => this.execute(id, 'menu'))
    backend.onItemsChanged((items) => itemStore.applyExternal(items))
    setInterval(() => this.checkToday(), 30_000)
  }

  /** Keep "today" correct when the app stays open past midnight. */
  private checkToday(): void {
    const today = todayISO()
    if (today === ui.get().today) return
    void itemStore.ensureLoaded(this.datesFor({ mode: 'week' }, today)).then(() => ui.set({ today }))
  }
}

export const controller = new EditorController()
