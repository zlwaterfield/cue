import { useSyncExternalStore } from 'react'
import { todayISO } from '@shared/dates'
import { DEFAULT_SETTINGS, type ISODate, type Settings } from '@shared/types'

/** Small observable store + hook; enough for app-level UI state. */
export class Store<T> {
  private listeners = new Set<() => void>()

  constructor(private state: T) {}

  get(): T {
    return this.state
  }

  set(patch: Partial<T> | ((state: T) => Partial<T>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch
    let changed = false
    for (const key in next) {
      if (!Object.is(next[key], this.state[key])) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.state = { ...this.state, ...next }
    for (const l of this.listeners) l()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export function useStore<T, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()))
}

export type View = { mode: 'week' } | { mode: 'day'; date: ISODate }

export type Selection =
  | { kind: 'none' }
  | { kind: 'text'; id: string }
  | { kind: 'blocks'; date: ISODate; anchor: string; focus: string }

export type PaletteMode = 'commands' | 'search' | 'date'

/** Settings' categories, in the order the rail lists them. */
export const SETTINGS_CATEGORIES = ['General', 'Sync', 'Assistants', 'Your data', 'About'] as const
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]

export type Overlay =
  | null
  | { kind: 'palette'; mode: PaletteMode; dateAction?: 'go' | 'move'; query?: string }
  | { kind: 'shortcuts' }
  /** Opens on General unless something (the sync indicator) asks for its own category. */
  | { kind: 'settings'; category?: SettingsCategory }
  | { kind: 'about' }

export interface Toast {
  id: number
  message: string
  undo?: boolean
  /** A button besides Undo, such as Restart Now. */
  action?: { label: string; run: () => void }
}

export interface UIState {
  today: ISODate
  view: View
  settings: Settings
  selection: Selection
  overlay: Overlay
  toast: Toast | null
  dragging: boolean
  /** Today's "open from earlier days" list is unfolded. For this session only. */
  looseEndsOpen: boolean
  /** The last day picked in Move to that its named days (Today, Tomorrow…) don't cover. For this session only. */
  lastMoveDate: ISODate | null
}

export const ui = new Store<UIState>({
  today: todayISO(),
  view: { mode: 'week' },
  settings: DEFAULT_SETTINGS,
  selection: { kind: 'none' },
  overlay: null,
  toast: null,
  dragging: false,
  looseEndsOpen: false,
  lastMoveDate: null
})

let toastSeq = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

export function showToast(message: string, options: { undo?: boolean; action?: Toast['action']; duration?: number } = {}): void {
  const toast = { id: ++toastSeq, message, undo: options.undo, action: options.action }
  ui.set({ toast })
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    if (ui.get().toast?.id === toast.id) ui.set({ toast: null })
  }, options.duration ?? 4500)
}

export function dismissToast(): void {
  ui.set({ toast: null })
}
