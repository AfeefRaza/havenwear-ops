import { useQueryClient } from '@tanstack/react-query'
import { Factory, RefreshCw, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { invalidateWork } from '../data/mutations'
import { useCatalog, useSyncCatalog } from '../data/production'
import type { Item } from '../domain/schemas'
import { productionKey, splitLineName } from '../domain/shopifyCatalog'
import { useOnline } from '../lib/hooks'
import { assertOnline, errorMessage, supabase } from '../lib/supabase'
import { PrintBadges, ProductImage } from './ProductionBits'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button, Pill } from './ui'

interface Line {
  key: string
  title: string
  variant: string | null
  size: string | null
  color: string | null
  image: string | null
  image2: string | null
  productId: number | null
  variantId: number | null
  front: boolean
  back: boolean
  confirmed: boolean
  matched: boolean
  qty: number
  items: Item[]
}

/** Push supplier-allocated, not-yet-pushed lines of a batch into production (combined per variant). */
export function PushSheet({ open, onOpenChange, batchId, items }: { open: boolean; onOpenChange: (o: boolean) => void; batchId: string; items: Item[] }) {
  const catalog = useCatalog()
  const sync = useSyncCatalog()
  const toast = useToast()
  const qc = useQueryClient()
  const online = useOnline()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const toPush = useMemo(() => items.filter((i) => i.status === 'pending' && i.supplier_planned && !i.production_item_id), [items])

  const lines = useMemo<Line[]>(() => {
    const match = catalog.data?.match
    const map = new Map<string, Line>()
    for (const it of toPush) {
      const m = match ? match(it.product_name) : null
      const key = productionKey(it.product_name, m)
      const split = splitLineName(it.product_name)
      const line = map.get(key) ?? {
        key,
        title: m?.product.title ?? split.title,
        variant: m?.variant?.title ?? m?.variantTitle ?? split.variant,
        size: m?.variant?.size ?? null,
        color: m?.variant?.color ?? null,
        image: m?.variant?.image_url ?? m?.product.image_url ?? null,
        image2: secondImage(m?.variant?.image_url ?? m?.product.image_url ?? null, m?.product.image_url ?? null, m?.product.image2_url ?? null),
        productId: m?.product.product_id ?? null,
        variantId: m?.variant?.variant_id ?? null,
        front: m?.product.front_print ?? true,
        back: m?.product.back_print ?? true,
        confirmed: m?.product.print_confirmed ?? false,
        matched: !!m,
        qty: 0,
        items: [],
      }
      line.qty += it.qty
      line.items.push(it)
      map.set(key, line)
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title))
  }, [toPush, catalog.data])

  const pieces = lines.reduce((s, l) => s + l.qty, 0)
  const unmatched = lines.filter((l) => !l.matched).length
  const unconfirmed = lines.filter((l) => l.matched && !l.confirmed).length
  const noCatalog = catalog.isSuccess && catalog.data.products.length === 0

  const push = async () => {
    setBusy(true)
    try {
      assertOnline()
      const payload = lines.flatMap((l) =>
        l.items.map((it) => ({
          batch_item_id: it.id,
          item_key: l.key,
          product_title: l.title,
          variant_title: l.variant,
          size: l.size ?? l.variant,
          color: l.color,
          image_url: l.image,
          image2_url: l.image2,
          shopify_product_id: l.productId,
          shopify_variant_id: l.variantId,
          front_print: l.front,
          back_print: l.back,
        })),
      )
      const { data, error } = await supabase.rpc('production_push', { p_batch: batchId, p_lines: payload })
      if (error) throw error
      const r = data as { run_id: string; lines: number; pieces: number }
      toast({ tone: 'success', message: `Pushed ${r.pieces} pieces to production`, action: { label: 'Open', onClick: () => navigate(`/production/${r.run_id}`) } })
      invalidateWork(qc)
      for (const k of ['prod-runs', 'prod-items', 'prod-issues']) void qc.invalidateQueries({ queryKey: [k] })
      onOpenChange(false)
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Push batch to production"
      description="Only products allocated to the Supplier are sent. Both suppliers will see them with their Shopify pictures."
      footer={
        <Button variant="primary" size="lg" block icon={Factory} disabled={!lines.length || !online || catalog.isPending} loading={busy} onClick={() => void push()}>
          {lines.length ? `Push ${lines.length} product${lines.length === 1 ? '' : 's'} · ${pieces} pcs` : 'Nothing to push'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {noCatalog && (
          <div className="flex flex-col gap-2 rounded-xl bg-warn-bg p-3 text-sm text-warn">
            <span>Product pictures are not loaded yet. Sync your Shopify products first so suppliers can see the pictures.</span>
            <Button icon={RefreshCw} loading={sync.isPending} onClick={() => sync.mutate()}>
              Sync Shopify products
            </Button>
          </div>
        )}
        {(unmatched > 0 || unconfirmed > 0) && (
          <div className="flex flex-wrap gap-2">
            {unmatched > 0 && <Pill tone="warn" icon={TriangleAlert}>{unmatched} without a Shopify match (no picture)</Pill>}
            {unconfirmed > 0 && <Pill tone="warn" icon={TriangleAlert}>{unconfirmed} with unconfirmed print setting (Front + Back assumed)</Pill>}
          </div>
        )}
        {!lines.length && (
          <p className="text-sm text-muted">
            Nothing to push. Tap <strong>Supplier</strong> on pending items (or select several → Supplier) to allocate them first.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li key={l.key} className="flex gap-3 rounded-xl border border-border p-2">
              <ProductImage src={l.image} alt={l.title} size="sm" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold leading-snug">{l.title}</div>
                <div className="text-muted">{[l.color, l.size ?? l.variant].filter(Boolean).join(' · ') || '—'}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <PrintBadges front={l.front} back={l.back} />
                  {!l.matched && <Pill tone="warn">No Shopify match</Pill>}
                </div>
              </div>
              <span className="tabular self-center text-lg font-semibold">×{l.qty}</span>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  )
}

/** Second picture = the first product picture that differs from the main (variant) picture. */
function secondImage(main: string | null, productImage: string | null, productImage2: string | null): string | null {
  return [productImage, productImage2].find((x) => x && x !== main) ?? null
}
