import { ImageOff, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/hooks'

const sized = (src: string, w: number) => (src.includes('?') ? `${src}&width=${w}` : `${src}?width=${w}`)

/**
 * Small product picture for dense lists (same height as the row's buttons, so rows don't grow).
 * Tap → large preview; close with the ✕, a tap outside the picture, or Esc.
 */
export function ProductThumb({ src, alt }: { src: string | null; alt: string }) {
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState(false)

  if (!src || broken) {
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted sm:size-11" role="img" aria-label={`${alt} (no picture)`}>
        <ImageOff className="size-4" aria-hidden />
      </span>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        onTouchStart={(e) => e.stopPropagation()}
        className="size-10 shrink-0 overflow-hidden rounded-lg bg-surface-2 active:scale-95 sm:size-11"
        aria-label={`Show larger picture of ${alt}`}
      >
        {/* 96 px from Shopify's CDN (2× for sharp phone screens); lazy so long lists stay fast. */}
        <img src={sized(src, 96)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover" />
      </button>
      {open && <ImagePreview src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Centered full-size picture. Native <dialog>: Esc closes it and focus stays inside while open. */
function ImagePreview({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    // Backdrop tap closes it; keyboard users have Esc (native to <dialog>) and the Close button.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-label={alt}
      onClose={onClose}
      onClick={(e) => {
        // React events bubble through the component tree, not the DOM: keep taps here away from the row.
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      className="m-auto max-h-[92dvh] w-[min(92vw,640px)] overflow-visible rounded-2xl bg-transparent p-0 backdrop:bg-black/70"
    >
      <div className={cn('relative rounded-2xl bg-surface p-2 shadow-xl')}>
        <img src={sized(src, 1200)} alt={alt} referrerPolicy="no-referrer" className="max-h-[80dvh] w-full rounded-xl bg-surface-2 object-contain" />
        <p className="px-1 pt-2 text-sm font-medium">{alt}</p>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 grid size-10 place-items-center rounded-full bg-black/60 text-white"
          aria-label="Close picture"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    </dialog>
  )
}
