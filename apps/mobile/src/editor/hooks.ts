import { useCallback, useSyncExternalStore } from 'react'
import { diffDays } from '@shared/dates'
import type { Row } from '@shared/outline'
import type { ISODate, Item } from '@shared/types'
import { itemStore, sync } from '../core/app'
import { useStore } from '../core/store'
import type { SyncStatus } from '../core/sync'
import { ui } from '../core/ui'

/** One item; re-renders only when that item changes. */
export function useItem(id: string): Item | undefined {
  const subscribe = useCallback((l: () => void) => itemStore.subscribeItem(id, l), [id])
  return useSyncExternalStore(subscribe, () => itemStore.get(id))
}

/** A day's outline; re-renders when its structure changes. */
export function useOutline(date: ISODate): Row[] {
  const subscribe = useCallback((l: () => void) => itemStore.subscribeDate(date, l), [date])
  return useSyncExternalStore(subscribe, () => itemStore.outline(date))
}

/**
 * A day's notes may still be on their way: the first download onto this phone hasn't
 * finished, and it brings today ± 7 days first.
 */
export function arriving(status: SyncStatus, date: ISODate, today: ISODate): boolean {
  return status.downloading && !(status.recent && Math.abs(diffDays(today, date)) <= 7)
}

export function useArriving(date: ISODate): boolean {
  const today = useStore(ui, (s) => s.today)
  return useStore(sync.state, (s) => arriving(s, date, today))
}
