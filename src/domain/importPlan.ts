/**
 * Turns rows from the legacy Excel workbook (Havenwear_Production_Returns_Batch_Tracker_v2.xlsx)
 * into an import plan that can be previewed before anything is written.
 *
 * Sheets and columns are found by name, tolerant of spacing/case/punctuation and common
 * alternatives, because spreadsheets drift over time.
 */

export type Row = Record<string, unknown>
export type Sheets = Record<string, Row[]>

export interface PlanCategory { name: string; default_cost_pkr: number | null }
export interface PlanRule { keyword: string; category: string; cost_override_pkr: number | null; supplier: string | null; active: boolean; notes: string | null }
export interface PlanBatch { ref: string; batch_date: string; supplier: string | null; invoice_ref: string | null; actual_bill_pkr: number | null; payment_status: 'unpaid' | 'partially_paid' | 'paid'; notes: string | null; archived: boolean }
export interface PlanItem { batch_ref: string; product_name: string; qty: number; status: 'pending' | 'received' | 'cancelled'; received_from: 'supplier' | 'return' | null; received_date: string | null; category: string | null; notes: string | null }
export interface PlanReturn { date: string; reference: string | null; notes: string | null; lines: { category: string; qty: number }[] }
export interface PlanOpening { date: string; category: string; qty: number; kind: 'opening' | 'adjustment'; notes: string | null }

export interface ImportPlan {
  categories: PlanCategory[]
  rules: PlanRule[]
  batches: PlanBatch[]
  items: PlanItem[]
  returns: PlanReturn[]
  opening: PlanOpening[]
  warnings: string[]
  sheetsFound: string[]
}

export interface Existing {
  categoryNames: string[]
  ruleKeys: string[] // `${keyword.toLowerCase()}|${categoryName.toLowerCase()}`
  batchRefs: string[]
  /** lower-cased category name → current default cost */
  categoryCosts?: Record<string, number>
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function findSheet(sheets: Sheets, ...names: string[]): [string, Row[]] | null {
  const keys = Object.keys(sheets)
  for (const n of names) {
    const k = keys.find((x) => norm(x) === norm(n))
    if (k) return [k, sheets[k]!]
  }
  for (const n of names) {
    const k = keys.find((x) => norm(x).includes(norm(n)))
    if (k) return [k, sheets[k]!]
  }
  return null
}

function col(row: Row, ...aliases: string[]): unknown {
  const keys = Object.keys(row)
  for (const a of aliases) {
    const k = keys.find((x) => norm(x) === norm(a))
    if (k !== undefined && row[k] !== null && row[k] !== '') return row[k]
  }
  return undefined
}

export function str(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s === '' ? null : s
}

export function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).replace(/pkr|rs\.?|,|\s/gi, '')
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Excel date cell → ISO date. Accepts Date objects, Excel serials and day-first strings. */
export function toISODate(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate())
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const dt = new Date(Math.round((v - 25569) * 86400000))
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  const s = String(v).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!)
  m = /^(\d{1,2})[-\s/.]([A-Za-z]{3,4})[a-z]*[-\s/.,]+(\d{2,4})$/.exec(s)
  if (m && MONTHS[m[2]!.toLowerCase()]) return iso(+m[3]!, MONTHS[m[2]!.toLowerCase()]!, +m[1]!)
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s) // day-first (Pakistan)
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!)
  return null
}

function payment(v: unknown): PlanBatch['payment_status'] {
  const s = norm(String(v ?? ''))
  if (s.includes('partial') || s === 'part' || s.includes('partpaid')) return 'partially_paid'
  if (s === 'paid' || s === 'yes' || s === 'done' || s === 'cleared') return 'paid'
  return 'unpaid'
}

function itemStatus(v: unknown, from: PlanItem['received_from']): PlanItem['status'] {
  const s = norm(String(v ?? ''))
  if (s.startsWith('cancel')) return 'cancelled'
  if (s.startsWith('receiv') || s === 'done' || s === 'yes' || s === 'complete' || s === 'tick' || s === 'true') return 'received'
  if (s.startsWith('pend') || s === '' || s === 'no' || s === 'false') return from && s === '' ? 'received' : 'pending'
  return 'pending'
}

function source(v: unknown): PlanItem['received_from'] {
  const s = norm(String(v ?? ''))
  if (!s) return null
  if (s.startsWith('ret')) return 'return'
  if (s.startsWith('sup') || s.startsWith('vend') || s.startsWith('fact') || s === 'new') return 'supplier'
  return null
}

function bool(v: unknown, dflt = true): boolean {
  if (v === undefined || v === null || v === '') return dflt
  if (typeof v === 'boolean') return v
  const s = norm(String(v))
  return !['no', 'false', 'n', '0', 'inactive', 'off', 'disabled'].includes(s)
}

export function buildImportPlan(sheets: Sheets, existing: Existing, today: string): ImportPlan {
  const warnings: string[] = []
  const sheetsFound: string[] = []
  const catByLower = new Map<string, PlanCategory>()
  const existingCats = new Map(existing.categoryNames.map((n) => [n.toLowerCase(), n]))
  const canonicalCat = (raw: string | null): string | null => {
    if (!raw) return null
    const lower = raw.toLowerCase()
    if (existingCats.has(lower)) return existingCats.get(lower)!
    if (!catByLower.has(lower)) catByLower.set(lower, { name: raw, default_cost_pkr: null })
    return catByLower.get(lower)!.name
  }

  // ---- Product Rules & Costs → categories + rules
  const rules: PlanRule[] = []
  const rulesSheet = findSheet(sheets, 'Product Rules & Costs', 'Product Rules', 'Rules')
  if (rulesSheet) {
    sheetsFound.push(rulesSheet[0])
    const seen = new Set(existing.ruleKeys)
    rulesSheet[1].forEach((r, i) => {
      const keyword = str(col(r, 'Keyword', 'Keywords', 'Match', 'Contains', 'Product keyword', 'Product'))
      const category = canonicalCat(str(col(r, 'Category', 'Type', 'Product type')))
      if (!keyword || !category) {
        if (keyword || category) warnings.push(`${rulesSheet[0]} row ${i + 2}: needs both a keyword and a category — skipped`)
        return
      }
      const cost = num(col(r, 'Cost', 'Unit cost', 'Cost PKR', 'Cost (PKR)', 'Cost override', 'Price'))
      const catCost = num(col(r, 'Default cost', 'Category cost', 'Category default cost'))
      const plan = catByLower.get(category.toLowerCase())
      if (plan && plan.default_cost_pkr == null) plan.default_cost_pkr = catCost ?? cost
      const defaultCost = existing.categoryCosts?.[category.toLowerCase()] ?? plan?.default_cost_pkr ?? null
      // A rule cost that differs from its category default becomes a per-rule override.
      const override = cost != null && (catCost != null || cost !== defaultCost) ? cost : null
      const key = `${keyword.toLowerCase()}|${category.toLowerCase()}`
      if (seen.has(key)) return
      seen.add(key)
      rules.push({
        keyword,
        category,
        cost_override_pkr: override,
        supplier: str(col(r, 'Supplier', 'Vendor')),
        active: bool(col(r, 'Active', 'Enabled', 'Use')),
        notes: str(col(r, 'Notes', 'Note', 'Comments')),
      })
    })
  }

  // ---- Batch Register → batches
  const batches = new Map<string, PlanBatch>()
  const existingRefs = new Set(existing.batchRefs.map((r) => r.toLowerCase()))
  const reg = findSheet(sheets, 'Batch Register', 'Batches')
  if (reg) {
    sheetsFound.push(reg[0])
    reg[1].forEach((r, i) => {
      const ref = str(col(r, 'Batch Ref', 'Ref', 'Batch', 'Batch ID', 'Batch No', 'Batch Number', 'Reference'))
      if (!ref) return
      if (batches.has(ref.toLowerCase())) {
        warnings.push(`${reg[0]} row ${i + 2}: duplicate batch ${ref} — skipped`)
        return
      }
      const date = toISODate(col(r, 'Date', 'Batch Date', 'Created', 'Order Date'))
      if (!date) warnings.push(`${reg[0]} row ${i + 2}: batch ${ref} has no readable date — using today`)
      const statusText = norm(String(col(r, 'Status', 'Stage') ?? ''))
      batches.set(ref.toLowerCase(), {
        ref,
        batch_date: date ?? today,
        supplier: str(col(r, 'Supplier', 'Vendor', 'Factory')),
        invoice_ref: str(col(r, 'Invoice', 'Invoice Ref', 'Invoice No', 'Invoice Number', 'Bill No')),
        actual_bill_pkr: num(col(r, 'Actual Bill', 'Bill', 'Bill Amount', 'Actual Bill PKR', 'Invoice Amount', 'Amount')),
        payment_status: payment(col(r, 'Payment', 'Payment Status', 'Paid')),
        notes: str(col(r, 'Notes', 'Note', 'Comments')),
        archived: statusText.startsWith('archiv'),
      })
    })
  }

  // ---- Batch Product Checklist (+ Checklist Archive) → items
  const items: PlanItem[] = []
  const readChecklist = (sheet: [string, Row[]] | null, archived: boolean) => {
    if (!sheet) return
    sheetsFound.push(sheet[0])
    let lastRef: string | null = null
    sheet[1].forEach((r, i) => {
      const refCell = str(col(r, 'Batch Ref', 'Batch', 'Ref', 'Batch ID', 'Batch No'))
      const ref = refCell ?? lastRef // tolerate merged / blank-repeat batch cells
      const name = str(col(r, 'Product', 'Product Name', 'Item', 'Item Name', 'Product Title', 'Title', 'Name'))
      if (!name) return
      if (!ref) {
        warnings.push(`${sheet[0]} row ${i + 2}: “${name}” has no batch — skipped`)
        return
      }
      lastRef = ref
      if (!batches.has(ref.toLowerCase())) {
        const date = toISODate(col(r, 'Batch Date', 'Date'))
        batches.set(ref.toLowerCase(), {
          ref, batch_date: date ?? today, supplier: null, invoice_ref: null, actual_bill_pkr: null, payment_status: 'unpaid', notes: null, archived,
        })
        warnings.push(`Batch ${ref} only appears in ${sheet[0]} — it will be created`)
      }
      if (archived) batches.get(ref.toLowerCase())!.archived = true
      const from = source(col(r, 'Received From', 'Source', 'From', 'Fulfilled From', 'Supplier/Return'))
      const status = itemStatus(col(r, 'Status', 'Received', 'Done', 'Check'), from)
      const qty = Math.max(1, Math.trunc(num(col(r, 'Qty', 'Quantity', 'Pcs', 'Pieces', 'Units')) ?? 1))
      items.push({
        batch_ref: batches.get(ref.toLowerCase())!.ref,
        product_name: name.slice(0, 300),
        qty,
        status,
        received_from: status === 'received' ? (from ?? 'supplier') : null,
        received_date: status === 'received' ? (toISODate(col(r, 'Received Date', 'Date Received', 'Received On')) ?? batches.get(ref.toLowerCase())!.batch_date) : null,
        category: canonicalCat(str(col(r, 'Category', 'Type'))),
        notes: str(col(r, 'Notes', 'Note', 'Comments')),
      })
    })
  }
  readChecklist(findSheet(sheets, 'Batch Product Checklist', 'Product Checklist', 'Checklist'), false)
  readChecklist(findSheet(sheets, 'Checklist Archive', 'Archive'), true)

  // A batch whose register row is archived OR whose items only live in the archive is archived.
  const skippedRefs = [...batches.values()].filter((b) => existingRefs.has(b.ref.toLowerCase())).map((b) => b.ref)
  if (skippedRefs.length) warnings.push(`${skippedRefs.length} batch ref(s) already exist and will be skipped with their items: ${skippedRefs.slice(0, 10).join(', ')}${skippedRefs.length > 10 ? '…' : ''}`)
  const newBatches = [...batches.values()].filter((b) => !existingRefs.has(b.ref.toLowerCase()))
  const newRefSet = new Set(newBatches.map((b) => b.ref.toLowerCase()))
  const newItems = items.filter((it) => newRefSet.has(it.batch_ref.toLowerCase()))

  // ---- Return Stock Received
  const returns: PlanReturn[] = []
  const ret = findSheet(sheets, 'Return Stock Received', 'Returns Received', 'Return Stock', 'Returns')
  if (ret) {
    sheetsFound.push(ret[0])
    const knownCats = () => [...existingCats.values(), ...[...catByLower.values()].map((c) => c.name)]
    ret[1].forEach((r, i) => {
      const date = toISODate(col(r, 'Date', 'Received Date', 'Date Received'))
      const reference = str(col(r, 'Reference', 'Ref', 'Parcel', 'Courier Ref', 'Batch'))
      const notes = str(col(r, 'Notes', 'Note'))
      const catCell = str(col(r, 'Category', 'Type'))
      const lines: PlanReturn['lines'] = []
      if (catCell) {
        const q = num(col(r, 'Qty', 'Quantity', 'Pcs', 'Pieces'))
        if (q && q > 0) lines.push({ category: canonicalCat(catCell)!, qty: Math.trunc(q) })
      } else {
        // Wide layout: one column per category.
        for (const c of knownCats()) {
          const q = num(col(r, c))
          if (q && q > 0) lines.push({ category: c, qty: Math.trunc(q) })
        }
      }
      if (!lines.length) return
      if (!date) warnings.push(`${ret[0]} row ${i + 2}: no readable date — using today`)
      const prev = returns.at(-1)
      if (catCell && prev && prev.date === (date ?? today) && prev.reference === reference) prev.lines.push(...lines)
      else returns.push({ date: date ?? today, reference, notes, lines })
    })
  }

  // ---- Opening Stock
  const opening: PlanOpening[] = []
  const op = findSheet(sheets, 'Opening Stock', 'Opening', 'Stock')
  if (op) {
    sheetsFound.push(op[0])
    op[1].forEach((r, i) => {
      const cat = canonicalCat(str(col(r, 'Category', 'Type', 'Product')))
      const qty = num(col(r, 'Qty', 'Quantity', 'Opening', 'Opening Stock', 'Stock', 'Pcs'))
      if (!cat || qty == null || qty === 0) {
        if (cat && qty == null) warnings.push(`${op[0]} row ${i + 2}: no quantity for ${cat} — skipped`)
        return
      }
      opening.push({ date: toISODate(col(r, 'Date', 'As of')) ?? today, category: cat, qty: Math.trunc(qty), kind: 'opening', notes: str(col(r, 'Notes', 'Note')) })
    })
  }

  if (!sheetsFound.length) warnings.push('No recognised sheets found. Expected: Batch Register, Batch Product Checklist, Checklist Archive, Product Rules & Costs, Return Stock Received, Opening Stock.')

  return {
    categories: [...catByLower.values()],
    rules,
    batches: newBatches,
    items: newItems,
    returns,
    opening,
    warnings,
    sheetsFound,
  }
}
