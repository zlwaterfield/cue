/* The parts of the site that behave the same everywhere: the light/dark choice, which is
 * remembered between pages, a toast, and the ⌘K palette. Pages add their own commands with
 * cue.add(...). None of this is needed to read a page.
 *
 * The theme is applied before paint by a one-line script in each page's <head>; this file
 * only changes it from here on. */
window.cue = (() => {
  const root = document.documentElement
  const KEY = 'cue-theme'
  const DARK_MEDIA = '(prefers-color-scheme: dark)'
  const GITHUB = 'https://github.com/zlwaterfield/cue'
  const APPLE = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  const MOD = APPLE ? '⌘' : 'Ctrl+'
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const $ = (sel, el = document) => el.querySelector(sel)
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)]

  // Dates: a pocket version of the app's parser, for "move to fri".
  const fmt = (date, options) => date.toLocaleDateString('en-US', options)
  const short = (date) => fmt(date, { weekday: 'short', month: 'short', day: 'numeric' })
  const long = (date) => fmt(date, { weekday: 'long', month: 'long', day: 'numeric' })
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
  const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

  // today, tomorrow, yesterday, weekdays, next week. Like the app, a bare weekday means the
  // next one after today.
  function parseDay(text) {
    const t = text.trim().toLowerCase().replace(/^(this|on)\s+/, '')
    const base = today()
    if (t === 'next week') return addDays(base, 7)
    const aliases = { now: 0, tmr: 1, tmrw: 1, tom: 1, tomo: 1, yday: -1, yest: -1 }
    if (Object.hasOwn(aliases, t)) return addDays(base, aliases[t])
    if (t.length >= 3) {
      for (const [word, n] of [['today', 0], ['tomorrow', 1], ['yesterday', -1]]) {
        if (word.startsWith(t)) return addDays(base, n)
      }
    }
    if (t.length >= 2 || ['m', 'w', 'f'].includes(t)) {
      for (const i of [1, 2, 3, 4, 5, 6, 0]) {
        if (WEEKDAYS[i].startsWith(t)) return addDays(base, (i - base.getDay() + 7) % 7 || 7)
      }
    }
    return null
  }

  // Toast
  let toastEl = $('.toast')
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.className = 'toast'
    toastEl.setAttribute('role', 'status')
    toastEl.setAttribute('aria-live', 'polite')
    document.body.append(toastEl)
  }
  let toastTimer
  function toast(text) {
    toastEl.textContent = text
    toastEl.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800)
  }

  // Theme. A choice made here outlives the page: it's kept in localStorage and read back by the
  // snippet in the next page's <head>, so dark stays dark as you move around the site.
  const lightMeta = $('meta[name="theme-color"][media*="light"]')
  const darkMeta = $('meta[name="theme-color"][media*="dark"]')
  const stored = () => { try { return localStorage.getItem(KEY) } catch { return null } }
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia(DARK_MEDIA).matches

  function applyTheme(theme) {
    if (theme) root.dataset.theme = theme
    else delete root.dataset.theme
    try { theme ? localStorage.setItem(KEY, theme) : localStorage.removeItem(KEY) } catch {}
    sync()
  }
  // Screenshots that come in two versions follow the choice too, not just the OS.
  function sync() {
    const dark = isDark()
    for (const source of $$(`picture source[media*="prefers-color-scheme"]`)) {
      source.media = root.dataset.theme ? (dark ? 'all' : 'not all') : DARK_MEDIA
    }
    if (lightMeta && darkMeta) {
      const color = dark ? '#18181A' : '#FAFAFB'
      if (root.dataset.theme) { lightMeta.content = color; darkMeta.content = color }
      else { lightMeta.content = '#FAFAFB'; darkMeta.content = '#18181A' }
    }
  }
  function toggleTheme() {
    const dark = isDark()
    applyTheme(dark ? 'light' : 'dark')
    toast(dark ? 'Lights on.' : 'Lights off.')
  }
  sync()
  // Following the OS means following it as it changes, including the screenshots.
  matchMedia(DARK_MEDIA).addEventListener('change', () => { if (!root.dataset.theme) sync() })

  // Commands. Every page gets the links, the headings it actually has, and the appearance
  // commands; a page adds its own with cue.add(...).
  const here = location.pathname.replace(/\/index\.html$/, '/').replace(/(.)\/$/, '$1')
  const go = (href) => () => { location.href = href }
  const extras = []
  function moveTo(date) {
    const diff = Math.round((date - today()) / 864e5)
    if (diff === 0) toast('It’s already on today.')
    else if (diff < 0) toast('Moving things into the past isn’t a feature. Yet.')
    else toast(`See you ${long(date)}.`)
  }
  function sections() {
    return $$('section').flatMap((section) => {
      const heading = $('h2', section)
      if (!heading) return []
      const label = heading.textContent.trim()
      return label ? [{ label, run: () => section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }) }] : []
    })
  }
  function commands() {
    return [
      { label: 'Go to today’s page', href: '/' },
      { label: 'Download Cue', href: '/download' },
      { label: 'Connect an assistant', href: '/assistants' },
      { label: 'Go to GitHub', href: GITHUB },
      ...sections(),
      ...extras,
      { label: 'Move to fri', move: true, run: () => moveTo(parseDay('fri')) },
      { label: 'Toggle dark mode', run: toggleTheme },
      ...(stored() ? [{ label: 'Match the system appearance', run: () => { applyTheme(null); toast('Back to following your system.') } }] : []),
      { label: 'Read the privacy policy', href: '/privacy' },
      { label: 'Read the terms', href: '/terms' },
      { label: 'Who made this?', href: 'https://zlwaterfield.com' }
    ].filter((c) => c.href !== here).map((c) => (c.href ? { label: c.label, run: go(c.href) } : c))
  }

  // The palette itself, built here so no page has to carry the markup.
  const palette = document.createElement('dialog')
  palette.className = 'palette'
  palette.ariaLabel = 'Command palette'
  palette.innerHTML = `<input type="text" aria-label="Command" autocomplete="off" spellcheck="false"
      role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list">
    <ul role="listbox" id="palette-list" aria-label="Commands"></ul>`
  document.body.append(palette)
  const input = $('input', palette), list = $('ul', palette)
  input.placeholder = 'Type a command, or “move to fri”'

  let items = [], active = 0
  function render() {
    const q = input.value.trim().toLowerCase().replace(/\s+/g, ' ')
    const move = /^move (?:to )?(.+)$/.exec(q)
    const date = move && parseDay(move[1])
    const words = q.split(' ').filter(Boolean)
    items = commands().filter((c) => !(date && c.move) && words.every((w) => c.label.toLowerCase().includes(w)))
    if (date) items.unshift({ label: `Move to ${short(date)}`, run: () => moveTo(date) })
    active = Math.min(active, Math.max(items.length - 1, 0))
    list.replaceChildren(...items.map((c, i) => {
      const li = document.createElement('li')
      li.id = `palette-option-${i}`
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', String(i === active))
      li.textContent = c.label
      if (c.hint) { const k = document.createElement('kbd'); k.textContent = c.hint; li.append(k) }
      li.addEventListener('pointermove', () => { if (active !== i) { active = i; render() } })
      li.addEventListener('click', () => run(i))
      return li
    }))
    if (!items.length) {
      const li = document.createElement('li')
      li.className = 'none'
      li.setAttribute('role', 'option')
      li.setAttribute('aria-disabled', 'true')
      li.textContent = 'Nothing matches. Cue stays small on purpose.'
      list.append(li)
    }
    if (items.length) input.setAttribute('aria-activedescendant', `palette-option-${active}`)
    else input.removeAttribute('aria-activedescendant')
  }
  function run(i) {
    const command = items[i]
    if (!command) return
    palette.close()
    command.run()
  }
  function open() {
    if (palette.open) return
    document.dispatchEvent(new CustomEvent('cue:palette-open'))
    input.value = ''
    active = 0
    render()
    palette.showModal()
    input.focus()
  }
  input.addEventListener('input', () => { active = 0; render() })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length) { active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; render() }
    } else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(active) }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette.close() }
  })
  palette.addEventListener('click', (e) => { if (e.target === palette) palette.close() })
  palette.addEventListener('close', () => document.dispatchEvent(new CustomEvent('cue:palette-close')))

  document.addEventListener('keydown', (e) => {
    if (palette.open || e.target.closest('input, textarea, select, [contenteditable]')) return
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      open()
    }
  })

  // The nav gets a button, because ⌘K is no help on a phone.
  const links = $('nav .links')
  if (links) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'palette-trigger'
    button.ariaLabel = 'Open the command palette'
    // The keycap where there's room for it; the mark where there isn't, and no keyboard either.
    button.innerHTML = `<kbd>${MOD}K</kbd>
      <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.75" y="4.75" width="18.5" height="14.5" rx="3.75" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <rect x="7" y="13" width="6" height="2" rx="1" fill="currentColor"/>
        <rect x="15" y="9" width="2" height="6" rx="1" fill="currentColor"/>
      </svg>`
    button.addEventListener('click', open)
    links.append(button)
  }

  return {
    add: (...commands) => { extras.push(...commands.flat()) },
    toast,
    toggleTheme,
    open,
    get paletteOpen() { return palette.open },
    dates: { fmt, short, long, today, addDays, parseDay },
    reduceMotion,
    GITHUB,
    MOD
  }
})()
