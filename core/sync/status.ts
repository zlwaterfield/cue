import { MONTHS } from '../dates'

/**
 * How sync describes itself, in the same words on Mac and iPhone: the title bar or
 * header indicator, the status line in Settings, and the failures it reports. Pure, so
 * both apps and the tests share it.
 */

export interface StatusInput {
  status: 'off' | 'idle' | 'syncing' | 'offline' | 'error'
  lastSyncedAt: number | null
  /** Local changes not yet uploaded. */
  pending: number
  message: string | null
  /** iPhone: the first download of the account hasn't finished yet. */
  downloading?: boolean
  /** Mac: the server ended the session, and signing in again picks up where it left off. */
  needsSignIn?: boolean
}

export interface Indicator {
  label: string
  /** Show it only once the state has lasted `INDICATOR_DELAY`, fading in over `INDICATOR_FADE`, so quick syncs never show. */
  delayed: boolean
}

export const INDICATOR_DELAY = 1200
export const INDICATOR_FADE = 200

/** The fallback for a sync failure with nothing more useful to say. */
export const SYNC_PAUSED = 'Sync paused. Cue will keep trying.'
/** What Sync Now reports while offline. */
export const SYNC_OFFLINE = 'Offline. Changes will sync when you’re back online.'
export const SIGN_IN_FAILED = 'Couldn’t sign in. Try again in a moment.'
export const DELETE_FAILED = 'Couldn’t delete the account. Try again in a moment.'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const changes = (n: number): string => (n === 1 ? '1 change' : `${n} changes`)

/** "Synced just now", "Synced 5 min ago", "Synced 1 hour ago", then "Synced on Oct 17". Rounded down. */
export function syncedAgo(at: number, now: number): string {
  const age = Math.max(0, now - at)
  if (age < MINUTE) return 'Synced just now'
  if (age < HOUR) return `Synced ${Math.floor(age / MINUTE)} min ago`
  if (age < DAY) {
    const hours = Math.floor(age / HOUR)
    return hours === 1 ? 'Synced 1 hour ago' : `Synced ${hours} hours ago`
  }
  const date = new Date(at)
  const day = `${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`
  return `Synced on ${date.getFullYear() === new Date(now).getFullYear() ? day : `${day}, ${date.getFullYear()}`}`
}

/** The line under the account in Settings. */
export function statusLine(state: StatusInput, now: number): string {
  switch (state.status) {
    case 'off':
      return state.message ?? 'Sync is off.'
    case 'offline':
      if (state.downloading) return 'Offline. Your notes will finish downloading when you’re back online.'
      return state.pending ? `Offline. ${changes(state.pending)} will sync when you’re back online.` : 'Offline.'
    case 'error': {
      const message = state.message ?? SYNC_PAUSED
      return state.pending ? `${message} ${changes(state.pending)} waiting to sync.` : message
    }
  }
  if (state.downloading) return 'Getting your notes…'
  if (state.status === 'syncing' || !state.lastSyncedAt) return 'Syncing…'
  return syncedAgo(state.lastSyncedAt, now)
}

/** The quiet label in the title bar (Mac) or header (iPhone). Nothing while sync is healthy. */
export function indicator(state: StatusInput): Indicator | null {
  if (state.needsSignIn) return { label: 'Sign in to sync', delayed: false }
  if (state.status === 'offline') return { label: 'Offline', delayed: false }
  if (state.status === 'error') return { label: 'Sync paused', delayed: false }
  if (state.downloading) return { label: 'Getting your notes…', delayed: false }
  if (state.status === 'syncing') return { label: 'Syncing…', delayed: true }
  return null
}
