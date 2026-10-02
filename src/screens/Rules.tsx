import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, FlaskConical, Plus, RefreshCcw, Tags, Trash2, TriangleAlert, Wand2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { PageHeader } from '../components/AppShell'
import { useConfirm } from '../components/Confirm'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { Button, Card, EmptyState, ListSkeleton, Pill, SectionTitle, SelectField, TextArea, TextField, Toggle } from '../components/ui'
import { useApplyClassifications, useDeleteRule, useReorder, useSaveCategory, useSaveRule } from '../data/mutations'
import { fetchActiveItems, useCategories, useRules, useUnmatchedNames } from '../data/queries'
import { classify, findWinningRule, itemsNeedingReapply } from '../domain/classify'
import { formatInt, formatPKR } from '../domain/format'
import { CategoryForm, RuleForm, type Category, type Rule } from '../domain/schemas'
import { useOnline } from '../lib/hooks'
import { useWorkspaceId } from '../lib/workspace'

export default function Rules() {
  const cats = useCategories()
  const rules = useRules()
  const unmatched = useUnmatchedNames()
  const online = useOnline()
  const categories = useMemo(() => cats.data ?? [], [cats.data])
  const ruleList = useMemo(() => rules.data ?? [], [rules.data])
  const [ruleSheet, setRuleSheet] = useState<{ rule?: Rule; keyword?: string } | null>(null)
  const [catSheet, setCatSheet] = useState<{ cat?: Category } | null>(null)
  const [test, setTest] = useState('')
  const reorderRules = useReorder('keyword_rules')
  const reorderCats = useReorder('categories')
  const saveRule = useSaveRule()

  const testResult = useMemo(() => {
    if (!test.trim()) return null
    const rule = findWinningRule(test, ruleList)
    const c = classify(test, ruleList, categories)
    return { rule, c, cat: categories.find((x) => x.id === c.categoryId) }
  }, [test, ruleList, categories])

  const move = <T extends { id: string }>(list: T[], i: number, dir: -1 | 1) => {
    const next = [...list]
    const j = i + dir
    if (j < 0 || j >= next.length) return null
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    return next.map((x) => x.id)
  }

  return (
    <>
      <PageHeader title="Rules & categories" back />
      <ReapplyCard rules={ruleList} categories={categories} />

      <SectionTitle>Test a product name</SectionTitle>
      <Card className="flex flex-col gap-3">
        <TextField label="Product name" placeholder="e.g. Oversized Hoodie - Black / XL" value={test} onChange={(e) => setTest(e.target.value)} />
        {testResult && (
          <div className="flex items-start gap-2 text-sm" role="status">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            {testResult.cat ? (
              <p>
                Winning rule <strong>“{testResult.rule?.keyword}”</strong> → <strong>{testResult.cat.name}</strong> at{' '}
                <strong>{formatPKR(testResult.c.unitCost)}</strong>
                {testResult.rule?.cost_override_pkr != null ? ' (rule cost override)' : ' (category default)'}
              </p>
            ) : (
              <p className="text-warn">
                <strong>Unmatched</strong> — no active keyword is contained in this name.
              </p>
            )}
          </div>
        )}
      </Card>

      <SectionTitle>Unmatched names in active batches</SectionTitle>
      {unmatched.isPending ? (
        <ListSkeleton rows={2} />
      ) : !unmatched.data?.length ? (
        <p className="px-1 text-sm text-muted">Everything is matched. 🎉</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {unmatched.data.map((u) => (
            <li key={u.product_name}>
              <Card className="flex items-center gap-3 p-3">
                <TriangleAlert className="size-4 shrink-0 text-warn" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm font-medium">{u.product_name}</div>
                  <div className="text-xs text-muted">
                    {u.lines} line{u.lines === 1 ? '' : 's'} · {formatInt(u.pieces)} pcs
                  </div>
                </div>
                <Button icon={Wand2} disabled={!online} onClick={() => setRuleSheet({ keyword: u.product_name })}>
                  Create rule
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle
        action={
          <Button variant="ghost" icon={Plus} disabled={!online || !categories.length} onClick={() => setRuleSheet({})}>
            Add rule
          </Button>
        }
      >
        Keyword rules
      </SectionTitle>
      <p className="mb-2 px-1 text-xs text-muted">
        A product matches when its name contains the keyword (not case-sensitive). The longest matching keyword wins; ties go to the older rule.
      </p>
      {rules.isPending ? (
        <ListSkeleton rows={4} />
      ) : !ruleList.length ? (
        <EmptyState icon={Tags} title="No rules yet">Add a keyword such as “Hoodie” and choose its category.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {ruleList.map((r, i) => {
            const cat = categories.find((c) => c.id === r.category_id)
            return (
              <li key={r.id}>
                <Card className={`flex items-center gap-2 p-2 pl-3 ${r.active ? '' : 'opacity-60'}`}>
                  <button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={() => setRuleSheet({ rule: r })} disabled={!online}>
                    <div className="truncate text-sm font-semibold">“{r.keyword}”</div>
                    <div className="text-xs text-muted">
                      → {cat?.name ?? '?'} · {r.cost_override_pkr != null ? `${formatPKR(r.cost_override_pkr)} override` : formatPKR(cat?.default_cost_pkr ?? 0)}
                      {r.supplier ? ` · ${r.supplier}` : ''}
                      {!r.active && ' · disabled'}
                    </div>
                  </button>
                  <label className="flex min-h-11 items-center gap-1 text-xs text-muted">
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--c-ok)]"
                      checked={r.active}
                      disabled={!online}
                      onChange={(e) => saveRule.mutate({ id: r.id, values: { active: e.target.checked } })}
                    />
                    <span className="sr-only">Rule “{r.keyword}” active</span>
                  </label>
                  <Button size="icon" variant="ghost" icon={ArrowUp} aria-label={`Move “${r.keyword}” up`} disabled={!online || i === 0} onClick={() => { const ids = move(ruleList, i, -1); if (ids) reorderRules.mutate(ids) }} />
                  <Button size="icon" variant="ghost" icon={ArrowDown} aria-label={`Move “${r.keyword}” down`} disabled={!online || i === ruleList.length - 1} onClick={() => { const ids = move(ruleList, i, 1); if (ids) reorderRules.mutate(ids) }} />
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <SectionTitle
        action={
          <Button variant="ghost" icon={Plus} disabled={!online} onClick={() => setCatSheet({})}>
            Add category
          </Button>
        }
      >
        Categories
      </SectionTitle>
      {cats.isPending ? (
        <ListSkeleton rows={3} />
      ) : (
        <ul className="flex flex-col gap-2">
          {categories.map((c, i) => (
            <li key={c.id}>
              <Card className="flex items-center gap-2 p-2 pl-3">
                <button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={() => setCatSheet({ cat: c })} disabled={!online}>
                  <div className="truncate text-sm font-semibold">{c.name}</div>
                  <div className="text-xs text-muted">
                    Default {formatPKR(c.default_cost_pkr)} · low stock ≤ {c.low_stock_level}
                  </div>
                </button>
                <Button size="icon" variant="ghost" icon={ArrowUp} aria-label={`Move ${c.name} up`} disabled={!online || i === 0} onClick={() => { const ids = move(categories, i, -1); if (ids) reorderCats.mutate(ids) }} />
                <Button size="icon" variant="ghost" icon={ArrowDown} aria-label={`Move ${c.name} down`} disabled={!online || i === categories.length - 1} onClick={() => { const ids = move(categories, i, 1); if (ids) reorderCats.mutate(ids) }} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <RuleSheet state={ruleSheet} onClose={() => setRuleSheet(null)} categories={categories} nextOrder={ruleList.length + 1} />
      <CategorySheet state={catSheet} onClose={() => setCatSheet(null)} nextOrder={categories.length + 1} />
    </>
  )
}

/** Shows "Re-apply rules to N items in active batches" whenever rules/costs differ from item snapshots. */
function ReapplyCard({ rules, categories }: { rules: Rule[]; categories: Category[] }) {
  const ws = useWorkspaceId()
  const apply = useApplyClassifications()
  const toast = useToast()
  const online = useOnline()
  const sig = rules.map((r) => r.updated_at).join() + categories.map((c) => c.updated_at).join()
  const check = useQuery({
    queryKey: ['reapply-check', ws, sig],
    enabled: rules.length > 0 && categories.length > 0 && online,
    queryFn: async () => itemsNeedingReapply(await fetchActiveItems(ws), rules, categories),
    staleTime: 0,
    gcTime: 0,
  })
  const changes = check.data ?? []
  if (!changes.length) return null
  return (
    <Card className="flex flex-col gap-3 border-warn/40 bg-warn-bg">
      <p className="text-sm text-warn">
        <strong>{changes.length}</strong> item{changes.length === 1 ? '' : 's'} in active batches would get a different category or cost under the current rules.
        Archived batches are never changed.
      </p>
      <Button
        variant="primary"
        icon={RefreshCcw}
        loading={apply.isPending}
        disabled={!online}
        onClick={() =>
          apply.mutate(changes, {
            onSuccess: (n) => {
              toast({ tone: 'success', message: `Updated ${n} item${n === 1 ? '' : 's'}` })
              void check.refetch()
            },
          })
        }
      >
        Re-apply rules to {changes.length} item{changes.length === 1 ? '' : 's'} in active batches
      </Button>
    </Card>
  )
}

function RuleSheet({ state, onClose, categories, nextOrder }: { state: { rule?: Rule; keyword?: string } | null; onClose: () => void; categories: Category[]; nextOrder: number }) {
  const save = useSaveRule()
  const del = useDeleteRule()
  const [confirmEl, confirm] = useConfirm()
  const [form, setForm] = useState({ keyword: '', category_id: '', cost_override_pkr: '', supplier: '', active: true, notes: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [shown, setShown] = useState<object | null>(null)
  if (state && state !== shown) {
    setShown(state)
    const r = state.rule
    setForm({
      keyword: r?.keyword ?? state.keyword ?? '',
      category_id: r?.category_id ?? categories[0]?.id ?? '',
      cost_override_pkr: r?.cost_override_pkr != null ? String(r.cost_override_pkr) : '',
      supplier: r?.supplier ?? '',
      active: r?.active ?? true,
      notes: r?.notes ?? '',
    })
    setErrors({})
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = RuleForm.safeParse(form)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    save.mutate({ id: state?.rule?.id, values: parsed.data, sort_order: state?.rule ? undefined : nextOrder }, { onSuccess: onClose })
  }

  return (
    <Sheet
      open={!!state}
      onOpenChange={(o) => !o && onClose()}
      title={state?.rule ? 'Edit rule' : 'New rule'}
      footer={
        <div className="flex gap-2">
          {state?.rule && (
            <Button
              variant="danger"
              icon={Trash2}
              aria-label="Delete rule"
              onClick={async () => {
                if (await confirm({ title: `Delete rule “${state.rule!.keyword}”?`, description: 'Existing items keep their category until you re-apply rules.', confirmLabel: 'Delete', danger: true }))
                  del.mutate(state.rule!.id, { onSuccess: onClose })
              }}
            />
          )}
          <Button type="submit" form="rule-form" variant="primary" size="lg" block loading={save.isPending}>
            Save rule
          </Button>
        </div>
      }
    >
      <form id="rule-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Keyword" hint="Plain text the product name must contain" value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} error={errors.keyword} />
        <SelectField label="Category" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} error={errors.category_id}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({formatPKR(c.default_cost_pkr)})
            </option>
          ))}
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Cost override (PKR)" hint="Blank = category default" inputMode="decimal" value={form.cost_override_pkr} onChange={(e) => setForm({ ...form, cost_override_pkr: e.target.value })} error={errors.cost_override_pkr} />
          <TextField label="Supplier" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
        </div>
        <Toggle label="Active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
        <TextArea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </form>
      {confirmEl}
    </Sheet>
  )
}

function CategorySheet({ state, onClose, nextOrder }: { state: { cat?: Category } | null; onClose: () => void; nextOrder: number }) {
  const save = useSaveCategory()
  const [form, setForm] = useState({ name: '', default_cost_pkr: '0', low_stock_level: '20' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [shown, setShown] = useState<object | null>(null)
  if (state && state !== shown) {
    setShown(state)
    setForm({
      name: state.cat?.name ?? '',
      default_cost_pkr: String(state.cat?.default_cost_pkr ?? 0),
      low_stock_level: String(state.cat?.low_stock_level ?? 20),
    })
    setErrors({})
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = CategoryForm.safeParse(form)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    save.mutate({ id: state?.cat?.id, values: { ...parsed.data, ...(state?.cat ? {} : { sort_order: nextOrder }) } }, { onSuccess: onClose })
  }
  return (
    <Sheet
      open={!!state}
      onOpenChange={(o) => !o && onClose()}
      title={state?.cat ? `Edit ${state.cat.name}` : 'New category'}
      description={state?.cat ? 'Changing the default cost does not change existing items until you re-apply rules.' : undefined}
      footer={
        <Button type="submit" form="cat-form" variant="primary" size="lg" block loading={save.isPending}>
          Save category
        </Button>
      }
    >
      <form id="cat-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Default cost (PKR)" inputMode="decimal" value={form.default_cost_pkr} onChange={(e) => setForm({ ...form, default_cost_pkr: e.target.value })} error={errors.default_cost_pkr} />
          <TextField label="Low-stock level" inputMode="numeric" value={form.low_stock_level} onChange={(e) => setForm({ ...form, low_stock_level: e.target.value })} error={errors.low_stock_level} />
        </div>
        <Pill tone="neutral">Stock at or below the low-stock level shows amber; below 0 shows red.</Pill>
      </form>
    </Sheet>
  )
}
