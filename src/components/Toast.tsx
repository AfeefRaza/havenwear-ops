import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn, haptic } from '../lib/hooks'

type ToastTone = 'success' | 'error' | 'info'
interface ToastInput {
  message: string
  tone?: ToastTone
  action?: { label: string; onClick: () => void }
  /** Called when the toast goes away without the action being used (e.g. commit a deferred delete). */
  onExpire?: () => void
  duration?: number
}
interface ToastItem extends ToastInput {
  id: number
}

const Ctx = createContext<((t: ToastInput) => void) | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const seq = useRef(0)

  const itemsRef = useRef<ToastItem[]>([])

  const remove = useCallback((id: number, expired: boolean) => {
    const t = itemsRef.current.find((x) => x.id === id)
    if (!t) return
    itemsRef.current = itemsRef.current.filter((x) => x.id !== id)
    setItems(itemsRef.current)
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    if (expired) t.onExpire?.()
  }, [])

  const push = useCallback(
    (t: ToastInput) => {
      const id = ++seq.current
      haptic(t.tone === 'error' ? 'warn' : t.tone === 'success' ? 'success' : 'tap')
      // Keep at most 3 on screen; older ones expire (committing any deferred action).
      for (const old of itemsRef.current.slice(0, -2)) remove(old.id, true)
      itemsRef.current = [...itemsRef.current, { ...t, id }]
      setItems(itemsRef.current)
      timers.current.set(id, setTimeout(() => remove(id, true), t.duration ?? (t.action ? 6000 : 3500)))
    },
    [remove],
  )

  // If the app is backgrounded/closed, commit pending deferred actions (e.g. deletes) right away.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'visible') return
      for (const t of [...itemsRef.current]) if (t.onExpire) remove(t.id, true)
    }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [remove])

  const value = useMemo(() => push, [push])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((t) => {
          const Icon = t.tone === 'error' ? TriangleAlert : t.tone === 'success' ? CheckCircle2 : Info
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-lg',
                'bg-[#141a29] text-white dark:bg-[#eef1f6] dark:text-[#141a29]',
              )}
            >
              <Icon className={cn('size-5 shrink-0', t.tone === 'error' && 'text-[#f87171] dark:text-[#b42318]')} aria-hidden />
              <span className="flex-1">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  className="min-h-11 rounded-lg px-3 font-semibold text-[#9fb3e0] underline-offset-2 hover:underline dark:text-[#1d4ed8]"
                  onClick={() => {
                    t.action!.onClick()
                    remove(t.id, false)
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button type="button" aria-label="Dismiss" className="grid size-11 place-items-center rounded-lg opacity-70" onClick={() => remove(t.id, true)}>
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}
