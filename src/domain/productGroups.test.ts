import { describe, expect, it } from 'vitest'
import { groupByProduct, shortSize, sizeSummary, type GroupableItem } from './productGroups'

let n = 0
const item = (o: Partial<GroupableItem>): GroupableItem => ({
  id: `i${++n}`, product_title: 'Italia Racer Oversized T-Shirt', variant_title: 'Medium', size: 'Medium', color: null,
  image_url: 'https://cdn.shopify.com/a.jpg', image2_url: null, shopify_product_id: 1, front_print: true, back_print: true,
  qty_required: 1, qty_ready: 0, qty_received: 0, ...o,
})

describe('shortSize', () => {
  it.each([
    ['Small', 'S'], ['Medium', 'M'], ['Large', 'L'], ['XL', 'XL'], ['X-Large', 'XL'], ['XXL', '2XL'],
    ['Medium(Oversized)', 'M (Oversized)'], ['Navy', 'Navy'], ['M', 'M'],
  ])('%s → %s', (a, b) => expect(shortSize(a)).toBe(b))
})

describe('groupByProduct', () => {
  it('one card per parent product with a size breakdown (the Italia Racer example)', () => {
    const groups = groupByProduct([
      item({ variant_title: 'XL', size: 'XL', qty_required: 2 }),
      item({ variant_title: 'Medium', size: 'Medium' }),
      item({ variant_title: 'Large', size: 'Large' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.required).toBe(4)
    expect(sizeSummary(groups[0]!)).toBe('M × 1 | L × 1 | XL × 2')
  })

  it('keeps every SKU as its own row (no data merged)', () => {
    const a = item({ variant_title: 'Small' })
    const b = item({ variant_title: 'Medium' })
    const g = groupByProduct([a, b])[0]!
    expect(g.rows.map((r) => r.item)).toEqual([a, b])
  })

  it('never combines different products, even with the same name', () => {
    const groups = groupByProduct([
      item({ shopify_product_id: 1 }),
      item({ shopify_product_id: 2 }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('never combines unmatched items (no Shopify product), even with identical names', () => {
    const groups = groupByProduct([
      item({ shopify_product_id: null, product_title: 'Mystery Tee' }),
      item({ shopify_product_id: null, product_title: 'Mystery Tee' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('pulls options shared by all variants out of the labels', () => {
    const g = groupByProduct([
      item({ variant_title: 'Small / OVERSIZED' }),
      item({ variant_title: 'Medium / OVERSIZED', qty_required: 3 }),
    ])[0]!
    expect(g.common).toBe('OVERSIZED')
    expect(sizeSummary(g)).toBe('S × 1 | M × 3')
  })

  it('shared fit in parentheses is pulled out too', () => {
    const g = groupByProduct([item({ variant_title: 'Medium(Oversized)' }), item({ variant_title: 'XL(Oversized)' })])[0]!
    expect(g.common).toBe('Oversized')
    expect(sizeSummary(g)).toBe('M × 1 | XL × 1')
  })

  it('keeps colour when variants differ by colour', () => {
    const g = groupByProduct([
      item({ variant_title: 'M / Brown' }),
      item({ variant_title: 'S / Navy' }),
      item({ variant_title: 'M / Navy' }),
    ])[0]!
    expect(g.common).toBeNull()
    expect(sizeSummary(g)).toBe('S / Navy × 1 | M / Brown × 1 | M / Navy × 1')
  })

  it('a single variant keeps its full label', () => {
    const g = groupByProduct([item({ variant_title: 'Small / OVERSIZED' })])[0]!
    expect(sizeSummary(g)).toBe('S / OVERSIZED × 1')
    expect(g.common).toBeNull()
  })

  it('totals ready / received across variants and skips cancelled (0 required)', () => {
    const g = groupByProduct([
      item({ qty_required: 3, qty_ready: 2, qty_received: 1 }),
      item({ variant_title: 'Large', qty_required: 2, qty_ready: 2, qty_received: 2 }),
      item({ variant_title: 'XL', qty_required: 0 }),
    ])[0]!
    expect([g.required, g.ready, g.received, g.rows.length]).toEqual([5, 4, 3, 2])
  })
})
