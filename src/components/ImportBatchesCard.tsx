import { CloudDownload, TriangleAlert } from 'lucide-react'
import { useDismissImport, useImportAttention, useImportNow, useImportStatus } from '../data/shopifyImport'
import { useOnline } from '../lib/hooks'
import { Button, Card } from './ui'

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * "Import new batches": one tap checks Shopify for orders newly tagged `done` plus a batch date
 * (e.g. 11nov26) and adds them to that batch, creating it if needed. Manual batches, pasted lists and
 * the CSV import keep working exactly as before. Hidden until importing has been switched on.
 */
export function ImportBatchesCard() {
  const status = useImportStatus()
  const attention = useImportAttention()
  const run = useImportNow()
  const dismiss = useDismissImport()
  const online = useOnline()

  if (!status.data?.baseline_at) return null
  const s = status.data
  const notes = attention.data ?? []
  const last = s.last_success_at ? timeFmt.format(new Date(s.last_success_at)) : null

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Import from Shopify</div>
          <p className="text-xs text-muted">
            Orders tagged <strong>done</strong> + a batch date (like <strong>11nov26</strong>) are added to that batch.
            {last ? ` Last checked ${last}.` : ''}
          </p>
        </div>
        <Button variant="primary" icon={CloudDownload} disabled={!online} loading={run.isPending} onClick={() => run.mutate()}>
          Import new batches
        </Button>
      </div>
      {s.last_error && !run.isPending && (
        <p role="alert" className="rounded-xl bg-bad-bg p-2 text-xs text-bad">
          The last check did not finish: {s.last_error}. Nothing was changed — try again.
        </p>
      )}
      {notes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-warn-bg p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-warn">
            <TriangleAlert className="size-4" aria-hidden />
            {notes.length} order{notes.length === 1 ? '' : 's'} need{notes.length === 1 ? 's' : ''} a look
          </div>
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n.shopify_order_id} className="flex items-start gap-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div>
                    <strong>{n.order_name}</strong>
                    {n.batch_tag ? <span className="text-muted"> · {n.batch_tag}</span> : null}
                  </div>
                  <div className="text-muted">{n.note}</div>
                </div>
                <Button variant="ghost" disabled={!online} loading={dismiss.isPending && dismiss.variables === n.shopify_order_id} onClick={() => dismiss.mutate(n.shopify_order_id)}>
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted">Imported items are never changed automatically. Fix the batch by hand if needed, then dismiss.</p>
        </div>
      )}
    </Card>
  )
}
