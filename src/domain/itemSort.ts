/**
 * Display-only ordering of batch items for the people packing them:
 * category (Settings order) → size (clothing order) → product name (A–Z).
 * Nothing is merged or changed — every item keeps its own row, id and actions.
 */
import { splitLineName } from './shopifyCatalog'

const SIZES: [RegExp, string][] = [
  [/^(xxs|2xs|extra[\s-]?extra[\s-]?small)$/, 'XXS'],
  [/^(xs|x[\s-]?small|extra[\s-]?small)$/, 'XS'],
  [/^(s|small|sm)$/, 'Small'],
  [/^(m|medium|med)$/, 'Medium'],
  [/^(l|large|lg)$/, 'Large'],
  [/^(xl|x[\s-]?large|extra[\s-]?large)$/, 'XL'],
  [/^(xxl|2xl|xx[\s-]?large|2[\s-]?x[\s-]?large)$/, '2XL'],
  [/^(xxxl|3xl|xxx[\s-]?large|3[\s-]?x[\s-]?large)$/, '3XL'],
  [/^(xxxxl|4xl)$/, '4XL'],
  [/^(5xl)$/, '5XL'],
]
const LETTER_ORDER = ['XXS', 'XS', 'Small', 'Medium', 'Large', 'XL', '2XL', '3XL', '4XL', '5XL']

export interface SizeInfo {
  /** Label shown to staff, e.g. "Medium", "XL", "32", "Free size"; null = no size. */
  label: string | null
  /** Sort key: letter sizes first in clothing order, then numeric sizes, then anything else. */
  rank: [number, number, string]
}

const NO_SIZE: SizeInfo = { label: null, rank: [3, 0, ''] }

/**
 * Size from a variant text such as "Medium", "M", "Small / OVERSIZED", "Medium(Oversized)",
 * "XL / Heather Grey / Olive", "Small." or "32". The first option is the size on Havenwear's store.
 */
export function parseSize(variant: string | null | undefined): SizeInfo {
  if (!variant) return NO_SIZE
  const first = variant.split('/')[0]!.replace(/\(.*?\)/g, '').replace(/[.,;:]+$/g, '').trim()
  if (!first) return NO_SIZE
  const key = first.toLowerCase().replace(/\s+/g, ' ')
  const letter = SIZES.find(([re]) => re.test(key))?.[1]
  if (letter) return { label: letter, rank: [0, LETTER_ORDER.indexOf(letter), ''] }
  if (/^\d{1,3}$/.test(key)) return { label: first, rank: [1, Number(key), ''] }
  return { label: first, rank: [2, 0, key] }
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export interface SortableItem {
  id: string
  product_name: string
  resolved_category_id: string | null
}

export interface CategoryLike {
  id: string
  name: string
  sort_order: number
}

/** What we know about one line: its product title and size (from the Shopify match when there is one). */
export interface LineInfo {
  title: string
  variant: string | null
  size: SizeInfo
}

export function lineInfo(productName: string, match?: { title: string; variant: string | null; size: string | null } | null): LineInfo {
  if (match) {
    const size = parseSize(match.size ?? match.variant)
    return { title: match.title, variant: match.variant, size }
  }
  const s = splitLineName(productName)
  return { title: s.title, variant: s.variant, size: parseSize(s.variant) }
}

export interface SizeGroup<T> {
  key: string
  label: string
  items: T[]
}

export interface CategoryGroup<T> {
  key: string
  name: string
  sizes: SizeGroup<T>[]
  count: number
}

/**
 * Sorts items category → size → name, deterministically (ties fall back to the full line name, then
 * the item id), and groups them for display. Items without a category come last.
 */
export function groupForPicking<T extends SortableItem>(
  items: readonly T[],
  categories: readonly CategoryLike[],
  info: (item: T) => LineInfo,
): CategoryGroup<T>[] {
  const catOrder = new Map(
    [...categories]
      .sort((a, b) => a.sort_order - b.sort_order || collator.compare(a.name, b.name))
      .map((c, i) => [c.id, { i, name: c.name }]),
  )
  const rows = items.map((it) => ({ it, info: info(it), cat: it.resolved_category_id ? catOrder.get(it.resolved_category_id) : undefined }))
  rows.sort((a, b) => {
    const ca = a.cat?.i ?? Number.MAX_SAFE_INTEGER
    const cb = b.cat?.i ?? Number.MAX_SAFE_INTEGER
    if (ca !== cb) return ca - cb
    const [ga, na, ta] = a.info.size.rank
    const [gb, nb, tb] = b.info.size.rank
    return (
      ga - gb ||
      na - nb ||
      collator.compare(ta, tb) ||
      collator.compare(a.info.title, b.info.title) ||
      collator.compare(a.it.product_name, b.it.product_name) ||
      (a.it.id < b.it.id ? -1 : a.it.id > b.it.id ? 1 : 0)
    )
  })

  const out: CategoryGroup<T>[] = []
  for (const r of rows) {
    const catKey = r.cat ? (r.it.resolved_category_id as string) : 'none'
    let cat = out[out.length - 1]
    if (!cat || cat.key !== catKey) {
      cat = { key: catKey, name: r.cat?.name ?? 'No category', sizes: [], count: 0 }
      out.push(cat)
    }
    const sizeKey = r.info.size.rank.join('|')
    let size = cat.sizes[cat.sizes.length - 1]
    if (!size || size.key !== sizeKey) {
      size = { key: sizeKey, label: r.info.size.label ?? 'No size', items: [] }
      cat.sizes.push(size)
    }
    size.items.push(r.it)
    cat.count++
  }
  return out
}
