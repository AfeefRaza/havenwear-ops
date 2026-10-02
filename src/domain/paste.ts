/**
 * Bulk-paste parser for Shopify product names. Input is treated strictly as plain text.
 *
 * One product per line. Quantity may be given as:
 *   "Oversized Tee - Black / L × 2"   (×, x, X or * followed by a number at the end)
 *   "Oversized Tee - Black / L\t2"    (tab-separated, last column a number — e.g. pasted from a sheet)
 *   "2 × Oversized Tee"               (number then × at the start)
 * Otherwise qty = 1. Blank lines are skipped. Sizes such as "2XL" are not mistaken for quantities.
 */

export interface PastedLine {
  lineNo: number
  name: string
  qty: number
}

export const MAX_PASTE_LINES = 500
export const MAX_QTY = 9999

const TRAILING_QTY = /\s*(?:[×xX*]\s*(\d{1,4})|\(\s*[×xX*]?\s*(\d{1,4})\s*\))\s*$/
const LEADING_QTY = /^\s*(\d{1,4})\s*[×xX*]\s+/
const BULLET = /^\s*(?:[-•*·]|\d+[.)])\s+/

function clampQty(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(Math.floor(n), MAX_QTY)
}

export function parsePasteLine(raw: string): { name: string; qty: number } | null {
  // Strip control characters (keep tabs for column detection).
  // eslint-disable-next-line no-control-regex -- intentionally matching control chars
  let line = raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trimEnd()
  if (!line.trim()) return null

  let qty = 1

  if (line.includes('\t')) {
    const cols = line.split('\t').map((c) => c.trim()).filter((c) => c !== '')
    const last = cols[cols.length - 1]
    if (cols.length >= 2 && last && /^\d{1,4}$/.test(last)) {
      qty = clampQty(Number(last))
      cols.pop()
    }
    line = cols.join(' ')
  }

  line = line.replace(BULLET, '')

  const trailing = line.match(TRAILING_QTY)
  if (trailing && trailing.index !== undefined && trailing.index > 0) {
    qty = clampQty(Number(trailing[1] ?? trailing[2]))
    line = line.slice(0, trailing.index)
  } else {
    const leading = line.match(LEADING_QTY)
    if (leading) {
      qty = clampQty(Number(leading[1]))
      line = line.slice(leading[0].length)
    }
  }

  const name = line.replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!name) return null
  return { name, qty }
}

export function parsePaste(text: string): PastedLine[] {
  const out: PastedLine[] = []
  const lines = text.split(/\r\n|\r|\n/)
  for (let i = 0; i < lines.length && out.length < MAX_PASTE_LINES; i++) {
    const parsed = parsePasteLine(lines[i] ?? '')
    if (parsed) out.push({ lineNo: i + 1, ...parsed })
  }
  return out
}
