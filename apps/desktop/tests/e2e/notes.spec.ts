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

test('⇧⌘N starts a note, named by its first line', async () => {
  const { page } = cue
  await page.keyboard.press('Meta+Shift+n')
  await expect(page.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
  // Not a note until something is written on it, but it has its place in the row.
  await expect(open(page)).toHaveText('New note')
  expect(await tabs(page)).toEqual(['Scratch', 'New note', '+'])
  await expect(page.locator('.day .row.is-ghost .text')).toHaveAttribute('data-placeholder', 'Name this note')

  await page.keyboard.type('Books to read')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[] Middlemarch')
  await expect(open(page)).toHaveText('Books to read')
  expect(await tabs(page)).toEqual(['Scratch', 'Books to read', '+'])
  expect(await lines(page)).toEqual(['Books to read', 'Middlemarch'])

  // The name follows its line.
  await page.locator('.day .row .text').first().click()
  await page.keyboard.press('End')
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

test('a new note left blank makes nothing', async () => {
  const { page } = cue
  await page.keyboard.type('on today')
  await page.keyboard.press('Meta+Shift+n')
  await expect(open(page)).toHaveText('New note')
  await page.keyboard.press('Meta+3')
  await page.keyboard.press('Meta+4')
  // ⌘4 has no last note to reopen, so it's scratch.
  await expect(open(page)).toHaveText('Scratch')
  expect(await tabs(page)).toEqual(['Scratch', '+'])

  // The plus at the end of the row is the same command.
  await page.locator('.note-strip .note-new').click()
  await expect(open(page)).toHaveText('New note')
  await page.keyboard.type('Gift ideas')
  expect(await tabs(page)).toEqual(['Scratch', 'Gift ideas', '+'])
})

test('deleting a note and clearing scratch both undo', async () => {
  const { page } = cue
  await page.keyboard.press('Meta+Shift+n')
  await page.keyboard.type('Gift ideas')
  await expect(open(page)).toHaveText('Gift ideas')

  await page.keyboard.press('Meta+Alt+Backspace')
  await expect(open(page)).toHaveText('Scratch')
  expect(await tabs(page)).toEqual(['Scratch', '+'])
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
  await page.keyboard.press('Meta+Shift+n')
  await page.keyboard.type('1:1 with Priya')
  await page.keyboard.press('Meta+e')
  await page.keyboard.type('still scratch')
  await cue.app.close()

  cue = await launch(dataDir)
  await expect(cue.page.locator('.day .row:not(.is-ghost)')).toHaveCount(0)
  await cue.page.keyboard.press('Meta+4')
  expect(await tabs(cue.page)).toEqual(['Scratch', '1:1 with Priya', '+'])
  expect(await lines(cue.page)).toEqual(['still scratch'])
})

/** Start a note with a name and lines, leaving it open with the caret after the last line. */
async function newNote(page: Page, name: string, ...rest: string[]): Promise<void> {
  await page.keyboard.press('Meta+Shift+n')
  await expect(open(page)).toHaveText('New note')
  await page.keyboard.type(name)
  for (const line of rest) {
    await page.keyboard.press('Enter')
    await page.keyboard.type(line)
  }
  await expect(open(page)).toHaveText(name)
}

test('the title bar says where you are, and ⌘[ ⌘] stop at the first and last note', async () => {
  const { page } = cue
  await newNote(page, 'Older')
  await newNote(page, 'Newer')
  // Scratch first, then the newest note.
  expect(await tabs(page)).toEqual(['Scratch', 'Newer', 'Older', '+'])
  await expect(page.locator('.view-title')).toHaveText('Notes')
  await expect(page.getByRole('button', { name: 'Previous note' })).toBeVisible()

  await page.keyboard.press('Meta+]')
  await expect(open(page)).toHaveText('Older')
  await page.keyboard.press('Meta+]')
  await expect(open(page)).toHaveText('Older')
  await page.keyboard.press('Meta+[')
  await page.keyboard.press('Meta+[')
  await page.keyboard.press('Meta+[')
  await expect(open(page)).toHaveText('Scratch')

  // A click on a name opens that note, ready for a new line.
  await page.locator('.note-strip button', { hasText: 'Older' }).click()
  await page.keyboard.type('added')
  expect(await lines(page)).toEqual(['Older', 'added'])

  await page.keyboard.press('Meta+1')
  await expect(page.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.note-strip')).toHaveCount(0)
})

test('⇧⌘C copies the whole page, a note or a day', async () => {
  const { page, app } = cue
  await page.keyboard.type('[] Call the dentist')
  await page.keyboard.press('Meta+Shift+c')
  await expect(page.locator('.toast')).toContainText('Copied Today')
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('- [ ] Call the dentist')

  await newNote(page, 'Books to read', '[] Middlemarch', 'Seeing Like a State')
  await page.keyboard.press('Meta+Shift+c')
  await expect(page.locator('.toast')).toContainText('Copied Books to read')
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Books to read\n- [ ] Middlemarch\n- [ ] Seeing Like a State')
})

test('search finds a line in a note and opens it; ⌘D sends a line from a note to tomorrow', async () => {
  const { page } = cue
  // Return on a bullet continues the list.
  await newNote(page, 'Gift ideas', '- Priya: that candle', 'Sam: record needle')
  await page.keyboard.press('Meta+3')

  await page.keyboard.press('Meta+f')
  await page.keyboard.type('candle')
  const result = page.locator('.palette-item').first()
  await expect(result).toContainText('Priya: that candle')
  // A line in a note says which note, where a day's line says its date.
  await expect(result).toContainText('Gift ideas')
  await page.keyboard.press('Enter')
  await expect(open(page)).toHaveText('Gift ideas')
  expect(await focusedText(page)).toBe('Priya: that candle')

  await page.keyboard.press('Meta+d')
  await expect(page.locator('.toast')).toContainText('Moved to tomorrow')
  expect(await lines(page)).toEqual(['Gift ideas', 'Sam: record needle'])
  await page.keyboard.press('Meta+2')
  expect(await lines(page)).toEqual(['Priya: that candle'])
})

test('the heading buttons act on their own note', async () => {
  const { page } = cue
  await newNote(page, 'Reading list')
  await page.locator('.note-actions button', { hasText: 'Delete' }).click()
  await expect(open(page)).toHaveText('Scratch')
  await expect(page.locator('.toast')).toContainText('Deleted “Reading list”')
  await page.locator('.toast-action').click()
  expect(await tabs(page)).toEqual(['Scratch', 'Reading list', '+'])

  await page.keyboard.press('Meta+e')
  await page.keyboard.type('junk')
  // Scratch is only ever cleared: there's nothing on it to keep.
  await expect(page.locator('.note-actions button')).toHaveText(['Copy', 'Clear'])
  await page.locator('.note-actions button', { hasText: 'Clear' }).click()
  expect(await lines(page)).toEqual([])
})
