import { describe, expect, it } from 'vitest'
import { billVariance, computeTotals, usageRatios, type TotalsItem } from './totals'

const item = (o: Partial<TotalsItem>): TotalsItem => ({
  qty: 1, status: 'pending', received_from: null, unit_cost_pkr: 0, ...o,
})

describe('computeTotals', () => {
  it('no data → zeros and null ratios', () => {
    const t = computeTotals([])
    expect(t).toMatchObject({ lines: 0, required: 0, fromReturns: 0, fromSupplier: 0, estSupplierCost: 0 })
    expect(t.returnPct).toBeNull()
    expect(t.supplierPct).toBeNull()
    expect(t.avgSupplierCost).toBeNull()
  })

  it('all cancelled → only the line count is non-zero', () => {
    const t = computeTotals([item({ status: 'cancelled', qty: 3 }), item({ status: 'cancelled' })])
    expect(t.lines).toBe(2)
    expect(t.cancelledLines).toBe(2)
    expect(t.required).toBe(0)
    expect(t.pendingPieces).toBe(0)
    expect(t.returnPct).toBeNull()
  })

  it('computes pieces, cost and percentages', () => {
    const t = computeTotals([
      item({ qty: 2, status: 'received', received_from: 'supplier', unit_cost_pkr: 850 }),
      item({ qty: 1, status: 'received', received_from: 'supplier', unit_cost_pkr: 1400 }),
      item({ qty: 1, status: 'received', received_from: 'return', unit_cost_pkr: 850 }),
      item({ qty: 4, status: 'pending', unit_cost_pkr: 850 }),
      item({ qty: 9, status: 'cancelled', received_from: null, unit_cost_pkr: 850 }),
    ])
    expect(t.lines).toBe(5)
    expect(t.required).toBe(8)
    expect(t.pendingLines).toBe(1)
    expect(t.pendingPieces).toBe(4)
    expect(t.fromSupplier).toBe(3)
    expect(t.fromReturns).toBe(1)
    expect(t.estSupplierCost).toBe(2 * 850 + 1400)
    expect(t.returnPct).toBeCloseTo(0.25)
    expect(t.supplierPct).toBeCloseTo(0.75)
    expect(t.avgSupplierCost).toBeCloseTo(3100 / 3)
  })

  it('return-only batches have no average supplier cost', () => {
    const t = computeTotals([item({ status: 'received', received_from: 'return' })])
    expect(t.returnPct).toBe(1)
    expect(t.avgSupplierCost).toBeNull()
  })
})

describe('billVariance', () => {
  it('null when no bill', () => expect(billVariance(null, 100)).toBeNull())
  it('positive when billed more than estimate', () => expect(billVariance(1200, 1000)).toBe(200))
})

describe('usageRatios', () => {
  it('matches computeTotals for the same sums', () => {
    expect(usageRatios(1, 3, 3100)).toEqual({ receivedPieces: 4, returnPct: 0.25, supplierPct: 0.75, avgSupplierCost: 3100 / 3 })
  })
  it('zero received → nulls', () => {
    expect(usageRatios(0, 0, 0)).toEqual({ receivedPieces: 0, returnPct: null, supplierPct: null, avgSupplierCost: null })
  })
})
