import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useToast } from '../components/Toast'
import { parseRows } from '../domain/schemas'
import { assertOnline, errorMessage, supabase } from '../lib/supabase'
import { useWorkspaceId } from '../lib/workspace'
import { invalidateWork } from './mutations'

/** What the "Import new batches" button reports back. */
export interface ImportResult {
  ok: boolean
  error?: string
  seen?: number
  imported_orders?: number
  imported_lines?: number
  imported_pieces?: number
  already_handled?: number
  flagged?: number
  blocked?: number
  skipped?: number
  has_more?: boolean
  batches?: { ref: string; created: boolean; orders: number; lines: number }[]
}

const StatusRow = z.object({
  baseline_at: z.string().nullable(),
  last_run_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_error: z.string().nullable(),
})
export type ImportStatus = z.infer<typeof StatusRow>

const AttentionRow = z.object({
  shopify_order_id: z.coerce.number(),
  order_name: z.string(),
  batch_tag: z.string().nullable(),
  status: z.enum(['imported', 'baseline', 'skipped', 'blocked']),
  note: z.string().nullable(),
})
export type ImportAttention = z.infer<typeof AttentionRow>

const key = (ws: string) => ['shopify-import', ws] as const

/** Null until importing has been switched on for this workspace (then the card stays hidden). */
export function useImportStatus() {
  const ws = useWorkspaceId()
  return useQuery({
    queryKey: [...key(ws), 'status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shopify_import_status')
        .select('baseline_at, last_run_at, last_success_at, last_error')
        .eq('workspace_id', ws)
        .maybeSingle()
      if (error) throw error
      return data ? parseRows(StatusRow, [data], 'import status')[0]! : null
    },
  })
}

/** Orders that could not be imported yet, and imported orders that changed in Shopify afterwards. */
export function useImportAttention() {
  const ws = useWorkspaceId()
  return useQuery({
    queryKey: [...key(ws), 'attention'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shopify_order_imports')
        .select('shopify_order_id, order_name, batch_tag, status, note')
        .eq('workspace_id', ws)
        .or('status.eq.blocked,and(status.eq.imported,note.not.is.null,acknowledged_at.is.null)')
        .order('seen_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return parseRows(AttentionRow, data, 'import notes')
    },
  })
}

/** "Import new batches": checks Shopify for orders newly tagged `done` + a batch date and adds them. */
export function useImportNow() {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async () => {
      assertOnline()
      const { data, error } = await supabase.rpc('shopify_import_now', { p_workspace: ws })
      if (error) throw error
      return data as ImportResult
    },
    onSuccess: (r) => {
      toast(
        r.ok
          ? { tone: 'success', message: summarize(r), duration: 6000 }
          : { tone: 'error', message: `${r.error ?? 'The import did not finish'} — nothing was changed, you can try again.`, duration: 7000 },
      )
    },
    onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
    onSettled: () => {
      invalidateWork(qc)
      void qc.invalidateQueries({ queryKey: key(ws) })
    },
  })
}

export function useDismissImport() {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (order: number) => {
      assertOnline()
      const { error } = await supabase.rpc('shopify_import_dismiss', { p_workspace: ws, p_order: order })
      if (error) throw error
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key(ws) }),
  })
}

function summarize(r: ImportResult): string {
  const orders = r.imported_orders ?? 0
  const more = r.has_more ? ' More are waiting — tap again.' : ''
  if (!orders) {
    const extra = [r.blocked ? `${r.blocked} could not be imported` : '', r.flagged ? `${r.flagged} changed in Shopify` : ''].filter(Boolean).join(', ')
    return `No new tagged orders.${extra ? ` ${extra} — see below.` : ''}${more}`
  }
  const where = (r.batches ?? []).map((b) => `${b.ref}${b.created ? ' (new)' : ''}`).join(', ')
  return `Imported ${orders} order${orders === 1 ? '' : 's'} · ${r.imported_lines ?? 0} lines into ${where || 'batches'}.${more}`
}
