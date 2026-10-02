import { Plus, Scale, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { PageHeader } from '../components/AppShell'
import { useConfirm } from '../components/Confirm'
import { Sheet } from '../components/Sheet'
import { Button, Card, EmptyState, ListSkeleton, SectionTitle, SelectField, TextField } from '../components/ui'
import { useDeleteRow, useSaveAdjustment } from '../data/mutations'
import { useAdjustments, useCategories } from '../data/queries'
import { todayISO } from '../domain/dates'
import { formatDate } from '../domain/format'
import { AdjustmentForm } from '../domain/schemas'
import { useOnline } from '../lib/hooks'

export default function Stock() {
  const cats = useCategories()
  const adj = useAdjustments()
  const del = useDeleteRow('stock_adjustments')
  const save = useSaveAdjustment()
  const online = useOnline()
  const [confirmEl, confirm] = useConfirm()
  const [open, setOpen] = useState(false)
  const categories = cats.data ?? []
  const [form, setForm] = useState({ date: todayISO(), category_id: '', qty: '', kind: 'opening' as 'opening' | 'adjustment', notes: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const start = (kind: 'opening' | 'adjustment') => {
    setForm({ date: todayISO(), category_id: categories[0]?.id ?? '', qty: '', kind, notes: '' })
    setErrors({})
    setOpen(true)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = AdjustmentForm.safeParse(form)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    save.mutate({ values: parsed.data }, { onSuccess: () => setOpen(false) })
  }

  return (
    <>
      <PageHeader title="Opening stock & adjustments" back />
      <Card className="flex flex-col gap-3 text-sm">
        <p className="text-muted">
          Stock per category = opening/adjustments + returns received + made by supplier − used. Use an <strong>opening</strong> entry once per category when
          you start, and <strong>adjustments</strong> (positive or negative) after a stock count.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" icon={Plus} disabled={!online || !categories.length} onClick={() => start('opening')}>
            Opening stock
          </Button>
          <Button icon={Scale} disabled={!online || !categories.length} onClick={() => start('adjustment')}>
            Adjustment
          </Button>
        </div>
      </Card>

      <SectionTitle>History</SectionTitle>
      {adj.isPending ? (
        <ListSkeleton rows={3} />
      ) : !adj.data?.length ? (
        <EmptyState icon={Scale} title="No entries yet">Add your opening stock for each category to get accurate stock levels.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {adj.data.map((a) => (
            <li key={a.id}>
              <Card className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">
                    {categories.find((c) => c.id === a.category_id)?.name ?? '?'} · {a.kind === 'opening' ? 'Opening' : 'Adjustment'}
                  </div>
                  <div className="text-xs text-muted">
                    {formatDate(a.date)}
                    {a.notes ? ` · ${a.notes}` : ''}
                  </div>
                </div>
                <span className={`tabular text-base font-semibold ${a.qty < 0 ? 'text-bad' : ''}`}>
                  {a.qty > 0 ? '+' : '−'}
                  {Math.abs(a.qty)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  icon={Trash2}
                  aria-label="Delete entry"
                  disabled={!online}
                  onClick={async () => {
                    if (await confirm({ title: 'Delete this stock entry?', confirmLabel: 'Delete', danger: true })) del.mutate(a.id)
                  }}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={form.kind === 'opening' ? 'Opening stock' : 'Stock adjustment'}
        footer={
          <Button type="submit" form="adj-form" variant="primary" size="lg" block loading={save.isPending}>
            Save
          </Button>
        }
      >
        <form id="adj-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} error={errors.date} />
            <SelectField label="Type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'opening' | 'adjustment' })}>
              <option value="opening">Opening</option>
              <option value="adjustment">Adjustment</option>
            </SelectField>
          </div>
          <SelectField label="Category" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} error={errors.category_id}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Quantity"
            hint={form.kind === 'adjustment' ? 'Use a minus sign to reduce stock, e.g. -3' : undefined}
            inputMode="numeric"
            value={form.qty}
            onChange={(e) => setForm({ ...form, qty: e.target.value.replace(/[^\d-]/g, '') })}
            error={errors.qty}
          />
          <TextField label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </form>
      </Sheet>
      {confirmEl}
    </>
  )
}
