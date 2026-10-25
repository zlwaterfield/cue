/**
 * Outline geometry for touch: where each line sits, and where a dragged line lands. The
 * iPhone app runs these as worklets, on the UI thread, while a line is being dragged (the
 * 'worklet' directives are plain strings anywhere else). Tested in mobileGeometry.test.ts.
 */

export interface OutlineRow {
  id: string
  depth: number
}

/** Running offsets: tops[i] is where row i starts. */
export function prefixTops(heights: readonly number[]): number[] {
  'worklet'
  const tops: number[] = []
  let y = 0
  for (let i = 0; i < heights.length; i++) {
    tops.push(y)
    y += heights[i]
  }
  return tops
}

/** One past the last descendant of rows[index]: a line always moves with its children. */
export function subtreeEnd(rows: readonly OutlineRow[], index: number): number {
  'worklet'
  let end = index + 1
  while (end < rows.length && rows[end].depth > rows[index].depth) end++
  return end
}

/**
 * The depths a block can take between rest[index - 1] and rest[index]: at most one deeper
 * than the line above (becoming its child), and no shallower than the line below (which
 * would otherwise be pulled out from under its own parent).
 */
export function clampDepth(rest: readonly OutlineRow[], index: number, wanted: number): number {
  'worklet'
  const max = index > 0 ? rest[index - 1].depth + 1 : 0
  const min = index < rest.length ? Math.min(rest[index].depth, max) : 0
  return Math.max(min, Math.min(max, wanted))
}

/** Where the dragged block's top line goes: the gap whose midpoint it has passed. */
export function insertionIndex(
  restTops: readonly number[],
  restHeights: readonly number[],
  centerY: number
): number {
  'worklet'
  let index = 0
  while (index < restTops.length && restTops[index] + restHeights[index] / 2 < centerY) index++
  return index
}

/**
 * Where a line dropped at gap `index` (among the lines other than it and its children),
 * dragged to `depth`, goes in the outline. Null when it lands where it started.
 */
export function dropTarget(
  rows: readonly OutlineRow[],
  id: string,
  index: number,
  depth: number
): { parentId: string | null; after: string | null } | null {
  const from = rows.findIndex((r) => r.id === id)
  if (from === -1) return null
  const end = subtreeEnd(rows, from)
  const rest = [...rows.slice(0, from), ...rows.slice(end)]
  const target = clampDepth(rest, index, depth)
  if (index === from && target === rows[from].depth) return null
  return placement(rest, index, target)
}

/**
 * The parent and preceding sibling for a block dropped at `index` among the remaining
 * rows, at `depth` (already clamped). Walking up, the first line at `depth` is the
 * sibling before it, and the first shallower line is its parent; in a valid outline
 * that line is exactly one level up.
 */
export function placement(
  rest: readonly OutlineRow[],
  index: number,
  depth: number
): { parentId: string | null; after: string | null } {
  'worklet'
  let after: string | null = null
  for (let i = index - 1; i >= 0; i--) {
    const row = rest[i]
    if (row.depth < depth) return { parentId: row.id, after }
    if (row.depth === depth && after === null) after = row.id
  }
  return { parentId: null, after }
}
