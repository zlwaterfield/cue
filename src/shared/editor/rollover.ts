import type { ISODate } from '../types'

/**
 * Midnight while the iPhone app stays open. (The Mac waits for a minute without typing
 * before changing anything, because its week would rearrange around the line being
 * typed; then its day view follows the same way.) Tested in rollover.test.ts.
 */

export interface DayState {
  /** The day the app treats as today. */
  today: ISODate
  /** The day on screen. */
  page: ISODate
  /** The old today's page, waiting for nothing to be written so it can follow. */
  following: ISODate | null
}

/**
 * One look at the clock. "Today" moves on at once (titles, the Today pill). A page that
 * was showing the old today follows to the new one, but only once nothing is being
 * written, so the page never moves out from under an edit and a line typed across
 * midnight stays on the day it was started. A page the user moved to is left alone.
 */
export function rollover(state: DayState, clock: ISODate, writing: boolean): DayState {
  let { today, following } = state
  const { page } = state
  if (clock !== today) {
    if (page === today) following = today
    today = clock
  }
  if (following !== page) following = null
  if (following && !writing) return { today, page: today, following: null }
  return { today, page, following }
}
