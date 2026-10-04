/** Production workflow rules shared by Havenwear and the supplier portals. */

export type IssueKind =
  | 'front_missing'
  | 'back_missing'
  | 'complete_missing'
  | 'garment_missing'
  | 'wrong_print'
  | 'damaged_print'
  | 'damaged_garment'
  | 'other'

export const ISSUE_LABEL: Record<IssueKind, string> = {
  front_missing: 'Front print missing',
  back_missing: 'Back print missing',
  complete_missing: 'Complete print missing',
  garment_missing: 'T-shirt / garment missing',
  wrong_print: 'Wrong print',
  damaged_print: 'Damaged print',
  damaged_garment: 'Damaged garment',
  other: 'Other',
}

export const MAIN_ISSUES: IssueKind[] = ['front_missing', 'back_missing', 'complete_missing', 'garment_missing']
export const OTHER_ISSUES: IssueKind[] = ['wrong_print', 'damaged_print', 'damaged_garment', 'other']

/** Print problems go to the DTF supplier; garment problems do not. (Mirrors the database rule.) */
export function isDtfIssue(kind: IssueKind): boolean {
  return kind === 'front_missing' || kind === 'back_missing' || kind === 'complete_missing' || kind === 'wrong_print' || kind === 'damaged_print'
}

export interface ProdItem {
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

export function itemProgress(it: Pick<ProdItem, 'qty_required' | 'qty_ready' | 'qty_received'>) {
  return {
    required: it.qty_required,
    ready: it.qty_ready,
    received: it.qty_received,
    pendingProduction: Math.max(it.qty_required - it.qty_ready, 0),
    readyNotReceived: Math.max(it.qty_ready - it.qty_received, 0),
    notReceived: Math.max(it.qty_required - it.qty_received, 0),
  }
}

export interface DtfLine {
  key: string
  title: string
  image_url: string | null
  image2_url: string | null
  front: number
  back: number
  variants: { label: string; qty: number }[]
}

/**
 * DTF view: one row per design (product), quantities combined across sizes/colours,
 * because prints are made per design. Front/back counts follow each item's print setting.
 */
export function groupForDtf(items: readonly ProdItem[]): DtfLine[] {
  const map = new Map<string, DtfLine>()
  for (const it of items) {
    // No-print products never belong to the DTF supplier (also enforced by the database).
    if (it.qty_required <= 0 || (!it.front_print && !it.back_print)) continue
    const key = it.shopify_product_id != null ? `p:${it.shopify_product_id}` : `t:${it.product_title.toLowerCase()}`
    const row = map.get(key) ?? { key, title: it.product_title, image_url: it.image_url, image2_url: it.image2_url ?? null, front: 0, back: 0, variants: [] }
    if (it.front_print) row.front += it.qty_required
    if (it.back_print) row.back += it.qty_required
    row.variants.push({ label: [it.color, it.size ?? it.variant_title].filter(Boolean).join(' · ') || '—', qty: it.qty_required })
    if (!row.image_url && it.image_url) row.image_url = it.image_url
    if (!row.image2_url && it.image2_url) row.image2_url = it.image2_url
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.front + b.back - (a.front + a.back) || a.title.localeCompare(b.title))
}

export function dtfTotals(lines: readonly DtfLine[]) {
  return lines.reduce((s, l) => ({ front: s.front + l.front, back: s.back + l.back }), { front: 0, back: 0 })
}

export const EVENT_LABEL: Record<string, string> = {
  batch_pushed: 'Batch pushed to production',
  item_allocated: 'Product allocated to supplier',
  dtf_file_ready: 'DTF file ready',
  dtf_file_unready: 'DTF file marked not ready',
  dtf_reset: 'DTF status reset (new printed products)',
  print_config_changed: 'Print setting changed',
  marked_ready: 'Supplier marked ready',
  ready_undone: 'Supplier undid ready',
  received: 'Havenwear marked received',
  receive_undone: 'Havenwear corrected received',
  issue_reported: 'Problem reported',
  reprint_ready: 'Reprint ready',
  issue_resolved: 'Problem resolved',
  required_changed: 'Required quantity changed',
}

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Havenwear',
  member: 'Havenwear',
  tshirt_supplier: 'T-shirt supplier',
  dtf_supplier: 'DTF supplier',
}

/** "10.2 m" — DTF film length. */
export function formatMeters(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—'
  return `${Number(m.toFixed(2))} m`
}

/** Parses what the DTF supplier types ("10.2", "10,2", "7.5 m") → meters, or null if invalid. */
export function parseMeters(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s*(m|meters?|metres?)\s*$/, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return n > 0 && n <= 10000 ? n : null
}
