#!/usr/bin/env node
/**
 * Live RLS check against your real Supabase project, through the public REST API —
 * exactly what an attacker holding the (public) anon key could do.
 *
 *   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… npm run test:rls
 *
 * Optional: also prove a signed-in user who is NOT a workspace member sees nothing.
 * Create a throwaway user in the dashboard (do not add them to any workspace), then:
 *   RLS_NONMEMBER_EMAIL=… RLS_NONMEMBER_PASSWORD=… npm run test:rls
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (e.g. from .env.local).')
  process.exit(2)
}

const TABLES = ['workspaces', 'workspace_members', 'categories', 'keyword_rules', 'batches',
  'batch_items', 'return_receipts', 'return_receipt_lines', 'stock_adjustments', 'supplier_deliveries', 'supplier_delivery_lines',
  'batch_summaries', 'pending_items', 'unmatched_names']

let failed = 0

async function expectNoRows(client, label) {
  for (const t of TABLES) {
    const { data, error } = await client.from(t).select('*').limit(5)
    const rows = data?.length ?? 0
    const ok = rows === 0
    if (!ok) failed++
    console.log(`${ok ? '✔' : '✖'} ${label.padEnd(12)} ${t.padEnd(22)} ${error ? `denied (${error.code})` : `${rows} rows`}`)
  }
  const ins = await client.from('batches').insert({ workspace_id: crypto.randomUUID(), ref: 'RLS-PROBE' })
  const blocked = Boolean(ins.error)
  if (!blocked) failed++
  console.log(`${blocked ? '✔' : '✖'} ${label.padEnd(12)} insert batches          ${blocked ? 'blocked' : 'ALLOWED'}`)
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
await expectNoRows(createClient(url, key, opts), 'anon')

if (process.env.RLS_NONMEMBER_EMAIL && process.env.RLS_NONMEMBER_PASSWORD) {
  const c = createClient(url, key, opts)
  const { error } = await c.auth.signInWithPassword({
    email: process.env.RLS_NONMEMBER_EMAIL,
    password: process.env.RLS_NONMEMBER_PASSWORD,
  })
  if (error) {
    console.error('Could not sign in non-member test user:', error.message)
    process.exit(2)
  }
  await expectNoRows(c, 'non-member')
  await c.auth.signOut()
} else {
  console.log('(skipping non-member check — set RLS_NONMEMBER_EMAIL / RLS_NONMEMBER_PASSWORD)')
}

console.log(failed ? `\n✖ ${failed} RLS check(s) FAILED` : '\n✔ All RLS checks passed')
process.exit(failed ? 1 : 0)
