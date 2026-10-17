import { describe, expect, it } from 'vitest'
import { parseDateInput } from '../../src/shared/dateParse'
import { weekViewDates } from '../../src/shared/dates'

// Saturday, October 17, 2026
const TODAY = '2026-10-17'
const p = (input: string, prefer: 'future' | 'nearest' = 'future', weekStartsOn: 0 | 1 = 1) =>
  parseDateInput(input, TODAY, { prefer, weekStartsOn })

describe('parseDateInput', () => {
  it('understands relative day words and prefixes', () => {
    expect(p('today')).toBe('2026-10-17')
    expect(p('Tomorrow')).toBe('2026-10-18')
    expect(p('tom')).toBe('2026-10-18')
    expect(p('tmrw')).toBe('2026-10-18')
    expect(p('yesterday')).toBe('2026-10-16')
    expect(p('tod')).toBe('2026-10-17')
  })

  it('resolves bare weekdays to the next occurrence', () => {
    expect(p('friday')).toBe('2026-10-23')
    expect(p('fri')).toBe('2026-10-23')
    expect(p('monday')).toBe('2026-10-19')
    expect(p('saturday')).toBe('2026-10-24') // never today
    expect(p('sunday')).toBe('2026-10-18')
    expect(p('thurs')).toBe('2026-10-22')
  })

  it('handles this / next / last weekday', () => {
    expect(p('next monday')).toBe('2026-10-19')
    expect(p('next friday')).toBe('2026-10-23')
    expect(p('this friday')).toBe('2026-10-16')
    expect(p('last friday')).toBe('2026-10-16')
    expect(p('next week')).toBe('2026-10-19')
    expect(p('next month')).toBe('2026-11-01')
    // Sunday-start weeks: today (Sat) is the last day, so "next monday" is Oct 19.
    expect(p('next monday', 'future', 0)).toBe('2026-10-19')
    expect(p('next sunday', 'future', 0)).toBe('2026-10-18')
  })

  it('parses month/day forms', () => {
    expect(p('October 31')).toBe('2026-10-31')
    expect(p('oct 31st')).toBe('2026-10-31')
    expect(p('31 oct')).toBe('2026-10-31')
    expect(p('October 31, 2027')).toBe('2027-10-31')
    expect(p('march 3')).toBe('2027-03-03')
    expect(p('march 3', 'nearest')).toBe('2027-03-03')
    expect(p('october 1', 'nearest')).toBe('2026-10-01')
    expect(p('october 1')).toBe('2027-10-01')
    expect(p('november')).toBe('2026-11-01')
    expect(p('the 5th')).toBe('2026-11-05')
    expect(p('20th')).toBe('2026-10-20')
  })

  it('parses numeric forms', () => {
    expect(p('2026-10-31')).toBe('2026-10-31')
    expect(p('2026/1/5')).toBe('2026-01-05')
    expect(p('10/31')).toBe('2026-10-31')
    expect(p('10/31/27')).toBe('2027-10-31')
    expect(p('2/30')).toBeNull()
    expect(p('2026-02-30')).toBeNull()
  })

  it('parses offsets', () => {
    expect(p('in 3 days')).toBe('2026-10-20')
    expect(p('3 days')).toBe('2026-10-20')
    expect(p('+2')).toBe('2026-10-19')
    expect(p('+1w')).toBe('2026-10-24')
    expect(p('2 weeks')).toBe('2026-10-31')
    expect(p('in a week')).toBe('2026-10-24')
    expect(p('3 days ago')).toBe('2026-10-14')
    expect(p('in 1 month')).toBe('2026-11-17')
  })

  it('returns null for nonsense', () => {
    expect(p('')).toBeNull()
    expect(p('banana')).toBeNull()
    expect(p('s')).toBeNull()
    expect(p('32nd')).toBeNull()
  })
})

describe('weekViewDates', () => {
  it('shows today through the end of the week, always including tomorrow', () => {
    expect(weekViewDates('2026-10-14', 1)).toEqual([
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18'
    ])
    // Sunday with Monday-start weeks still shows Monday.
    expect(weekViewDates('2026-10-18', 1)).toEqual(['2026-10-18', '2026-10-19'])
    expect(weekViewDates('2026-10-17', 0)).toEqual(['2026-10-17', '2026-10-18'])
  })
})

describe('command phrasing', () => {
  it('ignores leading verbs from the palette', () => {
    expect(p('move to fri')).toBe('2026-10-23')
    expect(p('go to tomorrow')).toBe('2026-10-18')
    expect(p('defer 2 days')).toBe('2026-10-19')
    expect(p('due monday')).toBe('2026-10-19')
    expect(p('today')).toBe('2026-10-17')
  })
})
