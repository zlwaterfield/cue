/**
 * Links in a line, and the small preview a line that is only a link shows in its place:
 * the page's icon, its title and where it's from. Previews come from the page's own
 * header (Open Graph and <title>), never from a third-party service, and stay small on
 * purpose: one line of text, two at most.
 */

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']*[^\s<>"'.,;:!?)\]}]/gi

export interface Link {
  start: number
  end: number
  url: string
}

export function findLinks(text: string): Link[] {
  if (!text.includes('http') && !text.includes('www.')) return []
  return [...text.matchAll(URL_RE)].map((m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
    url: m[0].startsWith('www.') ? `https://${m[0]}` : m[0]
  }))
}

export function linkAt(text: string, offset: number): string | null {
  return findLinks(text).find((l) => offset >= l.start && offset <= l.end)?.url ?? null
}

/** The line is a link and nothing else (what sharing or pasting a link makes). */
export function soleLink(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  const links = findLinks(trimmed)
  return links.length === 1 && links[0].start === 0 && links[0].end === trimmed.length ? links[0].url : null
}

export interface LinkPreview {
  url: string
  /** The page's title (a post's text, for a post on X). Null when the page has none worth showing. */
  title: string | null
  /** Where it's from: the site's name, its host, or the author of a post. */
  byline: string
  /** An absolute URL of a small square icon, if the page names one we can draw. */
  icon: string | null
}

/** example.com, without the www. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** A link shown without its page: host and path, without the scheme and query. */
export function bareLabel(url: string): string {
  try {
    const u = new URL(url)
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, '')
    return hostOf(url) + path
  } catch {
    return url.replace(/^https?:\/\//, '')
  }
}

/** A post on X (or Twitter): its author's handle. */
export function postAuthor(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/.test(u.hostname)) return null
    const m = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/\d+/.exec(u.pathname)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ Parsing */

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™'
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole
    }
    return NAMED[code.toLowerCase()] ?? whole
  })
}

function clean(text: string | undefined | null, max = 300): string {
  if (!text) return ''
  const flat = decodeEntities(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

function absolute(href: string, base: string): string | null {
  try {
    const url = new URL(decodeEntities(href.trim()), base)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

interface IconLink {
  rel: string
  href: string
  size: number
  type: string
}

/** The best icon a page names that an image view can draw (no SVG): the largest touch icon, then a PNG, then any. */
function pickIcon(icons: IconLink[], base: string, author: string | null): string | null {
  const usable = icons.filter((i) => !/svg/i.test(i.type) && !/\.svg(?:$|\?)/i.test(i.href) && !/mask-icon/.test(i.rel))
  // A post on X names its author's picture as the shortcut icon.
  if (author) {
    const avatar = usable.find((i) => /profile_images/.test(i.href))
    if (avatar) return absolute(avatar.href, base)
  }
  const rank = (i: IconLink): number => (/apple-touch-icon/.test(i.rel) ? 3 : /png/i.test(i.type) || /\.png(?:$|\?)/i.test(i.href) ? 2 : 1)
  const best = [...usable].sort((a, b) => rank(b) - rank(a) || b.size - a.size)[0]
  return best ? absolute(best.href, base) : absolute('/favicon.ico', base)
}

/** Drop a site's name from either end of a page title ("Post title | Site" → "Post title"). */
function trimSiteName(title: string, names: string[]): string {
  for (const name of names) {
    if (!name) continue
    const n = name.toLowerCase()
    for (const sep of [' | ', ' - ', ' – ', ' — ', ' · ', ': ']) {
      const t = title.toLowerCase()
      if (title.length <= sep.length + n.length) continue
      if (t.endsWith(sep + n)) title = title.slice(0, title.length - sep.length - n.length).trim()
      else if (sep !== ': ' && t.startsWith(n + sep)) title = title.slice(n.length + sep.length).trim()
    }
  }
  return title
}

/**
 * A preview from a page's HTML. `url` is the link as written; `base` is where the page
 * was actually served from, for resolving relative icons.
 */
export function parsePreview(html: string, url: string, base = url): LinkPreview {
  // Some frameworks stream the header's tags into the body, so the whole page is read.
  const head = html.length > 2_000_000 ? html.slice(0, 2_000_000) : html

  const meta: Record<string, string> = {}
  for (const m of head.matchAll(/<meta\s[^>]*>/gi)) {
    const a = attributes(m[0])
    const key = (a.property ?? a.name ?? '').toLowerCase()
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content
  }
  const icons: IconLink[] = []
  for (const m of head.matchAll(/<link\s[^>]*>/gi)) {
    const a = attributes(m[0])
    const rel = (a.rel ?? '').toLowerCase()
    if (!a.href || !/(?:^|\s)(?:icon|shortcut|apple-touch-icon(?:-precomposed)?|mask-icon)(?:\s|$)/.test(rel)) continue
    icons.push({ rel, href: a.href, size: parseInt(a.sizes ?? '', 10) || 0, type: a.type ?? '' })
  }
  const docTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]

  const host = hostOf(url)
  const author = postAuthor(url)
  const icon = pickIcon(icons, base, author)

  if (author) {
    // X serves a post's text as its description, and "Name (@handle)" as its title.
    const text = clean(meta['og:description'] ?? meta['twitter:description'])
    return { url, title: text || null, byline: `@${author}`, icon }
  }

  const siteName = clean(meta['og:site_name'] ?? meta['application-name'], 40)
  let site = siteName && !/^(?:www\.)?[\w-]+(?:\.[\w-]+)+$/.test(siteName) ? siteName : ''
  const raw = clean(meta['og:title'] ?? meta['twitter:title'] ?? docTitle)
  // Without a site name, a title ending in a word of the host names it ("… - Wikipedia").
  const labels = host.split('.').slice(0, -1).filter((l) => l.length > 2 && l !== 'www')
  if (!site) {
    const suffix = /\s[|\-–—·]\s([^|\-–—·]{3,40})$/.exec(raw)?.[1]?.trim()
    if (suffix && labels.some((l) => l.toLowerCase() === suffix.toLowerCase().replace(/\s+/g, ''))) site = suffix
  }
  let title = trimSiteName(raw, [site, host, ...labels])
  if (!title || [site, host, ...labels].some((n) => n && n.toLowerCase() === title.toLowerCase())) title = ''
  return { url, title: title || null, byline: site || host, icon }
}

/** What a link shows before (or without) its page. */
export function placeholderPreview(url: string): LinkPreview {
  const author = postAuthor(url)
  return { url, title: null, byline: author ? `@${author}` : hostOf(url), icon: null }
}

/* ----------------------------------------------------------------- Fetching */

/**
 * Sites serve their link-preview header to the crawlers of messaging apps (X serves a
 * post's text only to them), so previews are fetched as one, the way iMessage does. A
 * site that turns crawlers away gets a second try as a browser.
 */
const CRAWLER = 'facebookexternalhit/1.1 Facebot Twitterbot/1.0'
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'follow' }) => Promise<{
  ok: boolean
  url: string
  headers: { get(name: string): string | null }
  text(): Promise<string>
}>

/** Fetch a link's preview. Rejects when the page can't be reached; a page without a header still resolves. */
export async function fetchPreview(url: string, fetchImpl: Fetch, timeout = 8000): Promise<LinkPreview> {
  try {
    return await fetchAs(CRAWLER, url, fetchImpl, timeout)
  } catch (error) {
    if (!(error instanceof RefusedError)) throw error
    return fetchAs(BROWSER, url, fetchImpl, timeout)
  }
}

class RefusedError extends Error {}

async function fetchAs(agent: string, url: string, fetchImpl: Fetch, timeout: number): Promise<LinkPreview> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': agent, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en' },
      signal: controller.signal,
      redirect: 'follow'
    })
    if (!res.ok) throw new RefusedError('The page refused a link preview')
    const type = res.headers.get('content-type') ?? ''
    if (type && !/html|xml/i.test(type)) return placeholderPreview(url)
    return parsePreview(await res.text(), url, res.url || url)
  } finally {
    clearTimeout(timer)
  }
}
