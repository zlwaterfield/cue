import { expect, test } from '@playwright/test'
import { launch, type Cue } from './app'

let cue: Cue
test.beforeEach(async () => {
  cue = await launch()
})
test.afterEach(async () => {
  await cue.app.close()
})

const caretState = (cue: Cue) =>
  cue.page.evaluate(() => {
    const caret = document.querySelector('.cue-caret') as HTMLElement
    const box = caret.getBoundingClientRect()
    return { shown: document.body.classList.contains('has-cue-caret'), x: box.left, width: box.width, height: box.height }
  })

test('the brand caret is there at launch, follows typing, and steps aside for selections', async () => {
  const { page } = cue
  await expect.poll(async () => (await caretState(cue)).shown).toBe(true)
  const start = await caretState(cue)
  expect(start.width).toBe(2)
  expect(start.height).toBe(20) // line height 24 − 4
  await expect(page.locator('.row.is-ghost .text').first()).toHaveAttribute('data-placeholder-focus', 'Start typing…')

  await page.keyboard.type('Hello')
  await expect.poll(async () => (await caretState(cue)).x).toBeGreaterThan(start.x + 20)

  await page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => (await caretState(cue)).shown).toBe(false)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await caretState(cue)).shown).toBe(true)

  await page.keyboard.press('Escape') // block selection: no text caret
  await expect.poll(async () => (await caretState(cue)).shown).toBe(false)
})

test('About shows the wordmark and the alpha notice', async () => {
  const { page } = cue
  await page.keyboard.press('Meta+K')
  await page.keyboard.type('about')
  await page.keyboard.press('Enter')
  const about = page.getByRole('dialog', { name: 'About Cue' })
  await expect(about).toBeVisible()
  await expect(about.getByRole('img', { name: 'cue' })).toBeVisible()
  await expect(about).toContainText('alpha')
  await page.keyboard.press('Escape')
  await expect(about).toHaveCount(0)
})
