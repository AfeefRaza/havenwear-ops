import { ArrowLeft, LogOut, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useConfirm } from '../components/Confirm'
import { Button } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useOnline } from '../lib/hooks'
import { useSupplier } from '../lib/workspace'
import { DtfHome } from './DtfPortal'
import { TshirtHome, TshirtRun } from './TshirtPortal'

export default function SupplierPortal() {
  const { role } = useSupplier()
  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-10">
      <Routes>
        {role === 'tshirt_supplier' ? (
          <>
            <Route path="/" element={<TshirtHome />} />
            <Route path="/run/:id" element={<TshirtRun />} />
          </>
        ) : (
          <Route path="/" element={<DtfHome />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export function PortalHeader({ title, subtitle, back }: { title: string; subtitle?: ReactNode; back?: boolean }) {
  const { signOutThisDevice } = useAuth()
  const { role } = useSupplier()
  const online = useOnline()
  const navigate = useNavigate()
  const [confirmEl, confirm] = useConfirm()
  return (
    <header className="pt-safe sticky top-0 z-20 -mx-4 mb-3 bg-bg/90 px-4 backdrop-blur">
      <div className="flex min-h-14 items-center gap-2">
        {back && <Button size="icon" variant="ghost" icon={ArrowLeft} aria-label="Back" onClick={() => navigate(-1)} />}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            HavenWear · {role === 'tshirt_supplier' ? 'T-shirt supplier' : 'DTF supplier'}
          </div>
          <h1 className="truncate text-xl font-semibold">{title}</h1>
          {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
        </div>
        {!online && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-2.5 py-1 text-xs font-semibold text-warn" role="status">
            <WifiOff className="size-3.5" aria-hidden /> Offline
          </span>
        )}
        {!back && (
          <Button
            size="icon"
            variant="ghost"
            icon={LogOut}
            aria-label="Sign out"
            onClick={async () => {
              if (await confirm({ title: 'Sign out of this device?', confirmLabel: 'Sign out', danger: true })) await signOutThisDevice()
            }}
          />
        )}
      </div>
      {confirmEl}
    </header>
  )
}
