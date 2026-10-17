import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  makeISODate,
  MONTHS,
  parts,
  startOfWeek,
  weekday,
  WEEKDAYS
} from './dates'
import type { ISODate } from './types'

/**
 * Deterministic natural-language date parsing for "Go to date" and "Move to date".
 *
 * Supported (case-insensitive):
 *   today · tomorrow · yesterday (and prefixes/abbreviations: "tod", "tom", "tmrw")
 *   friday · fri · this friday · next friday · last friday
 *   next week · next month · last week · weekend
 *   in 3 days · 3 days · 2 weeks · in 1 month · +3 · +2w · 3 days ago · -2
 *   october 31 · oct 31st · 31 oct · october 31, 2026 · the 5th · 5th · november
 *   2026-10-31 · 2026/10/31 · 10/31 · 10/31/26 · 10/31/2026 (month first)
 *
 * Bare weekday names mean the next occurrence after today. "next <weekday>" means
 * that weekday in the following calendar week. Dates without a year resolve to the
 * upcoming occurrence (prefer "future") or the closest one (prefer "nearest").
 */

export interface ParseOptions {
  weekStartsOn?: 0 | 1
  /** How to resolve dates without a year. Defaults to "future". */
  prefer?: 'future' | 'nearest'
}

const DAY_WORDS: Array<[string, number]> = [
  ['today', 0],
  ['tomorrow', 1],
  ['yesterday', -1]
]

const DAY_ALIASES: Record<string, number> = {
  now: 0,
  tod: 0,
  tdy: 0,
  tmr: 1,
  tmrw: 1,
  tmw: 1,
  tom: 1,
  tomo: 1,
  yday: -1,
  yest: -1
}

const WEEKDAY_ALIASES: Record<string, number> = {
  weds: 3,
  thur: 4,
  thurs: 4,
  tues: 2
}

const MONTH_ALIASES: Record<string, number> = { sept: 9 }

function matchWeekday(token: string): number | null {
  if (token in WEEKDAY_ALIASES) return WEEKDAY_ALIASES[token]
  if (token.length < 2 && !['m', 'w', 'f'].includes(token)) return null
  // Monday-first priority so "s" never silently picks Sunday over Saturday etc.
  const order = [1, 2, 3, 4, 5, 6, 0]
  for (const index of order) {
    if (WEEKDAYS[index].toLowerCase().startsWith(token)) return index
  }
  return null
}

function matchMonth(token: string): number | null {
  if (token in MONTH_ALIASES) return MONTH_ALIASES[token]
  if (token.length < 3) return null
  const index = MONTHS.findIndex((m) => m.toLowerCase().startsWith(token))
  return index === -1 ? null : index + 1
}

function matchDayWord(token: string): number | null {
  if (token in DAY_ALIASES) return DAY_ALIASES[token]
  if (!token) return null
  for (const [word, offset] of DAY_WORDS) {
    if (word.startsWith(token)) return offset
  }
  return null
}

function ordinal(token: string): number | null {
  const m = /^(\d{1,2})(st|nd|rd|th)?$/.exec(token)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 31 ? n : null
}

function expandYear(token: string): number | null {
  if (!/^\d{2}(\d{2})?$/.test(token)) return null
  const n = Number(token)
  return token.length === 2 ? 2000 + n : n
}

function validDate(year: number, month: number, day: number): ISODate | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return makeISODate(year, month, day)
}

/** Resolve a month/day without a year relative to `today`. */
function resolveYearless(month: number, day: number, today: ISODate, prefer: 'future' | 'nearest'): ISODate | null {
  const { year } = parts(today)
  if (prefer === 'future') {
    const thisYear = validDate(year, month, day)
    if (thisYear && thisYear >= today) return thisYear
    // Feb 29 may only exist in some years; search forward a few years.
    for (let y = year + 1; y <= year + 8; y++) {
      const d = validDate(y, month, day)
      if (d) return d
    }
    return null
  }
  const candidates = [year - 1, year, year + 1]
    .map((y) => validDate(y, month, day))
    .filter((d): d is ISODate => d !== null)
  if (!candidates.length) return null
  candidates.sort((a, b) => {
    const da = Math.abs(diffDays(today, a))
    const db = Math.abs(diffDays(today, b))
    return da - db || (a > b ? -1 : 1)
  })
  return candidates[0]
}

/** Resolve a day of month without month/year: this month if still ahead, else next. */
function resolveDayOfMonth(day: number, today: ISODate, prefer: 'future' | 'nearest'): ISODate | null {
  const { year, month } = parts(today)
  const here = validDate(year, month, day)
  if (prefer === 'nearest' && here) return here
  if (here && here >= today) return here
  for (let i = 1; i <= 12; i++) {
    const next = addMonths(makeISODate(year, month, 1), i)
    const p = parts(next)
    const d = validDate(p.year, p.month, day)
    if (d) return d
  }
  return null
}

const UNIT_RE = /^(d|day|days|w|wk|wks|week|weeks|m|mo|mos|month|months|y|yr|yrs|year|years)$/

function applyUnit(today: ISODate, amount: number, unit: string): ISODate {
  if (unit.startsWith('d')) return addDays(today, amount)
  if (unit.startsWith('w')) return addDays(today, amount * 7)
  if (unit.startsWith('y')) return addMonths(today, amount * 12)
  return addMonths(today, amount)
}

export function parseDateInput(input: string, today: ISODate, options: ParseOptions = {}): ISODate | null {
  const weekStartsOn = options.weekStartsOn ?? 1
  const prefer = options.prefer ?? 'future'

  let text = input
    .toLowerCase()
    .replace(/[,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  text = text.replace(/^(?:go|goto|move|mv|defer|push|jump|reschedule) /, '').replace(/^(?:to|on|for|due|until) /, '')
  if (!text) return null

  // ISO 2026-10-31 or 2026/10/31
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text)
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]))

  // US numeric 10/31, 10/31/26, 10/31/2026
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(text)
  if (m) {
    const month = Number(m[1])
    const day = Number(m[2])
    if (m[3]) return validDate(expandYear(m[3])!, month, day)
    return resolveYearless(month, day, today, prefer)
  }

  // Relative offsets: +3, -2, +2w, 3d
  m = /^([+-])\s?(\d{1,4})\s?([a-z]*)$/.exec(text)
  if (m) {
    const amount = Number(m[2]) * (m[1] === '-' ? -1 : 1)
    const unit = m[3] || 'd'
    if (!UNIT_RE.test(unit)) return null
    return applyUnit(today, amount, unit)
  }

  // in 3 days · 3 days · 2 weeks from now · 3 days ago
  m = /^(?:in )?(\d{1,4}|a|an|one|two|three|four|five|six|seven)\s?([a-z]+)(?: (from now|later|ago))?$/.exec(text)
  if (m && UNIT_RE.test(m[2])) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }
    const amount = (m[1] in words ? words[m[1]] : Number(m[1])) * (m[3] === 'ago' ? -1 : 1)
    return applyUnit(today, amount, m[2])
  }

  const tokens = text.split(' ')

  if (tokens.length === 1) {
    const token = tokens[0]
    const offset = matchDayWord(token)
    if (offset !== null) return addDays(today, offset)
    const wd = matchWeekday(token)
    if (wd !== null) {
      const delta = (wd - weekday(today) + 7) % 7 || 7
      return addDays(today, delta)
    }
    if (token === 'weekend') return upcomingWeekend(today)
    const month = matchMonth(token)
    if (month !== null) return resolveYearless(month, 1, today, prefer)
    const day = ordinal(token)
    if (day !== null) return resolveDayOfMonth(day, today, prefer)
    return null
  }

  const [first, second, ...rest] = tokens

  if (tokens.length === 2 && first === 'the') {
    const day = ordinal(second)
    return day === null ? null : resolveDayOfMonth(day, today, prefer)
  }

  if (tokens.length === 2 && (first === 'this' || first === 'next' || first === 'last' || first === 'previous')) {
    if (second === 'week') {
      if (first === 'this') return today
      return addDays(startOfWeek(today, weekStartsOn), first === 'next' ? 7 : -7)
    }
    if (second === 'month') {
      if (first === 'this') return today
      return addMonths(makeISODate(parts(today).year, parts(today).month, 1), first === 'next' ? 1 : -1)
    }
    if (second === 'weekend') {
      const upcoming = upcomingWeekend(today)
      if (first === 'this') return upcoming
      return addDays(upcoming, first === 'next' ? 7 : -7)
    }
    if (second === 'year') {
      const { year } = parts(today)
      if (first === 'this') return today
      return makeISODate(year + (first === 'next' ? 1 : -1), 1, 1)
    }
    const wd = matchWeekday(second)
    if (wd === null) return null
    const weekStart = startOfWeek(today, weekStartsOn)
    const indexInWeek = (wd - weekStartsOn + 7) % 7
    if (first === 'this') return addDays(weekStart, indexInWeek)
    if (first === 'next') return addDays(weekStart, 7 + indexInWeek)
    const delta = (weekday(today) - wd + 7) % 7 || 7
    return addDays(today, -delta)
  }

  // "october 31", "oct 31st 2026", "october 2026"
  const monthFirst = matchMonth(first)
  if (monthFirst !== null && tokens.length <= 3) {
    const day = ordinal(second)
    if (day !== null) {
      if (rest.length === 1) {
        const year = expandYear(rest[0])
        return year === null ? null : validDate(year, monthFirst, day)
      }
      return resolveYearless(monthFirst, day, today, prefer)
    }
    const year = tokens.length === 2 ? expandYear(second) : null
    if (year !== null && second.length === 4) return validDate(year, monthFirst, 1)
    return null
  }

  // "31 october", "31st oct 2026"
  const dayFirst = ordinal(first)
  if (dayFirst !== null && tokens.length <= 3) {
    const month = matchMonth(second)
    if (month === null) return null
    if (rest.length === 1) {
      const year = expandYear(rest[0])
      return year === null ? null : validDate(year, month, dayFirst)
    }
    return resolveYearless(month, dayFirst, today, prefer)
  }

  return null
}

function upcomingWeekend(today: ISODate): ISODate {
  const wd = weekday(today)
  if (wd === 6 || wd === 0) return today
  return addDays(today, 6 - wd)
}
