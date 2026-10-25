import { describe, expect, it } from 'vitest'
import { buildOutline } from '@shared/outline'
import { collectLooseEnds, looseEndDays, looseEndsLabel, looseEndsRange, movedToTodayLabel } from '@shared/looseEnds'
import type { Item } from '@shared/types'
import { newItem } from './helpers'

function storeOf(items: Item[]) {
  const byId = new Map(items.map((i) => [i.id, i]))
  return {
    get: (id: string) => byId.get(id),
    outline: (date: string) => buildOutline(items.filter((i) => i.date === date))
  }
}

describe('loose ends', () => {
  it('looks at the last 30 days, not today', () => {
    expect(looseEndsRange('2026-10-22')).toEqual({ from: '2026-09-22', to: '2026-10-21' })
  })

  it('gathers unfinished, non-blank to-dos, oldest day first and in page order', () => {
    const parent = newItem({ id: 'p', date: '2026-10-20', type: 'bullet', text: 'Errands', position: 'a0' })
    const items = [
      parent,
      newItem({ id: 'n', date: '2026-10-20', type: 'todo', text: 'nested', parentId: 'p', position: 'a0' }),
      newItem({ id: 'b', date: '2026-10-20', type: 'todo', text: 'after', position: 'a1' }),
      newItem({ id: 'a', date: '2026-10-12', type: 'todo', text: 'oldest', position: 'a0' }),
      newItem({ id: 'd', date: '2026-10-12', type: 'todo', text: 'done', done: true, position: 'a1' }),
      newItem({ id: 'e', date: '2026-10-12', type: 'todo', text: '  ', position: 'a2' })
    ]
    const ids = (keep?: Set<string>) => collectLooseEnds(storeOf(items), ['2026-10-20', '2026-10-12'], keep).map((i) => i.id)
    expect(ids()).toEqual(['a', 'n', 'b'])
    // Checked off from the list this session: stays, crossed out.
    expect(ids(new Set(['d']))).toEqual(['a', 'd', 'n', 'b'])
  })

  it('keeps the day of a to-do checked off from the list, but never today or later', () => {
    const items = [
      newItem({ id: 'old', date: '2026-10-15', type: 'todo', done: true }),
      newItem({ id: 'now', date: '2026-10-22', type: 'todo', done: true })
    ]
    const store = storeOf(items)
    expect(looseEndDays(['2026-10-20'], new Set(['old', 'now', 'gone']), store, '2026-10-22')).toEqual(['2026-10-15', '2026-10-20'])
    expect(looseEndDays(['2026-10-15'], new Set(['old']), store, '2026-10-22')).toEqual(['2026-10-15'])
  })

  it('says how many are left', () => {
    expect(looseEndsLabel(0)).toBe('Nothing left from earlier days')
    expect(looseEndsLabel(1)).toBe('1 open from earlier day')
    expect(looseEndsLabel(4)).toBe('4 open from earlier days')
    expect(movedToTodayLabel(1)).toBe('Moved to today')
    expect(movedToTodayLabel(3)).toBe('Moved 3 to-dos to today')
  })
})
