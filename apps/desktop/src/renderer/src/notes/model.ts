import { useCallback, useSyncExternalStore } from 'react'
import * as shared from '@shared/notes'
import { FIRST_NOTE, LAST_NOTE, SCRATCH } from '@shared/notes'
import type { ISODate, Item } from '@shared/types'
import { backend } from '../data/backend'
import { itemStore } from '../store/items'
import { Store, useStore, type View } from '../store/ui'

/**
 * Notes on the Mac: scratch and the few starred notes, one page at a time, beside Today and
 * Week. What a note is, and where its page is kept, is `core/notes.ts`; this is the list of
 * them the window shows.
 */

export { isNotePage, SCRATCH } from '@shared/notes'

export interface NotesState {
  /** Every starred note's page: the stored ones, and ones starred or synced in since. */
  known: ISODate[]
  /** Where ⌘E came from, to go back to. */
  back: View | null
  /** The note last open, which ⌘4 opens again. */
  last: ISODate
}

export const notes = new Store<NotesState>({ known: [], back: null, last: SCRATCH })

/** Load scratch and every starred note, so they're on hand like the week is. */
export async function loadNotes(): Promise<void> {
  const known = await backend.datesWithItems(FIRST_NOTE, LAST_NOTE)
  await itemStore.ensureLoaded([SCRATCH, ...known])
  notes.set({ known })
  backend.onItemsChanged((items) => void notice(items))
}

/** A note starred on another device arrives as lines on a page this window hasn't seen. */
async function notice(items: Item[]): Promise<void> {
  const fresh = shared.notePagesOf(items).filter((date) => !notes.get().known.includes(date))
  if (!fresh.length) return
  await itemStore.ensureLoaded(fresh)
  notes.set((state) => ({ known: [...new Set([...state.known, ...fresh])] }))
}

let pages: ISODate[] = [SCRATCH]

/** Scratch, then the starred notes, newest first. */
export function notePages(): ISODate[] {
  const next = shared.notePages(itemStore, notes.get().known)
  // The same array while nothing changed, for `useSyncExternalStore`.
  if (next.join() !== pages.join()) pages = next
  return pages
}

/** The notes there are to switch between, following every star and delete. */
export function useNotePages(): ISODate[] {
  const known = useStore(notes, (s) => s.known)
  const subscribe = useCallback(
    (listener: () => void) => {
      const offs = known.map((date) => itemStore.subscribeDate(date, listener))
      return () => offs.forEach((off) => off())
    },
    [known]
  )
  return useSyncExternalStore(subscribe, notePages)
}

/** A page for a new starred note. */
export async function newNotePage(): Promise<ISODate> {
  const date = shared.newNotePage(notes.get().known)
  await itemStore.ensureLoaded([date])
  notes.set((state) => ({ known: [...state.known, date] }))
  return date
}

export function noteTitle(date: ISODate): string {
  return shared.noteTitle(itemStore, date)
}

/** A note's name, following edits to its first line. */
export function useNoteTitle(date: ISODate): string {
  const subscribe = useCallback(
    (listener: () => void) => {
      let offItem = (): void => {}
      const watch = (): void => {
        offItem()
        const first = itemStore.outline(date)[0]
        offItem = first ? itemStore.subscribeItem(first.id, listener) : () => {}
      }
      watch()
      const offDate = itemStore.subscribeDate(date, () => {
        watch()
        listener()
      })
      return () => {
        offDate()
        offItem()
      }
    },
    [date]
  )
  return useSyncExternalStore(subscribe, () => noteTitle(date))
}
