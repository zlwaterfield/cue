/**
 * Small fuzzy matcher for the command palette: substring matches rank highest,
 * then subsequences, with bonuses for word starts and consecutive characters.
 * Returns null when the query doesn't match at all.
 */

function isBoundary(text: string, index: number): boolean {
  return index === 0 || /[\s\-/(]/.test(text[index - 1])
}

function isSubsequence(query: string, text: string, from: number): boolean {
  let i = from
  for (const ch of query) {
    i = text.indexOf(ch, i)
    if (i === -1) return false
    i++
  }
  return true
}

export function fuzzyScore(rawQuery: string, rawTarget: string): number | null {
  const query = rawQuery.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!query) return 0
  const target = rawTarget.toLowerCase()

  const at = target.indexOf(query)
  if (at !== -1) return 1000 + (isBoundary(target, at) ? 300 : 0) - at * 3 - target.length * 0.5

  const chars = query.replace(/ /g, '')
  let score = 0
  let from = 0
  let prev = -2
  for (let k = 0; k < chars.length; k++) {
    const ch = chars[k]
    const rest = chars.slice(k + 1)
    let found = -1
    for (let j = from; j < target.length; j++) {
      if (target[j] === ch && isBoundary(target, j) && isSubsequence(rest, target, j + 1)) {
        found = j
        break
      }
    }
    if (found === -1) found = target.indexOf(ch, from)
    if (found === -1) return null
    score += found === prev + 1 ? 16 : isBoundary(target, found) ? 12 : 2
    prev = found
    from = found + 1
  }
  return score - target.length * 0.5
}
