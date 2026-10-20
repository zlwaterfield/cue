import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { LinkPreview } from '@shared/links'
import { backend } from '../data/backend'

/**
 * Previews of lines that are only a link, as the main process hands them out
 * (`main/links.ts` fetches and keeps them). Each link is asked for once per launch;
 * fresher previews arrive on their own.
 */

const previews = new Map<string, LinkPreview | null>()
const asked = new Set<string>()
const listeners = new Map<string, Set<() => void>>()

function set(url: string, preview: LinkPreview | null): void {
  previews.set(url, preview)
  for (const listener of listeners.get(url) ?? []) listener()
}

backend.onLinkPreview(({ url, preview }) => set(url, preview))

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
  useEffect(() => {
    if (asked.has(url)) return
    asked.add(url)
    void backend.linkPreview(url).then(
      // A preview that arrived while this was on its way is newer.
      (stored) => {
        if (!previews.has(url)) set(url, stored)
      },
      () => asked.delete(url)
    )
  }, [url])
  return preview
}
