import { useCallback, useSyncExternalStore } from 'react'
import * as shared from '@shared/notes'
import { FIRST_NOTE, LAST_NOTE, SCRATCH } from '@shared/notes'
import type { ISODate } from '@shared/types'
import { itemStore, repo, sync } from './app'
import { Store, useStore } from './store'

/**
 * Notes on the iPhone: scratch and the few starred notes, one page at a time, where a day
 * would be. What a note is, and where its page is kept, is `shared/notes`; this is the list
 * of them the phone shows.
 */

export interface NotesState {
  /** Every starred note's page: the stored ones, and ones starred or synced in since. */
  known: ISODate[]
  /** The note last open, which the Notes tab opens again. */
  last: ISODate
}

const EMPTY: NotesState = { known: [], last: SCRATCH }

export const notes = new Store<NotesState>(EMPTY)

/** Find the starred notes stored on this phone, and have them on hand like the days around today. */
export function refreshNotes(): void {
  const { known } = notes.get()
  const stored = repo.datesWithItems(FIRST_NOTE, LAST_NOTE)
  const fresh = stored.filter((date) => !known.includes(date))
  if (!fresh.length && itemStore.isLoaded(SCRATCH)) return
  void itemStore.ensureLoaded([SCRATCH, ...fresh]).then(() => {
    if (fresh.length) notes.set((state) => ({ known: [...new Set([...state.known, ...fresh])] }))
  })
}

// Another account's notes are never this one's.
itemStore.onReset(() => notes.set(EMPTY))

// A note starred on the Mac arrives with a sync; look again once one finishes.
let syncing = false
sync.state.subscribe(() => {
  const now = sync.state.get().status === 'syncing'
  if (syncing && !now) refreshNotes()
  syncing = now
})

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
