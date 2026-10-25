import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LinkPreview } from '../../core/links'
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
})
