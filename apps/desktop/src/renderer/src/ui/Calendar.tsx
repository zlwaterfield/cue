import { useEffect, useMemo, useState } from 'react'
import { addDays, addMonths, longDate, MONTHS, parts, startOfMonth, startOfWeek } from '@shared/dates'
import type { ISODate } from '@shared/types'
import { backend } from '../data/backend'

/** Compact month grid. Days with notes get a quiet dot. */
export function Calendar({
  selected,
  today,
  weekStartsOn,
  onPick
}: {
  selected: ISODate | null
  today: ISODate
  weekStartsOn: 0 | 1
  onPick: (date: ISODate) => void
}) {
  const [month, setMonth] = useState(() => startOfMonth(selected ?? today))
  const [marked, setMarked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (selected) setMonth(startOfMonth(selected))
  }, [selected])

  const days = useMemo(() => {
    const first = startOfWeek(month, weekStartsOn)
    return Array.from({ length: 42 }, (_, i) => addDays(first, i))
  }, [month, weekStartsOn])

  useEffect(() => {
    let cancelled = false
    void backend.datesWithItems(days[0], days[days.length - 1]).then((dates) => {
      if (!cancelled) setMarked(new Set(dates))
    })
    return () => {
      cancelled = true
    }
  }, [days])

  const { year, month: m } = parts(month)
  const labels = weekStartsOn === 1 ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  return (
    <div className="calendar" onMouseDown={(e) => e.preventDefault()}>
      <div className="calendar-head">
        <span className="calendar-title">
          {MONTHS[m - 1]} <span className="muted">{year}</span>
        </span>
        <span className="calendar-nav">
          <button className="icon-btn small" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
            <Chevron dir="left" />
          </button>
          <button className="icon-btn small" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            <Chevron dir="right" />
          </button>
        </span>
      </div>
      <div className="calendar-grid">
        {labels.map((label, i) => (
          <span key={`l${i}`} className="calendar-label">
            {label}
          </span>
        ))}
        {days.map((day) => {
          const p = parts(day)
          const classes = ['calendar-day']
          if (p.month !== m) classes.push('is-outside')
          if (day === today) classes.push('is-today')
          if (day === selected) classes.push('is-selected')
          if (marked.has(day)) classes.push('has-items')
          return (
            <button key={day} className={classes.join(' ')} onClick={() => onPick(day)} aria-label={longDate(day)}>
              {p.day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path
        d={dir === 'left' ? 'M8.5 3.5L5 7l3.5 3.5' : 'M5.5 3.5L9 7l-3.5 3.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
