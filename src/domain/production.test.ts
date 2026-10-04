import { describe, expect, it } from 'vitest'
import { dtfTotals, formatMeters, groupForDtf, isDtfIssue, itemProgress, parseMeters, type ProdItem } from './production'
import { buildMatcher, cleanImage, colorFromTitle, flattenFeed, productionKey, splitLineName, type FeedProduct } from './shopifyCatalog'

const item = (o: Partial<ProdItem>): ProdItem => ({
  id: Math.random().toString(36), product_title: 'Motorsport Tee', variant_title: 'L', size: 'L', color: 'Black',
  image_url: 'https://cdn.shopify.com/m.jpg', shopify_product_id: 1, front_print: true, back_print: true,
  qty_required: 1, qty_ready: 0, qty_received: 0, ...o,
})

describe('itemProgress', () => {
  it('ready but not received is separate from received', () => {
    expect(itemProgress({ qty_required: 10, qty_ready: 8, qty_received: 6 })).toEqual({
      required: 10, ready: 8, received: 6, pendingProduction: 2, readyNotReceived: 2, notReceived: 4,
    })
  })
  it('received ahead of ready never goes negative', () => {
    expect(itemProgress({ qty_required: 5, qty_ready: 1, qty_received: 3 }).readyNotReceived).toBe(0)
  })
})

describe('groupForDtf', () => {
  it('combines sizes of the same design and counts front/back by print setting', () => {
    const lines = groupForDtf([
      item({ size: 'L', qty_required: 4 }),
      item({ size: 'M', qty_required: 3 }),
      item({ shopify_product_id: 2, product_title: 'Minimal Tee', back_print: false, qty_required: 4 }),
      item({ shopify_product_id: 3, product_title: 'Cancelled', qty_required: 0 }),
    ])
    expect(lines.map((l) => [l.title, l.front, l.back])).toEqual([
      ['Motorsport Tee', 7, 7],
      ['Minimal Tee', 4, 0],
    ])
    expect(lines[0]!.variants).toEqual([{ label: 'Black · L', qty: 4 }, { label: 'Black · M', qty: 3 }])
    expect(dtfTotals(lines)).toEqual({ front: 11, back: 7 })
  })
  it('groups unmatched products by title', () => {
    const lines = groupForDtf([item({ shopify_product_id: null, product_title: 'X' }), item({ shopify_product_id: null, product_title: 'x' })])
    expect(lines).toHaveLength(1)
  })
})

describe('DTF: no-print products', () => {
  it('are never part of the DTF job', () => {
    const lines = groupForDtf([item({ qty_required: 2 }), item({ shopify_product_id: 9, product_title: 'Plain Denim', front_print: false, back_print: false, qty_required: 5 })])
    expect(lines.map((l) => l.title)).toEqual(['Motorsport Tee'])
  })
})

describe('meters', () => {
  it.each([
    ['10.2', 10.2],
    ['5', 5],
    ['7.5 m', 7.5],
    ['12.75 meters', 12.75],
    ['10,2', 10.2],
    [' 3.25M ', 3.25],
  ])('parse %j → %d', (input, out) => expect(parseMeters(input)).toBe(out))
  it.each(['', '0', '-1', 'abc', '1.234', '10001', '1..2'])('rejects %j', (input) => expect(parseMeters(input)).toBeNull())
  it('formats', () => {
    expect(formatMeters(10.2)).toBe('10.2 m')
    expect(formatMeters(5)).toBe('5 m')
    expect(formatMeters(12.75)).toBe('12.75 m')
    expect(formatMeters(null)).toBe('—')
  })
})

describe('isDtfIssue', () => {
  it('print problems go to DTF, garment problems do not', () => {
    expect(isDtfIssue('front_missing')).toBe(true)
    expect(isDtfIssue('complete_missing')).toBe(true)
    expect(isDtfIssue('damaged_print')).toBe(true)
    expect(isDtfIssue('garment_missing')).toBe(false)
    expect(isDtfIssue('damaged_garment')).toBe(false)
    expect(isDtfIssue('other')).toBe(false)
  })
})

const feed: FeedProduct[] = [
  {
    id: 10, title: 'Basic Oversized T-shirt', handle: 'basic', options: [{ name: 'Size', position: 1 }, { name: 'Color', position: 2 }],
    images: [{ src: '//cdn.shopify.com/basic.jpg' }, { src: 'https://cdn.shopify.com/basic-back.jpg' }],
    variants: [{ id: 101, title: 'S / Navy', option1: 'S', option2: 'Navy', option3: null }],
  },
  {
    id: 11, title: 'Basic Oversized T-shirt (PACK OF TWO)', handle: 'basic-2', options: [{ name: 'Size', position: 1 }, { name: 'Color #1', position: 2 }, { name: 'Color #2', position: 3 }],
    images: [{ src: 'https://cdn.shopify.com/pack.jpg' }],
    variants: [{ id: 111, title: 'M / Maroon / Steel grey', option1: 'M', option2: 'Maroon', option3: 'Steel grey' }],
  },
  {
    id: 12, title: 'Batman Detective Oversized Hoodie (Charcoal)', handle: 'batman', options: [{ name: 'Size', position: 1 }],
    images: [{ src: 'https://evil.example/x.jpg' }],
    variants: [{ id: 121, title: 'Medium(Oversized)', option1: 'Medium(Oversized)', option2: null, option3: null }],
  },
]

describe('shopify catalogue', () => {
  const { products, variants } = flattenFeed(feed)
  const match = buildMatcher(products, variants)

  it('extracts size, colour and safe image URLs', () => {
    expect(variants.find((v) => v.variant_id === 101)).toMatchObject({ size: 'S', color: 'Navy', image_url: 'https://cdn.shopify.com/basic.jpg' })
    expect(variants.find((v) => v.variant_id === 111)).toMatchObject({ size: 'M', color: 'Maroon + Steel grey' })
    expect(variants.find((v) => v.variant_id === 121)).toMatchObject({ size: 'Medium(Oversized)', color: 'Charcoal', image_url: null })
  })

  it('keeps the second product picture (often the other print side)', () => {
    expect(products.find((p) => p.product_id === 10)).toMatchObject({ image_url: 'https://cdn.shopify.com/basic.jpg', image2_url: 'https://cdn.shopify.com/basic-back.jpg' })
    expect(products.find((p) => p.product_id === 11)!.image2_url).toBeNull()
  })

  it('longest product title wins (pack vs single)', () => {
    expect(match('Basic Oversized T-shirt (PACK OF TWO) - M / Maroon / Steel grey')?.variant?.variant_id).toBe(111)
    expect(match('Basic Oversized T-shirt - S / Navy')?.variant?.variant_id).toBe(101)
  })

  it('is case/space insensitive and tolerates unknown variants', () => {
    expect(match('basic  oversized t-shirt - s / navy')?.variant?.variant_id).toBe(101)
    const m = match('Basic Oversized T-shirt - XXL / Pink')
    expect(m?.product.product_id).toBe(10)
    expect(m?.variant).toBeNull()
    expect(m?.variantTitle).toBe('XXL / Pink')
  })

  it('returns null for unknown products', () => expect(match('Mystery Cap - One size')).toBeNull())

  it('production keys combine identical variants', () => {
    expect(productionKey('Basic Oversized T-shirt - S / Navy', match('Basic Oversized T-shirt - S / Navy'))).toBe('v:101')
    expect(productionKey('Mystery Cap', null)).toBe('n:mystery cap')
  })

  it('helpers', () => {
    expect(cleanImage('http://cdn.shopify.com/a.jpg')).toBe('https://cdn.shopify.com/a.jpg')
    expect(cleanImage('https://example.com/a.jpg')).toBeNull()
    expect(colorFromTitle('Peace Tee (Oversized)')).toBeNull()
    expect(splitLineName('Racing Baggy Trouser - Large')).toEqual({ title: 'Racing Baggy Trouser', variant: 'Large' })
    expect(splitLineName('Plain')).toEqual({ title: 'Plain', variant: null })
  })
})
