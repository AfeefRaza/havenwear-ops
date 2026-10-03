import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { RefreshCw, Search, ShoppingBag } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/AppShell'
import { ProductImage } from '../components/ProductionBits'
import { Button, Card, EmptyState, ListSkeleton, Pill, Segmented } from '../components/ui'
import { SHOPIFY_STORE, useCatalog, useSetPrintConfig, useSyncCatalog } from '../data/production'
import { formatDate } from '../domain/format'
import { cn, useDebounced, useOnline } from '../lib/hooks'

export default function ShopifyProducts() {
  const catalog = useCatalog()
  const sync = useSyncCatalog()
  const setPrint = useSetPrintConfig()
  const online = useOnline()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'unconfirmed' | 'all'>('unconfirmed')
  const query = useDebounced(q, 200).toLowerCase().trim()

  const products = useMemo(() => catalog.data?.products ?? [], [catalog.data])
  const unconfirmed = products.filter((p) => !p.print_confirmed).length
  const rows = useMemo(
    () =>
      products
        .filter((p) => (filter === 'all' || !p.print_confirmed) && (!query || p.title.toLowerCase().includes(query)))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [products, filter, query],
  )
  const lastSync = products.reduce<string | null>((m, p) => (!m || p.synced_at > m ? p.synced_at : m), null)

  const v = useWindowVirtualizer({ count: rows.length, estimateSize: () => 104, overscan: 6 })

  return (
    <>
      <PageHeader title="Shopify products" back subtitle={`${SHOPIFY_STORE} · pictures & print settings`} />
      <Card className="flex flex-col gap-3 text-sm">
        <p className="text-muted">
          Product pictures, sizes and colours come from your store’s public catalogue — no Shopify password or API key is stored. Set{' '}
          <strong>Front / Back</strong> print once per product; suppliers see it on every pushed batch.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={RefreshCw} loading={sync.isPending} disabled={!online} onClick={() => sync.mutate()}>
            {products.length ? 'Sync again' : 'Sync from Shopify'}
          </Button>
          {products.length > 0 && (
            <span className="text-xs text-muted">
              {products.length} products{lastSync ? ` · last sync ${formatDate(lastSync)}` : ''}
            </span>
          )}
        </div>
      </Card>

      {catalog.isPending ? (
        <div className="mt-3"><ListSkeleton /></div>
      ) : !products.length ? (
        <div className="mt-3">
          <EmptyState icon={ShoppingBag} title="No products synced yet">Tap “Sync from Shopify” to load your product pictures.</EmptyState>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <Segmented
            label="Filter"
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'unconfirmed', label: 'To confirm', count: unconfirmed },
              { id: 'all', label: 'All', count: products.length },
            ]}
          />
          <label className="relative block">
            <span className="sr-only">Search products</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products…"
              className="min-h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-base focus:border-info focus:outline-none"
            />
          </label>
          {filter === 'unconfirmed' && !rows.length && <p className="px-1 text-sm text-muted">All print settings are confirmed. 🎉</p>}
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((vi) => {
              const p = rows[vi.index]!
              const set = (front: boolean, back: boolean) => setPrint.mutate({ product_id: p.product_id, front_print: front, back_print: back })
              const opt = (label: string, front: boolean, back: boolean) => {
                const on = p.print_confirmed && p.front_print === front && p.back_print === back
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    disabled={!online}
                    onClick={() => set(front, back)}
                    className={cn('min-h-10 flex-1 rounded-lg border px-2 text-xs font-semibold', on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface')}
                  >
                    {label}
                  </button>
                )
              }
              return (
                <div
                  key={p.product_id}
                  data-index={vi.index}
                  ref={v.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start - v.options.scrollMargin}px)` }}
                  className="pb-2"
                >
                  <Card className="flex gap-3 p-2">
                    <ProductImage src={p.image_url} alt={p.title} size="sm" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex items-start gap-2">
                        <span className="flex-1 text-sm font-medium leading-snug">{p.title}</span>
                        {!p.print_confirmed && <Pill tone="warn">Assumed F+B</Pill>}
                      </div>
                      <div className="flex gap-1" role="group" aria-label={`Print setting for ${p.title}`}>
                        {opt('Front + Back', true, true)}
                        {opt('Front only', true, false)}
                        {opt('Back only', false, true)}
                        {opt('No print', false, false)}
                      </div>
                    </div>
                  </Card>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
