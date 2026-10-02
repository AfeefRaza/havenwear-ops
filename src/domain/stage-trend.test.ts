import { describe, expect, it } from 'vitest'
import { batchStage, shouldAutoArchive, stageFromCounts } from './stage'
import { returnTrend, type TrendItem } from './trend'

describe('batchStage', () => {
  const open = { archived_at: null }
  it('no products yet', () => expect(batchStage(open, [])).toBe('empty'))
  it('in progress when any pending', () =>
    expect(batchStage(open, [{ status: 'received' }, { status: 'pending' }])).toBe('in_progress'))
  it('complete when all received/cancelled', () =>
    expect(batchStage(open, [{ status: 'received' }, { status: 'cancelled' }])).toBe('complete'))
  it('all cancelled counts as complete', () =>
    expect(batchStage(open, [{ status: 'cancelled' }])).toBe('complete'))
  it('archived wins over everything', () =>
    expect(batchStage({ archived_at: '2026-01-01T00:00:00Z' }, [{ status: 'pending' }])).toBe('archived'))
  it('stageFromCounts mirrors batchStage', () => {
    expect(stageFromCounts(false, 0, 0)).toBe('empty')
    expect(stageFromCounts(false, 3, 1)).toBe('in_progress')
    expect(stageFromCounts(false, 3, 0)).toBe('complete')
    expect(stageFromCounts(true, 3, 1)).toBe('archived')
  })
})

describe('shouldAutoArchive', () => {
  it('only complete batches older than N days', () => {
    expect(shouldAutoArchive('complete', '2026-09-20T10:00:00Z', 7, '2026-10-02')).toBe(true)
    expect(shouldAutoArchive('complete', '2026-09-30T10:00:00Z', 7, '2026-10-02')).toBe(false)
    expect(shouldAutoArchive('in_progress', '2026-01-01T10:00:00Z', 7, '2026-10-02')).toBe(false)
  })
  it('disabled when days is null/0', () => {
    expect(shouldAutoArchive('complete', '2026-01-01T10:00:00Z', null, '2026-10-02')).toBe(false)
    expect(shouldAutoArchive('complete', '2026-01-01T10:00:00Z', 0, '2026-10-02')).toBe(false)
  })
})

describe('returnTrend', () => {
  const today = '2026-10-02'
  const rec = (batch_date: string, from: 'supplier' | 'return', qty = 1): TrendItem => ({
    batch_date, qty, status: 'received', received_from: from,
  })

  it('no data at all', () => {
    const t = returnTrend([], today)
    expect(t.direction).toBe('none')
    expect(t.relativeChange).toBeNull()
    expect(t.sentence).toMatch(/Not enough/)
  })

  it('increase: 20% → 25% is +25% relative', () => {
    const items = [
      // previous window (Sep 19 – Sep 25): 1 return / 5 → 20%
      rec('2026-09-20', 'return'), rec('2026-09-20', 'supplier', 4),
      // current window (Sep 26 – Oct 2): 1 return / 4 → 25%
      rec('2026-10-01', 'return'), rec('2026-09-26', 'supplier', 3),
    ]
    const t = returnTrend(items, today)
    expect(t.previous.pct).toBeCloseTo(0.2)
    expect(t.current.pct).toBeCloseTo(0.25)
    expect(t.relativeChange).toBeCloseTo(0.25)
    expect(t.sentence).toBe('Return-stock usage increased by 25% compared with the previous 7 days.')
  })

  it('decrease', () => {
    const items = [rec('2026-09-24', 'return', 1), rec('2026-09-24', 'supplier', 1), rec('2026-10-02', 'return', 1), rec('2026-10-02', 'supplier', 3)]
    const t = returnTrend(items, today)
    expect(t.direction).toBe('down')
    expect(t.sentence).toBe('Return-stock usage decreased by 50% compared with the previous 7 days.')
  })

  it('previous week empty', () => {
    const t = returnTrend([rec('2026-10-01', 'return')], today)
    expect(t.relativeChange).toBeNull()
    expect(t.sentence).toMatch(/no received items in the previous 7 days/)
  })

  it('current week empty', () => {
    const t = returnTrend([rec('2026-09-22', 'return')], today)
    expect(t.sentence).toMatch(/No items received in the last 7 days/)
  })

  it('previous 0% → current > 0% avoids dividing by zero', () => {
    const t = returnTrend([rec('2026-09-22', 'supplier'), rec('2026-10-01', 'return')], today)
    expect(t.relativeChange).toBeNull()
    expect(t.direction).toBe('up')
    expect(t.sentence).toBe('Return-stock usage rose from 0% to 100% compared with the previous 7 days.')
  })

  it('unchanged', () => {
    const t = returnTrend([rec('2026-09-22', 'supplier'), rec('2026-10-01', 'supplier')], today)
    expect(t.direction).toBe('flat')
  })

  it('ignores pending/cancelled items and items outside 14 days', () => {
    const items: TrendItem[] = [
      { batch_date: '2026-10-01', qty: 5, status: 'pending', received_from: null },
      { batch_date: '2026-10-01', qty: 5, status: 'cancelled', received_from: null },
      rec('2026-09-01', 'return', 50),
    ]
    expect(returnTrend(items, today).direction).toBe('none')
  })
})
