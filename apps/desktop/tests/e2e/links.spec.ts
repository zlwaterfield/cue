import { expect, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { focusedText, launch, outline, typeLines, type Cue } from './app'

// A 1×1 PNG, served as the page's icon.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

let server: Server
let site: string
let cue: Cue

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/icon.png') {
      res.writeHead(200, { 'content-type': 'image/png' }).end(PNG)
      return
    }
    if (req.url === '/notes') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(
        '<html><head><meta property="og:title" content="Release notes"><meta property="og:site_name" content="Example"></head>' +
          '<body><article><p>Every merge ships the same afternoon, with notes for whoever is reading along.</p></article></body></html>'
      )
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(
      '<html><head><title>Ignored</title><meta property="og:title" content="A calm page | Example">' +
        '<meta property="og:site_name" content="Example"><link rel="icon" type="image/png" href="/icon.png"></head></html>'
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => {
  server.close()
})
test.beforeEach(async () => {
  cue = await launch()
})
test.afterEach(async () => {
  await cue.app.close()
})

test('a line that is only a link shows its page once the caret leaves it, and opens it on click', async () => {
  const { app, page } = cue
  const url = `${site}/post`
  await typeLines(page, url)
  const row = page.locator('.row', { hasText: url })
  // While it's being edited it's the link itself.
  await expect(row.locator('.link-line')).toHaveCount(0)

  await page.keyboard.press('Enter')
  await typeLines(page, 'next')
  const link = page.locator(`.link-line[data-link="${url}"]`)
  await expect(link.locator('.link-title')).toHaveText('A calm page Example')
  await expect(link.locator('.link-icon img')).toHaveAttribute('src', /^data:image\/png;base64,/)
  // The notes keep the link as written.
  expect(await outline(page)).toBe(`${url}\nnext`)

  // Arriving with the arrow keys edits the link.
  await page.keyboard.press('ArrowUp')
  expect(await focusedText(page)).toBe(url)
  await expect(link).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  await expect(link).toHaveCount(1)

  // Clicking the page opens it; clicking beside it edits the link.
  await app.evaluate(({ shell }) => {
    ;(globalThis as { opened?: string[] }).opened = []
    shell.openExternal = async (target: string) => void (globalThis as unknown as { opened: string[] }).opened.push(target)
  })
  await link.locator('.link-title').click()
  expect(await app.evaluate(() => (globalThis as { opened?: string[] }).opened)).toEqual([url])
  expect(await focusedText(page)).toBe('next')

  const box = (await link.boundingBox())!
  await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2)
  expect(await focusedText(page)).toBe(url)
  await expect(link).toHaveCount(0)
})

test('a link the page has not answered for shows its address', async () => {
  const { page } = cue
  await typeLines(page, 'http://127.0.0.1:9/nothing/here', 'next')
  await expect(page.locator('.link-line .link-title.is-bare')).toHaveText('127.0.0.1/nothing/here')
})

test('⌘L lists every link, finds one by what its page says, opens it, and shows its line', async () => {
  const { app, page } = cue
  await typeLines(page, `${site}/post`, `read ${site}/notes before friday`, 'no link here')
  await page.keyboard.press('ControlOrMeta+l')
  const list = page.getByRole('dialog', { name: 'Links' })
  const items = list.locator('.links-item')
  // Newest day first, in page order: both links, under this week, with their pages.
  await expect(items).toHaveCount(2)
  await expect(list.locator('.palette-group')).toHaveText(['This week'])
  await expect(items.nth(0).locator('.links-title')).toHaveText('A calm page')
  await expect(items.nth(1).locator('.links-title')).toHaveText('Release notes')
  await expect(items.nth(1).locator('.links-sub')).toHaveText('Example · read before friday')
  await expect(items.nth(0).locator('.links-day')).toHaveText('Today')

  // Found by the page's text, by the note around it, and not by anything else.
  await page.keyboard.type('afternoon')
  await expect(items).toHaveCount(1)
  await expect(items.locator('.links-title')).toHaveText('Release notes')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('friday merge')
  await expect(items).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('nothing like it')
  await expect(list.locator('.palette-empty')).toHaveText('No matching links')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await expect(items).toHaveCount(2)

  // ↩ opens the page and keeps the list; ⌥↩ goes to the line.
  await app.evaluate(({ shell }) => {
    ;(globalThis as { opened?: string[] }).opened = []
    shell.openExternal = async (target: string) => void (globalThis as unknown as { opened: string[] }).opened.push(target)
  })
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  expect(await app.evaluate(() => (globalThis as { opened?: string[] }).opened)).toEqual([`${site}/notes`])
  await expect(list).toBeVisible()
  await page.keyboard.press('Alt+Enter')
  await expect(list).toHaveCount(0)
  expect(await focusedText(page)).toBe(`read ${site}/notes before friday`)

  // ⌘L again closes it.
  await page.keyboard.press('ControlOrMeta+l')
  await expect(list).toBeVisible()
  await page.keyboard.press('ControlOrMeta+l')
  await expect(list).toHaveCount(0)
})

