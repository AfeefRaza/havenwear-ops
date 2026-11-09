import { useMemo } from 'react'
import { lineInfo, type LineInfo } from '../domain/itemSort'
import { useCatalog } from './production'

export interface ItemDisplay {
  info: LineInfo
  image: string | null
}

/**
 * Picture, title and size for each batch line, from the (offline-cached) Shopify catalogue.
 * Display only: nothing is written back. Lines without a match fall back to their own name.
 */
export function useItemDisplay(items: readonly { id: string; product_name: string }[]) {
  const catalog = useCatalog()
  const match = catalog.data?.match
  return useMemo(() => {
    const out = new Map<string, ItemDisplay>()
    for (const it of items) {
      const m = match?.(it.product_name) ?? null
      const variant = m ? (m.variant?.title ?? m.variantTitle) : null
      out.set(it.id, {
        info: lineInfo(it.product_name, m ? { title: m.product.title, variant, size: m.variant?.size ?? null } : null),
        image: m ? (m.variant?.image_url ?? m.product.image_url) : null,
      })
    }
    return out
  }, [items, match])
}
