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
  if (view.mode === 'notes' && currentPage() === SCRATCH) {
    void controller.navigate(notes.get().back ?? { mode: 'week' }, { focus: returnTo })
    return
  }
  if (view.mode !== 'notes') {
    notes.set({ back: view })
    returnTo = controller.snapshot()
  }
  void controller.navigate({ mode: 'notes' }, { focus: { id: ghostId(SCRATCH), start: 0 } })
}

/** ⇧⌘S: scratch becomes a starred note, named by its first line, and scratch is empty again. */
async function star(): Promise<void> {
  if (ui.get().view.mode !== 'notes' || currentPage() !== SCRATCH) {
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
      // The caret waits at the end of the name, in case it wants changing.
      return { id: first, start: tx.get(first)!.text.length }
    },
    { before }
  )
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
    return { id: ghostId(SCRATCH), start: 0 }
  })
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

/** ⌘[ and ⌘] on the Notes page: the caret steps to the note above or below. */
export function stepNote(direction: -1 | 1): void {
  const pages = notePages()
  const next = pages[pages.indexOf(currentPage()) + direction]
  if (!next) return
  const first = itemStore.outline(next)[0]
  if (first) controller.focusEnd(first.id)
  else controller.focusText(ghostId(next), 0)
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
