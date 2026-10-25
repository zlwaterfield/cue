import { describe, expect, it } from 'vitest'
import { generateNKeysBetween } from 'fractional-indexing'
import {
  clampDepth,
  dropTarget,
  insertionIndex,
  placement,
  prefixTops,
  subtreeEnd
} from '../../core/editor/geometry'
import * as ops from '../../core/editor/ops'
import { Tx } from '../../core/editor/tx'
import { ItemStore, type StoreBackend } from '../../core/itemStore'
import type { Item } from '../../core/types'

/**
 * The iPhone app's drag and drop: the gap and depth worked out on the UI thread, turned
 * into a place in the outline, then applied with the Mac's own `dropAt`.
 */

const DAY = '2026-10-17'

/** A day from an indented outline (two spaces per level). Ids are the text. */
async function day(outline: string): Promise<ItemStore> {
  const items: Item[] = []
  const stack: string[] = []
  const counts = new Map<string | null, number>()
  for (const line of outline.split('\n').filter((l) => l.trim())) {
    const depth = (line.length - line.trimStart().length) / 2
    const text = line.trim()
    const parentId = depth === 0 ? null : stack[depth - 1]
    stack[depth] = text
    stack.length = depth + 1
    const n = counts.get(parentId) ?? 0
    counts.set(parentId, n + 1)
    items.push({
      id: text,
      date: DAY,
      parentId,
      position: generateNKeysBetween(null, null, n + 1)[n],
      type: 'bullet',
      text,
      done: false,
      createdAt: 0,
      updatedAt: 0,
      deleted: false,
      version: ''
    })
  }
  const backend: StoreBackend = {
    loadDates: async () => items,
    saveItems: async () => [],
    saveItemsSync: () => {}
  }
  const store = new ItemStore(backend)
  await store.ensureLoaded([DAY])
  return store
}

function render(store: ItemStore): string {
  return store
    .outline(DAY)
    .map((r) => '  '.repeat(r.depth) + r.id)
    .join('\n')
}

/** Drag `id` to gap `index` at `depth`, as the phone does when the finger lifts. */
function drop(store: ItemStore, id: string, index: number, depth: number): boolean {
  const target = dropTarget(store.outline(DAY), id, index, depth)
  if (!target) return false
  const tx = new Tx(store)
  ops.dropAt(tx, [id], DAY, target.parentId, target.after)
  store.commit(tx.netChanges().map((c) => c.after))
  return true
}

describe('geometry', () => {
  it('lays rows out top to bottom', () => {
    expect(prefixTops([32, 56, 32])).toEqual([0, 32, 88])
    expect(prefixTops([])).toEqual([])
  })

  it('finds where a line and its children end', () => {
    const rows = [
      { id: 'a', depth: 0 },
      { id: 'b', depth: 1 },
      { id: 'c', depth: 2 },
      { id: 'd', depth: 1 },
      { id: 'e', depth: 0 }
    ]
    expect(subtreeEnd(rows, 0)).toBe(4)
    expect(subtreeEnd(rows, 1)).toBe(3)
    expect(subtreeEnd(rows, 4)).toBe(5)
  })

  it('opens the gap the dragged line has passed the middle of', () => {
    const tops = [0, 32, 64]
    const heights = [32, 32, 32]
    expect(insertionIndex(tops, heights, -10)).toBe(0)
    expect(insertionIndex(tops, heights, 15)).toBe(0)
    expect(insertionIndex(tops, heights, 17)).toBe(1)
    expect(insertionIndex(tops, heights, 200)).toBe(3)
  })

  it('allows one level deeper than the line above, and no shallower than the line below', () => {
    const rest = [
      { id: 'a', depth: 0 },
      { id: 'b', depth: 1 },
      { id: 'c', depth: 1 }
    ]
    expect(clampDepth(rest, 0, 3)).toBe(0)
    expect(clampDepth(rest, 1, 5)).toBe(1)
    // Between b and c (c is a's child): at least 1, at most 2.
    expect(clampDepth(rest, 2, 0)).toBe(1)
    expect(clampDepth(rest, 2, 9)).toBe(2)
    expect(clampDepth(rest, 3, -1)).toBe(0)
  })

  it('places a line after the nearest sibling above, under the nearest shallower line', () => {
    const rest = [
      { id: 'a', depth: 0 },
      { id: 'b', depth: 1 },
      { id: 'c', depth: 2 },
      { id: 'd', depth: 0 }
    ]
    expect(placement(rest, 3, 1)).toEqual({ parentId: 'a', after: 'b' })
    expect(placement(rest, 3, 0)).toEqual({ parentId: null, after: 'a' })
    expect(placement(rest, 2, 2)).toEqual({ parentId: 'b', after: null })
    expect(placement(rest, 0, 0)).toEqual({ parentId: null, after: null })
  })
})

describe('drag and drop on the phone', () => {
  it('moves a line up, taking its children', async () => {
    const store = await day('one\ntwo\nthree\n  three.a')
    expect(drop(store, 'three', 0, 0)).toBe(true)
    expect(render(store)).toBe('three\n  three.a\none\ntwo')
  })

  it('moves a line down past a line with children', async () => {
    const store = await day('one\ntwo\n  two.a\nthree')
    expect(drop(store, 'one', 2, 0)).toBe(true)
    expect(render(store)).toBe('two\n  two.a\none\nthree')
  })

  it('dragged right in place, nests under the line above', async () => {
    const store = await day('one\ntwo\nthree')
    expect(drop(store, 'three', 2, 1)).toBe(true)
    expect(render(store)).toBe('one\ntwo\n  three')
  })

  it('dragged left in place, steps out to its parent level', async () => {
    const store = await day('one\n  one.a\n  one.b\ntwo')
    expect(drop(store, 'one.b', 2, 0)).toBe(true)
    expect(render(store)).toBe('one\n  one.a\none.b\ntwo')
  })

  it('cannot leave a line stranded under the wrong parent', async () => {
    // Dropping "x" between "one" and its child at depth 0 would pull "one.a" out from
    // under "one"; the depth is held at 1 instead.
    const store = await day('one\n  one.a\nx')
    expect(drop(store, 'x', 1, 0)).toBe(true)
    expect(render(store)).toBe('one\n  x\n  one.a')
  })

  it('does nothing when let go where it started', async () => {
    const store = await day('one\ntwo')
    expect(drop(store, 'two', 1, 0)).toBe(false)
    expect(render(store)).toBe('one\ntwo')
  })
})
