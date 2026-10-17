import type { Item } from './types'

/**
 * Turns the flat item records of one day into the ordered, indented rows the editor
 * renders. The derivation is total: whatever state synchronization produces
 * (missing parents, parents on other days, cycles, duplicate positions), every live
 * item is rendered exactly once — nothing is ever hidden or silently dropped.
 */

export interface Row {
  id: string
  depth: number
  parentId: string | null
}

/** Sibling order: fractional position, ties broken by id for determinism across devices. */
export function compareItems(a: Pick<Item, 'position' | 'id'>, b: Pick<Item, 'position' | 'id'>): number {
  if (a.position < b.position) return -1
  if (a.position > b.position) return 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function buildOutline(items: Iterable<Item>): Row[] {
  const live = new Map<string, Item>()
  for (const item of items) if (!item.deleted) live.set(item.id, item)

  const children = new Map<string | null, Item[]>()
  const push = (key: string | null, item: Item): void => {
    const list = children.get(key)
    if (list) list.push(item)
    else children.set(key, [item])
  }
  for (const item of live.values()) {
    // Orphans (parent missing, deleted, or on another day) render at the top level.
    const parent = item.parentId && live.has(item.parentId) ? item.parentId : null
    push(parent, item)
  }
  for (const list of children.values()) list.sort(compareItems)

  const rows: Row[] = []
  const visited = new Set<string>()
  const walk = (parentId: string | null, depth: number): void => {
    for (const item of children.get(parentId) ?? []) {
      if (visited.has(item.id)) continue
      visited.add(item.id)
      rows.push({ id: item.id, depth, parentId })
      walk(item.id, depth + 1)
    }
  }
  walk(null, 0)

  // Items caught in a parent cycle are unreachable from the roots; surface them.
  if (visited.size < live.size) {
    const stranded = [...live.values()].filter((item) => !visited.has(item.id)).sort(compareItems)
    for (const item of stranded) {
      if (visited.has(item.id)) continue
      visited.add(item.id)
      rows.push({ id: item.id, depth: 0, parentId: null })
      walk(item.id, 1)
    }
  }
  return rows
}
