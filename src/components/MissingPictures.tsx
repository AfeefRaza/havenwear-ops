import { ImageOff, Link2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useCatalog, useLinkProduct, useProdItems, useSyncCatalog, useSyncStatus } from '../data/production'
import { useOnline } from '../lib/hooks'
import { ProductImage } from './ProductionBits'
import { Sheet } from './Sheet'
import { Button, Card } from './ui'

const STALE_MS = 6 * 60 * 60 * 1000

/**
 * Owner safety net. Pictures sync by themselves every hour on the server; this only appears when
 * that sync is failing, or a product could not be matched (link it once and it stays linked).
 */
export function MissingPictures() {
  const items = useProdItems()
  const status = useSyncStatus()
  const sync = useSyncCatalog()
  const online = useOnline()
  const [linking, setLinking] = useState<string | null>(null)

  const titles = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items.data ?? []) if (!it.shopify_product_id) m.set(it.product_title, (m.get(it.product_title) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [items.data])

  const s = status.data
  // eslint-disable-next-line react-hooks/purity -- a slightly stale clock is fine for this warning
  const syncFailing = !!s && (!!s.last_error || !s.last_success_at || Date.now() - new Date(s.last_success_at).getTime() > STALE_MS)
  if (!syncFailing && !titles.length) return null

  return (
    <Card className="mb-3 flex flex-col gap-3 text-sm">
      {syncFailing && (
        <div className="flex flex-col gap-2 rounded-xl bg-warn-bg p-3 text-warn" role="alert">
          <span className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-4 shrink-0" aria-hidden /> Shopify picture sync needs attention
          </span>
          {s?.last_error && <span className="break-words">{s.last_error}</span>}
          <Button icon={RefreshCw} loading={sync.isPending} disabled={!online} onClick={() => sync.mutate()}>
            Sync now
          </Button>
        </div>
      )}
      {titles.length > 0 && (
        <>
          <div className="flex items-center gap-2 font-semibold">
            <ImageOff className="size-4 shrink-0" aria-hidden /> {titles.length} product{titles.length === 1 ? '' : 's'} without a picture
          </div>
          <p className="text-muted">Suppliers see “No picture” for these. Link each one to its Shopify product once; future batches will match by themselves.</p>
          <ul className="flex flex-col gap-2">
            {titles.map(([title, n]) => (
              <li key={title} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 break-words">{title} <span className="tabular text-muted">· {n} line{n === 1 ? '' : 's'}</span></span>
                <Button icon={Link2} disabled={!online} onClick={() => setLinking(title)}>Link</Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <LinkSheet title={linking} onClose={() => setLinking(null)} />
    </Card>
  )
}

function LinkSheet({ title, onClose }: { title: string | null; onClose: () => void }) {
  const catalog = useCatalog()
  const link = useLinkProduct()
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (catalog.data?.products ?? [])
      .filter((p) => words.every((w) => p.title.toLowerCase().includes(w)))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 40)
  }, [catalog.data, q])

  return (
    <Sheet open={!!title} onOpenChange={(o) => !o && onClose()} title="Which Shopify product is this?" description={title ?? ''}>
      <div className="flex flex-col gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products"
          aria-label="Search products"
          className="h-11 rounded-xl border border-border bg-surface px-3 text-base"
        />
        {rows.map((p) => (
          <button
            key={p.product_id}
            type="button"
            disabled={link.isPending}
            className="flex items-center gap-3 rounded-xl border border-border p-2 text-left"
            onClick={() => title && link.mutate({ title, product: p.product_id }, { onSuccess: onClose })}
          >
            <ProductImage src={p.image_url} alt={p.title} size="sm" />
            <span className="min-w-0 flex-1 text-sm font-semibold">{p.title}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
