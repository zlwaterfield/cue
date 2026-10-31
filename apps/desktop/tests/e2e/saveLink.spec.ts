import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { focusedText, launch, lines, outline, today, typeLines, type Cue } from './app'

/** Lines sent from outside Cue: `cue://add?text=…` links and the save-tab shortcut's setting. */

let cue: Cue
test.beforeEach(async () => {
  cue = await launch()
})
test.afterEach(async () => {
  await cue.app.close()
})

/** What macOS does when a browser opens a cue:// link. */
function openUrl(app: ElectronApplication, url: string): Promise<void> {
  return app.evaluate(({ app }, url) => {
    app.emit('open-url', { preventDefault() {} }, url)
  }, url)
}

function stored(page: Page, date: string): Promise<string[]> {
  return page.evaluate((date) => window.cue!.loadDates([date]).then((items) => items.map((i) => i.text).sort()), date)
}

test('a cue://add link adds a line at the end of today, leaving the caret and undo alone', async () => {
  const { app, page } = cue
  const now = await today(page)
  await typeLines(page, 'Plan the week')
  await expect.poll(() => stored(page, now)).toEqual(['Plan the week'])

  await openUrl(app, `cue://add?text=${encodeURIComponent('Read later:\nthe essay ')}`)
  await openUrl(app, `cue://add?url=${encodeURIComponent('Second, via url=')}`)
  // Nothing to add, or not an action Cue knows: nothing happens.
  await openUrl(app, 'cue://add?text=%20')
  await openUrl(app, 'cue://delete?text=Plan')

  await expect.poll(() => outline(page, now)).toBe(lines('Plan the week', 'Read later: the essay', 'Second, via url='))
  expect(await focusedText(page)).toBe('Plan the week')
  await expect.poll(() => stored(page, now)).toEqual(['Plan the week', 'Read later: the essay', 'Second, via url='])

  // ⌘Z undoes your typing, not what arrived from the browser.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => outline(page, now)).not.toContain('Plan the week')
  expect(await outline(page, now)).toContain(lines('Read later: the essay', 'Second, via url='))
})

test('a link goes under today’s Links bullet, as a share from the iPhone does', async () => {
  const { app, page } = cue
  const now = await today(page)
  await typeLines(page, 'Plan the week')
  await openUrl(app, `cue://add?text=${encodeURIComponent('https://example.com/a')}`)
  await openUrl(app, `cue://add?text=${encodeURIComponent('https://example.com/b')}`)
  await expect.poll(() => outline(page, now)).toBe(lines('Plan the week', '- Links', '  https://example.com/a', '  https://example.com/b'))
})

test('a link arriving just after the Links bullet is renamed goes under a new one', async () => {
  const { app, page } = cue
  const now = await today(page)
  await typeLines(page, '- Links')
  await expect.poll(() => stored(page, now)).toEqual(['Links'])
  // Renamed, and the link sent while the rename is still being typed: the editor stores
  // what it has before Cue reads the day, so the link never joins the old heading.
  await Promise.all([
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      el.textContent = 'Reading'
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    }),
    openUrl(app, `cue://add?text=${encodeURIComponent('https://example.com/a')}`)
  ])
  await expect.poll(() => outline(page, now)).toBe(lines('- Reading', '- Links', '  https://example.com/a'))
})

test('two links arriving together share one new Links bullet', async () => {
  const { app, page } = cue
  const now = await today(page)
  await Promise.all([
    openUrl(app, `cue://add?text=${encodeURIComponent('https://example.com/a')}`),
    openUrl(app, `cue://add?text=${encodeURIComponent('https://example.com/b')}`)
  ])
  await expect.poll(() => outline(page, now)).toBe(lines('- Links', '  https://example.com/a', '  https://example.com/b'))
})

test('says so in the toast while Cue is the window you’re in', async () => {
  const { app, page } = cue
  const focused = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.focus()
    return win.isFocused()
  })
  test.skip(!focused, 'This display server can’t focus the window')
  await openUrl(app, 'cue://add?text=From%20the%20browser')
  await expect(page.locator('.toast')).toContainText('Added to today')
  expect(await outline(page, await today(page))).toBe('From the browser')
})

test('the save-tab shortcut can be turned off and on in Settings', async () => {
  const { page } = cue
  await page.keyboard.press('ControlOrMeta+,')
  const row = page.locator('.setting', { has: page.locator('.setting-label', { hasText: 'Save browser tab' }) })
  const press = 'Press ⌃⌥⌘L in Safari, Chrome or another browser to add the tab you’re on to today.'
  const taken = 'Another app already uses ⌃⌥⌘L.'
  await expect(row.getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true')

  await row.getByRole('radio', { name: 'Off' }).click()
  await expect(row).toContainText(press)
  expect(await page.evaluate(() => window.cue!.getSettings().then((s) => s.saveTabShortcut))).toBe(false)
  expect(await page.evaluate(() => window.cue!.shortcutStatus())).toBe('off')

  await row.getByRole('radio', { name: 'On' }).click()
  await expect.poll(() => page.evaluate(() => window.cue!.getSettings().then((s) => s.saveTabShortcut))).toBe(true)
  // Taken when another Cue already holds the keys: the other tests running alongside, or
  // the real one on a developer's Mac. The help text says which.
  const status = await page.evaluate(() => window.cue!.shortcutStatus())
  expect(['on', 'taken']).toContain(status)
  await expect(row).toContainText(status === 'taken' ? taken : press)
})
