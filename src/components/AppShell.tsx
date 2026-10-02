import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Boxes, Clock, Home, Menu, PackageOpen, RefreshCw, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { invalidateWork } from '../data/mutations'
import { BatchSummaryRow } from '../data/queries'
import { todayISO } from '../domain/dates'
import { parseRows } from '../domain/schemas'
import { shouldAutoArchive } from '../domain/stage'
import { cn, haptic, useOnline } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace'
import { Button } from './ui'

const TABS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/batches', label: 'Batches', icon: Boxes },
  { to: '/pending', label: 'Pending', icon: Clock },
  { to: '/returns', label: 'Returns in', icon: PackageOpen },
  { to: '/more', label: 'More', icon: Menu },
]

export function AppShell({ children }: { children: ReactNode }) {
  useAutoArchive()
  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-2">
        Skip to content
      </a>
      {/* Desktop rail */}
      <nav aria-label="Main" className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3 md:flex">
        <div className="mb-4 flex items-center gap-2 px-2 pt-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-8" />
          <span className="font-semibold">HavenWear Ops</span>
        </div>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn('flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium', isActive ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2')
            }
          >
            <t.icon className="size-5" aria-hidden />
            {t.label}
          </NavLink>
        ))}
      </nav>

      <PullToRefresh>
        <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-10">
          {children}
        </main>
      </PullToRefresh>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:hidden"
      >
        <ul className="mx-auto flex max-w-xl">
          {TABS.map((t) => (
            <li key={t.to} className="flex-1">
              <NavLink
                to={t.to}
                end={t.end}
                onClick={() => haptic('tap')}
                className={({ isActive }) =>
                  cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', isActive ? 'text-text' : 'text-muted')
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn('grid h-7 w-12 place-items-center rounded-full transition', isActive && 'bg-surface-2')}>
                      <t.icon className="size-5" aria-hidden />
                    </span>
                    {t.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

/** Sticky page header with optional back button and actions. */
export function PageHeader({ title, back, actions, subtitle }: { title: string; back?: boolean; actions?: ReactNode; subtitle?: ReactNode }) {
  const navigate = useNavigate()
  const online = useOnline()
  return (
    <header className="pt-safe sticky top-0 z-20 -mx-4 mb-3 border-b border-transparent bg-bg/90 px-4 backdrop-blur">
      <div className="flex min-h-14 items-center gap-2">
        {back && <Button size="icon" variant="ghost" icon={ArrowLeft} aria-label="Back" onClick={() => navigate(-1)} />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{title}</h1>
          {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
        </div>
        {!online && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-2.5 py-1 text-xs font-semibold text-warn" role="status">
            <WifiOff className="size-3.5" aria-hidden /> Offline · read-only
          </span>
        )}
        {actions}
      </div>
    </header>
  )
}

function PullToRefresh({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const start = useRef<number | null>(null)
  const THRESHOLD = 70

  return (
    <div
      className="min-w-0 flex-1"
      onTouchStart={(e) => {
        start.current = window.scrollY <= 0 && !document.querySelector('[data-vaul-drawer]') ? (e.touches[0]?.clientY ?? null) : null
      }}
      onTouchMove={(e) => {
        if (start.current == null) return
        const dy = (e.touches[0]?.clientY ?? 0) - start.current
        setPull(dy > 0 ? Math.min(dy * 0.5, 100) : 0)
      }}
      onTouchEnd={async () => {
        const fire = pull >= THRESHOLD
        start.current = null
        setPull(0)
        if (fire && navigator.onLine) {
          haptic('tap')
          setRefreshing(true)
          invalidateWork(qc)
          await qc.refetchQueries({ type: 'active' })
          setRefreshing(false)
        }
      }}
    >
      <div
        className="flex items-center justify-center overflow-hidden text-muted transition-[height]"
        style={{ height: refreshing ? 40 : pull }}
        aria-hidden={!refreshing}
      >
        <RefreshCw className={cn('size-5', (refreshing || pull >= THRESHOLD) && 'animate-spin')} aria-hidden />
        {refreshing && <span className="sr-only" role="status">Refreshing</span>}
      </div>
      {children}
    </div>
  )
}

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for a new deployed version every hour while open.
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000)
    },
  })
  if (!needRefresh) return null
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[70] flex justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-lg">
        <RefreshCw className="size-5 text-info" aria-hidden />
        <span className="flex-1 text-sm">A new version of HavenWear Ops is available.</span>
        <Button variant="ghost" onClick={() => setNeedRefresh(false)}>
          Later
        </Button>
        <Button variant="primary" onClick={() => void updateServiceWorker(true)}>
          Update
        </Button>
      </div>
    </div>
  )
}

/** Optional setting: archive complete batches after N days. Runs once per app start. */
function useAutoArchive() {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  const days = workspace.auto_archive_days
  useEffect(() => {
    if (!days || !navigator.onLine) return
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase.from('batch_summaries').select('*').eq('workspace_id', workspace.id).eq('stage', 'complete')
      if (error || cancelled) return
      const today = todayISO()
      const due = parseRows(BatchSummaryRow, data, 'batch')
        .filter((b) => shouldAutoArchive(b.stage, b.last_item_change ?? b.updated_at, days, today))
        .map((b) => b.id)
      if (!due.length) return
      const { error: e2 } = await supabase.from('batches').update({ archived_at: new Date().toISOString() }).in('id', due)
      if (!e2) invalidateWork(qc)
    })()
    return () => {
      cancelled = true
    }
  }, [days, workspace.id, qc])
}
