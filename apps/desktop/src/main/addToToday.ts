import { addToLinks, insertLinesAfter } from '@shared/editor/ops'
import { Tx } from '@shared/editor/tx'
import { soleLink } from '@shared/links'
import type { ISODate, Item } from '@shared/types'

/**
 * Lines that come from outside Cue: a `cue://add?text=…` link (a bookmarklet, a Shortcut in
 * the Share menu) or the save-tab shortcut (capture.ts). They only ever add a line to today,
 * where the iPhone's share sheet puts one: a link under the day's "Links" bullet, anything
 * else at the end. Nothing from outside edits or deletes anything.
 */

/** Longest line taken from outside. Far more than any link needs, small enough to read. */
export const MAX_LINE = 2000

/** One line of text: trimmed, breaks turned into spaces, cut to `MAX_LINE`. Null if nothing's left. */
export function cleanLine(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let text = input
    .replace(/\s*[\r\n\u0085\u2028\u2029]\s*/g, ' ')
    .replace(/\t/g, ' ')
    // Other control characters can't be seen or typed, so they'd only confuse the line.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
  if (text.length > MAX_LINE) {
    text = text.slice(0, MAX_LINE)
    // Never leave half of a character (an emoji, say) at the end.
    if (/[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1)
    text = text.trimEnd()
  }
  return text || null
}

/**
 * The line a `cue://add?text=…` link asks for (`url=` works the same way), or null when the
 * link isn't one Cue understands or carries nothing to add.
 */
export function parseAddUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'cue:') return null
  // `cue://add?…` names the action as the host; `cue:add?…` and `cue:///add?…` as the path.
  const action = (parsed.host + parsed.pathname).replace(/^\/+|\/+$/g, '').toLowerCase()
  if (action !== 'add') return null
  return cleanLine(parsed.searchParams.get('text')) ?? cleanLine(parsed.searchParams.get('url'))
}

/**
 * The records that add `text` to `date`, given the day as stored. A line that's only a
 * link goes last under the day's "Links" bullet, which is made at the end of the day if
 * there isn't one (`ops.addToLinks`, as the iPhone's share sheet does). Anything else is a
 * plain line after the last top-level line. Placed the way Return places a new line, so it
 * writes only what it adds (unless the day's keys have grown long enough to need re-spacing).
 */
export function addedLine(day: Item[], date: ISODate, text: string, now = Date.now()): Item[] {
  const live = day.filter((item) => item.date === date && !item.deleted)
  const byId = new Map(live.map((item) => [item.id, item]))
  const tx = new Tx({ get: (id) => byId.get(id), itemsOn: (on) => (on === date ? live : []) }, now)
  const line = { depth: 0, type: 'text' as const, done: false, text }
  if (soleLink(text)) addToLinks(tx, date, line)
  else insertLinesAfter(tx, date, null, [line])
  return tx.netChanges().map((change) => change.after)
}
