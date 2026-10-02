import { useQueryClient } from '@tanstack/react-query'
import { Download, FileJson, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { Button, Card, Pill, SectionTitle } from '../components/ui'
import { invalidateWork, useUpdateWorkspace } from '../data/mutations'
import { useCategories, useRules } from '../data/queries'
import { todayISO } from '../domain/dates'
import { formatDate, formatInt } from '../domain/format'
import { buildImportPlan, type ImportPlan, type Sheets } from '../domain/importPlan'
import { planToPayload } from '../domain/importPayload'
import { useOnline } from '../lib/hooks'
import { assertOnline, errorMessage, supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace'

const TABLES = ['categories', 'keyword_rules', 'batches', 'batch_items', 'return_receipts', 'return_receipt_lines', 'supplier_deliveries', 'supplier_delivery_lines', 'stock_adjustments'] as const

async function fetchAll(table: string, ws: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').eq('workspace_id', ws).order('created_at').order('id').range(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as Record<string, unknown>[]))
    if (!data || data.length < 1000) return out
  }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export default function DataIO() {
  const { workspace } = useWorkspace()
  const cats = useCategories()
  const rules = useRules()
  const updateWs = useUpdateWorkspace()
  const toast = useToast()
  const qc = useQueryClient()
  const online = useOnline()
  const [busy, setBusy] = useState<'xlsx' | 'json' | 'read' | 'import' | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [fileName, setFileName] = useState('')

  const exportData = async (kind: 'xlsx' | 'json') => {
    setBusy(kind)
    try {
      assertOnline()
      const data: Record<string, Record<string, unknown>[]> = {}
      for (const t of TABLES) data[t] = await fetchAll(t, workspace.id)
      const stamp = todayISO()
      if (kind === 'json') {
        const json = JSON.stringify({ app: 'havenwear-ops', exported_at: new Date().toISOString(), workspace: { id: workspace.id, name: workspace.name }, tables: data }, null, 2)
        download(new Blob([json], { type: 'application/json' }), `havenwear-backup-${stamp}.json`)
      } else {
        const XLSX = await import('xlsx')
        const wb = XLSX.utils.book_new()
        for (const t of TABLES) {
          const ws = XLSX.utils.json_to_sheet(data[t]!.length ? data[t]! : [{ empty: '' }])
          XLSX.utils.book_append_sheet(wb, ws, t.slice(0, 31))
        }
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
        download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `havenwear-backup-${stamp}.xlsx`)
      }
      updateWs.mutate({ last_backup_at: new Date().toISOString() })
      const rows = Object.values(data).reduce((s, r) => s + r.length, 0)
      toast({ tone: 'success', message: `Backup downloaded (${formatInt(rows)} rows)` })
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const readFile = async (file: File) => {
    setBusy('read')
    setPlan(null)
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('File is larger than 20 MB')
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const sheets: Sheets = {}
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name]
        if (sheet) sheets[name] = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true })
      }
      const { data: refs, error } = await supabase.from('batches').select('ref').eq('workspace_id', workspace.id).range(0, 9999)
      if (error) throw error
      const categories = cats.data ?? []
      setPlan(
        buildImportPlan(
          sheets,
          {
            categoryNames: categories.map((c) => c.name),
            categoryCosts: Object.fromEntries(categories.map((c) => [c.name.toLowerCase(), c.default_cost_pkr])),
            ruleKeys: (rules.data ?? []).map((r) => `${r.keyword.toLowerCase()}|${(categories.find((c) => c.id === r.category_id)?.name ?? '').toLowerCase()}`),
            batchRefs: ((refs ?? []) as { ref: string }[]).map((r) => r.ref),
          },
          todayISO(),
        ),
      )
      setFileName(file.name)
    } catch (e) {
      toast({ tone: 'error', message: `Could not read workbook: ${errorMessage(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const existingRules = () => {
    const categories = cats.data ?? []
    return (rules.data ?? []).map((r) => ({
      keyword: r.keyword,
      categoryName: categories.find((c) => c.id === r.category_id)?.name ?? '',
      cost_override_pkr: r.cost_override_pkr,
      active: r.active,
      created_seq: r.created_seq,
    }))
  }

  const commit = async () => {
    if (!plan) return
    setBusy('import')
    try {
      assertOnline()
      const categories = cats.data ?? []
      const { payload } = planToPayload(plan, categories, existingRules())
      const { data, error } = await supabase.rpc('import_workbook', { p_workspace: workspace.id, p: payload })
      if (error) throw error
      const r = data as Record<string, number>
      toast({ tone: 'success', message: `Imported ${r.batches} batches, ${r.items} items, ${r.returns} return receipts` })
      setPlan(null)
      invalidateWork(qc)
      for (const k of ['categories', 'rules', 'returns', 'adjustments']) void qc.invalidateQueries({ queryKey: [k] })
    } catch (e) {
      toast({ tone: 'error', message: `Import failed — nothing was changed. ${errorMessage(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const preview = plan ? planToPayload(plan, cats.data ?? [], existingRules()).stats : null

  return (
    <>
      <PageHeader title="Export / Import" back />

      <SectionTitle>Backup (export)</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Download everything — one sheet per table in Excel, or the full JSON. Keep it somewhere safe (Google Drive, email to yourself).
        </p>
        <p className="text-sm">
          Last backup: <strong>{workspace.last_backup_at ? formatDate(workspace.last_backup_at) : 'never'}</strong>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" icon={FileSpreadsheet} loading={busy === 'xlsx'} disabled={!!busy || !online} onClick={() => void exportData('xlsx')}>
            Excel (.xlsx)
          </Button>
          <Button icon={FileJson} loading={busy === 'json'} disabled={!!busy || !online} onClick={() => void exportData('json')}>
            JSON
          </Button>
        </div>
      </Card>

      <SectionTitle>Import your Excel workbook</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Reads <em>Batch Register</em>, <em>Batch Product Checklist</em>, <em>Checklist Archive</em>, <em>Product Rules &amp; Costs</em>, <em>Return Stock Received</em> and{' '}
          <em>Opening Stock</em>. You will see a summary before anything is saved. Batches whose ref already exists are skipped.
        </p>
        <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">
          <Upload className="size-5" aria-hidden />
          {busy === 'read' ? 'Reading…' : 'Choose .xlsx file'}
          <input
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={!!busy || !online}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void readFile(f)
              e.target.value = ''
            }}
          />
        </label>

        {plan && (
          <div className="flex flex-col gap-3 rounded-xl border border-border p-3" aria-live="polite">
            <h3 className="text-sm font-semibold">Preview · {fileName}</h3>
            <p className="text-xs text-muted">Sheets found: {plan.sheetsFound.join(', ') || 'none'}</p>
            <dl className="tabular grid grid-cols-2 gap-2 text-sm">
              <Row label="New categories" value={plan.categories.length} />
              <Row label="New keyword rules" value={plan.rules.length} />
              <Row label="Batches" value={plan.batches.length} />
              <Row label="  of which archived" value={plan.batches.filter((b) => b.archived).length} />
              <Row label="Items" value={plan.items.length} />
              <Row label="  pending" value={plan.items.filter((i) => i.status === 'pending').length} />
              <Row label="Return receipts" value={plan.returns.length} />
              <Row label="Opening stock entries" value={plan.opening.length} />
            </dl>
            {preview && preview.unmatched > 0 && <Pill tone="warn" icon={TriangleAlert}>~{preview.unmatched} items will be unmatched</Pill>}
            {plan.warnings.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer font-semibold text-warn">{plan.warnings.length} warning(s)</summary>
                <ul className="mt-2 list-disc pl-5 text-muted">
                  {plan.warnings.slice(0, 100).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => setPlan(null)} disabled={busy === 'import'}>
                Discard
              </Button>
              <Button
                variant="primary"
                icon={Download}
                loading={busy === 'import'}
                disabled={!online || (!plan.batches.length && !plan.rules.length && !plan.categories.length && !plan.returns.length && !plan.opening.length)}
                onClick={() => void commit()}
              >
                Import all
              </Button>
            </div>
            <p className="text-xs text-muted">The import runs as a single transaction: if anything fails, nothing is saved.</p>
          </div>
        )}
      </Card>
    </>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="whitespace-pre text-muted">{label}</dt>
      <dd className="text-right font-semibold">{formatInt(value)}</dd>
    </>
  )
}
