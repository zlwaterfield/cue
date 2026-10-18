import { expect, test, type Page } from '@playwright/test'
import { createServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { signInCode, syncServer, testEmail } from '../syncServer'
import { caret, focusedText, launch, lines, outline, today } from './app'

test('sync is off until you turn it on, and Cue works the same', async () => {
  // A configured server that is never contacted: nothing happens until sign-in.
  const cue = await launch(undefined, { CUE_SUPABASE_URL: 'http://127.0.0.1:9', CUE_SUPABASE_KEY: 'unused' })
  await cue.page.keyboard.type('Just this Mac')
  await cue.page.keyboard.press('Meta+,')
  await expect(cue.page.getByRole('button', { name: 'Turn On Sync…' })).toBeVisible()
  await expect(cue.page.getByText('Off. Your notes are stored only on this Mac.', { exact: false })).toBeVisible()
  await cue.page.keyboard.press('Escape')
  await expect(cue.page.locator('.sync-status')).toHaveCount(0)
  expect(await outline(cue.page)).toBe('Just this Mac')
  await cue.app.close()
})

test('a network that resets every connection never freezes Cue', async () => {
  test.setTimeout(60_000)
  // Accepts each connection, then resets it, as some firewalls and proxies do. Before
  // src/main/guard.ts, the realtime socket's reset threw where nothing could catch it,
  // and Electron's blocking alert froze the app.
  const server = createServer((socket) => socket.resetAndDestroy())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const env = { CUE_SUPABASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, CUE_SUPABASE_KEY: 'unused' }
  let cue = await launch(undefined, env)
  await cue.app.close()
  signedIn(cue.dataDir, 'reset@example.com')

  cue = await launch(cue.dataDir, env)
  await cue.page.keyboard.type('Still typing')
  await cue.page.waitForTimeout(10_000)
  expect(await cue.page.evaluate(() => window.cue!.sync.getState())).toMatchObject({ email: 'reset@example.com', status: 'offline' })
  await expect(cue.page.locator('.sync-status')).toHaveText('Offline')
  expect(await outline(cue.page)).toBe('Still typing')
  await cue.app.close()
  server.close()
})

/** Leave this Mac signed in, as far as it knows, without a server to sign in with. */
function signedIn(dataDir: string, email: string): void {
  const base64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const user = { id: '00000000-0000-4000-8000-000000000001', email }
  const session = {
    access_token: `${base64({ alg: 'HS256', typ: 'JWT' })}.${base64({ sub: user.id, exp: expiresAt, role: 'authenticated' })}.signature`,
    refresh_token: 'refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: { ...user, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
  }
  const db = new DatabaseSync(join(dataDir, 'cue.sqlite'))
  const put = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
  put.run('sync_account', JSON.stringify(user))
  put.run('sync_user', user.id)
  put.run('sync_session:session', JSON.stringify(session))
  db.close()
}

test.describe('with a sync server', () => {
  test.skip(!syncServer, 'Set CUE_SUPABASE_URL and CUE_SUPABASE_KEY (docs/SYNC.md)')
  test.setTimeout(60_000)

  const env = () => ({ CUE_SUPABASE_URL: syncServer!.url, CUE_SUPABASE_KEY: syncServer!.key })

  async function turnOnSync(page: Page, email: string): Promise<void> {
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: 'Turn On Sync…' }).click()
    await page.getByLabel('Email').fill(email)
    await page.keyboard.press('Enter')
    await page.getByLabel('Sign-in code').fill(await signInCode(email))
    await page.keyboard.press('Enter')
    await expect(page.locator('.setting-help', { hasText: `On as ${email}` })).toBeVisible()
    await page.keyboard.press('Escape')
  }

  test('two Macs stay in sync, and typing is never disturbed', async () => {
    const email = testEmail('e2e')
    const [a, b] = await Promise.all([launch(undefined, env()), launch(undefined, env())])
    const day = await today(a.page)

    // Notes written before turning sync on are uploaded too.
    await a.page.keyboard.type('Groceries')
    await turnOnSync(a.page, email)
    await new Promise((resolve) => setTimeout(resolve, 1100)) // one code per address per second
    await turnOnSync(b.page, email)
    await expect.poll(() => outline(b.page, day)).toBe('Groceries')

    // B edits the first line while A is in the middle of typing the second.
    await a.page.keyboard.press('Meta+ArrowRight')
    await a.page.keyboard.press('Enter')
    const typing = a.page.keyboard.type('milk eggs bread', { delay: 60 })
    await b.page.locator(`.day[data-day="${day}"] .row .text`, { hasText: 'Groceries' }).click()
    await b.page.keyboard.press('Meta+ArrowRight')
    await b.page.keyboard.type(' for Sunday')
    await typing

    expect(await focusedText(a.page)).toBe('milk eggs bread')
    expect(await caret(a.page)).toBe('milk eggs bread'.length)
    const expected = lines('Groceries for Sunday', 'milk eggs bread')
    await expect.poll(() => outline(a.page, day)).toBe(expected)
    await expect.poll(() => outline(b.page, day)).toBe(expected)

    // Turning sync off on one Mac leaves its notes in place.
    await a.page.keyboard.press('Meta+,')
    await a.page.getByRole('button', { name: 'Turn Off Sync' }).click()
    await expect(a.page.getByRole('button', { name: 'Turn On Sync…' })).toBeVisible()
    await a.page.keyboard.press('Escape')
    expect(await outline(a.page, day)).toBe(expected)

    await Promise.all([a.app.close(), b.app.close()])
  })

  test('a quick quit still uploads, and the other Mac catches up when it opens', async () => {
    const email = testEmail('restart')
    let a = await launch(undefined, env())
    const b = await launch(undefined, env())
    const day = await today(a.page)
    await turnOnSync(a.page, email)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await turnOnSync(b.page, email)
    await a.app.close()

    // Saved on this Mac but quit before the usual pause-then-upload.
    await b.page.keyboard.type('Written just before quitting')
    await expect.poll(() => b.page.evaluate(() => window.cue!.sync.getState()).then((s) => s.pending)).toBeGreaterThan(0)
    await b.app.close()

    a = await launch(a.dataDir, env())
    await expect.poll(() => outline(a.page, day)).toBe('Written just before quitting')
    await a.app.close()
  })
})
