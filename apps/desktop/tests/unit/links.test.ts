import { describe, expect, it } from 'vitest'
import { bareLabel, decodeEntities, fetchPage, findLinks, linkSearchText, pageText, parsePreview, postAuthor, soleLink } from '@shared/links'

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
      description: null,
      icon: 'https://daily.com/touch.png'
    })
  })

  it('falls back to <title>, the host and /favicon.ico', () => {
    const html = '<head><title>\n  Hacker News - Wikipedia\n</title></head>'
    expect(parsePreview(html, 'https://en.wikipedia.org/wiki/HN')).toEqual({
      url: 'https://en.wikipedia.org/wiki/HN',
      title: 'Hacker News',
      byline: 'Wikipedia',
      description: null,
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
      description: null,
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
    const { preview } = await fetchPage('https://example.com/a', fake)
    expect(preview.title).toBe('Hi there')
    expect(agents[0]).toContain('facebookexternalhit')
    expect(agents[1]).toContain('Safari')
  })

  it('shows a file as its address', async () => {
    const fake = async (url: string) => ({ ok: true, url, headers: { get: () => 'application/pdf' }, text: async () => '' })
    expect(await fetchPage('https://example.com/a.pdf', fake)).toEqual({
      preview: { url: 'https://example.com/a.pdf', title: null, byline: 'example.com', description: null, icon: null },
      search: 'example.com/a.pdf'
    })
  })

  it('keeps the page’s description, unless it only repeats the title', () => {
    const page = (description: string) =>
      `<meta property="og:title" content="Local-first software"><meta name="description" content="${description}">`
    expect(parsePreview(page('You own your data, in spite of the cloud.'), 'https://inkandswitch.com/lfs').description).toBe(
      'You own your data, in spite of the cloud.'
    )
    expect(parsePreview(page('Local-first software'), 'https://inkandswitch.com/lfs').description).toBeNull()
    // An empty og:description doesn't hide the plain one.
    const both = '<meta property="og:description" content=" "><meta name="description" content="The plain description.">'
    expect(parsePreview(both, 'https://example.com').description).toBe('The plain description.')
  })

  it('finds a page by its title, description, text and address, ignoring case and accents', async () => {
    const html = `<head><meta property="og:title" content="Crème brûlée, at home"><meta property="og:site_name" content="Serious Eats">
      <meta property="og:description" content="The custard that sets in a water bath."></head>
      <body><article><p>Torch the sugar until it is amber and glassy, then let it rest for a minute.</p></article></body>`
    const fake = async (url: string) => ({ ok: true, url, headers: { get: () => 'text/html' }, text: async () => html })
    const { search } = await fetchPage('https://www.seriouseats.com/creme-brulee', fake)
    for (const word of ['creme brulee', 'serious eats', 'water bath', 'amber and glassy', 'seriouseats.com/creme-brulee']) {
      expect(search).toContain(word)
    }
  })
})

describe('page text', () => {
  const para = (text: string) => `<p>${text}</p>`
  const sentence = 'This sentence is long enough to read as prose on the page.'

  it('reads the article’s paragraphs and leaves the page around them out', () => {
    const html = `<html><head><title>T</title><script>var a = "${sentence}"</script></head><body>
      <nav><a href="/">A link in the menu that is long enough to count as prose</a></nav>
      <p>A paragraph outside the article, which the article makes beside the point.</p>
      <article><header><h1>Title</h1></header>
        ${para('The first paragraph of the article,\n        wrapped across lines in the source.')}
        <div class="share"><button>Share this on every network you have heard of</button></div>
        ${para('Short.')}
        ${para('The second paragraph, with an &ldquo;entity&rdquo; and <a href="#">a link</a> in it.')}
        <!-- ${sentence} -->
      </article>
      <footer>${para(sentence)}</footer></body></html>`
    expect(pageText(html)).toBe(
      'The first paragraph of the article, wrapped across lines in the source. The second paragraph, with an “entity” and a link in it.'
    )
  })

  it('falls back to the body, and stops at the limit on a word', () => {
    const html = `<body>${para(sentence).repeat(100)}</body>`
    const text = pageText(html, 200)
    expect(text.length).toBeLessThanOrEqual(200)
    expect(text.startsWith(sentence)).toBe(true)
    expect(text.endsWith(' ')).toBe(false)
    expect(sentence.split(' ')).toContain(text.split(' ').pop())
  })

  it('takes a page with nothing to read, or markup that never closes', () => {
    expect(pageText('<html><body><div id="root"></div><script>render()</script></body></html>')).toBe('')
    expect(pageText(`<body><script>${'x'.repeat(100_000)}<p>${sentence}`)).toBe('')
    expect(pageText(`<body>${'<li>'.repeat(50_000)}<p>${sentence}`)).toBe(sentence)
    expect(pageText(`<body><p>${sentence}</p><!-- never closed <p>${sentence} and more</p>`)).toBe(sentence)
  })

  it('reads a page built to be slow in one quick pass', () => {
    const pages = [
      // Openings with no closing tag anywhere, each of which a lazy search would chase to the end.
      `<body>${'<nav>'.repeat(150_000)}<p>${sentence}</p>`,
      `<body>${'<script>'.repeat(120_000)}</script><p>${sentence}</p>`,
      `<body>${'<!--'.repeat(200_000)}--><p>${sentence}</p>`,
      `<body>${'<header><p>x</p>'.repeat(60_000)}<p>${sentence}</p>`
    ]
    for (const html of pages) {
      const started = performance.now()
      pageText(html)
      expect(performance.now() - started, html.slice(0, 30)).toBeLessThan(500)
    }
  })

  it('never takes an article written inside a script for the page’s own', () => {
    const html = `<body><script>const card = '<article><p>${sentence} From a template.</p></article>'</script>
      <article><p>${sentence} The real article.</p></article></body>`
    expect(pageText(html)).toBe(`${sentence} The real article.`)
  })

  it('is what a link is found by, with the preview', () => {
    expect(linkSearchText('https://www.example.com/Café', { url: '', title: 'Ünïcode', byline: 'Example', description: null, icon: null }, 'Body')).toBe(
      'unicode example body example.com/cafe'
    )
    expect(linkSearchText('https://example.com/a', null)).toBe('example.com/a')
  })
})
