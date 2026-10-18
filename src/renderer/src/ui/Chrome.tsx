import { useEffect, useState, useSyncExternalStore } from 'react'
import { MONTHS, parts } from '@shared/dates'
import { indicator, INDICATOR_DELAY, statusLine } from '@shared/sync/status'
import { controller } from '../editor/controller'
import { itemStore } from '../store/items'
import { syncState } from '../store/sync'
import { ui, useStore } from '../store/ui'
import { Chevron } from './Calendar'

/** Quiet top bar: day navigation on the left, view switch and search on the right. */
export function Header() {
  const view = useStore(ui, (s) => s.view)
  const today = useStore(ui, (s) => s.today)

  // A day's own heading names it; the bar gives the month, like the calendar.
  let title: React.ReactNode
  if (view.mode === 'week') title = 'This week'
  else {
    const { year, month } = parts(view.date)
    title = (
      <>
        {MONTHS[month - 1]} <span className="view-title-year">{year}</span>
      </>
    )
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
        <SyncIndicator />
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

/** True once `active` has held for `ms`; false again the moment it stops. */
function useHeld(active: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setHeld(true), ms)
    return () => {
      clearTimeout(timer)
      setHeld(false)
    }
  }, [active, ms])
  return active && held
}

/**
 * Sync stays out of sight while it works, and for anyone who never turned it on. This
 * shows only when it can't: offline, paused, or signed out by the server. A long sync (the
 * first one) fades in "Syncing…"; a quick one (every push while typing) never takes space
 * in the title bar. The words are the iPhone header's (`shared/sync/status`).
 */
function SyncIndicator() {
  const sync = useStore(syncState, (s) => s)
  const shown = indicator(sync)
  const held = useHeld(!!shown?.delayed, INDICATOR_DELAY)
  if (!shown || (shown.delayed && !held)) return null
  return (
    <button
      className={`sync-status${shown.delayed ? ' is-delayed' : ' is-attention'}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => controller.execute('app.settings')}
      title={statusLine(sync, Date.now())}
      // Narrow windows show only the dot.
      aria-label={shown.label}
    >
      {shown.label}
    </button>
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
