import { longDate } from './dates'
import { buildOutline } from './outline'
import type { ISODate, Item, ItemType } from './types'

/**
 * Markdown is Cue's interchange format: it is what the clipboard carries, what export
 * writes, and what paste understands. Each item is one line; nesting is two spaces.
 *
 *   Plain text          →  Plain text
 *   • Bullet            →  - Bullet
 *   ☐ To-do / ☑ Done    →  - [ ] To-do / - [x] Done
 */

export interface LineSpec {
  depth: number
  type: ItemType
  done: boolean
  text: string
  /** The line as written, marker included (used when pasting mid-sentence). */
  raw?: string
}

export function lineToMarkdown(spec: Pick<LineSpec, 'type' | 'done' | 'text'>): string {
  if (spec.type === 'todo') return `- [${spec.done ? 'x' : ' '}] ${spec.text}`
  if (spec.type === 'bullet') return `- ${spec.text}`
  return spec.text
}

/**
 * Serialize lines to Markdown. With `document: true` (export), blank lines separate
 * paragraphs from lists so the file renders the way it looks in Cue.
 */
export function linesToMarkdown(lines: LineSpec[], options: { document?: boolean } = {}): string {
  const out: string[] = []
  let prevWasParagraph = false
  for (const line of lines) {
    const isParagraph = line.type === 'text' && line.depth === 0
    if (options.document) {
      const needsGap = out.length > 0 && out[out.length - 1] !== '' && (isParagraph || prevWasParagraph)
      if (isParagraph && line.text.trim() === '') {
        if (out.length > 0 && out[out.length - 1] !== '') out.push('')
        prevWasParagraph = false
        continue
      }
      if (needsGap) out.push('')
    }
    out.push('  '.repeat(line.depth) + lineToMarkdown(line))
    prevWasParagraph = isParagraph
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

export function dayToMarkdown(date: ISODate, items: Item[]): string {
  const byId = new Map(items.map((i) => [i.id, i]))
  const lines = buildOutline(items).map((row) => {
    const item = byId.get(row.id)!
    return { depth: row.depth, type: item.type, done: item.done, text: item.text }
  })
  const body = linesToMarkdown(lines, { document: true })
  return `# ${longDate(date)}\n\n${body}${body ? '\n' : ''}`
}

const TODO_RE = /^(?:[-*+•]\s+)?\[([ xX✓✔]?)\]\s?(.*)$/
const BOX_RE = /^([☐☑✅✓✔])\s*(.*)$/
const BULLET_RE = /^[-*+•◦▪‣]\s+(.*)$/
const NUMBERED_RE = /^\d{1,3}[.)]\s+(.*)$/

/** Interpret the marker at the start of a single (unindented) line. */
export function parseLineMarker(line: string): Omit<LineSpec, 'depth'> {
  let m = TODO_RE.exec(line)
  if (m) return { type: 'todo', done: m[1] !== '' && m[1] !== ' ', text: m[2] }
  m = BOX_RE.exec(line)
  if (m) return { type: 'todo', done: m[1] !== '☐', text: m[2] }
  m = BULLET_RE.exec(line)
  if (m) return { type: 'bullet', done: false, text: m[1] }
  m = NUMBERED_RE.exec(line)
  if (m) return { type: 'bullet', done: false, text: m[1] }
  return { type: 'text', done: false, text: line }
}

/** Parse pasted text into lines with relative depth (the shallowest line is depth 0). */
export function parseMarkdownLines(input: string): LineSpec[] {
  const raw = input.replace(/\r\n?/g, '\n').split('\n')
  const entries = raw
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const lead = /^[ \t]*/.exec(line)![0]
      const columns = [...lead].reduce((n, ch) => n + (ch === '\t' ? 4 : 1), 0)
      return { columns, body: line.slice(lead.length).trimEnd() }
    })
  if (!entries.length) return []

  const min = Math.min(...entries.map((e) => e.columns))
  const steps = entries.map((e) => e.columns - min).filter((c) => c > 0)
  const unit = steps.length ? Math.min(...steps, 4) : 2

  const out: LineSpec[] = []
  for (const entry of entries) {
    const wanted = Math.round((entry.columns - min) / Math.max(unit, 1))
    const prevDepth = out.length ? out[out.length - 1].depth : -1
    const depth = Math.max(0, Math.min(wanted, prevDepth + 1))
    out.push({ depth, ...parseLineMarker(entry.body), raw: entry.body })
  }
  return out
}
