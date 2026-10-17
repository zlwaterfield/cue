import { COMMANDS } from '@shared/commands'

/** Keyboard shortcut matching against the shared command list. */

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes('Mac')

interface Parsed {
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
  ctrl: boolean
}

function parse(shortcut: string): Parsed {
  const parts = shortcut.split('+')
  const key = parts.pop()!
  return {
    key: key.length === 1 ? key.toLowerCase() : key,
    mod: parts.includes('Mod'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    ctrl: parts.includes('Ctrl')
  }
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Comma: ','
}

export function eventKey(e: KeyboardEvent | React.KeyboardEvent): string {
  if (e.key.length === 1) {
    // ⌥ changes the produced character on macOS; fall back to the physical key then.
    // Otherwise follow the layout, like native macOS shortcuts do.
    if (e.altKey) {
      if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
      if (/^Digit\d$/.test(e.code)) return e.code.slice(5)
      if (e.code in CODE_KEYS) return CODE_KEYS[e.code]
    }
    if (/^Digit\d$/.test(e.code) && e.shiftKey) return e.code.slice(5)
    return e.key.toLowerCase()
  }
  return e.key
}

export function matches(e: KeyboardEvent | React.KeyboardEvent, shortcut: string): boolean {
  const p = parse(shortcut)
  const mod = isMac ? e.metaKey : e.ctrlKey
  const ctrl = isMac ? e.ctrlKey : false
  return eventKey(e) === p.key && mod === p.mod && e.shiftKey === p.shift && e.altKey === p.alt && ctrl === p.ctrl
}

const BINDINGS = COMMANDS.filter((c) => c.shortcut).map((c) => ({ id: c.id, shortcut: c.shortcut! }))

/** The command bound to this key event, if any (⌘-based shortcuts only). */
export function commandFor(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (!mod) return null
  for (const binding of BINDINGS) if (matches(e, binding.shortcut)) return binding.id
  return null
}
