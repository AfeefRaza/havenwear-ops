import { CheckCircle2, FileCheck2, FileClock, History, PackageCheck, Undo2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { DtfBadge, IssueLine, ItemHeader, ProductionBar } from '../components/ProductionBits'
import { Sheet } from '../components/Sheet'
import { Button, Card, EmptyState, ListSkeleton, SectionTitle, Stepper } from '../components/ui'
import {
  useEvents,
  useIssues,
  useProdItems,
  useReceive,
  useResolveIssue,
  useRunSummaries,
  useSetDtfReady,
  type ProdItemT,
} from '../data/production'
import { formatDate } from '../domain/format'
import { EVENT_LABEL, ISSUE_LABEL, itemProgress, ROLE_LABEL, type IssueKind } from '../domain/production'
import { useOnline } from '../lib/hooks'

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function ProductionRun() {
  const { id = '' } = useParams()
  const runs = useRunSummaries()
  const items = useProdItems(id)
  const issues = useIssues(id)
  const events = useEvents(id)
  const setDtf = useSetDtfReady()
  const resolve = useResolveIssue()
  const online = useOnline()
  const [receiving, setReceiving] = useState<ProdItemT | null>(null)
  const run = runs.data?.find((r) => r.id === id)
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data])
  const openIssues = (issues.data ?? []).filter((q) => q.status !== 'resolved')

  if (runs.isPending) return <><PageHeader title="Production" back /><ListSkeleton /></>
  if (!run) return <><PageHeader title="Production" back /><EmptyState icon={X} title="Not found">This production batch no longer exists.</EmptyState></>

  return (
    <>
      <PageHeader title={`Batch ${run.batch_ref}`} back subtitle={`${formatDate(run.batch_date)} · pushed ${timeFmt.format(new Date(run.pushed_at))}`} />
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DtfBadge status={run.dtf_status} />
          <Link to={`/batches/${run.batch_id}`} className="text-xs font-medium text-info underline-offset-2 hover:underline">
            Open batch →
          </Link>
        </div>
        <ProductionBar required={run.required} ready={run.ready} received={run.received} />
        <dl className="tabular grid grid-cols-2 gap-2 text-sm">
          <Row label="Supplier required" value={run.required} />
          <Row label="Pending production" value={Math.max(run.required - run.ready, 0)} />
          <Row label="Ready but not received" value={run.ready_not_received} warn />
          <Row label="Front / back prints" value={`${run.front_prints} / ${run.back_prints}`} />
        </dl>
        <Button
          variant={run.dtf_status === 'file_ready' ? 'secondary' : 'ok'}
          icon={run.dtf_status === 'file_ready' ? FileClock : FileCheck2}
          disabled={!online}
          loading={setDtf.isPending}
          onClick={() => setDtf.mutate({ run: run.id, ready: run.dtf_status !== 'file_ready' })}
        >
          {run.dtf_status === 'file_ready' ? 'Mark DTF file NOT ready' : 'Mark DTF file ready (on behalf of DTF)'}
        </Button>
      </Card>

      {openIssues.length > 0 && (
        <>
          <SectionTitle>Open problems</SectionTitle>
          <Card className="flex flex-col gap-3">
            {openIssues.map((q) => (
              <div key={q.id} className="flex flex-col gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
                <IssueLine issue={q} item={itemById.get(q.item_id)} />
                <Button variant="ghost" icon={CheckCircle2} disabled={!online} onClick={() => resolve.mutate({ issue: q.id })}>
                  Mark solved
                </Button>
              </div>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>Products</SectionTitle>
      {items.isPending ? (
        <ListSkeleton />
      ) : (
        <ul className="flex flex-col gap-2">
          {(items.data ?? []).filter((i) => i.qty_required > 0).map((it) => {
            const p = itemProgress(it)
            return (
              <li key={it.id}>
                <Card className="flex flex-col gap-3 p-3">
                  <ItemHeader it={it} />
                  <ProductionBar required={p.required} ready={p.ready} received={p.received} />
                  {p.readyNotReceived > 0 && (
                    <p className="text-xs font-semibold text-warn">{p.readyNotReceived} marked ready by supplier but not received yet</p>
                  )}
                  <Button icon={PackageCheck} variant={p.notReceived ? 'primary' : 'secondary'} disabled={!online} onClick={() => setReceiving(it)}>
                    {p.notReceived ? `Mark received (${p.notReceived} left)` : 'All received — correct'}
                  </Button>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <SectionTitle>
        <span className="inline-flex items-center gap-1">
          <History className="size-4" aria-hidden /> History
        </span>
      </SectionTitle>
      <Card className="p-0">
        <ol className="divide-y divide-border">
          {(events.data ?? []).map((e) => {
            const item = e.item_id ? itemById.get(e.item_id) : undefined
            const what = EVENT_LABEL[e.kind] ?? e.kind
            const detail = e.kind === 'issue_reported' || e.kind === 'reprint_ready' || e.kind === 'issue_resolved' ? ISSUE_LABEL[e.detail as IssueKind] ?? e.detail : e.detail
            return (
              <li key={e.id} className="flex gap-3 px-4 py-2.5 text-sm">
                <time className="tabular w-24 shrink-0 text-xs text-muted" dateTime={e.created_at}>
                  {timeFmt.format(new Date(e.created_at))}
                </time>
                <div className="min-w-0">
                  <div>
                    <strong>{what}</strong>
                    {e.qty != null && <span className="tabular"> · {e.qty > 0 ? e.qty : e.qty}</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {[item ? `${item.product_title}${item.size ? ` (${item.size})` : ''}` : null, detail && !item ? detail : detail && detail !== item?.product_title ? detail : null, e.actor_role ? `by ${ROLE_LABEL[e.actor_role] ?? e.actor_role}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </li>
            )
          })}
          {!events.data?.length && <li className="px-4 py-3 text-sm text-muted">No history yet.</li>}
        </ol>
      </Card>

      <ReceiveSheet item={receiving} onClose={() => setReceiving(null)} />
    </>
  )
}

function Row({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-lg font-semibold ${warn && Number(value) > 0 ? 'text-warn' : ''}`}>{value}</dd>
    </div>
  )
}

function ReceiveSheet({ item, onClose }: { item: ProdItemT | null; onClose: () => void }) {
  const receive = useReceive()
  const online = useOnline()
  const p = item ? itemProgress(item) : null
  const [qty, setQty] = useState(1)
  const [shown, setShown] = useState<string | null>(null)
  if (item && p && item.id !== shown) {
    setShown(item.id)
    setQty(Math.max(Math.min(p.readyNotReceived || p.notReceived, p.notReceived), p.notReceived ? 1 : 0))
  }
  return (
    <Sheet
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title="Mark received"
      description="Only what physically reached Havenwear. Batch lines and stock update automatically."
      footer={
        item &&
        p && (
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              size="lg"
              block
              icon={PackageCheck}
              disabled={!online || qty < 1 || qty > p.notReceived}
              loading={receive.isPending}
              onClick={() => {
                receive.mutate({ item: item.id, delta: qty })
                onClose()
              }}
            >
              Received {qty} piece{qty === 1 ? '' : 's'}
            </Button>
            {p.received > 0 && (
              <Button
                variant="ghost"
                icon={Undo2}
                disabled={!online}
                onClick={() => {
                  receive.mutate({ item: item.id, delta: -1 })
                  onClose()
                }}
              >
                Correction: remove 1 received
              </Button>
            )}
          </div>
        )
      }
    >
      {item && p && (
        <div className="flex flex-col gap-4">
          <ItemHeader it={item} />
          <ProductionBar required={p.required} ready={p.ready} received={p.received} />
          {p.notReceived > 0 ? (
            <Stepper label="Pieces received now" value={qty} onChange={setQty} min={1} max={p.notReceived} />
          ) : (
            <p className="text-sm text-muted">Everything for this product has been received.</p>
          )}
        </div>
      )}
    </Sheet>
  )
}
