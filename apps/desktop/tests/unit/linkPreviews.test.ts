import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LinkPreview } from '@shared/links'
import { LinkPreviews } from '../../src/main/links'
import { tempDir } from './helpers'

const PAGE = '<html><head><meta property="og:title" content="A page"><link rel="icon" type="image/png" href="/icon.png"></head></html>'
const URL_ = 'https://example.com/post'

/** A server: the page, and an icon `icon()` decides. Set `down` to make every request fail. */
function site(icon: () => Response) {
  const state = { down: false, requests: 0 }
  const fetch = vi.fn(async (url: string) => {
    state.requests++
    if (state.down) throw new Error('offline')
    if (url.endsWith('/icon.png')) return icon()
    return new Response(PAGE, { headers: { 'content-type': 'text/html' } })
  })
  return { state, fetch }
}

function open(fetch: (url: string) => Promise<Response>, file = ':memory:') {
  const updates: Array<LinkPreview | null> = []
  const links = new LinkPreviews(file, fetch as never, (_url, preview) => updates.push(preview))
  const next = () => vi.waitFor(() => expect(updates.length).toBeGreaterThan(0)).then(() => updates.shift()!)
  return { links, next }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('link preview cache', () => {
  it('stores the icon as a data URL', async () => {
    const { fetch } = site(() => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
    const { links, next } = open(fetch)
    expect(links.get(URL_)).toBeNull()
    expect(await next()).toMatchObject({ title: 'A page', icon: 'data:image/png;base64,AQID' })
    expect(links.get(URL_)).toMatchObject({ title: 'A page' })
  })

  it('stops reading an icon at the limit, even without a Content-Length', async () => {
    let sent = 0
    const endless = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            sent += 64_000
            controller.enqueue(new Uint8Array(64_000))
          }
        }),
        { headers: { 'content-type': 'image/png' } }
      )
    const { fetch } = site(endless)
    const { links, next } = open(fetch)
    links.get(URL_)
    expect(await next()).toMatchObject({ title: 'A page', icon: null })
    expect(sent).toBeLessThan(400_000)
  })

  it('keeps the old preview when a refresh fails, and tries again in an hour rather than two weeks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { state, fetch } = site(() => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }))
    const file = join(tempDir(), 'links.sqlite')
    const { links, next } = open(fetch, file)
    links.get(URL_)
    await next()

    // Old enough to refresh, and the page is down: the preview stays.
    vi.setSystemTime(Date.now() + 15 * 24 * 60 * 60_000)
    state.down = true
    expect(links.get(URL_)).toMatchObject({ title: 'A page' })
    expect(await next()).toMatchObject({ title: 'A page' })
    links.close()

    // After a restart and an hour, it's tried again.
    const reopened = open(fetch, file)
    const before = state.requests
    reopened.links.get(URL_)
    expect(state.requests).toBe(before)
    vi.setSystemTime(Date.now() + 61 * 60_000)
    state.down = false
    reopened.links.get(URL_)
    expect(await reopened.next()).toMatchObject({ title: 'A page' })
    expect(state.requests).toBeGreaterThan(before)
  })

  it('reads each link’s page for search, once, behind any line waiting for its preview', async () => {
    const order: string[] = []
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('favicon.ico')) return new Response(null, { status: 404 })
      order.push(url)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return new Response(`<title>Page ${url.slice(-1)}</title><body><p>Some words on the page about ${url.slice(-1)}, long enough to keep.</p></body>`, {
        headers: { 'content-type': 'text/html' }
      })
    })
    const { links } = open(fetch)
    const urls = ['https://example.com/1', 'https://example.com/2', 'https://example.com/3', 'https://example.com/4', 'https://example.com/5']
    links.fill([...urls, 'not a link'])
    // A line comes on screen while three are loading: its page goes next.
    links.get('https://example.com/9')
    await vi.waitFor(() => expect(links.searchText().size).toBe(6))
    expect(order.slice(3, 4)).toEqual(['https://example.com/9'])
    expect(links.searchText().get('https://example.com/2')).toBe('page 2 example.com some words on the page about 2, long enough to keep. example.com/2')

    // Already read: nothing to fetch again.
    links.fill(urls)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(order).toHaveLength(6)
  })

  it('leaves a page that didn’t answer for a day before filling it in again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { state, fetch } = site(() => new Response(null, { status: 404 }))
    state.down = true
    const { links, next } = open(fetch)
    links.fill([URL_])
    expect(await next()).toBeNull()
    links.fill([URL_])
    expect(fetch).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 25 * 60 * 60_000)
    state.down = false
    links.fill([URL_])
    expect(await next()).toMatchObject({ title: 'A page' })
    expect(links.searchText().get(URL_)).toContain('a page')
  })

  it('keeps previews from before search, and fills in their pages', async () => {
    const file = join(tempDir(), 'links.sqlite')
    const old = new DatabaseSync(file)
    old.exec(`CREATE TABLE previews (url TEXT PRIMARY KEY, preview TEXT, fetched_at INTEGER NOT NULL, failed INTEGER NOT NULL DEFAULT 0);
      PRAGMA user_version = 1;`)
    old.prepare('INSERT INTO previews VALUES (?, ?, ?, 0)').run(URL_, JSON.stringify({ url: URL_, title: 'Kept', byline: 'example.com', icon: null }), Date.now())
    old.close()

    const { fetch } = site(() => new Response(null, { status: 404 }))
    const { links, next } = open(fetch, file)
    expect(links.get(URL_)).toMatchObject({ title: 'Kept' })
    expect(fetch).not.toHaveBeenCalled()
    expect(links.searchText().size).toBe(0)
    links.fill([URL_])
    expect(await next()).toMatchObject({ title: 'A page' })
    expect(links.searchText().get(URL_)).toContain('a page')
  })

  it('starts over, rather than failing to open, when an upgrade was cut short', () => {
    const file = join(tempDir(), 'links.sqlite')
    // The column went in, but the version number didn't.
    const old = new DatabaseSync(file)
    old.exec(`CREATE TABLE previews (url TEXT PRIMARY KEY, preview TEXT, fetched_at INTEGER NOT NULL, failed INTEGER NOT NULL DEFAULT 0, search TEXT);
      PRAGMA user_version = 1;`)
    old.close()
    const { fetch } = site(() => new Response(null, { status: 404 }))
    const { links } = open(fetch, file)
    expect(links.get(URL_)).toBeNull()
    expect(links.searchText().size).toBe(0)
    links.close()
    const reopened = new DatabaseSync(file)
    expect((reopened.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2)
    reopened.close()
  })
})
