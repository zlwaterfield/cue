import { memo, useCallback, useLayoutEffect, useRef } from 'react'
import type { ISODate } from '@shared/types'
import { controller } from './controller'
import { getOffsets, setOffsets } from './dom'
import { updateLinks } from './highlights'
import { useIsSelected, useItem } from './hooks'
import * as ops from './ops'
import { beginItemDrag, beginTextPointer } from './pointer'

/**
 * One line of a day: drag handle, marker (bullet / checkbox), and a plain-text
 * editable. The editable's text is owned by the DOM while typing and only written
 * from the store when it changes elsewhere (undo, paste, sync).
 */
export const ItemRow = memo(function ItemRow({ id, depth, date }: { id: string; depth: number; date: ISODate }) {
  const item = useItem(id)
  const selected = useIsSelected(id)
  const ref = useRef<HTMLDivElement | null>(null)

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (ref.current && ref.current !== el) controller.unregister(id, ref.current)
      ref.current = el
      if (el) controller.register(id, el)
    },
    [id]
  )

  const text = item?.text ?? ''
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !controller.composing && el.textContent !== text) {
      // Changed elsewhere (undo, paste, another device). Keep the caret in place.
      const caret = el === document.activeElement ? getOffsets(el) : null
      el.textContent = text
      if (caret) setOffsets(el, caret.start, caret.end)
    }
    updateLinks(id, el)
  }, [id, text])

  useLayoutEffect(() => () => updateLinks(id, null), [id])

  if (!item) return null

  const toggle = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    controller.commit('Complete', (tx) => void ops.toggleDone(tx, [id]), { keepSelection: true })
  }

  const classes = ['row', `is-${item.type}`]
  if (item.type === 'todo' && item.done) classes.push('is-done')
  if (selected) classes.push('is-selected')
  if (!text) classes.push('is-empty')

  return (
    <div className={classes.join(' ')} style={{ '--depth': depth } as React.CSSProperties} data-row-id={id} data-date={date}>
      <span className="handle" onPointerDown={(e) => beginItemDrag(e, id)} aria-hidden title="Drag to move">
        <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
          <circle cx="2" cy="2" r="1.1" />
          <circle cx="6" cy="2" r="1.1" />
          <circle cx="2" cy="6" r="1.1" />
          <circle cx="6" cy="6" r="1.1" />
          <circle cx="2" cy="10" r="1.1" />
          <circle cx="6" cy="10" r="1.1" />
        </svg>
      </span>
      <span className="marker" aria-hidden={item.type !== 'todo'}>
        {item.type === 'todo' ? (
          <button
            className="checkbox"
            role="checkbox"
            aria-checked={item.done}
            aria-label={item.done ? 'Reopen' : 'Complete'}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggle}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
              <path d="M4.2 8.4l2.4 2.4 5.2-5.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : item.type === 'bullet' ? (
          <span className="dot" />
        ) : null}
      </span>
      <div
        ref={setRef}
        className="text"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-label={item.type === 'todo' ? (item.done ? 'Completed to-do' : 'To-do') : item.type === 'bullet' ? 'Bullet' : 'Text'}
        data-editable-id={id}
        onKeyDown={(e) => controller.onItemKeyDown(e, id)}
        onInput={(e) => controller.onItemInput(id, e.currentTarget)}
        onPaste={(e) => controller.onItemPaste(e, id)}
        onFocus={() => controller.onEditableFocus(id)}
        onBlur={() => controller.onEditableBlur()}
        onMouseDown={(e) => beginTextPointer(e, id, date)}
        onCompositionStart={() => controller.onCompositionStart()}
        onCompositionEnd={(e) => controller.onCompositionEnd(id, e.currentTarget)}
      />
    </div>
  )
})
