import { locate } from './dom'

/**
 * Decorations painted with the CSS Custom Highlight API, so the editable DOM stays
 * pure text: links get a quiet underline (⌘-click opens them) and search results
 * flash briefly when opened.
 */

const supported = typeof CSS !== 'undefined' && 'highlights' in CSS
const links = supported ? new Highlight() : null
const flashes = supported ? new Highlight() : null
if (supported) {
  CSS.highlights.set('cue-link', links!)
  CSS.highlights.set('cue-flash', flashes!)
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']*[^\s<>"'.,;:!?)\]}]/gi
const rowRanges = new Map<string, Range[]>()

function rangeFor(el: HTMLElement, start: number, end: number): Range {
  const a = locate(el, start)
  const b = locate(el, end)
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  return range
}

export function findLinks(text: string): Array<{ start: number; end: number; url: string }> {
  if (!text.includes('http') && !text.includes('www.')) return []
  return [...text.matchAll(URL_RE)].map((m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
    url: m[0].startsWith('www.') ? `https://${m[0]}` : m[0]
  }))
}

export function linkAt(text: string, offset: number): string | null {
  return findLinks(text).find((l) => offset >= l.start && offset <= l.end)?.url ?? null
}

export function updateLinks(id: string, el: HTMLElement | null): void {
  if (!links) return
  for (const range of rowRanges.get(id) ?? []) links.delete(range)
  rowRanges.delete(id)
  if (!el) return
  const found = findLinks(el.textContent ?? '')
  if (!found.length) return
  const ranges = found.map((l) => rangeFor(el, l.start, l.end))
  for (const range of ranges) links.add(range)
  rowRanges.set(id, ranges)
}

export function flash(el: HTMLElement, start: number, end: number): void {
  if (!flashes || end <= start) return
  const range = rangeFor(el, start, end)
  flashes.add(range)
  setTimeout(() => flashes.delete(range), 1600)
}
