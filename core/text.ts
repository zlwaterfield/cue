/**
 * Text folding for search: case- and accent-insensitive matching ("Café" ≈ "cafe").
 * `foldWithMap` also returns, for every folded character, the index of the original
 * character it came from, so matches can be highlighted in the original text.
 */

const COMBINING = /[̀-ͯ]/

export function fold(text: string): string {
  return foldWithMap(text).folded
}

export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = ''
  const map: number[] = []
  let index = 0
  for (const char of text) {
    const decomposed = char.normalize('NFKD').toLowerCase()
    for (const piece of decomposed) {
      if (COMBINING.test(piece)) continue
      folded += piece
      for (let i = 0; i < piece.length; i++) map.push(index)
    }
    index += char.length
  }
  map.push(index)
  return { folded, map }
}

export function searchTerms(query: string): string[] {
  return fold(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** Ranges in the original text matching any of the terms, merged and sorted. */
export function matchRanges(text: string, terms: string[]): Array<[number, number]> {
  if (!terms.length) return []
  const { folded, map } = foldWithMap(text)
  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    let from = 0
    for (;;) {
      const at = folded.indexOf(term, from)
      if (at === -1) break
      ranges.push([map[at], map[at + term.length]])
      from = at + Math.max(term.length, 1)
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** What both apps say when `isEmailAddress` fails, and when the sync server rejects an address. */
export const NOT_AN_EMAIL = 'That doesn’t look like an email address.'

/** Worth asking the sync server for a code: something@something.something, with no spaces. */
export function isEmailAddress(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())
}
