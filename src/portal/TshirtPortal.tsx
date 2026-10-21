import { AlertTriangle, CheckCircle2, ChevronRight, Factory, Minus, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DtfBadge, IssueLine, PrintBadges, ProductGallery, ProductionBar, ReportProblemSheet } from '../components/ProductionBits'
import { Sheet } from '../components/Sheet'
import { Button, Card, EmptyState, ErrorNote, ListSkeleton, Pill, Segmented } from '../components/ui'
import { useIssues, useMarkReady, useMarkReadyMany, useProdItems, useResolveIssue, useRunSummaries, type IssueT, type ProdItemT } from '../data/production'
import { formatDate } from '../domain/format'
import { itemProgress } from '../domain/production'
import { groupByProduct, sizeSummary, type ProductGroup } from '../domain/productGroups'
import { useOnline } from '../lib/hooks'
import { PortalHeader } from './SupplierPortal'

export function TshirtHome() {
  const runs = useRunSummaries()
  const [view, setView] = useState<'active' | 'done'>('active')
  const all = runs.data ?? []
  // For the T-shirt supplier a batch is done once every piece is marked ready and no problem is open.
  const isDone = (r: (typeof all)[number]) => r.ready >= r.required && r.open_issues === 0
  const active = all.filter((r) => !isDone(r))
  const shown = view === 'active' ? active : all.filter(isDone)

  return (
    <>
      <PortalHeader title="Batches to make" subtitle="Updates automatically" />
      {runs.isPending ? (
        <ListSkeleton />
      ) : runs.error && !runs.data ? (
        <ErrorNote error={runs.error} onRetry={() => void runs.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          <Segmented
            label="Batches"
            value={view}
            onChange={setView}
            options={[
              { id: 'active', label: 'Active', count: active.length },
              { id: 'done', label: 'Done', count: all.length - active.length },
            ]}
          />
          {!shown.length ? (
            <EmptyState icon={Factory} title={view === 'active' ? 'Nothing to make right now' : 'No finished batches yet'}>
              {view === 'active' ? 'New batches from HavenWear appear here automatically.' : undefined}
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link to={`/run/${r.id}`} className="block">
                    <Card className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-lg font-semibold">Batch {r.batch_ref}</div>
                          <div className="text-xs text-muted">{formatDate(r.batch_date)} · {r.products} products · {r.required} pieces</div>
                        </div>
                        <ChevronRight className="size-5 text-muted" aria-hidden />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <DtfBadge status={r.dtf_status} needsDtf={r.needs_dtf} />
                        {r.reprints_ready > 0 && <Pill tone="ok" icon={CheckCircle2}>{r.reprints_ready} reprints ready</Pill>}
                        {r.open_issues > 0 && <Pill tone="bad" icon={AlertTriangle}>{r.open_issues} open problems</Pill>}
                      </div>
                      <ProductionBar required={r.required} ready={r.ready} received={r.received} />
                      <div className="text-sm">
                        <strong className="tabular">{Math.max(r.required - r.ready, 0)}</strong> pieces still to make
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

export function TshirtRun() {
  const { id = '' } = useParams()
  const runs = useRunSummaries()
  const items = useProdItems(id)
  const issues = useIssues(id)
  const [tab, setTab] = useState<'todo' | 'problems' | 'done'>('todo')
  const [reporting, setReporting] = useState<ProdItemT | null>(null)
  const run = runs.data?.find((r) => r.id === id)

  const issuesByItem = useMemo(() => {
    const m = new Map<string, IssueT[]>()
    for (const q of issues.data ?? []) m.set(q.item_id, [...(m.get(q.item_id) ?? []), q])
    return m
  }, [issues.data])

  // One card per parent Shopify product; each SKU stays its own row (display-only grouping).
  const groups = useMemo(() => groupByProduct(items.data ?? []), [items.data])
  const openIssueItems = new Set((issues.data ?? []).filter((q) => q.status !== 'resolved').map((q) => q.item_id))
  const todo = groups.filter((g) => g.rows.some((r) => r.item.qty_ready < r.item.qty_required))
  const done = groups.filter((g) => g.rows.every((r) => r.item.qty_ready >= r.item.qty_required))
  const problems = groups.filter((g) => g.rows.some((r) => openIssueItems.has(r.item.id)))
  const shown = tab === 'todo' ? todo : tab === 'done' ? done : problems

  if (runs.isPending || items.isPending) return <><PortalHeader title="Batch" back /><ListSkeleton /></>
  if (!run) return <><PortalHeader title="Batch" back /><EmptyState icon={X} title="Batch not found" /></>

  return (
    <>
      <PortalHeader title={`Batch ${run.batch_ref}`} back subtitle={`${formatDate(run.batch_date)} · ${run.required} pieces`} />
      <Card className="mb-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <DtfBadge status={run.dtf_status} needsDtf={run.needs_dtf} />
          {run.needs_dtf && run.dtf_status === 'waiting' && <span className="text-xs text-muted">The DTF supplier has not marked the print file ready yet.</span>}
        </div>
        <ProductionBar required={run.required} ready={run.ready} received={run.received} />
      </Card>
      <Segmented
        label="Products"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'todo', label: 'To make', count: todo.length },
          { id: 'problems', label: 'Problems', count: problems.length },
          { id: 'done', label: 'Ready', count: done.length },
        ]}
      />
      <ul className="mt-3 flex flex-col gap-3">
        {shown.map((g) => (
          <li key={g.key}>
            <ProductCard g={g} issuesByItem={issuesByItem} dtfReady={run.dtf_status === 'file_ready'} onReport={setReporting} />
          </li>
        ))}
        {!shown.length && (
          <li>
            <EmptyState icon={CheckCircle2} title={tab === 'todo' ? 'Everything is marked ready' : tab === 'problems' ? 'No open problems' : 'Nothing ready yet'} />
          </li>
        )}
      </ul>
      <ReportProblemSheet item={reporting} onClose={() => setReporting(null)} />
    </>
  )
}

export function ProductCard({
  g,
  issuesByItem,
  dtfReady,
  onReport,
}: {
  g: ProductGroup<ProdItemT>
  issuesByItem: Map<string, IssueT[]>
  dtfReady: boolean
  onReport: (it: ProdItemT) => void
}) {
  const markReady = useMarkReady()
  const markMany = useMarkReadyMany()
  const resolve = useResolveIssue()
  const online = useOnline()
  const busy = markReady.isPending || markMany.isPending
  const pending = Math.max(g.required - g.ready, 0)
  const needsPrint = g.front_print || g.back_print
  const open = g.rows.flatMap((r) => (issuesByItem.get(r.item.id) ?? []).filter((q) => q.status !== 'resolved').map((q) => ({ q, label: r.label })))
  const [picking, setPicking] = useState(false)

  return (
    <Card className="flex flex-col gap-3 p-3">
      <ProductGallery images={[g.image_url, g.image2_url]} alt={g.title} />
      <div>
        <div className="text-base font-semibold leading-snug">{g.title}</div>
        {g.common && <div className="text-sm text-muted">{g.common}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <PrintBadges front={g.front_print} back={g.back_print} />
          <DtfBadge status={dtfReady ? 'file_ready' : 'waiting'} needsDtf={needsPrint} />
        </div>
      </div>

      <div className="rounded-xl bg-surface-2 p-3">
        <div className="tabular text-lg font-semibold">Total required: {g.required} pcs</div>
        <div className="tabular mt-0.5 text-sm">Sizes: {sizeSummary(g)}</div>
      </div>

      <div className="tabular grid grid-cols-3 gap-2 text-center">
        <Box label="Required" value={g.required} />
        <Box label="Ready" value={g.ready} good={g.ready >= g.required} />
        <Box label="Pending" value={pending} warn={pending > 0} />
      </div>

      {/* One row per SKU — every action still applies to that exact variant. */}
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border" aria-label={`Sizes of ${g.title}`}>
        {g.rows.map(({ item, label }) => {
          const p = itemProgress(item)
          return (
            <li key={item.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold">{label}</div>
                <div className="tabular text-xs text-muted">
                  {p.ready}/{p.required} ready{p.pendingProduction > 0 ? ` · ${p.pendingProduction} to make` : ''}
                </div>
              </div>
              {p.pendingProduction > 0 ? (
                <>
                  <Button size="icon" variant="ok" icon={Plus} aria-label={`1 ${label} ready`} disabled={!online || busy} onClick={() => markReady.mutate({ item: item.id, delta: 1 })} />
                  {p.pendingProduction > 1 && (
                    <Button variant="secondary" className="px-3" disabled={!online || busy} onClick={() => markReady.mutate({ item: item.id, delta: p.pendingProduction })} aria-label={`All ${p.pendingProduction} ${label} ready`}>
                      All
                    </Button>
                  )}
                </>
              ) : (
                <CheckCircle2 className="size-6 text-ok" aria-label={`${label} all ready`} />
              )}
              {p.ready > 0 && (
                <Button size="icon" variant="ghost" icon={Minus} aria-label={`Undo one ${label} ready`} disabled={!online || busy} onClick={() => markReady.mutate({ item: item.id, delta: -1 })} />
              )}
            </li>
          )
        })}
      </ul>

      {pending > 0 && g.rows.length > 1 && (
        <Button
          variant="primary"
          size="lg"
          block
          icon={CheckCircle2}
          disabled={!online || busy}
          loading={markMany.isPending}
          onClick={() =>
            markMany.mutate({ changes: g.rows.map(({ item }) => ({ item: item.id, delta: Math.max(item.qty_required - item.qty_ready, 0) })) })
          }
        >
          All {pending} pieces ready
        </Button>
      )}

      {open.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-bad-bg/60 p-2">
          {open.map(({ q, label }) => (
            <div key={q.id} className="flex flex-col gap-1">
              <div className="text-xs font-semibold text-muted">Size {label}</div>
              <IssueLine issue={q} />
              {(q.status === 'reprint_ready' || !q.dtf_relevant) && (
                <Button variant="ghost" icon={CheckCircle2} disabled={!online} onClick={() => resolve.mutate({ issue: q.id })}>
                  {q.status === 'reprint_ready' ? 'Reprint received — solved' : 'Mark solved'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Button
        variant="danger"
        icon={AlertTriangle}
        disabled={!online}
        onClick={() => (g.rows.length === 1 ? onReport(g.rows[0]!.item) : setPicking(true))}
      >
        Report problem
      </Button>

      <Sheet open={picking} onOpenChange={setPicking} title="Which size has the problem?" description={g.title}>
        <div className="grid grid-cols-2 gap-2">
          {g.rows.map(({ item, label }) => (
            <Button
              key={item.id}
              size="lg"
              onClick={() => {
                setPicking(false)
                onReport(item)
              }}
            >
              {label} · {item.qty_required} pc{item.qty_required === 1 ? '' : 's'}
            </Button>
          ))}
        </div>
      </Sheet>
    </Card>
  )
}

function Box({ label, value, good, warn }: { label: string; value: number; good?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 py-2">
      <div className={`text-xl font-semibold ${good ? 'text-ok' : warn ? 'text-warn' : ''}`}>{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  )
}

