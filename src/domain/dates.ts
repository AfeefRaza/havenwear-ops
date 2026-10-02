/** Date helpers. All business dates are ISO `YYYY-MM-DD` strings in Pakistan time (Asia/Karachi). */

export const TIMEZONE = 'Asia/Karachi'

export type Period = 'today' | '7d' | 'month' | 'all'
export const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
]

/** Today's date in Asia/Karachi as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function toUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

export function addDays(iso: string, days: number): string {
  const dt = toUTC(iso)
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/** Whole days from a → b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000)
}

export interface DateRange {
  from: string
  to: string
}

/** Inclusive date range for a period, or null for All time. */
export function periodRange(period: Period, today: string): DateRange | null {
  switch (period) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case 'month':
      return { from: today.slice(0, 8) + '01', to: today }
    case 'all':
      return null
  }
}

export function inRange(date: string, range: DateRange | null): boolean {
  return !range || (date >= range.from && date <= range.to)
}

/** Monday-based ISO week start for a date. */
export function weekStart(iso: string): string {
  const dow = toUTC(iso).getUTCDay() // 0 = Sun
  return addDays(iso, -((dow + 6) % 7))
}

/** Converts a JS Date / timestamp string to a Karachi calendar date. */
export function isoDateOf(timestamp: string | Date): string {
  return todayISO(typeof timestamp === 'string' ? new Date(timestamp) : timestamp)
}
