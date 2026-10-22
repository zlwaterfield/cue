import { expect, test, type Page } from '@playwright/test'
import { addDays, launch, outline, today, type Cue } from './app'

/** Today's "open from earlier days" line and the to-dos it unfolds into. */

let cue: Cue
test.beforeEach(async () => {
  cue = await launch()
})
test.afterEach(async () => {
  await cue.app.close()
})

interface Seed {
  ago: number
  text: string
  type?: 'todo' | 'bullet'
  done?: boolean
}

/** Write lines on earlier days straight to storage, then reopen the window on them. */
async function seed(page: Page, rows: Seed[], batch = 'a'): Promise<string> {
  const now = await today(page)
  const items = rows.map((r, i) => ({
    id: `seed-${batch}-${i}`,
    date: addDays(now, -r.ago),
    parentId: null,
    position: `a${i}`,
    type: r.type ?? 'todo',
    text: r.text,
    done: r.done ?? false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
    version: ''
  }))
  await page.evaluate((items) => window.cue!.saveItems(items), items)
  await page.reload()
  await page.waitForSelector('.day.is-today')
  return now
}

const toggle = (page: Page) => page.locator('.loose-toggle')
const listed = (page: Page) => page.locator('.loose-row .loose-text').allTextContents()
const row = (page: Page, text: string) => page.locator('.loose-row', { has: page.locator('.loose-text', { hasText: text }) })

test('folds earlier open to-dos into one line, oldest first, and acts on them in place', async () => {
  const { page } = cue
  const now = await seed(page, [
    { ago: 1, text: 'Send the plan' },
    { ago: 10, text: 'Renew passport' },
    { ago: 3, text: 'Return the jacket' },
    { ago: 3, text: 'Book the dentist', done: true },
    { ago: 2, text: 'A note', type: 'bullet' },
    { ago: 45, text: 'Too long ago' }
  ])

  await expect(toggle(page)).toHaveText('3 open from earlier days')
  await expect(page.locator('.loose-list')).toHaveCount(0)

  await toggle(page).click()
  expect(await listed(page)).toEqual(['Renew passport', 'Return the jacket', 'Send the plan'])
  // The caret stays in the page.
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).isContentEditable)).toBe(true)

  // Checking one off saves it on its own day, and it stays put, crossed out.
  await row(page, 'Renew passport').locator('.loose-marker').click()
  await expect(row(page, 'Renew passport')).toHaveClass(/is-done/)
  await expect(toggle(page)).toHaveText('2 open from earlier days')
  await expect
    .poll(() => page.evaluate((date) => window.cue!.loadDates([date]).then((items) => items[0]?.done), addDays(now, -10)))
    .toBe(true)

  // Moving one brings it to the end of today and out of the list.
  await row(page, 'Return the jacket').hover()
  await row(page, 'Return the jacket').locator('.loose-move').click()
  await expect(page.locator('.toast')).toContainText('Moved to today')
  expect(await outline(page, now)).toContain('[ ] Return the jacket')
  expect(await listed(page)).toEqual(['Renew passport', 'Send the plan'])
  await expect(toggle(page)).toHaveText('1 open from earlier day')
})

test('moves everything at once, and Settings can hide it', async () => {
  const { page } = cue
  const now = await seed(page, [
    { ago: 2, text: 'First' },
    { ago: 1, text: 'Second' }
  ])

  await toggle(page).click()
  await page.locator('.loose-all').click()
  await expect(page.locator('.toast')).toContainText('Moved 2 to-dos to today')
  expect(await outline(page, now)).toBe('[ ] First\n[ ] Second')
  await expect(page.locator('.loose-ends')).toHaveCount(0)

  // Something new left over, then hidden and shown again from Settings.
  await seed(page, [{ ago: 1, text: 'Third' }], 'b')
  await expect(toggle(page)).toHaveText('1 open from earlier day')
  await page.keyboard.press('Meta+,')
  await page.getByRole('radio', { name: 'Hide' }).click()
  await expect(page.locator('.loose-ends')).toHaveCount(0)
  await page.getByRole('radio', { name: 'Show' }).click()
  await expect(toggle(page)).toHaveText('1 open from earlier day')
})
