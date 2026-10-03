import { ChevronRight, DatabaseBackup, Scale, Settings, ShoppingBag, Tags, UserRound, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { useWorkspace } from '../lib/workspace'

const LINKS: { to: string; label: string; hint: string; icon: LucideIcon }[] = [
  { to: '/more/rules', label: 'Rules & categories', hint: 'Keywords, costs, unmatched names', icon: Tags },
  { to: '/more/shopify', label: 'Shopify products', hint: 'Product pictures + front/back print settings', icon: ShoppingBag },
  { to: '/more/stock', label: 'Opening stock & adjustments', hint: 'Starting stock and stock counts', icon: Scale },
  { to: '/more/data', label: 'Export / Import', hint: 'Backup to Excel or JSON, import workbook', icon: DatabaseBackup },
  { to: '/more/account', label: 'Account & devices', hint: 'Sign out, team members', icon: UserRound },
  { to: '/more/settings', label: 'Settings', hint: 'Auto-archive, app lock PIN', icon: Settings },
]

export default function More() {
  const { workspace } = useWorkspace()
  return (
    <>
      <PageHeader title="More" subtitle={workspace.name} />
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {LINKS.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <span className="grid size-10 place-items-center rounded-xl bg-surface-2 text-text">
                <l.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{l.label}</span>
                <span className="block truncate text-xs text-muted">{l.hint}</span>
              </span>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-center text-xs text-muted">HavenWear Ops · v{__APP_VERSION__}</p>
    </>
  )
}
