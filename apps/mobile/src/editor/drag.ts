import { makeMutable } from 'react-native-reanimated'
import { metrics } from '../ui/theme'
import { clampDepth, insertionIndex, prefixTops, subtreeEnd, type OutlineRow } from '@shared/editor/geometry'
import type { DayGeometry } from './layout'

/**
 * Long-press-and-drag, on the UI thread. A line lifts with its children; dragging up and
 * down opens a gap where it will land, and dragging sideways nests or un-nests it, one
 * indent step at a time, within what the outline allows at that gap. Nothing touches the
 * JavaScript thread until the line is dropped.
 */

export interface DragState {
  active: boolean
  /** Released; waiting for the drop to be committed. */
  dropping: boolean
  date: string
  id: string
  /** The dragged block: rows[from] (the line) through rows[to - 1] (its last descendant). */
  from: number
  to: number
  startTop: number
  rootHeight: number
  blockHeight: number
  baseDepth: number
  /** The other lines (the day's blank last line excluded), laid out without the block. */
  rest: OutlineRow[]
  restTops: number[]
  restHeights: number[]
  restEnd: number
  translationX: number
  translationY: number
  startScroll: number
  /** The block's offset from where it started, including any auto-scroll. */
  dy: number
  /** The gap among `rest` it would drop into, and at what depth. */
  index: number
  depth: number
  /** Finger position on screen, for scrolling at the edges. */
  absoluteY: number
}

const IDLE: DragState = {
  active: false,
  dropping: false,
  date: '',
  id: '',
  from: 0,
  to: 0,
  startTop: 0,
  rootHeight: 0,
  blockHeight: 0,
  baseDepth: 0,
  rest: [],
  restTops: [],
  restHeights: [],
  restEnd: 0,
  translationX: 0,
  translationY: 0,
  startScroll: 0,
  dy: 0,
  index: 0,
  depth: 0,
  absoluteY: 0
}

export const drag = makeMutable<DragState>(IDLE)

/** The day page's scroll position and visible area, in screen coordinates. */
export const scrollState = makeMutable({ y: 0, viewportTop: 0, viewportHeight: 0, maxY: 0 })

export function beginDrag(date: string, id: string, g: DayGeometry, absoluteY: number): boolean {
  'worklet'
  const from = g.index[id]
  // The last row is the day's blank line, which isn't an item.
  const count = g.ids.length - 1
  if (from === undefined || from >= count) return false
  const rows: OutlineRow[] = []
  for (let i = 0; i < count; i++) rows.push({ id: g.ids[i], depth: g.depths[i] })
  const to = subtreeEnd(rows, from)
  const rest: OutlineRow[] = []
  const restHeights: number[] = []
  for (let i = 0; i < count; i++) {
    if (i >= from && i < to) continue
    rest.push(rows[i])
    restHeights.push(g.heights[i])
  }
  const restTops = prefixTops(restHeights)
  let blockHeight = 0
  for (let i = from; i < to; i++) blockHeight += g.heights[i]
  drag.value = {
    active: true,
    dropping: false,
    date,
    id,
    from,
    to,
    startTop: g.tops[from],
    rootHeight: g.heights[from],
    blockHeight,
    baseDepth: g.depths[from],
    rest,
    restTops,
    restHeights,
    restEnd: restTops.length ? restTops[restTops.length - 1] + restHeights[restHeights.length - 1] : 0,
    translationX: 0,
    translationY: 0,
    startScroll: scrollState.value.y,
    dy: 0,
    index: from,
    depth: g.depths[from],
    absoluteY
  }
  return true
}

/** Recompute the drop target. Returns true if it changed (for a haptic tick). */
export function updateDrag(translationX: number, translationY: number, absoluteY: number): boolean {
  'worklet'
  const d = drag.value
  if (!d.active || d.dropping) return false
  const dy = translationY + (scrollState.value.y - d.startScroll)
  const center = d.startTop + dy + d.rootHeight / 2
  const index = insertionIndex(d.restTops, d.restHeights, center)
  const depth = clampDepth(d.rest, index, d.baseDepth + Math.round(translationX / metrics.indent))
  const changed = index !== d.index || depth !== d.depth
  drag.value = { ...d, translationX, translationY, absoluteY, dy, index, depth }
  return changed
}

/** End the drag from JavaScript, once the drop is committed and the new layout is in place. */
export function resetDrag(): void {
  drag.value = IDLE
}

/**
 * Where a row is drawn while a drag is in progress: the block follows the finger, and
 * the other lines make room at the gap. Null when the row isn't on the dragged day.
 */
export function dragTop(d: DragState, g: DayGeometry, index: number): { top: number; lifted: boolean; x: number } | null {
  'worklet'
  if (index >= d.from && index < d.to) {
    return { top: d.startTop + d.dy + (g.tops[index] - g.tops[d.from]), lifted: true, x: (d.depth - d.baseDepth) * metrics.indent }
  }
  const count = g.ids.length - 1
  if (index >= count) return { top: d.restEnd + d.blockHeight, lifted: false, x: 0 }
  const r = index < d.from ? index : index - (d.to - d.from)
  return { top: d.restTops[r] + (r >= d.index ? d.blockHeight : 0), lifted: false, x: 0 }
}
