import type { ISODate } from '@shared/types'
import { openNote } from './actions'
import { useNotePages, useNoteTitle } from './model'

/**
 * PROTOTYPE — the notes there are, in a row above the one that's open: scratch first, then
 * the starred notes, newest first. It is to notes what the iPhone's week strip is to days.
 */
export function NoteStrip({ current, className = 'note-strip' }: { current: ISODate; className?: string }) {
  const pages = useNotePages()
  return (
    <nav className={className} aria-label="Notes">
      {pages.map((date) => (
        <NoteTab key={date} date={date} active={date === current} />
      ))}
    </nav>
  )
}

function NoteTab({ date, active }: { date: ISODate; active: boolean }) {
  const title = useNoteTitle(date)
  return (
    <button className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => openNote(date)} title={title}>
      {title}
    </button>
  )
}
