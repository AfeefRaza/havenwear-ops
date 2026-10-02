import { Boxes, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { BatchCard, BatchFormSheet, nextRef } from '../components/BatchBits'
import { Button, EmptyState, ErrorNote, ListSkeleton, Segmented } from '../components/ui'
import { useBatchCounts, useBatchList, type BatchTab } from '../data/queries'
import { useDebounced, useOnline } from '../lib/hooks'

export default function Batches() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as BatchTab) || 'active'
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 300)
  const list = useBatchList(tab, q)
  const counts = useBatchCounts()
  const [newOpen, setNewOpen] = useState(false)
  const navigate = useNavigate()
  const online = useOnline()
  const rows = list.data?.pages.flat() ?? []

  return (
    <>
      <PageHeader
        title="Batches"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)} disabled={!online}>
            New batch
          </Button>
        }
      />
      <div className="flex flex-col gap-3">
        <Segmented
          label="Batch status"
          value={tab}
          onChange={(t) => setParams({ tab: t }, { replace: true })}
          options={[
            { id: 'active', label: 'Active', count: counts.data?.active },
            { id: 'complete', label: 'Complete', count: counts.data?.complete },
            { id: 'archived', label: 'Archived', count: counts.data?.archived },
          ]}
        />
        <label className="relative block">
          <span className="sr-only">Search batches by ref or product</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ref or product…"
            className="min-h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-base focus:border-info focus:outline-none"
          />
        </label>
        {q && <p className="px-1 text-xs text-muted">Searching all batches, including archived.</p>}

        {list.isPending ? (
          <ListSkeleton />
        ) : list.error && !rows.length ? (
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={q ? 'No matches' : tab === 'active' ? 'No active batches' : tab === 'complete' ? 'Nothing complete yet' : 'No archived batches'}
            action={
              tab === 'active' && !q ? (
                <Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)} disabled={!online}>
                  Create your first batch
                </Button>
              ) : undefined
            }
          >
            {q
              ? 'Try another ref or part of a product name.'
              : tab === 'active'
                ? 'Create a batch, then paste the product names from your Shopify orders.'
                : tab === 'complete'
                  ? 'Batches appear here once every item is received or cancelled.'
                  : 'Archive complete batches to keep your working lists short. They stay in reports.'}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((b) => (
              <li key={b.id}>
                <BatchCard b={b} />
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <Button onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
            Load more
          </Button>
        )}
      </div>
      <BatchFormSheet
        open={newOpen}
        onOpenChange={setNewOpen}
        suggestedRef={nextRef(rows[0]?.ref)}
        onSaved={(id) => navigate(`/batches/${id}`)}
      />
    </>
  )
}
