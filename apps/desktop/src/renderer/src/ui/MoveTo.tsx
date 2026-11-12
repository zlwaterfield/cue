import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseDateInput } from '@shared/dateParse'
import { friendlyDate, namedMoveDays, shortDate } from '@shared/dates'
import type { ISODate } from '@shared/types'
import { controller } from '../editor/controller'
import { fuzzyScore } from '../lib/fuzzy'
import { itemStore } from '../store/items'
import { ui, useStore } from '../store/ui'
import { Calendar } from './Calendar'
import { icons } from './icons'
import { distance, TypeGlyph } from './Palette'

/**
 * ⇧⌘D. Move to, in a window of its own rather than a mode of ⌘K: what's moving, a field
 * that reads dates as you type ("fri", "next mon", "oct 31"), the named days, and a
 * calendar. The day picked last comes first, so a run of lines follows it with ⇧⌘D ↩,
 * as on the iPhone.
 */

interface Choice {
  key: string
  date: ISODate
  /** A named day ("Tomorrow"); a typed date has none. */
  label?: string
  icon: React.ReactNode
}

const NAMED_ICONS: Record<string, React.ReactNode> = {
  Today: icons.today,
  Tomorrow: icons.tomorrow,
  'Next weekday': icons.weekday,
  'Next week': icons.week
}

export function MovePanel() {
  const open = useStore(ui, (s) => s.overlay?.kind === 'move')
  return open ? <MoveTo /> : null
}

function MoveTo() {
  const today = useStore(ui, (s) => s.today)
  const weekStartsOn = useStore(ui, (s) => s.settings.weekStartsOn)
  const lastMoveDate = useStore(ui, (s) => s.lastMoveDate)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // What's moving, read once: nothing else edits the lines while this is open.
  const subject = useMemo(() => {
    const ids = controller.targets()
    const first = itemStore.get(ids[0] ?? '')
    if (!first) return null
    // Lines nested under the targets go with them, so they count.
    const lines = controller.selectedIds({ kind: 'blocks', date: first.date, anchor: ids[0], focus: ids[ids.length - 1] }).length
    return { item: first, more: Math.max(0, lines - 1) }
  }, [])
  const source = subject?.item.date

  useLayoutEffect(() => inputRef.current?.focus(), [])

  const choices = useMemo(() => {
    const parsed = parseDateInput(query, today, { weekStartsOn, prefer: 'future' })
    const named: Choice[] = namedMoveDays(today, weekStartsOn).map(({ label, date }) => ({ key: label, label, date, icon: NAMED_ICONS[label] }))
    // The day picked last time comes first, so a run of lines can follow it, until it passes.
    if (lastMoveDate && lastMoveDate > today && !named.some((day) => day.date === lastMoveDate)) {
      named.unshift({ key: 'Last used', label: 'Last used', date: lastMoveDate, icon: icons.recent })
    }
    const list: Choice[] = []
    if (parsed) list.push({ key: `typed:${parsed}`, date: parsed, icon: icons.calendar })
    // Each date once ("Next weekday" is often "Tomorrow"), and never the day the lines are on.
    const listed = new Set([parsed, source])
    const q = query.trim()
    for (const day of named) {
      if (listed.has(day.date)) continue
      if (q && fuzzyScore(q, day.label!) === null) continue
      listed.add(day.date)
      list.push(day)
    }
    return list
  }, [query, today, weekStartsOn, lastMoveDate, source])

  const clamped = Math.min(index, Math.max(0, choices.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('.palette-item.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [clamped, choices])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // Enter and arrows belong to the input method while composing.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')
    if (down || up) {
      e.preventDefault()
      if (!choices.length) return
      setIndex((clamped + (down ? 1 : -1) + choices.length) % choices.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const choice = choices[clamped]
      if (choice) controller.moveToPicked(choice.date)
    }
  }

  const placeholder = 'Move to… try “fri”, “next mon”, “oct 31”'
  const from = source ? friendlyDate(source, today).replace(/^(Today|Tomorrow|Yesterday)$/, (m) => m.toLowerCase()) : null

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && controller.closeOverlay()}>
      <div className="palette is-move" role="dialog" aria-label="Move to">
        {subject && (
          <div className="move-subject">
            <span className="move-line">
              {subject.item.type !== 'text' && <TypeGlyph type={subject.item.type} done={subject.item.done} />}
              <span className="move-line-text">{subject.item.text.trim() || 'Empty line'}</span>
            </span>
            {subject.more > 0 && <span className="move-more">and {subject.more} more</span>}
            {from && <span className="move-from">from {from}</span>}
          </div>
        )}
        <div className="palette-input">
          <span className="palette-mode">{icons.moveDate}</span>
          <input
            ref={inputRef}
            value={query}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={onKeyDown}
            aria-label={placeholder}
          />
        </div>
        <div className="palette-body">
          <div className="palette-list" ref={listRef} role="listbox">
            {choices.length === 0 && <div className="palette-empty">Try “friday”, “in 3 days”, or “2026-10-31”</div>}
            {choices.map((choice, i) => {
              const away = distance(choice.date, choice.label ?? '', today)
              return (
                <div
                  key={choice.key}
                  className={`palette-item${i === clamped ? ' is-active' : ''}`}
                  role="option"
                  aria-selected={i === clamped}
                  onMouseMove={() => i !== clamped && setIndex(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => controller.moveToPicked(choice.date)}
                >
                  <span className="palette-icon">{choice.icon}</span>
                  <span className="palette-title">
                    {choice.label ? (
                      <>
                        {choice.label} <span className="muted">· {shortDate(choice.date, today)}</span>
                      </>
                    ) : (
                      shortDate(choice.date, today)
                    )}
                  </span>
                  {away && <span className="palette-hint">{away}</span>}
                </div>
              )
            })}
          </div>
          <Calendar selected={choices[clamped]?.date ?? null} today={today} weekStartsOn={weekStartsOn} onPick={(date) => controller.moveToPicked(date)} />
        </div>
      </div>
    </div>
  )
}
