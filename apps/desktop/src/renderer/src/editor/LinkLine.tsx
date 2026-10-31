import { memo, useRef, useState } from 'react'
import type { ISODate } from '@shared/types'
import { bareLabel, type LinkPreview } from '@shared/links'
import { backend } from '../data/backend'
import { useLinkPreview } from '../store/links'
import { controller } from './controller'
import { beginTextPointer } from './pointer'

/**
 * A line that is only a link, shown as its page: the site's icon, the page's title (a
 * post's text, for a post on X) and where it's from, in the line's own type and rhythm.
 * Never more than two lines. Until the page has answered, it shows the link's address.
 *
 * Clicking the page opens it; clicking the space beside it edits the link, as does
 * arriving on the line with the arrow keys.
 */
export const LinkLine = memo(function LinkLine({ id, date, url }: { id: string; date: ISODate; url: string }) {
  const preview = useLinkPreview(url)
  const down = useRef<{ x: number; y: number } | null>(null)
  const title = preview?.title

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    down.current = null
    if (e.button !== 0) return
    // Shift-click selects a range of lines; a drag selects the lines it crosses.
    if (!e.metaKey) beginTextPointer(e, id, date)
    if (e.defaultPrevented) return
    e.preventDefault()
    down.current = { x: e.clientX, y: e.clientY }
  }

  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const start = down.current
    down.current = null
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return
    if ((e.target as Element).closest('.link-page')) void backend.openExternal(url)
    else controller.focusEnd(id)
  }

  return (
    <div className="link-line" onMouseDown={onMouseDown} onClick={onClick} data-link={url}>
      <a className="link-page" href={url} title={url} draggable={false} tabIndex={-1}>
        <span className="link-icon" aria-hidden>
          <SiteIcon preview={preview} />
        </span>
        <span className={title ? 'link-title' : 'link-title is-bare'}>
          {title ?? bareLabel(url)}
          {title ? <span className="link-byline">{` ${preview!.byline}`}</span> : null}
        </span>
      </a>
    </div>
  )
})

/** The site's icon, or a link glyph until (or unless) the page names one that draws. */
export function SiteIcon({ preview }: { preview: LinkPreview | null }) {
  const [broken, setBroken] = useState<string | null>(null)
  const icon = preview?.icon && preview.icon !== broken ? preview.icon : null
  return icon ? (
    <img src={icon} alt="" width={16} height={16} draggable={false} onError={() => setBroken(icon)} />
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M6.8 9.2a2.9 2.9 0 0 0 4.1 0l2.2-2.2a2.9 2.9 0 0 0-4.1-4.1l-.9.9" />
      <path d="M9.2 6.8a2.9 2.9 0 0 0-4.1 0L2.9 9a2.9 2.9 0 0 0 4.1 4.1l.9-.9" />
    </svg>
  )
}
