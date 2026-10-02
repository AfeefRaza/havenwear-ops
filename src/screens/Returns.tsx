import { PackageOpen, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/AppShell'
import { useConfirm } from '../components/Confirm'
import { useToast } from '../components/Toast'
import { Button, Card, EmptyState, ErrorNote, ListSkeleton, SectionTitle, Stepper, TextField } from '../components/ui'
import { useCreateReturnReceipt, useDeleteRow } from '../data/mutations'
import { useCategories, useReturnReceipts } from '../data/queries'
import { todayISO } from '../domain/dates'
import { formatDate, formatInt } from '../domain/format'
import { useOnline } from '../lib/hooks'

export default function Returns() {
  const cats = useCategories()
  const receipts = useReturnReceipts()
  const create = useCreateReturnReceipt()
  const del = useDeleteRow('return_receipts')
  const toast = useToast()
  const online = useOnline()
  const [confirmEl, confirm] = useConfirm()
  const [date, setDate] = useState(todayISO())
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [qty, setQty] = useState<Record<string, number>>({})
  const categories = cats.data ?? []
  const total = Object.values(qty).reduce((s, n) => s + n, 0)

  const save = () => {
    create.mutate(
      {
        date,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        lines: categories.map((c) => ({ category_id: c.id, qty: qty[c.id] ?? 0 })),
      },
      {
        onSuccess: () => {
          toast({ tone: 'success', message: `Logged ${total} returned piece${total === 1 ? '' : 's'}` })
          setQty({})
          setReference('')
          setNotes('')
        },
      },
    )
  }

  return (
    <>
      <PageHeader title="Returns in" subtitle="Log returned-parcel stock by category" />
      <Card className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Reference" placeholder="POSTEX-10SEP" value={reference} onChange={(e) => setReference(e.target.value)} autoCapitalize="characters" />
        </div>
        {cats.isPending ? (
          <ListSkeleton rows={3} />
        ) : (
          <div className="flex flex-col gap-3">
            {categories.map((c) => (
              <Stepper key={c.id} label={c.name} value={qty[c.id] ?? 0} onChange={(v) => setQty((q) => ({ ...q, [c.id]: v }))} />
            ))}
          </div>
        )}
        <TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button variant="primary" size="lg" block icon={Save} disabled={!total || !online} loading={create.isPending} onClick={save}>
          {total ? `Save ${total} piece${total === 1 ? '' : 's'}` : 'Add pieces above'}
        </Button>
      </Card>

      <SectionTitle>Recent receipts</SectionTitle>
      {receipts.isPending ? (
        <ListSkeleton rows={3} />
      ) : receipts.error && !receipts.data ? (
        <ErrorNote error={receipts.error} onRetry={() => void receipts.refetch()} />
      ) : !receipts.data?.length ? (
        <EmptyState icon={PackageOpen} title="No returns logged yet">
          When a returned parcel comes back, count the pieces by category above and save. They add to your stock.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {receipts.data.map((r) => {
            const sum = r.return_receipt_lines.reduce((s, l) => s + l.qty, 0)
            return (
              <li key={r.id}>
                <Card className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">
                      {formatDate(r.date)}
                      {r.reference ? ` · ${r.reference}` : ''}
                    </div>
                    <div className="text-xs text-muted">
                      {r.return_receipt_lines
                        .map((l) => `${categories.find((c) => c.id === l.category_id)?.name ?? '?'} ${l.qty}`)
                        .join(' · ')}
                    </div>
                  </div>
                  <span className="tabular text-base font-semibold">{formatInt(sum)}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    icon={Trash2}
                    aria-label={`Delete receipt from ${formatDate(r.date)}`}
                    disabled={!online}
                    onClick={async () => {
                      if (await confirm({ title: 'Delete this return receipt?', description: `${sum} pieces will be removed from stock.`, confirmLabel: 'Delete', danger: true })) del.mutate(r.id)
                    }}
                  />
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      {confirmEl}
    </>
  )
}
