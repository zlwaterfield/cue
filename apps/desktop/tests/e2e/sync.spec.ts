import { expect, test, type Page } from '@playwright/test'
import { createServer as createHttpServer } from 'node:http'
import { createServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { signInCode, syncServer, testEmail } from '../syncServer'
import { caret, focusedText, launch, lines, openSettings, outline, today, typeLines } from './app'

test('sync is off until you turn it on, and Cue works the same', async () => {
  // A configured server that is never contacted: nothing happens until sign-in.
  const cue = await launch(undefined, { CUE_SUPABASE_URL: 'http://127.0.0.1:9', CUE_SUPABASE_KEY: 'unused' })
  await cue.page.keyboard.type('Just this Mac')
  await openSettings(cue.page, 'Sync')
  await expect(cue.page.getByRole('button', { name: 'Turn On Sync…' })).toBeVisible()
  await expect(cue.page.getByText('Your notes are stored only on this Mac.', { exact: false })).toBeVisible()
  await cue.page.keyboard.press('Escape')
  await expect(cue.page.locator('.sync-status')).toHaveCount(0)
  expect(await outline(cue.page)).toBe('Just this Mac')
  await cue.app.close()
})

test('Assistants gives the sync server’s MCP URL once sync is on, and points to Sync until then', async () => {
  const env = { CUE_SUPABASE_URL: 'http://127.0.0.1:9', CUE_SUPABASE_KEY: 'unused' }
  let cue = await launch(undefined, env)
  let page = cue.page
  const pane = () => page.getByRole('tabpanel', { name: 'Assistants' })
  await openSettings(page, 'Assistants')
  await expect(pane().getByText('Turn on sync first')).toBeVisible()
  // Not the hosted server, so the URL is this server's function (`assistantUrls`).
  await expect(pane().getByText('http://127.0.0.1:9/functions/v1/mcp')).toBeVisible()
  await expect(pane().getByRole('button', { name: 'Copy URL' })).toHaveCount(0)
  await pane().getByRole('button', { name: 'Go to Sync' }).click()
  await expect(page.getByRole('tab', { name: 'Sync' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Turn On Sync…' })).toBeVisible()
  await cue.app.close()

  signedIn(cue.dataDir, 'mcp@example.com')
  cue = await launch(cue.dataDir, env)
  page = cue.page
  await openSettings(page, 'Assistants')
  await expect(pane().getByText('sign in as mcp@example.com', { exact: false })).toBeVisible()
  await pane().getByRole('button', { name: 'Copy URL' }).click()
  await expect(pane().getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await cue.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('http://127.0.0.1:9/functions/v1/mcp')
  // Where this server's consent page lives isn't known, so there's nothing to manage here.
  await expect(pane().getByRole('button', { name: 'Manage…' })).toHaveCount(0)
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

test('a session the server ended asks to sign in again, quietly, until dismissed', async () => {
  const env = { CUE_SUPABASE_URL: 'http://127.0.0.1:9', CUE_SUPABASE_KEY: 'unused' }
  let cue = await launch(undefined, env)
  await cue.app.close()
  ended(cue.dataDir, 'me@example.com', 'expired')

  cue = await launch(cue.dataDir, env)
  const { page } = cue
  await page.locator('.sync-status', { hasText: 'Sign in to sync' }).click()
  // The indicator opens Settings on Sync, not General: that pane holds the reason and the way out.
  await expect(page.getByRole('tab', { name: 'Sync' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Your sync session ended. Sign in again to keep syncing.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign In Again…' })).toBeVisible()
  await page.getByRole('button', { name: 'Not Now' }).click()
  await expect(page.getByText('Your notes are stored only on this Mac.', { exact: false })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.sync-status')).toHaveCount(0)
  await cue.app.close()

  // A deleted account can't be signed back in to: sync starts afresh, with any email.
  ended(cue.dataDir, 'me@example.com', 'deleted')
  cue = await launch(cue.dataDir, env)
  await cue.page.locator('.sync-status', { hasText: 'Sign in to sync' }).click()
  await expect(cue.page.getByText('Your account was deleted on another device. Notes on this Mac stay here.')).toBeVisible()
  await expect(cue.page.getByRole('button', { name: 'Sign In Again…' })).toHaveCount(0)
  await cue.page.getByRole('button', { name: 'Turn On Sync…' }).click()
  await expect(cue.page.getByLabel('Email')).toHaveValue('')
  await cue.app.close()
})

test('the email step checks the address itself, in the iPhone’s words, and can be cancelled', async () => {
  // Nothing is listening at this address: a request would fail with "Can’t reach the sync server".
  const cue = await launch(undefined, { CUE_SUPABASE_URL: 'http://127.0.0.1:9', CUE_SUPABASE_KEY: 'unused' })
  const { page } = cue
  await openSettings(page, 'Sync')
  await page.getByRole('button', { name: 'Turn On Sync…' }).click()
  await expect(page.getByText('Enter your email and we’ll send a six-digit code.')).toBeVisible()
  await page.getByLabel('Email').fill('not-an-email')
  await page.keyboard.press('Enter')
  // The form submits (no native validation bubble), and the shared check answers.
  await expect(page.locator('.setting-error')).toHaveText('That doesn’t look like an email address.')
  await expect(page.locator('form[novalidate]')).toHaveCount(1)

  // Looking at another category and coming back doesn't abandon a sign-in: the address
  // typed so far is still there, and so would be a code already sent.
  await page.getByLabel('Email').fill('me@example.com')
  await page.getByRole('tab', { name: 'General' }).click()
  await expect(page.getByLabel('Email')).toBeHidden()
  await page.getByRole('tab', { name: 'Sync' }).click()
  await expect(page.getByLabel('Email')).toHaveValue('me@example.com')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Your notes are stored only on this Mac.', { exact: false })).toBeVisible()
  await expect(page.locator('.setting-error')).toHaveCount(0)
  await cue.app.close()
})

test('Sign in with Apple waits for the browser, and Cancel there or here goes back quietly', async () => {
  // A stand-in auth server: /authorize sends the browser to "Apple", which would come back
  // to the address Cue gave. A second mode answers like a server without Apple set up.
  let offersApple = true
  const auth = createHttpServer((request, response) => {
    const url = new URL(request.url!, 'http://127.0.0.1')
    if (url.pathname !== '/auth/v1/authorize') return void response.writeHead(404).end()
    if (!offersApple) {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      return void response.end(JSON.stringify({ code: 400, error_code: 'validation_failed', msg: 'Unsupported provider: provider is not enabled' }))
    }
    const apple = new URL('https://appleid.apple.com/auth/authorize')
    apple.searchParams.set('back', url.searchParams.get('redirect_to')!)
    apple.searchParams.set('challenge', url.searchParams.get('code_challenge') ?? '')
    response.writeHead(302, { Location: apple.href }).end()
  })
  await new Promise<void>((resolve) => auth.listen(0, '127.0.0.1', resolve))
  const cue = await launch(undefined, { CUE_SUPABASE_URL: `http://127.0.0.1:${(auth.address() as AddressInfo).port}`, CUE_SUPABASE_KEY: 'unused' })
  const { app, page } = cue
  // Stand in for the browser: remember what Cue asked it to open.
  await app.evaluate(({ shell }) => {
    const opened: string[] = ((globalThis as { opened?: string[] }).opened = [])
    shell.openExternal = async (url: string) => void opened.push(url)
  })
  const comeBack = async (index: number): Promise<URL> => {
    await expect.poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened!.length)).toBe(index + 1)
    const url = new URL(await app.evaluate((_e, i) => (globalThis as { opened?: string[] }).opened![i], index))
    // Straight to Apple's page, with a PKCE challenge.
    expect(url.origin).toBe('https://appleid.apple.com')
    expect(url.searchParams.get('challenge')).toBeTruthy()
    return new URL(url.searchParams.get('back')!)
  }

  await openSettings(page, 'Sync')
  await page.getByRole('button', { name: 'Turn On Sync…' }).click()
  await page.getByRole('button', { name: 'Continue with Apple' }).click()
  await expect(page.getByText('Finish signing in with Apple in your browser.')).toBeVisible()
  const back = await comeBack(0)
  expect(back.hostname).toBe('127.0.0.1')
  expect(back.pathname).toBe('/auth/callback')

  // Cancel in Cue: back to the choice, and nothing listens for the browser any more.
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible()
  await expect(fetch(back)).rejects.toThrow()

  // Cancel on Apple's page: the browser comes back without a code. Nothing to explain.
  await page.getByRole('button', { name: 'Continue with Apple' }).click()
  const again = await comeBack(1)
  again.searchParams.set('error', 'access_denied')
  expect(await (await fetch(again)).text()).toContain('Sign-in didn’t finish')
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.locator('.setting-error')).toHaveCount(0)

  // A server without Sign in with Apple says so here, and no browser opens.
  offersApple = false
  await page.getByRole('button', { name: 'Continue with Apple' }).click()
  await expect(page.locator('.setting-error')).toHaveText('This sync server doesn’t offer Sign in with Apple. Use your email instead.')
  await expect(page.getByLabel('Email')).toBeVisible()
  expect(await app.evaluate(() => (globalThis as { opened?: string[] }).opened!.length)).toBe(2)
  await cue.app.close()
  auth.close()
})

/** The server ended this Mac's session, as the sync service records it. */
function ended(dataDir: string, email: string, reason: 'expired' | 'deleted'): void {
  const db = new DatabaseSync(join(dataDir, 'cue.sqlite'))
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('sync_ended', JSON.stringify({ email, reason }))
  db.close()
}

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
    await openSettings(page, 'Sync')
    await page.getByRole('button', { name: 'Turn On Sync…' }).click()
    await page.getByLabel('Email').fill(email)
    await page.keyboard.press('Enter')
    await page.getByLabel('Sign-in code').fill(await signInCode(email))
    await page.keyboard.press('Enter')
    await expect(page.locator('.setting-label', { hasText: `On as ${email}` })).toBeVisible()
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
    await openSettings(a.page, 'Sync')
    await a.page.getByRole('button', { name: 'Turn Off Sync' }).click()
    await expect(a.page.getByRole('button', { name: 'Turn On Sync…' })).toBeVisible()
    await a.page.keyboard.press('Escape')
    expect(await outline(a.page, day)).toBe(expected)

    await Promise.all([a.app.close(), b.app.close()])
  })

  test('the line you’re on is deleted on the other Mac: the caret moves up, and Undo brings it back', async () => {
    const email = testEmail('doomed')
    const [a, b] = await Promise.all([launch(undefined, env()), launch(undefined, env())])
    const day = await today(a.page)
    await typeLines(a.page, 'Keep', 'Doomed')
    await turnOnSync(a.page, email)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await turnOnSync(b.page, email)
    await expect.poll(() => outline(b.page, day)).toBe(lines('Keep', 'Doomed'))
    expect(await focusedText(a.page)).toBe('Doomed')

    await b.page.locator(`.day[data-day="${day}"] .row .text`, { hasText: 'Doomed' }).click()
    await b.page.keyboard.press('Meta+Shift+Backspace')
    await expect.poll(() => outline(a.page, day)).toBe('Keep')
    expect(await focusedText(a.page)).toBe('Keep')
    expect(await caret(a.page)).toBe('Keep'.length)
    await expect(a.page.locator('.toast')).toContainText('Deleted on another device')

    await a.page.locator('.toast').getByRole('button', { name: /Undo/ }).click()
    await expect.poll(() => outline(a.page, day)).toBe(lines('Keep', 'Doomed'))
    await expect.poll(() => outline(b.page, day)).toBe(lines('Keep', 'Doomed'))
    await Promise.all([a.app.close(), b.app.close()])
  })

  test('after the session ends, Sign In Again goes straight to the code for the same account', async () => {
    const email = testEmail('again')
    let cue = await launch(undefined, env())
    await cue.app.close()
    ended(cue.dataDir, email, 'expired')

    cue = await launch(cue.dataDir, env())
    const { page } = cue
    await page.locator('.sync-status', { hasText: 'Sign in to sync' }).click()
    await page.getByRole('button', { name: 'Sign In Again…' }).click()
    await expect(page.getByText(`Enter the code we sent to ${email}.`)).toBeVisible()
    const first = await signInCode(email)

    await page.getByLabel('Sign-in code').fill(first === '000000' ? '111111' : '000000')
    await page.keyboard.press('Enter')
    await expect(page.locator('.setting-error')).toHaveText('That code is wrong or has expired. Check it, or send a new one.')
    await new Promise((resolve) => setTimeout(resolve, 1100)) // one code per address per second
    await page.getByRole('button', { name: 'Send a New Code' }).click()
    await expect(page.locator('.setting-error')).toHaveCount(0)
    await page.getByLabel('Sign-in code').fill(await signInCode(email))
    await page.keyboard.press('Enter')
    await expect(page.locator('.setting-label', { hasText: `On as ${email}` })).toBeVisible()
    await expect(page.locator('.setting-help', { hasText: 'Synced just now' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.sync-status')).toHaveCount(0)
    await cue.app.close()
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

    // A new line goes out at once. Typing is saved on this Mac, but quit before the usual
    // pause-then-upload.
    const state = () => b.page.evaluate(() => window.cue!.sync.getState())
    const synced = (await state()).lastSyncedAt ?? 0
    await b.page.keyboard.type('Written')
    await expect.poll(() => state().then((s) => (s.lastSyncedAt ?? 0) > synced && s.pending === 0)).toBe(true)
    await b.page.keyboard.type(' just before quitting')
    await expect.poll(() => state().then((s) => s.pending)).toBeGreaterThan(0)
    await b.app.close()

    a = await launch(a.dataDir, env())
    await expect.poll(() => outline(a.page, day)).toBe('Written just before quitting')
    await a.app.close()
  })
})
