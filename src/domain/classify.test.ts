import { describe, expect, it } from 'vitest'
import { classify, findWinningRule, itemsNeedingReapply, unitCost, type ClassifyRule } from './classify'

const cats = [
  { id: 'tee', default_cost_pkr: 850 },
  { id: 'hoodie', default_cost_pkr: 1400 },
  { id: 'trouser', default_cost_pkr: 1000 },
]

let seq = 0
const rule = (keyword: string, category_id: string, extra: Partial<ClassifyRule> = {}): ClassifyRule => ({
  id: `r-${keyword}`,
  keyword,
  category_id,
  cost_override_pkr: null,
  active: true,
  created_seq: ++seq,
  ...extra,
})

const seedRules = [
  rule('Oversized Hoodie', 'hoodie'),
  rule('Hoodie', 'hoodie'),
  rule('Oversized Tee', 'tee'),
  rule('Graphic Tee', 'tee'),
  rule('Tee', 'tee'),
  rule('T-Shirt', 'tee'),
  rule('Trouser', 'trouser'),
]

describe('findWinningRule', () => {
  it('matches case-insensitive plain substrings', () => {
    expect(findWinningRule('Black OVERSIZED tee - L', seedRules)?.keyword).toBe('Oversized Tee')
    expect(findWinningRule('cargo trouser olive', seedRules)?.keyword).toBe('Trouser')
  })

  it('longest keyword wins when several match (overlapping keywords)', () => {
    expect(findWinningRule('Oversized Hoodie Washed', seedRules)?.keyword).toBe('Oversized Hoodie')
    expect(findWinningRule('Graphic Tee Sunset', seedRules)?.keyword).toBe('Graphic Tee')
  })

  it('ties go to the rule created first', () => {
    const a = rule('Cargo', 'trouser', { id: 'first', created_seq: 100 })
    const b = rule('Pants', 'trouser', { id: 'second', created_seq: 101 })
    expect(findWinningRule('Cargo Pants', [b, a])?.id).toBe('first')
  })

  it('ignores inactive rules', () => {
    const rules = [rule('Hoodie', 'hoodie', { active: false })]
    expect(findWinningRule('Zip Hoodie', rules)).toBeNull()
  })

  it('treats keywords literally — no wildcard or regex behaviour', () => {
    const rules = [rule('T.*', 'tee'), rule('(x)', 'tee')]
    expect(findWinningRule('Trouser', rules)).toBeNull()
    expect(findWinningRule('Hat (x) Edition', rules)?.keyword).toBe('(x)')
  })

  it('returns null for empty names and whitespace keywords', () => {
    expect(findWinningRule('   ', seedRules)).toBeNull()
    expect(findWinningRule('Anything', [rule('   ', 'tee')])).toBeNull()
  })
})

describe('classify', () => {
  it('uses the category default cost when no override', () => {
    const c = classify('Oversized Hoodie Black', seedRules, cats)
    expect(c).toMatchObject({ categoryId: 'hoodie', unitCost: 1400, unmatched: false, source: 'rule' })
  })

  it('uses the rule cost override when set', () => {
    const rules = [rule('Heavyweight Tee', 'tee', { cost_override_pkr: 1100 }), ...seedRules]
    expect(classify('Heavyweight Tee White', rules, cats).unitCost).toBe(1100)
  })

  it('a cost override of 0 is respected (not treated as missing)', () => {
    const rules = [rule('Sample', 'tee', { cost_override_pkr: 0 })]
    expect(classify('Sample Tee', rules, cats).unitCost).toBe(0)
  })

  it('category override beats rules', () => {
    const c = classify('Oversized Hoodie', seedRules, cats, 'trouser')
    expect(c).toMatchObject({ categoryId: 'trouser', unitCost: 1000, source: 'override', ruleId: null })
  })

  it('override keeps a same-category rule cost override', () => {
    const rules = [rule('Premium Hoodie', 'hoodie', { cost_override_pkr: 1800 })]
    expect(classify('Premium Hoodie', rules, cats, 'hoodie').unitCost).toBe(1800)
  })

  it('no match → Unmatched with cost 0', () => {
    expect(classify('Bucket Hat', seedRules, cats)).toEqual({
      categoryId: null, ruleId: null, unitCost: 0, unmatched: true, source: 'none',
    })
  })

  it('a rule pointing at a missing category is treated as unmatched', () => {
    expect(classify('Thing', [rule('Thing', 'gone')], cats).unmatched).toBe(true)
  })

  it('an override to an unknown category falls back to rules', () => {
    expect(classify('Graphic Tee', seedRules, cats, 'gone').categoryId).toBe('tee')
  })
})

describe('unitCost', () => {
  it('returns 0 without a category', () => {
    expect(unitCost(null, null, cats)).toBe(0)
  })
  it('ignores an override from a rule for another category', () => {
    expect(unitCost('tee', { category_id: 'hoodie', cost_override_pkr: 5 }, cats)).toBe(850)
  })
})

describe('itemsNeedingReapply', () => {
  it('only reports items whose snapshot would change', () => {
    const items = [
      { id: '1', product_name: 'Graphic Tee', category_override_id: null, resolved_category_id: 'tee', matched_rule_id: 'r-Graphic Tee', unit_cost_pkr: 850 },
      { id: '2', product_name: 'Bucket Hat', category_override_id: null, resolved_category_id: null, matched_rule_id: null, unit_cost_pkr: 0 },
      { id: '3', product_name: 'Oversized Hoodie', category_override_id: null, resolved_category_id: 'hoodie', matched_rule_id: 'r-Oversized Hoodie', unit_cost_pkr: 1300 },
    ]
    const changes = itemsNeedingReapply(items, seedRules, cats)
    expect(changes).toEqual([{ id: '3', resolved_category_id: 'hoodie', matched_rule_id: 'r-Oversized Hoodie', unit_cost_pkr: 1400 }])
  })

  it('picks up a new rule that now matches a previously unmatched item', () => {
    const items = [{ id: '2', product_name: 'Bucket Hat', category_override_id: null, resolved_category_id: null, matched_rule_id: null, unit_cost_pkr: 0 }]
    const rules = [...seedRules, rule('Hat', 'tee', { id: 'hat' })]
    expect(itemsNeedingReapply(items, rules, cats)[0]).toMatchObject({ resolved_category_id: 'tee', matched_rule_id: 'hat', unit_cost_pkr: 850 })
  })
})
