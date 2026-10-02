import { classify, type ClassifyRule } from './classify'
import type { ImportPlan } from './importPlan'

/**
 * Converts an import plan into the payload for the `import_workbook` RPC, classifying every item
 * with the SAME rules the app uses (existing rules + rules being imported). Items keep the
 * category from the workbook: when it differs from what the rules detect, it becomes an override.
 */
export function planToPayload(
  plan: ImportPlan,
  existingCategories: { name: string; default_cost_pkr: number }[],
  existingRules: { keyword: string; categoryName: string; cost_override_pkr: number | null; active: boolean; created_seq: number }[],
) {
  const cid = (name: string) => `cat:${name.toLowerCase()}`
  const cats = [
    ...existingCategories.map((c) => ({ id: cid(c.name), name: c.name, default_cost_pkr: c.default_cost_pkr })),
    ...plan.categories.map((c) => ({ id: cid(c.name), name: c.name, default_cost_pkr: c.default_cost_pkr ?? 0 })),
  ]
  const nameById = new Map(cats.map((c) => [c.id, c.name]))
  const maxSeq = existingRules.reduce((m, r) => Math.max(m, r.created_seq), 0)
  const rules: (ClassifyRule & { kw: string })[] = [
    ...existingRules.map((r, i) => ({
      id: `rule:e${i}`, kw: r.keyword, keyword: r.keyword, category_id: cid(r.categoryName), cost_override_pkr: r.cost_override_pkr, active: r.active, created_seq: r.created_seq,
    })),
    ...plan.rules.map((r, i) => ({
      id: `rule:n${i}`, kw: r.keyword, keyword: r.keyword, category_id: cid(r.category), cost_override_pkr: r.cost_override_pkr, active: r.active, created_seq: maxSeq + i + 1,
    })),
  ]
  const kwById = new Map(rules.map((r) => [r.id, r.kw]))

  let unmatched = 0
  let overrides = 0
  const items = plan.items.map((it) => {
    let override: string | null = null
    if (it.category && nameById.has(cid(it.category))) {
      const auto = classify(it.product_name, rules, cats)
      if (auto.categoryId !== cid(it.category)) override = cid(it.category)
    }
    const c = classify(it.product_name, rules, cats, override)
    if (c.unmatched) unmatched++
    if (override) overrides++
    return {
      batch_ref: it.batch_ref,
      product_name: it.product_name,
      qty: it.qty,
      status: it.status,
      received_from: it.received_from,
      received_date: it.received_date,
      override_category: override ? nameById.get(override)! : null,
      resolved_category: c.categoryId ? nameById.get(c.categoryId)! : null,
      rule_keyword: c.ruleId ? kwById.get(c.ruleId)! : null,
      unit_cost_pkr: c.unitCost,
      notes: it.notes,
    }
  })

  return {
    payload: {
      categories: plan.categories.map((c) => ({ name: c.name, default_cost_pkr: c.default_cost_pkr ?? 0 })),
      rules: plan.rules,
      batches: plan.batches,
      items,
      returns: plan.returns,
      opening: plan.opening,
    },
    stats: { unmatched, overrides },
  }
}
