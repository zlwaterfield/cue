import { describe, expect, it } from 'vitest'
import { collectLinks, filterLinks } from '@shared/linkList'
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
    const find = (query: string, limit?: number) => filterLinks(links, query, (url) => pages.get(url), limit).map((l) => l.id)
    expect(find('')).toEqual(['a', 'b', 'c'])
    expect(find('planning')).toEqual(['a', 'b'])
    // One term from the line, one from the page.
    expect(find('offsite planning')).toEqual(['a'])
    expect(find('PLANNING   release')).toEqual(['b'])
    expect(find('c.com')).toEqual(['c'])
    expect(find('nothing')).toEqual([])
    expect(find('', 2)).toEqual(['a', 'b'])
    // The line's own search text isn't handed out.
    expect(filterLinks(links, '', () => undefined)[0]).not.toHaveProperty('search')
  })
})
