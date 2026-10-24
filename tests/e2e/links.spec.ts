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
