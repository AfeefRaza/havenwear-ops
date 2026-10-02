import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { periodRange, todayISO, type Period } from '../domain/dates'
import {
  AdjustmentRow,
  BatchRow,
  DeliveryLineRow,
  DeliveryRow,
  CategoryRow,
  ItemRow,
  ReturnLineRow,
  ReturnReceiptRow,
  RuleRow,
  parseRows,
} from '../domain/schemas'
import { supabase } from '../lib/supabase'
import { useWorkspaceId } from '../lib/workspace'

export const qk = {
  categories: (ws: string) => ['categories', ws] as const,
  rules: (ws: string) => ['rules', ws] as const,
  batches: (ws: string, tab?: string, q?: string) => ['batches', ws, tab, q] as const,
  batch: (id: string) => ['batch', id] as const,
  items: (batchId: string) => ['items', batchId] as const,
  pending: (ws: string) => ['pending', ws] as const,
  unmatched: (ws: string) => ['unmatched', ws] as const,
  returns: (ws: string) => ['returns', ws] as const,
  deliveries: (ws: string) => ['deliveries', ws] as const,
  adjustments: (ws: string) => ['adjustments', ws] as const,
  dashboard: (ws: string, period: Period, today: string) => ['dashboard', ws, period, today] as const,
  activeItems: (ws: string) => ['activeItems', ws] as const,
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------
export const BatchSummaryRow = BatchRow.extend({
  lines: z.number().int(),
  pending_lines: z.number().int(),
  cancelled_lines: z.number().int(),
  unmatched_lines: z.number().int(),
  required: z.number().int(),
  pending_pieces: z.number().int(),
  from_returns: z.number().int(),
  from_supplier: z.number().int(),
  est_supplier_cost: z.coerce.number(),
  last_item_change: z.string().nullable(),
  stage: z.enum(['empty', 'in_progress', 'complete', 'archived']),
  delivered_pieces: z.number().int().default(0),
})
export type BatchSummary = z.infer<typeof BatchSummaryRow>

export const PendingRow = ItemRow.extend({ batch_ref: z.string(), batch_date: z.string() })
export type PendingItem = z.infer<typeof PendingRow>

export const UnmatchedRow = z.object({
  workspace_id: z.string(),
  product_name: z.string(),
  lines: z.number().int(),
  pieces: z.number().int(),
})

const n = z.coerce.number()
export const DashboardData = z.object({
  period: z.object({
    batches: n, lines: n, cancelled_lines: n, required: n, pending_pieces: n,
    from_returns: n, from_supplier: n, est_supplier_cost: n,
  }),
  returned_stock_received: n,
  supplier_delivered: n.default(0),
  alerts: z.object({ pending_lines: n, pending_pieces: n }),
  unmatched_lines: n,
  ready_to_archive: n,
  stock: z.array(z.object({
    category_id: z.string(), name: z.string(), low_stock_level: n, sort_order: n,
    adjustments: n, returns_in: n, delivered: n.default(0), supplier: n, returns_used: n, pending: n,
  })),
  daily: z.array(z.object({ date: z.string(), returns: n, supplier: n })),
  weekly_cost: z.array(z.object({ week: z.string(), cost: n })),
  by_category: z.array(z.object({ category_id: z.string().nullable(), name: z.string(), pieces: n })),
})
export type Dashboard = z.infer<typeof DashboardData>

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
export function useCategories() {
  const ws = useWorkspaceId()
  return useQuery({
    queryKey: qk.categories(ws),
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').eq('workspace_id', ws).order('sort_order').order('name')
      if (error) throw error
      return parseRows(CategoryRow, data, 'category')
    },
    staleTime: 5 * 60_000,
  })
}

export function useRules() {
  const ws = useWorkspaceId()
  return useQuery({
    queryKey: qk.rules(ws),
    queryFn: async () => {
      const { data, error } = await supabase.from('keyword_rules').select('*').eq('workspace_id', ws).order('sort_order').order('created_seq')
      if (error) throw error
      return parseRows(RuleRow, data, 'rule')
    },
    staleTime: 5 * 60_000,
  })
}

export type BatchTab = 'active' | 'complete' | 'archived'
const STAGES: Record<BatchTab, string[]> = {
  active: ['empty', 'in_progress'],
  complete: ['complete'],
  archived: ['archived'],
}
const PAGE = 30

/** Escape characters that have meaning inside PostgREST filter strings / LIKE patterns. */
export function likeSafe(q: string): string {
  return q.replace(/[\\%_]/g, (c) => '\\' + c).replace(/[,()*:"]/g, ' ').trim()
}

export function useBatchList(tab: BatchTab, search: string) {
  const ws = useWorkspaceId()
  const q = likeSafe(search)
  return useInfiniteQuery({
    queryKey: qk.batches(ws, tab, q),
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam }) => {
      let ids: string[] | null = null
      if (q) {
        // Search by ref OR by product name inside the batch.
        const { data: hits, error: e1 } = await supabase
          .from('batch_items')
          .select('batch_id')
          .eq('workspace_id', ws)
          .ilike('product_name', `%${q}%`)
          .limit(500)
        if (e1) throw e1
        ids = [...new Set((hits ?? []).map((h: { batch_id: string }) => h.batch_id))]
      }
      let query = supabase.from('batch_summaries').select('*').eq('workspace_id', ws)
      // When searching, look across all tabs so archived batches are always findable.
      if (!q) query = query.in('stage', STAGES[tab])
      if (q) {
        const refFilter = `ref.ilike.%${q}%`
        query = ids && ids.length ? query.or(`${refFilter},id.in.(${ids.join(',')})`) : query.or(refFilter)
      }
      const { data, error } = await query
        .order('batch_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + PAGE - 1)
      if (error) throw error
      return parseRows(BatchSummaryRow, data, 'batch')
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })
}

export function useBatchCounts() {
  const ws = useWorkspaceId()
  return useQuery({
    queryKey: ['batchCounts', ws],
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_summaries').select('stage').eq('workspace_id', ws)
      if (error) throw error
      const counts = { active: 0, complete: 0, archived: 0 }
      for (const r of (data ?? []) as { stage: string }[]) {
        if (r.stage === 'complete') counts.complete++
        else if (r.stage === 'archived') counts.archived++
        else counts.active++
      }
      return counts
    },
  })
}

export function useBatch(id: string) {
  return useQuery({
    queryKey: qk.batch(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_summaries').select('*').eq('id', id)
      if (error) throw error
      const [row] = parseRows(BatchSummaryRow, data, 'batch')
      return row ?? null
    },
  })
}

export function useBatchItems(batchId: string) {
  return useQuery({
    queryKey: qk.items(batchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batch_items')
        .select('*')
        .eq('batch_id', batchId)
        .order('created_at')
        .order('id')
        .range(0, 1999)
      if (error) throw error
      return parseRows(ItemRow, data, 'item')
    },
  })
}

export function usePendingItems() {
  const ws = useWorkspaceId()
  return useQuery({
    queryKey: qk.pending(ws),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_items')
        .select('*')
        .eq('workspace_id', ws)
        .order('batch_date')
        .order('created_at')
        .range(0, 1999)
      if (error) throw error
      return parseRows(PendingRow, data, 'pending item')
    },
  })
}

export function useUnmatchedNames() {
  const ws = useWorkspaceId()
  return useQuery({
    queryKey: qk.unmatched(ws),
    queryFn: async () => {
      const { data, error } = await supabase.from('unmatched_names').select('*').eq('workspace_id', ws).order('pieces', { ascending: false }).limit(200)
      if (error) throw error
      return parseRows(UnmatchedRow, data, 'unmatched name')
    },
  })
}

const ReceiptWithLines = ReturnReceiptRow.extend({ return_receipt_lines: z.array(ReturnLineRow) })
export type ReceiptWithLinesT = z.infer<typeof ReceiptWithLines>

export function useReturnReceipts() {
  const ws = useWorkspaceId()
  return useQuery({
    queryKey: qk.returns(ws),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('return_receipts')
        .select('*, return_receipt_lines(*)')
        .eq('workspace_id', ws)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return parseRows(ReceiptWithLines, data, 'return receipt')
    },
  })
}

const DeliveryWithLines = DeliveryRow.extend({ supplier_delivery_lines: z.array(DeliveryLineRow) })
export type DeliveryWithLinesT = z.infer<typeof DeliveryWithLines>

export function useSupplierDeliveries() {
  const ws = useWorkspaceId()
  return useQuery({
    queryKey: qk.deliveries(ws),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_deliveries')
        .select('*, supplier_delivery_lines(*)')
        .eq('workspace_id', ws)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return parseRows(DeliveryWithLines, data, 'supplier delivery')
    },
  })
}

export function useAdjustments() {
  const ws = useWorkspaceId()
  return useQuery({
    queryKey: qk.adjustments(ws),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_adjustments')
        .select('*')
        .eq('workspace_id', ws)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return parseRows(AdjustmentRow, data, 'stock adjustment')
    },
  })
}

export function useDashboard(period: Period) {
  const ws = useWorkspaceId()
  const today = todayISO()
  const range = periodRange(period, today)
  return useQuery({
    queryKey: qk.dashboard(ws, period, today),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard', {
        p_workspace: ws,
        p_from: range?.from ?? null,
        p_to: range?.to ?? null,
        p_today: today,
      })
      if (error) throw error
      const parsed = DashboardData.safeParse(data)
      if (!parsed.success) throw new Error('Unexpected dashboard data from server')
      return parsed.data
    },
  })
}

/** All items in non-archived batches (for "re-apply rules"). Paged in chunks of 1000. */
export async function fetchActiveItems(ws: string) {
  const out: z.infer<typeof ItemRow>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('batch_items')
      .select('*, batches!inner(archived_at)')
      .eq('workspace_id', ws)
      .is('batches.archived_at', null)
      .order('id')
      .range(from, from + 999)
    if (error) throw error
    const rows = (data ?? []).map(({ batches: _b, ...r }: Record<string, unknown>) => r)
    out.push(...parseRows(ItemRow, rows, 'item'))
    if (!data || data.length < 1000) break
  }
  return out
}
