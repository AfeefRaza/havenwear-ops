import { describe, expect, it } from 'vitest'
import { groupByOrder, highPriorityIds, isHighPriority, orderNameOf, type OrderLine } from './orders'

let n = 0
const line = (o: Partial<OrderLine>): OrderLine => ({ id: `l${String(++n).padStart(3, '0')}`, qty: 1, status: 'pending', product_name: 'Tee - L', order_name: null, notes: null, ...o })

describe('orderNameOf', () => {
  it('prefers the saved order name', () => expect(orderNameOf({ order_name: ' #haven1 ', notes: 'Order #x' })).toBe('#haven1'))
  it('reads the CSV-import note', () => expect(orderNameOf({ order_name: null, notes: 'Order #haven32540' })).toBe('#haven32540'))
  it('ignores other notes and keeps only the first word', () => {
    expect(orderNameOf({ order_name: null, notes: 'rush please' })).toBeNull()
    expect(orderNameOf({ order_name: null, notes: 'Order #haven5 — rush' })).toBe('#haven5')
    expect(orderNameOf({ order_name: null, notes: null })).toBeNull()
  })
})

describe('groupByOrder', () => {
  it('groups lines per order and counts pieces by status', () => {
    const g = groupByOrder([
      line({ order_name: '#1', qty: 2 }),
      line({ order_name: '#1', status: 'received' }),
      line({ order_name: '#1', status: 'cancelled', qty: 5 }),
      line({ notes: 'Order #1' }),
    ])
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ name: '#1', pieces: 4, pending: 3, received: 1, cancelled: 5, complete: false })
  })

  it('same order written differently still groups together', () => {
    expect(groupByOrder([line({ order_name: '#HAVEN7' }), line({ order_name: '#haven7' })])).toHaveLength(1)
  })

  it('incomplete orders first, then by order number; lines without an order last', () => {
    const g = groupByOrder([
      line({ order_name: '#10', status: 'received' }),
      line({ order_name: '#9' }),
      line({ product_name: 'Pasted line' }),
      line({ order_name: '#2' }),
    ])
    expect(g.map((x) => x.name)).toEqual(['#2', '#9', '#10', null])
    expect(g.at(-1)!.highPriority).toBe(false)
  })

  it('lines still to receive come first inside an order', () => {
    const rec = line({ order_name: '#1', status: 'received', product_name: 'A' })
    const pend = line({ order_name: '#1', product_name: 'B' })
    const canc = line({ order_name: '#1', status: 'cancelled', product_name: 'C' })
    expect(groupByOrder([canc, rec, pend])[0]!.items.map((x) => x.status)).toEqual(['pending', 'received', 'cancelled'])
  })

  it('an order with everything received is complete', () => {
    expect(groupByOrder([line({ order_name: '#1', status: 'received' })])[0]!.complete).toBe(true)
  })
})

describe('high priority', () => {
  it('threshold is "this many pieces or more"', () => {
    expect(isHighPriority(3, 4)).toBe(false)
    expect(isHighPriority(4, 4)).toBe(true)
  })

  it('marks every line of a large order, counting quantities and ignoring cancelled pieces', () => {
    const big1 = line({ order_name: '#1', qty: 3 })
    const big2 = line({ order_name: '#1', status: 'received' })
    const big3 = line({ order_name: '#1', status: 'cancelled', qty: 9 })
    const small = line({ order_name: '#2', qty: 3 })
    const pasted = line({ qty: 9 })
    const ids = highPriorityIds([big1, big2, big3, small, pasted], 4)
    expect([...ids].sort()).toEqual([big1.id, big2.id].sort())
  })

  it('cancelling pieces can drop an order below the threshold', () => {
    expect(highPriorityIds([line({ order_name: '#1', qty: 3 }), line({ order_name: '#1', status: 'cancelled' })], 4).size).toBe(0)
  })
})
