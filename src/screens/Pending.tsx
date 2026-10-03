import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { PartyPopper } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { ItemRow } from '../components/ItemRow'
import { ItemEditSheet } from '../components/ItemSheets'
import { EmptyState, ErrorNote, ListSkeleton, Pill, SelectField } from '../components/ui'
import { useCategories, usePendingItems, useRules, type PendingItem } from '../data/queries'
import { useItemActions } from '../data/useItemActions'
import { daysBetween, todayISO } from '../domain/dates'
import { formatDate, formatInt } from '../domain/format'
import type { Item } from '../domain/schemas'
import { useOnline } from '../lib/hooks'

type Row = { kind: 'header'; key: string; ref: string; batchId: string; date: string; count: number } | { kind: 'item'; key: string; item: PendingItem }

export default function Pending() {
  const q = usePendingItems()
  const cats = useCategories()
  const rules = useRules()
  const actions = useItemActions()
  const online = useOnline()
  const [batchFilter, setBatchFilter] = useState('')
  const [editing, setEditing] = useState<Item | null>(null)
  const today = todayISO()

  const items = useMemo(() => q.data ?? [], [q.data])
  const batches = useMemo(() => {
    const m = new Map<string, { id: string; ref: string; date: string; count: number }>()
    for (const it of items) {
      const b = m.get(it.batch_id) ?? { id: it.batch_id, ref: it.batch_ref, date: it.batch_date, count: 0 }
      b.count++
      m.set(it.batch_id, b)
    }
    return [...m.values()]
  }, [items])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const b of batches) {
      if (batchFilter && b.id !== batchFilter) continue
      out.push({ kind: 'header', key: `h-${b.id}`, ref: b.ref, batchId: b.id, date: b.date, count: b.count })
      for (const it of items) if (it.batch_id === b.id) out.push({ kind: 'item', key: it.id, item: it })
    }
    return out
  }, [batches, items, batchFilter])

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? 44 : 84),
    overscan: 8,
    getItemKey: (i) => rows[i]?.key ?? i,
  })

  const pieces = items.reduce((s, i) => s + i.qty, 0)
  const overdue = items.filter((i) => daysBetween(i.batch_date, today) > 7).length

  return (
    <>
      <PageHeader title="Pending" subtitle={items.length ? `${items.length} lines · ${formatInt(pieces)} pieces across ${batches.length} batches` : undefined} />
      {q.isPending ? (
        <ListSkeleton rows={6} />
      ) : q.error && !items.length ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={PartyPopper} title="Nothing pending">
          Every item in your active batches has been received or cancelled.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <SelectField label="Batch" className="flex-1" value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
              <option value="">All active batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.ref} ({b.count})
                </option>
              ))}
            </SelectField>
            {overdue > 0 && (
              <Pill tone="bad" className="mb-2">
                {overdue} waiting &gt; 7 days
              </Pill>
            )}
          </div>
          <p className="px-1 text-xs text-muted">Swipe right to allocate to the Supplier, left to fulfil from Return stock — or tap the buttons.</p>

          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index]!
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
                >
                  {row.kind === 'header' ? (
                    <h2 className="flex items-center justify-between px-1 pb-2 pt-3 text-sm font-semibold">
                      <Link to={`/batches/${row.batchId}`} className="underline-offset-2 hover:underline">
                        {row.ref}
                      </Link>
                      <span className="text-xs font-normal text-muted">
                        {formatDate(row.date)} · {row.count} pending
                      </span>
                    </h2>
                  ) : (
                    <ul className="pb-2">
                      <ItemRow
                        item={row.item}
                        categories={cats.data ?? []}
                        daysWaiting={daysBetween(row.item.batch_date, today)}
                        readOnly={!online}
                        onOpen={setEditing}
                        onReceive={(it, from) => (from === 'supplier' ? void actions.allocate([it], !it.supplier_planned) : actions.receive([it], 'return'))}
                      />
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      <ItemEditSheet
        item={editing}
        onClose={() => setEditing(null)}
        rules={rules.data ?? []}
        categories={cats.data ?? []}
        onStatus={(it, status, from) => actions.change([it], status, from)}
        onDelete={(it) => actions.remove([it])}
      />
    </>
  )
}
