import * as ops from '@shared/editor/ops'
import { friendlyDate } from '@shared/dates'
import type { SelectionSnapshot } from '@shared/editor/undo'
import type { ISODate } from '@shared/types'
import { backend } from '../data/backend'
import { controller, ghostId } from '../editor/controller'
import { itemStore } from '../store/items'
import { showToast, ui } from '../store/ui'
import { isNotePage, newNotePage, notePages, notes, noteTitle, SCRATCH } from './model'

/** PROTOTYPE — what the Notes commands do. */

/** The page the caret is on, else the first one on screen. */
export function currentPage(): ISODate {
  const active = document.activeElement?.closest<HTMLElement>('[data-date]')?.dataset.date
  if (active) return active
  const target = controller.targets()[0]
  if (target) return itemStore.get(target)!.date
  return controller.primaryDate()
}

/** The caret's place when ⌘E was pressed, to put it back exactly. */
let returnTo: SelectionSnapshot | null = null

/** ⌘E: to scratch from anywhere, ready to type; again, back to where it was pressed. */
function toggleScratch(): void {
  const view = ui.get().view
  if (view.mode === 'notes' && view.date === SCRATCH) {
    void controller.navigate(notes.get().back ?? { mode: 'week' }, { focus: returnTo })
    return
  }
  if (view.mode !== 'notes') {
    notes.set({ back: view })
    returnTo = controller.snapshot()
  }
  void controller.navigate({ mode: 'notes', date: SCRATCH }, { focus: { id: ghostId(SCRATCH), start: 0 } })
}

/** ⇧⌘S: scratch becomes a starred note, named by its first line, and scratch is empty again. */
async function star(): Promise<void> {
  const view = ui.get().view
  if (view.mode !== 'notes' || view.date !== SCRATCH) {
    showToast('Star keeps what’s in scratch. ⌘E opens it')
    return
  }
  const rows = itemStore.outline(SCRATCH)
  if (!rows.length) {
    showToast('Nothing in scratch to star')
    return
  }
  const before = controller.snapshot()
  const to = await newNotePage()
  const first = rows[0].id
  controller.commit(
    'Star',
    (tx) => {
      ops.moveToDate(
        tx,
        rows.map((row) => row.id),
        to
      )
      return null
    },
    { before }
  )
  // The note opens with the caret at the end of its name, in case it wants changing.
  await controller.navigate({ mode: 'notes', date: to }, { focus: { id: first, start: itemStore.get(first)!.text.length } })
  controller.toastUndo(`Starred “${noteTitle(to)}”`)
}

/** ⌥⌘⌫: empty scratch, or delete the starred note the caret is in. Undo brings either back. */
function discard(): void {
  const page = currentPage()
  if (!isNotePage(page)) return
  const ids = itemStore.outline(page).map((row) => row.id)
  if (!ids.length) {
    if (page === SCRATCH) showToast('Scratch is already empty')
    return
  }
  const title = noteTitle(page)
  controller.commit(page === SCRATCH ? 'Clear scratch' : 'Delete note', (tx) => {
    ops.remove(tx, ids)
    return page === SCRATCH ? { id: ghostId(SCRATCH), start: 0 } : null
  })
  // With the note gone, scratch is the page left to show.
  if (page !== SCRATCH) void controller.navigate({ mode: 'notes', date: SCRATCH }, { focus: { id: ghostId(SCRATCH), start: 0 } })
  controller.toastUndo(page === SCRATCH ? 'Scratch cleared' : `Deleted “${title}”`)
}

/** ⇧⌘C: the whole page under the caret as Markdown, a day as much as a note. */
async function copyPage(): Promise<void> {
  const page = currentPage()
  const ids = itemStore.outline(page).map((row) => row.id)
  const name = isNotePage(page) ? noteTitle(page) : friendlyDate(page, ui.get().today)
  if (!ids.length) {
    showToast(`Nothing on ${name} to copy`)
    return
  }
  await backend.clipboardWrite(controller.markdownFor(ids))
  showToast(`Copied ${name}`)
}

/** Open a note with the caret on its blank last line, ready for more. */
export function openNote(date: ISODate): void {
  void controller.navigate({ mode: 'notes', date }, { focus: { id: ghostId(date), start: 0 } })
}

/** ⌘[ and ⌘] on a note: the one before or after it. */
export function stepNote(direction: -1 | 1): void {
  const pages = notePages()
  const next = pages[pages.indexOf(currentPage()) + direction]
  if (next) openNote(next)
}

export function runNotesCommand(id: string): void {
  switch (id) {
    case 'notes.scratch':
      toggleScratch()
      return
    case 'notes.star':
      void star()
      return
    case 'notes.discard':
      discard()
      return
    case 'notes.copy':
      void copyPage()
      return
  }
}
