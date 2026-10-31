/**
 * The single source of truth for user-facing commands. The native menu (main
 * process), the command palette, the keymap, and the shortcut reference are all
 * generated from this list, so a shortcut can never be shown one way and behave
 * another.
 *
 * Shortcut syntax: modifiers `Mod` (⌘), `Shift`, `Alt` (⌥), `Ctrl`, joined with `+`,
 * followed by a key (`K`, `Enter`, `ArrowUp`, `[`, …).
 */

export type CommandGroup = 'General' | 'Navigate' | 'Edit' | 'Item' | 'Move' | 'Data'

export interface CommandMeta {
  id: string
  title: string
  group: CommandGroup
  shortcut?: string
  /** Extra words for fuzzy matching in the palette. */
  keywords?: string
  /** Hidden from the palette (still in menus / shortcut reference). */
  paletteHidden?: boolean
  /** Requires a focused or selected item. */
  needsItem?: boolean
  /** Only offered when this build has a sync server. */
  needsSync?: boolean
  /** Only offered when this build updates itself (the Mac app from `pnpm release`). */
  needsUpdates?: boolean
}

export const COMMANDS: CommandMeta[] = [
  { id: 'palette.open', title: 'Command palette', group: 'General', shortcut: 'Mod+K', paletteHidden: true },
  { id: 'search.open', title: 'Search', group: 'General', shortcut: 'Mod+F', keywords: 'find lookup' },
  { id: 'help.shortcuts', title: 'Show keyboard shortcuts', group: 'General', shortcut: 'Mod+/', keywords: 'help keys' },
  { id: 'app.settings', title: 'Open settings', group: 'General', shortcut: 'Mod+,', keywords: 'preferences' },
  { id: 'app.about', title: 'About Cue', group: 'General', keywords: 'version info' },
  { id: 'app.checkForUpdates', title: 'Check for updates…', group: 'General', keywords: 'update upgrade new version install', needsUpdates: true },

  { id: 'go.today', title: 'Go to today', group: 'Navigate', shortcut: 'Mod+1', keywords: 'day' },
  { id: 'go.tomorrow', title: 'Go to tomorrow', group: 'Navigate', shortcut: 'Mod+2', keywords: 'day' },
  { id: 'go.week', title: 'Open this week', group: 'Navigate', shortcut: 'Mod+3', keywords: 'week view upcoming' },
  { id: 'go.prevDay', title: 'Previous day', group: 'Navigate', shortcut: 'Mod+[', keywords: 'back yesterday' },
  { id: 'go.nextDay', title: 'Next day', group: 'Navigate', shortcut: 'Mod+]', keywords: 'forward' },
  { id: 'go.date', title: 'Go to date…', group: 'Navigate', shortcut: 'Mod+J', keywords: 'jump calendar pick' },
  { id: 'looseEnds.toggle', title: 'Show earlier open to-dos', group: 'Navigate', keywords: 'loose ends overdue unfinished leftover carry over' },

  { id: 'edit.undo', title: 'Undo', group: 'Edit', shortcut: 'Mod+Z' },
  { id: 'edit.redo', title: 'Redo', group: 'Edit', shortcut: 'Mod+Shift+Z' },

  { id: 'item.create', title: 'Create item', group: 'Item', shortcut: 'Mod+N', keywords: 'new add line' },
  { id: 'item.toggleDone', title: 'Complete or reopen to-do', group: 'Item', shortcut: 'Mod+Enter', keywords: 'check done finish', needsItem: true },
  { id: 'item.toggleTodo', title: 'Toggle bullet / to-do', group: 'Item', shortcut: 'Mod+Shift+Enter', keywords: 'task checkbox convert', needsItem: true },
  { id: 'item.toText', title: 'Convert to plain text', group: 'Item', keywords: 'paragraph turn into', needsItem: true },
  { id: 'item.toBullet', title: 'Convert to bullet', group: 'Item', keywords: 'list turn into', needsItem: true },
  { id: 'item.toTodo', title: 'Convert to to-do', group: 'Item', keywords: 'task checkbox turn into', needsItem: true },
  { id: 'item.indent', title: 'Indent', group: 'Item', shortcut: 'Tab', keywords: 'nest', needsItem: true },
  { id: 'item.outdent', title: 'Outdent', group: 'Item', shortcut: 'Shift+Tab', keywords: 'unnest dedent', needsItem: true },
  { id: 'item.moveUp', title: 'Move item up', group: 'Item', shortcut: 'Alt+ArrowUp', keywords: 'reorder', needsItem: true },
  { id: 'item.moveDown', title: 'Move item down', group: 'Item', shortcut: 'Alt+ArrowDown', keywords: 'reorder', needsItem: true },
  { id: 'item.delete', title: 'Delete item', group: 'Item', shortcut: 'Mod+Shift+Backspace', keywords: 'remove', needsItem: true },
  { id: 'item.select', title: 'Select item', group: 'Item', shortcut: 'Escape', paletteHidden: true, needsItem: true },

  { id: 'move.today', title: 'Move to today', group: 'Move', keywords: 'reschedule', needsItem: true },
  { id: 'move.tomorrow', title: 'Move to tomorrow', group: 'Move', shortcut: 'Mod+D', keywords: 'defer reschedule postpone', needsItem: true },
  { id: 'move.nextWeekday', title: 'Move to next weekday', group: 'Move', keywords: 'defer reschedule business day', needsItem: true },
  { id: 'move.nextWeek', title: 'Move to next week', group: 'Move', keywords: 'defer reschedule monday', needsItem: true },
  { id: 'move.date', title: 'Move to date…', group: 'Move', shortcut: 'Mod+Shift+D', keywords: 'defer reschedule pick', needsItem: true },
  { id: 'looseEnds.moveAll', title: 'Move earlier open to-dos to today', group: 'Move', keywords: 'loose ends overdue unfinished carry over reschedule' },

  { id: 'export.markdown', title: 'Export as Markdown…', group: 'Data', keywords: 'backup save files' },
  { id: 'export.json', title: 'Export JSON backup…', group: 'Data', keywords: 'backup save' },
  { id: 'import.json', title: 'Import JSON backup…', group: 'Data', keywords: 'restore' },
  { id: 'app.revealData', title: 'Show data folder in Finder', group: 'Data', keywords: 'reveal database location' },
  { id: 'sync.now', title: 'Sync now', group: 'Data', keywords: 'cloud devices refresh upload download', needsSync: true },
  { id: 'theme.system', title: 'Use system appearance', group: 'General', keywords: 'theme auto' },
  { id: 'theme.light', title: 'Use light appearance', group: 'General', keywords: 'theme' },
  { id: 'theme.dark', title: 'Use dark appearance', group: 'General', keywords: 'theme night' }
]

/**
 * The Mac's shortcut that saves the front browser tab to today, from any app
 * (apps/desktop/src/main/capture.ts). It's registered with the system rather than the menu,
 * and isn't a command: from ⌘K, Cue itself would be the app in front.
 */
export const SAVE_TAB_SHORTCUT = 'Ctrl+Alt+Mod+L'

export const COMMANDS_BY_ID: Record<string, CommandMeta> = Object.fromEntries(COMMANDS.map((c) => [c.id, c]))

const KEY_SYMBOLS: Record<string, string> = {
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: 'esc',
  Tab: '⇥',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Click: 'click'
}

/** Split a shortcut into display keycaps in macOS order: ⌃ ⌥ ⇧ ⌘ key. */
export function shortcutKeys(shortcut: string): string[] {
  const parts = shortcut.split('+')
  const key = parts.pop()!
  const mods = new Set(parts)
  const out: string[] = []
  if (mods.has('Ctrl')) out.push('⌃')
  if (mods.has('Alt')) out.push('⌥')
  if (mods.has('Shift')) out.push('⇧')
  if (mods.has('Mod')) out.push('⌘')
  out.push(KEY_SYMBOLS[key] ?? key.toUpperCase())
  return out
}

/** Electron accelerator, only for shortcuts that are safe as menu key equivalents. */
export function toAccelerator(shortcut: string | undefined): string | undefined {
  if (!shortcut || !shortcut.includes('Mod+')) return undefined
  return shortcut
    .split('+')
    .map((p) => (p === 'Mod' ? 'CommandOrControl' : p === 'Alt' ? 'Alt' : p === 'ArrowUp' ? 'Up' : p === 'ArrowDown' ? 'Down' : p))
    .join('+')
}
