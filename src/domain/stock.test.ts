import { describe, expect, it } from 'vitest'
import { stockByCategory, stockStatus, totalStock, type StockItem } from './stock'

const cats = [
  { id: 'hoodie', name: 'Hoodie', low_stock_level: 20, sort_order: 2 },
  { id: 'tee', name: 'T-shirt', low_stock_level: 20, sort_order: 1 },
]
const it_ = (o: Partial<StockItem>): StockItem => ({
  qty: 1, status: 'received', received_from: 'supplier', resolved_category_id: 'tee', ...o,
})

describe('stockStatus', () => {
  it('red below zero, amber at/below low level, green above', () => {
    expect(stockStatus(-1, 20)).toBe('shortage')
    expect(stockStatus(0, 20)).toBe('low')
    expect(stockStatus(20, 20)).toBe('low')
    expect(stockStatus(21, 20)).toBe('ok')
  })
})

describe('stockByCategory', () => {
  it('no data → zero stock for every category, sorted by sort_order', () => {
    const rows = stockByCategory(cats, { adjustments: [], returnLines: [], items: [] })
    expect(rows.map((r) => r.name)).toEqual(['T-shirt', 'Hoodie'])
    expect(rows.every((r) => r.stock === 0 && r.status === 'low')).toBe(true)
  })

  it('applies the formula: adjustments + returns + deliveries − used', () => {
    const rows = stockByCategory(cats, {
      adjustments: [{ category_id: 'tee', qty: 50 }, { category_id: 'tee', qty: -5 }],
      returnLines: [{ category_id: 'tee', qty: 10 }],
      deliveryLines: [{ category_id: 'tee', qty: 2 }, { category_id: 'tee', qty: 4 }],
      items: [
        it_({ qty: 3, received_from: 'supplier' }),
        it_({ qty: 4, received_from: 'return' }),
        it_({ qty: 7, status: 'pending', received_from: null }),
        it_({ qty: 100, status: 'cancelled', received_from: null }),
      ],
    })
    const tee = rows.find((r) => r.categoryId === 'tee')!
    expect(tee.adjustments).toBe(45)
    expect(tee.returnsIn).toBe(10)
    expect(tee.delivered).toBe(6)
    expect(tee.madeBySupplier).toBe(3)
    expect(tee.used).toBe(7)
    expect(tee.usedFromReturns).toBe(4)
    expect(tee.pending).toBe(7) // shown separately, not subtracted
    expect(tee.stock).toBe(45 + 10 + 6 - 7) // supplier delivered 6, only 3 used from supplier → +3 surplus
    expect(tee.status).toBe('ok')
  })

  it('goes negative (shortage) when return stock is over-used', () => {
    const rows = stockByCategory(cats, {
      adjustments: [],
      returnLines: [{ category_id: 'hoodie', qty: 2 }],
      items: [it_({ qty: 5, received_from: 'return', resolved_category_id: 'hoodie' })],
    })
    const h = rows.find((r) => r.categoryId === 'hoodie')!
    expect(h.stock).toBe(-3)
    expect(h.status).toBe('shortage')
    expect(totalStock(rows)).toBe(-3)
  })

  it('supplier pieces used without a logged delivery show as a shortage', () => {
    const rows = stockByCategory(cats, { adjustments: [], returnLines: [], deliveryLines: [], items: [it_({ qty: 4, received_from: 'supplier' })] })
    expect(rows.find((r) => r.categoryId === 'tee')!.stock).toBe(-4)
  })

  it('a delivery that exactly covers supplier items nets to zero', () => {
    const rows = stockByCategory(cats, { adjustments: [], returnLines: [], deliveryLines: [{ category_id: 'tee', qty: 4 }], items: [it_({ qty: 4, received_from: 'supplier' })] })
    expect(rows.find((r) => r.categoryId === 'tee')!.stock).toBe(0)
  })

  it('ignores unmatched items and unknown categories', () => {
    const rows = stockByCategory(cats, {
      adjustments: [{ category_id: 'gone', qty: 5 }],
      returnLines: [],
      deliveryLines: [{ category_id: 'gone', qty: 9 }],
      items: [it_({ resolved_category_id: null }), it_({ resolved_category_id: 'gone' })],
    })
    expect(totalStock(rows)).toBe(0)
  })
})
