import { CheckCircle2, ClipboardList, Filter } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ItemDisplay } from '../data/itemDisplay'
import { groupByOrder } from '../domain/orders'
import type { Category, Item, ReceivedFromT } from '../domain/schemas'
import { cn } from '../lib/hooks'
import { HighPriorityPill, ItemRow } from './ItemRow'
import { Pill } from './ui'

/**
 * "By orders": the same batch lines as the product view, grouped by Shopify order, so it is easy to
 * see which orders still have something not received. It shows and edits the very same rows, so
 * receiving a line here or in the product view (or in Production) updates both.
 */
export function OrdersView({
  items,
  categories,
  display,
  threshold,
  readOnly,
  selectMode,
  selected,
  onToggle,
  onOpen,
  onReceive,
}: {
  items: Item[]
  categories: Category[]
  display: Map<string, ItemDisplay>
  /** Orders with at least this many pieces are HIGH PRIORITY. */
  threshold: number
  readOnly: boolean
  selectMode: boolean
  selected: Set<string>
  onToggle: (item: Item) => void
  onOpen: (item: Item) => void
  onReceive: (item: Item, from: ReceivedFromT) => void
}) {
  const [onlyMissing, setOnlyMissing] = useState(false)
  const groups = useMemo(() => groupByOrder(items, threshold), [items, threshold])
  const named = groups.filter((g) => g.name)
  const missingOrders = named.filter((g) => !g.complete).length
  const shown = onlyMissing ? groups.filter((g) => !g.complete) : groups

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="tabular text-xs text-muted">
          {named.length} order{named.length === 1 ? '' : 's'} · <strong className={missingOrders ? 'text-warn' : 'text-ok'}>{missingOrders}</strong> with items not received
        </p>
        <button
          type="button"
          aria-pressed={onlyMissing}
          onClick={() => setOnlyMissing((v) => !v)}
          className={cn(
            'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold',
            onlyMissing ? 'border-warn bg-warn-bg text-warn' : 'border-border bg-surface text-muted',
          )}
        >
          <Filter className="size-3.5" aria-hidden />
          Only not received
        </button>
      </div>

      {named.length === 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted">
          <ClipboardList className="mt-0.5 size-4 shrink-0" aria-hidden />
          This batch has no order numbers — it was made from a pasted list. Orders show up here for batches imported from a Shopify orders export.
        </p>
      )}

      {shown.length === 0 && <p className="py-6 text-center text-sm text-muted">Every order in this batch has been received.</p>}

      {shown.map((g) => (
        <section key={g.key || 'no-order'} aria-label={g.name ? `Order ${g.name}` : 'Lines without an order number'}>
          <div className="mb-1.5 flex flex-col gap-1.5 rounded-xl bg-surface-2 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-sm font-bold">{g.name ?? 'No order number'}</h3>
              {g.highPriority && <HighPriorityPill />}
              <span className="tabular text-xs text-muted">
                {g.items.length} line{g.items.length === 1 ? '' : 's'} · {g.pieces} pc{g.pieces === 1 ? '' : 's'}
              </span>
              <span className="ml-auto">
                {g.complete ? (
                  <Pill tone="ok" icon={CheckCircle2}>All received</Pill>
                ) : (
                  <Pill tone="warn">{g.pending} not received</Pill>
                )}
              </span>
            </div>
            {g.name && g.pieces > 0 && (
              <>
                <div
                  role="progressbar"
                  aria-label={`${g.received} of ${g.pieces} pieces received`}
                  aria-valuenow={Math.round((g.received / g.pieces) * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-2 w-full overflow-hidden rounded-full bg-border"
                >
                  <div className={cn('h-full rounded-full transition-all', g.complete ? 'bg-ok' : 'bg-primary')} style={{ width: `${(g.received / g.pieces) * 100}%` }} />
                </div>
                <span className="tabular text-[11px] text-muted">{g.received} of {g.pieces} received</span>
              </>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {g.items.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                image={display.get(it.id)?.image ?? null}
                line={display.get(it.id)?.info}
                categories={categories}
                readOnly={readOnly}
                selectMode={selectMode}
                selected={selected.has(it.id)}
                onToggle={onToggle}
                onOpen={onOpen}
                onReceive={onReceive}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
