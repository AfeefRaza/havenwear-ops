import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/Toast'
import type { Item, ReceivedFromT } from '../domain/schemas'
import { assertOnline, errorMessage, supabase } from '../lib/supabase'
import { qk } from './queries'
import { invalidateWork, restoreItems, useDeleteItemsWithUndo, useSetItemStatus } from './mutations'

/** Status changes with an Undo toast, shared by Batch detail and Pending. */
export function useItemActions() {
  const setStatus = useSetItemStatus()
  const deleteWithUndo = useDeleteItemsWithUndo()
  const toast = useToast()
  const qc = useQueryClient()

  const change = (items: Item[], status: Item['status'], from?: ReceivedFromT) => {
    if (!items.length) return
    const previous = items.map((i) => ({ ...i }))
    setStatus.mutate(
      { items, status, from },
      {
        onSuccess: () => {
          const what =
            status === 'received' ? `received from ${from === 'return' ? 'return stock' : 'supplier'}` : status === 'cancelled' ? 'cancelled' : 'marked pending'
          toast({
            tone: 'success',
            message: items.length === 1 ? `“${truncate(items[0]!.product_name)}” ${what}` : `${items.length} items ${what}`,
            action: {
              label: 'Undo',
              onClick: () => {
                restoreItems(previous)
                  .then(() => invalidateWork(qc))
                  .catch((e) => toast({ tone: 'error', message: errorMessage(e) }))
              },
            },
          })
        },
      },
    )
  }

  /** Allocate pending lines to the supplier (to be manufactured) — or take them back. Optimistic, with Undo. */
  const allocate = async (items: Item[], planned: boolean, silent = false) => {
    const target = items.filter((i) => i.status === 'pending' && !i.production_item_id && i.supplier_planned !== planned)
    if (!target.length) return
    const ids = new Set(target.map((i) => i.id))
    const batchIds = [...new Set(target.map((i) => i.batch_id))]
    const snaps = batchIds.map((b) => [b, qc.getQueryData<Item[]>(qk.items(b))] as const)
    for (const b of batchIds) qc.setQueryData<Item[]>(qk.items(b), (old) => old?.map((it) => (ids.has(it.id) ? { ...it, supplier_planned: planned } : it)))
    try {
      assertOnline()
      const { error } = await supabase.rpc('set_supplier_planned', { p_items: [...ids], p_planned: planned })
      if (error) throw error
      if (!silent) {
        toast({
          tone: 'success',
          message:
            (target.length === 1 ? `“${truncate(target[0]!.product_name)}”` : `${target.length} items`) +
            (planned ? ' allocated to supplier' : ' removed from supplier'),
          action: { label: 'Undo', onClick: () => void allocate(target.map((t) => ({ ...t, supplier_planned: planned })), !planned, true) },
        })
      }
    } catch (e) {
      snaps.forEach(([b, data]) => qc.setQueryData(qk.items(b), data))
      toast({ tone: 'error', message: errorMessage(e) })
    } finally {
      invalidateWork(qc)
    }
  }

  return {
    allocate,
    receive: (items: Item[], from: ReceivedFromT) => change(items, 'received', from),
    cancel: (items: Item[]) => change(items, 'cancelled'),
    setPending: (items: Item[]) => change(items, 'pending'),
    change,
    remove: deleteWithUndo,
    busy: setStatus.isPending,
  }
}

function truncate(s: string, n = 28) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
