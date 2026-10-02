import { Archive, ArchiveRestore, Ban, CheckSquare, ClipboardPaste, Pencil, PackagePlus, RotateCcw, Trash2, Truck, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { BatchFormSheet, PaymentPill, StagePill } from '../components/BatchBits'
import { ItemRow } from '../components/ItemRow'
import { ItemEditSheet, PasteSheet } from '../components/ItemSheets'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { Button, Card, EmptyState, ErrorNote, ListSkeleton, ProgressBar, SectionTitle } from '../components/ui'
import { useArchiveBatch, useDeleteBatch } from '../data/mutations'
import { useBatch, useBatchItems, useCategories, useRules } from '../data/queries'
import { useItemActions } from '../data/useItemActions'
import { formatDate, formatInt, formatPKR, formatPct } from '../domain/format'
import type { Item } from '../domain/schemas'
import { batchStage } from '../domain/stage'
import { billVariance, computeTotals } from '../domain/totals'
import { useOnline } from '../lib/hooks'

export default function BatchDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const batch = useBatch(id)
  const itemsQ = useBatchItems(id)
  const cats = useCategories()
  const rules = useRules()
  const actions = useItemActions()
  const archive = useArchiveBatch()
  const del = useDeleteBatch()
  const toast = useToast()
  const online = useOnline()

  const [pasteOpen, setPasteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)

  const items = useMemo(() => itemsQ.data ?? [], [itemsQ.data])
  const categories = cats.data ?? []
  const totals = useMemo(() => computeTotals(items), [items])
  const b = batch.data
  const archived = !!b?.archived_at
  const stage = b ? batchStage(b, items) : 'empty'

  const groups = useMemo(() => {
    const pending = items.filter((i) => i.status === 'pending')
    const received = items.filter((i) => i.status === 'received')
    const cancelled = items.filter((i) => i.status === 'cancelled')
    return [
      { key: 'pending', title: `Pending · ${pending.length}`, rows: pending },
      { key: 'received', title: `Received · ${received.length}`, rows: received },
      { key: 'cancelled', title: `Cancelled · ${cancelled.length}`, rows: cancelled },
    ].filter((g) => g.rows.length)
  }, [items])

  if (batch.isPending) return <><PageHeader title="Batch" back /><ListSkeleton rows={5} /></>
  if (batch.error && !b) return <><PageHeader title="Batch" back /><ErrorNote error={batch.error} onRetry={() => void batch.refetch()} /></>
  if (!b) return <><PageHeader title="Batch" back /><EmptyState icon={X} title="Batch not found">It may have been deleted.</EmptyState></>

  const selectedItems = items.filter((i) => selected.has(i.id))
  const toggle = (it: Item) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(it.id)) n.delete(it.id)
      else n.add(it.id)
      return n
    })
  const exitSelect = () => {
    setSelectMode(false)
    setSelected(new Set())
  }
  const variance = billVariance(b.actual_bill_pkr, totals.estSupplierCost)
  const doneRatio = totals.activeLines ? (totals.activeLines - totals.pendingLines) / totals.activeLines : 0

  return (
    <>
      <PageHeader
        title={b.ref}
        back
        subtitle={`${formatDate(b.batch_date)}${b.supplier ? ` · ${b.supplier}` : ''}`}
        actions={
          !archived && (
            <Button size="icon" variant="ghost" icon={Pencil} aria-label="Edit batch details" onClick={() => setEditOpen(true)} disabled={!online} />
          )
        }
      />

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StagePill stage={stage} />
          <PaymentPill status={b.payment_status} />
          {b.invoice_ref && <span className="text-xs text-muted">Invoice {b.invoice_ref}</span>}
        </div>
        <ProgressBar value={doneRatio} label="Batch progress" />
        <dl className="tabular grid grid-cols-3 gap-3 text-center">
          <Stat label="Required" value={formatInt(totals.required)} />
          <Stat label="Pending" value={formatInt(totals.pendingPieces)} tone={totals.pendingPieces ? 'bad' : undefined} />
          <Stat label="Lines" value={`${totals.lines}`} />
          <Stat label="From supplier" value={formatInt(totals.fromSupplier)} />
          <Stat label="From returns" value={formatInt(totals.fromReturns)} />
          <Stat label="Return %" value={formatPct(totals.returnPct)} />
        </dl>
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-2 p-3 text-sm">
          <div>
            <div className="text-xs text-muted">Est. supplier cost</div>
            <div className="tabular font-semibold">{formatPKR(totals.estSupplierCost)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Actual bill</div>
            <div className="tabular font-semibold">{b.actual_bill_pkr != null ? formatPKR(b.actual_bill_pkr) : '—'}</div>
          </div>
          {variance != null && variance !== 0 && (
            <p className={`col-span-2 text-xs font-medium ${variance > 0 ? 'text-bad' : 'text-ok'}`}>
              {variance > 0 ? '▲ Billed ' : '▼ Billed '}
              {formatPKR(Math.abs(variance))} {variance > 0 ? 'more' : 'less'} than estimate
            </p>
          )}
        </div>
        {b.delivered_pieces > 0 && (
          <Link to="/deliveries" className="flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm">
            <Truck className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="tabular flex-1">
              Supplier delivered <strong>{formatInt(b.delivered_pieces)}</strong> of {formatInt(totals.required)} pieces required
            </span>
            {b.delivered_pieces < totals.required ? (
              <span className="text-xs font-semibold text-warn">{formatInt(totals.required - b.delivered_pieces)} short</span>
            ) : b.delivered_pieces > totals.required ? (
              <span className="text-xs font-semibold text-info">+{formatInt(b.delivered_pieces - totals.required)} extra</span>
            ) : (
              <span className="text-xs font-semibold text-ok">Complete</span>
            )}
          </Link>
        )}
        {b.notes && <p className="whitespace-pre-wrap text-sm text-muted">{b.notes}</p>}
        <div className="flex flex-wrap gap-2">
          {stage === 'complete' && (
            <Button
              variant="ok"
              icon={Archive}
              disabled={!online}
              loading={archive.isPending}
              onClick={() =>
                archive.mutate(
                  { ids: [b.id], archived: true },
                  { onSuccess: () => toast({ tone: 'success', message: `${b.ref} archived`, action: { label: 'Undo', onClick: () => archive.mutate({ ids: [b.id], archived: false }) } }) },
                )
              }
            >
              Archive batch
            </Button>
          )}
          {archived && (
            <Button icon={ArchiveRestore} disabled={!online} onClick={() => archive.mutate({ ids: [b.id], archived: false })}>
              Unarchive
            </Button>
          )}
          {!archived && (
            <Button variant="ghost" icon={Trash2} disabled={!online} onClick={() => setConfirmDelete(true)}>
              Delete batch
            </Button>
          )}
        </div>
      </Card>

      {archived && (
        <p className="mt-3 rounded-xl bg-surface-2 p-3 text-sm text-muted">
          This batch is archived and read-only. It is still included in reports. Unarchive it to make changes.
        </p>
      )}

      <SectionTitle
        action={
          !archived &&
          items.length > 0 &&
          (selectMode ? (
            <Button variant="ghost" icon={X} onClick={exitSelect}>
              Done
            </Button>
          ) : (
            <Button variant="ghost" icon={CheckSquare} onClick={() => setSelectMode(true)} disabled={!online}>
              Select
            </Button>
          ))
        }
      >
        Items
      </SectionTitle>

      {itemsQ.isPending ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          title="No products yet"
          action={
            !archived && (
              <Button variant="primary" icon={ClipboardPaste} onClick={() => setPasteOpen(true)} disabled={!online}>
                Add products
              </Button>
            )
          }
        >
          Import your Shopify orders export (CSV) or paste product names — the app detects each category and cost.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.title}>
              <h3 className="mb-2 px-1 text-xs font-semibold text-muted">{g.title}</h3>
              <ul className="flex flex-col gap-2">
                {g.rows.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    categories={categories}
                    readOnly={archived || !online}
                    selectMode={selectMode}
                    selected={selected.has(it.id)}
                    onToggle={toggle}
                    onOpen={setEditing}
                    onReceive={(item, from) => actions.receive([item], from)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Sticky action bar */}
      {!archived && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex justify-center px-4 md:bottom-4 md:left-60">
          <div className="pointer-events-auto flex w-full max-w-xl gap-2 rounded-2xl border border-border bg-surface/95 p-2 shadow-lg backdrop-blur">
            {selectMode ? (
              <>
                <span className="tabular self-center px-2 text-sm font-semibold">{selected.size}</span>
                <Button className="flex-1 px-2" variant="ok" icon={Truck} disabled={!selected.size || !online} onClick={() => { actions.receive(selectedItems.filter((i) => i.status !== 'received' || i.received_from !== 'supplier'), 'supplier'); exitSelect() }}>
                  Supplier
                </Button>
                <Button className="flex-1 px-2" icon={RotateCcw} disabled={!selected.size || !online} onClick={() => { actions.receive(selectedItems, 'return'); exitSelect() }}>
                  Return
                </Button>
                <Button className="px-2" icon={Ban} aria-label="Cancel selected items" disabled={!selected.size || !online} onClick={() => { actions.cancel(selectedItems); exitSelect() }} />
                <Button className="px-2" variant="danger" icon={Trash2} aria-label="Delete selected items" disabled={!selected.size || !online} onClick={() => { actions.remove(selectedItems); exitSelect() }} />
              </>
            ) : (
              <Button variant="primary" size="lg" block icon={ClipboardPaste} onClick={() => setPasteOpen(true)} disabled={!online}>
                Add products
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="h-20" aria-hidden />

      <PasteSheet open={pasteOpen} onOpenChange={setPasteOpen} batchId={b.id} rules={rules.data ?? []} categories={categories} />
      <BatchFormSheet open={editOpen} onOpenChange={setEditOpen} batch={b} />
      <ItemEditSheet
        item={editing}
        onClose={() => setEditing(null)}
        rules={rules.data ?? []}
        categories={categories}
        readOnly={archived}
        onStatus={(it, status, from) => actions.change([it], status, from)}
        onDelete={(it) => actions.remove([it])}
      />
      <Sheet
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${b.ref}?`}
        description={items.length ? `This permanently deletes the batch and its ${items.length} items. Consider archiving instead.` : 'This batch has no items.'}
        footer={
          <div className="flex gap-2">
            <Button block onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              block
              variant="danger"
              icon={Trash2}
              loading={del.isPending}
              onClick={() => del.mutate(b.id, { onSuccess: () => { toast({ message: `${b.ref} deleted` }); navigate('/batches', { replace: true }) } })}
            >
              Delete
            </Button>
          </div>
        }
      >
        <span />
      </Sheet>
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="rounded-xl bg-surface-2 px-1 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`text-lg font-semibold ${tone === 'bad' ? 'text-bad' : ''}`}>{value}</dd>
    </div>
  )
}
