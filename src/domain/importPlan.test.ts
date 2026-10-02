import { describe, expect, it } from 'vitest'
import { buildImportPlan, num, toISODate } from './importPlan'

const existing = { categoryNames: ['T-shirt', 'Hoodie', 'Trouser', 'Other 1', 'Other 2'], ruleKeys: ['hoodie|hoodie'], batchRefs: ['HW-1000'], categoryCosts: { 't-shirt': 850, hoodie: 1400 } }

describe('toISODate', () => {
  it.each([
    [new Date(2026, 8, 10), '2026-09-10'],
    ['2026-09-10', '2026-09-10'],
    ['10-Sep-26', '2026-09-10'],
    ['10 Sept 2026', '2026-09-10'],
    ['10/09/2026', '2026-09-10'], // day-first
    [46275, '2026-09-10'], // Excel serial
    ['31/02/2026', null],
    ['soon', null],
    [null, null],
  ])('%j → %j', (input, out) => expect(toISODate(input)).toBe(out))
})

describe('num', () => {
  it('parses PKR strings', () => {
    expect(num('PKR 1,400')).toBe(1400)
    expect(num('Rs. 850')).toBe(850)
    expect(num('-')).toBeNull()
    expect(num('')).toBeNull()
  })
})

describe('buildImportPlan', () => {
  const sheets = {
    'Product Rules & Costs': [
      { Keyword: 'Hoodie', Category: 'Hoodie', 'Cost (PKR)': 1400 }, // already exists → skipped
      { Keyword: 'Cap', Category: 'Accessories', 'Cost (PKR)': 300 }, // new category
      { Keyword: 'Bad row' },
      { Keyword: 'Heavyweight Tee', Category: 't-shirt', 'Cost (PKR)': 1100 }, // differs from default → override
      { Keyword: 'Graphic Tee', Category: 'T-shirt', 'Cost (PKR)': 850 }, // same as default → no override
      { Keyword: 'Beanie', Category: 'Accessories', 'Cost (PKR)': 250 },
    ],
    'Batch Register': [
      { 'Batch Ref': 'HW-1012', Date: '10-Sep-26', Supplier: 'Ali Garments', 'Actual Bill': 'PKR 5,000', Payment: 'Partially paid' },
      { 'Batch Ref': 'HW-1000', Date: '01-Sep-26' }, // exists → skipped
    ],
    'Batch Product Checklist': [
      { Batch: 'HW-1012', Product: 'Oversized Tee - Black / L', Qty: 2, Status: 'Received', 'Received From': 'Return' },
      { Batch: '', Product: 'Cargo Trouser', Qty: '', Status: 'Pending' }, // inherits previous batch
      { Batch: 'HW-1000', Product: 'Old', Status: 'Received' },
    ],
    'Checklist Archive': [{ Batch: 'HW-0900', Product: 'Graphic Tee', Status: 'Received', 'Received From': 'Supplier', Date: '01-Aug-26' }],
    'Return Stock Received': [
      { Date: '11-Sep-26', Reference: 'POSTEX-11SEP', 'T-shirt': 3, Hoodie: 1 },
      { Date: '12-Sep-26', Reference: 'P2', Category: 'Trouser', Qty: 2 },
    ],
    'Opening Stock': [
      { Category: 'T-shirt', Qty: 40 },
      { Category: 'Hoodie', Qty: '' },
    ],
  }
  const plan = buildImportPlan(sheets, existing, '2026-10-02')

  it('finds all sheets', () => expect(plan.sheetsFound).toHaveLength(6))

  it('creates only new categories and rules', () => {
    expect(plan.categories).toEqual([{ name: 'Accessories', default_cost_pkr: 300 }])
    expect(plan.rules.map((r) => [r.keyword, r.category, r.cost_override_pkr])).toEqual([
      ['Cap', 'Accessories', null],
      ['Heavyweight Tee', 'T-shirt', 1100],
      ['Graphic Tee', 'T-shirt', null],
      ['Beanie', 'Accessories', 250],
    ])
  })

  it('maps batches, skipping existing refs, and archives batches from the archive sheet', () => {
    expect(plan.batches.map((b) => b.ref)).toEqual(['HW-1012', 'HW-0900'])
    expect(plan.batches[0]).toMatchObject({ batch_date: '2026-09-10', actual_bill_pkr: 5000, payment_status: 'partially_paid', archived: false })
    expect(plan.batches[1]).toMatchObject({ archived: true, batch_date: '2026-08-01' })
  })

  it('maps items with status, source and default qty', () => {
    expect(plan.items).toHaveLength(3)
    expect(plan.items[0]).toMatchObject({ batch_ref: 'HW-1012', qty: 2, status: 'received', received_from: 'return', received_date: '2026-09-10' })
    expect(plan.items[1]).toMatchObject({ batch_ref: 'HW-1012', product_name: 'Cargo Trouser', qty: 1, status: 'pending', received_from: null })
    expect(plan.items[2]).toMatchObject({ batch_ref: 'HW-0900', received_from: 'supplier' })
  })

  it('reads wide and long return layouts', () => {
    expect(plan.returns).toEqual([
      { date: '2026-09-11', reference: 'POSTEX-11SEP', notes: null, lines: [{ category: 'T-shirt', qty: 3 }, { category: 'Hoodie', qty: 1 }] },
      { date: '2026-09-12', reference: 'P2', notes: null, lines: [{ category: 'Trouser', qty: 2 }] },
    ])
  })

  it('reads opening stock and warns on blanks', () => {
    expect(plan.opening).toEqual([{ date: '2026-10-02', category: 'T-shirt', qty: 40, kind: 'opening', notes: null }])
    expect(plan.warnings.join('\n')).toMatch(/no quantity for Hoodie/)
    expect(plan.warnings.join('\n')).toMatch(/already exist/)
    expect(plan.warnings.join('\n')).toMatch(/needs both a keyword and a category/)
  })

  it('empty workbook → helpful warning', () => {
    const p = buildImportPlan({ Sheet1: [] }, existing, '2026-10-02')
    expect(p.warnings[0]).toMatch(/No recognised sheets/)
  })
})
