import { addDays } from './dates'
import type { Row } from './outline'
import type { ISODate, Item } from './types'

/**
 * Loose ends: the to-dos left unfinished on earlier days, shown folded at the top of
 * Today on the Mac and the iPhone. They stay on their own days; the list only gathers them.
 */

/** How far back Today looks. Older to-dos are left alone rather than piling up. */
export const LOOSE_ENDS_DAYS = 30

/** The days Today looks at: the last 30, not counting today. */
export function looseEndsRange(today: ISODate): { from: ISODate; to: ISODate } {
  return { from: addDays(today, -LOOSE_ENDS_DAYS), to: addDays(today, -1) }
}

/**
 * The unfinished to-dos on `dates`, oldest day first, in page order. Blank to-dos are
 * skipped. `keep` holds to-dos checked off from the list this session, which stay in it
 * (crossed out) so it doesn't jump under a finger or the pointer.
 */
export function collectLooseEnds(
  store: { outline(date: ISODate): Row[]; get(id: string): Item | undefined },
  dates: ISODate[],
  keep: ReadonlySet<string> = new Set()
): Item[] {
  const out: Item[] = []
  for (const date of [...dates].sort()) {
    for (const row of store.outline(date)) {
      const item = store.get(row.id)
      if (item?.type === 'todo' && item.text.trim() && (!item.done || keep.has(item.id))) out.push(item)
    }
  }
  return out
}

/**
 * The days the list watches: those `found` with an open to-do, plus the days of to-dos
 * checked off from the list (`keep`), which stay shown after their day has none left.
 */
export function looseEndDays(
  found: ISODate[],
  keep: ReadonlySet<string>,
  store: { get(id: string): Item | undefined },
  today: ISODate
): ISODate[] {
  const days = new Set(found)
  for (const id of keep) {
    const date = store.get(id)?.date
    if (date && date < today) days.add(date)
  }
  return [...days].sort()
}

/** "3 open from earlier days", or "Nothing left from earlier days" once all are done. */
export function looseEndsLabel(open: number): string {
  if (open === 0) return 'Nothing left from earlier days'
  return `${open} open from earlier ${open === 1 ? 'day' : 'days'}`
}

/** The toast after moving to-dos to today. */
export function movedToTodayLabel(count: number): string {
  return count === 1 ? 'Moved to today' : `Moved ${count} to-dos to today`
}
