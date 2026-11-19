const initSqlJs = require('sql.js/dist/sql-asm.js')
initSqlJs().then((SQL) => {
  globalThis.__SQL = SQL
  const { Appearance } = require('react-native')
  Appearance.setColorScheme ??= () => {}
  const { Keyboard } = require('react-native')
  Keyboard.metrics ??= () => undefined
  HTMLTextAreaElement.prototype.setSelection ??= function (start, end) { this.setSelectionRange(start, end ?? start) }
  const { repo } = require('../src/core/app')
  const { addDays, todayISO } = require('@shared/dates')
  const { uuidv7 } = require('@shared/ids')
  const { generateNKeysBetween } = require('fractional-indexing')
  const today = todayISO()
  const pages = {
    [-1]: ['[x] Send invoice to Harbor & Pine', '[x] Book dentist', '- Idea: weekly review on Fridays'],
    0: [
      'Planning day',
      '[ ] Review the iPhone Duo pull request and leave notes for the author',
      '  [x] Read the diff',
      '  [ ] Try it at both widths',
      '[ ] Reply to Sam about the launch date, and ask whether the press kit needs the new screenshots before Thursday',
      '- Groceries: oat milk, lemons, coffee',
      '[x] Morning run',
      '[ ] Renew passport'
    ],
    1: ['[ ] Dentist at 9:30', '[ ] Draft the release notes', '  - Two days side by side', '  - Safe areas on each edge', '- Call Mum', '[ ] Pick up the bike from the shop on Elm Street'],
    2: ['[ ] Team retro', '- Notes for the roadmap', '[ ] Flight check-in']
  }
  for (const [offset, lines] of Object.entries(pages)) {
    const keys = generateNKeysBetween(null, null, lines.length)
    let parent = null
    const items = lines.map((raw, i) => {
      const nested = raw.startsWith('  ')
      const line = raw.trim()
      const todo = /^\[( |x)\] /.exec(line)
      const item = {
        id: uuidv7(), date: addDays(today, Number(offset)), parentId: nested ? parent : null, position: keys[i],
        type: todo ? 'todo' : line.startsWith('- ') ? 'bullet' : 'text',
        text: todo ? line.slice(4) : line.startsWith('- ') ? line.slice(2) : line,
        done: todo?.[1] === 'x', createdAt: Date.now(), updatedAt: Date.now(), deleted: false, version: ''
      }
      if (!nested) parent = item.id
      return item
    })
    repo.saveItems(items)
  }
  require('expo-router/entry')
})

// A browser's <textarea> doesn't grow with its text as an iOS text view does: size each to its content.
const fit = () => {
  for (const t of document.querySelectorAll('textarea')) {
    t.rows = 1
    const was = t.style.height
    t.style.height = '0px'
    const h = t.scrollHeight + 'px'
    t.style.height = was
    if (was !== h) t.style.height = h
  }
}
setInterval(fit, 100)
