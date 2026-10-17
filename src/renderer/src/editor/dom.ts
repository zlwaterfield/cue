/**
 * Caret and geometry helpers for the per-item plain-text editables.
 */

export interface Offsets {
  start: number
  end: number
  /** True when the selection's focus is at `start` (selecting backwards). */
  backward: boolean
}

export function offsetWithin(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(root)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return range.toString().length
}

export function getOffsets(el: HTMLElement): Offsets | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !sel.anchorNode || !sel.focusNode) return null
  if (!el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return null
  const anchor = offsetWithin(el, sel.anchorNode, sel.anchorOffset)
  const focus = offsetWithin(el, sel.focusNode, sel.focusOffset)
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), backward: focus < anchor }
}

export function locate(el: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let last: Text | null = null
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (remaining <= node.length) return { node, offset: remaining }
    remaining -= node.length
    last = node
  }
  if (last) return { node: last, offset: last.length }
  return { node: el, offset: 0 }
}

export function setOffsets(el: HTMLElement, start: number, end = start): void {
  const length = el.textContent?.length ?? 0
  const a = locate(el, Math.max(0, Math.min(start, length)))
  const b = locate(el, Math.max(0, Math.min(end, length)))
  const sel = window.getSelection()
  if (!sel) return
  sel.setBaseAndExtent(a.node, a.offset, b.node, b.offset)
}

function lineMetrics(el: HTMLElement): { top: number; bottom: number; line: number; left: number; right: number } {
  const box = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 20
  return {
    top: box.top + (parseFloat(style.paddingTop) || 0),
    bottom: box.bottom - (parseFloat(style.paddingBottom) || 0),
    left: box.left + (parseFloat(style.paddingLeft) || 0),
    right: box.right - (parseFloat(style.paddingRight) || 0),
    line
  }
}

/** Rectangle of the caret (selection focus). Null for empty editables. */
export function caretRect(el: HTMLElement): DOMRect | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !sel.focusNode || !el.contains(sel.focusNode)) return null
  if (!el.textContent) return null
  const range = document.createRange()
  range.setStart(sel.focusNode, sel.focusOffset)
  range.collapse(true)
  const rects = range.getClientRects()
  if (rects.length) return rects[0]
  // Collapsed ranges at node edges can have no rect; measure an adjacent character.
  const node = sel.focusNode
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text
    if (sel.focusOffset > 0) {
      range.setStart(text, sel.focusOffset - 1)
      range.setEnd(text, sel.focusOffset)
      const r = range.getBoundingClientRect()
      return new DOMRect(r.right, r.top, 0, r.height)
    }
    if (text.length > 0) {
      range.setEnd(text, 1)
      const r = range.getBoundingClientRect()
      return new DOMRect(r.left, r.top, 0, r.height)
    }
  }
  return null
}

/** Whether the caret sits on the first / last visual line of a (possibly wrapped) item. */
export function caretLine(el: HTMLElement): { first: boolean; last: boolean; x: number } {
  const m = lineMetrics(el)
  const rect = caretRect(el)
  if (!rect) return { first: true, last: true, x: m.left }
  const mid = (rect.top + rect.bottom) / 2
  return { first: mid < m.top + m.line, last: mid > m.bottom - m.line, x: rect.left }
}

export function rangeFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y)
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null
  }
  const range = document.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

/** Put the caret on the first/last visual line of `el`, as close to `x` as possible. */
export function placeCaretAtX(el: HTMLElement, x: number, line: 'first' | 'last'): void {
  const length = el.textContent?.length ?? 0
  if (!length) {
    setOffsets(el, 0)
    return
  }
  const m = lineMetrics(el)
  const y = line === 'first' ? m.top + m.line / 2 : m.bottom - m.line / 2
  const cx = Math.max(m.left + 1, Math.min(x, m.right - 1))
  const hit = rangeFromPoint(cx, y)
  if (hit && el.contains(hit.node)) {
    setOffsets(el, offsetWithin(el, hit.node, hit.offset))
    return
  }
  setOffsets(el, line === 'first' ? 0 : length)
}

export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

export function scrollIntoViewIfNeeded(el: HTMLElement, margin = 56): void {
  const scroller = el.closest('.scroller') as HTMLElement | null
  if (!scroller) return
  const box = el.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  if (box.top < view.top + margin) scroller.scrollTop -= view.top + margin - box.top
  else if (box.bottom > view.bottom - margin) scroller.scrollTop += box.bottom - (view.bottom - margin)
}
