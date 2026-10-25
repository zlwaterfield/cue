// Small things on the home page for people who take their time: tooltips, typing in the
// headline, the chips that press down, and a printable page for today. The theme, the toast
// and ⌘K live in cue.js, which every page loads.
(() => {
  const $ = (sel, el = document) => el.querySelector(sel)
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)]
  const { fmt, short, today, parseDay } = cue.dates
  const { toast } = cue
  const SINCE = new Date(2026, 9, 17) // The first commit, and the first day I used it.
  const dayNumber = () => Math.round((today() - SINCE) / 864e5) + 1

  // Which kind of pointer was used last, so taps can open what hovers open.
  let lastPointer = 'mouse'
  document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType }, true)

  // Tooltips
  const tipEl = $('.tip')
  const TIPS = {
    beta: () => `Used every day since ${fmt(SINCE, { month: 'short', day: 'numeric', year: 'numeric' })} · day ${dayNumber()}`,
    speed: () => {
      const nav = performance.getEntriesByType('navigation')[0]
      const ms = Math.round(nav && nav.domContentLoadedEventEnd ? nav.domContentLoadedEventEnd : performance.now())
      return ms <= 240
        ? `Cue is ready in 240 ms. This page took ${ms} ms, so the website wins this one.`
        : `Cue is ready in 240 ms. This page took ${ms} ms. I’m working on it.`
    },
    fri: () => `→ ${short(parseDay('fri'))}`,
    reminders: () => 'Not even this one.',
    ai: () => 'Your assistant can still reach your days, over MCP.'
  }
  let tipFor = null
  function showTip(el) {
    tipFor = el
    tipEl.textContent = TIPS[el.dataset.egg]()
    const r = el.getClientRects()[0] || el.getBoundingClientRect()
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight
    let top = r.top - h - 8
    if (top < 8) top = r.bottom + 8
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)
    tipEl.style.top = `${top}px`
    tipEl.style.left = `${left}px`
    tipEl.classList.add('show')
  }
  function hideTip() { tipFor = null; tipEl.classList.remove('show') }
  for (const el of $$('[data-egg]')) {
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(el) })
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip() })
    el.addEventListener('focus', () => showTip(el))
    el.addEventListener('blur', hideTip)
    el.addEventListener('click', () => {
      if (lastPointer !== 'mouse') tipFor === el ? hideTip() : showTip(el)
    })
  }
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('[data-egg]')) hideTip() })
  addEventListener('scroll', hideTip, { passive: true })

  // The beta badge gives in after five clicks.
  let badgeClicks = 0
  $('.status').addEventListener('click', () => {
    if (++badgeClicks !== 5) return
    $('.status-text').textContent = 'Beta · okay, fine, it’s pretty stable'
    hideTip()
  })

  // Type anywhere near the top and it lands on the next line, like the app.
  const header = $('header'), h1 = $('h1'), caret = $('.caret')
  const nextLine = $('.next-line'), typed = $('.typed')
  let typing = false, solidTimer
  function holdCaret() {
    caret.classList.add('solid')
    clearTimeout(solidTimer)
    solidTimer = setTimeout(() => caret.classList.remove('solid'), 600)
  }
  function stopTyping() {
    typing = false
    typed.textContent = ''
    nextLine.hidden = true
    nextLine.classList.remove('empty')
    h1.appendChild(caret)
  }
  function typeKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false
    if (!typing && header.getBoundingClientRect().bottom <= 0) return false
    if (e.key === 'Escape') {
      if (!typing) return false
      stopTyping()
      return true
    }
    if (e.key === 'Backspace') {
      if (!typing) return false
      typed.textContent = typed.textContent.slice(0, -1)
    } else {
      if (e.key.length !== 1) return false
      if (e.key === ' ' && (!typed.textContent || e.target.closest('button, a[href]'))) return false
      if (!typing) {
        typing = true
        nextLine.hidden = false
        nextLine.appendChild(caret)
        if (document.activeElement !== document.body) document.activeElement.blur()
      }
      if (typed.textContent.length < 60) typed.textContent += e.key
    }
    nextLine.classList.toggle('empty', !typed.textContent)
    holdCaret()
    return true
  }

  // The shortcut chips press down when you press the real keys.
  const chips = Object.fromEntries($$('.grid kbd').map((k) => [k.textContent, k]))
  function press(label) {
    const chip = chips[label]
    if (!chip) return
    chip.classList.add('pressed')
    setTimeout(() => chip.classList.remove('pressed'), 160)
  }

  document.addEventListener('keydown', (e) => {
    if (cue.paletteOpen || e.target.closest('input, textarea, select, [contenteditable]')) return
    const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
    const key = e.key.toLowerCase()
    if (mod && key === 'd') { e.preventDefault(); press('⌘D'); toast('Moved to tomorrow. (Not really, this is a website.)') }
    else if (mod && key === 'enter') { e.preventDefault(); press('⌘↩'); h1.classList.toggle('done') }
    else if (key === 'tab' && !e.metaKey && !e.ctrlKey && !e.altKey) press('Tab')
    else if (typeKey(e)) e.preventDefault()
  })

  // The "Made by" card opens on the first tap on touch screens; the second tap follows the link.
  const maker = $('.maker')
  $('.maker-link').addEventListener('click', (e) => {
    if (lastPointer === 'touch' && !maker.classList.contains('open')) { e.preventDefault(); maker.classList.add('open') }
  })
  document.addEventListener('pointerdown', (e) => { if (!maker.contains(e.target)) maker.classList.remove('open') })

  // A note for whoever reads to the very end.
  const farewell = $('.farewell')
  new IntersectionObserver(([entry], observer) => {
    if (!entry.isIntersecting) return
    farewell.classList.add('seen')
    observer.disconnect()
  }, { threshold: 1 }).observe(farewell)

  // ⌘P prints a blank page for today.
  const printList = $('.print-page ol')
  for (let i = 1; i < 22; i++) printList.append(document.createElement('li'))
  function setPrintDate() {
    $('.print-page .weekday').textContent = fmt(today(), { weekday: 'long' })
    $('.print-page .date').textContent = fmt(today(), { month: 'long', day: 'numeric', year: 'numeric' })
  }
  setPrintDate()
  addEventListener('beforeprint', setPrintDate)

  // ⌘K is cue.js's; the chip and the tooltips still want to know when it opens.
  document.addEventListener('cue:palette-open', () => { press('⌘K'); hideTip() })
  document.addEventListener('cue:palette-close', hideTip)

  // The one command only this page can offer; cue.js finds the headings by itself.
  cue.add({ label: 'Print today’s page', hint: '⌘P', run: () => print() })

  console.log(`%c${String.raw`
   ___ _   _  ___   _
  / __| | | |/ _ \ | |
 | (__| |_| |  __/ | |
  \___|\__,_|\___| | |
                   |_|`}`, 'font-family: ui-monospace, Menlo, monospace; line-height: 1.15; color: #8E8E94')
  console.log(
    `%cHi, you’re reading the source. Cue’s source is open too: ${cue.GITHUB}\nA few more things are hidden on the page. Try ⌘K. — Zach`,
    'font: 13px/1.6 -apple-system, system-ui, sans-serif'
  )
})()