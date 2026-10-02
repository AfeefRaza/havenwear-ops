import type { ReactNode } from 'react'
import { Drawer } from 'vaul'

/** Bottom sheet (used instead of modals). Swipe down or tap outside to close. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] max-w-xl flex-col rounded-t-3xl border border-border bg-surface outline-none"
        >
          <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-border" aria-hidden />
          <div className="px-4 pb-2 pt-3">
            <Drawer.Title className="text-lg font-semibold">{title}</Drawer.Title>
            {description ? (
              <Drawer.Description className="text-sm text-muted">{description}</Drawer.Description>
            ) : (
              <Drawer.Description className="sr-only">{title}</Drawer.Description>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
          {footer && <div className="pb-safe border-t border-border bg-surface px-4 pt-3 pb-3">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
