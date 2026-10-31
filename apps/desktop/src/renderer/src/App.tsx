import { weekViewDates } from '@shared/dates'
import { controller } from './editor/controller'
import { DaySection } from './editor/DaySection'
import { ui, useStore } from './store/ui'
import { Header, SaveStatus, ToastView } from './ui/Chrome'
import { LinksPanel } from './ui/Links'
import { Palette } from './ui/Palette'
import { AboutSheet, SettingsSheet, ShortcutsSheet } from './ui/Sheets'

export function App() {
  const view = useStore(ui, (s) => s.view)
  const today = useStore(ui, (s) => s.today)
  const weekStartsOn = useStore(ui, (s) => s.settings.weekStartsOn)
  const dates = view.mode === 'week' ? weekViewDates(today, weekStartsOn) : [view.date]

  // Clicking empty space never steals the caret; it just ends a block selection.
  const onBackgroundMouseDown = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement
    if (target.closest('.row, button, input, a, .day-title')) return
    e.preventDefault()
    if (ui.get().selection.kind === 'blocks') controller.restoreFocusToText()
  }

  return (
    <div className="app">
      <Header />
      <main
        className="scroller"
        onMouseDown={onBackgroundMouseDown}
        onScroll={(e) => document.querySelector('.titlebar')?.classList.toggle('is-scrolled', e.currentTarget.scrollTop > 4)}
      >
        <div className={`column is-${view.mode}`}>
          {dates.map((date) => (
            <DaySection key={date} date={date} today={today} variant={view.mode} />
          ))}
        </div>
      </main>
      <div className="focus-sink" tabIndex={-1} ref={(el) => void (controller.sink = el)} aria-hidden />
      <Palette />
      <LinksPanel />
      <ShortcutsSheet />
      <SettingsSheet />
      <AboutSheet />
      <ToastView />
      <SaveStatus />
    </div>
  )
}
