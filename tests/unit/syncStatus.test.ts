import { describe, expect, it } from 'vitest'
import { indicator, statusLine, syncedAgo, type StatusInput } from '../../core/sync/status'

const NOW = new Date(2026, 9, 18, 15, 0).getTime()
const ago = (ms: number): number => NOW - ms
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

const state = (patch: Partial<StatusInput>): StatusInput => ({ status: 'idle', lastSyncedAt: ago(5 * SECOND), pending: 0, message: null, ...patch })

describe('sync status words', () => {
  it('says when it last synced, rounded down', () => {
    expect(syncedAgo(ago(45 * SECOND), NOW)).toBe('Synced just now')
    expect(syncedAgo(ago(59 * SECOND), NOW)).toBe('Synced just now')
    expect(syncedAgo(ago(60 * SECOND), NOW)).toBe('Synced 1 min ago')
    expect(syncedAgo(ago(59 * MINUTE + 59 * SECOND), NOW)).toBe('Synced 59 min ago')
    expect(syncedAgo(ago(61 * MINUTE), NOW)).toBe('Synced 1 hour ago')
    expect(syncedAgo(ago(5 * HOUR + 59 * MINUTE), NOW)).toBe('Synced 5 hours ago')
    expect(syncedAgo(new Date(2026, 9, 17, 9, 30).getTime(), NOW)).toBe('Synced on Oct 17')
    expect(syncedAgo(new Date(2025, 11, 31, 9, 30).getTime(), NOW)).toBe('Synced on Dec 31, 2025')
  })

  it('reads the same sentence on Mac and iPhone', () => {
    const lines: Array<[Partial<StatusInput>, string]> = [
      [{ status: 'offline', pending: 2 }, 'Offline. 2 changes will sync when you’re back online.'],
      [{ status: 'offline', pending: 1 }, 'Offline. 1 change will sync when you’re back online.'],
      [{ status: 'offline' }, 'Offline.'],
      [{ status: 'offline', downloading: true, lastSyncedAt: null }, 'Offline. Your notes will finish downloading when you’re back online.'],
      [{ status: 'error' }, 'Sync paused. Cue will keep trying.'],
      [{ status: 'error', pending: 3 }, 'Sync paused. Cue will keep trying. 3 changes waiting to sync.'],
      [{ status: 'error', message: 'The sync server isn’t responding. Cue will keep trying.', pending: 1 }, 'The sync server isn’t responding. Cue will keep trying. 1 change waiting to sync.'],
      [{ status: 'syncing', downloading: true, lastSyncedAt: null }, 'Getting your notes…'],
      [{ status: 'syncing' }, 'Syncing…'],
      [{ status: 'idle', lastSyncedAt: null }, 'Syncing…'],
      [{ status: 'idle', lastSyncedAt: ago(45 * SECOND) }, 'Synced just now'],
      [{ status: 'idle', lastSyncedAt: ago(61 * MINUTE) }, 'Synced 1 hour ago']
    ]
    for (const [patch, line] of lines) expect(statusLine(state(patch), NOW)).toBe(line)
  })

  it('shows a quiet label only when sync needs a word', () => {
    expect(indicator(state({ status: 'idle' }))).toBeNull()
    expect(indicator(state({ status: 'syncing' }))).toEqual({ label: 'Syncing…', delayed: true })
    expect(indicator(state({ status: 'syncing', downloading: true }))).toEqual({ label: 'Getting your notes…', delayed: false })
    // Offline and paused come before the first download.
    expect(indicator(state({ status: 'offline', downloading: true }))?.label).toBe('Offline')
    expect(indicator(state({ status: 'error', downloading: true }))?.label).toBe('Sync paused')
    expect(indicator(state({ status: 'off', needsSignIn: true, message: 'Your sync session ended. Sign in again to keep syncing.' }))?.label).toBe('Sign in to sync')
    expect(indicator(state({ status: 'off' }))).toBeNull()
  })
})
