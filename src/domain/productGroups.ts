/**
 * Display-only grouping for the T-shirt supplier: one card per parent Shopify product, with one row
 * per SKU/variant inside it. Nothing is merged in the data — every row is still its own production
 * item (own id, quantity, ready count, problems).
 *
 * Grouping key = shopify_product_id. Items without a Shopify product match are NEVER combined with
 * anything (each gets its own card), so unrelated products can't be merged by a similar name.
 */

export interface GroupableItem {
  id: string
  product_title: string
  variant_title: string | null
  size: string | null
  color: string | null
  image_url: string | null
  image2_url?: string | null
  shopify_product_id: number | null
  front_print: boolean
  back_print: boolean
  qty_required: number
  qty_ready: number
  qty_received: number
}

export interface VariantRow<T extends GroupableItem> {
  item: T
  /** Short, distinguishing label, e.g. "M", "XL", "S / Navy". */
  label: string
}

export interface ProductGroup<T extends GroupableItem> {
  key: string
  title: string
  image_url: string | null
  image2_url: string | null
  /** Options every variant shares (e.g. "OVERSIZED"), shown once under the title. */
  common: string | null
  rows: VariantRow<T>[]
  required: number
  ready: number
  received: number
  front_print: boolean
  back_print: boolean
}

const SIZE_WORDS: [RegExp, string][] = [
  [/^(extra[\s-]?small|x[\s-]?small|xs)$/i, 'XS'],
  [/^(small|s)$/i, 'S'],
  [/^(medium|m)$/i, 'M'],
  [/^(large|l)$/i, 'L'],
  [/^(extra[\s-]?large|x[\s-]?large|xl)$/i, 'XL'],
  [/^(xx[\s-]?large|2[\s-]?x[\s-]?large|xxl|2xl)$/i, '2XL'],
  [/^(xxx[\s-]?large|3[\s-]?x[\s-]?large|xxxl|3xl)$/i, '3XL'],
  [/^(4xl|xxxxl)$/i, '4XL'],
]
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']

/** "Medium" → "M", "Medium(Oversized)" → "M (Oversized)", anything else unchanged. */
export function shortSize(part: string): string {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(part.trim())
  const base = (m ? m[1]! : part).trim()
  const mapped = SIZE_WORDS.find(([re]) => re.test(base))?.[1] ?? base
  return m ? `${mapped} (${m[2]!.trim()})` : mapped
}

function splitParts(label: string): string[] {
  // "M (Oversized)" → ["M", "(Oversized)"] so a shared fit can be pulled out like any other option.
  return label
    .split(' / ')
    .flatMap((p) => {
      const m = /^(.*?)\s*(\([^()]+\))$/.exec(p.trim())
      return m && m[1] ? [m[1].trim(), m[2]!] : [p.trim()]
    })
    .filter(Boolean)
}

/** ["S", "Navy"] → "S / Navy"; ["M", "(Oversized)"] → "M (Oversized)". */
function joinParts(parts: string[]): string {
  return parts.reduce((out, p, i) => (i === 0 ? p : p.startsWith('(') ? `${out} ${p}` : `${out} / ${p}`), '')
}

function sizeRank(label: string): number {
  const first = label.split(/[\s/]/)[0] ?? ''
  const i = SIZE_ORDER.indexOf(first.toUpperCase())
  return i === -1 ? 100 : i
}

function rawLabel(it: GroupableItem): string {
  const v = it.variant_title?.trim()
  if (v) return v.split(' / ').map(shortSize).join(' / ')
  const parts = [it.size ? shortSize(it.size) : null, it.color].filter(Boolean)
  return parts.join(' / ') || '—'
}

export function groupByProduct<T extends GroupableItem>(items: readonly T[]): ProductGroup<T>[] {
  const map = new Map<string, T[]>()
  for (const it of items) {
    if (it.qty_required <= 0) continue
    const key = it.shopify_product_id != null ? `p:${it.shopify_product_id}` : `i:${it.id}`
    map.set(key, [...(map.get(key) ?? []), it])
  }

  const groups: ProductGroup<T>[] = []
  for (const [key, list] of map) {
    const partsPerRow = list.map((it) => splitParts(rawLabel(it)))
    // Options present on every variant (only when there is more than one variant, or for a lone
    // variant keep its full label so it is never blank).
    const common =
      list.length > 1 ? partsPerRow[0]!.filter((p) => partsPerRow.every((parts) => parts.includes(p))) : []
    const rows = list
      .map((item, i) => {
        const rest = partsPerRow[i]!.filter((p) => !common.includes(p))
        return { item, label: joinParts(rest.length ? rest : partsPerRow[i]!) || '—' }
      })
      .sort((a, b) => sizeRank(a.label) - sizeRank(b.label) || a.label.localeCompare(b.label))
    const first = list[0]!
    groups.push({
      key,
      title: first.product_title,
      image_url: list.find((x) => x.image_url)?.image_url ?? null,
      image2_url: list.find((x) => x.image2_url)?.image2_url ?? null,
      common: common.length ? common.join(' ').replace(/[()]/g, '') : null,
      rows,
      required: list.reduce((s, x) => s + x.qty_required, 0),
      ready: list.reduce((s, x) => s + x.qty_ready, 0),
      received: list.reduce((s, x) => s + x.qty_received, 0),
      front_print: list.some((x) => x.front_print),
      back_print: list.some((x) => x.back_print),
    })
  }
  return groups.sort((a, b) => a.title.localeCompare(b.title))
}

/** "M × 1 | L × 1 | XL × 2" */
export function sizeSummary<T extends GroupableItem>(g: ProductGroup<T>): string {
  return g.rows.map((r) => `${r.label} × ${r.item.qty_required}`).join(' | ')
}
