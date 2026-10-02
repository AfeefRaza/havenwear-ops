import { addDays } from './dates'

/**
 * Return-stock usage trend: return usage % in the last 7 days vs the previous 7 days,
 * bucketed by batch date.
 */

export interface TrendItem {
  batch_date: string
  qty: number
  status: 'pending' | 'received' | 'cancelled'
  received_from: 'supplier' | 'return' | null
}

export interface WindowStats {
  returns: number
  supplier: number
  pct: number | null
}

export interface ReturnTrend {
  current: WindowStats
  previous: WindowStats
  /** Relative change (0.18 = +18%); null when it cannot be computed. */
  relativeChange: number | null
  direction: 'up' | 'down' | 'flat' | 'none'
  sentence: string
}

function windowStats(items: readonly TrendItem[], from: string, to: string): WindowStats {
  let returns = 0
  let supplier = 0
  for (const it of items) {
    if (it.status !== 'received' || it.batch_date < from || it.batch_date > to) continue
    if (it.received_from === 'return') returns += it.qty
    else if (it.received_from === 'supplier') supplier += it.qty
  }
  const total = returns + supplier
  return { returns, supplier, pct: total > 0 ? returns / total : null }
}

const pctText = (r: number) => `${Math.round(r * 100)}%`

export function returnTrend(items: readonly TrendItem[], today: string): ReturnTrend {
  const current = windowStats(items, addDays(today, -6), today)
  const previous = windowStats(items, addDays(today, -13), addDays(today, -7))

  if (current.pct == null && previous.pct == null) {
    return {
      current, previous, relativeChange: null, direction: 'none',
      sentence: 'Not enough received items in the last 14 days to show a trend yet.',
    }
  }
  if (current.pct == null) {
    return {
      current, previous, relativeChange: null, direction: 'none',
      sentence: 'No items received in the last 7 days yet, so there is nothing to compare.',
    }
  }
  if (previous.pct == null) {
    return {
      current, previous, relativeChange: null, direction: 'none',
      sentence: `Return-stock usage is ${pctText(current.pct)} this week; no received items in the previous 7 days to compare with.`,
    }
  }
  if (previous.pct === 0) {
    if (current.pct === 0) {
      return {
        current, previous, relativeChange: 0, direction: 'flat',
        sentence: 'Return-stock usage is unchanged at 0% compared with the previous 7 days.',
      }
    }
    return {
      current, previous, relativeChange: null, direction: 'up',
      sentence: `Return-stock usage rose from 0% to ${pctText(current.pct)} compared with the previous 7 days.`,
    }
  }

  const rel = (current.pct - previous.pct) / previous.pct
  const relPct = Math.round(Math.abs(rel) * 100)
  if (relPct === 0) {
    return {
      current, previous, relativeChange: 0, direction: 'flat',
      sentence: `Return-stock usage is unchanged at ${pctText(current.pct)} compared with the previous 7 days.`,
    }
  }
  const direction = rel > 0 ? 'up' : 'down'
  return {
    current, previous, relativeChange: rel, direction,
    sentence: `Return-stock usage ${direction === 'up' ? 'increased' : 'decreased'} by ${relPct}% compared with the previous 7 days.`,
  }
}
