/**
 * Product classification.
 *  - A rule matches when the product name contains its keyword (case-insensitive plain substring).
 *  - Among active matching rules the LONGEST keyword wins; ties go to the rule created first.
 *  - A category override beats every rule.
 *  - No match → Unmatched (category null, cost 0).
 */

export interface ClassifyRule {
  id: string
  keyword: string
  category_id: string
  cost_override_pkr: number | null
  active: boolean
  created_seq: number
}

export interface ClassifyCategory {
  id: string
  default_cost_pkr: number
}

export interface Classification {
  categoryId: string | null
  ruleId: string | null
  unitCost: number
  unmatched: boolean
  source: 'override' | 'rule' | 'none'
}

const norm = (s: string) => s.trim().toLocaleLowerCase('en')

/** Returns the winning rule for a product name, or null. */
export function findWinningRule<R extends ClassifyRule>(productName: string, rules: readonly R[]): R | null {
  const name = norm(productName)
  if (!name) return null
  let best: R | null = null
  for (const r of rules) {
    if (!r.active) continue
    const kw = norm(r.keyword)
    if (!kw || !name.includes(kw)) continue
    if (
      !best ||
      kw.length > norm(best.keyword).length ||
      (kw.length === norm(best.keyword).length && r.created_seq < best.created_seq)
    ) {
      best = r
    }
  }
  return best
}

/** Unit cost: rule override if set, else the category default. */
export function unitCost(
  categoryId: string | null,
  rule: Pick<ClassifyRule, 'cost_override_pkr' | 'category_id'> | null,
  categories: readonly ClassifyCategory[],
): number {
  if (!categoryId) return 0
  if (rule && rule.category_id === categoryId && rule.cost_override_pkr != null) return rule.cost_override_pkr
  return categories.find((c) => c.id === categoryId)?.default_cost_pkr ?? 0
}

export function classify(
  productName: string,
  rules: readonly ClassifyRule[],
  categories: readonly ClassifyCategory[],
  overrideCategoryId: string | null = null,
): Classification {
  if (overrideCategoryId && categories.some((c) => c.id === overrideCategoryId)) {
    // The override decides the category; a matching rule for the same category may still supply a cost override.
    const rule = findWinningRule(productName, rules)
    const sameCatRule = rule && rule.category_id === overrideCategoryId ? rule : null
    return {
      categoryId: overrideCategoryId,
      ruleId: sameCatRule?.id ?? null,
      unitCost: unitCost(overrideCategoryId, sameCatRule, categories),
      unmatched: false,
      source: 'override',
    }
  }
  const rule = findWinningRule(productName, rules)
  if (!rule || !categories.some((c) => c.id === rule.category_id)) {
    return { categoryId: null, ruleId: null, unitCost: 0, unmatched: true, source: 'none' }
  }
  return {
    categoryId: rule.category_id,
    ruleId: rule.id,
    unitCost: unitCost(rule.category_id, rule, categories),
    unmatched: false,
    source: 'rule',
  }
}

export interface ReapplyItem {
  id: string
  product_name: string
  category_override_id: string | null
  resolved_category_id: string | null
  matched_rule_id: string | null
  unit_cost_pkr: number
}

export interface ReapplyChange {
  id: string
  resolved_category_id: string | null
  matched_rule_id: string | null
  unit_cost_pkr: number
}

/**
 * Items (already filtered to ACTIVE batches by the caller) whose classification or cost snapshot
 * would change under the current rules/categories. Archived batches must never be passed in.
 */
export function itemsNeedingReapply(
  items: readonly ReapplyItem[],
  rules: readonly ClassifyRule[],
  categories: readonly ClassifyCategory[],
): ReapplyChange[] {
  const out: ReapplyChange[] = []
  for (const it of items) {
    const c = classify(it.product_name, rules, categories, it.category_override_id)
    if (
      c.categoryId !== it.resolved_category_id ||
      c.ruleId !== it.matched_rule_id ||
      Math.abs(c.unitCost - it.unit_cost_pkr) > 0.0001
    ) {
      out.push({ id: it.id, resolved_category_id: c.categoryId, matched_rule_id: c.ruleId, unit_cost_pkr: c.unitCost })
    }
  }
  return out
}
