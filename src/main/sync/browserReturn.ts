import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SyncError } from '../../shared/sync/engine'
import { SIGN_IN_FAILED } from '../../shared/sync/status'

/**
 * Sign in with Apple on the Mac happens in the browser, which comes back to this Mac with
 * a one-time code. It comes back to a server on the loopback address that answers one
 * path, once: it closes when the answer arrives, the wait is cancelled, or it times out.
 * The code is useless without the verifier only this Mac holds (PKCE).
 */

export interface BrowserReturn {
  /** Where the browser should come back to. */
  url: string
  /** The one-time code. Rejects with `SignInCancelled`, a timeout, or the server's refusal. */
  code: Promise<string>
  cancel(): void
}

/** Someone cancelled: no message to show. */
export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in was cancelled.')
    this.name = 'SignInCancelled'
  }
}

const PATH = '/auth/callback'
/** Long enough to type an Apple Account password and a two-factor code. */
const WAIT = 10 * 60_000

export async function awaitBrowserReturn(wait = WAIT): Promise<BrowserReturn> {
  let settle: { resolve(code: string): void; reject(error: Error): void } = { resolve() {}, reject() {} }
  const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }))
  code.catch(() => {})

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method !== 'GET' || url.pathname !== PATH) {
      response.writeHead(404).end()
      return
    }
    const value = url.searchParams.get('code')
    const failure = url.searchParams.get('error_code') ?? url.searchParams.get('error')
    const signedIn = !!value && !failure
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' })
    response.end(page(signedIn))
    if (signedIn) finish(() => settle.resolve(value))
    else {
      console.warn('Sign in with Apple came back without a code', failure, url.searchParams.get('error_description'))
      // Closing Apple's page or choosing Cancel there comes back as access denied.
      finish(() => settle.reject(/denied|cancel/i.test(failure ?? '') ? new SignInCancelled() : new SyncError(SIGN_IN_FAILED)))
    }
  })

  let timer: NodeJS.Timeout | undefined
  let finished = false
  const finish = (done: () => void): void => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    done()
    server.close()
    server.closeIdleConnections()
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  timer = setTimeout(() => finish(() => settle.reject(new SyncError('Sign in with Apple timed out. Try again.'))), wait)
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}${PATH}`,
    code,
    cancel: () => finish(() => settle.reject(new SignInCancelled()))
  }
}

/** What the browser shows once it's back: a short note in Cue's colors, then back to Cue. */
function page(signedIn: boolean): string {
  const title = signedIn ? 'You’re signed in' : 'Sign-in didn’t finish'
  const body = signedIn ? 'Sync is on. You can close this tab and go back to Cue.' : 'Go back to Cue to try again.'
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Cue</title>
<style>
  :root { --bg: #ffffff; --text: #1c1c1e; --text-2: #6c6c72; }
  @media (prefers-color-scheme: dark) { :root { --bg: #18181a; --text: #ececef; --text-2: #9d9da4; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 320px; padding: 24px; }
  h1 { margin: 0 0 4px; font-size: 17px; font-weight: 600; }
  p { margin: 0; color: var(--text-2); }
</style>
<main>
  <h1>${title}</h1>
  <p>${body}</p>
</main>
</html>`
}
