import { Ban, CheckCircle2, Clock, Factory, PackageCheck, RotateCcw, TriangleAlert, Truck } from 'lucide-react'
import { useRef, useState } from 'react'
import { formatDate, formatPKR } from '../domain/format'
import type { Category, Item, ReceivedFromT } from '../domain/schemas'
import { cn, haptic } from '../lib/hooks'
import { ProductThumb } from './ProductThumb'
import { Pill } from './ui'

const SWIPE_AT = 90

/** Small red label for lines (or whole orders) that belong to a large order. */
export function HighPriorityPill() {
  return <span className="inline-flex items-center rounded-full bg-bad-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-bad">High priority</span>
}

/**
 * One batch item. Pending items: swipe right → received from Supplier, swipe left → from Return,
 * or tap the buttons. Tap the text to edit. In select mode the row toggles selection.
 */
export function ItemRow({
  item,
  categories,
  onReceive,
  onOpen,
  selectMode,
  selected,
  onToggle,
  daysWaiting,
  batchLabel,
  readOnly,
  image,
  line,
  grouped,
  priority,
}: {
  item: Item
  categories: Category[]
  onReceive: (item: Item, from: ReceivedFromT) => void
  onOpen: (item: Item) => void
  selectMode?: boolean
  selected?: boolean
  onToggle?: (item: Item) => void
  daysWaiting?: number
  batchLabel?: string
  readOnly?: boolean
  /** Shopify picture; undefined = no thumbnail column (screens that don't load the catalogue). */
  image?: string | null
  /** Product title and variant split for display; the full product name is still used everywhere else. */
  line?: { title: string; variant: string | null }
  /** Shown under category + size headings: on phones those aren't repeated in the row, to leave room for the name. */
  grouped?: boolean
  /** The line belongs to a large order. */
  priority?: boolean
}) {
  const cat = categories.find((c) => c.id === item.resolved_category_id)
  const pending = item.status === 'pending'
  const inProduction = pending && !!item.production_item_id
  const planned = pending && item.supplier_planned && !inProduction
  const canSwipe = pending && !inProduction && !selectMode && !readOnly
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef<number | null>(null)
  const startY = useRef(0)
  const horizontal = useRef(false)

  return (
    <li className="relative overflow-hidden rounded-2xl">
      {canSwipe && dx !== 0 && (
        <div
          className={cn(
            'absolute inset-0 flex items-center px-5 text-sm font-semibold',
            dx > 0 ? 'justify-start bg-ok-bg text-ok' : 'justify-end bg-surface-2 text-info',
          )}
          aria-hidden
        >
          {dx > 0 ? (
            <span className="flex items-center gap-2"><Truck className="size-5" /> {planned ? 'Un-allocate' : 'Supplier'}</span>
          ) : (
            <span className="flex items-center gap-2">Return <RotateCcw className="size-5" /></span>
          )}
        </div>
      )}
      <div
        className={cn(
          'relative flex items-center gap-2 border border-border bg-surface p-3 transition-transform sm:gap-3',
          'rounded-2xl',
          selected && 'border-info ring-2 ring-info/40',
          item.status === 'cancelled' && 'opacity-60',
        )}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transitionDuration: dragging ? '0ms' : undefined }}
        onTouchStart={(e) => {
          if (!canSwipe) return
          startX.current = e.touches[0]?.clientX ?? null
          startY.current = e.touches[0]?.clientY ?? 0
          horizontal.current = false
          setDragging(true)
        }}
        onTouchMove={(e) => {
          if (startX.current == null) return
          const x = (e.touches[0]?.clientX ?? 0) - startX.current
          const y = (e.touches[0]?.clientY ?? 0) - startY.current
          if (!horizontal.current && Math.abs(x) > 12 && Math.abs(x) > Math.abs(y)) horizontal.current = true
          if (horizontal.current) {
            const next = Math.max(-140, Math.min(140, x))
            if (Math.abs(next) >= SWIPE_AT && Math.abs(dx) < SWIPE_AT) haptic('tap')
            setDx(next)
          }
        }}
        onTouchEnd={() => {
          const d = dx
          startX.current = null
          setDragging(false)
          setDx(0)
          if (d >= SWIPE_AT) onReceive(item, 'supplier')
          else if (d <= -SWIPE_AT) onReceive(item, 'return')
        }}
      >
        {selectMode && (
          <input
            type="checkbox"
            className="size-6 shrink-0 accent-[var(--c-info)]"
            checked={!!selected}
            onChange={() => onToggle?.(item)}
            aria-label={`Select ${item.product_name}`}
          />
        )}
        <button
          type="button"
          className="min-h-11 min-w-0 flex-1 text-left"
          onClick={() => (selectMode ? onToggle?.(item) : onOpen(item))}
          aria-label={`${item.product_name}, quantity ${item.qty}, ${item.status}${selectMode ? '' : '. Tap to edit'}`}
        >
          <div className={cn('line-clamp-2 text-sm font-medium', item.status === 'cancelled' && 'line-through')}>
            {line?.variant ? (
              <>
                {line.title} <span className={cn('whitespace-nowrap font-bold', grouped && 'hidden sm:inline')}>· {line.variant}</span>
              </>
            ) : (
              item.product_name
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span className="tabular font-semibold text-text">× {item.qty}</span>
            {priority && <HighPriorityPill />}
            {cat ? (
              <span className={cn(grouped && 'hidden sm:inline')}>{cat.name}</span>
            ) : item.status !== 'cancelled' ? (
              <Pill tone="warn" icon={TriangleAlert}>Unmatched</Pill>
            ) : null}
            {cat && <span className="tabular">{grouped ? <span className="hidden sm:inline">· </span> : '· '}{formatPKR(item.unit_cost_pkr)}</span>}
            {batchLabel && <span>· {batchLabel}</span>}
            {daysWaiting != null && (
              <Pill tone={daysWaiting > 7 ? 'bad' : 'neutral'} icon={Clock}>
                {daysWaiting === 0 ? 'today' : `${daysWaiting}d waiting`}
              </Pill>
            )}
          </div>
        </button>
        {image !== undefined && <ProductThumb src={image} alt={item.product_name} />}
        {!selectMode && (
          <div className="flex shrink-0 items-center gap-1.5">
            {inProduction ? (
              <Pill tone="info" icon={Factory}>In production</Pill>
            ) : pending && !readOnly ? (
              <>
                <button
                  type="button"
                  onClick={() => onReceive(item, 'supplier')}
                  className={cn(
                    'flex min-h-11 sm:min-w-[4.5rem] flex-col items-center justify-center rounded-xl px-2.5 text-[11px] font-semibold active:scale-95',
                    planned ? 'bg-primary text-primary-fg' : 'bg-ok-bg text-ok',
                  )}
                  aria-pressed={planned}
                  aria-label={planned ? `${item.product_name}: allocated to supplier. Tap to un-allocate` : `Allocate ${item.product_name} to supplier`}
                >
                  <Truck className="size-4" aria-hidden />
                  {planned ? 'Supplier ✓' : 'Supplier'}
                </button>
                <button
                  type="button"
                  onClick={() => onReceive(item, 'return')}
                  className="flex min-h-11 sm:min-w-[4.5rem] flex-col items-center justify-center rounded-xl bg-surface-2 px-2.5 text-[11px] font-semibold text-info active:scale-95"
                  aria-label={`Mark ${item.product_name} received from return stock`}
                >
                  <RotateCcw className="size-4" aria-hidden />
                  Return
                </button>
              </>
            ) : item.status === 'received' ? (
              <Pill tone="ok" icon={item.received_from === 'return' ? PackageCheck : CheckCircle2}>
                {item.received_from === 'return' ? 'Return' : 'Supplier'} · {formatDate(item.received_date)}
              </Pill>
            ) : item.status === 'cancelled' ? (
              <Pill tone="neutral" icon={Ban}>Cancelled</Pill>
            ) : null}
          </div>
        )}
      </div>
    </li>
  )
}
