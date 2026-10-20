import { expect, test } from '@playwright/test'
import { addDays, focusedText, launch, lines, outline, today, typeLines, type Cue } from './app'

let cue: Cue
test.beforeEach(async () => {
  cue = await launch()
})
test.afterEach(async () => {
  await cue.app.close()
})

test('drag an item with its children onto another day', async () => {
  const { page } = cue
  await typeLines(page, 'Stay', 'Move me', 'child')
  await page.keyboard.press('Tab')
  const tomorrow = addDays(await today(page), 1)
  const row = page.locator('.row', { hasText: 'Move me' })
  await row.hover()
  const from = (await row.locator('.handle').boundingBox())!
  const target = (await page.locator(`.day[data-day="${tomorrow}"] .rows`).boundingBox())!
  await page.mouse.move(from.x + 5, from.y + 8)
  await page.mouse.down()
  await page.mouse.move(from.x + 5, target.y + 6, { steps: 8 })
  await page.mouse.up()
  expect(await outline(page)).toBe('Stay')
  expect(await outline(page, tomorrow)).toBe(lines('Move me', '  child'))
  await page.keyboard.press('Meta+Z')
  expect(await outline(page)).toBe(lines('Stay', 'Move me', '  child'))
})

test('dragging across lines selects them as blocks', async () => {
  const { page } = cue
  await typeLines(page, 'one', 'two', 'three')
  const a = (await page.locator('.row', { hasText: 'one' }).locator('.text').boundingBox())!
  const c = (await page.locator('.row', { hasText: 'three' }).locator('.text').boundingBox())!
  await page.mouse.move(a.x + 4, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(c.x + 10, c.y + c.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator('.row.is-selected')).toHaveCount(3)
  await page.keyboard.press('Meta+Shift+Enter')
  expect(await outline(page)).toBe(lines('[ ] one', '[ ] two', '[ ] three'))
})

test('shift-click selects a range; clicking a checkbox completes without moving the caret', async () => {
  const { page } = cue
  await typeLines(page, '[] first', 'second', 'third')
  await page.locator('.row', { hasText: 'first' }).locator('.checkbox').click()
  expect(await outline(page)).toBe(lines('[x] first', '[ ] second', '[ ] third'))
  expect(await focusedText(page)).toBe('third')
  await page.locator('.row', { hasText: 'second' }).locator('.text').click({ modifiers: ['Shift'] })
  await expect(page.locator('.row.is-selected')).toHaveCount(2)
  await page.keyboard.press('Backspace')
  expect(await outline(page)).toBe('[x] first')
})

test('clicking a day title opens that day, and the header switches back to the week', async () => {
  const { page } = cue
  const tomorrow = addDays(await today(page), 1)
  await page.locator(`.day[data-day="${tomorrow}"] .day-title`).click()
  await expect(page.locator('.day')).toHaveCount(1)
  await expect(page.locator('.day-title')).toHaveText('Tomorrow')
  await page.getByRole('tab', { name: 'Week' }).click()
  await expect(page.locator('.day').first().locator('.day-title')).toHaveText('Today')
})
