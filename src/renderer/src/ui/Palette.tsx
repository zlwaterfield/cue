import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { COMMANDS, shortcutKeys, type CommandGroup } from '@shared/commands'
import { parseDateInput } from '@shared/dateParse'
import { addDays, diffDays, friendlyDate, longDate, nextWeekday, startOfWeek } from '@shared/dates'
import { matchRanges, searchTerms } from '@shared/text'
import type { ISODate, ItemType, SearchResult } from '@shared/types'
import { backend } from '../data/backend'
import { controller } from '../editor/controller'
import { itemStore } from '../store/items'
import { syncState } from '../store/sync'
import { ui, useStore, type Overlay } from '../store/ui'
import { fuzzyScore } from '../lib/fuzzy'
import { Calendar } from './Calendar'
import { commandIcon, icons } from './icons'

/**
 * ⌘K. One surface, three modes: commands (fuzzy), search (all notes), and date
 * (natural-language "go to" / "move to"). Everything is keyboard-driven; the mouse
 * works too.
 */

interface Entry {
  key: string
  title: React.ReactNode
  hint?: string
  keys?: string[]
  icon?: React.ReactNode
  group?: string
  date?: ISODate
  run: () => void
}

type PaletteOverlay = Extract<NonNullable<Overlay>, { kind: 'palette' }>

const GROUP_ORDER: CommandGroup[] = ['Item', 'Move', 'Navigate', 'General', 'Edit', 'Data']

export function Palette() {
  const overlay = useStore(ui, (s) => s.overlay)
  if (!overlay || overlay.kind !== 'palette') return null
  return <PalettePanel key={`${overlay.mode}:${overlay.dateAction ?? ''}`} overlay={overlay} />
}

function relative(date: ISODate, today: ISODate): string {
  const d = diffDays(today, date)
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d === -1) return 'yesterday'
  if (d > 0) return d < 14 ? `in ${d} days` : d < 60 ? `in ${Math.round(d / 7)} weeks` : `in ${Math.round(d / 30)} months`
  return -d < 14 ? `${-d} days ago` : -d < 60 ? `${Math.round(-d / 7)} weeks ago` : `${Math.round(-d / 30)} months ago`
}

export function TypeGlyph({ type, done }: { type: ItemType; done: boolean }) {
  if (type === 'todo') return <span className={`glyph glyph-todo${done ? ' is-done' : ''}`} aria-label={done ? 'Completed to-do' : 'To-do'} />
  if (type === 'bullet') return <span className="glyph glyph-bullet" aria-label="Bullet" />
  return <span className="glyph glyph-text" aria-label="Text" />
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const ranges = matchRanges(text, terms)
  if (!ranges.length) return <>{text}</>
  const out: React.ReactNode[] = []
  let at = 0
  ranges.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a))
    out.push(<mark key={i}>{text.slice(a, b)}</mark>)
    at = b
  })
  out.push(text.slice(at))
  return <>{out}</>
}

const SearchIcon = () => <>{icons.search}</>
const CalendarIcon = () => <>{icons.calendar}</>
const CommandIcon = () => <>{icons.next}</>

function PalettePanel({ overlay }: { overlay: PaletteOverlay }) {
  const today = useStore(ui, (s) => s.today)
  const settings = useStore(ui, (s) => s.settings)
  const [query, setQuery] = useState(overlay.query ?? '')
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<SearchResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const hasTarget = useMemo(() => controller.targets().length > 0, [])
  const mode = overlay.mode

  useLayoutEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Search runs against the full database in the main process.
  useEffect(() => {
    if (mode !== 'search') return
    let cancelled = false
    const timer = setTimeout(async () => {
      // Search reads the database, so let just-made edits land first.
      await itemStore.persistence.settle()
      const found = query.trim() ? await backend.search(query, 60) : []
      if (!cancelled) {
        setResults(found)
        setIndex(0)
      }
    }, 30)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, mode])

  const switchMode = (next: PaletteOverlay): void => {
    ui.set({ overlay: next })
  }

  const runCommand = (id: string): void => {
    if (id === 'go.date') return switchMode({ kind: 'palette', mode: 'date', dateAction: 'go' })
    if (id === 'move.date') return switchMode({ kind: 'palette', mode: 'date', dateAction: 'move' })
    if (id === 'search.open') return switchMode({ kind: 'palette', mode: 'search', query: '' })
    controller.closeOverlay()
    controller.execute(id, 'palette')
  }

  const pickDate = (date: ISODate, action: 'go' | 'move'): void => {
    controller.closeOverlay()
    if (action === 'go') void controller.navigate({ mode: 'day', date })
    else void controller.moveTargets(date)
  }

  const entries: Entry[] = useMemo(() => {
    if (mode === 'search') {
      const terms = searchTerms(query)
      return results.map((r) => ({
        key: r.id,
        icon: <TypeGlyph type={r.type} done={r.done} />,
        title: (
          <span className={r.type === 'todo' && r.done ? 'is-done-text' : undefined}>
            <Highlight text={r.text} terms={terms} />
          </span>
        ),
        hint: friendlyDate(r.date, today),
        run: () => {
          const match = matchRanges(r.text, terms)[0] ?? [0, 0]
          ui.set({ overlay: null })
          // Prefer the live copy: it may have moved since the database was read.
          const date = itemStore.get(r.id)?.date ?? r.date
          void itemStore.ensureLoaded([date]).then(() => controller.openItem(r.id, itemStore.get(r.id)?.date ?? date, match))
        }
      }))
    }

    if (mode === 'date') {
      const action = overlay.dateAction ?? 'go'
      const parsed = parseDateInput(query, today, {
        weekStartsOn: settings.weekStartsOn,
        prefer: action === 'move' ? 'future' : 'nearest'
      })
      const entry = (date: ISODate, label?: string): Entry => ({
        key: `${label ?? 'parsed'}:${date}`,
        date,
        icon: <CalendarIcon />,
        title: label ? (
          <>
            {label} <span className="muted">· {friendlyDate(date, today)}</span>
          </>
        ) : (
          longDate(date)
        ),
        hint: relative(date, today),
        run: () => pickDate(date, action)
      })
      const quick: Array<[string, ISODate]> = [
        ['Today', today],
        ['Tomorrow', addDays(today, 1)],
        ['Next weekday', nextWeekday(today)],
        ['Next week', addDays(startOfWeek(today, settings.weekStartsOn), 7)]
      ]
      if (action === 'go') quick.splice(2, 0, ['Yesterday', addDays(today, -1)])
      const list: Entry[] = []
      if (parsed) list.push(entry(parsed))
      for (const [label, date] of quick) {
        if (date === parsed) continue
        if (query.trim() && fuzzyScore(query, label) === null) continue
        list.push(entry(date, label))
      }
      return list
    }

    // Commands
    const syncAvailable = syncState.get().available
    const visible = COMMANDS.filter((c) => !c.paletteHidden && (!c.needsItem || hasTarget) && (!c.needsSync || syncAvailable))
    const tomorrow = addDays(today, 1)
    const hintFor = (id: string): string | undefined => {
      const targets = controller.targets()
      const from = targets.length ? itemStore.get(targets[0])?.date : undefined
      if (id === 'move.tomorrow' && from) return friendlyDate(from < tomorrow ? tomorrow : addDays(from, 1), today)
      if (id === 'move.nextWeekday') return friendlyDate(nextWeekday(today), today)
      if (id === 'move.nextWeek') return friendlyDate(addDays(startOfWeek(today, settings.weekStartsOn), 7), today)
      return undefined
    }
    const toEntry = (c: (typeof COMMANDS)[number]): Entry => ({
      key: c.id,
      icon: commandIcon(c.id),
      title: c.title,
      hint: hintFor(c.id),
      keys: c.shortcut ? shortcutKeys(c.shortcut) : undefined,
      group: c.group,
      run: () => runCommand(c.id)
    })

    const q = query.trim()
    if (!q) {
      return GROUP_ORDER.flatMap((g) => visible.filter((c) => c.group === g)).map(toEntry)
    }

    const scored = visible
      .map((c) => {
        const title = fuzzyScore(q, c.title)
        const keywords = c.keywords ? fuzzyScore(q, c.keywords) : null
        const score = Math.max(title ?? -Infinity, keywords === null ? -Infinity : keywords - 200)
        return { c, score }
      })
      .filter((s) => s.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map((s) => ({ ...toEntry(s.c), group: undefined }))

    const list: Entry[] = []
    const date = q.length >= 3 || /^[+\d]/.test(q) ? parseDateInput(q, today, { weekStartsOn: settings.weekStartsOn, prefer: 'nearest' }) : null
    if (date) {
      const go: Entry = {
        key: `go:${date}`,
        icon: <CalendarIcon />,
        title: `Go to ${friendlyDate(date, today)}`,
        hint: relative(date, today),
        run: () => pickDate(date, 'go')
      }
      const future = parseDateInput(q, today, { weekStartsOn: settings.weekStartsOn, prefer: 'future' }) ?? date
      const move: Entry = {
        key: `move:${future}`,
        icon: <CalendarIcon />,
        title: `Move to ${friendlyDate(future, today)}`,
        hint: relative(future, today),
        run: () => pickDate(future, 'move')
      }
      // "move to fri" moves; "go to fri" or just "fri" goes.
      if (!hasTarget) list.push(go)
      else if (/^(move|mv|defer|push)\b/i.test(q)) list.push(move, go)
      else list.push(go, move)
    }
    list.push(...scored)
    list.push({
      key: 'search',
      icon: <SearchIcon />,
      title: (
        <>
          Search for <span className="strong">“{q}”</span>
        </>
      ),
      run: () => switchMode({ kind: 'palette', mode: 'search', query: q })
    })
    return list
  }, [mode, query, results, today, settings.weekStartsOn, hasTarget, overlay.dateAction])

  const clamped = Math.min(index, Math.max(0, entries.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('.palette-item.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [clamped, entries])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // Enter and arrows belong to the input method while composing.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')
    if (down || up) {
      e.preventDefault()
      if (!entries.length) return
      setIndex((clamped + (down ? 1 : -1) + entries.length) % entries.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      entries[clamped]?.run()
      return
    }
    if (e.key === 'Backspace' && query === '' && mode !== 'commands') {
      e.preventDefault()
      switchMode({ kind: 'palette', mode: 'commands' })
    }
  }

  const placeholder =
    mode === 'search'
      ? 'Search all notes…'
      : mode === 'date'
        ? overlay.dateAction === 'move'
          ? 'Move to… try “fri”, “next mon”, “oct 31”'
          : 'Go to… try “fri”, “next mon”, “oct 31”'
        : 'Type a command, a date, or search…'

  const highlightedDate = mode === 'date' ? (entries[clamped]?.date ?? null) : null
  let lastGroup: string | undefined

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && controller.closeOverlay()}>
      <div className={`palette is-${mode}`} role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <span className="palette-mode">
            {mode === 'search' ? <SearchIcon /> : mode === 'date' ? <CalendarIcon /> : <CommandIcon />}
          </span>
          <input
            ref={inputRef}
            value={query}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={onKeyDown}
            aria-label={placeholder}
          />
        </div>
        <div className="palette-body">
          <div className="palette-list" ref={listRef} role="listbox">
            {entries.length === 0 && (
              <div className="palette-empty">
                {mode === 'search' ? (query.trim() ? 'No matches' : 'Find anything you’ve written') : mode === 'date' ? 'Try “friday”, “in 3 days”, or “2026-10-31”' : 'No matching commands'}
              </div>
            )}
            {entries.map((entry, i) => {
              const header = entry.group && entry.group !== lastGroup ? entry.group : null
              lastGroup = entry.group
              return (
                <div key={entry.key}>
                  {header && <div className="palette-group">{header}</div>}
                  <div
                    className={`palette-item${i === clamped ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={i === clamped}
                    onMouseMove={() => i !== clamped && setIndex(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => entry.run()}
                  >
                    <span className="palette-icon">{entry.icon}</span>
                    <span className="palette-title">{entry.title}</span>
                    {entry.hint && <span className="palette-hint">{entry.hint}</span>}
                    {entry.keys && (
                      <span className="keys">
                        {entry.keys.map((k, j) => (
                          <kbd key={j}>{k}</kbd>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {mode === 'date' && (
            <Calendar
              selected={highlightedDate}
              today={today}
              weekStartsOn={settings.weekStartsOn}
              onPick={(date) => pickDate(date, overlay.dateAction ?? 'go')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
