import { Archive, CheckCircle2, CircleDashed, CircleDollarSign, Clock, Hourglass } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useSaveBatch } from '../data/mutations'
import type { BatchSummary } from '../data/queries'
import { todayISO } from '../domain/dates'
import { formatDate, formatInt, formatPKR } from '../domain/format'
import { BatchForm, type PaymentStatusT } from '../domain/schemas'
import { STAGE_LABEL, type BatchStage } from '../domain/stage'
import { useOnline } from '../lib/hooks'
import { Sheet } from './Sheet'
import { Button, Card, Pill, ProgressBar, SelectField, TextArea, TextField, type Tone } from './ui'

export const PAYMENT_LABEL: Record<PaymentStatusT, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Part paid',
  paid: 'Paid',
}

export function PaymentPill({ status }: { status: PaymentStatusT }) {
  const tone: Tone = status === 'paid' ? 'ok' : status === 'partially_paid' ? 'warn' : 'bad'
  return (
    <Pill tone={tone} icon={CircleDollarSign}>
      {PAYMENT_LABEL[status]}
    </Pill>
  )
}

export function StagePill({ stage }: { stage: BatchStage }) {
  const map: Record<BatchStage, { tone: Tone; icon: typeof Clock }> = {
    empty: { tone: 'neutral', icon: CircleDashed },
    in_progress: { tone: 'warn', icon: Hourglass },
    complete: { tone: 'ok', icon: CheckCircle2 },
    archived: { tone: 'neutral', icon: Archive },
  }
  const m = map[stage]
  return (
    <Pill tone={m.tone} icon={m.icon}>
      {STAGE_LABEL[stage]}
    </Pill>
  )
}

export function BatchCard({ b }: { b: BatchSummary }) {
  const active = b.lines - b.cancelled_lines
  const done = active - b.pending_lines
  const progress = active > 0 ? done / active : 0
  return (
    <Link to={`/batches/${b.id}`} className="block rounded-2xl focus-visible:outline-2">
      <Card className="flex flex-col gap-3 transition active:scale-[0.99]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{b.ref}</div>
            <div className="text-xs text-muted">
              {formatDate(b.batch_date)}
              {b.supplier ? ` · ${b.supplier}` : ''}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <PaymentPill status={b.payment_status} />
          </div>
        </div>
        <ProgressBar value={progress} label={`${b.ref} progress`} />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StagePill stage={b.stage} />
          {b.pending_lines > 0 && (
            <Pill tone="bad" icon={Clock}>
              {b.pending_lines} pending · {formatInt(b.pending_pieces)} pcs
            </Pill>
          )}
          {b.unmatched_lines > 0 && <Pill tone="warn">{b.unmatched_lines} unmatched</Pill>}
          <span className="tabular ml-auto text-muted">
            {done}/{active} lines · {formatPKR(b.est_supplier_cost)}
          </span>
        </div>
      </Card>
    </Link>
  )
}

/** Suggest the next ref: HW-1012 → HW-1013. */
export function nextRef(latest: string | undefined): string {
  if (!latest) return 'HW-1001'
  const m = /^(.*?)(\d+)$/.exec(latest)
  if (!m) return ''
  const num = String(Number(m[2]) + 1).padStart(m[2]!.length, '0')
  return `${m[1]}${num}`
}

export function BatchFormSheet({
  open,
  onOpenChange,
  batch,
  suggestedRef,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  batch?: BatchSummary | null
  suggestedRef?: string
  onSaved?: (id: string) => void
}) {
  const save = useSaveBatch()
  const online = useOnline()
  const [form, setForm] = useState(() => initial(batch, suggestedRef))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setForm(initial(batch, suggestedRef))
      setErrors({})
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = BatchForm.safeParse(form)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    save.mutate(
      { id: batch?.id, values: parsed.data },
      {
        onSuccess: (id) => {
          onOpenChange(false)
          onSaved?.(id)
        },
        onError: (err) => {
          if (/duplicate|already exists/i.test(String((err as Error).message))) setErrors({ ref: 'A batch with this ref already exists' })
        },
      },
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={batch ? `Edit ${batch.ref}` : 'New batch'}
      footer={
        <Button type="submit" form="batch-form" variant="primary" size="lg" block loading={save.isPending} disabled={!online}>
          {batch ? 'Save changes' : 'Create batch'}
        </Button>
      }
    >
      <form id="batch-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Batch ref" value={form.ref} onChange={set('ref')} error={errors.ref} autoCapitalize="characters" required />
          <TextField label="Date" type="date" value={form.batch_date} onChange={set('batch_date')} error={errors.batch_date} required />
        </div>
        <TextField label="Supplier" value={form.supplier ?? ''} onChange={set('supplier')} error={errors.supplier} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Invoice ref" value={form.invoice_ref ?? ''} onChange={set('invoice_ref')} error={errors.invoice_ref} />
          <TextField
            label="Actual bill (PKR)"
            inputMode="decimal"
            value={String(form.actual_bill_pkr ?? '')}
            onChange={set('actual_bill_pkr')}
            error={errors.actual_bill_pkr}
          />
        </div>
        <SelectField label="Payment status" value={form.payment_status} onChange={set('payment_status')}>
          <option value="unpaid">Unpaid</option>
          <option value="partially_paid">Partially paid</option>
          <option value="paid">Paid</option>
        </SelectField>
        <TextArea label="Notes" rows={3} value={form.notes ?? ''} onChange={set('notes')} error={errors.notes} />
      </form>
    </Sheet>
  )
}

function initial(batch?: BatchSummary | null, suggestedRef?: string) {
  return {
    ref: batch?.ref ?? suggestedRef ?? '',
    batch_date: batch?.batch_date ?? todayISO(),
    supplier: batch?.supplier ?? '',
    invoice_ref: batch?.invoice_ref ?? '',
    actual_bill_pkr: batch?.actual_bill_pkr != null ? String(batch.actual_bill_pkr) : '',
    payment_status: batch?.payment_status ?? ('unpaid' as PaymentStatusT),
    notes: batch?.notes ?? '',
  }
}
