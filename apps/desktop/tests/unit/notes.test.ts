import { describe, expect, it } from 'vitest'
import { friendlyDate, isISODate } from '@shared/dates'
import { linkDay, linkGroup } from '@shared/linkList'
import { FIRST_NOTE, isNotePage, LAST_NOTE, neighborNote, newNotePage, notePageLabel, notePages, notePagesOf, noteTitle, SCRATCH } from '@shared/notes'
import { buildOutline } from '@shared/outline'
import { markdownFiles } from '@shared/portability'
import { validateItem } from '@shared/repository'
import type { Item } from '@shared/types'
import { newItem } from './helpers'

function storeOf(items: Item[]) {
  const byId = new Map(items.map((i) => [i.id, i]))
  return {
    get: (id: string) => byId.get(id),
    outline: (date: string) => buildOutline(items.filter((i) => i.date === date))
  }
}

const A = '1000-03-01'
const B = '1042-07-15'

describe('notes', () => {
  it('sets aside days nobody writes on, which storage and sync accept as dates', () => {
    for (const date of [SCRATCH, FIRST_NOTE, LAST_NOTE]) {
      expect(isNotePage(date)).toBe(true)
      expect(isISODate(date)).toBe(true)
      // The sync server takes any `YYYY-MM-DD`.
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(validateItem(newItem({ date })).date).toBe(date)
    }
    for (const date of ['0999-12-31', '1100-01-01', '2026-10-17']) expect(isNotePage(date)).toBe(false)
  })

  it('names a starred note by its first line', () => {
    const store = storeOf([
      newItem({ id: 't', date: A, text: '  Books to read ', position: 'a0' }),
      newItem({ id: 'l', date: A, type: 'todo', text: 'Middlemarch', position: 'a1' }),
      newItem({ id: 'e', date: B, text: '   ', position: 'a0' })
    ])
    expect(noteTitle(store, A)).toBe('Books to read')
    expect(noteTitle(store, B)).toBe('Untitled')
    expect(noteTitle(store, SCRATCH)).toBe('Scratch')
  })

  it('lists scratch first, then starred notes with something on them, newest first', () => {
    const store = storeOf([
      newItem({ id: 'old', date: B, text: 'Older', createdAt: 100 }),
      newItem({ id: 'new', date: A, text: 'Newer', createdAt: 300 }),
      // Added to the older note later: it stays where it was.
      newItem({ id: 'late', date: B, text: 'added later', position: 'a1', createdAt: 900 }),
      newItem({ id: 's', date: SCRATCH, text: 'draft', createdAt: 999 })
    ])
    expect(notePages(store, [B, A])).toEqual([SCRATCH, A, B])
    // A page with nothing on it isn't a note, and a day never is.
    expect(notePages(store, [A, '1001-01-01', '2026-10-17', A])).toEqual([SCRATCH, A])
    expect(notePages(storeOf([]), [])).toEqual([SCRATCH])
  })

  it('picks a free page at random for a new note', () => {
    const first = newNotePage([], () => 0)
    expect(first).toBe(FIRST_NOTE)
    expect(newNotePage([first], () => 0.999999)).toBe(LAST_NOTE)
    // The same roll again lands somewhere else.
    const rolls = [0, 0, 0.5]
    const second = newNotePage([first], () => rolls.shift()!)
    expect(second).not.toBe(first)
    expect(isNotePage(second)).toBe(true)
    expect(second).not.toBe(SCRATCH)
    for (let i = 0; i < 200; i++) {
      const date = newNotePage([])
      expect(date >= FIRST_NOTE && date <= LAST_NOTE && isISODate(date)).toBe(true)
    }
  })

  it('finds the note pages among items from another device', () => {
    const items = [newItem({ date: A }), newItem({ date: A }), newItem({ date: SCRATCH }), newItem({ date: '2026-10-17' }), newItem({ date: B })]
    expect(notePagesOf(items)).toEqual([A, B])
  })

  it('steps to the note before or after, stopping at the ends', () => {
    const pages = [SCRATCH, A, B]
    expect(neighborNote(pages, SCRATCH, 1)).toBe(A)
    expect(neighborNote(pages, B, -1)).toBe(A)
    expect(neighborNote(pages, SCRATCH, -1)).toBeUndefined()
    expect(neighborNote(pages, B, 1)).toBeUndefined()
    expect(neighborNote(pages, '1050-01-01', 1)).toBeUndefined()
  })

  it('is named, not dated, wherever a date would show', () => {
    expect(notePageLabel(SCRATCH)).toBe('Scratch')
    expect(notePageLabel(A)).toBe('Notes')
    expect(friendlyDate(SCRATCH, '2026-10-17')).toBe('Scratch')
    expect(friendlyDate(A, '2026-10-17')).toBe('Notes')
    expect(linkDay(A, '2026-10-17')).toBe('Notes')
    expect(linkGroup(A, '2026-10-17', 1)).toBe('Notes')
    expect(friendlyDate('2026-10-18', '2026-10-17')).toBe('Tomorrow')
  })

  it('exports each note as a file named for it, apart from the days', () => {
    const items = [
      newItem({ date: '2026-10-17', type: 'text', text: 'a day', position: 'a0' }),
      newItem({ date: SCRATCH, type: 'text', text: 'draft', position: 'a0' }),
      newItem({ id: 't', date: A, type: 'text', text: 'Books: to read / own', position: 'a0' }),
      newItem({ date: A, type: 'todo', text: 'Middlemarch', position: 'a1' }),
      newItem({ date: B, type: 'text', text: 'Books: to read / own', position: 'a0' }),
      newItem({ date: '1050-05-05', type: 'bullet', text: 'A list with no name line', position: 'a0' })
    ]
    const files = markdownFiles(items)
    expect(files.map((f) => f.path)).toEqual([
      '2026/2026-10-17.md',
      'Notes/Scratch.md',
      'Notes/Books to read own.md',
      'Notes/Books to read own 2.md',
      'Notes/A list with no name line.md'
    ])
    const text = (path: string) => files.find((f) => f.path === path)!.text
    expect(text('Notes/Scratch.md')).toBe('# Scratch\n\ndraft\n')
    // The name is the heading, not repeated under it.
    expect(text('Notes/Books to read own.md')).toBe('# Books: to read / own\n\n- [ ] Middlemarch\n')
    // A note that opens with a bullet keeps it.
    expect(text('Notes/A list with no name line.md')).toBe('# A list with no name line\n\n- A list with no name line\n')
  })
})
