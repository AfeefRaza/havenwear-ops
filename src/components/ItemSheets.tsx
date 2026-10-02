import { Ban, ClipboardPaste, RotateCcw, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useAddItems, useUpdateItem } from '../data/mutations'
import { classify } from '../domain/classify'
import { formatInt, formatPKR } from '../domain/format'
import { parsePaste } from '../domain/paste'
import { ItemForm, type Category, type Item, type Rule } from '../domain/schemas'
import { useOnline } from '../lib/hooks'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button, Pill, SelectField, TextArea, TextField } from './ui'

export function PasteSheet({
  open,
  onOpenChange,
  batchId,
  rules,
  categories,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  batchId: string
  rules: Rule[]
  categories: Category[]
}) {
  const [text, setText] = useState('')
  const add = useAddItems(batchId)
  const toast = useToast()
  const online = useOnline()

  const preview = useMemo(
    () =>
      parsePaste(text).map((l) => {
        const c = classify(l.name, rules, categories)
        return { ...l, c, cat: categories.find((x) => x.id === c.categoryId) }
      }),
    [text, rules, categories],
  )
  const pieces = preview.reduce((s, l) => s + l.qty, 0)
  const unmatched = preview.filter((l) => l.c.unmatched).length
  const estCost = preview.reduce((s, l) => s + l.qty * l.c.unitCost, 0)

  const submit = () => {
    add.mutate(
      { items: preview.map((l) => ({ product_name: l.name, qty: l.qty })), rules, categories },
      {
        onSuccess: (n) => {
          toast({ tone: 'success', message: `Added ${n} line${n === 1 ? '' : 's'} (${formatInt(pieces)} pcs)` })
          setText('')
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Bulk paste products"
      description="One product per line. Add “× 2” at the end or a tab + number for quantity."
      footer={
        <Button variant="primary" size="lg" block icon={ClipboardPaste} disabled={!preview.length || !online} loading={add.isPending} onClick={submit}>
          {preview.length ? `Add all ${preview.length} lines · ${formatInt(pieces)} pcs` : 'Add all'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <TextArea
          label="Shopify product names"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Oversized Tee - Black / L × 2\nOversized Hoodie - Grey / XL\nCargo Trouser\t3'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {preview.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Pill tone="neutral">{preview.length} lines</Pill>
              <Pill tone="neutral">{formatInt(pieces)} pieces</Pill>
              <Pill tone="neutral">Est. {formatPKR(estCost)}</Pill>
              {unmatched > 0 ? (
                <Pill tone="warn" icon={TriangleAlert}>
                  {unmatched} unmatched
                </Pill>
              ) : (
                <Pill tone="ok">All matched</Pill>
              )}
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border" aria-label="Preview">
              {preview.map((l) => (
                <li key={l.lineNo} className={`flex items-center gap-2 px-3 py-2 text-sm ${l.c.unmatched ? 'bg-warn-bg' : ''}`}>
                  <span className="tabular w-8 shrink-0 text-xs text-muted">{l.lineNo}</span>
                  <span className="min-w-0 flex-1 break-words">{l.name}</span>
                  <span className="tabular shrink-0 font-semibold">×{l.qty}</span>
                  {l.cat ? (
                    <span className="shrink-0 text-xs text-muted">{l.cat.name}</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-warn">
                      <TriangleAlert className="size-3.5" aria-hidden /> Unmatched
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {unmatched > 0 && (
              <p className="text-xs text-muted">
                Unmatched lines are still added (cost PKR 0) and flagged. Add a keyword rule in More → Rules, then “Re-apply rules”.
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}

export function ItemEditSheet({
  item,
  onClose,
  rules,
  categories,
  onStatus,
  onDelete,
  readOnly,
}: {
  item: Item | null
  onClose: () => void
  rules: Rule[]
  categories: Category[]
  onStatus: (item: Item, status: Item['status'], from?: 'supplier' | 'return') => void
  onDelete: (item: Item) => void
  readOnly?: boolean
}) {
  const update = useUpdateItem()
  const online = useOnline()
  const [form, setForm] = useState({ product_name: '', qty: '1', category_override_id: '', notes: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [shownId, setShownId] = useState<string | null>(null)
  if (item && item.id !== shownId) {
    setShownId(item.id)
    setForm({
      product_name: item.product_name,
      qty: String(item.qty),
      category_override_id: item.category_override_id ?? '',
      notes: item.notes ?? '',
    })
    setErrors({})
  }

  const preview = useMemo(
    () => classify(form.product_name, rules, categories, form.category_override_id || null),
    [form.product_name, form.category_override_id, rules, categories],
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!item) return
    const parsed = ItemForm.safeParse({ ...form, category_override_id: form.category_override_id || null })
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    update.mutate({ item, values: parsed.data, rules, categories }, { onSuccess: onClose })
  }

  const cat = categories.find((c) => c.id === preview.categoryId)

  return (
    <Sheet
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title="Edit item"
      footer={
        !readOnly && (
          <Button type="submit" form="item-form" variant="primary" size="lg" block loading={update.isPending} disabled={!online}>
            Save
          </Button>
        )
      }
    >
      {item && (
        <form id="item-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <TextArea
            label="Product name"
            rows={2}
            value={form.product_name}
            onChange={(e) => setForm({ ...form, product_name: e.target.value })}
            error={errors.product_name}
            disabled={readOnly}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Quantity"
              inputMode="numeric"
              value={form.qty}
              onChange={(e) => setForm({ ...form, qty: e.target.value.replace(/\D/g, '') })}
              error={errors.qty}
              disabled={readOnly}
            />
            <SelectField
              label="Category"
              value={form.category_override_id}
              onChange={(e) => setForm({ ...form, category_override_id: e.target.value })}
              hint={form.category_override_id ? 'Manual override' : 'From keyword rules'}
              disabled={readOnly}
            >
              <option value="">Auto (rules)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="text-sm">
            Detected:{' '}
            {cat ? (
              <strong>
                {cat.name} · {formatPKR(preview.unitCost)}
              </strong>
            ) : (
              <span className="font-semibold text-warn">Unmatched (PKR 0)</span>
            )}
          </p>
          <TextArea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={readOnly} />

          {!readOnly && (
            <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
              {item.status !== 'pending' && (
                <Button icon={Undo2} onClick={() => { onStatus(item, 'pending'); onClose() }} disabled={!online}>
                  Mark pending
                </Button>
              )}
              {item.status === 'pending' && (
                <Button icon={RotateCcw} onClick={() => { onStatus(item, 'received', 'return'); onClose() }} disabled={!online}>
                  From return
                </Button>
              )}
              {item.status !== 'cancelled' && (
                <Button icon={Ban} onClick={() => { onStatus(item, 'cancelled'); onClose() }} disabled={!online}>
                  Cancel item
                </Button>
              )}
              <Button variant="danger" icon={Trash2} onClick={() => { onDelete(item); onClose() }} disabled={!online}>
                Delete
              </Button>
            </div>
          )}
        </form>
      )}
    </Sheet>
  )
}
