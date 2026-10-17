import { expect, test } from '@playwright/test'
import { addDays, freshDataDir, launch, lines, outline, today, typeLines } from './app'

test('everything survives quitting and reopening', async () => {
  const dataDir = freshDataDir()
  let cue = await launch(dataDir)
  await typeLines(cue.page, '[] Ship the release', 'Notes from standup')
  await cue.page.keyboard.press('Tab')
  await cue.page.keyboard.press('ArrowUp')
  await cue.page.keyboard.press('Meta+Enter')
  await cue.page.keyboard.press('ArrowDown')
  await cue.page.keyboard.press('Meta+ArrowRight')
  await cue.page.keyboard.press('Enter')
  await cue.page.keyboard.type('typed right before quitting')
  const expected = lines('[x] Ship the release', '  [ ] Notes from standup', '  [ ] typed right before quitting')
  expect(await outline(cue.page)).toBe(expected)
  const day = await today(cue.page)
  await cue.page.keyboard.press('Meta+2')
  await cue.page.keyboard.type('Tomorrow item')
  await cue.app.close()

  cue = await launch(dataDir)
  expect(await outline(cue.page)).toBe(expected)
  expect(await outline(cue.page, addDays(day, 1))).toBe('Tomorrow item')
  await cue.app.close()
})

test('the week view shows today, tomorrow, and the rest of the week', async () => {
  const cue = await launch()
  const day = await today(cue.page)
  const dates = await cue.page.evaluate(() => [...document.querySelectorAll('.day')].map((d) => (d as HTMLElement).dataset.day))
  expect(dates[0]).toBe(day)
  expect(dates[1]).toBe(addDays(day, 1))
  expect(dates.length).toBeGreaterThanOrEqual(2)
  expect(dates.length).toBeLessThanOrEqual(7)
  await expect(cue.page.locator('.day').first().locator('.day-title')).toHaveText('Today')
  await cue.app.close()
})

test('edits survive the app being killed outright', async () => {
  const dataDir = freshDataDir()
  let cue = await launch(dataDir)
  await typeLines(cue.page, 'Written before a crash', '[] and a task')
  await cue.page.keyboard.press('Tab')
  // Saves are written behind within a few dozen milliseconds of each change.
  await cue.page.waitForTimeout(250)
  cue.app.process().kill('SIGKILL')
  await new Promise((resolve) => cue.app.process().once('exit', resolve))

  cue = await launch(dataDir)
  expect(await outline(cue.page)).toBe(lines('Written before a crash', '  [ ] and a task'))
  await cue.app.close()
})
