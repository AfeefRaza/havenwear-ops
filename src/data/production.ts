import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useToast } from '../components/Toast'
import { parseRows } from '../domain/schemas'
import { buildMatcher, flattenFeed, type CatalogProduct, type CatalogVariant, type FeedProduct } from '../domain/shopifyCatalog'
import { assertOnline, errorMessage, supabase } from '../lib/supabase'
import { useAnyWorkspaceId } from '../lib/workspace'
import { invalidateWork } from './mutations'

/** Production data refreshes every 15 s while open, so all three parties see changes live. */
export const LIVE_MS = 15_000

const ts = z.string()
const uuid = z.string().uuid()
const int = z.number().int()
const big = z.coerce.number().nullable()

export const RunSummaryRow = z.object({
  id: uuid, workspace_id: uuid, batch_id: uuid, batch_ref: z.string(), batch_date: z.string(),
  dtf_status: z.enum(['waiting', 'file_ready']), dtf_ready_at: ts.nullable(), pushed_at: ts,
  products: int, required: int, ready: int, received: int, front_prints: int, back_prints: int, ready_not_received: int,
  front_missing: int, back_missing: int, complete_missing: int, garment_missing: int, other_issues: int,
  reprints_pending: int, reprints_ready: int, open_issues: int, completed: z.boolean(),
})
export type RunSummary = z.infer<typeof RunSummaryRow>

export const ProdItemRow = z.object({
  id: uuid, workspace_id: uuid, run_id: uuid, item_key: z.string(), product_title: z.string(),
  variant_title: z.string().nullable(), size: z.string().nullable(), color: z.string().nullable(), image_url: z.string().nullable(),
  shopify_product_id: big, shopify_variant_id: big, front_print: z.boolean(), back_print: z.boolean(),
  qty_required: int, qty_ready: int, qty_received: int, created_at: ts, updated_at: ts,
})
export type ProdItemT = z.infer<typeof ProdItemRow>

export const IssueRow = z.object({
  id: uuid, workspace_id: uuid, run_id: uuid, item_id: uuid,
  kind: z.enum(['front_missing', 'back_missing', 'complete_missing', 'garment_missing', 'wrong_print', 'damaged_print', 'damaged_garment', 'other']),
  qty: int, note: z.string().nullable(), dtf_relevant: z.boolean(), status: z.enum(['open', 'reprint_ready', 'resolved']),
  reprint_ready_at: ts.nullable(), resolved_at: ts.nullable(), created_at: ts,
})
export type IssueT = z.infer<typeof IssueRow>

export const EventRow = z.object({
  id: z.coerce.number(), run_id: uuid, item_id: uuid.nullable(), issue_id: uuid.nullable(), kind: z.string(),
  qty: int.nullable(), detail: z.string().nullable(), actor_role: z.string().nullable(), created_at: ts,
})
export type EventT = z.infer<typeof EventRow>

export const pk = {
  runs: (ws: string) => ['prod-runs', ws] as const,
  items: (ws: string, run?: string) => ['prod-items', ws, run ?? 'all'] as const,
  issues: (ws: string, run?: string) => ['prod-issues', ws, run ?? 'all'] as const,
  events: (run: string) => ['prod-events', run] as const,
  catalog: (ws: string) => ['catalog', ws] as const,
}

export function useRunSummaries() {
  const ws = useAnyWorkspaceId()
  return useQuery({
    queryKey: pk.runs(ws),
    refetchInterval: LIVE_MS,
    queryFn: async () => {
      const { data, error } = await supabase.from('production_run_summaries').select('*').eq('workspace_id', ws)
        .order('batch_date', { ascending: false }).order('pushed_at', { ascending: false }).limit(200)
      if (error) throw error
      return parseRows(RunSummaryRow, data, 'production batch')
    },
  })
}

export function useProdItems(runId?: string) {
  const ws = useAnyWorkspaceId()
  return useQuery({
    queryKey: pk.items(ws, runId),
    refetchInterval: LIVE_MS,
    queryFn: async () => {
      let q = supabase.from('production_items').select('*').eq('workspace_id', ws)
      if (runId) q = q.eq('run_id', runId)
      const { data, error } = await q.order('product_title').order('size').range(0, 4999)
      if (error) throw error
      return parseRows(ProdItemRow, data, 'production item')
    },
  })
}

export function useIssues(runId?: string) {
  const ws = useAnyWorkspaceId()
  return useQuery({
    queryKey: pk.issues(ws, runId),
    refetchInterval: LIVE_MS,
    queryFn: async () => {
      let q = supabase.from('production_issues').select('*').eq('workspace_id', ws)
      if (runId) q = q.eq('run_id', runId)
      const { data, error } = await q.order('created_at', { ascending: false }).range(0, 1999)
      if (error) throw error
      return parseRows(IssueRow, data, 'production problem')
    },
  })
}

export function useEvents(runId: string) {
  return useQuery({
    queryKey: pk.events(runId),
    refetchInterval: LIVE_MS,
    queryFn: async () => {
      const { data, error } = await supabase.from('production_events').select('*').eq('run_id', runId).order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      return parseRows(EventRow, data, 'history')
    },
  })
}

// ---------------------------------------------------------------------------
// Actions (all go through role-checked database functions)
// ---------------------------------------------------------------------------
function useProdAction<V>(fn: (v: V) => Promise<unknown>, success?: (v: V) => string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (v: V) => {
      assertOnline()
      return fn(v)
    },
    onSuccess: (_d, v) => {
      if (success) toast({ tone: 'success', message: success(v) })
    },
    onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
    onSettled: () => {
      for (const k of ['prod-runs', 'prod-items', 'prod-issues', 'prod-events']) void qc.invalidateQueries({ queryKey: [k] })
    },
  })
}

const rpc = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

export const useMarkReady = () =>
  useProdAction((v: { item: string; delta: number }) => rpc('production_mark_ready', { p_item: v.item, p_delta: v.delta }),
    (v) => (v.delta > 0 ? `Marked ${v.delta} ready` : 'Ready count corrected'))

export const useSetDtfReady = () =>
  useProdAction((v: { run: string; ready: boolean }) => rpc('production_set_dtf_ready', { p_run: v.run, p_ready: v.ready }),
    (v) => (v.ready ? 'DTF file marked ready' : 'DTF file marked not ready'))

export const useReportIssue = () =>
  useProdAction((v: { item: string; kind: string; qty: number; note: string | null }) =>
    rpc('production_report_issue', { p_item: v.item, p_kind: v.kind, p_qty: v.qty, p_note: v.note }), () => 'Problem reported')

export const useReprintReady = () =>
  useProdAction((v: { issue: string }) => rpc('production_reprint_ready', { p_issue: v.issue }), () => 'Reprint marked ready')

export const useResolveIssue = () =>
  useProdAction((v: { issue: string }) => rpc('production_resolve_issue', { p_issue: v.issue }), () => 'Problem marked solved')

export function useReceive() {
  const qc = useQueryClient()
  const action = useProdAction((v: { item: string; delta: number }) => rpc('production_receive', { p_item: v.item, p_delta: v.delta }),
    (v) => (v.delta > 0 ? `Received ${v.delta}` : 'Received count corrected'))
  return {
    ...action,
    mutate: (v: { item: string; delta: number }) => action.mutate(v, { onSettled: () => invalidateWork(qc) }),
  }
}

// ---------------------------------------------------------------------------
// Shopify catalogue
// ---------------------------------------------------------------------------
export const SHOPIFY_STORE = (import.meta.env.VITE_SHOPIFY_STORE as string | undefined) || 'havenwearpakistan.com'

const CatalogProductRow = z.object({
  product_id: z.coerce.number(), handle: z.string(), title: z.string(), product_type: z.string().nullable(), image_url: z.string().nullable(),
  front_print: z.boolean(), back_print: z.boolean(), print_confirmed: z.boolean(), synced_at: ts,
})
const CatalogVariantRow = z.object({
  variant_id: z.coerce.number(), product_id: z.coerce.number(), title: z.string(), size: z.string().nullable(),
  color: z.string().nullable(), image_url: z.string().nullable(),
})

async function fetchAllRows<T>(table: string, ws: string, schema: z.ZodType<T>, order: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').eq('workspace_id', ws).order(order).range(from, from + 999)
    if (error) throw error
    out.push(...parseRows(schema, data, table))
    if (!data || data.length < 1000) return out
  }
}

export function useCatalog() {
  const ws = useAnyWorkspaceId()
  return useQuery({
    queryKey: pk.catalog(ws),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [products, variants] = await Promise.all([
        fetchAllRows('shopify_products', ws, CatalogProductRow, 'product_id'),
        fetchAllRows('shopify_variants', ws, CatalogVariantRow, 'variant_id'),
      ])
      return { products, variants, match: buildMatcher(products as CatalogProduct[], variants as CatalogVariant[]) }
    },
  })
}

/** Pulls the public storefront feed (no API key) and upserts it. Print settings are never overwritten. */
export function useSyncCatalog() {
  const ws = useAnyWorkspaceId()
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async () => {
      assertOnline()
      const feed: FeedProduct[] = []
      for (let page = 1; page <= 40; page++) {
        const res = await fetch(`https://${SHOPIFY_STORE}/products.json?limit=250&page=${page}`, { credentials: 'omit' })
        if (!res.ok) throw new Error(`Shopify returned ${res.status}`)
        const json = (await res.json()) as { products?: FeedProduct[] }
        const batch = json.products ?? []
        feed.push(...batch)
        if (batch.length < 250) break
      }
      const { products, variants } = flattenFeed(feed)
      const now = new Date().toISOString()
      // Upsert only feed-owned columns so front/back print settings survive re-syncs.
      for (let i = 0; i < products.length; i += 500) {
        const rows = products.slice(i, i + 500).map((p) => ({
          workspace_id: ws, product_id: p.product_id, handle: p.handle, title: p.title, product_type: p.product_type, image_url: p.image_url, synced_at: now,
        }))
        const { error } = await supabase.from('shopify_products').upsert(rows, { onConflict: 'workspace_id,product_id' })
        if (error) throw error
      }
      for (let i = 0; i < variants.length; i += 1000) {
        const rows = variants.slice(i, i + 1000).map((v) => ({ workspace_id: ws, ...v }))
        const { error } = await supabase.from('shopify_variants').upsert(rows, { onConflict: 'workspace_id,variant_id' })
        if (error) throw error
      }
      return { products: products.length, variants: variants.length }
    },
    onSuccess: (r) => {
      toast({ tone: 'success', message: `Synced ${r.products} products (${r.variants} variants) from Shopify` })
      void qc.invalidateQueries({ queryKey: pk.catalog(ws) })
    },
    onError: (e) => toast({ tone: 'error', message: `Shopify sync failed: ${errorMessage(e)}` }),
  })
}

export function useSetPrintConfig() {
  const ws = useAnyWorkspaceId()
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (v: { product_id: number; front_print: boolean; back_print: boolean }) => {
      assertOnline()
      const { error } = await supabase.from('shopify_products')
        .update({ front_print: v.front_print, back_print: v.back_print, print_confirmed: true })
        .eq('workspace_id', ws).eq('product_id', v.product_id)
      if (error) throw error
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: pk.catalog(ws) })
      const prev = qc.getQueryData(pk.catalog(ws))
      qc.setQueryData(pk.catalog(ws), (old: { products: CatalogProduct[]; variants: CatalogVariant[]; match: unknown } | undefined) =>
        old && { ...old, products: old.products.map((p) => (p.product_id === v.product_id ? { ...p, ...v, print_confirmed: true } : p)) })
      return { prev }
    },
    onError: (e, _v, ctx) => {
      if (ctx) qc.setQueryData(pk.catalog(ws), ctx.prev)
      toast({ tone: 'error', message: errorMessage(e) })
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: pk.catalog(ws) }),
  })
}
