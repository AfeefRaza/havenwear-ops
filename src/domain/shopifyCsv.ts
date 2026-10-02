/**
 * Shopify "Export orders" CSV → batch lines.
 *
 * Only the product name, quantity and order number are kept. Customer names, emails, phone
 * numbers and addresses in the export are never stored or sent anywhere.
 *
 * Shopify quirks handled:
 *  - one row per line item; extra line items repeat only the order Name (other columns blank)
 *  - quoted fields with embedded newlines (e.g. "Note Attributes"), "" escapes, CRLF, BOM
 *  - "(PACK OF TWO)" / "Pack of 3" / "2-pack" products count as multiple pieces
 *  - orders with "Cancelled at" set are skipped
 */

/** RFC 4180 CSV parser (quotes, escaped quotes, newlines inside quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (; i < text.length; i++) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 }

/** Pieces per unit for pack products: "(PACK OF TWO)" → 2, "Pack of 3" → 3, "2-Pack" → 2, else 1. */
export function packSize(name: string): number {
  const m = /\bpack\s+of\s+(two|three|four|five|six|\d{1,2})\b/i.exec(name) ?? /\b(two|three|four|five|six|\d{1,2})\s*-?\s*pack\b/i.exec(name)
  if (!m) return 1
  const v = m[1]!.toLowerCase()
  const n = WORDS[v] ?? Number(v)
  return n >= 2 && n <= 24 ? n : 1
}

export interface ShopifyLine {
  lineNo: number
  order: string
  name: string
  /** Pieces to produce (line-item quantity × pack size). */
  qty: number
  units: number
  pack: number
}

export interface ShopifyParse {
  lines: ShopifyLine[]
  orders: string[]
  skippedCancelled: string[]
  warnings: string[]
}

export class NotShopifyCsvError extends Error {}

export function parseShopifyOrders(text: string): ShopifyParse {
  const rows = parseCsv(text)
  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? []
  const idx = (name: string) => header.indexOf(name.toLowerCase())
  const cName = idx('Name')
  const cItem = idx('Lineitem name')
  const cQty = idx('Lineitem quantity')
  const cCancelled = idx('Cancelled at')
  if (cItem < 0 || cQty < 0 || cName < 0) {
    throw new NotShopifyCsvError('This does not look like a Shopify orders export (missing “Name”, “Lineitem name” or “Lineitem quantity”).')
  }

  const lines: ShopifyLine[] = []
  const orders: string[] = []
  const cancelled = new Set<string>()
  const warnings: string[] = []

  // First pass: an order's "Cancelled at" only appears on its first row.
  for (const r of rows.slice(1)) {
    const order = (r[cName] ?? '').trim()
    if (order && cCancelled >= 0 && (r[cCancelled] ?? '').trim()) cancelled.add(order)
  }

  rows.slice(1).forEach((r, i) => {
    const order = (r[cName] ?? '').trim()
    const name = (r[cItem] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
    if (!name) return
    if (order && cancelled.has(order)) return
    const rawQty = (r[cQty] ?? '').trim()
    let units = Number.parseInt(rawQty, 10)
    if (!Number.isFinite(units) || units < 1) {
      warnings.push(`Row ${i + 2}: quantity “${rawQty}” is not valid — using 1`)
      units = 1
    }
    const pack = packSize(name)
    if (order && !orders.includes(order)) orders.push(order)
    lines.push({ lineNo: i + 2, order, name, units, pack, qty: Math.min(units * pack, 9999) })
  })

  if (!lines.length) warnings.push('No line items found in this file.')
  return { lines, orders, skippedCancelled: [...cancelled], warnings }
}

/** Text stored in the item's notes so the order can be traced (and double imports detected). */
export const orderNote = (order: string) => (order ? `Order ${order}` : null)
