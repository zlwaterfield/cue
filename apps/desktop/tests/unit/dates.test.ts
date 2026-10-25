import { describe, expect, it } from 'vitest'
import { daySubtitle, relativeLabel } from '@shared/dates'

// Saturday, October 17, 2026
const TODAY = '2026-10-17'

describe('relativeLabel', () => {
  it('names the nearest days', () => {
    expect(relativeLabel('2026-10-17', TODAY)).toBe('today')
    expect(relativeLabel('2026-10-18', TODAY)).toBe('tomorrow')
    expect(relativeLabel('2026-10-16', TODAY)).toBe('yesterday')
  })

  it('counts days, then weeks, then months', () => {
    expect(relativeLabel('2026-10-19', TODAY)).toBe('in 2 days')
    expect(relativeLabel('2026-10-30', TODAY)).toBe('in 13 days')
    expect(relativeLabel('2026-10-31', TODAY)).toBe('in 2 weeks')
    expect(relativeLabel('2026-12-14', TODAY)).toBe('in 8 weeks')
    expect(relativeLabel('2026-12-16', TODAY)).toBe('in 2 months')
    expect(relativeLabel('2026-10-10', TODAY)).toBe('7 days ago')
    expect(relativeLabel('2026-09-26', TODAY)).toBe('3 weeks ago')
    expect(relativeLabel('2026-06-17', TODAY)).toBe('4 months ago')
  })

  it('counts across a year boundary', () => {
    expect(relativeLabel('2027-01-01', '2026-12-31')).toBe('tomorrow')
    expect(relativeLabel('2026-12-29', '2027-01-02')).toBe('4 days ago')
  })
})

describe('daySubtitle', () => {
  it('gives today, tomorrow and yesterday their weekday and date, without this year', () => {
    expect(daySubtitle('2026-10-17', TODAY)).toBe('Saturday, October 17')
    expect(daySubtitle('2026-10-18', TODAY)).toBe('Sunday, October 18')
    expect(daySubtitle('2026-10-16', TODAY)).toBe('Friday, October 16')
  })

  it('gives other days (titled by weekday) only the date within a week', () => {
    expect(daySubtitle('2026-10-20', TODAY)).toBe('October 20')
    expect(daySubtitle('2026-10-11', TODAY)).toBe('October 11')
  })

  it('says how far away a day is beyond a week', () => {
    expect(daySubtitle('2026-10-30', TODAY)).toBe('October 30 · in 13 days')
    expect(daySubtitle('2026-10-10', TODAY)).toBe('October 10 · 7 days ago')
  })

  it('shows the year only when it isn’t this year', () => {
    expect(daySubtitle('2027-01-01', '2026-12-31')).toBe('Friday, January 1, 2027')
    expect(daySubtitle('2025-10-17', TODAY)).toBe('October 17, 2025 · 12 months ago')
    expect(daySubtitle('2026-12-31', TODAY)).toBe('December 31 · in 3 months')
  })
})
