import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { linkDay, linkGroup, linkNote, type LinkEntry } from '@shared/linkList'
import { bareLabel, findLinks } from '@shared/links'
import { searchTerms } from '@shared/text'
import type { ISODate } from '@shared/types'
import { backend } from '../data/backend'
import { controller } from '../editor/controller'
import { SiteIcon } from '../editor/LinkLine'
import { itemStore } from '../store/items'
import { useLinkPreview } from '../store/links'
import { ui, useStore } from '../store/ui'
import { icons } from './icons'
import { Highlight } from './Palette'

/**
 * ⌘L. Every link written on any day, newest first, under this week, last week and then
 * the month. Typing finds a link by its line or by what its page says (`core/linkList.ts`).
 * ↩ opens the page and leaves the list open, for opening a few; ⌥↩, or the day beside a
 * link, goes to the line it's on.
 */

/** Rows drawn at a time; more as the list scrolls, so a long history opens at once. */
const PAGE = 100

export function LinksPanel() {
  const open = useStore(ui, (s) => s.overlay?.kind === 'links')
  return open ? <Links /> : null
}

/** Go to the line a link is on, with the link flashed. */
function showLine(link: LinkEntry): void {
  ui.set({ overlay: null })
  // Prefer the live copy: the line may have moved or changed since the list was read.
  const date = itemStore.get(link.id)?.date ?? link.date
  void itemStore.ensureLoaded([date]).then(() => {
    const item = itemStore.get(link.id)
    const at = findLinks(item?.text ?? link.text).find((l) => l.url === link.url)
    void controller.openItem(link.id, item?.date ?? date, at ? [at.start, at.end] : [0, 0])
  })
}

function Links() {
  const today = useStore(ui, (s) => s.today)
  const weekStartsOn = useStore(ui, (s) => s.settings.weekStartsOn)
  const [query, setQuery] = useState('')
  // Results remember their query, so one still in flight never reads as "No matching links".
  const [found, setFound] = useState<{ query: string; links: LinkEntry[] } | null>(null)
  const [index, setIndex] = useState(0)
  const [shown, setShown] = useState(PAGE)
  const [pagesRead, setPagesRead] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searching = useRef(false)
  searching.current = !!query.trim()

  useLayoutEffect(() => inputRef.current?.focus(), [])

  // Pages read while the list is open can make more links match a search: look again
  // once they've settled.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = backend.onLinkPreview(() => {
      if (!searching.current) return
      clearTimeout(timer)
      timer = setTimeout(() => setPagesRead((n) => n + 1), 400)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      // The list reads the database, so let just-made edits land first.
      await itemStore.persistence.settle()
      const links = await backend.links(query)
      if (!cancelled) setFound({ query: query.trim(), links })
    }, 30)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, pagesRead])

  const links = found?.links ?? []
  const clamped = Math.min(index, Math.max(0, links.length - 1))
  const terms = useMemo(() => searchTerms(found?.query ?? ''), [found])

  useEffect(() => {
    listRef.current?.querySelector('.links-item.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [clamped, found])

  const move = (to: number): void => {
    setIndex(to)
    // Arrowing near the end draws more; ↑ from the top wraps to the very last link.
    if (to >= shown - 10) setShown(Math.max(shown + PAGE, to + 1))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // Enter and arrows belong to the input method while composing.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')
    if (down || up) {
      e.preventDefault()
      if (links.length) move((clamped + (down ? 1 : -1) + links.length) % links.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const link = links[clamped]
      if (!link) return
      if (e.altKey) showLine(link)
      else void backend.openExternal(link.url)
    }
  }

  const q = query.trim()
  const empty = !found ? null : found.links.length ? null : q ? (found.query === q ? 'No matching links' : null) : 'Links you write or share show up here.'

  let lastGroup: string | undefined
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && controller.closeOverlay()}>
      <div className="palette is-links" role="dialog" aria-label="Links">
        <div className="palette-input">
          <span className="palette-mode">{icons.link}</span>
          <input
            ref={inputRef}
            value={query}
            placeholder="Search links"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
              setShown(PAGE)
            }}
            onKeyDown={onKeyDown}
            aria-label="Search links"
          />
        </div>
        <div
          className="palette-list"
          ref={listRef}
          role="listbox"
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight > el.scrollHeight - 400 && shown < links.length) setShown((n) => n + PAGE)
          }}
        >
          {empty && <div className="palette-empty">{empty}</div>}
          {links.slice(0, shown).map((link, i) => {
            const group = linkGroup(link.date, today, weekStartsOn)
            const header = group !== lastGroup ? group : null
            lastGroup = group
            return (
              <div key={link.url}>
                {header && <div className="palette-group">{header}</div>}
                <LinkRow link={link} today={today} terms={terms} active={i === clamped} onHover={() => i !== clamped && setIndex(i)} />
              </div>
            )
          })}
        </div>
        {links.length > 0 && (
          <div className="links-foot">
            <span className="keys">
              <kbd>↩</kbd>
            </span>
            Open
            <span className="keys">
              <kbd>⌥</kbd>
              <kbd>↩</kbd>
            </span>
            Show on its day
            <span className="links-count">
              {links.length} {links.length === 1 ? 'link' : 'links'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

const LinkRow = memo(function LinkRow({
  link,
  today,
  terms,
  active,
  onHover
}: {
  link: LinkEntry
  today: ISODate
  terms: string[]
  active: boolean
  onHover: () => void
}) {
  const preview = useLinkPreview(link.url)
  const note = linkNote(link.text)
  const title = preview?.title ?? bareLabel(link.url)
  const sub = [preview?.title ? preview.byline : null, note || null].filter(Boolean).join(' · ')
  const done = link.type === 'todo' && link.done
  return (
    <div
      className={`palette-item links-item${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
      role="option"
      aria-selected={active}
      data-link={link.url}
      onMouseMove={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => (e.altKey ? showLine(link) : void backend.openExternal(link.url))}
    >
      <span className="palette-icon links-icon" aria-hidden>
        <SiteIcon preview={preview} />
      </span>
      <span className="links-text">
        <span className="links-title">
          <Highlight text={title} terms={terms} />
        </span>
        {sub && (
          <span className="links-sub">
            <Highlight text={sub} terms={terms} />
          </span>
        )}
      </span>
      <button
        className="links-day"
        tabIndex={-1}
        title="Show on its day"
        onClick={(e) => {
          e.stopPropagation()
          showLine(link)
        }}
      >
        {linkDay(link.date, today)}
      </button>
    </div>
  )
})
