import { addDays, diffDays } from './dates'
import type { Row } from './outline'
import type { ISODate, Item } from './types'

/**
 * Notes: one scratch page, and the few pages starred to keep. They sit beside the days
 * (the Mac's Notes, the iPhone's notes button) and are pages like any day: the same lines,
 * the same editor, undo, search, sync and export.
 *
 * A note has no date, and everything in Cue is filed by date. So a note's page borrows a
 * day nobody writes on: scratch is January 1 of the year 1000, and each starred note is a
 * day picked at random from the hundred years after it. Nothing else has to change for a
 * note to be stored, synced and backed up, and no date anyone can reach in the app (the
 * calendar, "go to", loose ends) comes near them. A random day keeps two devices that star
 * a note at the same moment from landing on the same page.
 *
 * Cue is built around the day; this is for a handful of notes, not a notebook.
 */

export const SCRATCH: ISODate = '1000-01-01'
export const FIRST_NOTE: ISODate = '1000-01-02'
export const LAST_NOTE: ISODate = '1099-12-31'

/** Scratch or a starred note, not a day. */
export function isNotePage(date: ISODate): boolean {
  return date >= SCRATCH && date <= LAST_NOTE
}

/** What notes read from: the item store, or a draft transaction over it. */
export interface NoteSource {
  outline(date: ISODate): Row[]
  get(id: string): Item | undefined
}

/** A starred note is named by its first line. */
export function noteTitle(source: NoteSource, date: ISODate): string {
  if (date === SCRATCH) return 'Scratch'
  const first = source.outline(date)[0]
  return (first && source.get(first.id)?.text.trim()) || 'Untitled'
}

/** When a note was started: its oldest line. */
function writtenAt(source: NoteSource, date: ISODate): number {
  let at = Infinity
  for (const row of source.outline(date)) at = Math.min(at, source.get(row.id)?.createdAt ?? Infinity)
  return at
}

/**
 * The notes to show: scratch, then the starred notes that have something on them, newest
 * first. `known` is every note page there may be (stored ones, and ones started since).
 */
export function notePages(source: NoteSource, known: Iterable<ISODate>): ISODate[] {
  const starred = [...new Set(known)]
    .filter((date) => date !== SCRATCH && isNotePage(date) && source.outline(date).length > 0)
    .map((date) => ({ date, at: writtenAt(source, date) }))
    // Newest first; the date settles a tie so every device shows the same order.
    .sort((a, b) => b.at - a.at || (a.date < b.date ? -1 : 1))
  return [SCRATCH, ...starred.map((note) => note.date)]
}

/** A page for a new starred note: a random free day among those set aside for them. */
export function newNotePage(taken: Iterable<ISODate>, random: () => number = Math.random): ISODate {
  const used = new Set(taken)
  const days = diffDays(FIRST_NOTE, LAST_NOTE) + 1
  for (let tries = 0; tries < 50; tries++) {
    const date = addDays(FIRST_NOTE, Math.floor(random() * days))
    if (!used.has(date)) return date
  }
  // Never reached with a handful of notes; the first free day, for completeness.
  for (let date = FIRST_NOTE; date <= LAST_NOTE; date = addDays(date, 1)) if (!used.has(date)) return date
  throw new Error('No page left for a new note')
}

/** The note pages among some items (ones that arrived from another device, say). */
export function notePagesOf(items: Item[]): ISODate[] {
  return [...new Set(items.filter((item) => item.date !== SCRATCH && isNotePage(item.date)).map((item) => item.date))]
}

/** The note before or after `current` in `pages`, or undefined at either end. */
export function neighborNote(pages: ISODate[], current: ISODate, direction: -1 | 1): ISODate | undefined {
  const index = pages.indexOf(current)
  return index === -1 ? undefined : pages[index + direction]
}

/** A note where a date would be shown (search results, links, "moved to …"): "Scratch", or "Notes". */
export function notePageLabel(date: ISODate): string {
  return date === SCRATCH ? 'Scratch' : 'Notes'
}
