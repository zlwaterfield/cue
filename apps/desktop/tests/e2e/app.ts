import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Cue {
  app: ElectronApplication
  page: Page
  dataDir: string
}

export function freshDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cue-e2e-'))
}

export async function launch(dataDir = freshDataDir(), env: Record<string, string> = {}): Promise<Cue> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, CUE_USER_DATA: dataDir, CUE_E2E: '1', ...env }
  })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => {
    throw error
  })
  await page.waitForSelector('.day')
  await expect.poll(() => focusedId(page)).toMatch(/^ghost:/)
  return { app, page, dataDir }
}

/** ⌘, opens Settings on General; every other category is a click down the rail. */
export async function openSettings(page: Page, category = 'General'): Promise<void> {
  await page.keyboard.press('Meta+,')
  await expect(page.getByRole('tab', { name: 'General' })).toBeVisible()
  if (category !== 'General') await page.getByRole('tab', { name: category }).click()
}

export function focusedId(page: Page): Promise<string | null> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.editableId ?? null)
}

export function focusedText(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.textContent ?? '')
}

export function caret(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sel = getSelection()!
    const el = document.activeElement as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(el)
    range.setEnd(sel.focusNode!, sel.focusOffset)
    return range.toString().length
  })
}

/** Render a day as an indented outline: "[ ] ", "[x] ", "- " markers, two spaces per level. */
export function outline(page: Page, date?: string): Promise<string> {
  return page.evaluate((date) => {
    const day = (date ? document.querySelector(`.day[data-day="${date}"]`) : document.querySelector('.day')) as HTMLElement | null
    if (!day) return '<missing>'
    return [...day.querySelectorAll('.row:not(.is-ghost)')]
      .map((row) => {
        const r = row as HTMLElement
        const depth = Number(getComputedStyle(r).getPropertyValue('--depth'))
        const marker = r.classList.contains('is-todo') ? (r.classList.contains('is-done') ? '[x] ' : '[ ] ') : r.classList.contains('is-bullet') ? '- ' : ''
        return '  '.repeat(depth) + marker + (r.querySelector('.text')?.textContent ?? '')
      })
      .join('\n')
  }, date)
}

export function lines(...rows: string[]): string {
  return rows.join('\n')
}

export async function typeLines(page: Page, ...rows: string[]): Promise<void> {
  for (let i = 0; i < rows.length; i++) {
    await page.keyboard.type(rows[i])
    if (i < rows.length - 1) await page.keyboard.press('Enter')
  }
}

export async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate((text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)
}

export async function today(page: Page): Promise<string> {
  return page.evaluate(() => (document.querySelector('.day.is-today') as HTMLElement).dataset.day!)
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
