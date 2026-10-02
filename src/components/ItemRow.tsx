import { Ban, CheckCircle2, Clock, PackageCheck, RotateCcw, TriangleAlert, Truck } from 'lucide-react'
import { useRef, useState } from 'react'
import { formatDate, formatPKR } from '../domain/format'
import type { Category, Item, ReceivedFromT } from '../domain/schemas'
import { cn, haptic } from '../lib/hooks'
import { Pill } from './ui'

const SWIPE_AT = 90

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
}) {
  const cat = categories.find((c) => c.id === item.resolved_category_id)
  const pending = item.status === 'pending'
  const canSwipe = pending && !selectMode && !readOnly
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
            <span className="flex items-center gap-2"><Truck className="size-5" /> Supplier</span>
          ) : (
            <span className="flex items-center gap-2">Return <RotateCcw className="size-5" /></span>
          )}
        </div>
      )}
      <div
        className={cn(
          'relative flex items-center gap-3 border border-border bg-surface p-3 transition-transform',
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
          <div className={cn('line-clamp-2 text-sm font-medium', item.status === 'cancelled' && 'line-through')}>{item.product_name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span className="tabular font-semibold text-text">× {item.qty}</span>
            {cat ? (
              <span>{cat.name}</span>
            ) : item.status !== 'cancelled' ? (
              <Pill tone="warn" icon={TriangleAlert}>Unmatched</Pill>
            ) : null}
            {cat && <span className="tabular">· {formatPKR(item.unit_cost_pkr)}</span>}
            {batchLabel && <span>· {batchLabel}</span>}
            {daysWaiting != null && (
              <Pill tone={daysWaiting > 7 ? 'bad' : 'neutral'} icon={Clock}>
                {daysWaiting === 0 ? 'today' : `${daysWaiting}d waiting`}
              </Pill>
            )}
          </div>
        </button>
        {!selectMode && (
          <div className="flex shrink-0 items-center gap-1.5">
            {pending && !readOnly ? (
              <>
                <button
                  type="button"
                  onClick={() => onReceive(item, 'supplier')}
                  className="flex min-h-11 flex-col items-center justify-center rounded-xl bg-ok-bg px-2.5 text-[11px] font-semibold text-ok active:scale-95"
                  aria-label={`Mark ${item.product_name} received from supplier`}
                >
                  <Truck className="size-4" aria-hidden />
                  Supplier
                </button>
                <button
                  type="button"
                  onClick={() => onReceive(item, 'return')}
                  className="flex min-h-11 flex-col items-center justify-center rounded-xl bg-surface-2 px-2.5 text-[11px] font-semibold text-info active:scale-95"
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
