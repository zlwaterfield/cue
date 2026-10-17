/**
 * Regenerates the README screenshots in docs/images (run `pnpm build` first).
 *
 *   pnpm screenshots
 *
 * Launches the built app against a throwaway data folder, writes a realistic day
 * with the keyboard, captures light and dark views, and frames each capture as a
 * macOS window (scripts/frame.swift).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'

const OUT = 'docs/images'
const raw = mkdtempSync(join(tmpdir(), 'cue-shots-'))
mkdirSync(OUT, { recursive: true })

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, CUE_USER_DATA: mkdtempSync(join(tmpdir(), 'cue-shots-data-')), CUE_E2E: '1' }
})
const page = await app.firstWindow()
await page.waitForSelector('.day')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700))
await page.waitForTimeout(200)

const type = (text) => page.keyboard.type(text)
const press = async (...keys) => {
  for (const key of keys) await page.keyboard.press(key)
}

// Today
await type('Slow Saturday. Coffee, errands, then the long run.')
await press('Enter')
await type('[x] Pick up dry cleaning')
await press('Enter')
await type('Call Mom about Thanksgiving')
await press('Enter')
await type('Groceries')
await press('Enter', 'Tab', 'Meta+Shift+T')
await type('oat milk')
await press('Enter')
await type('eggs')
await press('Enter')
await type('lemons')
await press('Enter', 'Enter')
await type('Offsite ideas')
await press('Enter', 'Tab')
await type('Cabin near the lake? https://example.com/cabin')
await press('Enter')
await type('Cooking class instead of a dinner')
await press('Enter', 'Enter', 'Meta+Shift+T')
await type('Send the Q4 plan to Priya')
// Tomorrow
await press('ArrowDown')
await type('[] Long run, 14 km')
await press('Enter')
await type('Meal prep for the week')
await press('Enter', 'Enter')
await type('Reading: The Overstory, chapter 12')
// A few earlier days, so search has history to find.
const earlier = [
  ['1:1 with Priya: Q4 planning, hiring, the offsite', '[x] Book the dentist'],
  ['[x] Draft the Q4 plan for Priya', 'Ideas for the team offsite'],
  ["Priya's feedback: tighten the roadmap, cut the dashboard", '[x] Renew passport']
]
await press('Meta+1')
for (const [first, second] of earlier) {
  await press('Meta+[')
  await page.waitForTimeout(150)
  await type(first)
  await press('Enter')
  await type(second)
}
await press('Meta+3')
await page.waitForTimeout(200)
// Rest the caret at the end of today's last line.
await page.getByText('Send the Q4 plan to Priya').click()
await press('Meta+ArrowRight')
await page.mouse.move(980, 690)

const shoot = async (name, scheme) => {
  await page.emulateMedia({ colorScheme: scheme })
  await page.waitForTimeout(250)
  const file = join(raw, `${name}.png`)
  await page.screenshot({ path: file })
  execFileSync('swift', ['scripts/frame.swift', file, join(OUT, `${name}.png`), scheme])
  console.log(`wrote ${join(OUT, `${name}.png`)}`)
}

await shoot('week-light', 'light')
await shoot('week-dark', 'dark')

await press('Meta+Shift+D')
await type('fri')
await shoot('move-to-date', 'light')
await press('Escape')

await press('Meta+K')
await type('move to fri')
await shoot('command-palette', 'dark')
await press('Escape')

await press('Meta+F')
await type('priya')
await shoot('search', 'light')
await press('Escape')

// The shortcuts sheet scrolls below ~950 px; give it room to show everything.
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 960))
await press('Meta+/')
await shoot('shortcuts', 'dark')
await press('Escape')

await app.close()
