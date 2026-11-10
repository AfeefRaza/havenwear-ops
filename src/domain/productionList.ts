/**
 * Plain-text list of the products pushed to production, for pasting into the other app that makes
 * the DTF files. One line per product variant ("Title — Variant"), grouped by category in Settings
 * order with a blank line between groups, A–Z inside each group. Display only: nothing is changed.
 */
import type { CategoryLike } from './itemSort'

export interface ProductionListEntry {
  title: string
  /** Variant / size text, e.g. "Large" or "M / Navy / Maroon". */
  variant: string | null
  categoryId: string | null
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export function formatProductionList(entries: readonly ProductionListEntry[], categories: readonly CategoryLike[]): string {
  const order = new Map(
    [...categories].sort((a, b) => a.sort_order - b.sort_order || collator.compare(a.name, b.name)).map((c, i) => [c.id, i]),
  )
  const NONE = Number.MAX_SAFE_INTEGER

  const groups = new Map<number, Set<string>>()
  for (const e of entries) {
    const title = e.title.trim()
    if (!title) continue
    const variant = e.variant?.trim()
    const line = variant ? `${title} — ${variant}` : title
    const rank = (e.categoryId ? order.get(e.categoryId) : undefined) ?? NONE
    const set = groups.get(rank) ?? new Set<string>()
    set.add(line)
    groups.set(rank, set)
  }

  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, lines]) => [...lines].sort((a, b) => collator.compare(a, b)).join('\n'))
    .join('\n\n')
}
