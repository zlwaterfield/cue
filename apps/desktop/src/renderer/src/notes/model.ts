import { useCallback, useSyncExternalStore } from 'react'
import { addDays } from '@shared/dates'
import type { ISODate } from '@shared/types'
import { backend } from '../data/backend'
import { itemStore } from '../store/items'
import { Store, useStore, type View } from '../store/ui'

/**
 * PROTOTYPE — scratch and starred notes, three ways (see `Variant`). Not for merging as is.
 *
 * Pages and Margin keep a note as a page of ordinary lines, so the whole editor, undo,
 * search and export work on it untouched. To get there without a schema change, a note's
 * page borrows a date nobody writes on: the year 1000. The real thing would give a page an id
 * of its own (two devices starring at once would pick the same day here).
 */

/** `off` is Cue as it ships. */
export type Variant = 'off' | 'pages' | 'margin' | 'pad'
export const VARIANTS: readonly Variant[] = ['off', 'pages', 'margin', 'pad']

export const SCRATCH: ISODate = '1000-01-01'
const FIRST_NOTE: ISODate = '1000-01-02'
const LAST_NOTE: ISODate = '1000-12-31'

export const isNotePage = (date: ISODate): boolean => date.startsWith('1000-')

// A page that hosts a build can say which variant to show: `window.__cueProto = 'notes=pages&seed=1'`.
const hosted = (globalThis as { __cueProto?: string }).__cueProto
const params = new URLSearchParams(hosted ?? location.search)
const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function initialVariant(): Variant {
  const asked = params.get('notes') ?? stored('cue-notes-proto')
  return VARIANTS.includes(asked as Variant) ? (asked as Variant) : 'off'
}

/** `?phone=1` swaps the title bar for a sketch of the iPhone header, for screenshots. */
export const phoneSketch = params.get('phone') === '1'
export const seedDemo = params.get('seed') === '1'

export interface NotesState {
  variant: Variant
  /** Every note page seen this session, in order; ones with no lines left aren't listed. */
  known: ISODate[]
  /** Margin: the panel beside the day is open. */
  marginOpen: boolean
  /** Pages: where ⌘E came from, to go back to. */
  back: View | null
}

export const notes = new Store<NotesState>({ variant: initialVariant(), known: [], marginOpen: false, back: null })

export function setVariant(variant: Variant): void {
  try {
    localStorage.setItem('cue-notes-proto', variant)
  } catch {
    // ignore
  }
  notes.set({ variant, marginOpen: false, back: null })
}

/** Load scratch and every starred page, so they're on hand like the week is. */
export async function loadNotes(): Promise<void> {
  const known = await backend.datesWithItems(FIRST_NOTE, LAST_NOTE)
  await itemStore.ensureLoaded([SCRATCH, ...known])
  notes.set({ known })
}

/** Starred pages that still have something on them. */
export function starredPages(): ISODate[] {
  return notes.get().known.filter((date) => itemStore.outline(date).length > 0)
}

/** Scratch, then the starred pages: the order ⌘[ and ⌘] step through. */
export function notePages(): ISODate[] {
  return [SCRATCH, ...starredPages()]
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

let listCache: { key: string; value: Array<{ date: ISODate; title: string; lines: number }> } = { key: '', value: [] }

/** Scratch and the starred notes with their titles, following every edit. */
export function useNoteList(): Array<{ date: ISODate; title: string; lines: number }> {
  const known = useStore(notes, (s) => s.known)
  const subscribe = useCallback(
    (listener: () => void) => {
      const offs = [SCRATCH, ...known].map((date) => itemStore.subscribeDate(date, listener))
      // A title is the first line's text, which changes without the outline changing.
      const offItems = [SCRATCH, ...known].map((date) => {
        const first = itemStore.outline(date)[0]
        return first ? itemStore.subscribeItem(first.id, listener) : () => {}
      })
      return () => [...offs, ...offItems].forEach((off) => off())
    },
    [known]
  )
  return useSyncExternalStore(subscribe, () => {
    const value = notePages().map((date) => ({ date, title: noteTitle(date), lines: itemStore.outline(date).length }))
    const key = JSON.stringify(value)
    if (key !== listCache.key) listCache = { key, value }
    return listCache.value
  })
}

/* ------------------------------------------------------------------ Pad */

/**
 * The Pad keeps a note as one piece of plain text, not lines, so it needs storage of its
 * own; here that's localStorage. The real thing would be a small table that syncs.
 */
export interface PadNote {
  id: string
  text: string
}

export interface PadState {
  /** `notes[0]` is scratch; the rest are starred. */
  notes: PadNote[]
  current: string
}

function loadPad(): PadState {
  try {
    const raw = stored('cue-notes-pad')
    if (raw) return JSON.parse(raw) as PadState
  } catch {
    // ignore
  }
  return { notes: [{ id: 'scratch', text: '' }], current: 'scratch' }
}

export const pad = new Store<PadState>(loadPad())

pad.subscribe(() => {
  try {
    localStorage.setItem('cue-notes-pad', JSON.stringify(pad.get()))
  } catch {
    // ignore
  }
})

export const padTitle = (note: PadNote): string => (note.id === 'scratch' ? 'Scratch' : note.text.split('\n')[0].trim() || 'Untitled')
