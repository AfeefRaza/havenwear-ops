import { CheckCircle2, PackageCheck, RotateCcw, TriangleAlert, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useReceiveMany, type ProdItemT } from '../data/production'
import { planReceive } from '../domain/production'
import { cn, useOnline } from '../lib/hooks'
import { ProductImage } from './ProductionBits'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button, Pill, Stepper } from './ui'

/**
 * Receive a delivery the quick way round: everything still outstanding is assumed to have arrived and
 * you tap only the products that did NOT. Confirming marks the rest received (stock and batch lines
 * update exactly as with the single "Mark received" button); the flagged ones stay outstanding.
 */
export function ReceiveBatchSheet({ open, onOpenChange, items }: { open: boolean; onOpenChange: (o: boolean) => void; items: ProdItemT[] }) {
  const receive = useReceiveMany()
  const toast = useToast()
  const online = useOnline()
  const [missing, setMissing] = useState<Map<string, number>>(new Map())
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setMissing(new Map())
  }

  const plan = useMemo(() => planReceive(items, missing), [items, missing])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const setMiss = (id: string, n: number) =>
    setMissing((m) => {
      const next = new Map(m)
      if (n > 0) next.set(id, n)
      else next.delete(id)
      return next
    })

  const confirm = () => {
    const { changes, arriving, missing: left } = plan
    onOpenChange(false)
    void receive
      .mutateAsync({ changes })
      .then((done) =>
        toast({
          tone: 'success',
          message: left ? `Received ${arriving} pieces · ${left} still outstanding` : `Received ${arriving} pieces`,
          action: {
            label: 'Undo',
            onClick: () =>
              void receive
                .mutateAsync({ changes: done.map((c) => ({ item: c.item, delta: -c.delta })) })
                .then(() => toast({ tone: 'success', message: 'Receipt undone' }))
                .catch(() => undefined),
          },
        }),
      )
      .catch(() => undefined) // the hook already showed the error
  }

  const empty = plan.rows.length === 0

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Receive batch"
      description="Everything below is assumed to have arrived. Tap the products that did NOT arrive — they stay outstanding."
      footer={
        <div className="flex flex-col gap-2">
          {!empty && (
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="ok" icon={CheckCircle2}>{plan.arriving} pcs arrived</Pill>
              <Pill tone={plan.missing ? 'bad' : 'neutral'} icon={XCircle}>{plan.missing} pcs not arrived</Pill>
              {plan.missing > 0 && (
                <Button variant="ghost" icon={RotateCcw} onClick={() => setMissing(new Map())}>
                  Reset
                </Button>
              )}
            </div>
          )}
          {plan.beyondReadyProducts > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-warn">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {plan.beyondReadyProducts} product{plan.beyondReadyProducts === 1 ? '' : 's'} marked as arrived {plan.beyondReadyProducts === 1 ? 'has' : 'have'} not been marked ready by the supplier. Check before confirming.
            </p>
          )}
          <Button variant="primary" size="lg" block icon={PackageCheck} disabled={empty || plan.arriving === 0 || !online} loading={receive.isPending} onClick={confirm}>
            {empty ? 'Nothing left to receive' : plan.arriving === 0 ? 'Nothing marked as arrived' : `Mark ${plan.arriving} piece${plan.arriving === 1 ? '' : 's'} received`}
          </Button>
        </div>
      }
    >
      {empty ? (
        <p className="py-6 text-center text-sm text-muted">Everything in this batch has already been received.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {plan.rows.map((r) => {
            const it = byId.get(r.id)
            if (!it) return null
            const label = [it.color, it.size ?? it.variant_title].filter(Boolean).join(' · ')
            const flagged = r.missing > 0
            return (
              <li key={r.id} className={cn('rounded-xl border p-2 transition-colors', flagged ? 'border-bad/50 bg-bad-bg' : 'border-border')}>
                <button
                  type="button"
                  aria-pressed={flagged}
                  onClick={() => setMiss(r.id, flagged ? 0 : r.outstanding)}
                  className="flex w-full items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ProductImage src={it.image_url} alt={it.product_title} size="sm" />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-semibold leading-snug">{it.product_title}</span>
                    <span className="block text-muted">{[label, r.outstanding > 1 ? `${r.outstanding} to receive` : null].filter(Boolean).join(' · ') || '—'}</span>
                    {r.beyondReady && r.arriving > 0 && <span className="mt-1 inline-block text-xs font-medium text-warn">Supplier hasn’t marked this ready</span>}
                  </span>
                  <span className={cn('flex shrink-0 flex-col items-center gap-0.5 text-xs font-semibold', flagged ? 'text-bad' : 'text-ok')}>
                    {flagged ? <XCircle className="size-6" aria-hidden /> : <CheckCircle2 className="size-6" aria-hidden />}
                    {flagged ? (r.arriving > 0 ? `${r.missing} missing` : 'Not arrived') : 'Arrived'}
                  </span>
                </button>
                {flagged && r.outstanding > 1 && (
                  <div className="mt-2 border-t border-border pt-2">
                    <Stepper label="Pieces not arrived" value={r.missing} onChange={(n) => setMiss(r.id, n)} min={0} max={r.outstanding} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}
