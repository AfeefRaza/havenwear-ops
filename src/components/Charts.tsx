import { useSyncExternalStore, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Dashboard } from '../data/queries'
import { formatDate, formatInt, formatPKR } from '../domain/format'
import type { CategoryStock } from '../domain/stock'
import { Card } from './ui'

/**
 * Colours: validated categorical pair (supplier = blue slot 1, returns = orange slot 2) for both
 * light and dark surfaces. SVG presentation attributes can't use CSS variables, so we resolve
 * the tokens and re-read them when the colour scheme changes.
 */
function subscribeScheme(cb: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function useChartColors() {
  const dark = useSyncExternalStore(subscribeScheme, () => window.matchMedia('(prefers-color-scheme: dark)').matches, () => false)
  const css = getComputedStyle(document.documentElement)
  const v = (n: string) => css.getPropertyValue(n).trim()
  return {
    dark,
    supplier: v('--c-chart-supplier'),
    returns: v('--c-chart-return'),
    grid: v('--c-border'),
    text: v('--c-muted'),
    ink: v('--c-text'),
    surface: v('--c-surface'),
  }
}

const shortDate = (iso: string) => formatDate(iso).slice(0, 6) // "10-Sep"

function ChartCard({ title, summary, children, table }: { title: string; summary: string; children: ReactNode; table: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="sr-only">{summary}</p>
      <div className="h-56" aria-hidden>
        {children}
      </div>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer py-1">Show data table</summary>
        <div className="mt-2 max-h-60 overflow-auto">{table}</div>
      </details>
    </Card>
  )
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="tabular w-full text-left text-xs">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} className="py-1 pr-2 font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-border">
            {r.map((c, j) => (
              <td key={j} className="py-1 pr-2">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function useTooltipStyle() {
  const c = useChartColors()
  return {
    contentStyle: { background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 12, color: c.ink, fontSize: 12 },
    labelStyle: { color: c.ink, fontWeight: 600 },
    itemStyle: { color: c.ink },
    cursor: { fill: c.grid, opacity: 0.4 },
  }
}

export function ReturnsVsSupplierChart({ daily }: { daily: Dashboard['daily'] }) {
  const c = useChartColors()
  const tt = useTooltipStyle()
  const data = daily.map((d) => ({ ...d, label: shortDate(d.date) }))
  const tR = daily.reduce((s, d) => s + d.returns, 0)
  const tS = daily.reduce((s, d) => s + d.supplier, 0)
  return (
    <ChartCard
      title="Returns vs supplier · last 14 days"
      summary={`Over the last 14 days ${tR} pieces came from returns and ${tS} from the supplier.`}
      table={<DataTable head={['Date', 'Returns', 'Supplier']} rows={daily.map((d) => [formatDate(d.date), d.returns, d.supplier])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="0" />
          <XAxis dataKey="label" tick={{ fill: c.text, fontSize: 10 }} tickLine={false} axisLine={{ stroke: c.grid }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} tick={{ fill: c.text, fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
          <Tooltip {...tt} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: c.text }} />
          <Bar dataKey="supplier" name="Supplier" stackId="a" fill={c.supplier} stroke={c.surface} strokeWidth={2} maxBarSize={22} />
          <Bar dataKey="returns" name="Returns" stackId="a" fill={c.returns} stroke={c.surface} strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function CategoryProductionChart({ rows, periodLabel }: { rows: Dashboard['by_category']; periodLabel: string }) {
  const c = useChartColors()
  const tt = useTooltipStyle()
  return (
    <ChartCard
      title={`Production by category · ${periodLabel}`}
      summary={rows.map((r) => `${r.name}: ${r.pieces} pieces`).join(', ') || 'No production in this period.'}
      table={<DataTable head={['Category', 'Pieces']} rows={rows.map((r) => [r.name, r.pieces])} />}
    >
      {rows.length ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid horizontal={false} stroke={c.grid} />
            <XAxis type="number" allowDecimals={false} tick={{ fill: c.text, fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: c.ink, fontSize: 11 }} tickLine={false} axisLine={false} width={72} />
            <Tooltip {...tt} formatter={(v) => [formatInt(Number(v)), 'Pieces']} />
            <Bar dataKey="pieces" name="Pieces" fill={c.supplier} radius={[0, 4, 4, 0]} maxBarSize={20} label={{ position: 'right', fill: c.ink, fontSize: 11 }} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <Empty />
      )}
    </ChartCard>
  )
}

export function WeeklyCostChart({ weekly }: { weekly: Dashboard['weekly_cost'] }) {
  const c = useChartColors()
  const tt = useTooltipStyle()
  const data = weekly.map((w) => ({ ...w, label: shortDate(w.week) }))
  return (
    <ChartCard
      title="Weekly supplier cost (est.) · 12 weeks"
      summary={`Latest week ${formatPKR(weekly.at(-1)?.cost ?? 0)}.`}
      table={<DataTable head={['Week of', 'Cost']} rows={weekly.map((w) => [formatDate(w.week), formatPKR(w.cost)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" tick={{ fill: c.text, fontSize: 10 }} tickLine={false} axisLine={{ stroke: c.grid }} minTickGap={20} />
          <YAxis
            tick={{ fill: c.text, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
          />
          <Tooltip {...tt} cursor={{ stroke: c.grid }} formatter={(v) => [formatPKR(Number(v)), 'Est. cost']} labelFormatter={(l) => `Week of ${l}`} />
          <Line type="monotone" dataKey="cost" stroke={c.supplier} strokeWidth={2} dot={{ r: 3, fill: c.supplier, stroke: c.surface, strokeWidth: 2 }} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function StockChart({ stock }: { stock: CategoryStock[] }) {
  const c = useChartColors()
  const tt = useTooltipStyle()
  return (
    <ChartCard
      title="Current stock by category"
      summary={stock.map((s) => `${s.name}: ${s.stock}`).join(', ')}
      table={<DataTable head={['Category', 'Stock', 'Pending']} rows={stock.map((s) => [s.name, s.stock, s.pending])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={stock} margin={{ top: 16, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="name" tick={{ fill: c.ink, fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
          <YAxis allowDecimals={false} tick={{ fill: c.text, fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
          <ReferenceLine y={0} stroke={c.text} />
          <Tooltip {...tt} formatter={(v) => [formatInt(Number(v)), 'Stock']} />
          <Bar dataKey="stock" name="Stock" fill={c.supplier} radius={[4, 4, 0, 0]} maxBarSize={36} label={{ position: 'top', fill: c.ink, fontSize: 11 }} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function Empty() {
  return <div className="grid h-full place-items-center text-sm text-muted">No data for this period</div>
}
