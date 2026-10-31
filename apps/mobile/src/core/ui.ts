import { todayISO } from '@shared/dates'
import { DEFAULT_SETTINGS, type ISODate, type Settings } from '@shared/types'
import { Store } from './store'

export interface Toast {
  id: number
  message: string
  undo?: boolean
}

export interface UIState {
  today: ISODate
  /** The day on screen. */
  date: ISODate
  settings: Settings
  /** The line being edited (an item id, or a day's blank last line). */
  focusedId: string | null
  keyboard: boolean
  toast: Toast | null
  /** A line is being dragged. */
  dragging: boolean
  /** A line to point out briefly (opened from search). */
  flash: { id: string; at: number } | null
  /** Today's "open from earlier days" list is unfolded. For this session only. */
  looseEndsOpen: boolean
  /** The last day picked in Move to that its named days (Today, Tomorrow…) don't cover. For this session only. */
  lastMoveDate: ISODate | null
}

const today = todayISO()

export const ui = new Store<UIState>({
  today,
  date: today,
  settings: DEFAULT_SETTINGS,
  focusedId: null,
  keyboard: false,
  toast: null,
  dragging: false,
  flash: null,
  looseEndsOpen: false,
  lastMoveDate: null
})

let toastSeq = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

export function showToast(message: string, options: { undo?: boolean; duration?: number } = {}): void {
  const toast = { id: ++toastSeq, message, undo: options.undo }
  ui.set({ toast })
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    if (ui.get().toast?.id === toast.id) ui.set({ toast: null })
  }, options.duration ?? 4000)
}

export function dismissToast(): void {
  ui.set({ toast: null })
}
