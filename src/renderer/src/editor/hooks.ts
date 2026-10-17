import { useCallback, useSyncExternalStore } from 'react'
import type { Row } from '@shared/outline'
import type { ISODate, Item } from '@shared/types'
import { itemStore } from '../store/items'
import { ui } from '../store/ui'
import { controller } from './controller'

export function useItem(id: string): Item | undefined {
  const subscribe = useCallback((listener: () => void) => itemStore.subscribeItem(id, listener), [id])
  return useSyncExternalStore(subscribe, () => itemStore.get(id))
}

export function useOutline(date: ISODate): Row[] {
  const subscribe = useCallback((listener: () => void) => itemStore.subscribeDate(date, listener), [date])
  return useSyncExternalStore(subscribe, () => itemStore.outline(date))
}

export function useIsSelected(id: string): boolean {
  return useSyncExternalStore(ui.subscribe, () => controller.isSelected(id, ui.get().selection))
}
