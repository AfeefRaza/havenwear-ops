import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, inRange, periodRange, todayISO, weekStart } from './dates'
import { formatDate, formatPKR, formatPct } from './format'

describe('format', () => {
  it('formatPKR', () => {
    expect(formatPKR(1400)).toBe('PKR 1,400')
    expect(formatPKR(1234567.6)).toBe('PKR 1,234,568')
    expect(formatPKR(0)).toBe('PKR 0')
    expect(formatPKR(-200)).toBe('-PKR 200')
    expect(formatPKR(null)).toBe('—')
    expect(formatPKR(NaN)).toBe('—')
  })
  it('formatDate', () => {
    expect(formatDate('2026-09-10')).toBe('10-Sep-26')
    expect(formatDate('2026-01-01T10:00:00Z')).toBe('01-Jan-26')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('garbage')).toBe('—')
  })
  it('formatPct', () => {
    expect(formatPct(0.25)).toBe('25%')
    expect(formatPct(0.4567)).toBe('45.7%')
    expect(formatPct(null)).toBe('—')
  })
})

describe('dates', () => {
  it('todayISO uses Pakistan time (UTC+5)', () => {
    // 20:30 UTC on 1 Oct is 01:30 on 2 Oct in Karachi
    expect(todayISO(new Date('2026-10-01T20:30:00Z'))).toBe('2026-10-02')
    expect(todayISO(new Date('2026-10-01T18:59:00Z'))).toBe('2026-10-01')
  })
  it('addDays / daysBetween across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-09-25', '2026-10-02')).toBe(7)
  })
  it('periodRange', () => {
    expect(periodRange('today', '2026-10-02')).toEqual({ from: '2026-10-02', to: '2026-10-02' })
    expect(periodRange('7d', '2026-10-02')).toEqual({ from: '2026-09-26', to: '2026-10-02' })
    expect(periodRange('month', '2026-10-02')).toEqual({ from: '2026-10-01', to: '2026-10-02' })
    expect(periodRange('all', '2026-10-02')).toBeNull()
  })
  it('inRange', () => {
    expect(inRange('2026-09-30', { from: '2026-09-26', to: '2026-10-02' })).toBe(true)
    expect(inRange('2026-09-25', { from: '2026-09-26', to: '2026-10-02' })).toBe(false)
    expect(inRange('1999-01-01', null)).toBe(true)
  })
  it('weekStart is Monday', () => {
    expect(weekStart('2026-10-02')).toBe('2026-09-28') // Friday → Monday
    expect(weekStart('2026-09-28')).toBe('2026-09-28')
    expect(weekStart('2026-10-04')).toBe('2026-09-28') // Sunday
  })
})
