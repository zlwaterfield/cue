import { DaySection } from '../editor/DaySection'
import { controller } from '../editor/controller'
import { ui, useStore } from '../store/ui'
import { closeMargin } from './actions'
import { notes, useNoteList } from './model'

/**
 * PROTOTYPE (Margin) — ⌘E. Scratch and the starred notes in a column beside the day, each
 * one a page of ordinary lines. The day stays where it is, so lines drag across.
 */
export function Margin() {
  const open = useStore(notes, (s) => s.variant === 'margin' && s.marginOpen)
  const today = useStore(ui, (s) => s.today)
  const list = useNoteList()
  if (!open) return null
  return (
    <aside
      className="margin"
      aria-label="Notes"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('.row, button')) return
        e.preventDefault()
        if (ui.get().selection.kind === 'blocks') controller.restoreFocusToText()
      }}
    >
      <div className="margin-head">
        <span className="margin-title">Notes</span>
        <button className="margin-close" onMouseDown={(e) => e.preventDefault()} onClick={closeMargin} title="Close  ⌘E">
          <span className="keys">
            <kbd>⌘</kbd>
            <kbd>E</kbd>
          </span>
          <span className="margin-done">Done</span>
        </button>
      </div>
      <div className="margin-body">
        {list.map((note) => (
          <DaySection key={note.date} date={note.date} today={today} variant="week" />
        ))}
      </div>
    </aside>
  )
}
