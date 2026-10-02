import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Sheet } from './Sheet'
import { Button } from './ui'

interface ConfirmOpts {
  title: string
  description?: string
  confirmLabel?: string
  danger?: boolean
}

/** Bottom-sheet confirmation. `const [confirmEl, confirm] = useConfirm(); if (await confirm({...})) …` */
export function useConfirm(): [ReactNode, (o: ConfirmOpts) => Promise<boolean>] {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const ask = useCallback((o: ConfirmOpts) => {
    setOpts(o)
    return new Promise<boolean>((res) => {
      resolver.current = res
    })
  }, [])

  const close = (v: boolean) => {
    resolver.current?.(v)
    resolver.current = null
    setOpts(null)
  }

  const el = (
    <Sheet
      open={!!opts}
      onOpenChange={(o) => !o && close(false)}
      title={opts?.title ?? ''}
      description={opts?.description}
      footer={
        <div className="flex gap-2">
          <Button block onClick={() => close(false)}>
            Cancel
          </Button>
          <Button block variant={opts?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {opts?.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      }
    >
      <span />
    </Sheet>
  )
  return [el, ask]
}
