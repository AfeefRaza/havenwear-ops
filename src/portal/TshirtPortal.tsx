import { AlertTriangle, CheckCircle2, ChevronRight, Factory, Minus, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DtfBadge, IssueLine, ItemHeader, ProductionBar, ReportProblemSheet } from '../components/ProductionBits'
import { Button, Card, EmptyState, ErrorNote, ListSkeleton, Pill, Segmented } from '../components/ui'
import { useIssues, useMarkReady, useProdItems, useResolveIssue, useRunSummaries, type IssueT, type ProdItemT } from '../data/production'
import { formatDate } from '../domain/format'
import { itemProgress } from '../domain/production'
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

  const list = (items.data ?? []).filter((i) => i.qty_required > 0)
  const openIssueItems = new Set((issues.data ?? []).filter((q) => q.status !== 'resolved').map((q) => q.item_id))
  const todo = list.filter((i) => i.qty_ready < i.qty_required)
  const done = list.filter((i) => i.qty_ready >= i.qty_required)
  const problems = list.filter((i) => openIssueItems.has(i.id))
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
        {shown.map((it) => (
          <li key={it.id}>
            <TshirtItem it={it} issues={issuesByItem.get(it.id) ?? []} dtfReady={run.dtf_status === 'file_ready'} onReport={() => setReporting(it)} />
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

function TshirtItem({ it, issues, dtfReady, onReport }: { it: ProdItemT; issues: IssueT[]; dtfReady: boolean; onReport: () => void }) {
  const markReady = useMarkReady()
  const resolve = useResolveIssue()
  const online = useOnline()
  const p = itemProgress(it)
  const open = issues.filter((q) => q.status !== 'resolved')
  return (
    <Card className="flex flex-col gap-3 p-3">
      <ItemHeader it={it}>
        <div className="mt-1">
          <DtfBadge status={dtfReady ? 'file_ready' : 'waiting'} needsDtf={it.front_print || it.back_print} />
        </div>
      </ItemHeader>
      <div className="tabular grid grid-cols-3 gap-2 text-center">
        <Box label="Required" value={p.required} />
        <Box label="Ready" value={p.ready} good={p.ready >= p.required} />
        <Box label="Pending" value={p.pendingProduction} warn={p.pendingProduction > 0} />
      </div>
      {p.pendingProduction > 0 ? (
        <div className="flex gap-2">
          <Button className="flex-1" variant="ok" size="lg" icon={Plus} disabled={!online || markReady.isPending} onClick={() => markReady.mutate({ item: it.id, delta: 1 })}>
            1 ready
          </Button>
          {p.pendingProduction > 1 && (
            <Button className="flex-1" variant="primary" size="lg" icon={CheckCircle2} disabled={!online || markReady.isPending} onClick={() => markReady.mutate({ item: it.id, delta: p.pendingProduction })}>
              All {p.pendingProduction} ready
            </Button>
          )}
        </div>
      ) : (
        <Pill tone="ok" icon={CheckCircle2} className="self-start">All {p.required} marked ready</Pill>
      )}
      {open.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-bad-bg/60 p-2">
          {open.map((q) => (
            <div key={q.id} className="flex flex-col gap-1">
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
      <div className="flex gap-2">
        <Button className="flex-1" variant="danger" icon={AlertTriangle} disabled={!online} onClick={onReport}>
          Report problem
        </Button>
        {p.ready > 0 && (
          <Button variant="ghost" icon={Minus} aria-label="Undo one ready" disabled={!online || markReady.isPending} onClick={() => markReady.mutate({ item: it.id, delta: -1 })}>
            Undo 1
          </Button>
        )}
      </div>
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

