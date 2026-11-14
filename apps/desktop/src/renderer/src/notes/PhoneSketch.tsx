import { addDays, dateRange, MONTHS, parts, startOfWeek } from '@shared/dates'
import { controller } from '../editor/controller'
import { itemStore } from '../store/items'
import { ui, useStore } from '../store/ui'

/**
 * PROTOTYPE — `?phone=1`. A sketch of the iPhone app's header (apps/mobile/src/ui/Header.tsx)
 * over this same editor, to see where notes would sit on a phone. It is a drawing for
 * screenshots, not the iPhone app.
 */
export function PhoneHeader() {
  const view = useStore(ui, (s) => s.view)
  const today = useStore(ui, (s) => s.today)
  const weekStartsOn = useStore(ui, (s) => s.settings.weekStartsOn)
  const onNote = view.mode === 'notes'
  const date = view.mode === 'day' ? view.date : today
  const { year, month } = parts(date)
  const start = startOfWeek(date, weekStartsOn)
  const days = dateRange(start, addDays(start, 6))
  const keep = (e: React.MouseEvent): void => e.preventDefault()
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  return (
    <header className="phone-head">
      <div className="phone-status">
        <span>9:41</span>
        <span className="phone-island" />
        <span className="phone-battery" />
      </div>
      <div className="phone-bar">
        <button className="phone-month" onMouseDown={keep} onClick={() => controller.execute('go.date')}>
          {MONTHS[month - 1]} <span>{year}</span>
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
            <path d="M2.5 4.5L6 8l3.5-3.5" {...stroke} />
          </svg>
        </button>
        <div className="phone-actions">
          <button className={onNote ? 'is-on' : ''} onMouseDown={keep} onClick={() => controller.execute(onNote ? 'go.today' : 'go.notes')} aria-label="Notes">
            <svg width="21" height="21" viewBox="0 0 22 22" aria-hidden>
              <rect x="4.5" y="3" width="13" height="16" rx="3" {...stroke} fill={onNote ? 'currentColor' : 'none'} />
              <path d="M8 8h6M8 11.5h6M8 15h3.5" {...stroke} stroke={onNote ? 'var(--bg)' : 'currentColor'} />
            </svg>
          </button>
          <button onMouseDown={keep} onClick={() => controller.execute('links.open')} aria-label="Links">
            <svg width="21" height="21" viewBox="0 0 22 22" aria-hidden>
              <path d="M9.5 12.5a4 4 0 005.7 0l2.6-2.6a4 4 0 00-5.7-5.7l-1 1M12.5 9.5a4 4 0 00-5.7 0l-2.6 2.6a4 4 0 005.7 5.7l1-1" {...stroke} />
            </svg>
          </button>
          <button onMouseDown={keep} onClick={() => controller.execute('search.open')} aria-label="Search">
            <svg width="21" height="21" viewBox="0 0 22 22" aria-hidden>
              <circle cx="9.5" cy="9.5" r="6" {...stroke} />
              <path d="M14 14l4.5 4.5" {...stroke} />
            </svg>
          </button>
          <button onMouseDown={keep} onClick={() => controller.execute('app.settings')} aria-label="Settings">
            <svg width="21" height="21" viewBox="0 0 22 22" aria-hidden>
              <circle cx="11" cy="11" r="8.5" {...stroke} />
              <circle cx="11" cy="9" r="3" {...stroke} />
              <path d="M5.5 17.2a6.5 6.5 0 0111 0" {...stroke} />
            </svg>
          </button>
        </div>
      </div>
      <div className="phone-week">
        {days.map((day) => {
          const selected = view.mode === 'day' ? day === view.date : !onNote && day === today
          return (
            <button key={day} onMouseDown={keep} onClick={() => void controller.navigate({ mode: 'day', date: day })}>
              <span className="phone-weekday">{'SMTWTFS'[new Date(`${day}T12:00:00`).getDay()]}</span>
              <span className={`phone-day${selected ? ' is-selected' : ''}${day === today ? ' is-today' : ''}`}>{parts(day).day}</span>
              <span className={`phone-dot${itemStore.outline(day).length ? ' is-marked' : ''}`} />
            </button>
          )
        })}
      </div>
    </header>
  )
}
