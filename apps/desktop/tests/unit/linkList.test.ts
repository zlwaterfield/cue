import { describe, expect, it } from 'vitest'
import { collectLinks, filterLinks, linkDay, linkGroup, linkNote } from '@shared/linkList'
import { buildOutline } from '@shared/outline'
import { memoryRepo, newItem } from './helpers'

describe('the Links list', () => {
  it('finds every line with a link, newest day first and in page order, and skips deleted lines', () => {
    const repo = memoryRepo()
    repo.saveItems([
      newItem({ id: 'old', date: '2026-10-01', text: 'https://a.com', position: 'a0' }),
      newItem({ id: 'plain', date: '2026-10-20', text: 'no link here', position: 'a0' }),
      newItem({ id: 'second', date: '2026-10-20', text: 'then WWW.b.com', position: 'a2' }),
      newItem({ id: 'first', date: '2026-10-20', text: 'read https://c.com/x first', type: 'todo', position: 'a1' }),
      newItem({ id: 'gone', date: '2026-10-21', text: 'https://d.com', deleted: true })
    ])
    expect(repo.linkLines().map((l) => l.id)).toEqual(['first', 'second', 'old'])
    expect(repo.linkLines()[0]).toEqual({ id: 'first', date: '2026-10-20', type: 'todo', done: false, text: 'read https://c.com/x first', search: 'read https://c.com/x first' })
  })

  it('lists a day’s links in page order, nested ones under their parents', () => {
    const repo = memoryRepo()
    const day = '2026-10-20'
    repo.saveItems([
      newItem({ id: 'heading', date: day, type: 'bullet', text: 'Links', position: 'a0' }),
      newItem({ id: 'nested-2', date: day, parentId: 'heading', text: 'https://b.com', position: 'a9' }),
      newItem({ id: 'nested-1', date: day, parentId: 'heading', text: 'https://a.com', position: 'a5' }),
      newItem({ id: 'top', date: day, text: 'https://c.com', position: 'a1' }),
      // A parent that's deleted, or on another day, leaves its line at the top level.
      newItem({ id: 'gone', date: day, type: 'bullet', text: 'gone', position: 'a2', deleted: true }),
      newItem({ id: 'orphan', date: day, parentId: 'gone', text: 'https://d.com', position: 'a0' }),
      newItem({ id: 'elsewhere', date: '2026-10-19', type: 'bullet', text: 'other day', position: 'a0' }),
      newItem({ id: 'stray', date: day, parentId: 'elsewhere', text: 'https://e.com', position: 'a3' })
    ])
    const ids = repo.linkLines().map((l) => l.id)
    expect(ids).toEqual(['nested-1', 'nested-2', 'orphan', 'top', 'stray'])
    // Exactly the order the day's page draws them in.
    const page = buildOutline(repo.loadDates([day])).map((row) => row.id)
    expect(page.filter((id) => ids.includes(id))).toEqual(ids)
  })

  it('lists each link once, on the newest line it’s on, and every link on a line', () => {
    const line = (id: string, date: string, text: string) => ({ id, date, type: 'text' as const, done: false, text, search: text.toLowerCase() })
    const links = collectLinks([
      line('new', '2026-10-20', 'compare https://a.com and https://b.com'),
      line('old', '2026-10-01', 'https://a.com')
    ])
    expect(links.map((l) => [l.url, l.id])).toEqual([
      ['https://a.com', 'new'],
      ['https://b.com', 'new']
    ])
  })

  it('finds a link by its line or its page, every term somewhere, and an empty query finds all', () => {
    const line = (id: string, text: string) => ({ id, date: '2026-10-20', type: 'text' as const, done: false, text, search: text.toLowerCase() })
    const links = collectLinks([line('a', 'for the offsite https://a.com'), line('b', 'https://b.com'), line('c', 'https://c.com')])
    const pages = new Map([
      ['https://a.com', 'a talk about planning'],
      ['https://b.com', 'release planning at a small company']
    ])
    const find = (query: string, limit?: number) => filterLinks(links, query, (url) => pages.get(url), limit).links.map((l) => l.id)
    expect(find('')).toEqual(['a', 'b', 'c'])
    expect(find('planning')).toEqual(['a', 'b'])
    // One term from the line, one from the page.
    expect(find('offsite planning')).toEqual(['a'])
    expect(find('PLANNING   release')).toEqual(['b'])
    expect(find('c.com')).toEqual(['c'])
    expect(find('nothing')).toEqual([])
    // A page of them, with how many there are in all.
    expect(find('', 2)).toEqual(['a', 'b'])
    expect(filterLinks(links, '', () => undefined, 2).total).toBe(3)
    expect(filterLinks(links, 'planning', (url) => pages.get(url), 1)).toMatchObject({ total: 2, links: [{ id: 'a' }] })
    // The line's own search text isn't handed out.
    expect(filterLinks(links, '', () => undefined).links[0]).not.toHaveProperty('search')
  })

  it('lists links under this week, last week, then their month', () => {
    // Saturday, October 31, 2026; weeks start on Monday the 26th.
    const group = (date: string) => linkGroup(date, '2026-10-31', 1)
    expect(group('2026-11-02')).toBe('Coming up')
    expect(group('2026-11-01')).toBe('This week')
    expect(group('2026-10-26')).toBe('This week')
    expect(group('2026-10-25')).toBe('Last week')
    expect(group('2026-10-19')).toBe('Last week')
    expect(group('2026-10-18')).toBe('October')
    expect(group('2025-12-31')).toBe('December 2025')
    // Weeks starting on Sunday: the 25th is this week.
    expect(linkGroup('2026-10-25', '2026-10-31', 0)).toBe('This week')
  })

  it('labels a link’s day briefly', () => {
    expect(linkDay('2026-10-31', '2026-10-31')).toBe('Today')
    expect(linkDay('2026-10-30', '2026-10-31')).toBe('Yesterday')
    expect(linkDay('2026-11-01', '2026-10-31')).toBe('Tomorrow')
    expect(linkDay('2026-10-26', '2026-10-31')).toBe('Mon')
    expect(linkDay('2026-10-24', '2026-10-31')).toBe('Oct 24')
    expect(linkDay('2025-03-03', '2026-10-31')).toBe('Mar 3')
  })

  it('keeps what was written around a link', () => {
    expect(linkNote('https://a.com')).toBe('')
    expect(linkNote('read https://a.com before the offsite')).toBe('read before the offsite')
    expect(linkNote('Offsite: https://a.com')).toBe('Offsite')
    expect(linkNote('https://a.com — via Sam')).toBe('via Sam')
    expect(linkNote('compare https://a.com, https://b.com')).toBe('compare')
    expect(linkNote('(see https://a.com)')).toBe('see')
  })
})
