import { useLayoutEffect, useRef } from 'react'
import { COMMANDS, shortcutKeys } from '@shared/commands'
import type { Settings } from '@shared/types'
import lockupDark from '../assets/cue-lockup-on-dark.svg'
import lockupLight from '../assets/cue-lockup-on-light.svg'
import { backend, isDesktop } from '../data/backend'
import { controller } from '../editor/controller'
import { ui, useStore } from '../store/ui'
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
  bare
}: {
  title: string
  children: React.ReactNode
  wide?: boolean
  /** No visible title (the content carries its own identity, e.g. About). */
  bare?: boolean
}) {
  // Take focus so keys go to the sheet, not the line behind it.
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => ref.current?.focus({ preventScroll: true }), [])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && controller.closeOverlay()}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`sheet${wide ? ' is-wide' : ''}${bare ? ' is-bare' : ''}`}
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
  ['Remove formatting', 'Backspace'],
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

function Segmented<T extends string | number>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={String(v)} role="radio" aria-checked={v === value} className={v === value ? 'is-active' : ''} onClick={() => onChange(v)}>
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
        <div className="about-version">Version {__APP_VERSION__} · alpha</div>
        <p className="about-alpha">
          Cue is in early alpha and not ready for real use. Your notes could be lost at any time, so export often.
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
            Show data folder
          </button>
        </div>
      </div>
    </Sheet>
  )
}

export function SettingsSheet() {
  const open = useStore(ui, (s) => s.overlay?.kind === 'settings')
  const settings = useStore(ui, (s) => s.settings)
  if (!open) return null
  const update = (patch: Partial<Settings>): void => void controller.updateSettings(patch)
  const run = (id: string) => () => {
    controller.closeOverlay()
    controller.execute(id)
  }
  return (
    <Sheet title="Settings">
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
      <SyncSettings />
      <div className="setting is-stacked">
        <div>
          <div className="setting-label">Your data</div>
          <div className="setting-help">
            Everything is stored on this Mac and saved as you type. A backup snapshot is kept for each of the last 14 days.
          </div>
        </div>
        <div className="button-row">
          <button className="button" onClick={run('export.markdown')} disabled={!isDesktop}>
            Export Markdown…
          </button>
          <button className="button" onClick={run('export.json')} disabled={!isDesktop}>
            Export JSON backup…
          </button>
          <button className="button" onClick={run('import.json')} disabled={!isDesktop}>
            Import backup…
          </button>
          <button className="button is-quiet" onClick={run('app.revealData')} disabled={!isDesktop}>
            Show in Finder
          </button>
        </div>
      </div>
    </Sheet>
  )
}
