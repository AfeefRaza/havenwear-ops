import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { classify } from '../domain/classify'
import { todayISO } from '../domain/dates'
import type { Category, Item, ReceivedFromT, Rule } from '../domain/schemas'
import { useToast } from '../components/Toast'
import { assertOnline, errorMessage, supabase } from '../lib/supabase'
import { useWorkspaceId } from '../lib/workspace'
import { qk, type PendingItem } from './queries'

/** Invalidate everything derived from batches/items. */
export function invalidateWork(qc: QueryClient) {
  for (const key of ['batches', 'batchCounts', 'batch', 'items', 'pending', 'unmatched', 'dashboard']) {
    void qc.invalidateQueries({ queryKey: [key] })
  }
}

function useOnError() {
  const toast = useToast()
  return (err: unknown) => toast({ tone: 'error', message: errorMessage(err) })
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------
export interface BatchInput {
  ref: string
  batch_date: string
  supplier: string | null
  invoice_ref: string | null
  actual_bill_pkr: number | null
  payment_status: 'unpaid' | 'partially_paid' | 'paid'
  notes: string | null
}

export function useSaveBatch() {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: BatchInput }) => {
      assertOnline()
      if (id) {
        const { error } = await supabase.from('batches').update(values).eq('id', id)
        if (error) throw error
        return id
      }
      const { data, error } = await supabase.from('batches').insert({ ...values, workspace_id: ws }).select('id').single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: () => invalidateWork(qc),
    onError,
  })
}

export function useArchiveBatch() {
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async ({ ids, archived }: { ids: string[]; archived: boolean }) => {
      assertOnline()
      const { error } = await supabase
        .from('batches')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .in('id', ids)
      if (error) throw error
    },
    onSuccess: () => invalidateWork(qc),
    onError,
  })
}

export function useDeleteBatch() {
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async (id: string) => {
      assertOnline()
      const { error } = await supabase.from('batches').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateWork(qc),
    onError,
  })
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
export interface NewItem {
  product_name: string
  qty: number
  category_override_id?: string | null
  notes?: string | null
}

export function classifyForInsert(item: NewItem, rules: Rule[], categories: Category[]) {
  const c = classify(item.product_name, rules, categories, item.category_override_id ?? null)
  return {
    product_name: item.product_name,
    qty: item.qty,
    category_override_id: item.category_override_id ?? null,
    notes: item.notes ?? null,
    resolved_category_id: c.categoryId,
    matched_rule_id: c.ruleId,
    unit_cost_pkr: c.unitCost,
  }
}

export function useAddItems(batchId: string) {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async ({ items, rules, categories }: { items: NewItem[]; rules: Rule[]; categories: Category[] }) => {
      assertOnline()
      const rows = items.map((it) => ({ ...classifyForInsert(it, rules, categories), batch_id: batchId, workspace_id: ws }))
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('batch_items').insert(rows.slice(i, i + 500))
        if (error) throw error
      }
      return rows.length
    },
    onSuccess: () => invalidateWork(qc),
    onError,
  })
}

export function useUpdateItem() {
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async ({ item, values, rules, categories }: { item: Item; values: NewItem; rules: Rule[]; categories: Category[] }) => {
      assertOnline()
      const patch = classifyForInsert(values, rules, categories)
      const { error } = await supabase.from('batch_items').update(patch).eq('id', item.id)
      if (error) throw error
    },
    onSuccess: () => invalidateWork(qc),
    onError,
  })
}

type StatusPatch = Pick<Item, 'status' | 'received_from' | 'received_date'>

function patchFor(status: Item['status'], from: ReceivedFromT | null): StatusPatch {
  return status === 'received'
    ? { status, received_from: from ?? 'supplier', received_date: todayISO() }
    : { status, received_from: null, received_date: null }
}

/**
 * Change status for many items with an optimistic update. Returns the previous values so the
 * caller can offer Undo.
 */
export function useSetItemStatus() {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async ({ items, status, from }: { items: Item[]; status: Item['status']; from?: ReceivedFromT | null }) => {
      assertOnline()
      const patch = patchFor(status, from ?? null)
      const ids = items.map((i) => i.id)
      for (let i = 0; i < ids.length; i += 300) {
        const { error } = await supabase.from('batch_items').update(patch).in('id', ids.slice(i, i + 300))
        if (error) throw error
      }
    },
    onMutate: async ({ items, status, from }) => {
      const patch = patchFor(status, from ?? null)
      const ids = new Set(items.map((i) => i.id))
      const batchIds = [...new Set(items.map((i) => i.batch_id))]
      await Promise.all([...batchIds.map((b) => qc.cancelQueries({ queryKey: qk.items(b) })), qc.cancelQueries({ queryKey: qk.pending(ws) })])
      const snapshots = batchIds.map((b) => [b, qc.getQueryData<Item[]>(qk.items(b))] as const)
      const pendingSnap = qc.getQueryData<PendingItem[]>(qk.pending(ws))
      for (const b of batchIds) {
        qc.setQueryData<Item[]>(qk.items(b), (old) => old?.map((it) => (ids.has(it.id) ? { ...it, ...patch } : it)))
      }
      qc.setQueryData<PendingItem[]>(qk.pending(ws), (old) =>
        status === 'pending' ? old : old?.filter((it) => !ids.has(it.id)),
      )
      return { snapshots, pendingSnap }
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshots.forEach(([b, data]) => qc.setQueryData(qk.items(b), data))
      if (ctx) qc.setQueryData(qk.pending(ws), ctx.pendingSnap)
      onError(err)
    },
    onSettled: () => invalidateWork(qc),
  })
}

/** Restores items to exactly their previous status values (used by Undo). */
export async function restoreItems(items: Item[]): Promise<void> {
  assertOnline()
  // Group by identical previous patch to minimise requests.
  const groups = new Map<string, string[]>()
  for (const it of items) {
    const key = JSON.stringify([it.status, it.received_from, it.received_date])
    groups.set(key, [...(groups.get(key) ?? []), it.id])
  }
  for (const [key, ids] of groups) {
    const [status, received_from, received_date] = JSON.parse(key) as [string, string | null, string | null]
    const { error } = await supabase.from('batch_items').update({ status, received_from, received_date }).in('id', ids)
    if (error) throw error
  }
}

/**
 * Delete with undo: removes items from the cache immediately and only deletes on the server
 * once the undo toast expires.
 */
export function useDeleteItemsWithUndo() {
  const qc = useQueryClient()
  const toast = useToast()
  return (items: Item[], label = items.length === 1 ? 'Item deleted' : `${items.length} items deleted`) => {
    try {
      assertOnline()
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e) })
      return
    }
    const ids = new Set(items.map((i) => i.id))
    const batchIds = [...new Set(items.map((i) => i.batch_id))]
    const snaps = batchIds.map((b) => [b, qc.getQueryData<Item[]>(qk.items(b))] as const)
    for (const b of batchIds) qc.setQueryData<Item[]>(qk.items(b), (old) => old?.filter((it) => !ids.has(it.id)))
    let undone = false
    toast({
      message: label,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true
          snaps.forEach(([b, data]) => qc.setQueryData(qk.items(b), data))
        },
      },
      onExpire: async () => {
        if (undone) return
        const { error } = await supabase.from('batch_items').delete().in('id', [...ids])
        if (error) {
          snaps.forEach(([b, data]) => qc.setQueryData(qk.items(b), data))
          toast({ tone: 'error', message: errorMessage(error) })
        }
        invalidateWork(qc)
      },
    })
  }
}

export function useApplyClassifications() {
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async (changes: { id: string; resolved_category_id: string | null; matched_rule_id: string | null; unit_cost_pkr: number }[]) => {
      assertOnline()
      let total = 0
      for (let i = 0; i < changes.length; i += 500) {
        const { data, error } = await supabase.rpc('apply_item_classifications', { p_changes: changes.slice(i, i + 500) })
        if (error) throw error
        total += Number(data ?? 0)
      }
      return total
    },
    onSuccess: () => invalidateWork(qc),
    onError,
  })
}

// ---------------------------------------------------------------------------
// Categories & rules
// ---------------------------------------------------------------------------
export function useSaveCategory() {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: { name: string; default_cost_pkr: number; low_stock_level: number; sort_order?: number } }) => {
      assertOnline()
      const q = id
        ? supabase.from('categories').update(values).eq('id', id)
        : supabase.from('categories').insert({ ...values, workspace_id: ws })
      const { error } = await q
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.categories(ws) })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError,
  })
}

export interface RuleInput {
  keyword: string
  category_id: string
  cost_override_pkr: number | null
  supplier: string | null
  active: boolean
  notes: string | null
}

export function useSaveRule() {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async ({ id, values, sort_order }: { id?: string; values: Partial<RuleInput>; sort_order?: number }) => {
      assertOnline()
      const q = id
        ? supabase.from('keyword_rules').update({ ...values, ...(sort_order != null ? { sort_order } : {}) }).eq('id', id)
        : supabase.from('keyword_rules').insert({ ...values, sort_order: sort_order ?? 0, workspace_id: ws })
      const { error } = await q
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.rules(ws) }),
    onError,
  })
}

export function useReorder(table: 'keyword_rules' | 'categories') {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      assertOnline()
      await Promise.all(
        orderedIds.map(async (id, i) => {
          const { error } = await supabase.from(table).update({ sort_order: i + 1 }).eq('id', id)
          if (error) throw error
        }),
      )
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: table === 'categories' ? qk.categories(ws) : qk.rules(ws) }),
    onError,
  })
}

export function useDeleteRule() {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async (id: string) => {
      assertOnline()
      const { error } = await supabase.from('keyword_rules').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.rules(ws) }),
    onError,
  })
}

// ---------------------------------------------------------------------------
// Returns & adjustments
// ---------------------------------------------------------------------------
export function useCreateReturnReceipt() {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async (v: { date: string; reference: string | null; notes: string | null; lines: { category_id: string; qty: number }[] }) => {
      assertOnline()
      const lines = v.lines.filter((l) => l.qty > 0)
      if (!lines.length) throw new Error('Add at least one piece.')
      const { data, error } = await supabase
        .from('return_receipts')
        .insert({ workspace_id: ws, date: v.date, reference: v.reference, notes: v.notes })
        .select('id')
        .single()
      if (error) throw error
      const receiptId = (data as { id: string }).id
      const { error: e2 } = await supabase
        .from('return_receipt_lines')
        .insert(lines.map((l) => ({ ...l, receipt_id: receiptId, workspace_id: ws })))
      if (e2) {
        await supabase.from('return_receipts').delete().eq('id', receiptId)
        throw e2
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.returns(ws) })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError,
  })
}

export function useCreateDelivery() {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async (v: {
      date: string
      supplier: string | null
      reference: string | null
      batch_id: string | null
      notes: string | null
      lines: { category_id: string; qty: number }[]
    }) => {
      assertOnline()
      const lines = v.lines.filter((l) => l.qty > 0)
      if (!lines.length) throw new Error('Add at least one piece.')
      const { lines: _l, ...head } = v
      const { data, error } = await supabase.from('supplier_deliveries').insert({ ...head, workspace_id: ws }).select('id').single()
      if (error) throw error
      const deliveryId = (data as { id: string }).id
      const { error: e2 } = await supabase
        .from('supplier_delivery_lines')
        .insert(lines.map((l) => ({ ...l, delivery_id: deliveryId, workspace_id: ws })))
      if (e2) {
        await supabase.from('supplier_deliveries').delete().eq('id', deliveryId)
        throw e2
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.deliveries(ws) })
      invalidateWork(qc)
    },
    onError,
  })
}

export function useDeleteRow(table: 'return_receipts' | 'stock_adjustments' | 'supplier_deliveries') {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async (id: string) => {
      assertOnline()
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: table === 'return_receipts' ? qk.returns(ws) : table === 'supplier_deliveries' ? qk.deliveries(ws) : qk.adjustments(ws),
      })
      invalidateWork(qc)
    },
    onError,
  })
}

export function useSaveAdjustment() {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: { date: string; category_id: string; qty: number; kind: 'opening' | 'adjustment'; notes: string | null } }) => {
      assertOnline()
      const q = id
        ? supabase.from('stock_adjustments').update(values).eq('id', id)
        : supabase.from('stock_adjustments').insert({ ...values, workspace_id: ws })
      const { error } = await q
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.adjustments(ws) })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError,
  })
}

export function useUpdateWorkspace() {
  const ws = useWorkspaceId()
  const qc = useQueryClient()
  const onError = useOnError()
  return useMutation({
    mutationFn: async (values: { auto_archive_days?: number | null; last_backup_at?: string; name?: string }) => {
      assertOnline()
      const { error } = await supabase.from('workspaces').update(values).eq('id', ws)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['workspace'] }),
    onError,
  })
}
