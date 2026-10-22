import { beforeEach, describe, expect, it } from 'vitest'
import { formatVersion } from '../../src/shared/hlc'
import type { Notes } from '../../src/shared/mcp/notes'
import { handleMessage } from '../../src/shared/mcp/server'
import { buildOutline } from '../../src/shared/outline'
import type { ISODate, Item } from '../../src/shared/types'
import { newItem } from './helpers'

const DAY = '2026-10-21'
const NEXT = '2026-10-22'

/** The sync server's rules in memory: live reads, and a write lands only if its version is newer. */
class MemoryNotes implements Notes {
  rows = new Map<string, Item>()
  pushes: Item[][] = []

  constructor(items: Item[] = []) {
    for (const item of items) this.rows.set(item.id, item)
  }
  private live(): Item[] {
    return [...this.rows.values()].filter((i) => !i.deleted)
  }
  async itemsOn(dates: ISODate[]) {
    return this.live().filter((i) => dates.includes(i.date))
  }
  async items(ids: string[]) {
    return this.live().filter((i) => ids.includes(i.id))
  }
  async todos(from: ISODate, to: ISODate, includeDone: boolean) {
    return this.live().filter((i) => i.type === 'todo' && i.date >= from && i.date <= to && (includeDone || !i.done))
  }
  async search(terms: string[], limit: number) {
    return this.live()
      .filter((i) => terms.every((t) => i.text.toLowerCase().includes(t.toLowerCase())))
      .slice(0, limit)
  }
  async push(items: Item[]) {
    this.pushes.push(items)
    for (const item of items) {
      const stored = this.rows.get(item.id)
      if (!stored || item.version > stored.version) this.rows.set(item.id, item)
    }
  }
  /** The day as Markdown-ish lines, in outline order. */
  page(date: ISODate): string[] {
    const items = this.live().filter((i) => i.date === date)
    return buildOutline(items).map((row) => {
      const item = this.rows.get(row.id)!
      const marker = item.type === 'todo' ? (item.done ? '[x] ' : '[ ] ') : item.type === 'bullet' ? '- ' : ''
      return '  '.repeat(row.depth) + marker + item.text
    })
  }
}

let notes: MemoryNotes
let nextId = 1

async function call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const reply = await handleMessage({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }, notes)
  const result = (reply as { result: { content: Array<{ text: string }>; isError?: boolean } }).result
  return { text: result.content[0].text, isError: result.isError }
}

const ver = (wall: number): string => formatVersion(wall, 0, 'device1')

describe('MCP protocol', () => {
  beforeEach(() => (notes = new MemoryNotes()))

  it('agrees on a protocol version and introduces Cue', async () => {
    const reply = await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
      notes
    )
    const result = (reply as { result: { protocolVersion: string; instructions: string; capabilities: object } }).result
    expect(result.protocolVersion).toBe('2025-06-18')
    expect(result.capabilities).toEqual({ tools: {} })
    expect(result.instructions).toMatch(/time zone/)

    const newer = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } }, notes)
    expect((newer as { result: { protocolVersion: string } }).result.protocolVersion).toBe('2025-11-25')
  })

  it('lists five tools, marking which only read', async () => {
    const reply = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, notes)
    const tools = (reply as { result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> } }).result.tools
    expect(tools.map((t) => [t.name, t.annotations.readOnlyHint])).toEqual([
      ['get_day', true],
      ['find_todos', true],
      ['search', true],
      ['add_lines', false],
      ['update_lines', false]
    ])
  })

  it('answers no notification, and says when a method or tool is unknown', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, notes)).toBeNull()
    expect(await handleMessage({ jsonrpc: '2.0', id: 1, method: 'resources/list' }, notes)).toMatchObject({ error: { code: -32601 } })
    expect(
      await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'delete_everything' } }, notes)
    ).toMatchObject({ error: { code: -32602 } })
  })
})

describe('MCP tools', () => {
  let call1: Item
  let detail: Item
  let shipped: Item

  beforeEach(() => {
    call1 = newItem({ date: DAY, type: 'todo', text: 'Call the dentist', position: 'a1', version: ver(1000) })
    detail = newItem({ date: DAY, type: 'bullet', text: 'Ask about Friday', parentId: call1.id, position: 'a0', version: ver(1000) })
    shipped = newItem({ date: DAY, type: 'todo', text: 'Ship the MCP server', done: true, position: 'a2', version: ver(1000) })
    const spacer = newItem({ date: DAY, type: 'text', text: '', position: 'a3', version: ver(1000) })
    const gone = newItem({ date: DAY, type: 'todo', text: 'Deleted', position: 'a4', deleted: true, version: ver(1000) })
    notes = new MemoryNotes([call1, detail, shipped, spacer, gone])
  })

  it('reads a day as Markdown with ids, skipping empty paragraphs', async () => {
    const { text } = await call('get_day', { date: DAY })
    expect(text).toBe(
      [
        '# Wednesday, October 21, 2026',
        '',
        `- [ ] Call the dentist {#${call1.id}}`,
        `  - Ask about Friday {#${detail.id}}`,
        `- [x] Ship the MCP server {#${shipped.id}}`
      ].join('\n')
    )
    expect((await call('get_day', { date: NEXT })).text).toMatch(/Nothing written on this day yet/)
  })

  it('reports a bad argument to the assistant instead of failing', async () => {
    expect(await call('get_day', { date: 'today' })).toEqual({ text: expect.stringMatching(/must be a date/), isError: true })
    expect(await call('update_lines', { ids: ['nope'], done: true })).toEqual({ text: expect.stringMatching(/No line with id nope/), isError: true })
    expect(await call('find_todos', { from: NEXT, to: DAY })).toMatchObject({ isError: true })
  })

  it('finds open to-dos across days, and done ones on request', async () => {
    notes.rows.set('x', newItem({ id: 'x', date: NEXT, type: 'todo', text: 'Book flights', version: ver(1) }))
    const open = await call('find_todos', { from: DAY, to: NEXT })
    expect(open.text).toContain('## Wednesday, October 21, 2026\n\n- [ ] Call the dentist')
    expect(open.text).toContain('## Thursday, October 22, 2026\n\n- [ ] Book flights')
    expect(open.text).not.toContain('Ship the MCP server')
    expect((await call('find_todos', { from: DAY, include_done: true })).text).toContain('- [x] Ship the MCP server')
  })

  it('searches by every word', async () => {
    expect((await call('search', { query: 'dentist call' })).text).toContain('Call the dentist')
    expect((await call('search', { query: 'dentist flights' })).text).toBe('Nothing matches “dentist flights”.')
  })

  it('adds Markdown lines at the end of the day, nested as written', async () => {
    const { text } = await call('add_lines', { date: DAY, markdown: '- [ ] Book flights\n  - window seat\nPack' })
    expect(text).toMatch(/^Added 3 lines to Wednesday, October 21, 2026:\n\n- \[ \] Book flights \{#[0-9a-f-]{36}\}\n {2}- window seat/)
    expect(notes.page(DAY)).toEqual([
      '[ ] Call the dentist',
      '  - Ask about Friday',
      '[x] Ship the MCP server',
      '',
      '[ ] Book flights',
      '  - window seat',
      'Pack'
    ])
    // One upload, every record stamped by the server's own clock.
    expect(notes.pushes).toHaveLength(1)
    expect(notes.pushes[0].every((i) => /^[0-9a-z]{10}-[0-9a-z]{4}-[0-9a-z]+$/.test(i.version))).toBe(true)
  })

  it('adds lines right after another line', async () => {
    await call('add_lines', { date: DAY, markdown: '- [ ] Pay the bill', after_id: call1.id })
    expect(notes.page(DAY).slice(0, 3)).toEqual(['[ ] Call the dentist', '  - Ask about Friday', '[ ] Pay the bill'])
    expect(await call('add_lines', { date: NEXT, markdown: 'x', after_id: call1.id })).toMatchObject({ isError: true })
  })

  it('checks off a to-do, and makes a line a to-do when asked to check it off', async () => {
    await call('update_lines', { ids: [call1.id, detail.id], done: true })
    expect(notes.page(DAY).slice(0, 2)).toEqual(['[x] Call the dentist', '  [x] Ask about Friday'])
    await call('update_lines', { ids: [`{#${call1.id}}`], done: false })
    expect(notes.page(DAY)[0]).toBe('[ ] Call the dentist')
  })

  it('rewrites one line at a time', async () => {
    await call('update_lines', { ids: [shipped.id], text: 'Ship it\nnow', type: 'bullet' })
    expect(notes.page(DAY)[2]).toBe('- Ship it now')
    expect(await call('update_lines', { ids: [call1.id, shipped.id], text: 'x' })).toMatchObject({ isError: true })
  })

  it('moves lines, with what is nested under them, to the end of another day', async () => {
    notes.rows.set('t', newItem({ id: 't', date: NEXT, type: 'todo', text: 'Already there', position: 'a0', version: ver(1) }))
    const { text } = await call('update_lines', { ids: [call1.id], date: NEXT })
    expect(text).toContain('## Thursday, October 22, 2026')
    expect(notes.page(NEXT)).toEqual(['[ ] Already there', '[ ] Call the dentist', '  - Ask about Friday'])
    expect(notes.page(DAY)).toEqual(['[x] Ship the MCP server', ''])
  })

  it('wins over a stored version even when a device’s clock runs ahead', async () => {
    const future = Date.now() + 86_400_000
    notes.rows.set(call1.id, { ...call1, version: ver(future) })
    await call('update_lines', { ids: [call1.id], done: true })
    expect(notes.rows.get(call1.id)!.done).toBe(true)
    expect(notes.rows.get(call1.id)!.version > ver(future)).toBe(true)
  })

  it('sends nothing when nothing changes', async () => {
    const { text } = await call('update_lines', { ids: [shipped.id], done: true })
    expect(text).toMatch(/Nothing to change/)
    expect(notes.pushes).toHaveLength(0)
  })
})
