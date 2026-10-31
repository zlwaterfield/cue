import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { LinkPreview } from '@shared/links'
import { backend } from '../data/backend'

/**
 * Previews of lines that are only a link, as the main process hands them out
 * (`main/links.ts` fetches and keeps them, and decides when a page is due again).
 * A link is asked for when its line appears, and again after a while: when a line
 * appears or the window comes back to the front, so a page that was unreachable
 * (offline, say) gets its preview without reopening Cue.
 */

const ASK_AGAIN_AFTER = 60 * 60_000

const previews = new Map<string, LinkPreview | null>()
const askedAt = new Map<string, number>()
const listeners = new Map<string, Set<() => void>>()

function set(url: string, preview: LinkPreview | null): void {
  previews.set(url, preview)
  for (const listener of listeners.get(url) ?? []) listener()
}

// Pages read for the Links list arrive here too; only those a line is showing, or has shown, are kept.
backend.onLinkPreview(({ url, preview }) => {
  if (listeners.has(url) || previews.has(url)) set(url, preview)
})

function ask(url: string): void {
  const last = askedAt.get(url)
  if (last !== undefined && Date.now() - last < ASK_AGAIN_AFTER) return
  askedAt.set(url, Date.now())
  void backend.linkPreview(url).then(
    // Anything newer arrives through onLinkPreview, so this only fills a gap.
    (stored) => {
      if (!previews.has(url)) set(url, stored)
    },
    () => askedAt.delete(url)
  )
}

if (typeof window !== 'undefined') window.addEventListener('focus', () => listeners.forEach((_, url) => ask(url)))

function subscribe(url: string, listener: () => void): () => void {
  let group = listeners.get(url)
  if (!group) listeners.set(url, (group = new Set()))
  group.add(listener)
  return () => {
    group.delete(listener)
    if (!group.size) listeners.delete(url)
  }
}

/** A link's preview, or null until (or unless) its page has one. */
export function useLinkPreview(url: string): LinkPreview | null {
  const sub = useCallback((listener: () => void) => subscribe(url, listener), [url])
  const preview = useSyncExternalStore(sub, () => previews.get(url) ?? null)
  useEffect(() => ask(url), [url])
  return preview
}
