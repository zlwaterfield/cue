import type { ISODate } from '@shared/types'
import { itemStore } from '../store/items'
import { ui } from '../store/ui'
import { backend } from '../data/backend'
import { controller, ghostId } from './controller'
import { offsetWithin, rangeFromPoint } from './dom'
import { linkAt } from './highlights'
import * as ops from '@shared/editor/ops'

/**
 * Pointer interactions: drag-and-drop of items (with children, across days) and
 * drag-to-select across rows.
 */

const INDENT = 24
const DRAG_THRESHOLD = 4
const EDGE = 48

interface DropTarget {
  date: ISODate
  parentId: string | null
  after: string | null | 'end'
  depth: number
  lineY: number
  lineX: number
  lineRight: number
}

function rowElement(target: Element | null): HTMLElement | null {
  return (target?.closest('.row[data-row-id]') as HTMLElement | null) ?? null
}

export function beginItemDrag(e: React.PointerEvent<HTMLElement>, id: string): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const start = itemStore.get(id)
  if (!start) return

  const selection = ui.get().selection
  const roots =
    selection.kind === 'blocks' && controller.isSelected(id, selection) ? controller.selectedIds(selection) : [id]
  const moving = new Set<string>()
  for (const rootId of roots) {
    const rows = itemStore.outline(itemStore.get(rootId)!.date)
    const index = rows.findIndex((r) => r.id === rootId)
    if (index === -1) continue
    moving.add(rootId)
    for (let i = index + 1; i < rows.length && rows[i].depth > rows[index].depth; i++) moving.add(rows[i].id)
  }
  const startRows = itemStore.outline(start.date)
  const originDepth = startRows.find((r) => r.id === id)?.depth ?? 0
  const startX = e.clientX
  const startY = e.clientY
  const scroller = document.querySelector('.scroller') as HTMLElement | null

  let active = false
  let target: DropTarget | null = null
  let pointer = { x: startX, y: startY }
  let frame = 0
  let ghost: HTMLElement | null = null
  let indicator: HTMLElement | null = null

  // Geometric, not hit-tested: the nearest day by vertical position, then the
  // insertion point by row midpoints. Works from the gutter, gaps, and headings.
  const compute = (x: number, y: number): DropTarget | null => {
    const days = [...document.querySelectorAll<HTMLElement>('.day[data-day]')]
    if (!days.length) return null
    let dayEl = days[0]
    let best = Infinity
    for (const day of days) {
      const r = day.getBoundingClientRect()
      const distance = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
      if (distance < best) {
        best = distance
        dayEl = day
      }
    }
    const date = dayEl.dataset.day!
    const container = dayEl.querySelector('.rows') as HTMLElement
    const box = container.getBoundingClientRect()
    const rows = itemStore.outline(date).filter((r) => !moving.has(r.id))
    const rects = rows.map((r) => controller.element(r.id)?.closest('.row')?.getBoundingClientRect())

    let index = rows.length
    for (let i = 0; i < rows.length; i++) {
      const rect = rects[i]
      if (rect && y < rect.top + rect.height / 2) {
        index = i
        break
      }
    }
    const lineY =
      index < rows.length && rects[index]
        ? rects[index]!.top
        : rows.length && rects[rows.length - 1]
          ? rects[rows.length - 1]!.bottom
          : box.top + 4

    const desired = originDepth + Math.round((x - startX) / INDENT)
    const maxDepth = index > 0 ? rows[index - 1].depth + 1 : 0
    const minDepth = index < rows.length ? rows[index].depth : 0
    const depth = Math.max(minDepth, Math.min(desired, maxDepth))

    let parentId: string | null = null
    let after: string | null = null
    for (let i = index - 1; i >= 0; i--) {
      if (rows[i].depth === depth && after === null) after = rows[i].id
      if (rows[i].depth < depth) {
        parentId = rows[i].id
        break
      }
    }
    return { date, parentId, after, depth, lineY, lineX: box.left + depth * INDENT, lineRight: box.right }
  }

  const render = (): void => {
    if (ghost) ghost.style.transform = `translate(${pointer.x + 12}px, ${pointer.y + 10}px)`
    target = compute(pointer.x, pointer.y)
    if (!indicator) return
    if (!target) {
      indicator.style.opacity = '0'
      return
    }
    indicator.style.opacity = '1'
    indicator.style.transform = `translate(${target.lineX}px, ${target.lineY - 1}px)`
    indicator.style.width = `${Math.max(40, target.lineRight - target.lineX)}px`
  }

  const autoscroll = (): void => {
    frame = 0
    if (!active || !scroller) return
    const view = scroller.getBoundingClientRect()
    let delta = 0
    if (pointer.y < view.top + EDGE) delta = -Math.ceil((view.top + EDGE - pointer.y) / 4)
    else if (pointer.y > view.bottom - EDGE) delta = Math.ceil((pointer.y - (view.bottom - EDGE)) / 4)
    if (delta) {
      scroller.scrollTop += delta
      render()
      frame = requestAnimationFrame(autoscroll)
    }
  }

  const activate = (): void => {
    active = true
    ui.set({ dragging: true })
    document.body.classList.add('is-dragging')
    for (const movingId of moving) controller.element(movingId)?.closest('.row')?.classList.add('is-dragged')
    ghost = document.createElement('div')
    ghost.className = 'drag-ghost'
    const label = start.text.trim() || 'Untitled'
    ghost.textContent = label.length > 48 ? label.slice(0, 47) + '…' : label
    if (roots.length > 1) {
      const badge = document.createElement('span')
      badge.className = 'drag-ghost-count'
      badge.textContent = String(roots.length)
      ghost.appendChild(badge)
    }
    indicator = document.createElement('div')
    indicator.className = 'drop-indicator'
    document.body.append(ghost, indicator)
  }

  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('keydown', onKey, true)
    if (frame) cancelAnimationFrame(frame)
    ghost?.remove()
    indicator?.remove()
    document.body.classList.remove('is-dragging')
    document.querySelectorAll('.row.is-dragged').forEach((el) => el.classList.remove('is-dragged'))
    if (active) ui.set({ dragging: false })
  }

  const onMove = (ev: PointerEvent): void => {
    pointer = { x: ev.clientX, y: ev.clientY }
    if (!active) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return
      activate()
    }
    render()
    if (!frame) frame = requestAnimationFrame(autoscroll)
  }

  const onUp = (): void => {
    const drop = active ? target : null
    cleanup()
    if (!drop) {
      // A plain click on the handle selects the item for keyboard actions.
      if (!active) controller.selectBlocks(start.date, id, id)
      return
    }
    const snapshot = controller.snapshot()
    const selectionAfter = ui.get().selection
    controller.commit(
      'Move',
      (tx) => {
        if (!ops.dropAt(tx, roots, drop.date, drop.parentId, drop.after)) return null
        if (selectionAfter.kind === 'blocks') {
          const first = tx.roots(roots)[0]
          return { kind: 'blocks', date: drop.date, anchor: first, focus: tx.roots(roots).at(-1)! }
        }
        return snapshot.kind === 'text' && tx.get(snapshot.id) ? snapshot : { id, start: tx.get(id)!.text.length }
      },
      { before: snapshot }
    )
  }

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      target = null
      active = false
      cleanup()
      ui.set({ dragging: false })
    }
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('keydown', onKey, true)
}

/** Mouse-down inside an item's text: shift-click range, or drag across rows to select them. */
export function beginTextPointer(e: React.MouseEvent<HTMLElement>, id: string, date: ISODate): void {
  if (e.button !== 0) return
  if (e.metaKey) {
    // ⌘-click opens a link under the pointer.
    const el = e.currentTarget
    const hit = rangeFromPoint(e.clientX, e.clientY)
    const url = hit && el.contains(hit.node) ? linkAt(el.textContent ?? '', offsetWithin(el, hit.node, hit.offset)) : null
    if (url) {
      e.preventDefault()
      void backend.openExternal(url)
      return
    }
  }
  const selection = ui.get().selection
  if (e.shiftKey) {
    const anchor =
      selection.kind === 'blocks' ? selection.anchor : selection.kind === 'text' && selection.id !== id ? selection.id : null
    if (anchor && itemStore.get(anchor)?.date === date) {
      e.preventDefault()
      controller.selectBlocks(date, anchor, id)
      return
    }
  }

  let selecting = false
  const onMove = (ev: MouseEvent): void => {
    if (!(ev.buttons & 1)) return
    const over = rowElement(document.elementFromPoint(ev.clientX, ev.clientY))
    const overId = over?.dataset.rowId
    if (!overId || over!.dataset.date !== date) return
    if (overId !== id || selecting) {
      if (!selecting) {
        selecting = true
        document.body.classList.add('is-selecting')
      }
      window.getSelection()?.removeAllRanges()
      const current = ui.get().selection
      if (current.kind !== 'blocks' || current.focus !== overId || current.anchor !== id) {
        controller.selectBlocks(date, id, overId)
      }
    }
  }
  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.classList.remove('is-selecting')
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/** Clicking below a day's rows focuses its blank line. */
export function focusDayEnd(date: ISODate): void {
  controller.focusText(ghostId(date), 0)
}
