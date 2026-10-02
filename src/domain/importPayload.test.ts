import { describe, expect, it } from 'vitest'
import type { ImportPlan } from './importPlan'
import { planToPayload } from './importPayload'

const base: ImportPlan = { categories: [], rules: [], batches: [], items: [], returns: [], opening: [], warnings: [], sheetsFound: [] }
const item = (product_name: string, category: string | null = null) => ({
  batch_ref: 'HW-1', product_name, qty: 1, status: 'pending' as const, received_from: null, received_date: null, category, notes: null,
})

describe('planToPayload', () => {
  const cats = [{ name: 'T-shirt', default_cost_pkr: 850 }, { name: 'Hoodie', default_cost_pkr: 1400 }]
  const rules = [
    { keyword: 'Hoodie', categoryName: 'Hoodie', cost_override_pkr: null, active: true, created_seq: 1 },
    { keyword: 'Tee', categoryName: 'T-shirt', cost_override_pkr: null, active: true, created_seq: 2 },
  ]

  it('classifies with existing + imported rules (longest keyword wins)', () => {
    const plan = {
      ...base,
      categories: [{ name: 'Accessories', default_cost_pkr: 300 }],
      rules: [{ keyword: 'Tee Cap', category: 'Accessories', cost_override_pkr: null, supplier: null, active: true, notes: null }],
      items: [item('Logo Tee Cap'), item('Oversized Tee')],
    }
    const { payload, stats } = planToPayload(plan, cats, rules)
    expect(payload.items[0]).toMatchObject({ resolved_category: 'Accessories', rule_keyword: 'Tee Cap', unit_cost_pkr: 300, override_category: null })
    expect(payload.items[1]).toMatchObject({ resolved_category: 'T-shirt', rule_keyword: 'Tee', unit_cost_pkr: 850 })
    expect(stats).toEqual({ unmatched: 0, overrides: 0 })
  })

  it('keeps a workbook category that disagrees with the rules as an override', () => {
    const { payload, stats } = planToPayload({ ...base, items: [item('Hoodie Tee Combo', 'T-shirt')] }, cats, rules)
    expect(payload.items[0]).toMatchObject({ override_category: 'T-shirt', resolved_category: 'T-shirt', unit_cost_pkr: 850 })
    expect(stats.overrides).toBe(1)
  })

  it('counts unmatched items and ignores unknown workbook categories', () => {
    const { payload, stats } = planToPayload({ ...base, items: [item('Bucket Hat', 'Nonexistent')] }, cats, rules)
    expect(payload.items[0]).toMatchObject({ resolved_category: null, rule_keyword: null, unit_cost_pkr: 0, override_category: null })
    expect(stats.unmatched).toBe(1)
  })
})
