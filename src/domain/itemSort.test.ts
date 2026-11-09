import { describe, expect, it } from 'vitest'
import { groupForPicking, lineInfo, parseSize } from './itemSort'
import { buildMatcher, type CatalogProduct, type CatalogVariant } from './shopifyCatalog'

const cats = [
  { id: 'hood', name: 'Hoodie', sort_order: 2 },
  { id: 'tee', name: 'T-shirt', sort_order: 1 },
  { id: 'denim', name: 'Essential Denim', sort_order: 6 },
]
let n = 0
const item = (product_name: string, resolved_category_id: string | null) => ({ id: `id${String(++n).padStart(3, '0')}`, product_name, resolved_category_id })
const byName = (x: { product_name: string }) => lineInfo(x.product_name)

describe('parseSize', () => {
  it.each([
    ['M', 'Medium'],
    ['Medium', 'Medium'],
    ['Medium(Oversized)', 'Medium'],
    ['Small / OVERSIZED', 'Small'],
    ['XL / Heather Grey / Olive', 'XL'],
    ['Small.', 'Small'],
    ['Small,', 'Small'],
    ['2XL', '2XL'],
    ['XXL', '2XL'],
    ['x-large', 'XL'],
    ['32', '32'],
    ['Free size', 'Free size'],
  ])('%j → %j', (v, label) => expect(parseSize(v).label).toBe(label))
  it('no size', () => expect(parseSize(null).label).toBeNull())
})

describe('groupForPicking', () => {
  const items = [
    item('Batman Detective Oversized Hoodie (Charcoal) - Medium', 'hood'),
    item('Batman Detective Oversized Hoodie (Charcoal) - XL', 'hood'),
    item('Arctic Monkeys Oversized T-shirt - Small', 'tee'),
    item('Spiderman II Oversized Hoodie (Charcoal Grey) - XL', 'hood'),
    item('Peace and Joy Oversized T-shirt - Small', 'tee'),
    item('Batman II Oversized T-shirt - Large', 'tee'),
    item('Batman III Oversized T-shirt - Large', 'tee'),
    item('Batman II Oversized T-shirt - Medium', 'tee'),
    item('Mystery Cap', null),
    item('Cosmic Orbit Baggy Denim - 32', 'denim'),
    item('Cosmic Orbit Baggy Denim - 30', 'denim'),
    item('Basic Oversized T-shirt - Small', 'tee'),
    item('Aizen Oversized Hoodie - Large', 'hood'),
    item('Aizen Oversized Hoodie - S', 'hood'),
  ]
  const groups = groupForPicking(items, cats, byName)
  const flat = groups.map((g) => [g.name, g.sizes.map((s) => [s.label, s.items.map((i) => i.product_name.split(' - ')[0])])])

  it('orders category → size (clothing order, not A–Z) → name', () => {
    expect(flat).toEqual([
      ['T-shirt', [
        ['Small', ['Arctic Monkeys Oversized T-shirt', 'Basic Oversized T-shirt', 'Peace and Joy Oversized T-shirt']],
        ['Medium', ['Batman II Oversized T-shirt']],
        ['Large', ['Batman II Oversized T-shirt', 'Batman III Oversized T-shirt']],
      ]],
      ['Hoodie', [
        ['Small', ['Aizen Oversized Hoodie']],
        ['Medium', ['Batman Detective Oversized Hoodie (Charcoal)']],
        ['Large', ['Aizen Oversized Hoodie']],
        ['XL', ['Batman Detective Oversized Hoodie (Charcoal)', 'Spiderman II Oversized Hoodie (Charcoal Grey)']],
      ]],
      ['Essential Denim', [['30', ['Cosmic Orbit Baggy Denim']], ['32', ['Cosmic Orbit Baggy Denim']]]],
      ['No category', [['No size', ['Mystery Cap']]]],
    ])
  })

  it('keeps every item (nothing merged, similar names stay separate)', () => {
    expect(groups.reduce((s, g) => s + g.count, 0)).toBe(items.length)
    const large = groups[0]!.sizes[2]!.items.map((i) => i.id)
    expect(new Set(large).size).toBe(2)
  })

  it('is deterministic whatever the input order', () => {
    const ids = (xs: typeof items) => groupForPicking(xs, cats, byName).flatMap((g) => g.sizes.flatMap((s) => s.items.map((i) => i.id)))
    expect(ids([...items].reverse())).toEqual(ids(items))
    const dupes = [item('Same Tee - Small', 'tee'), item('Same Tee - Small', 'tee')]
    expect(ids([...dupes].reverse())).toEqual(dupes.map((d) => d.id))
  })

  it('uses the Shopify match for title and size when there is one', () => {
    const products: CatalogProduct[] = [{ product_id: 1, handle: 'metalica-oversized-hoodie', title: 'Metallica Oversized Hoodie', product_type: 'hoodie', image_url: null, image2_url: null, front_print: true, back_print: true, print_confirmed: false }]
    const variants: CatalogVariant[] = [{ variant_id: 11, product_id: 1, title: 'Large', size: 'Large', color: null, image_url: null }]
    const m = buildMatcher(products, variants)('Metalica Oversized Hoodie - Large')
    expect(m?.product.product_id).toBe(1)
    expect(lineInfo('x', { title: m!.product.title, variant: m!.variant!.title, size: m!.variant!.size }).size.label).toBe('Large')
  })
})
