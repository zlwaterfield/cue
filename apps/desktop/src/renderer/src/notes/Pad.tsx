import { useLayoutEffect, useRef } from 'react'
import { parseMarkdownLines } from '@shared/markdown'
import { uuidv7 } from '@shared/ids'
import { controller } from '../editor/controller'
import { isMac } from '../editor/keys'
import { itemStore } from '../store/items'
import { showToast, ui, useStore } from '../store/ui'
import { pad, padTitle, type PadState } from './model'
import { StarIcon } from './icons'

/**
 * PROTOTYPE (Pad) — ⌘E. One piece of plain text floating over whatever is on screen, like
 * ⌘K: scratch first, the starred notes as tabs beside it. Nothing here is lines or to-dos
 * until ⌘↩ sends it to today.
 */
export function Pad() {
  const open = useStore(ui, (s) => s.overlay?.kind === 'pad')
  return open ? <Sheet /> : null
}

function Sheet() {
  const state = useStore(pad, (s) => s)
  const ref = useRef<HTMLTextAreaElement>(null)
  const current = state.notes.find((n) => n.id === state.current) ?? state.notes[0]
  const isScratch = current.id === 'scratch'

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [current.id])

  const setText = (text: string): void => pad.set({ notes: state.notes.map((n) => (n.id === current.id ? { ...n, text } : n)) })

  const step = (by: number): void => {
    const i = state.notes.indexOf(current)
    pad.set({ current: state.notes[(i + by + state.notes.length) % state.notes.length].id })
  }

  const star = (): void => {
    if (isScratch) {
      if (!current.text.trim()) return
      const id = uuidv7()
      pad.set({ notes: [{ id: 'scratch', text: '' }, ...state.notes.slice(1), { id, text: current.text }], current: id })
      return
    }
    // Unstarring puts the text back in scratch, under whatever is there.
    const scratch = state.notes[0].text
    const text = scratch.trim() ? `${scratch.replace(/\n+$/, '')}\n\n${current.text}` : current.text
    pad.set({ notes: [{ id: 'scratch', text }, ...state.notes.slice(1).filter((n) => n.id !== current.id)], current: 'scratch' })
  }

  const discard = (): void => {
    if (!current.text && isScratch) return
    const before: PadState = state
    if (isScratch) setText('')
    else pad.set({ notes: state.notes.filter((n) => n.id !== current.id), current: 'scratch' })
    showToast(isScratch ? 'Scratch cleared' : `Deleted “${padTitle(current)}”`, { action: { label: 'Undo', run: () => pad.set(before) } })
  }

  const sendToToday = async (): Promise<void> => {
    const lines = parseMarkdownLines(current.text)
    if (!lines.length) return
    const { today } = ui.get()
    await itemStore.ensureLoaded([today])
    const rows = itemStore.outline(today).filter((row) => row.depth === 0)
    if (isScratch) setText('')
    controller.closeOverlay()
    controller.insertLines(today, rows[rows.length - 1]?.id ?? null, lines)
    controller.toastUndo(`Added ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} to today`)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (!mod) return
    const key = e.key.toLowerCase()
    if (e.shiftKey && key === 's') star()
    else if (e.shiftKey && e.key === 'Backspace') discard()
    else if (!e.shiftKey && e.key === 'Enter') void sendToToday()
    else if (e.code === 'BracketLeft') step(-1)
    else if (e.code === 'BracketRight') step(1)
    else return
    e.preventDefault()
  }

  const keep = (e: React.MouseEvent): void => e.preventDefault()

  return (
    <div className="overlay is-pad" onMouseDown={(e) => e.target === e.currentTarget && controller.closeOverlay()}>
      <div className="sheet pad" role="dialog" aria-label="Notes">
        <div className="pad-tabs" role="tablist">
          {state.notes.map((note) => (
            <button
              key={note.id}
              role="tab"
              aria-selected={note.id === current.id}
              className={`pad-tab${note.id === current.id ? ' is-active' : ''}`}
              onMouseDown={keep}
              onClick={() => pad.set({ current: note.id })}
            >
              {note.id !== 'scratch' && <StarIcon filled size={12} />}
              <span>{padTitle(note)}</span>
            </button>
          ))}
        </div>
        <textarea
          ref={ref}
          className="pad-text"
          value={current.text}
          placeholder={isScratch ? 'Type or paste anything. It stays until you clear it.' : 'Empty note'}
          spellCheck
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="pad-foot">
          <button onMouseDown={keep} onClick={star}>
            <span className="keys">
              <kbd>⇧</kbd>
              <kbd>⌘</kbd>
              <kbd>S</kbd>
            </span>
            {isScratch ? 'Star' : 'Unstar'}
          </button>
          <button onMouseDown={keep} onClick={() => void sendToToday()}>
            <span className="keys">
              <kbd>⌘</kbd>
              <kbd>↩</kbd>
            </span>
            Add to today
          </button>
          <button onMouseDown={keep} onClick={discard}>
            <span className="keys">
              <kbd>⇧</kbd>
              <kbd>⌘</kbd>
              <kbd>⌫</kbd>
            </span>
            {isScratch ? 'Clear' : 'Delete'}
          </button>
          {state.notes.length > 1 && (
            <span className="pad-switch">
              <span className="keys">
                <kbd>⌘</kbd>
                <kbd>[</kbd>
                <kbd>]</kbd>
              </span>
              Switch
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
