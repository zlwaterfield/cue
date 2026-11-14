import { useCallback, useSyncExternalStore } from 'react'
import { addDays } from '@shared/dates'
import type { ISODate } from '@shared/types'
import { backend } from '../data/backend'
import { itemStore } from '../store/items'
import { Store, useStore, type View } from '../store/ui'

/**
 * PROTOTYPE — Notes: scratch, and the few notes starred to keep, one page at a time, beside
 * Today and Week. Not for merging as is.
 *
 * A note is a page of ordinary lines, so the whole editor, undo, search and export work on
 * it untouched. To get there without a schema change, a note's page borrows a date nobody
 * writes on: the year 1000. The real thing would give a page an id of its own (two devices
 * starring at once would pick the same day here).
 */

export const SCRATCH: ISODate = '1000-01-01'
const FIRST_NOTE: ISODate = '1000-01-02'
const LAST_NOTE: ISODate = '1000-12-31'

export const isNotePage = (date: ISODate): boolean => date.startsWith('1000-')

// A page that hosts a build can ask for the demo: `window.__cueProto = 'seed=1'`.
const hosted = (globalThis as { __cueProto?: string }).__cueProto
const params = new URLSearchParams(hosted ?? location.search)

/** `?phone=1` swaps the title bar for a sketch of the iPhone header, for screenshots. */
export const phoneSketch = params.get('phone') === '1'
export const seedDemo = params.get('seed') === '1'

export interface NotesState {
  /** Every starred page seen this session, oldest first; ones with no lines left aren't shown. */
  known: ISODate[]
  /** Where ⌘E came from, to go back to. */
  back: View | null
  /** The note last open, which ⌘4 opens again. */
  last: ISODate
}

export const notes = new Store<NotesState>({ known: [], back: null, last: SCRATCH })

/** Load scratch and every starred page, so they're on hand like the week is. */
export async function loadNotes(): Promise<void> {
  const known = await backend.datesWithItems(FIRST_NOTE, LAST_NOTE)
  await itemStore.ensureLoaded([SCRATCH, ...known])
  notes.set({ known })
}

let pagesCache: ISODate[] = [SCRATCH]

/** Scratch, then the starred notes that still have something on them, newest first. */
export function notePages(): ISODate[] {
  // Newest first: a note just starred stays right under scratch, where it was written.
  const pages = [SCRATCH, ...notes.get().known.filter((date) => itemStore.outline(date).length > 0).reverse()]
  if (pages.join() !== pagesCache.join()) pagesCache = pages
  return pagesCache
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
  const { known } = notes.get()
  const date = known.length ? addDays(known[known.length - 1], 1) : FIRST_NOTE
  await itemStore.ensureLoaded([date])
  notes.set({ known: [...known, date] })
  return date
}

/** A starred note is named by its first line. */
export function noteTitle(date: ISODate): string {
  if (date === SCRATCH) return 'Scratch'
  const first = itemStore.outline(date)[0]
  return (first && itemStore.get(first.id)?.text.trim()) || 'Untitled'
}

export function pageLabel(date: ISODate): string {
  return date === SCRATCH ? 'Scratch' : `★ ${noteTitle(date)}`
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
