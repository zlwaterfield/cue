import { describe, expect, it } from 'vitest'
import { bareLabel, decodeEntities, fetchPreview, findLinks, parsePreview, postAuthor, soleLink } from '@shared/links'

describe('links in a line', () => {
  it('finds links and leaves trailing punctuation out', () => {
    expect(findLinks('see https://example.com/a, and www.cue.app.')).toEqual([
      { start: 4, end: 25, url: 'https://example.com/a' },
      { start: 31, end: 42, url: 'https://www.cue.app' }
    ])
  })

  it('knows a line that is only a link', () => {
    expect(soleLink('  https://x.com/jack/status/20 ')).toBe('https://x.com/jack/status/20')
    expect(soleLink('www.example.com')).toBe('https://www.example.com')
    expect(soleLink('read https://example.com')).toBeNull()
    expect(soleLink('https://a.com https://b.com')).toBeNull()
    expect(soleLink('')).toBeNull()
  })

  it('labels a link without its page', () => {
    expect(bareLabel('https://www.example.com/posts/caf%C3%A9/?utm=1')).toBe('example.com/posts/café')
    expect(bareLabel('https://example.com/')).toBe('example.com')
  })

  it('recognizes posts on X and Twitter', () => {
    expect(postAuthor('https://x.com/jack/status/20')).toBe('jack')
    expect(postAuthor('https://mobile.twitter.com/jack/status/20?s=21')).toBe('jack')
    expect(postAuthor('https://x.com/jack')).toBeNull()
    expect(postAuthor('https://example.com/jack/status/20')).toBeNull()
  })
})

describe('link previews', () => {
  it('reads the Open Graph header and drops the site name from the title', () => {
    const html = `<html><head>
      <title>Ignored | The Daily</title>
      <meta content="A &amp; B: the &#8220;story&#8221; | The Daily" property="og:title">
      <meta property='og:site_name' content='The Daily'>
      <link rel="icon" href="/favicon.svg" type="image/svg+xml">
      <link rel="icon" href="/favicon-32.png" sizes="32x32">
      <link rel="apple-touch-icon" href="/touch.png" sizes="180x180">
    </head><body></body></html>`
    expect(parsePreview(html, 'https://www.daily.com/story', 'https://daily.com/story/')).toEqual({
      url: 'https://www.daily.com/story',
      title: 'A & B: the “story”',
      byline: 'The Daily',
      icon: 'https://daily.com/touch.png'
    })
  })

  it('falls back to <title>, the host and /favicon.ico', () => {
    const html = '<head><title>\n  Hacker News - Wikipedia\n</title></head>'
    expect(parsePreview(html, 'https://en.wikipedia.org/wiki/HN')).toEqual({
      url: 'https://en.wikipedia.org/wiki/HN',
      title: 'Hacker News',
      byline: 'Wikipedia',
      icon: 'https://en.wikipedia.org/favicon.ico'
    })
    expect(parsePreview('<title>Example</title>', 'https://example.com').title).toBeNull()
  })

  it('shows a post on X as its text, by its author, with their picture', () => {
    const html = `<head>
      <meta property="og:title" content="jack (@jack)
309.2K likes · 18K replies">
      <meta property="og:description" content="just setting up
my twttr">
      <link rel="apple-touch-icon" sizes="192x192" href="/apple-touch-icon.png">
      <link rel="shortcut icon" href="https://pbs.twimg.com/profile_images/1/a_200x200.jpg">
    </head>`
    expect(parsePreview(html, 'https://x.com/jack/status/20')).toEqual({
      url: 'https://x.com/jack/status/20',
      title: 'just setting up my twttr',
      byline: '@jack',
      icon: 'https://pbs.twimg.com/profile_images/1/a_200x200.jpg'
    })
  })

  it('keeps titles short', () => {
    const title = 'word '.repeat(200)
    expect(parsePreview(`<meta property="og:title" content="${title}">`, 'https://a.com').title!.length).toBe(300)
  })

  it('decodes entities', () => {
    expect(decodeEntities('&lt;b&gt; &#x1F600; &hellip; &bogus; &#0;')).toBe('<b> 😀 … &bogus; &#0;')
  })

  it('fetches as a link-preview crawler and retries as a browser when turned away', async () => {
    const agents: string[] = []
    const fake = async (url: string, init: { headers: Record<string, string> }) => {
      agents.push(init.headers['User-Agent'])
      const ok = agents.length > 1
      return { ok, url, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => '<title>Hi there</title>' }
    }
    const preview = await fetchPreview('https://example.com/a', fake)
    expect(preview.title).toBe('Hi there')
    expect(agents[0]).toContain('facebookexternalhit')
    expect(agents[1]).toContain('Safari')
  })

  it('shows a file as its address', async () => {
    const fake = async (url: string) => ({ ok: true, url, headers: { get: () => 'application/pdf' }, text: async () => '' })
    expect(await fetchPreview('https://example.com/a.pdf', fake)).toEqual({ url: 'https://example.com/a.pdf', title: null, byline: 'example.com', icon: null })
  })
})
