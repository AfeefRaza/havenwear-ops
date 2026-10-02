import { AlertTriangle, Archive, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, CircleAlert, DatabaseBackup, Minus, Tags, TrendingUp } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { Card, ErrorNote, Pill, SectionTitle, Segmented, Skeleton } from '../components/ui'
import { useDashboard } from '../data/queries'
import { daysBetween, isoDateOf, PERIODS, todayISO, type Period } from '../domain/dates'
import { formatInt, formatPKR, formatPct } from '../domain/format'
import { stockByCategory, totalStock, type CategoryStock } from '../domain/stock'
import { usageRatios } from '../domain/totals'
import { returnTrend } from '../domain/trend'
import { useWorkspace } from '../lib/workspace'

const Charts = lazy(() => import('../components/Charts').then((m) => ({ default: m.ReturnsVsSupplierChart })))
const CategoryChart = lazy(() => import('../components/Charts').then((m) => ({ default: m.CategoryProductionChart })))
const WeeklyChart = lazy(() => import('../components/Charts').then((m) => ({ default: m.WeeklyCostChart })))
const StockChart = lazy(() => import('../components/Charts').then((m) => ({ default: m.StockChart })))

export default function Home() {
  const [period, setPeriod] = useState<Period>('7d')
  const q = useDashboard(period)
  const { workspace } = useWorkspace()
  const d = q.data
  const today = todayISO()

  const derived = useMemo(() => {
    if (!d) return null
    const ratios = usageRatios(d.period.from_returns, d.period.from_supplier, d.period.est_supplier_cost)
    // Feed Postgres aggregates through the same tested domain functions as the rest of the app.
    const stock = stockByCategory(
      d.stock.map((s) => ({ id: s.category_id, name: s.name, low_stock_level: s.low_stock_level, sort_order: s.sort_order })),
      {
        adjustments: d.stock.map((s) => ({ category_id: s.category_id, qty: s.adjustments })),
        returnLines: d.stock.map((s) => ({ category_id: s.category_id, qty: s.returns_in })),
        items: d.stock.flatMap((s) => [
          { qty: s.supplier, status: 'received' as const, received_from: 'supplier' as const, resolved_category_id: s.category_id },
          { qty: s.returns_used, status: 'received' as const, received_from: 'return' as const, resolved_category_id: s.category_id },
          { qty: s.pending, status: 'pending' as const, received_from: null, resolved_category_id: s.category_id },
        ]),
      },
    )
    const trend = returnTrend(
      d.daily.flatMap((x) => [
        { batch_date: x.date, qty: x.returns, status: 'received' as const, received_from: 'return' as const },
        { batch_date: x.date, qty: x.supplier, status: 'received' as const, received_from: 'supplier' as const },
      ]),
      today,
    )
    return { ratios, stock, trend }
  }, [d, today])

  const backupDue = !workspace.last_backup_at || daysBetween(isoDateOf(workspace.last_backup_at), today) >= 7
  const periodLabel = PERIODS.find((p) => p.id === period)!.label

  return (
    <>
      <PageHeader title="Dashboard" subtitle={workspace.name} />
      <div className="flex flex-col gap-3">
        {d && d.alerts.pending_lines > 0 && (
          <Link
            to="/pending"
            className="flex items-center gap-3 rounded-2xl border border-bad/30 bg-bad-bg p-4 text-bad"
            aria-label={`${d.alerts.pending_lines} pending lines, ${d.alerts.pending_pieces} pieces in active batches. Open pending list.`}
          >
            <AlertTriangle className="size-6 shrink-0" aria-hidden />
            <span className="flex-1 text-sm">
              <strong className="text-base">{formatInt(d.alerts.pending_lines)} pending lines</strong>
              <br />
              {formatInt(d.alerts.pending_pieces)} pieces still to receive in active batches
            </span>
            <ArrowRight className="size-5" aria-hidden />
          </Link>
        )}

        {(d?.unmatched_lines || d?.ready_to_archive || backupDue) && (
          <div className="flex flex-wrap gap-2">
            {!!d?.unmatched_lines && (
              <Link to="/more/rules" className="min-h-11 content-center">
                <Pill tone="warn" icon={Tags}>
                  {d.unmatched_lines} unmatched name{d.unmatched_lines === 1 ? '' : 's'}
                </Pill>
              </Link>
            )}
            {!!d?.ready_to_archive && (
              <Link to="/batches?tab=complete" className="min-h-11 content-center">
                <Pill tone="info" icon={Archive}>
                  {d.ready_to_archive} batch{d.ready_to_archive === 1 ? '' : 'es'} ready to archive
                </Pill>
              </Link>
            )}
            {backupDue && (
              <Link to="/more/data" className="min-h-11 content-center">
                <Pill tone="neutral" icon={DatabaseBackup}>
                  {workspace.last_backup_at ? 'Weekly backup due' : 'No backup yet'}
                </Pill>
              </Link>
            )}
          </div>
        )}

        <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />

        {q.error && !d && <ErrorNote error={q.error} onRetry={() => void q.refetch()} />}

        {!d || !derived ? (
          <div className="grid grid-cols-2 gap-3" aria-busy="true" aria-label="Loading dashboard">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Kpi label="Batches" value={formatInt(d.period.batches)} />
              <Kpi label="Pieces required" value={formatInt(d.period.required)} />
              <Kpi label="From returns" value={formatInt(d.period.from_returns)} />
              <Kpi label="From supplier" value={formatInt(d.period.from_supplier)} />
              <Kpi label="Supplier cost (est.)" value={formatPKR(d.period.est_supplier_cost)} />
              <Kpi label="Avg cost / piece" value={derived.ratios.avgSupplierCost == null ? '—' : formatPKR(derived.ratios.avgSupplierCost)} />
              <Kpi label="Return usage" value={formatPct(derived.ratios.returnPct)} />
              <Kpi label="Supplier usage" value={formatPct(derived.ratios.supplierPct)} />
              <Kpi label="Returned stock received" value={formatInt(d.returned_stock_received)} />
              <Kpi label="Current stock" value={formatInt(totalStock(derived.stock))} hint="all time" />
            </dl>

            <TrendCard trend={derived.trend} />

            <SectionTitle>Stock by category</SectionTitle>
            <StockList rows={derived.stock} />

            <SectionTitle>Charts</SectionTitle>
            <Suspense fallback={<Skeleton className="h-72" />}>
              <div className="flex flex-col gap-3">
                <Charts daily={d.daily} />
                <CategoryChart rows={d.by_category} periodLabel={periodLabel} />
                <WeeklyChart weekly={d.weekly_cost} />
                <StockChart stock={derived.stock} />
              </div>
            </Suspense>
          </>
        )}
      </div>
    </>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <dt className="text-xs text-muted">
        {label}
        {hint && <span className="ml-1 opacity-70">({hint})</span>}
      </dt>
      <dd className="tabular mt-1 text-xl font-semibold">{value}</dd>
    </div>
  )
}

function TrendCard({ trend }: { trend: ReturnType<typeof returnTrend> }) {
  const Icon = trend.direction === 'up' ? ArrowUpRight : trend.direction === 'down' ? ArrowDownRight : trend.direction === 'flat' ? Minus : TrendingUp
  return (
    <Card className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="flex-1">
        <h2 className="text-sm font-semibold">Return-stock trend</h2>
        <p className="text-sm">{trend.sentence}</p>
        <p className="tabular mt-1 text-xs text-muted">
          Last 7 days {formatPct(trend.current.pct)} · previous 7 days {formatPct(trend.previous.pct)}
        </p>
      </div>
    </Card>
  )
}

function StockList({ rows }: { rows: CategoryStock[] }) {
  if (!rows.length) return <p className="px-1 text-sm text-muted">No categories yet.</p>
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {rows.map((r) => {
        const s =
          r.status === 'shortage'
            ? { tone: 'bad' as const, icon: CircleAlert, text: 'Shortage' }
            : r.status === 'low'
              ? { tone: 'warn' as const, icon: AlertTriangle, text: 'Low' }
              : { tone: 'ok' as const, icon: CheckCircle2, text: 'OK' }
        return (
          <li key={r.categoryId} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{r.name}</div>
              <div className="tabular text-xs text-muted">
                +{r.adjustments + r.returnsIn + r.madeBySupplier} in · −{r.used} used
                {r.pending ? ` · ${r.pending} pending` : ''}
              </div>
            </div>
            <span className={`tabular text-lg font-semibold ${r.status === 'shortage' ? 'text-bad' : ''}`}>{formatInt(r.stock)}</span>
            <Pill tone={s.tone} icon={s.icon}>
              {s.text}
            </Pill>
          </li>
        )
      })}
    </ul>
  )
}
