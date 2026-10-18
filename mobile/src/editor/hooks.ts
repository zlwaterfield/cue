import { useCallback, useSyncExternalStore } from 'react'
import type { Row } from '@shared/outline'
import type { ISODate, Item } from '@shared/types'
import { itemStore } from '../core/app'

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
