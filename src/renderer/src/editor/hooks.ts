import { useCallback, useSyncExternalStore } from 'react'
import type { Row } from '@shared/outline'
import type { ISODate, Item } from '@shared/types'
import { itemStore } from '../store/items'
import { ui, type Selection } from '../store/ui'
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

let shallowest: { selection: Selection | null; rows: Row[] | null; depth: number | null } = { selection: null, rows: null, depth: null }

/** The smallest depth among the block-selected rows of `selection`'s day. */
function selectionDepth(selection: Selection): number | null {
  if (selection.kind !== 'blocks') return null
  const rows = itemStore.outline(selection.date)
  if (shallowest.selection !== selection || shallowest.rows !== rows) {
    const ids = new Set(controller.selectedIds(selection))
    let depth = Infinity
    for (const row of rows) if (ids.has(row.id)) depth = Math.min(depth, row.depth)
    shallowest = { selection, rows, depth: depth === Infinity ? null : depth }
  }
  return shallowest.depth
}

/**
 * For a selected row, the depth its selection band starts at: the shallowest selected
 * row's, so the band is one rectangle. Null for rows that aren't selected.
 */
export function useSelectionDepth(id: string, date: ISODate): number | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      const offUi = ui.subscribe(listener)
      const offDay = itemStore.subscribeDate(date, listener)
      return () => {
        offUi()
        offDay()
      }
    },
    [date]
  )
  return useSyncExternalStore(subscribe, () => {
    const selection = ui.get().selection
    return controller.isSelected(id, selection) ? selectionDepth(selection) : null
  })
}
