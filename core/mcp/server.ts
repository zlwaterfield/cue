import { diffDays, isISODate, longDate } from '../dates.ts'
import { insertLinesAfter, moveToDate } from '../editor/ops.ts'
import { Tx, type ItemSource } from '../editor/tx.ts'
import { HybridLogicalClock } from '../hlc.ts'
import { isUUID } from '../ids.ts'
import { lineToMarkdown, parseMarkdownLines } from '../markdown.ts'
import { buildOutline } from '../outline.ts'
import { ITEM_TYPES, type ISODate, type Item, type ItemType } from '../types.ts'
import { Unauthorized, type Notes } from './notes.ts'

/**
 * Cue's MCP server: a handful of tools over one person's synced notes, spoken in the
 * same Markdown Cue copies, exports and pastes, plus each line's id. Edits run through
 * the editor's own operations (`editor/ops.ts`), so a line an assistant adds or moves
 * lands exactly where it would if typed on the Mac, and they're pushed like any
 * device's edits.
 *
 * This is the protocol's stateless, JSON-only subset (no sessions, no streaming), which
 * is all a request/response tool server needs.
 */

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const MAX_LINES = 200
const MAX_TEXT = 100_000
const MAX_RANGE_DAYS = 366

const INSTRUCTIONS = `Cue is the user's daily notes and to-do app. Every day is a page of lines: plain text, bullets ("- ") and to-dos ("- [ ] ", done "- [x] "), nested by two spaces.

Days are dates (YYYY-MM-DD) in the user's own calendar: work out "today" in their time zone, not UTC.

Every line shown ends with its id, like {#0199e3a4-…}. Pass ids to update_lines. Never write ids into text.

Changes show up on the user's Mac and iPhone within seconds.`

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, boolean | string>
  run(notes: Notes, args: Record<string, unknown>): Promise<string>
}

/** A mistake the assistant can fix, reported back to it as the tool's result. */
class ToolError extends Error {}

const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD, in the user’s calendar.' }

const TOOLS: Tool[] = [
  {
    name: 'get_day',
    title: 'Read a day',
    description: 'Read one day’s page: every line in order, as Markdown, with ids.',
    inputSchema: { type: 'object', properties: { date: DATE }, required: ['date'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(notes, args) {
      const date = dateArg(args.date, 'date')
      return renderDay(date, await notes.itemsOn([date]))
    }
  },
  {
    name: 'find_todos',
    title: 'Find to-dos',
    description:
      'List to-dos across a range of days, open ones only unless include_done is true. Use it for "what’s left this week" or to find unfinished to-dos from past days.',
    inputSchema: {
      type: 'object',
      properties: {
        from: DATE,
        to: { ...DATE, description: 'Last day, inclusive. Defaults to `from`.' },
        include_done: { type: 'boolean', description: 'Include completed to-dos. Defaults to false.' }
      },
      required: ['from']
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(notes, args) {
      const from = dateArg(args.from, 'from')
      const to = args.to === undefined ? from : dateArg(args.to, 'to')
      if (diffDays(from, to) < 0) throw new ToolError('`to` must be on or after `from`.')
      if (diffDays(from, to) >= MAX_RANGE_DAYS) throw new ToolError(`Ask for at most ${MAX_RANGE_DAYS} days at a time.`)
      const todos = await notes.todos(from, to, args.include_done === true)
      return todos.length ? renderByDay(todos) : `No ${args.include_done ? '' : 'open '}to-dos from ${from} to ${to}.`
    }
  },
  {
    name: 'search',
    title: 'Search notes',
    description: 'Find lines containing every word of the query, newest days first.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Defaults to 25.' }
      },
      required: ['query']
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(notes, args) {
      const terms = typeof args.query === 'string' ? args.query.split(/\s+/).filter(Boolean) : []
      if (!terms.length) throw new ToolError('`query` needs at least one word.')
      const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit as number, 1), 100) : 25
      const found = await notes.search(terms, limit)
      return found.length ? renderByDay(found, 'desc') : `Nothing matches “${args.query}”.`
    }
  },
  {
    name: 'add_lines',
    title: 'Add lines',
    description:
      'Add lines to a day, written as Markdown: "- [ ] " for a to-do, "- " for a bullet, plain text otherwise, one line each, nested by two spaces. They go at the end of the day, or right after the line `after_id`.',
    inputSchema: {
      type: 'object',
      properties: {
        date: DATE,
        markdown: { type: 'string', minLength: 1, description: 'For example "- [ ] Call the dentist\\n- [ ] Book flights".' },
        after_id: { type: 'string', description: 'Put the new lines right after this line (on the same day).' }
      },
      required: ['date', 'markdown']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(notes, args) {
      const date = dateArg(args.date, 'date')
      const lines = typeof args.markdown === 'string' ? parseMarkdownLines(args.markdown) : []
      if (!lines.length) throw new ToolError('`markdown` has no lines.')
      if (lines.length > MAX_LINES) throw new ToolError(`Add at most ${MAX_LINES} lines at a time.`)
      if (lines.some((l) => l.text.length > MAX_TEXT)) throw new ToolError('A line is too long.')
      let after: string | null = null
      if (args.after_id !== undefined) {
        const [anchor] = await existing(notes, [args.after_id])
        if (anchor.date !== date) throw new ToolError(`Line ${anchor.id} is on ${anchor.date}, not ${date}.`)
        after = anchor.id
      }
      const tx = new Tx(source(await notes.itemsOn([date])))
      const created = insertLinesAfter(tx, date, after, lines)
      await commit(notes, tx)
      const added = created.map((id, i) => line(tx.get(id)!, lines[i].depth))
      return `Added ${plural(created.length, 'line')} to ${longDate(date)}:\n\n${added.join('\n')}`
    }
  },
  {
    name: 'update_lines',
    title: 'Update lines',
    description:
      'Change one or more lines: check off or reopen to-dos (setting `done` makes a line a to-do), change type, rewrite text (one line only), or move lines, with anything nested under them, to the end of another day.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_LINES },
        done: { type: 'boolean' },
        type: { type: 'string', enum: ITEM_TYPES },
        text: { type: 'string', description: 'New text, without the "- [ ] " marker.' },
        date: { ...DATE, description: 'Move the lines to the end of this day.' }
      },
      required: ['ids']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(notes, args) {
      if (!Array.isArray(args.ids) || !args.ids.length) throw new ToolError('`ids` needs at least one line id.')
      if (args.ids.length > MAX_LINES) throw new ToolError(`Update at most ${MAX_LINES} lines at a time.`)
      const type = args.type
      if (type !== undefined && !ITEM_TYPES.includes(type as ItemType)) throw new ToolError('`type` must be text, bullet or todo.')
      if (args.done !== undefined && typeof args.done !== 'boolean') throw new ToolError('`done` must be true or false.')
      const text = args.text === undefined ? undefined : textArg(args.text)
      if (text !== undefined && args.ids.length > 1) throw new ToolError('Rewrite one line at a time.')
      const date = args.date === undefined ? undefined : dateArg(args.date, 'date')

      const targets = await existing(notes, args.ids)
      const days = new Set(targets.map((t) => t.date))
      if (date) days.add(date)
      const tx = new Tx(source(await notes.itemsOn([...days])))
      const ids = targets.map((t) => t.id)
      for (const id of ids) {
        tx.update(id, {
          ...(type !== undefined ? { type: type as ItemType } : args.done !== undefined ? { type: 'todo' } : {}),
          ...(args.done !== undefined ? { done: args.done as boolean } : {}),
          ...(text !== undefined ? { text } : {})
        })
      }
      if (date) moveToDate(tx, ids, date)
      const changed = await commit(notes, tx)
      if (!changed) return 'Nothing to change: the lines already look like that.'
      return `Updated ${plural(ids.length, 'line')}:\n\n${renderByDay(ids.map((id) => tx.get(id)!))}`
    }
  }
]

/* ------------------------------------------------------------------ Protocol */

type Id = string | number | null

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: Id
  method: string
  params?: Record<string, unknown>
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: Id; result: unknown }
  | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string } }

/** Answer one JSON-RPC message; notifications get no answer. */
export async function handleMessage(message: JsonRpcRequest, notes: Notes): Promise<JsonRpcResponse | null> {
  if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } }
  }
  if (message.id === undefined) return null
  const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: message.id!, result })
  const params = message.params ?? {}
  switch (message.method) {
    case 'initialize': {
      const asked = params.protocolVersion as string
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'cue', title: 'Cue', version: '1.0.0' },
        instructions: INSTRUCTIONS
      })
    }
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ run: _run, ...tool }) => tool) })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name)
      if (!tool) return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `Unknown tool: ${params.name}` } }
      try {
        const text = await tool.run(notes, (params.arguments ?? {}) as Record<string, unknown>)
        return reply({ content: [{ type: 'text', text }] })
      } catch (error) {
        if (error instanceof Unauthorized) throw error
        if (!(error instanceof ToolError)) console.error(error)
        const text = error instanceof ToolError ? error.message : 'Cue couldn’t reach your notes. Try again in a moment.'
        return reply({ content: [{ type: 'text', text }], isError: true })
      }
    }
    default:
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
  }
}

/* ------------------------------------------------------------------- Writing */

/** This server's clock. Each instance is its own "device", with its own node id. */
const clock = new HybridLogicalClock(crypto.randomUUID().replace(/-/g, '').slice(0, 13))

function source(items: Item[]): ItemSource {
  const byId = new Map(items.map((i) => [i.id, i]))
  return { get: (id) => byId.get(id), itemsOn: (date) => items.filter((i) => i.date === date) }
}

/**
 * Stamp and upload a draft's changes. Each version is made newer than the stored one
 * (`observe`), so the server accepts the edit even if some device's clock runs ahead.
 */
async function commit(notes: Notes, tx: Tx): Promise<number> {
  const now = Date.now()
  const records = tx.netChanges().map(({ before, after }) => {
    clock.observe(before?.version)
    return { ...after, updatedAt: now, version: clock.now() }
  })
  if (records.length) await notes.push(records)
  return records.length
}

/** The live lines with these ids, or a ToolError naming any that aren't. */
async function existing(notes: Notes, given: unknown[]): Promise<Item[]> {
  // Accept an id copied with its marker, `{#…}`, too.
  const ids = given.map((id) => (typeof id === 'string' ? id.replace(/^\{?#|\}$/g, '') : id))
  const valid = [...new Set(ids.filter(isUUID))]
  const found = valid.length ? await notes.items(valid) : []
  const missing = ids.filter((id) => !found.some((item) => item.id === id))
  if (missing.length) throw new ToolError(`No line with id ${missing.join(', ')}. It may have been deleted; read the day again.`)
  return found
}

function dateArg(value: unknown, name: string): ISODate {
  if (!isISODate(value)) throw new ToolError(`\`${name}\` must be a date like 2026-10-21.`)
  return value
}

function textArg(value: unknown): string {
  if (typeof value !== 'string') throw new ToolError('`text` must be a string.')
  const text = value.replace(/[\r\n]+/g, ' ').trim()
  if (text.length > MAX_TEXT) throw new ToolError('`text` is too long.')
  return text
}

/* ----------------------------------------------------------------- Rendering */

function line(item: Item, depth = 0): string {
  return `${'  '.repeat(depth)}${lineToMarkdown(item)} {#${item.id}}`
}

export function renderDay(date: ISODate, items: Item[]): string {
  const byId = new Map(items.map((i) => [i.id, i]))
  const lines = buildOutline(items)
    .map((row) => ({ item: byId.get(row.id)!, depth: row.depth }))
    // Empty paragraphs are spacing, not content.
    .filter(({ item }) => item.type !== 'text' || item.text.trim() !== '')
    .map(({ item, depth }) => line(item, depth))
  return `# ${longDate(date)}\n\n${lines.length ? lines.join('\n') : 'Nothing written on this day yet.'}`
}

function renderByDay(items: Item[], order: 'asc' | 'desc' = 'asc'): string {
  const days = new Map<ISODate, Item[]>()
  for (const item of items) days.set(item.date, [...(days.get(item.date) ?? []), item])
  const dates = [...days.keys()].sort()
  if (order === 'desc') dates.reverse()
  return dates.map((date) => `## ${longDate(date)}\n\n${days.get(date)!.map((i) => line(i)).join('\n')}`).join('\n\n')
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
