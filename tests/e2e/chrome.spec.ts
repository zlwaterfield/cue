import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { parseDateInput } from '../../src/shared/dateParse'
import { daySubtitle, longDate, MONTHS, parts, relativeLabel, shortDate } from '../../src/shared/dates'
import { focusedText, launch, outline, lines, today, typeLines, type Cue } from './app'

/** The window around the editor: title bar, sheets, palette, menus. */

let cue: Cue
test.beforeEach(async () => {
  cue = await launch()
})
test.afterEach(async () => {
  await cue.app.close()
})

/** Push a sync state from the main process, as the sync service does. No server needed. */
function pushSync(app: ElectronApplication, status: 'idle' | 'syncing' | 'offline'): Promise<void> {
  return app.evaluate(({ BrowserWindow }, status) => {
    BrowserWindow.getAllWindows()[0].webContents.send('sync:state', {
      available: true,
      email: 'e2e@example.com',
      status,
      lastSyncedAt: null,
      pending: 0,
      message: null
    })
  }, status)
}

async function setWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 700), width)
  await page.waitForFunction((width) => innerWidth === width, width)
}

const left = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().left)

test('a quick sync takes no room in the title bar; a long one fades in “Syncing…”', async () => {
  const { app, page } = cue
  const status = page.locator('.sync-status')
  await pushSync(app, 'idle')
  const at = await left(page, '.titlebar .segmented')

  await pushSync(app, 'syncing')
  await page.waitForTimeout(300)
  await expect(status).toHaveCount(0)
  expect(await left(page, '.titlebar .segmented')).toBe(at)

  await page.waitForTimeout(1200)
  await expect(status).toHaveText('Syncing…', { timeout: 1000 })
  await pushSync(app, 'idle')
  await expect(status).toHaveCount(0)
  expect(await left(page, '.titlebar .segmented')).toBe(at)

  // A new sync starts the wait over.
  await pushSync(app, 'syncing')
  await page.waitForTimeout(300)
  await expect(status).toHaveCount(0)
})

test('at the minimum width the title bar keeps one line and every control', async () => {
  const { app, page } = cue
  await setWidth(app, page, 480)
  await pushSync(app, 'offline')
  const status = page.getByRole('button', { name: 'Offline' })
  await expect(status).toBeVisible()
  // Only the dot shows; the label moves to the tooltip and the accessible name.
  expect(await status.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(24)

  for (const view of ['week', 'day'] as const) {
    if (view === 'day') await page.keyboard.press('Meta+1')
    const bar = await page.evaluate(() => ({
      right: document.querySelector('.titlebar-right')!.getBoundingClientRect().right,
      title: document.querySelector('.view-title')!.getBoundingClientRect().height
    }))
    expect(bar.right).toBeLessThanOrEqual(480)
    expect(bar.title).toBeLessThan(32) // one line
  }
})

test('in day view the title bar gives the month and the heading says the date once', async () => {
  const { page } = cue
  const date = await today(page)
  await page.keyboard.press('Meta+1')
  const { year, month } = parts(date)
  await expect(page.locator('.view-title')).toHaveText(`${MONTHS[month - 1]} ${year}`)
  await expect(page.locator('.day-title')).toHaveText('Today')
  await expect(page.locator('.day-sub')).toHaveText(daySubtitle(date, date))
  expect(daySubtitle(date, date)).not.toContain(String(year))
})

test('Settings segments: keyboard focus shows on the chosen option, and arrows choose', async () => {
  const { page } = cue
  await page.keyboard.press('Meta+,')
  const system = page.getByRole('radio', { name: 'System' })
  const light = page.getByRole('radio', { name: 'Light' })
  await expect(system).toBeVisible()
  await page.keyboard.press('Tab') // Close
  await page.keyboard.press('Tab') // the chosen appearance: one Tab stop per group
  await expect(system).toBeFocused()
  expect(await system.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')

  await page.keyboard.press('ArrowRight')
  await expect(light).toHaveAttribute('aria-checked', 'true')
  await expect(system).toHaveAttribute('aria-checked', 'false')
  await expect(light).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(system).toHaveAttribute('aria-checked', 'true')
  await expect(system).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(page.getByRole('radio', { name: 'Monday' })).toBeFocused()
})

test('the whole marker cell completes a to-do, and the caret stays put', async () => {
  const { page } = cue
  await typeLines(page, '[] water the plants', 'call the bank')
  const row = page.locator('.row', { hasText: 'water the plants' })
  const box = (await row.locator('.checkbox').boundingBox())!
  // Right of the box and above it, still inside its 24 × 30 cell.
  await page.mouse.click(box.x + box.width + 4, box.y + box.height / 2)
  await expect(row).toHaveClass(/is-done/)
  await page.mouse.click(box.x + box.width / 2, box.y - 5)
  await expect(row).not.toHaveClass(/is-done/)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  expect(await outline(page)).toBe(lines('[x] water the plants', '[ ] call the bank'))
  expect(await focusedText(page)).toBe('call the bank')
})

test('a block selection is one band, from the shallowest selected line', async () => {
  const { page } = cue
  for (const key of ['trip', 'Enter', 'Tab', 'flights', 'Enter', 'Tab', 'hotel', 'Enter', 'Shift+Tab', 'Shift+Tab', 'packing']) {
    if (/^[a-z]/.test(key)) await page.keyboard.type(key)
    else await page.keyboard.press(key)
  }
  expect(await outline(page)).toBe(lines('trip', '  flights', '    hotel', 'packing'))
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  const bands = () =>
    page.locator('.row.is-selected').evaluateAll((rows) =>
      rows.map((row) => Math.round(row.getBoundingClientRect().left + parseFloat(getComputedStyle(row, '::before').left)))
    )
  const rowLeft = (text: string) => page.locator('.row', { hasText: text }).evaluate((row) => Math.round(row.getBoundingClientRect().left))

  // "flights" and its child: the band starts at "flights".
  await page.keyboard.press('Escape')
  await expect(page.locator('.row.is-selected')).toHaveCount(2)
  const nested = await bands()
  expect(new Set(nested).size).toBe(1)
  expect(nested[0]).toBe((await rowLeft('flights')) + 24 - 4)

  // Reaching "packing" (top level) moves the whole band out to it.
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(page.locator('.row.is-selected')).toHaveCount(3)
  const wide = await bands()
  expect(new Set(wide).size).toBe(1)
  expect(wide[0]).toBe((await rowLeft('packing')) - 4)
})

test('Go to date says each date once', async () => {
  const { page } = cue
  const date = await today(page)
  await page.keyboard.press('Meta+J')
  const rows = page.locator('.palette-item')
  await expect(rows.first()).toHaveText(`Today · ${shortDate(date, date)}`)
  await expect(rows.first().locator('.palette-hint')).toHaveCount(0)
  const dates = await page.locator('.palette-item .muted').allTextContents()
  expect(dates.length).toBeGreaterThanOrEqual(3)
  expect(new Set(dates).size).toBe(dates.length)
  // Calendar days are read out as dates, today is ringed, and the pick is a circle.
  const day = page.getByRole('button', { name: longDate(date) })
  await expect(day).toHaveClass(/is-today/)
  await page.keyboard.press('ArrowDown')
  expect(await day.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('inset')
  expect(await page.locator('.calendar-day.is-selected').evaluate((el) => getComputedStyle(el).borderRadius)).toBe('50%')
})

test('Move to date never offers the day the line is already on', async () => {
  const { page } = cue
  await page.keyboard.type('renew passport')
  await page.keyboard.press('Meta+Shift+D')
  await expect(page.locator('.palette-item').first()).toBeVisible()
  const labels = await page.locator('.palette-item .palette-title').allTextContents()
  expect(labels.some((label) => label.startsWith('Today'))).toBe(false)
  expect(labels[0]).toMatch(/^Tomorrow · /)
})

test('a typed date reads short, as on the iPhone, with how far away it is', async () => {
  const { page } = cue
  const date = await today(page)
  await page.keyboard.type('renew passport')
  await page.keyboard.press('Meta+Shift+D')
  await page.keyboard.insertText('fri')
  const friday = parseDateInput('fri', date)!
  const match = page.locator('.palette-item').first()
  await expect(match.locator('.palette-title')).toHaveText(shortDate(friday, date))
  await expect(match.locator('.palette-hint')).toHaveText(relativeLabel(friday, date))
})

test('search keeps the screen steady while it looks, and draws the editor’s markers', async () => {
  const { page } = cue
  await typeLines(page, '[x] renew the passport', 'passport photos')
  await page.keyboard.press('Meta+F')
  // The iPhone's words, before and after typing.
  await expect(page.getByRole('textbox', { name: 'Search all notes', exact: true })).toHaveAttribute('placeholder', 'Search all notes')
  await expect(page.locator('.palette-empty')).toHaveText('Find anything you’ve written')
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { seen: string[] }).seen = seen
    new MutationObserver(() => {
      const text = document.querySelector('.palette-empty')?.textContent
      if (text) seen.push(text)
    }).observe(document.querySelector('.palette')!, { subtree: true, childList: true, characterData: true })
  })
  await page.keyboard.insertText('passport')
  await expect(page.locator('.palette-item')).toHaveCount(2)
  expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).not.toContain('No matches')

  const done = page.locator('.palette-item', { hasText: 'renew the passport' })
  await expect(done.locator('.glyph-todo.is-done svg')).toBeVisible()
  expect(await done.locator('mark').evaluate((el) => getComputedStyle(el).fontWeight)).toBe('600')
  await page.keyboard.insertText('zzz')
  await expect(page.locator('.palette-empty')).toHaveText('No matches')
})

test('the shortcuts sheet shows every row at the default size, in level columns', async () => {
  const { page } = cue
  await page.keyboard.press('Meta+/')
  await expect(page.locator('.shortcut-row').first()).toBeVisible()
  const sheet = await page.evaluate(() => {
    const body = document.querySelector('.sheet-body')!
    const bottom = body.getBoundingClientRect().bottom
    const heads = [...document.querySelectorAll('.shortcut-group h3')].map((h) => h.getBoundingClientRect())
    return {
      hidden: [...document.querySelectorAll('.shortcut-row')].filter((r) => r.getBoundingClientRect().bottom > bottom).length,
      tops: [...new Set(heads.filter((h, i) => i === 0 || h.left !== heads[i - 1].left).map((h) => Math.round(h.top)))]
    }
  })
  expect(sheet.hidden).toBe(0)
  expect(sheet.tops).toHaveLength(1)
})

test('menus use one name per action, in title case, and View can zoom', async () => {
  const { app, page } = cue
  const items = await app.evaluate(({ Menu }) => {
    const out: Array<{ label: string; role?: string; accelerator?: string; visible: boolean }> = []
    const walk = (menu: Electron.Menu): void =>
      menu.items.forEach((i) => {
        if (i.type !== 'separator') out.push({ label: i.label, role: i.role, accelerator: i.accelerator ?? undefined, visible: i.visible })
        if (i.submenu) walk(i.submenu)
      })
    walk(Menu.getApplicationMenu()!)
    return out
  })
  const labels = items.map((i) => i.label)
  for (const label of ['Export JSON Backup…', 'Import JSON Backup…', 'Show Data Folder in Finder', 'Complete or Reopen']) expect(labels).toContain(label)
  for (const role of ['resetzoom', 'zoomin', 'zoomout']) expect(items.some((i) => i.role === role && i.visible)).toBe(true)
  expect(items.some((i) => i.role === 'zoomin' && i.accelerator === 'CommandOrControl+=')).toBe(true)
  // Title case: no lowercase word longer than a short preposition after the first.
  const minor = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to'])
  const sentenceCase = labels.filter((label) => label.split(' ').slice(1).some((w) => /^[a-z]/.test(w) && !minor.has(w)))
  expect(sentenceCase).toEqual([])

  // The roles zoom the page (key equivalents need a focused window, which tests can't get).
  const zoom = (role: string) =>
    app.evaluate(({ BrowserWindow, Menu }, role) => {
      const win = BrowserWindow.getAllWindows()[0]
      const find = (menu: Electron.Menu): Electron.MenuItem | undefined => {
        for (const i of menu.items) {
          if (i.role === role && i.visible) return i
          const found = i.submenu && find(i.submenu)
          if (found) return found
        }
      }
      find(Menu.getApplicationMenu()!)!.click(undefined, win, win.webContents)
      return win.webContents.getZoomFactor()
    }, role)
  expect(await zoom('zoomin')).toBeGreaterThan(1)
  expect(await zoom('resetzoom')).toBe(1)
  await expect(page.locator('.day').first()).toBeVisible()
})
