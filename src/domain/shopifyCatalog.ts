/**
 * Shopify catalogue matching. Shopify order line names are "<Product title> - <Variant title>",
 * e.g. "Basic Oversized T-shirt (PACK OF TWO) - M / Maroon / Steel grey".
 * We match the longest product title that prefixes the line, then the exact variant.
 */

export interface FeedProduct {
  id: number
  title: string
  handle: string
  product_type?: string
  options: { name: string; position: number }[]
  images: { src: string; id?: number }[]
  variants: {
    id: number
    title: string
    option1: string | null
    option2: string | null
    option3: string | null
    featured_image?: { src: string } | null
  }[]
}

export interface CatalogProduct {
  product_id: number
  handle: string
  title: string
  product_type: string | null
  image_url: string | null
  image2_url: string | null
  front_print: boolean
  back_print: boolean
  print_confirmed: boolean
}

export interface CatalogVariant {
  variant_id: number
  product_id: number
  title: string
  size: string | null
  color: string | null
  image_url: string | null
}

const SHOPIFY_CDN = /^https:\/\/cdn\.shopify\.com\//

export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Shopify sometimes returns protocol-relative or http URLs; keep only https CDN images. */
export function cleanImage(src: string | null | undefined): string | null {
  if (!src) return null
  const s = src.startsWith('//') ? 'https:' + src : src.replace(/^http:/, 'https:')
  return SHOPIFY_CDN.test(s) ? s : null
}

/** Colour from the product title, e.g. "Batman Hoodie (Charcoal)" → "Charcoal". */
export function colorFromTitle(title: string): string | null {
  const m = /\(([^()]{2,30})\)\s*$/.exec(title.trim())
  if (!m) return null
  const v = m[1]!.trim()
  return /oversized|pack of|regular|fit/i.test(v) ? null : v
}

/** Flattens the public products feed into catalogue rows (size/colour detected from option names). */
export function flattenFeed(feed: FeedProduct[]): { products: CatalogProduct[]; variants: CatalogVariant[] } {
  const products: CatalogProduct[] = []
  const variants: CatalogVariant[] = []
  for (const p of feed) {
    const productImage = cleanImage(p.images[0]?.src)
    const secondImage = cleanImage(p.images[1]?.src)
    products.push({
      product_id: p.id,
      handle: p.handle,
      title: p.title.trim(),
      product_type: p.product_type?.trim() || null,
      image_url: productImage,
      image2_url: secondImage && secondImage !== productImage ? secondImage : null,
      front_print: true,
      back_print: true,
      print_confirmed: false,
    })
    const sizeIdx = p.options.findIndex((o) => /size/i.test(o.name))
    const colorIdxs = p.options.map((o, i) => (/colou?r/i.test(o.name) ? i : -1)).filter((i) => i >= 0)
    const titleColor = colorFromTitle(p.title)
    for (const v of p.variants) {
      const opts = [v.option1, v.option2, v.option3]
      const size = sizeIdx >= 0 ? (opts[sizeIdx] ?? null) : null
      const colors = colorIdxs.map((i) => opts[i]).filter((x): x is string => !!x)
      variants.push({
        variant_id: v.id,
        product_id: p.id,
        title: v.title,
        size,
        color: colors.length ? colors.join(' + ') : titleColor,
        image_url: cleanImage(v.featured_image?.src) ?? productImage,
      })
    }
  }
  return { products, variants }
}

export interface MatchResult {
  product: CatalogProduct
  variant: CatalogVariant | null
  variantTitle: string | null
}

/** Index for fast repeated matching. */
export function buildMatcher(products: CatalogProduct[], variants: CatalogVariant[]) {
  const sorted = [...products].sort((a, b) => b.title.length - a.title.length)
  const byProduct = new Map<number, CatalogVariant[]>()
  for (const v of variants) byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v])

  return function match(lineName: string): MatchResult | null {
    const n = norm(lineName)
    for (const p of sorted) {
      const t = norm(p.title)
      if (n === t) {
        const only = byProduct.get(p.product_id)
        return { product: p, variant: only && only.length === 1 ? only[0]! : null, variantTitle: null }
      }
      if (n.startsWith(t + ' - ')) {
        const vt = n.slice(t.length + 3)
        const variant = (byProduct.get(p.product_id) ?? []).find((v) => norm(v.title) === vt) ?? null
        return { product: p, variant, variantTitle: lineName.trim().slice(lineName.trim().length - vt.length) }
      }
    }
    return null
  }
}

/** Stable key used to combine identical lines into one production item. */
export function productionKey(lineName: string, m: MatchResult | null): string {
  if (m?.variant) return `v:${m.variant.variant_id}`
  if (m) return `p:${m.product.product_id}:${norm(m.variantTitle ?? '')}`
  return `n:${norm(lineName)}`
}

/** Fallback split of "Title - Variant" when the product is not in the catalogue. */
export function splitLineName(name: string): { title: string; variant: string | null } {
  const i = name.lastIndexOf(' - ')
  return i > 0 ? { title: name.slice(0, i).trim(), variant: name.slice(i + 3).trim() || null } : { title: name.trim(), variant: null }
}
