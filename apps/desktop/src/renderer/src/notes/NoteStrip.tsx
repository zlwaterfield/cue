import type { ISODate } from '@shared/types'
import { controller } from '../editor/controller'
import { useOutline } from '../editor/hooks'
import { openNote } from './actions'
import { SCRATCH, useNotePages, useNoteTitle } from './model'

/**
 * The notes there are, in a row above the one that's open: scratch first, then the starred
 * notes, newest first, then a plus for a new one. It is to notes what the iPhone's week strip
 * is to days.
 */
export function NoteStrip({ current }: { current: ISODate }) {
  const listed = useNotePages()
  // A new note isn't one until something is written on it; it still has its place in the row.
  const pages = listed.includes(current) ? listed : [listed[0], current, ...listed.slice(1)]
  return (
    <nav className="note-strip" aria-label="Notes">
      {pages.map((date) => (
        <NoteTab key={date} date={date} active={date === current} />
      ))}
      <button className="note-new" onMouseDown={(e) => e.preventDefault()} onClick={() => controller.execute('notes.new')} title="New note  ⇧⌘N" aria-label="New note">
        +
      </button>
    </nav>
  )
}

function NoteTab({ date, active }: { date: ISODate; active: boolean }) {
  const name = useNoteTitle(date)
  const title = useOutline(date).length || date === SCRATCH ? name : 'New note'
  return (
    <button className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => openNote(date)} title={title}>
      {title}
    </button>
  )
}
