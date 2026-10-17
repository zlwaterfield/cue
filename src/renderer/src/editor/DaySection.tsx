import { memo, useCallback, useRef } from 'react'
import { diffDays, longDate, monthDay, relativeDayName, WEEKDAYS, weekday } from '@shared/dates'
import type { ISODate } from '@shared/types'
import { controller, ghostId } from './controller'
import { useOutline } from './hooks'
import { ItemRow } from './ItemRow'

const START_TYPING = 'Start typing…'

/** What an empty day says when it isn't focused. Focused, every blank line says "Start typing…". */
function placeholderFor(date: ISODate, today: ISODate): string {
  const delta = diffDays(today, date)
  if (delta === 0) return START_TYPING
  if (delta > 0) return 'Nothing planned'
  return 'Nothing written'
}

/** The trailing blank line of a day. Typing into it creates a new item at the end. */
const GhostRow = memo(function GhostRow({ date, today, empty }: { date: ISODate; today: ISODate; empty: boolean }) {
  const id = ghostId(date)
  const ref = useRef<HTMLDivElement | null>(null)
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (ref.current && ref.current !== el) controller.unregister(id, ref.current)
      ref.current = el
      if (el) controller.register(id, el)
    },
    [id]
  )
  return (
    <div className={`row is-ghost${empty ? ' is-only' : ''}`} style={{ '--depth': 0 } as React.CSSProperties} data-date={date}>
      <span className="handle" aria-hidden />
      <span className="marker" aria-hidden />
      <div
        ref={setRef}
        className="text"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-label={`New line for ${longDate(date)}`}
        data-editable-id={id}
        data-placeholder={placeholderFor(date, today)}
        data-placeholder-focus={START_TYPING}
        onKeyDown={(e) => controller.onGhostKeyDown(e, date)}
        onInput={(e) => controller.onGhostInput(date, e.currentTarget)}
        onPaste={(e) => controller.onGhostPaste(e, date)}
        onFocus={() => controller.onEditableFocus(id)}
        onBlur={() => controller.onEditableBlur()}
        onCompositionStart={() => controller.onCompositionStart()}
        onCompositionEnd={(e) => controller.onCompositionEnd(id, e.currentTarget)}
      />
    </div>
  )
})

export const DaySection = memo(function DaySection({
  date,
  today,
  variant
}: {
  date: ISODate
  today: ISODate
  variant: 'week' | 'day'
}) {
  const rows = useOutline(date)
  const delta = diffDays(today, date)
  const name = relativeDayName(date, today)
  const isRelative = Math.abs(delta) <= 1
  const subtitle = variant === 'day'
    ? isRelative
      ? longDate(date)
      : `${monthDay(date, today)}${Math.abs(delta) < 7 ? '' : delta > 0 ? ` · in ${delta} days` : ` · ${-delta} days ago`}`
    : isRelative
      ? `${WEEKDAYS[weekday(date)]}, ${monthDay(date, today)}`
      : monthDay(date, today)

  const classes = ['day', `is-${variant}`]
  if (delta === 0) classes.push('is-today')
  if (delta < 0) classes.push('is-past')

  const openDay = (): void => {
    if (variant === 'week') void controller.navigate({ mode: 'day', date })
  }

  return (
    <section className={classes.join(' ')} data-day={date} aria-label={longDate(date)}>
      <header className="day-head">
        <h2
          className={variant === 'week' ? 'day-title is-link' : 'day-title'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={openDay}
          title={variant === 'week' ? 'Open this day' : undefined}
        >
          {name}
        </h2>
        <span className="day-sub">{subtitle}</span>
      </header>
      <div className="rows">
        {rows.map((row) => (
          <ItemRow key={row.id} id={row.id} depth={row.depth} date={date} />
        ))}
        <GhostRow date={date} today={today} empty={rows.length === 0} />
      </div>
    </section>
  )
})
