import { describe, expect, it } from 'vitest'
import { buildOutline } from '@shared/outline'
import type { Item } from '@shared/types'

let n = 0
function item(partial: Partial<Item> & { id: string }): Item {
  return {
    date: '2026-10-17',
    parentId: null,
    position: `a${n++}`,
    type: 'bullet',
    text: partial.id,
    done: false,
    createdAt: 0,
    updatedAt: 0,
    deleted: false,
    version: '',
    ...partial
  }
}

describe('buildOutline', () => {
  it('orders siblings by position then id and nests children', () => {
    const rows = buildOutline([
      item({ id: 'b', position: 'a1' }),
      item({ id: 'a', position: 'a0' }),
      item({ id: 'a2', parentId: 'a', position: 'a1' }),
      item({ id: 'a1', parentId: 'a', position: 'a0' }),
      item({ id: 'z', position: 'a1' }) // ties with b; id breaks the tie
    ])
    expect(rows.map((r) => `${r.id}:${r.depth}`)).toEqual(['a:0', 'a1:1', 'a2:1', 'b:0', 'z:0'])
  })

  it('renders orphans and deleted-parent children at the top level', () => {
    const rows = buildOutline([
      item({ id: 'p', deleted: true, position: 'a0' }),
      item({ id: 'c', parentId: 'p', position: 'a1' }),
      item({ id: 'o', parentId: 'missing', position: 'a2' })
    ])
    expect(rows.map((r) => `${r.id}:${r.depth}`)).toEqual(['c:0', 'o:0'])
  })

  it('never drops items caught in a parent cycle', () => {
    const rows = buildOutline([
      item({ id: 'x', parentId: 'y', position: 'a0' }),
      item({ id: 'y', parentId: 'x', position: 'a1' }),
      item({ id: 'r', position: 'a2' })
    ])
    expect(rows.map((r) => r.id).sort()).toEqual(['r', 'x', 'y'])
    expect(rows.length).toBe(3)
  })
})
