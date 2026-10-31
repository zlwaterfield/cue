import { findLinks } from './links'
import { searchTerms } from './text'
import type { ISODate, ItemType } from './types'

/**
 * The Links list: every link written on any day, newest first, each once. Like loose
 * ends, links stay on the lines they were written on; the list only gathers them.
 *
 * A link is found by its line (what was written around it) and by what its page says
 * about itself (`linkSearchText`), which each device keeps with its previews.
 */

/** A line with a link in it, as the repository reads it (`Repository.linkLines`). */
export interface LinkLine {
  id: string
  date: ISODate
  type: ItemType
  done: boolean
  text: string
  /** The line's folded text, as search reads it. */
  search: string
}

/** A link, and the newest line it's on. */
export interface LinkEntry {
  url: string
  /** The line's id. */
  id: string
  date: ISODate
  type: ItemType
  done: boolean
  /** The whole line, link and all. */
  text: string
}

/**
 * Every link on `lines`, once each: a link written on several days is listed on the newest.
 * `lines` come newest day first, in page order within a day, and the list keeps that order.
 */
export function collectLinks(lines: LinkLine[]): Array<LinkEntry & { search: string }> {
  const seen = new Set<string>()
  const out: Array<LinkEntry & { search: string }> = []
  for (const line of lines) {
    for (const { url } of findLinks(line.text)) {
      if (seen.has(url)) continue
      seen.add(url)
      out.push({ url, id: line.id, date: line.date, type: line.type, done: line.done, text: line.text, search: line.search })
    }
  }
  return out
}

/** A page of the Links list, and how many links match in all. */
export interface LinkResults {
  links: LinkEntry[]
  total: number
}

/**
 * The first `limit` links matching `query`, newest first, and how many match in all: every
 * term has to appear in the line or in what the page says (`pageSearch`, by URL), ignoring
 * case and accents. An empty query matches every link.
 */
export function filterLinks(
  links: Array<LinkEntry & { search: string }>,
  query: string,
  pageSearch: (url: string) => string | undefined,
  limit = Infinity
): LinkResults {
  const terms = searchTerms(query)
  const out: LinkEntry[] = []
  let total = 0
  for (const { search, ...link } of links) {
    if (terms.length) {
      const page = pageSearch(link.url) ?? ''
      if (!terms.every((t) => search.includes(t) || page.includes(t))) continue
    }
    total++
    if (out.length < limit) out.push(link)
  }
  return { links: out, total }
}
