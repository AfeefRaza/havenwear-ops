import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/Toast'
import type { Item, ReceivedFromT } from '../domain/schemas'
import { errorMessage } from '../lib/supabase'
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

  return {
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
