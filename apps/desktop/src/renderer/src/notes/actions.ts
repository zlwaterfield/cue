import { flushSync } from 'react-dom'
import * as ops from '@shared/editor/ops'
import type { SelectionSnapshot } from '@shared/editor/undo'
import type { ISODate } from '@shared/types'
import { controller, ghostId } from '../editor/controller'
import { itemStore } from '../store/items'
import { showToast, ui } from '../store/ui'
import { isNotePage, newNotePage, notes, noteTitle, SCRATCH, setVariant, type Variant } from './model'

/** PROTOTYPE — what ⌘E, ⇧⌘E and ⇧⌘S do in each variant. */

const NAMES: Record<Variant, string> = { off: 'Off', pages: 'Pages', margin: 'Margin', pad: 'Pad' }

/** Margin: the caret's place in the day, to return to when the panel closes. */
let returnTo: SelectionSnapshot | null = null

const inMargin = (): boolean => !!document.activeElement?.closest('.margin')

/** Put the caret on a note's blank last line, ready for more. */
function focusNote(date: ISODate): void {
  controller.focusText(ghostId(date), 0)
}

/** The page a command is about: the caret's, else the one on screen. */
function currentPage(): ISODate {
  const target = controller.targets()[0]
  const active = document.activeElement?.closest<HTMLElement>('[data-date]')?.dataset.date
  if (active) return active
  if (target) return itemStore.get(target)!.date
  const { view, today } = ui.get()
  return view.mode === 'day' ? view.date : today
}

export function openNote(date: ISODate): void {
  const { variant } = notes.get()
  flushSync(() => ui.set({ overlay: null }))
  if (variant === 'margin') {
    if (!notes.get().marginOpen) returnTo = controller.snapshot()
    flushSync(() => notes.set({ marginOpen: true }))
    focusNote(date)
    document.querySelector(`.margin [data-day="${date}"]`)?.scrollIntoView({ block: 'nearest' })
    return
  }
  const view = ui.get().view
  if (!(view.mode === 'day' && isNotePage(view.date))) notes.set({ back: view })
  void controller.navigate({ mode: 'day', date })
}

function toggleScratch(): void {
  const { variant } = notes.get()
  if (variant === 'pad') {
    controller.toggleOverlay({ kind: 'pad' })
    return
  }
  if (ui.get().overlay) flushSync(() => ui.set({ overlay: null }))
  if (variant === 'margin') {
    if (notes.get().marginOpen && inMargin()) closeMargin()
    else openNote(SCRATCH)
    return
  }
  const view = ui.get().view
  if (view.mode === 'day' && view.date === SCRATCH) void controller.navigate(notes.get().back ?? { mode: 'week' })
  else openNote(SCRATCH)
}

export function closeMargin(): void {
  flushSync(() => notes.set({ marginOpen: false }))
  if (returnTo) controller.restore(returnTo)
  if (!document.activeElement?.closest('.row')) controller.focusDefault()
  returnTo = null
}

/** Show a note after its lines arrived there. */
function land(date: ISODate): void {
  if (notes.get().variant === 'pages') void controller.navigate({ mode: 'day', date })
  else focusNote(date)
}

async function star(): Promise<void> {
  const page = currentPage()
  const before = controller.snapshot()
  // Scratch becomes a starred note, and scratch is empty again.
  if (page === SCRATCH) {
    const ids = itemStore.outline(SCRATCH).map((row) => row.id)
    if (!ids.length) {
      showToast('Nothing in scratch to star')
      return
    }
    const to = await newNotePage()
    controller.commit('Star', (tx) => void ops.moveToDate(tx, ids, to), { before })
    land(to)
    controller.toastUndo(`Starred “${noteTitle(to)}”`)
    return
  }
  // A starred note goes back to scratch: nothing is ever deleted by unstarring.
  if (isNotePage(page)) {
    const title = noteTitle(page)
    const ids = itemStore.outline(page).map((row) => row.id)
    controller.commit('Unstar', (tx) => void ops.moveToDate(tx, ids, SCRATCH), { before })
    land(SCRATCH)
    controller.toastUndo(`Unstarred “${title}”. It’s in scratch`)
    return
  }
  // On a day: the line (or the selected lines) leaves the day and becomes a starred note.
  const ids = controller.targets()
  if (!ids.length) return
  const focus = controller.focusAfterRemoval(ids)
  const to = await newNotePage()
  controller.commit(
    'Star',
    (tx) => {
      ops.moveToDate(tx, ids, to)
      return focus
    },
    { before }
  )
  controller.toastUndo(`Starred “${noteTitle(to)}”`)
}

function clearScratch(): void {
  const ids = itemStore.outline(SCRATCH).map((row) => row.id)
  if (!ids.length) {
    showToast('Scratch is already empty')
    return
  }
  const shown = controller.visibleDates().includes(SCRATCH)
  controller.commit('Clear scratch', (tx) => {
    ops.remove(tx, ids)
    return shown ? { id: ghostId(SCRATCH), start: 0 } : controller.snapshot()
  })
  controller.toastUndo('Scratch cleared')
}

/** A new starred note named `title`, opened with the caret on its second line. */
export async function createNote(title: string): Promise<void> {
  const to = await newNotePage()
  controller.commit('New note', (tx) => void tx.create({ date: to, text: title }))
  openNote(to)
}

export function runNotesCommand(id: string): void {
  if (id.startsWith('proto.')) {
    const variant = id.slice('proto.'.length) as Variant
    const view = ui.get().view
    flushSync(() => ui.set({ overlay: null }))
    setVariant(variant)
    if (view.mode === 'day' && isNotePage(view.date)) void controller.navigate({ mode: 'week' })
    else controller.restoreFocus()
    showToast(`Notes prototype: ${NAMES[variant]}`)
    return
  }
  const { variant } = notes.get()
  if (variant === 'off') return
  switch (id) {
    case 'notes.scratch':
      toggleScratch()
      return
    case 'notes.list':
      if (variant === 'pad') controller.toggleOverlay({ kind: 'pad' })
      else controller.toggleOverlay({ kind: 'notes' })
      return
    case 'notes.star':
      if (variant !== 'pad') void star()
      return
    case 'notes.clear':
      if (variant !== 'pad') clearScratch()
      return
  }
}
