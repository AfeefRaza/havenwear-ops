/**
 * Order-wise view of batch lines. Display only: it reads the very same batch lines as the product
 * view, so receiving a line anywhere updates both. Nothing here changes or merges any line.
 */

/** Orders with at least this many pieces get the HIGH PRIORITY label (Settings can change it). */
export const DEFAULT_HIGH_PRIORITY_PIECES = 4

export interface OrderLine {
  id: string
  qty: number
  status: 'pending' | 'received' | 'cancelled'
  product_name: string
  /** Set by the automatic Shopify import. */
  order_name?: string | null
  /** The Shopify CSV import writes "Order #haven32540" here. */
  notes?: string | null
}

const NOTE = /^\s*Order\s+(\S+)/i

/** The order a line belongs to: the saved order name, else the order number in a CSV-import note. */
export function orderNameOf(it: Pick<OrderLine, 'order_name' | 'notes'>): string | null {
  const name = it.order_name?.trim()
  if (name) return name
  const m = it.notes?.match(NOTE)
  return m?.[1] ?? null
}

export interface OrderGroup<T> {
  /** Lower-cased order name; "" for lines with no order number. */
  key: string
  /** null = lines with no order number (pasted lists). */
  name: string | null
  items: T[]
  /** Pieces in the order, cancelled lines not counted. */
  pieces: number
  pending: number
  received: number
  cancelled: number
  /** Nothing left to receive. */
  complete: boolean
  highPriority: boolean
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
const STATUS_ORDER = { pending: 0, received: 1, cancelled: 2 } as const

export const isHighPriority = (pieces: number, threshold: number) => threshold > 0 && pieces >= threshold

/**
 * Groups lines by order. Orders that still have something to receive come first, then by order
 * number; lines without an order number are one group at the end. Inside an order, lines still
 * to receive come first.
 */
export function groupByOrder<T extends OrderLine>(items: readonly T[], threshold: number = DEFAULT_HIGH_PRIORITY_PIECES): OrderGroup<T>[] {
  const map = new Map<string, OrderGroup<T>>()
  for (const it of items) {
    const name = orderNameOf(it)
    const key = name ? name.toLowerCase() : ''
    const g = map.get(key) ?? { key, name, items: [], pieces: 0, pending: 0, received: 0, cancelled: 0, complete: true, highPriority: false }
    g.items.push(it)
    if (it.status === 'cancelled') g.cancelled += it.qty
    else {
      g.pieces += it.qty
      if (it.status === 'pending') g.pending += it.qty
      else g.received += it.qty
    }
    map.set(key, g)
  }
  const groups = [...map.values()]
  for (const g of groups) {
    g.complete = g.pending === 0
    g.highPriority = g.name != null && isHighPriority(g.pieces, threshold)
    g.items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || collator.compare(a.product_name, b.product_name) || (a.id < b.id ? -1 : 1))
  }
  return groups.sort((a, b) => {
    if (!a.name !== !b.name) return a.name ? -1 : 1
    if (a.complete !== b.complete) return a.complete ? 1 : -1
    return collator.compare(a.name ?? '', b.name ?? '')
  })
}

/** Ids of the lines that belong to a large order (cancelled lines excluded), for the product view. */
export function highPriorityIds(items: readonly OrderLine[], threshold: number = DEFAULT_HIGH_PRIORITY_PIECES): Set<string> {
  const out = new Set<string>()
  for (const g of groupByOrder(items, threshold)) {
    if (g.highPriority) for (const it of g.items) if (it.status !== 'cancelled') out.add(it.id)
  }
  return out
}
