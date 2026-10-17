import { useSyncExternalStore } from 'react'
import { diffDays, MONTHS, parts, shortDate } from '@shared/dates'
import { controller } from '../editor/controller'
import { itemStore } from '../store/items'
import { ui, useStore } from '../store/ui'
import { Chevron } from './Calendar'

/** Quiet top bar: day navigation on the left, view switch and search on the right. */
export function Header() {
  const view = useStore(ui, (s) => s.view)
  const today = useStore(ui, (s) => s.today)

  let title: string
  if (view.mode === 'week') title = 'This week'
  else {
    const delta = diffDays(today, view.date)
    const { year, month } = parts(view.date)
    title = Math.abs(delta) <= 1 ? shortDate(view.date) : `${MONTHS[month - 1]} ${year}`
  }

  const keep = (e: React.MouseEvent): void => e.preventDefault()
  const isToday = view.mode === 'day' && view.date === today

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <button className="icon-btn" onMouseDown={keep} onClick={() => controller.execute('go.prevDay')} title="Previous day  ⌘[" aria-label="Previous day">
          <Chevron dir="left" />
        </button>
        <button className="icon-btn" onMouseDown={keep} onClick={() => controller.execute('go.nextDay')} title="Next day  ⌘]" aria-label="Next day">
          <Chevron dir="right" />
        </button>
        <button className="view-title" onMouseDown={keep} onClick={() => controller.execute('go.date')} title="Go to date  ⌘J">
          {title}
        </button>
      </div>
      <div className="titlebar-right">
        <div className="segmented is-small" role="tablist">
          <button role="tab" aria-selected={isToday} className={isToday ? 'is-active' : ''} onMouseDown={keep} onClick={() => controller.execute('go.today')} title="Today  ⌘1">
            Today
          </button>
          <button role="tab" aria-selected={view.mode === 'week'} className={view.mode === 'week' ? 'is-active' : ''} onMouseDown={keep} onClick={() => controller.execute('go.week')} title="This week  ⌘3">
            Week
          </button>
        </div>
        <button className="icon-btn" onMouseDown={keep} onClick={() => controller.execute('search.open')} title="Search  ⌘F" aria-label="Search">
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button className="kbd-btn" onMouseDown={keep} onClick={() => controller.execute('palette.open')} title="Command palette">
          ⌘K
        </button>
      </div>
    </header>
  )
}

export function ToastView() {
  const toast = useStore(ui, (s) => s.toast)
  if (!toast) return null
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.message}</span>
      {toast.undo && (
        <button
          className="toast-action"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => controller.undoToast()}
        >
          Undo <kbd>⌘Z</kbd>
        </button>
      )}
    </div>
  )
}

/** Appears only if saving is failing — normally Cue never shows save state. */
export function SaveStatus() {
  const status = useSyncExternalStore(
    (l) => itemStore.persistence.subscribe(l),
    () => itemStore.persistence.status
  )
  if (status.state !== 'error') return null
  return (
    <div className="save-error" role="alert" title={status.message}>
      Couldn’t save — retrying…
    </div>
  )
}
