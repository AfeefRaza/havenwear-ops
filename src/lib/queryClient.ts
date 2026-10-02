import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'

export const CACHE_KEY = 'hw-query-cache'
export const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000 // cached data auto-expires after 7 days

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: CACHE_MAX_AGE,
      retry: (count, err) => count < 2 && !(err instanceof Error && /permission|Unexpected/.test(err.message)),
      refetchOnWindowFocus: true,
      // Serve cached data while offline (read-only mode).
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'always',
      retry: false,
    },
  },
})

/**
 * Offline cache lives in IndexedDB on this device only. It is wiped on "Sign out of this device"
 * and expires after 7 days.
 */
export const persister = createAsyncStoragePersister({
  key: CACHE_KEY,
  storage: {
    getItem: async (k) => (await get<string>(k)) ?? null,
    setItem: (k, v) => set(k, v),
    removeItem: (k) => del(k),
  },
  throttleTime: 1500,
})

export async function clearLocalCache(): Promise<void> {
  queryClient.clear()
  try {
    await del(CACHE_KEY)
  } catch {
    /* IndexedDB unavailable (private mode) — nothing to clear */
  }
}
