import { caretRect } from './dom'

/**
 * Cue's caret, which is also its brand mark: 2 px wide, the accent color, rounded,
 * line height minus 4 px, with a calm 1.1 s hard on/off blink that holds solid while
 * you type, rests solid once the caret has been still for about 10 s, and doesn't blink
 * at all under Reduce Motion (see app.css).
 *
 * Browsers can't restyle the native caret's width or blink, so one overlay element is
 * positioned at the selection. The native caret is hidden only while the overlay is
 * actually showing, so a positioning failure falls back to the system caret.
 */

const HOLD_SOLID_MS = 500

let caret: HTMLDivElement | null = null
let frame = 0
let idle: ReturnType<typeof setTimeout> | null = null
let lastKey = ''

function hide(): void {
  document.body.classList.remove('has-cue-caret')
  lastKey = ''
}

function update(): void {
  frame = 0
  if (!caret) return
  const active = document.activeElement as HTMLElement | null
  const selection = window.getSelection()
  if (
    !active ||
    !active.isContentEditable ||
    !active.dataset.editableId ||
    !document.hasFocus() ||
    !selection ||
    !selection.rangeCount ||
    !selection.isCollapsed ||
    !active.contains(selection.focusNode)
  ) {
    hide()
    return
  }

  const style = getComputedStyle(active)
  const line = parseFloat(style.lineHeight) || 24
  const height = Math.max(10, line - 4)
  let x: number
  let center: number
  const rect = caretRect(active)
  if (rect) {
    x = rect.left
    center = rect.top + rect.height / 2
  } else {
    // Empty line: the caret sits just in front of the content box, so a placeholder
    // reads as the next line waiting to be written (the app icon, live).
    const box = active.getBoundingClientRect()
    x = box.left + (parseFloat(style.paddingLeft) || 0) - 2
    center = box.top + (parseFloat(style.paddingTop) || 0) + line / 2
  }

  // Hidden when scrolled out of the page area (e.g. under the title bar).
  const scroller = active.closest('.scroller')?.getBoundingClientRect()
  if (scroller && (center < scroller.top || center > scroller.bottom)) {
    hide()
    return
  }

  const top = Math.round(center - height / 2)
  const left = Math.round(x - 1)
  caret.style.transform = `translate(${left}px, ${top}px)`
  caret.style.height = `${height}px`
  document.body.classList.add('has-cue-caret')

  // Only a real move resets the blink, so scrolling or re-renders don't stutter it.
  const key = `${left}:${top}:${height}`
  if (key !== lastKey) {
    lastKey = key
    caret.classList.add('is-solid')
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => caret?.classList.remove('is-solid'), HOLD_SOLID_MS)
  }
}

/** Re-position on the next frame (selection, layout, scroll, focus, or theme changes). */
export function refreshCaret(): void {
  if (!frame) frame = requestAnimationFrame(update)
}

export function installCaret(): void {
  if (caret) return
  caret = document.createElement('div')
  caret.className = 'cue-caret'
  caret.setAttribute('aria-hidden', 'true')
  document.body.append(caret)
  document.addEventListener('selectionchange', refreshCaret)
  document.addEventListener('focusin', refreshCaret)
  document.addEventListener('focusout', refreshCaret)
  document.addEventListener('scroll', refreshCaret, true)
  window.addEventListener('resize', refreshCaret)
  window.addEventListener('focus', refreshCaret)
  window.addEventListener('blur', hide)
  // Draw synchronously the first time so the caret is there when the window appears.
  update()
}
