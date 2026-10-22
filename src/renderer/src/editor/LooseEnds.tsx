import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { addDays, shortDate } from '@shared/dates'
import type { ISODate, Item } from '@shared/types'
import { backend } from '../data/backend'
import { itemStore } from '../store/items'
import { ui, useStore } from '../store/ui'
import { refreshCaret } from './caret'
import { controller } from './controller'

/** How far back Today looks for unfinished to-dos. */
export const LOOSE_ENDS_DAYS = 30

/** Clicks here never take the caret out of the page. */
const keepCaret = (e: React.MouseEvent): void => e.preventDefault()

/**
 * The top of Today: one quiet line, "3 open from earlier days", that unfolds into those
 * to-dos. They stay on their own days; checking one off or moving it here is the same
 * edit as on its page. A to-do checked off here stays in the list, crossed out, until
 * Today is next opened, so the list doesn't jump under the pointer.
 */
export function LooseEnds({ today }: { today: ISODate }) {
  const enabled = useStore(ui, (s) => s.settings.looseEnds)
  const open = useStore(ui, (s) => s.looseEndsOpen)
  const dates = useOpenTodoDates(today, enabled)
  const version = useDays(dates)
  // Checked off here this session; forgotten when the day changes.
  const finished = useRef({ today, ids: new Set<string>() })
  if (finished.current.today !== today) finished.current = { today, ids: new Set() }

  const items = useMemo(() => {
    const out: Item[] = []
    for (const date of dates) {
      for (const row of itemStore.outline(date)) {
        const item = itemStore.get(row.id)
        if (item?.type === 'todo' && item.text.trim() && (!item.done || finished.current.ids.has(item.id))) out.push(item)
      }
    }
    return out
    // `version` changes whenever one of the days does.
  }, [dates, version])

  const openIds = items.filter((i) => !i.done).map((i) => i.id)
  const openIdsRef = useRef(openIds)
  openIdsRef.current = openIds
  useEffect(() => {
    controller.looseEnds = () => openIdsRef.current
    return () => void (controller.looseEnds = () => [])
  }, [])

  const shown = enabled && items.length > 0
  // Opening, closing, or arriving moves the page under the caret.
  useLayoutEffect(() => refreshCaret(), [shown, open, items.length])

  if (!shown) return null

  const count = openIds.length
  const label = count === 0 ? 'Nothing left from earlier days' : `${count} open from earlier ${count === 1 ? 'day' : 'days'}`
  const toggle = (id: string): void => {
    finished.current.ids.add(id)
    controller.toggleDoneElsewhere(id)
  }

  return (
    <div className={`loose-ends${open ? ' is-open' : ''}`}>
      <div className="loose-head">
        <button
          className="loose-toggle"
          aria-expanded={open}
          onMouseDown={keepCaret}
          onClick={() => ui.set({ looseEndsOpen: !open })}
        >
          <svg className="loose-chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden>
            <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{label}</span>
        </button>
        {open && count > 1 && (
          <button className="loose-all" onMouseDown={keepCaret} onClick={() => void controller.pullToToday(openIds)}>
            Move all to today
          </button>
        )}
      </div>
      {open && (
        <ul className="loose-list" aria-label="Open to-dos from earlier days">
          {items.map((item) => (
            <li key={item.id} className={`loose-row${item.done ? ' is-done' : ''}`} data-loose-id={item.id}>
              <span className="loose-marker" onMouseDown={keepCaret} onClick={() => toggle(item.id)}>
                <button className="checkbox" role="checkbox" aria-checked={item.done} aria-label={item.done ? 'Reopen' : 'Complete'} tabIndex={-1}>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <path d="M4.2 8.4l2.4 2.4 5.2-5.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </span>
              <button
                className="loose-text"
                title={`Open ${shortDate(item.date, today)}`}
                onMouseDown={keepCaret}
                onClick={() => void controller.navigate({ mode: 'day', date: item.date }, { focus: { id: item.id, start: item.text.length } })}
              >
                {item.text}
              </button>
              {!item.done && (
                <button className="loose-move" onMouseDown={keepCaret} onClick={() => void controller.pullToToday([item.id])}>
                  Move to today
                </button>
              )}
              <span className="loose-date">{shortDate(item.date, today)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The earlier days that have an unfinished to-do, loaded into the store. Asked again
 * when the day changes or another device (or an import) changes things; local edits
 * show up through the days' own subscriptions.
 */
function useOpenTodoDates(today: ISODate, enabled: boolean): ISODate[] {
  const [dates, setDates] = useState<ISODate[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const refresh = async (): Promise<void> => {
      await itemStore.persistence.settle()
      const found = await backend.datesWithOpenTodos(addDays(today, -LOOSE_ENDS_DAYS), addDays(today, -1))
      await itemStore.ensureLoaded(found)
      if (alive) setDates((prev) => (prev.length === found.length && prev.every((d, i) => d === found[i]) ? prev : found))
    }
    void refresh()
    const offExternal = itemStore.onExternal(() => void refresh())
    const offReset = itemStore.onReset(() => void refresh())
    return () => {
      alive = false
      offExternal()
      offReset()
    }
  }, [today, enabled])
  return dates
}

/**
 * A number that changes whenever anything on these days does. Days only announce lines
 * arriving, leaving and moving, so each line is watched too (checked off, retyped).
 */
function useDays(dates: ISODate[]): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const offs = dates.flatMap((date) => [
      itemStore.subscribeDate(date, bump),
      ...itemStore.outline(date).map((row) => itemStore.subscribeItem(row.id, bump))
    ])
    return () => offs.forEach((off) => off())
  }, [dates, version])
  return version
}
