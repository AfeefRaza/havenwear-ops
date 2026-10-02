import { Ban, ClipboardPaste, FileSpreadsheet, RotateCcw, Trash2, TriangleAlert, Undo2, X } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useAddItems, useUpdateItem } from '../data/mutations'
import { classify } from '../domain/classify'
import { formatInt, formatPKR } from '../domain/format'
import { parsePaste } from '../domain/paste'
import { orderNote, parseShopifyOrders, type ShopifyParse } from '../domain/shopifyCsv'
import { errorMessage, supabase } from '../lib/supabase'
import { useWorkspaceId } from '../lib/workspace'
import { ItemForm, type Category, type Item, type Rule } from '../domain/schemas'
import { useOnline } from '../lib/hooks'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button, Pill, SelectField, TextArea, TextField, Toggle } from './ui'

interface PreviewLine {
  key: string
  label: string
  name: string
  qty: number
  pack?: number
  order?: string
}

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
  const ws = useWorkspaceId()
  const [text, setText] = useState('')
  const [csv, setCsv] = useState<{ file: string; parsed: ShopifyParse; alreadyImported: string[] } | null>(null)
  const [skipDupes, setSkipDupes] = useState(true)
  const [reading, setReading] = useState(false)
  const add = useAddItems(batchId)
  const toast = useToast()
  const online = useOnline()

  const lines = useMemo<PreviewLine[]>(() => {
    if (csv) {
      const skip = new Set(skipDupes ? csv.alreadyImported : [])
      return csv.parsed.lines
        .filter((l) => !skip.has(l.order))
        .map((l) => ({ key: `r${l.lineNo}`, label: l.order, name: l.name, qty: l.qty, pack: l.pack, order: l.order }))
    }
    return parsePaste(text).map((l) => ({ key: `l${l.lineNo}`, label: String(l.lineNo), name: l.name, qty: l.qty }))
  }, [csv, skipDupes, text])

  const preview = useMemo(
    () =>
      lines.map((l) => {
        const c = classify(l.name, rules, categories)
        return { ...l, c, cat: categories.find((x) => x.id === c.categoryId) }
      }),
    [lines, rules, categories],
  )
  const pieces = preview.reduce((s, l) => s + l.qty, 0)
  const unmatched = preview.filter((l) => l.c.unmatched).length
  const estCost = preview.reduce((s, l) => s + l.qty * l.c.unitCost, 0)

  const readCsv = async (file: File) => {
    setReading(true)
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('File is larger than 10 MB')
      // Parsed entirely in the browser; only product name, quantity and order number are kept.
      const parsed = parseShopifyOrders(await file.text())
      // Detect orders already imported into any batch (their items carry "Order #…" in notes).
      const notes = parsed.orders.map((o) => orderNote(o)!)
      const already = new Set<string>()
      for (let i = 0; i < notes.length; i += 100) {
        const { data, error } = await supabase.from('batch_items').select('notes').eq('workspace_id', ws).in('notes', notes.slice(i, i + 100))
        if (error) throw error
        for (const r of (data ?? []) as { notes: string | null }[]) if (r.notes) already.add(r.notes.replace(/^Order /, ''))
      }
      setCsv({ file: file.name, parsed, alreadyImported: [...already] })
      setSkipDupes(true)
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e) })
    } finally {
      setReading(false)
    }
  }

  const reset = () => {
    setText('')
    setCsv(null)
  }

  const submit = () => {
    add.mutate(
      { items: preview.map((l) => ({ product_name: l.name, qty: l.qty, notes: l.order ? orderNote(l.order) : null })), rules, categories },
      {
        onSuccess: (n) => {
          toast({ tone: 'success', message: `Added ${n} line${n === 1 ? '' : 's'} (${formatInt(pieces)} pcs)` })
          reset()
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add products"
      description={csv ? undefined : 'Paste one product per line (add “× 2” or a tab + number for quantity), or import a Shopify orders export.'}
      footer={
        <Button variant="primary" size="lg" block icon={ClipboardPaste} disabled={!preview.length || !online} loading={add.isPending} onClick={submit}>
          {preview.length ? `Add all ${preview.length} lines · ${formatInt(pieces)} pcs` : 'Add all'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {csv ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
            <div className="flex items-start gap-2">
              <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-semibold">{csv.file}</div>
                <div className="text-xs text-muted">
                  {csv.parsed.orders.length} orders · {csv.parsed.lines.length} line items
                  {csv.parsed.skippedCancelled.length > 0 && ` · ${csv.parsed.skippedCancelled.length} cancelled orders skipped`}
                </div>
              </div>
              <Button size="icon" variant="ghost" icon={X} aria-label="Remove file" onClick={() => setCsv(null)} />
            </div>
            {csv.alreadyImported.length > 0 && (
              <Toggle
                label={`Skip ${csv.alreadyImported.length} order${csv.alreadyImported.length === 1 ? '' : 's'} already in a batch`}
                description={csv.alreadyImported.slice(0, 6).join(', ') + (csv.alreadyImported.length > 6 ? '…' : '')}
                checked={skipDupes}
                onChange={setSkipDupes}
              />
            )}
            {csv.parsed.warnings.map((w, i) => (
              <p key={i} className="text-xs text-warn">
                {w}
              </p>
            ))}
          </div>
        ) : (
          <>
            <TextArea
              label="Product names"
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Oversized Tee - Black / L × 2\nOversized Hoodie - Grey / XL\nCargo Trouser\t3'}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">
              <FileSpreadsheet className="size-5" aria-hidden />
              {reading ? 'Reading…' : 'Import Shopify orders CSV'}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={reading || !online}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void readCsv(f)
                  e.target.value = ''
                }}
              />
            </label>
            <p className="-mt-2 text-xs text-muted">Shopify → Orders → Export → CSV. Only product names, quantities and order numbers are used; customer details are ignored.</p>
          </>
        )}

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
                <li key={l.key} className={`flex items-center gap-2 px-3 py-2 text-sm ${l.c.unmatched ? 'bg-warn-bg' : ''}`}>
                  <span className="tabular w-14 shrink-0 truncate text-xs text-muted">{l.label}</span>
                  <span className="min-w-0 flex-1 break-words">
                    {l.name}
                    {l.pack && l.pack > 1 ? <span className="ml-1 text-xs text-muted">(pack of {l.pack})</span> : null}
                  </span>
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
