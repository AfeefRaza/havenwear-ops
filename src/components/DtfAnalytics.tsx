import { Printer } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { useDtfAnalytics } from '../data/production'
import { todayISO } from '../domain/dates'
import { formatDate, formatPKR } from '../domain/format'
import { formatMeters } from '../domain/production'
import { Card, ErrorNote, SectionTitle, Skeleton } from './ui'

const DtfMetersChart = lazy(() => import('./Charts').then((m) => ({ default: m.DtfMetersChart })))

/** DTF consumption & cost analytics for the Havenwear dashboard (costs never reach suppliers). */
export function DtfAnalyticsSection() {
  const q = useDtfAnalytics(todayISO())
  const d = q.data

  return (
    <section aria-labelledby="dtf-analytics">
      <SectionTitle>
        <span id="dtf-analytics" className="inline-flex items-center gap-1.5">
          <Printer className="size-4" aria-hidden /> DTF printing
        </span>
      </SectionTitle>
      {q.error && !d ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Total DTF meters" value={formatMeters(d.total.meters)} sub={`${d.total.files} file${d.total.files === 1 ? '' : 's'} · ${d.total.batches} batch${d.total.batches === 1 ? '' : 'es'}`} />
            <Stat label="Total DTF cost" value={formatPKR(d.total.cost)} />
            <Stat label="Today" value={formatMeters(d.today.meters)} sub={formatPKR(d.today.cost)} />
            <Stat label="This week" value={formatMeters(d.week.meters)} sub={formatPKR(d.week.cost)} />
            <Stat label="This month" value={formatMeters(d.month.meters)} sub={formatPKR(d.month.cost)} />
            <Stat
              label="Avg per batch"
              value={d.total.batches ? formatMeters(d.total.meters / d.total.batches) : '—'}
              sub={d.total.batches ? formatPKR(d.total.cost / d.total.batches) : undefined}
            />
            <Stat
              label="Cost per printed piece"
              value={d.printed.pieces ? formatPKR(d.total.cost / d.printed.pieces) : '—'}
              sub={d.printed.pieces ? `${formatMeters(d.total.meters / d.printed.pieces)} per piece` : undefined}
            />
            <Stat label="Cost per print (side)" value={d.printed.prints ? formatPKR(d.total.cost / d.printed.prints) : '—'} sub={`${d.printed.prints} prints`} />
            <Stat
              label="Current rate"
              value={d.rate != null ? `${formatPKR(d.rate)}/m` : '—'}
              sub={d.rates.length > 1 ? `Past rates: ${d.rates.map((r) => formatPKR(r)).join(', ')}` : 'Change in More → Settings'}
            />
          </dl>

          {d.total.files > 0 && (
            <Suspense fallback={<Skeleton className="h-72" />}>
              <DtfMetersChart daily={d.daily} />
            </Suspense>
          )}

          <Card className="p-0">
            <h3 className="px-4 pb-1 pt-3 text-sm font-semibold">Meterage by batch</h3>
            {!d.by_batch.length ? (
              <p className="px-4 pb-4 text-sm text-muted">No DTF files marked ready yet. Meters appear here when the DTF supplier taps File Ready.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tabular w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">Batch</th>
                      <th className="px-2 py-2 font-medium">Meters</th>
                      <th className="px-2 py-2 font-medium">Rate</th>
                      <th className="px-4 py-2 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.by_batch.slice(0, 15).map((b) => (
                      <tr key={b.run_id} className="border-t border-border">
                        <td className="px-4 py-2">
                          <Link to={`/production/${b.run_id}`} className="font-medium underline-offset-2 hover:underline">
                            {b.batch_ref}
                          </Link>
                          <div className="text-xs text-muted">{formatDate(b.batch_date)}{b.files > 1 ? ` · ${b.files} files` : ''}</div>
                        </td>
                        <td className="px-2 py-2">{formatMeters(b.meters)}</td>
                        <td className="px-2 py-2 text-muted">{b.rate != null ? formatPKR(b.rate) : '—'}</td>
                        <td className="px-4 py-2 text-right font-semibold">{formatPKR(b.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular mt-1 text-xl font-semibold">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted">{sub}</dd>}
    </div>
  )
}
