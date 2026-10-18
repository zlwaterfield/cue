import type { ISODate } from './types'

/**
 * Calendar-date helpers operating on ISO `YYYY-MM-DD` strings.
 *
 * All arithmetic happens in UTC on date-only values so daylight-saving transitions
 * can never shift a day. "Today" is read from the local clock.
 */

const DAY_MS = 86_400_000
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}

export function makeISODate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function todayISO(now: Date = new Date()): ISODate {
  return makeISODate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function parts(date: ISODate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day }
}

function toUTC(date: ISODate): number {
  const { year, month, day } = parts(date)
  return Date.UTC(year, month - 1, day)
}

function fromUTC(ms: number): ISODate {
  const d = new Date(ms)
  return makeISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(toUTC(date) + days * DAY_MS)
}

export function addMonths(date: ISODate, months: number): ISODate {
  const { year, month, day } = parts(date)
  const total = year * 12 + (month - 1) + months
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return makeISODate(y, m, Math.min(day, daysInMonth(y, m)))
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: ISODate): number {
  return new Date(toUTC(date)).getUTCDay()
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function startOfWeek(date: ISODate, weekStartsOn: 0 | 1): ISODate {
  const offset = (weekday(date) - weekStartsOn + 7) % 7
  return addDays(date, -offset)
}

export function endOfWeek(date: ISODate, weekStartsOn: 0 | 1): ISODate {
  return addDays(startOfWeek(date, weekStartsOn), 6)
}

export function startOfMonth(date: ISODate): ISODate {
  const { year, month } = parts(date)
  return makeISODate(year, month, 1)
}

export function isWeekend(date: ISODate): boolean {
  const w = weekday(date)
  return w === 0 || w === 6
}

/** The next Monday–Friday strictly after `date`. */
export function nextWeekday(date: ISODate): ISODate {
  let d = addDays(date, 1)
  while (isWeekend(d)) d = addDays(d, 1)
  return d
}

export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/**
 * The days shown in the week view: today through the end of the current week,
 * always including tomorrow (so Sunday still shows Monday).
 */
export function weekViewDates(today: ISODate, weekStartsOn: 0 | 1): ISODate[] {
  const end = endOfWeek(today, weekStartsOn)
  const last = end > today ? end : addDays(today, 1)
  return dateRange(today, last)
}

/* ------------------------------------------------------------------ Labels */

/** "Today", "Tomorrow", "Yesterday", or the weekday name. */
export function relativeDayName(date: ISODate, today: ISODate): string {
  const delta = diffDays(today, date)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  if (delta === -1) return 'Yesterday'
  return WEEKDAYS[weekday(date)]
}

/** "October 17" — with the year when it differs from today's. */
export function monthDay(date: ISODate, today?: ISODate): string {
  const { year, month, day } = parts(date)
  const base = `${MONTHS[month - 1]} ${day}`
  return today && parts(today).year !== year ? `${base}, ${year}` : base
}

/** "Sat, Oct 17" — with the year when it differs from today's. */
export function shortDate(date: ISODate, today?: ISODate): string {
  const { year, month, day } = parts(date)
  const base = `${WEEKDAYS[weekday(date)].slice(0, 3)}, ${MONTHS[month - 1].slice(0, 3)} ${day}`
  return today && parts(today).year !== year ? `${base}, ${year}` : base
}

/** "Saturday, October 17, 2026". */
export function longDate(date: ISODate): string {
  const { year, month, day } = parts(date)
  return `${WEEKDAYS[weekday(date)]}, ${MONTHS[month - 1]} ${day}, ${year}`
}

/**
 * The line under a day's title (`relativeDayName`). Today, Tomorrow and Yesterday get
 * their weekday and date: "Saturday, October 17". Other days are titled by weekday, so
 * this is the date, plus how far away it is beyond a week: "October 30 · in 13 days".
 * The year shows only when it isn't today's.
 */
export function daySubtitle(date: ISODate, today: ISODate): string {
  const delta = diffDays(today, date)
  if (Math.abs(delta) <= 1) return `${WEEKDAYS[weekday(date)]}, ${monthDay(date, today)}`
  if (Math.abs(delta) < 7) return monthDay(date, today)
  return `${monthDay(date, today)} · ${relativeLabel(date, today)}`
}

/** How far a date is from today: "today", "tomorrow", "in 3 days", "2 weeks ago", "in 4 months". */
export function relativeLabel(date: ISODate, today: ISODate): string {
  const d = diffDays(today, date)
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d === -1) return 'yesterday'
  if (d > 0) return d < 14 ? `in ${d} days` : d < 60 ? `in ${Math.round(d / 7)} weeks` : `in ${Math.round(d / 30)} months`
  return -d < 14 ? `${-d} days ago` : -d < 60 ? `${Math.round(-d / 7)} weeks ago` : `${Math.round(-d / 30)} months ago`
}

/** Compact label for lists: "Today", "Tomorrow", "Yesterday", "Fri, Oct 23", "Mar 3, 2025". */
export function friendlyDate(date: ISODate, today: ISODate): string {
  const delta = diffDays(today, date)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  if (delta === -1) return 'Yesterday'
  const { year, month, day } = parts(date)
  if (parts(today).year !== year) return `${MONTHS[month - 1].slice(0, 3)} ${day}, ${year}`
  return shortDate(date)
}
