import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configError: string | null =
  !url || !anonKey
    ? 'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local (local) or add them as GitHub Actions secrets (deploy).'
    : null

export const AUTH_STORAGE_KEY = 'hw-auth'

/**
 * The only thing this app keeps in localStorage is the Supabase session (plus the optional
 * PIN hash). Only the public anon/publishable key is ever used here.
 */
export const supabase: SupabaseClient = createClient(url ?? 'http://invalid.localhost', anonKey ?? 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: AUTH_STORAGE_KEY,
  },
})

/** Turns a PostgREST/Auth error into a readable message. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Something went wrong'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    const e = err as { message: string; code?: string }
    if (e.code === '23505') return 'That already exists (duplicate).'
    if (e.code === '23503') return 'It is still in use elsewhere, so it cannot be removed.'
    if (e.code === '42501') return 'You do not have permission to do that.'
    return e.message
  }
  return 'Something went wrong'
}

/** Throws if offline so writes fail fast with a clear message (offline mode is read-only). */
export function assertOnline(): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('You are offline — changes cannot be saved right now.')
  }
}
