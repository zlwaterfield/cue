import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { COMMANDS, shortcutKeys } from '@shared/commands'
import { reportIssueUrl } from '@shared/feedback'
import { PRIVACY_URL, TERMS_URL } from '@shared/terms'
import type { Settings } from '@shared/types'
import lockupDark from '../assets/cue-lockup-on-dark.svg'
import lockupLight from '../assets/cue-lockup-on-light.svg'
import { backend, isDesktop } from '../data/backend'
import { controller } from '../editor/controller'
import { refreshSync, syncState } from '../store/sync'
import { SETTINGS_CATEGORIES, type SettingsCategory, ui, useStore } from '../store/ui'
import { SyncSettings } from './SyncSettings'

function Keys({ shortcut }: { shortcut: string }) {
  return (
    <span className="keys">
      {shortcutKeys(shortcut).map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  )
}

function Sheet({
  title,
  children,
  wide,
  bare,
  variant
}: {
  title: string
  children: React.ReactNode
  wide?: boolean
  /** No visible title (the content carries its own identity, e.g. About). */
  bare?: boolean
  /** An extra `is-` class for sheets whose body lays itself out (e.g. Settings' rail). */
  variant?: string
}) {
  // Take focus so keys go to the sheet, not the line behind it.
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => ref.current?.focus({ preventScroll: true }), [])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && controller.closeOverlay()}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`sheet${wide ? ' is-wide' : ''}${bare ? ' is-bare' : ''}${variant ? ` is-${variant}` : ''}`}
        role="dialog"
        aria-label={title}
      >
        <div className="sheet-head">
          {bare ? <span /> : <h2>{title}</h2>}
          <button className="icon-btn" aria-label="Close" onClick={() => controller.closeOverlay()}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

const EDITING: Array<[string, string]> = [
  ['New line', 'Enter'],
  ['Extend selection', 'Shift+ArrowDown'],
  ['Select all in day', 'Mod+A'],
  ['Turn back into text (at line start)', 'Backspace'],
  ['Open link', 'Mod+Click']
]

const MARKDOWN: Array<[string, string]> = [
  ['Bullet', '- '],
  ['To-do', '[] '],
  ['Completed to-do', '[x] ']
]

export function ShortcutsSheet() {
  const open = useStore(ui, (s) => s.overlay?.kind === 'shortcuts')
  if (!open) return null
  const groups = ['General', 'Navigate', 'Item', 'Move', 'Edit'] as const
  return (
    <Sheet title="Keyboard shortcuts" wide>
      <div className="shortcut-columns">
        {groups.map((group) => (
          <section key={group} className="shortcut-group">
            <h3>{group}</h3>
            {COMMANDS.filter((c) => c.group === group && c.shortcut).map((c) => (
              <div className="shortcut-row" key={c.id}>
                <span>{c.title.replace('…', '')}</span>
                <Keys shortcut={c.shortcut!} />
              </div>
            ))}
          </section>
        ))}
        <section className="shortcut-group">
          <h3>Writing</h3>
          {EDITING.map(([label, keys]) => (
            <div className="shortcut-row" key={label}>
              <span>{label}</span>
              <Keys shortcut={keys} />
            </div>
          ))}
          {MARKDOWN.map(([label, prefix]) => (
            <div className="shortcut-row" key={label}>
              <span>{label}</span>
              <span className="keys">
                <kbd className="is-text">{prefix.trim()}</kbd>
                <span className="muted small">then space</span>
              </span>
            </div>
          ))}
        </section>
      </div>
    </Sheet>
  )
}

/** A radio group: one Tab stop (the chosen option), arrow keys to change it. */
function Segmented<T extends string | number | boolean>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (options.findIndex(([v]) => v === value) + step + options.length) % options.length
    onChange(options[next][0])
    ;(ref.current?.children[next] as HTMLElement | undefined)?.focus()
  }
  return (
    <div className="segmented" role="radiogroup" ref={ref} onKeyDown={onKeyDown}>
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          role="radio"
          aria-checked={v === value}
          tabIndex={v === value ? 0 : -1}
          className={v === value ? 'is-active' : ''}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function AboutSheet() {
  const open = useStore(ui, (s) => s.overlay?.kind === 'about')
  if (!open) return null
  return (
    <Sheet title="About Cue" bare>
      <div className="about">
        <picture className="about-lockup">
          <source srcSet={lockupDark} media="(prefers-color-scheme: dark)" />
          <img src={lockupLight} alt="cue" />
        </picture>
        <div className="about-tagline">Every day is a page.</div>
        <div className="about-version">Version {__APP_VERSION__}</div>
        <p className="about-beta">
          Cue is in beta. I use it every day as my daily driver without any issues, but it's still young, so export
          now and then.
        </p>
        <div className="button-row">
          <button className="button" onClick={() => void backend.openExternal('https://github.com/zlwaterfield/cue')}>
            Cue on GitHub
          </button>
          <button
            className="button is-quiet"
            disabled={!isDesktop}
            onClick={() => {
              controller.closeOverlay()
              controller.execute('app.revealData')
            }}
          >
            Show in Finder
          </button>
        </div>
        <div className="about-legal">
          <a href={TERMS_URL} target="_blank" rel="noreferrer">
            Terms
          </a>
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
            Privacy
          </a>
        </div>
      </div>
    </Sheet>
  )
}

export function SettingsSheet() {
  const overlay = useStore(ui, (s) => (s.overlay?.kind === 'settings' ? s.overlay : null))
  if (!overlay) return null
  return <Settings opensOn={overlay.category ?? 'General'} />
}

/**
 * One pane at a time, chosen in the rail: ↑/↓ (or ←/→) with the rail focused, ⌃Tab from
 * anywhere in the sheet. ⌘1–⌘4 are the Go menu's, so they stay out of this. Builds
 * without a sync server have no Sync category.
 */
function Settings({ opensOn }: { opensOn: SettingsCategory }) {
  const settings = useStore(ui, (s) => s.settings)
  const syncAvailable = useStore(syncState, (s) => s.available)
  const [chosen, setChosen] = useState<SettingsCategory>(opensOn)
  const rail = useRef<HTMLDivElement>(null)
  // Opening Settings is when the pending count and "Synced …" are re-read, whichever
  // category shows.
  useEffect(refreshSync, [])
  // After the sheet's own focus (layout effects run before this one), so ↑/↓ move between
  // categories straight away. Escape still closes: that listener is on the window.
  useEffect(() => rail.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true }), [])

  const categories = SETTINGS_CATEGORIES.filter((c) => c !== 'Sync' || syncAvailable)
  const category = categories.includes(chosen) ? chosen : 'General'
  const step = (delta: number): void => {
    const next = (categories.indexOf(category) + delta + categories.length) % categories.length
    setChosen(categories[next])
    ;(rail.current?.children[next] as HTMLElement | undefined)?.focus()
  }

  const update = (patch: Partial<Settings>): void => void controller.updateSettings(patch)
  const run = (id: string) => () => {
    controller.closeOverlay()
    controller.execute(id)
  }

  return (
    <Sheet title="Settings" variant="settings">
      <div
        className="settings"
        onKeyDown={(e) => {
          if (e.key !== 'Tab' || !e.ctrlKey) return
          e.preventDefault()
          step(e.shiftKey ? -1 : 1)
        }}
      >
        <div
          className="settings-rail"
          role="tablist"
          aria-orientation="vertical"
          ref={rail}
          onKeyDown={(e) => {
            const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
            if (!delta) return
            e.preventDefault()
            step(delta)
          }}
        >
          {categories.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={c === category}
              aria-controls={`settings-pane-${c}`}
              tabIndex={c === category ? 0 : -1}
              className={c === category ? 'is-active' : ''}
              onClick={() => setChosen(c)}
            >
              {c}
            </button>
          ))}
        </div>
        {categories.map((c) => (
          /* Every pane stays mounted, so changing category part-way through a sign-in
             doesn't throw the code away. `hidden` keeps the rest off the page and out
             of the tab order. */
          <div key={c} className="settings-pane" id={`settings-pane-${c}`} role="tabpanel" aria-label={c} hidden={c !== category}>
            {c === 'General' && (
              <>
                <div className="setting">
                  <div>
                    <div className="setting-label">Appearance</div>
                    <div className="setting-help">Follows your Mac unless you choose otherwise.</div>
                  </div>
                  <Segmented
                    value={settings.theme}
                    options={[
                      ['system', 'System'],
                      ['light', 'Light'],
                      ['dark', 'Dark']
                    ]}
                    onChange={(theme) => update({ theme })}
                  />
                </div>
                <div className="setting">
                  <div>
                    <div className="setting-label">Week starts on</div>
                    <div className="setting-help">Shapes the week view and “next week”.</div>
                  </div>
                  <Segmented
                    value={settings.weekStartsOn}
                    options={[
                      [1, 'Monday'],
                      [0, 'Sunday']
                    ]}
                    onChange={(weekStartsOn) => update({ weekStartsOn })}
                  />
                </div>
                <div className="setting">
                  <div>
                    <div className="setting-label">Earlier to-dos on Today</div>
                    <div className="setting-help">Today starts with the to-dos you didn’t finish in the last 30 days, folded into one line.</div>
                  </div>
                  <Segmented
                    value={settings.looseEnds}
                    options={[
                      [true, 'Show'],
                      [false, 'Hide']
                    ]}
                    onChange={(looseEnds) => update({ looseEnds })}
                  />
                </div>
              </>
            )}
            {c === 'Sync' && <SyncSettings />}
            {c === 'Your data' && (
              <>
                <div className="setting">
                  <div>
                    <div className="setting-label">Export</div>
                    <div className="setting-help">Everything is stored on this Mac and saved as you type.</div>
                  </div>
                  <div className="setting-actions">
                    <button className="button" onClick={run('export.markdown')} disabled={!isDesktop}>
                      Markdown…
                    </button>
                    <button className="button" onClick={run('export.json')} disabled={!isDesktop}>
                      JSON Backup…
                    </button>
                  </div>
                </div>
                <div className="setting">
                  <div>
                    <div className="setting-label">Import</div>
                    <div className="setting-help">Merges a JSON backup into the days it came from.</div>
                  </div>
                  <button className="button" onClick={run('import.json')} disabled={!isDesktop}>
                    Import JSON Backup…
                  </button>
                </div>
                <div className="setting">
                  <div>
                    <div className="setting-label">Backups</div>
                    <div className="setting-help">A snapshot is kept for each of the last 14 days.</div>
                  </div>
                  <button className="button is-quiet" onClick={run('app.revealData')} disabled={!isDesktop}>
                    Show in Finder
                  </button>
                </div>
              </>
            )}
            {c === 'About' && (
              <>
                <div className="setting">
                  <div>
                    <div className="setting-label">Cue</div>
                    <div className="setting-help">Version {__APP_VERSION__}</div>
                  </div>
                  <button className="button is-quiet" onClick={() => controller.execute('app.about')}>
                    About Cue
                  </button>
                </div>
                <div className="setting">
                  <div>
                    <div className="setting-label">Report an issue</div>
                    <div className="setting-help">Opens a new issue on GitHub with your version filled in.</div>
                  </div>
                  <button className="button" onClick={() => void backend.openExternal(reportIssueUrl(`Mac, version ${__APP_VERSION__}`))}>
                    Report an Issue…
                  </button>
                </div>
                <div className="setting">
                  <div className="setting-legal">
                    <a href={TERMS_URL} target="_blank" rel="noreferrer">
                      Terms
                    </a>
                    {' · '}
                    <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
                      Privacy Policy
                    </a>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  )
}
