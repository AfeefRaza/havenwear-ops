/**
 * Piece and cost totals. Cancelled items are excluded from everything except the line count.
 */

export interface TotalsItem {
  qty: number
  status: 'pending' | 'received' | 'cancelled'
  received_from: 'supplier' | 'return' | null
  unit_cost_pkr: number
}

export interface Totals {
  lines: number
  activeLines: number
  cancelledLines: number
  pendingLines: number
  required: number
  pendingPieces: number
  receivedPieces: number
  fromReturns: number
  fromSupplier: number
  estSupplierCost: number
  /** returns ÷ (returns + supplier); null when nothing has been received. */
  returnPct: number | null
  supplierPct: number | null
  /** est. supplier cost ÷ supplier pieces; null when no supplier pieces. */
  avgSupplierCost: number | null
}

export function computeTotals(items: readonly TotalsItem[]): Totals {
  let cancelledLines = 0
  let pendingLines = 0
  let required = 0
  let pendingPieces = 0
  let fromReturns = 0
  let fromSupplier = 0
  let estSupplierCost = 0

  for (const it of items) {
    if (it.status === 'cancelled') {
      cancelledLines++
      continue
    }
    const q = Math.max(0, it.qty)
    required += q
    if (it.status === 'pending') {
      pendingLines++
      pendingPieces += q
    } else if (it.received_from === 'return') {
      fromReturns += q
    } else if (it.received_from === 'supplier') {
      fromSupplier += q
      estSupplierCost += q * it.unit_cost_pkr
    }
  }

  return {
    lines: items.length,
    activeLines: items.length - cancelledLines,
    cancelledLines,
    pendingLines,
    required,
    pendingPieces,
    fromReturns,
    fromSupplier,
    estSupplierCost,
    ...usageRatios(fromReturns, fromSupplier, estSupplierCost),
  }
}

/** Shared by batch totals and the dashboard (which receives pre-aggregated sums from Postgres). */
export function usageRatios(fromReturns: number, fromSupplier: number, estSupplierCost: number) {
  const received = fromReturns + fromSupplier
  return {
    receivedPieces: received,
    returnPct: received > 0 ? fromReturns / received : null,
    supplierPct: received > 0 ? fromSupplier / received : null,
    avgSupplierCost: fromSupplier > 0 ? estSupplierCost / fromSupplier : null,
  }
}

/** Actual bill minus estimate (positive = billed more than expected). Null if no bill entered. */
export function billVariance(actualBill: number | null, estimate: number): number | null {
  if (actualBill == null) return null
  return actualBill - estimate
}
