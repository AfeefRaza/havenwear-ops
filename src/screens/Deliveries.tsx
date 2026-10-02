import { useQuery } from '@tanstack/react-query'
import { Save, Trash2, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { useConfirm } from '../components/Confirm'
import { useToast } from '../components/Toast'
import { Button, Card, EmptyState, ErrorNote, ListSkeleton, SectionTitle, SelectField, Stepper, TextField } from '../components/ui'
import { useCreateDelivery, useDeleteRow } from '../data/mutations'
import { useCategories, useSupplierDeliveries } from '../data/queries'
import { todayISO } from '../domain/dates'
import { formatDate, formatInt } from '../domain/format'
import { useOnline } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { useWorkspaceId } from '../lib/workspace'

interface BatchOption {
  id: string
  ref: string
  supplier: string | null
  archived_at: string | null
}

export default function Deliveries() {
  const ws = useWorkspaceId()
  const cats = useCategories()
  const deliveries = useSupplierDeliveries()
  const create = useCreateDelivery()
  const del = useDeleteRow('supplier_deliveries')
  const toast = useToast()
  const online = useOnline()
  const [confirmEl, confirm] = useConfirm()
  const [date, setDate] = useState(todayISO())
  const [supplier, setSupplier] = useState('')
  const [reference, setReference] = useState('')
  const [batchId, setBatchId] = useState('')
  const [notes, setNotes] = useState('')
  const [qty, setQty] = useState<Record<string, number>>({})
  const categories = cats.data ?? []
  const total = Object.values(qty).reduce((s, n) => s + n, 0)

  // Batches for the optional link (newest first; includes archived so old deliveries still show their ref).
  const batches = useQuery({
    queryKey: ['batch-options', ws],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, ref, supplier, archived_at')
        .eq('workspace_id', ws)
        .order('batch_date', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as BatchOption[]
    },
  })
  const batchById = useMemo(() => new Map((batches.data ?? []).map((b) => [b.id, b])), [batches.data])
  const activeBatches = (batches.data ?? []).filter((b) => !b.archived_at)

  const pickBatch = (id: string) => {
    setBatchId(id)
    const b = batchById.get(id)
    if (b?.supplier && !supplier.trim()) setSupplier(b.supplier)
  }

  const save = () => {
    create.mutate(
      {
        date,
        supplier: supplier.trim() || null,
        reference: reference.trim() || null,
        batch_id: batchId || null,
        notes: notes.trim() || null,
        lines: categories.map((c) => ({ category_id: c.id, qty: qty[c.id] ?? 0 })),
      },
      {
        onSuccess: () => {
          toast({ tone: 'success', message: `Logged ${total} delivered piece${total === 1 ? '' : 's'}` })
          setQty({})
          setReference('')
          setNotes('')
          setBatchId('')
        },
      },
    )
  }

  return (
    <>
      <PageHeader title="Supplier deliveries" subtitle="Log stock delivered by the supplier, by date and category" />
      <Card className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Reference" placeholder="Challan / DC no." value={reference} onChange={(e) => setReference(e.target.value)} autoCapitalize="characters" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Batch (optional)" value={batchId} onChange={(e) => pickBatch(e.target.value)}>
            <option value="">Not linked</option>
            {activeBatches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.ref}
              </option>
            ))}
          </SelectField>
          <TextField label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
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
        <p className="text-xs text-muted">Delivered pieces add to stock. Items you mark “received from Supplier” in batches use them up.</p>
      </Card>

      <SectionTitle>Recent deliveries</SectionTitle>
      {deliveries.isPending ? (
        <ListSkeleton rows={3} />
      ) : deliveries.error && !deliveries.data ? (
        <ErrorNote error={deliveries.error} onRetry={() => void deliveries.refetch()} />
      ) : !deliveries.data?.length ? (
        <EmptyState icon={Truck} title="No deliveries logged yet">
          When the supplier drops off stock, count the pieces by category above and save. They add to your stock.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {deliveries.data.map((d) => {
            const sum = d.supplier_delivery_lines.reduce((s, l) => s + l.qty, 0)
            const batch = d.batch_id ? batchById.get(d.batch_id) : undefined
            return (
              <li key={d.id}>
                <Card className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">
                      {formatDate(d.date)}
                      {d.supplier ? ` · ${d.supplier}` : ''}
                      {d.reference ? ` · ${d.reference}` : ''}
                    </div>
                    <div className="text-xs text-muted">
                      {d.supplier_delivery_lines
                        .map((l) => `${categories.find((c) => c.id === l.category_id)?.name ?? '?'} ${l.qty}`)
                        .join(' · ')}
                    </div>
                    {batch && (
                      <Link to={`/batches/${batch.id}`} className="text-xs font-medium text-info underline-offset-2 hover:underline">
                        Batch {batch.ref}
                      </Link>
                    )}
                  </div>
                  <span className="tabular text-base font-semibold">{formatInt(sum)}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    icon={Trash2}
                    aria-label={`Delete delivery from ${formatDate(d.date)}`}
                    disabled={!online}
                    onClick={async () => {
                      if (await confirm({ title: 'Delete this delivery?', description: `${sum} pieces will be removed from stock.`, confirmLabel: 'Delete', danger: true }))
                        del.mutate(d.id)
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
