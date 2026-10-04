import { AlertTriangle, ChevronRight, Factory, PackageSearch } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { DtfBadge, ProductImage, ProductionBar } from '../components/ProductionBits'
import { Card, EmptyState, ErrorNote, ListSkeleton, Pill, SectionTitle, Segmented } from '../components/ui'
import { useProdItems, useRunSummaries, type RunSummary } from '../data/production'
import { formatDate, formatInt } from '../domain/format'
import { itemProgress } from '../domain/production'

export default function Production() {
  const runs = useRunSummaries()
  const items = useProdItems()
  const [view, setView] = useState<'active' | 'completed'>('active')

  const all = useMemo(() => runs.data ?? [], [runs.data])
  const active = all.filter((r) => !r.completed)
  const shown = view === 'active' ? active : all.filter((r) => r.completed)
  const runById = useMemo(() => new Map(all.map((r) => [r.id, r])), [all])

  const k = useMemo(() => {
    const sum = (f: (r: RunSummary) => number) => active.reduce((s, r) => s + f(r), 0)
    return {
      activeBatches: active.length,
      required: sum((r) => r.required),
      dtfWaiting: active.filter((r) => r.dtf_status === 'waiting').length,
      dtfReady: active.filter((r) => r.dtf_status === 'file_ready').length,
      ready: sum((r) => r.ready),
      pending: sum((r) => Math.max(r.required - r.ready, 0)),
      missingPrints: sum((r) => r.front_missing + r.back_missing + r.complete_missing),
      garment: sum((r) => r.garment_missing),
      reprintsPending: sum((r) => r.reprints_pending),
      reprintsReady: sum((r) => r.reprints_ready),
      readyNotReceived: sum((r) => r.ready_not_received),
      received: all.reduce((s, r) => s + r.received, 0),
    }
  }, [active, all])

  const rnr = useMemo(
    () =>
      (items.data ?? [])
        .map((it) => ({ it, p: itemProgress(it), run: runById.get(it.run_id) }))
        .filter((x) => x.p.readyNotReceived > 0)
        .sort((a, b) => (a.run?.batch_date ?? '').localeCompare(b.run?.batch_date ?? '')),
    [items.data, runById],
  )

  return (
    <>
      <PageHeader title="Production" subtitle="T-shirt supplier & DTF — live" />
      {runs.isPending ? (
        <ListSkeleton rows={4} />
      ) : runs.error && !runs.data ? (
        <ErrorNote error={runs.error} onRetry={() => void runs.refetch()} />
      ) : !all.length ? (
        <EmptyState icon={Factory} title="Nothing in production yet">
          Open a batch, tap <strong>Supplier</strong> on the items to be manufactured, then <strong>Push batch to production</strong>. Both suppliers
          will see them straight away.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Kpi label="Active production batches" value={k.activeBatches} />
            <Kpi label="Total supplier items" value={k.required} />
            <Kpi label="DTF waiting" value={k.dtfWaiting} tone={k.dtfWaiting ? 'warn' : undefined} />
            <Kpi label="DTF file ready" value={k.dtfReady} />
            <Kpi label="Supplier items ready" value={k.ready} />
            <Kpi label="Supplier items pending" value={k.pending} />
            <Kpi label="Missing prints" value={k.missingPrints} tone={k.missingPrints ? 'bad' : undefined} />
            <Kpi label="Garment problems" value={k.garment} tone={k.garment ? 'bad' : undefined} />
            <Kpi label="Reprints pending" value={k.reprintsPending} tone={k.reprintsPending ? 'warn' : undefined} />
            <Kpi label="Reprints ready" value={k.reprintsReady} />
            <Kpi label="Ready but not received" value={k.readyNotReceived} tone={k.readyNotReceived ? 'warn' : undefined} />
            <Kpi label="Total physically received" value={k.received} />
          </dl>

          <SectionTitle>Ready but not received</SectionTitle>
          {!rnr.length ? (
            <p className="px-1 text-sm text-muted">Everything the supplier marked ready has been received.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rnr.map(({ it, p, run }) => (
                <li key={it.id}>
                  <Link to={`/production/${it.run_id}`} className="block">
                    <Card className="flex items-center gap-3 border-warn/40 p-3">
                      <ProductImage src={it.image_url} alt={it.product_title} size="sm" />
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="text-xs text-muted">Batch {run?.batch_ref ?? '—'}</div>
                        <div className="font-semibold leading-snug">
                          {it.product_title} {[it.color, it.size].filter(Boolean).join(' ')}
                        </div>
                        <div className="tabular text-xs text-muted">
                          Supplier ready {p.ready} · Havenwear received {p.received}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="tabular text-lg font-semibold text-warn">{p.readyNotReceived}</div>
                        <div className="text-[11px] text-muted">missing</div>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <SectionTitle>Batches</SectionTitle>
          <Segmented
            label="Production batches"
            value={view}
            onChange={setView}
            options={[
              { id: 'active', label: 'In production', count: active.length },
              { id: 'completed', label: 'Completed', count: all.length - active.length },
            ]}
          />
          {!shown.length ? (
            <EmptyState icon={PackageSearch} title={view === 'active' ? 'No active production' : 'Nothing completed yet'} />
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((r) => (
                <li key={r.id}>
                  <RunCard r={r} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`rounded-2xl border bg-surface p-3 ${tone === 'bad' ? 'border-bad/40' : tone === 'warn' ? 'border-warn/40' : 'border-border'}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular mt-1 text-xl font-semibold ${tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : ''}`}>{formatInt(value)}</dd>
    </div>
  )
}

export function RunCard({ r }: { r: RunSummary }) {
  const issues = [
    ['Front print missing', r.front_missing],
    ['Back print missing', r.back_missing],
    ['Complete print missing', r.complete_missing],
    ['Garment missing', r.garment_missing],
    ['Other problems', r.other_issues],
  ].filter(([, n]) => (n as number) > 0) as [string, number][]
  return (
    <Link to={`/production/${r.id}`} className="block">
      <Card className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-base font-semibold">Batch {r.batch_ref}</div>
            <div className="text-xs text-muted">
              {formatDate(r.batch_date)} · {r.products} products
            </div>
          </div>
          <div className="flex items-center gap-1">
            <DtfBadge status={r.dtf_status} needsDtf={r.needs_dtf} meters={r.dtf_meters} />
            <ChevronRight className="size-5 text-muted" aria-hidden />
          </div>
        </div>
        <ProductionBar required={r.required} ready={r.ready} received={r.received} />
        <div className="tabular grid grid-cols-3 gap-2 text-center text-xs">
          <Mini label="Pending production" value={Math.max(r.required - r.ready, 0)} />
          <Mini label="Ready, not received" value={r.ready_not_received} warn={r.ready_not_received > 0} />
          <Mini label="Reprints pending" value={r.reprints_pending} warn={r.reprints_pending > 0} />
        </div>
        {issues.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-xl bg-bad-bg p-2 text-xs text-bad">
            {issues.map(([label, n]) => (
              <li key={label} className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" aria-hidden /> {label}: <strong className="tabular">{n}</strong>
              </li>
            ))}
          </ul>
        )}
        {r.completed && <Pill tone="ok">All received</Pill>}
      </Card>
    </Link>
  )
}

function Mini({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 px-1 py-2">
      <div className={`text-base font-semibold ${warn ? 'text-warn' : ''}`}>{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  )
}
