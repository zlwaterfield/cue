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

export type Overlay =
  | null
  | { kind: 'palette'; mode: PaletteMode; dateAction?: 'go' | 'move'; query?: string }
  | { kind: 'shortcuts' }
  | { kind: 'settings' }
  | { kind: 'about' }

export interface Toast {
  id: number
  message: string
  undo?: boolean
}

export interface UIState {
  today: ISODate
  view: View
  settings: Settings
  selection: Selection
  overlay: Overlay
  toast: Toast | null
  dragging: boolean
}

export const ui = new Store<UIState>({
  today: todayISO(),
  view: { mode: 'week' },
  settings: DEFAULT_SETTINGS,
  selection: { kind: 'none' },
  overlay: null,
  toast: null,
  dragging: false
})

let toastSeq = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

export function showToast(message: string, options: { undo?: boolean; duration?: number } = {}): void {
  const toast = { id: ++toastSeq, message, undo: options.undo }
  ui.set({ toast })
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    if (ui.get().toast?.id === toast.id) ui.set({ toast: null })
  }, options.duration ?? 4500)
}

export function dismissToast(): void {
  ui.set({ toast: null })
}
