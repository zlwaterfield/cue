import { describe, expect, it } from 'vitest'
import { rollover, type DayState } from '@shared/editor/rollover'

const OLD = '2026-10-17'
const NEW = '2026-10-18'
const LATER = '2026-10-19'

describe('rollover (midnight while the app is open)', () => {
  const onToday: DayState = { today: OLD, page: OLD, following: null }

  it('does nothing before midnight', () => {
    expect(rollover(onToday, OLD, false)).toEqual(onToday)
  })

  it('moves an idle page on the old today to the new today', () => {
    expect(rollover(onToday, NEW, false)).toEqual({ today: NEW, page: NEW, following: null })
  })

  it('keeps the page under an edit, titled yesterday, and follows once writing stops', () => {
    const typing = rollover(onToday, NEW, true)
    expect(typing).toEqual({ today: NEW, page: OLD, following: OLD })
    expect(rollover(typing, NEW, true)).toEqual(typing)
    expect(rollover(typing, NEW, false)).toEqual({ today: NEW, page: NEW, following: null })
  })

  it('leaves a page the user chose alone', () => {
    const elsewhere = { today: OLD, page: '2026-10-20', following: null }
    expect(rollover(elsewhere, NEW, false)).toEqual({ ...elsewhere, today: NEW })
    // Moved away while waiting to follow: stays where it is.
    const waiting = rollover(onToday, NEW, true)
    expect(rollover({ ...waiting, page: '2026-10-10' }, NEW, false)).toEqual({ today: NEW, page: '2026-10-10', following: null })
  })

  it('catches up across more than one midnight', () => {
    const typing = rollover(onToday, NEW, true)
    expect(rollover(typing, LATER, false)).toEqual({ today: LATER, page: LATER, following: null })
  })
})
