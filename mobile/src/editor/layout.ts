import { Dimensions } from 'react-native'
import { makeMutable, type SharedValue } from 'react-native-reanimated'
import type { ISODate } from '@shared/types'
import { itemStore } from '../core/app'
import { metrics } from '../ui/theme'
import { prefixTops } from '@shared/editor/geometry'

/**
 * Where each line of a day sits, kept outside React and shared with the UI thread.
 *
 * Lines are absolutely positioned. Their views stay in the order they were created, and
 * the outline order is applied as an offset. Reordering then never removes a native text
 * view from the window, which would end editing and drop the keyboard. That matters most
 * when another device reorders the day you're typing in. It also lets moves animate, and
 * lets a drag run on the UI thread against the same numbers.
 */

export interface DayGeometry {
  /** Rows in outline order, the day's blank last line included. */
  ids: string[]
  depths: number[]
  heights: number[]
  tops: number[]
  index: Record<string, number>
  total: number
  /** Animate this change (a move), rather than jumping (typing, inserting). */
  animate: boolean
}

const EMPTY: DayGeometry = { ids: [], depths: [], heights: [], tops: [], index: {}, total: 0, animate: false }

/** A first guess at a line's height, until it reports its real one. */
function estimate(text: string, depth: number): number {
  const width = Math.min(Dimensions.get('window').width, metrics.column) - 2 * metrics.gutter
  const textWidth = width - depth * metrics.indent - metrics.marker
  const perLine = Math.max(10, Math.floor(textWidth / (metrics.fontSize * 0.5)))
  const lines = Math.max(1, Math.ceil(text.length / perLine))
  return lines * metrics.lineHeight + 2 * metrics.rowPadding
}

export class DayLayout {
  readonly geometry: SharedValue<DayGeometry> = makeMutable(EMPTY)
  private heights = new Map<string, number>()
  private unsubscribe: (() => void) | null = null
  private frame = 0
  private animateNext = false

  constructor(
    readonly date: ISODate,
    private readonly ghostId: () => string
  ) {}

  /** Follow the day's outline while it's on screen. */
  attach(): () => void {
    this.unsubscribe ??= itemStore.subscribeDate(this.date, () => this.refresh())
    this.refresh()
    return () => {
      this.unsubscribe?.()
      this.unsubscribe = null
    }
  }

  /** The next refresh is a move: slide lines to their new places. */
  animateNextChange(): void {
    this.animateNext = true
  }

  /** Re-apply the current layout, animated (e.g. a drag ended where it began). */
  settle(): void {
    this.animateNext = true
    this.refresh()
  }

  measure(id: string, height: number): void {
    const rounded = Math.round(height * 2) / 2
    if (this.heights.get(id) === rounded) return
    this.heights.set(id, rounded)
    // Lines report their heights together after mounting: lay out once for all of them.
    if (!this.frame) this.frame = requestAnimationFrame(() => this.refresh())
  }

  refresh(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    const rows = itemStore.outline(this.date)
    const ids: string[] = []
    const depths: number[] = []
    const heights: number[] = []
    for (const row of rows) {
      ids.push(row.id)
      depths.push(row.depth)
      heights.push(this.heights.get(row.id) ?? estimate(itemStore.get(row.id)?.text ?? '', row.depth))
    }
    const ghost = this.ghostId()
    ids.push(ghost)
    depths.push(0)
    heights.push(this.heights.get(ghost) ?? metrics.rowHeight)
    const tops = prefixTops(heights)
    const index: Record<string, number> = {}
    ids.forEach((id, i) => (index[id] = i))
    this.geometry.value = {
      ids,
      depths,
      heights,
      tops,
      index,
      total: tops[tops.length - 1] + heights[heights.length - 1],
      animate: this.animateNext
    }
    this.animateNext = false
  }

  /** Top and height of a line, in the day's own coordinates. */
  frameOf(id: string): { top: number; height: number } | null {
    const g = this.geometry.value
    const i = g.index[id]
    return i === undefined ? null : { top: g.tops[i], height: g.heights[i] }
  }
}
