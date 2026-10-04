import { AlertTriangle, CheckCircle2, Clock, FileCheck2, FileClock, ImageOff, Shirt, ZoomIn } from 'lucide-react'
import { useState } from 'react'
import type { IssueT, ProdItemT, RunSummary } from '../data/production'
import { useReportIssue, useSetDtfReady } from '../data/production'
import { formatMeters, ISSUE_LABEL, isDtfIssue, itemProgress, MAIN_ISSUES, OTHER_ISSUES, parseMeters, type IssueKind } from '../domain/production'
import { cn, useOnline } from '../lib/hooks'
import { Sheet } from './Sheet'
import { Button, Pill, Stepper, TextField } from './ui'

/** Normal Shopify product picture (lazy-loaded, sized for phones). */
export function ProductImage({ src, alt, size = 'md' }: { src: string | null; alt: string; size?: 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false)
  const box = size === 'sm' ? 'size-14' : size === 'lg' ? 'size-28' : 'size-20'
  if (!src || broken) {
    return (
      <div className={cn(box, 'grid shrink-0 place-items-center rounded-xl bg-surface-2 text-muted')} role="img" aria-label={`${alt} (no picture)`}>
        <ImageOff className="size-5" aria-hidden />
      </div>
    )
  }
  const w = size === 'lg' ? 400 : 240
  const url = src.includes('?') ? `${src}&width=${w}` : `${src}?width=${w}`
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className={cn(box, 'shrink-0 rounded-xl bg-surface-2 object-cover')}
    />
  )
}

export function PrintBadges({ front, back, frontQty, backQty }: { front: boolean; back: boolean; frontQty?: number; backQty?: number }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Pill tone={front ? 'info' : 'neutral'}>{front ? `Front${frontQty != null ? `: ${frontQty}` : ' ✓'}` : 'No front'}</Pill>
      <Pill tone={back ? 'info' : 'neutral'}>{back ? `Back${backQty != null ? `: ${backQty}` : ' ✓'}` : 'No back'}</Pill>
    </span>
  )
}

export function DtfBadge({ status, needsDtf = true, meters }: { status: RunSummary['dtf_status']; needsDtf?: boolean; meters?: number }) {
  if (!needsDtf) return <Pill tone="neutral">No DTF needed</Pill>
  return status === 'file_ready' ? (
    <Pill tone="ok" icon={FileCheck2}>DTF file ready{meters ? ` · ${formatMeters(meters)}` : ''}</Pill>
  ) : (
    <Pill tone="warn" icon={FileClock}>DTF waiting</Pill>
  )
}

/** "File Ready" — the DTF supplier must enter the film meterage used (decimals allowed). */
export function DtfReadySheet({ run, onClose }: { run: { id: string; batch_ref: string } | null; onClose: () => void }) {
  const setReady = useSetDtfReady()
  const online = useOnline()
  const [text, setText] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  if (run && run.id !== shown) {
    setShown(run.id)
    setText('')
  }
  const meters = parseMeters(text)
  const showError = text.trim() !== '' && meters == null
  const submit = () => {
    if (!run || meters == null) return
    setReady.mutate({ run: run.id, ready: true, meters }, { onSuccess: onClose })
  }
  return (
    <Sheet
      open={!!run}
      onOpenChange={(o) => !o && onClose()}
      title={`File ready · Batch ${run?.batch_ref ?? ''}`}
      description="Enter the total DTF meterage used for this file."
      footer={
        <Button variant="ok" size="lg" block icon={FileCheck2} disabled={!online || meters == null} loading={setReady.isPending} onClick={submit}>
          {meters != null ? `Mark File Ready · ${formatMeters(meters)}` : 'Enter meters to continue'}
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <TextField
          label="DTF meters used"
          inputMode="decimal"
          placeholder="e.g. 10.2"
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={showError ? 'Enter a number of meters, e.g. 5, 7.5 or 12.75' : undefined}
          hint="Decimals allowed (up to 2 places)."
        />
      </form>
    </Sheet>
  )
}


/** Required / Ready / Received bar with the "ready but not received" gap highlighted. */
export function ProductionBar({ required, ready, received }: { required: number; ready: number; received: number }) {
  const pct = (n: number) => (required > 0 ? Math.min(100, (n / required) * 100) : 0)
  return (
    <div className="flex flex-col gap-1">
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`${received} received, ${ready} ready of ${required} required`}
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-warn/60" style={{ width: `${pct(ready)}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-ok" style={{ width: `${pct(received)}%` }} />
      </div>
      <div className="tabular flex flex-wrap gap-x-3 text-xs text-muted">
        <span>Required <strong className="text-text">{required}</strong></span>
        <span>Ready <strong className="text-text">{ready}</strong></span>
        <span>Received <strong className="text-text">{received}</strong></span>
      </div>
    </div>
  )
}

function sized(src: string, w: number) {
  return src.includes('?') ? `${src}&width=${w}` : `${src}?width=${w}`
}

/**
 * The first two Shopify product pictures, large and side by side (the second often shows the
 * other print side). Tap a picture to see it full-size.
 */
export function ProductGallery({ images, alt }: { images: (string | null | undefined)[]; alt: string }) {
  const pics = [...new Set(images.filter((x): x is string => !!x))].slice(0, 2)
  const [zoom, setZoom] = useState<string | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const ok = pics.filter((p) => !broken.has(p))

  if (!ok.length) {
    return (
      <div className="grid aspect-[2/1] w-full place-items-center rounded-xl bg-surface-2 text-muted" role="img" aria-label={`${alt} (no picture)`}>
        <span className="flex items-center gap-2 text-sm">
          <ImageOff className="size-5" aria-hidden /> No picture
        </span>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {ok.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setZoom(src)}
            className={cn('group relative overflow-hidden rounded-xl bg-surface-2', ok.length === 1 ? 'col-span-2 aspect-[4/3]' : 'aspect-square')}
            aria-label={`Enlarge picture ${i + 1} of ${alt}`}
          >
            <img
              src={sized(src, 600)}
              alt={`${alt} (view ${i + 1})`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setBroken((b) => new Set(b).add(src))}
              className={cn('size-full', ok.length === 1 ? 'object-contain' : 'object-cover')}
            />
            <span className="absolute bottom-1.5 right-1.5 grid size-8 place-items-center rounded-full bg-black/55 text-white" aria-hidden>
              <ZoomIn className="size-4" />
            </span>
          </button>
        ))}
      </div>
      <Sheet open={!!zoom} onOpenChange={(o) => !o && setZoom(null)} title={alt}>
        {zoom && (
          <div className="flex flex-col gap-3">
            {ok.map((src, i) => (
              <img
                key={src}
                src={sized(src, 1200)}
                alt={`${alt} (view ${i + 1})`}
                referrerPolicy="no-referrer"
                className={cn('w-full rounded-xl bg-surface-2 object-contain', src !== zoom && 'opacity-90')}
              />
            ))}
          </div>
        )}
      </Sheet>
    </>
  )
}

/** Product card header: large two-picture gallery on top, details below. */
export function ItemHeader({ it, children }: { it: ProdItemT; children?: React.ReactNode }) {
  const label = [it.color, it.size ?? it.variant_title].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-3">
      <ProductGallery images={[it.image_url, it.image2_url]} alt={it.product_title} />
      <div className="min-w-0">
        <div className="text-base font-semibold leading-snug">{it.product_title}</div>
        {label && <div className="text-sm text-muted">{label}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <PrintBadges front={it.front_print} back={it.back_print} />
          <Pill tone="neutral" icon={Shirt}>Qty {it.qty_required}</Pill>
        </div>
        {children}
      </div>
    </div>
  )
}

export function IssueStatusPill({ issue }: { issue: IssueT }) {
  if (issue.status === 'resolved') return <Pill tone="ok" icon={CheckCircle2}>Solved</Pill>
  if (issue.status === 'reprint_ready') return <Pill tone="ok" icon={CheckCircle2}>Reprint ready</Pill>
  return issue.dtf_relevant ? <Pill tone="bad" icon={Clock}>Waiting for DTF reprint</Pill> : <Pill tone="bad" icon={AlertTriangle}>Open</Pill>
}

export function IssueLine({ issue, item }: { issue: IssueT; item?: ProdItemT }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-bad" aria-hidden />
      <span className="font-medium">{ISSUE_LABEL[issue.kind]}</span>
      <span className="tabular">× {issue.qty}</span>
      {item && <span className="text-muted">· {item.product_title}{item.size ? ` (${item.size})` : ''}</span>}
      <IssueStatusPill issue={issue} />
      {issue.note && <span className="w-full text-xs text-muted">“{issue.note}”</span>}
    </div>
  )
}

export function ReportProblemSheet({ item, onClose }: { item: ProdItemT | null; onClose: () => void }) {
  const report = useReportIssue()
  const online = useOnline()
  const [kind, setKind] = useState<IssueKind>('front_missing')
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  // Print problems only apply to sides that are actually printed (the database enforces this too).
  const applies = (k: IssueKind) => {
    if (!item) return true
    if (k === 'front_missing') return item.front_print
    if (k === 'back_missing') return item.back_print
    if (k === 'complete_missing' || k === 'wrong_print' || k === 'damaged_print') return item.front_print || item.back_print
    return true
  }
  if (item && item.id !== shown) {
    setShown(item.id)
    setKind(item.front_print ? 'front_missing' : item.back_print ? 'back_missing' : 'garment_missing')
    setQty(1)
    setNote('')
  }
  const max = Math.max(item?.qty_required ?? 1, 1)
  return (
    <Sheet
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title="Report a problem"
      description={item ? `${item.product_title}${item.size ? ` · ${item.size}` : ''}` : undefined}
      footer={
        <Button
          variant="danger"
          size="lg"
          block
          icon={AlertTriangle}
          disabled={!online}
          loading={report.isPending}
          onClick={() => item && report.mutate({ item: item.id, kind, qty, note: note.trim() || null }, { onSuccess: onClose })}
        >
          Report {ISSUE_LABEL[kind].toLowerCase()} · {qty} pc{qty === 1 ? '' : 's'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">What is wrong?</legend>
          <div className="grid grid-cols-2 gap-2">
            {[...MAIN_ISSUES, ...OTHER_ISSUES].map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                disabled={!applies(k)}
                onClick={() => setKind(k)}
                className={cn(
                  'min-h-12 rounded-xl border px-3 text-left text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40',
                  kind === k ? 'border-bad bg-bad-bg text-bad' : 'border-border bg-surface',
                  !MAIN_ISSUES.includes(k) && 'text-muted',
                )}
              >
                {ISSUE_LABEL[k]}
                {!applies(k) && <span className="block text-[11px] font-normal">No print on this product</span>}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="rounded-xl bg-surface-2 p-3 text-xs text-muted">
          {isDtfIssue(kind) ? 'This print problem is sent to the DTF supplier automatically as a reprint request.' : 'This problem stays between you and Havenwear (it does not go to the DTF supplier).'}
        </p>
        <Stepper label="Affected pieces" value={qty} onChange={setQty} min={1} max={max} />
        <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
    </Sheet>
  )
}

export function progressOf(it: ProdItemT) {
  return itemProgress(it)
}
