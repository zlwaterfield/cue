import { expect, test, type Page } from '@playwright/test'
import { focusedText, launch, type Cue } from './app'

/** Notes: scratch and the starred notes, one page at a time, beside Today and Week. */

let cue: Cue
test.beforeEach(async () => {
  cue = await launch()
})
test.afterEach(async () => {
  await cue.app.close()
})

const tabs = (page: Page) => page.locator('.note-strip button').allTextContents()
const open = (page: Page) => page.locator('.note-strip button.is-active')
const lines = (page: Page) => page.locator('.day .row:not(.is-ghost) .text').allTextContents()

test('⌘E opens scratch and goes back to the line it left', async () => {
  const { page } = cue
  await page.keyboard.type('Pick up the dry cleaning')
  await page.keyboard.press('Meta+e')
  await expect(page.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
  await expect(open(page)).toHaveText('Scratch')
  await page.keyboard.type('a draft')
  expect(await lines(page)).toEqual(['a draft'])

  await page.keyboard.press('Meta+e')
  await expect(page.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.type(' at 5')
  expect(await focusedText(page)).toBe('Pick up the dry cleaning at 5')
})

test('starring scratch keeps it as a note named by its first line', async () => {
  const { page } = cue
  await page.keyboard.press('Meta+e')
  await page.keyboard.type('Books to read')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[] Middlemarch')
  await page.keyboard.press('Meta+Shift+s')

  await expect(open(page)).toHaveText('Books to read')
  expect(await tabs(page)).toEqual(['Scratch', 'Books to read'])
  expect(await lines(page)).toEqual(['Books to read', 'Middlemarch'])
  await expect(page.locator('.toast')).toContainText('Starred “Books to read”')

  // The name follows its line, and scratch is empty again.
  await page.keyboard.type(', 2027')
  await expect(open(page)).toHaveText('Books to read, 2027')
  await page.keyboard.press('Meta+[')
  await expect(open(page)).toHaveText('Scratch')
  expect(await lines(page)).toEqual([])

  // ⌘4 reopens the note last open; ⌘K opens one by name.
  await page.keyboard.press('Meta+]')
  await page.keyboard.press('Meta+1')
  await page.keyboard.press('Meta+4')
  await expect(open(page)).toHaveText('Books to read, 2027')
  await page.keyboard.press('Meta+3')
  await page.keyboard.press('Meta+k')
  await page.keyboard.type('books')
  await expect(page.locator('.palette-item').first()).toContainText('Go to Books to read, 2027')
  await page.keyboard.press('Enter')
  await expect(open(page)).toHaveText('Books to read, 2027')
})

test('deleting a note and clearing scratch both undo', async () => {
  const { page } = cue
  await page.keyboard.press('Meta+e')
  await page.keyboard.type('Gift ideas')
  await page.keyboard.press('Meta+Shift+s')
  await expect(open(page)).toHaveText('Gift ideas')

  await page.keyboard.press('Meta+Alt+Backspace')
  await expect(open(page)).toHaveText('Scratch')
  expect(await tabs(page)).toEqual(['Scratch'])
  await page.keyboard.press('Meta+z')
  await expect(open(page)).toHaveText('Gift ideas')

  await page.keyboard.press('Meta+e')
  await page.keyboard.type('throwaway')
  await page.keyboard.press('Meta+Alt+Backspace')
  expect(await lines(page)).toEqual([])
  await page.keyboard.press('Meta+z')
  expect(await lines(page)).toEqual(['throwaway'])
})

test('notes are still there after a restart, and stay out of the days', async () => {
  const { page, dataDir } = cue
  await page.keyboard.press('Meta+e')
  await page.keyboard.type('1:1 with Priya')
  await page.keyboard.press('Meta+Shift+s')
  await page.keyboard.press('Meta+e')
  await page.keyboard.type('still scratch')
  await cue.app.close()

  cue = await launch(dataDir)
  await expect(cue.page.locator('.day .row:not(.is-ghost)')).toHaveCount(0)
  await cue.page.keyboard.press('Meta+4')
  expect(await tabs(cue.page)).toEqual(['Scratch', '1:1 with Priya'])
  expect(await lines(cue.page)).toEqual(['still scratch'])
})
