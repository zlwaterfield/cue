/** PROTOTYPE — the two glyphs notes need, drawn like the rest of Cue's 16 px strokes. */

export function StarIcon({ filled = false, size = 16 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 2.2l1.76 3.57 3.94.57-2.85 2.78.67 3.92L8 11.19l-3.52 1.85.67-3.92L2.3 6.34l3.94-.57z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ScratchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 3.3l2.8 2.8M3 13l.6-3.1 7-7a1.4 1.4 0 012 0l.5.5a1.4 1.4 0 010 2l-7 7z" />
    </svg>
  )
}
