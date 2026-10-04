import { CheckCircle2, ChevronDown, FileCheck2, Printer, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useConfirm } from '../components/Confirm'
import { DtfBadge, DtfReadySheet, ProductGallery, ProductImage } from '../components/ProductionBits'
import { Button, Card, EmptyState, ErrorNote, ListSkeleton, Pill, SectionTitle, Segmented } from '../components/ui'
import { useIssues, useProdItems, useReprintReady, useRunSummaries, useSetDtfReady, type RunSummary } from '../data/production'
import { formatDate } from '../domain/format'
import { dtfTotals, formatMeters, groupForDtf, ISSUE_LABEL } from '../domain/production'
import { cn, useOnline } from '../lib/hooks'
import { PortalHeader } from './SupplierPortal'

export function DtfHome() {
  const runs = useRunSummaries()
  const items = useProdItems()
  const issues = useIssues()
  const [tab, setTab] = useState<'jobs' | 'reprints'>('jobs')
  const openReprints = (issues.data ?? []).filter((q) => q.status === 'open')

  return (
    <>
      <PortalHeader title={tab === 'jobs' ? 'Print jobs' : 'Reprints / missing prints'} subtitle="Updates automatically" />
      <Segmented
        label="Section"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'jobs', label: 'Print jobs', count: (runs.data ?? []).filter((r) => r.dtf_status === 'waiting').length },
          { id: 'reprints', label: 'Reprints', count: openReprints.length },
        ]}
      />
      <div className="mt-3">
        {runs.isPending || items.isPending ? (
          <ListSkeleton />
        ) : runs.error && !runs.data ? (
          <ErrorNote error={runs.error} onRetry={() => void runs.refetch()} />
        ) : tab === 'jobs' ? (
          <Jobs runs={runs.data ?? []} />
        ) : (
          <Reprints />
        )}
      </div>
    </>
  )
}

function Jobs({ runs }: { runs: RunSummary[] }) {
  const waiting = runs.filter((r) => r.dtf_status === 'waiting')
  const ready = runs.filter((r) => r.dtf_status === 'file_ready')
  if (!runs.length) {
    return <EmptyState icon={Printer} title="No print jobs yet">New batches from HavenWear appear here automatically.</EmptyState>
  }
  return (
    <div className="flex flex-col gap-3">
      {waiting.length > 0 && <SectionTitle>New — file not ready yet</SectionTitle>}
      {waiting.map((r) => <JobCard key={r.id} r={r} defaultOpen={waiting.length === 1} />)}
      {ready.length > 0 && <SectionTitle>File ready</SectionTitle>}
      {ready.slice(0, 30).map((r) => <JobCard key={r.id} r={r} />)}
    </div>
  )
}

function JobCard({ r, defaultOpen }: { r: RunSummary; defaultOpen?: boolean }) {
  const items = useProdItems(r.id)
  const setReady = useSetDtfReady()
  const online = useOnline()
  const [confirmEl, confirm] = useConfirm()
  const [open, setOpen] = useState(!!defaultOpen)
  const [readyFor, setReadyFor] = useState<RunSummary | null>(null)
  const lines = useMemo(() => groupForDtf(items.data ?? []), [items.data])
  const totals = dtfTotals(lines)
  const isReady = r.dtf_status === 'file_ready'

  return (
    <Card className="flex flex-col gap-3">
      <button type="button" className="flex items-start justify-between gap-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <div>
          <div className="text-lg font-semibold">Batch {r.batch_ref}</div>
          <div className="text-xs text-muted">{formatDate(r.batch_date)} · {lines.length} designs</div>
          <div className="tabular mt-1 text-sm">
            Front prints <strong>{totals.front}</strong> · Back prints <strong>{totals.back}</strong>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <DtfBadge status={r.dtf_status} meters={r.dtf_meters} />
          <ChevronDown className={cn('size-5 text-muted transition', open && 'rotate-180')} aria-hidden />
        </div>
      </button>
      {open && (
        <ul className="flex flex-col divide-y divide-border">
          {lines.map((l) => (
            <li key={l.key} className="flex flex-col gap-2 py-3">
              <ProductGallery images={[l.image_url, l.image2_url]} alt={l.title} />
              <div className="min-w-0">
                <div className="text-base font-semibold leading-snug">{l.title}</div>
                <div className="tabular mt-1 flex gap-4 text-lg">
                  <span>Front: <strong>{l.front}</strong></span>
                  <span>Back: <strong>{l.back}</strong></span>
                </div>
                <div className="mt-0.5 text-xs text-muted">{l.variants.map((v) => `${v.label} ×${v.qty}`).join(' · ')}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant={isReady ? 'ghost' : 'ok'}
        size={isReady ? 'md' : 'lg'}
        block
        icon={isReady ? RotateCcw : FileCheck2}
        disabled={!online}
        loading={setReady.isPending}
        onClick={async () => {
          if (!isReady) return setReadyFor(r)
          if (await confirm({ title: 'Undo File Ready?', description: `The ${formatMeters(r.dtf_meters)} entered for this file will be removed.`, confirmLabel: 'Undo', danger: true }))
            setReady.mutate({ run: r.id, ready: false })
        }}
      >
        {isReady ? 'Undo File Ready' : 'File Ready'}
      </Button>
      <DtfReadySheet run={readyFor} onClose={() => setReadyFor(null)} />
      {confirmEl}
    </Card>
  )
}

function Reprints() {
  const runs = useRunSummaries()
  const items = useProdItems()
  const issues = useIssues()
  const reprint = useReprintReady()
  const online = useOnline()
  const runById = new Map((runs.data ?? []).map((r) => [r.id, r]))
  const itemById = new Map((items.data ?? []).map((i) => [i.id, i]))
  const open = (issues.data ?? []).filter((q) => q.status === 'open')
  const done = (issues.data ?? []).filter((q) => q.status !== 'open').slice(0, 20)

  return (
    <div className="flex flex-col gap-3">
      {!open.length && <EmptyState icon={CheckCircle2} title="No reprints needed">Missing or damaged prints reported by the T-shirt supplier appear here.</EmptyState>}
      {open.map((q) => {
        const it = itemById.get(q.item_id)
        const run = runById.get(q.run_id)
        return (
          <Card key={q.id} className="flex flex-col gap-3 border-bad/40 p-3">
            <div className="flex flex-col gap-3">
              <ProductGallery images={[it?.image_url, it?.image2_url]} alt={it?.product_title ?? 'Product'} />
              <div className="min-w-0">
                <div className="text-xs text-muted">Batch {run?.batch_ref ?? '—'} · {run ? formatDate(run.batch_date) : ''}</div>
                <div className="text-sm font-semibold leading-snug">{it?.product_title ?? 'Product'}</div>
                {it && <div className="text-sm text-muted">{[it.color, it.size].filter(Boolean).join(' · ')}</div>}
                <div className="mt-1 text-base font-semibold text-bad">{ISSUE_LABEL[q.kind]}</div>
                <div className="tabular text-base">Quantity: <strong>{q.qty}</strong></div>
                {q.note && <div className="text-xs text-muted">“{q.note}”</div>}
              </div>
            </div>
            <Button variant="ok" size="lg" block icon={CheckCircle2} disabled={!online} loading={reprint.isPending} onClick={() => reprint.mutate({ issue: q.id })}>
              Reprint Ready
            </Button>
          </Card>
        )
      })}
      {done.length > 0 && <SectionTitle>Recently done</SectionTitle>}
      {done.map((q) => {
        const it = itemById.get(q.item_id)
        return (
          <Card key={q.id} className="flex items-center gap-3 p-2 opacity-80">
            <ProductImage src={it?.image_url ?? null} alt={it?.product_title ?? 'Product'} size="sm" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium">{it?.product_title ?? 'Product'}</div>
              <div className="text-xs text-muted">{ISSUE_LABEL[q.kind]} × {q.qty}</div>
            </div>
            <Pill tone="ok" icon={CheckCircle2}>{q.status === 'resolved' ? 'Used' : 'Reprint ready'}</Pill>
          </Card>
        )
      })}
    </div>
  )
}
