/**
 * Stock per category:
 *   Opening/adjustments + Returns received + Made by supplier − Used (received items)
 * Pending pieces are reported separately and NOT subtracted.
 * Status: red (shortage) < 0, amber (low) ≤ low_stock_level, green above.
 */

export type StockStatus = 'shortage' | 'low' | 'ok'

export interface StockCategory {
  id: string
  name: string
  low_stock_level: number
  sort_order: number
}

export interface StockItem {
  qty: number
  status: 'pending' | 'received' | 'cancelled'
  received_from: 'supplier' | 'return' | null
  resolved_category_id: string | null
}

export interface StockInputs {
  adjustments: readonly { category_id: string; qty: number }[]
  returnLines: readonly { category_id: string; qty: number }[]
  items: readonly StockItem[]
}

export interface CategoryStock {
  categoryId: string
  name: string
  lowStockLevel: number
  adjustments: number
  returnsIn: number
  madeBySupplier: number
  used: number
  usedFromReturns: number
  pending: number
  stock: number
  status: StockStatus
}

export function stockStatus(stock: number, lowLevel: number): StockStatus {
  if (stock < 0) return 'shortage'
  if (stock <= lowLevel) return 'low'
  return 'ok'
}

export function stockByCategory(categories: readonly StockCategory[], input: StockInputs): CategoryStock[] {
  const rows = new Map<string, CategoryStock>()
  for (const c of [...categories].sort((a, b) => a.sort_order - b.sort_order)) {
    rows.set(c.id, {
      categoryId: c.id,
      name: c.name,
      lowStockLevel: c.low_stock_level,
      adjustments: 0,
      returnsIn: 0,
      madeBySupplier: 0,
      used: 0,
      usedFromReturns: 0,
      pending: 0,
      stock: 0,
      status: 'ok',
    })
  }
  for (const a of input.adjustments) {
    const r = rows.get(a.category_id)
    if (r) r.adjustments += a.qty
  }
  for (const l of input.returnLines) {
    const r = rows.get(l.category_id)
    if (r) r.returnsIn += l.qty
  }
  for (const it of input.items) {
    if (!it.resolved_category_id || it.status === 'cancelled') continue
    const r = rows.get(it.resolved_category_id)
    if (!r) continue
    if (it.status === 'pending') {
      r.pending += it.qty
    } else {
      r.used += it.qty
      if (it.received_from === 'supplier') r.madeBySupplier += it.qty
      else if (it.received_from === 'return') r.usedFromReturns += it.qty
    }
  }
  for (const r of rows.values()) {
    r.stock = r.adjustments + r.returnsIn + r.madeBySupplier - r.used
    r.status = stockStatus(r.stock, r.lowStockLevel)
  }
  return [...rows.values()]
}

export function totalStock(rows: readonly CategoryStock[]): number {
  return rows.reduce((s, r) => s + r.stock, 0)
}
