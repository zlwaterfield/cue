import { expect, test } from '@playwright/test'
import { addDays, caret, focusedId, focusedText, launch, lines, outline, paste, today, typeLines, type Cue } from './app'

let cue: Cue
test.beforeEach(async () => {
  cue = await launch()
})
test.afterEach(async () => {
  await cue.app.close()
})

test('north star: capture, convert, nest, complete, and move to Friday without the mouse', async () => {
  const { page } = cue
  await typeLines(page, 'Book flights', 'Email Dana the deck', 'Draft the proposal', 'Pick up dry cleaning')
  // Turn two into tasks.
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Meta+Shift+T')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Meta+Shift+T')
  // Nest one beneath another, then complete it.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Meta+Enter')
  expect(await outline(page)).toBe(lines('Book flights', '[ ] Email Dana the deck', '  [x] Draft the proposal', 'Pick up dry cleaning'))

  // Move another to Friday.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Meta+Shift+D')
  await page.keyboard.type('fri')
  await page.keyboard.press('Enter')
  await expect(page.locator('.toast')).toContainText('Moved to')
  expect(await outline(page)).toBe(lines('Book flights', '[ ] Email Dana the deck', '  [x] Draft the proposal'))

  await page.keyboard.press('Meta+J')
  await page.keyboard.type('friday')
  await page.keyboard.press('Enter')
  await expect(page.locator('.day-title')).toHaveText('Friday')
  expect(await outline(page)).toBe('Pick up dry cleaning')
})

test('Enter splits and continues the type; Backspace unwinds formatting, nesting, then merges', async () => {
  const { page } = cue
  await page.keyboard.type('[] Buy milk and eggs')
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Enter')
  expect(await outline(page)).toBe(lines('[ ] Buy milk ', '[ ] and eggs'))
  expect(await caret(page)).toBe(0)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Backspace') // to-do → text
  expect(await outline(page)).toBe(lines('[ ] Buy milk ', '  and eggs'))
  await page.keyboard.press('Backspace') // outdent
  expect(await outline(page)).toBe(lines('[ ] Buy milk ', 'and eggs'))
  await page.keyboard.press('Backspace') // merge
  expect(await outline(page)).toBe('[ ] Buy milk and eggs')
  expect(await caret(page)).toBe(9)
})

test('Enter on an empty list item exits the list', async () => {
  const { page } = cue
  await page.keyboard.type('- first')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('nested')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter') // outdent
  await page.keyboard.press('Enter') // drop bullet
  await page.keyboard.type('plain again')
  expect(await outline(page)).toBe(lines('- first', '  - nested', 'plain again'))
})

test('arrow keys move between lines and across days, keeping the column', async () => {
  const { page } = cue
  await typeLines(page, 'alpha line', 'b', 'gamma line')
  // Up from the end of "gamma line" goes to "b" (clamped), then "alpha line" near the same column.
  await page.keyboard.press('ArrowUp')
  expect(await focusedText(page)).toBe('b')
  await page.keyboard.press('ArrowUp')
  expect(await focusedText(page)).toBe('alpha line')
  expect(await caret(page)).toBeGreaterThanOrEqual(8)
  // Left at the start goes to the end of the previous line; Right at the end to the next.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Meta+ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  expect(await focusedText(page)).toBe('alpha line')
  expect(await caret(page)).toBe(10)
  // Down past the last row reaches tomorrow.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  const tomorrow = addDays(await today(page), 1)
  expect(await focusedId(page)).toBe(`ghost:${tomorrow}`)
  await page.keyboard.type('Planned for tomorrow')
  expect(await outline(page, tomorrow)).toBe('Planned for tomorrow')
})

test('reorder and indent with only the keyboard, including block selections', async () => {
  const { page } = cue
  await typeLines(page, 'one', 'two', 'three', 'four')
  await page.keyboard.press('Alt+ArrowUp')
  await page.keyboard.press('Alt+ArrowUp')
  expect(await outline(page)).toBe(lines('one', 'four', 'two', 'three'))
  // Select "two" and "three" as blocks and indent them together.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(page.locator('.row.is-selected')).toHaveCount(2)
  await page.keyboard.press('Tab')
  expect(await outline(page)).toBe(lines('one', 'four', '  two', '  three'))
  // Moving the parent takes its children.
  await page.keyboard.press('Escape') // back to editing
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  expect(await focusedText(page)).toBe('four')
  await page.keyboard.press('Alt+ArrowUp')
  expect(await outline(page)).toBe(lines('four', '  two', '  three', 'one'))
  // Delete a block selection with its children.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Backspace')
  expect(await outline(page)).toBe('one')
})

test('undo and redo cover completion, moves, reorders, conversions, and deletions', async () => {
  const { page } = cue
  await typeLines(page, 'task', 'other')
  await page.keyboard.press('ArrowUp')
  const states: string[] = [await outline(page)]
  await page.keyboard.press('Meta+Shift+T') // convert
  states.push(await outline(page))
  await page.keyboard.press('Meta+Enter') // complete
  states.push(await outline(page))
  await page.keyboard.press('Alt+ArrowDown') // reorder
  states.push(await outline(page))
  await page.keyboard.press('Meta+D') // move to tomorrow
  states.push(await outline(page))
  await page.keyboard.press('Meta+Shift+Backspace') // delete "other"
  states.push(await outline(page))
  expect(states).toEqual(['task\nother', '[ ] task\nother', '[x] task\nother', 'other\n[x] task', 'other', ''])
  for (let i = states.length - 2; i >= 0; i--) {
    await page.keyboard.press('Meta+Z')
    expect(await outline(page)).toBe(states[i])
  }
  for (let i = 1; i < states.length; i++) {
    await page.keyboard.press('Meta+Shift+Z')
    expect(await outline(page)).toBe(states[i])
  }
})

test('typing undoes in natural chunks and restores the caret', async () => {
  const { page } = cue
  await page.keyboard.type('Hello')
  await page.waitForTimeout(1300)
  await page.keyboard.type(' world')
  await page.keyboard.press('Meta+Z')
  expect(await focusedText(page)).toBe('Hello')
  await page.keyboard.press('Meta+Z')
  expect(await outline(page)).toBe('')
  await page.keyboard.press('Meta+Shift+Z')
  await page.keyboard.press('Meta+Shift+Z')
  expect(await outline(page)).toBe('Hello world')
})

test('pasting multiple lines creates structured items', async () => {
  const { page } = cue
  await page.keyboard.type('Plan: ')
  await paste(page, '- [ ] Venue\n  - call two options\n- [x] Date\nNotes after')
  expect(await outline(page)).toBe(lines('Plan: - [ ] Venue', '  - call two options', '[x] Date', 'Notes after'))
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await paste(page, '[ ] alpha\n[ ] beta')
  expect(await outline(page)).toBe(lines('Plan: - [ ] Venue', '  - call two options', '[x] Date', 'Notes after', '', '[ ] alpha', '[ ] beta'))
})

test('markdown shortcuts format as you type, and undo reverts just the formatting', async () => {
  const { page } = cue
  await page.keyboard.type('- ')
  expect(await outline(page)).toBe('- ')
  await page.keyboard.press('Meta+Z')
  expect(await outline(page)).toBe('- ')
  expect(await page.locator('.row.is-text').count()).toBe(1)
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('[x] shipped it')
  expect(await outline(page)).toBe('[x] shipped it')
})

test('search finds text on any day and opens the item', async () => {
  const { page } = cue
  await typeLines(page, 'Quarterly review prep', 'something else')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Meta+Shift+D')
  await page.keyboard.type('in 10 days')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Meta+F')
  await page.keyboard.type('QUARTERLY')
  await expect(page.locator('.palette-item')).toHaveCount(1)
  await expect(page.locator('.palette-item mark')).toHaveText('Quarterly')
  await page.keyboard.press('Enter')
  await expect(page.locator('.day')).toHaveCount(1)
  expect(await focusedText(page)).toBe('Quarterly review prep')
  expect(await caret(page)).toBe(9)
})

test('command palette is fuzzy, shows shortcuts, and runs commands', async () => {
  const { page } = cue
  await page.keyboard.type('a thing')
  await page.keyboard.press('Meta+K')
  await expect(page.locator('.palette-group').first()).toBeVisible()
  await page.keyboard.type('cnvtodo')
  await expect(page.locator('.palette-item').first()).toContainText('Convert to to-do')
  await page.keyboard.press('Enter')
  expect(await outline(page)).toBe('[ ] a thing')
  await page.keyboard.press('Meta+K')
  await page.keyboard.type('complete')
  await expect(page.locator('.palette-item').first().locator('kbd')).toHaveText(['⌘', '↩'])
  await page.keyboard.press('Escape')
  expect(await focusedText(page)).toBe('a thing')
})

test('drag and drop reorders and nests items with their children', async () => {
  const { page } = cue
  await typeLines(page, 'first', 'second', 'third')
  await page.keyboard.press('Tab')
  const handle = page.locator('.row', { hasText: 'second' }).locator('.handle')
  const target = page.locator('.row', { hasText: 'first' })
  await page.locator('.row', { hasText: 'second' }).hover()
  const from = (await handle.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + 5, from.y + 8)
  await page.mouse.down()
  await page.mouse.move(from.x + 5, to.y + 4, { steps: 6 })
  await expect(page.locator('.drop-indicator')).toBeVisible()
  await page.mouse.up()
  expect(await outline(page)).toBe(lines('second', '  third', 'first'))
})

test('Cmd-A twice selects the whole day; copy-free paste after a selection', async () => {
  const { page } = cue
  await typeLines(page, 'a', 'b', 'c')
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Meta+A')
  await expect(page.locator('.row.is-selected')).toHaveCount(3)
  await page.keyboard.press('Meta+Enter')
  expect(await outline(page)).toBe(lines('[ ] a', '[ ] b', '[ ] c'))
  await page.keyboard.press('Meta+Enter')
  expect(await outline(page)).toBe(lines('[x] a', '[x] b', '[x] c'))
})

test('sheets take focus, and Escape returns to writing where you were', async () => {
  const { page } = cue
  await page.keyboard.type('a note')
  await page.keyboard.press('Meta+/')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.row.is-selected')).toHaveCount(0)
  expect(await focusedText(page)).toBe('a note')
  await page.keyboard.press('Meta+,')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.keyboard.type('xyz')
  await page.keyboard.press('Escape')
  expect(await outline(page)).toBe('a note')
  expect(await focusedText(page)).toBe('a note')
})

test('moving a parent puts the caret on the next line that stays, not on its child', async () => {
  const { page } = cue
  await typeLines(page, 'parent', 'child', 'stays')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Tab')
  await page.keyboard.press('ArrowUp')
  expect(await focusedText(page)).toBe('parent')
  await page.keyboard.press('Meta+D')
  expect(await outline(page)).toBe('stays')
  expect(await focusedText(page)).toBe('stays')
})

test('the toast’s Undo only undoes the move it announced', async () => {
  const { page } = cue
  await typeLines(page, 'move me', 'keep')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Meta+D')
  await expect(page.locator('.toast')).toBeVisible()
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type(' edited')
  // Editing afterwards retires the toast, so its Undo can't hit the wrong action.
  await expect(page.locator('.toast')).toHaveCount(0)
  expect(await outline(page)).toBe('keep edited')
})
