const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** "PKR 1,400" — rounded to whole rupees; negatives as "-PKR 200". */
export function formatPKR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const r = Math.round(n)
  return (r < 0 ? '-' : '') + 'PKR ' + intFmt.format(Math.abs(r))
}

export function formatInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return intFmt.format(Math.round(n))
}

/** "10-Sep-26" from "2026-09-10". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return '—'
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return '—'
  return `${m[3]}-${month}-${m[1]!.slice(2)}`
}

/** 0.4567 → "45.7%" ; null → "—". */
export function formatPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(digits).replace(/\.0+$/, '')}%`
}
