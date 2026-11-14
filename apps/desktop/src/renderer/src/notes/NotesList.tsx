import { useLayoutEffect, useRef, useState } from 'react'
import { fold } from '@shared/text'
import { controller } from '../editor/controller'
import { ui, useStore } from '../store/ui'
import { createNote, openNote } from './actions'
import { SCRATCH, useNoteList } from './model'
import { ScratchIcon, StarIcon } from './icons'

/**
 * PROTOTYPE — ⇧⌘E. Scratch and the starred notes in a ⌘K-shaped list. Type to find one;
 * a name that isn't there yet starts a new note.
 */
export function NotesList() {
  const open = useStore(ui, (s) => s.overlay?.kind === 'notes')
  return open ? <List /> : null
}

function List() {
  const all = useNoteList()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => inputRef.current?.focus(), [])

  const q = query.trim()
  const found = q ? all.filter((n) => fold(n.title).includes(fold(q))) : all
  const fresh = q && !found.some((n) => fold(n.title) === fold(q)) ? q : null
  const count = found.length + (fresh ? 1 : 0)
  const active = Math.min(index, count - 1)

  const run = (i: number): void => {
    if (i < found.length) openNote(found[i].date)
    else if (fresh) void createNote(fresh)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (count) setIndex((active + (e.key === 'ArrowDown' ? 1 : -1) + count) % count)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(active)
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && controller.closeOverlay()}>
      <div className="palette is-notes" role="dialog" aria-label="Notes">
        <div className="palette-input">
          <span className="palette-mode">
            <StarIcon />
          </span>
          <input
            ref={inputRef}
            value={query}
            placeholder="Open a note, or name a new one"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={onKeyDown}
            aria-label="Notes"
          />
        </div>
        <div className="palette-list" role="listbox">
          {found.map((note, i) => (
            <div
              key={note.date}
              className={`palette-item${i === active ? ' is-active' : ''}`}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => i !== active && setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(i)}
            >
              <span className="palette-icon">{note.date === SCRATCH ? <ScratchIcon /> : <StarIcon filled />}</span>
              <span className="palette-title">{note.title}</span>
              <span className="palette-hint">
                {note.date === SCRATCH && !note.lines ? 'Empty' : `${note.lines} ${note.lines === 1 ? 'line' : 'lines'}`}
              </span>
              {note.date === SCRATCH && (
                <span className="keys">
                  <kbd>⌘</kbd>
                  <kbd>E</kbd>
                </span>
              )}
            </div>
          ))}
          {fresh && (
            <div
              className={`palette-item${active === found.length ? ' is-active' : ''}`}
              role="option"
              aria-selected={active === found.length}
              onMouseMove={() => setIndex(found.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(found.length)}
            >
              <span className="palette-icon">
                <StarIcon />
              </span>
              <span className="palette-title">New starred note “{fresh}”</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
