# CLAUDE.md — HavenWear Ops

Context for any Claude session working on this repo. Read this first. (Public repo: never put keys,
passwords or personal emails in here.)

## What this is
Private, mobile-first PWA for **HavenWear Pakistan** (DTC streetwear on Shopify, store `havenwearpakistan.com`).
Tracks production batches, return stock, supplier deliveries and stock, and runs the production workflow
with two outside suppliers. Live: https://afeefraza.github.io/havenwear-ops/ · README.md has full setup,
workflows and business rules.

- **Roles:** `owner`/`member` = Havenwear (full app) · `tshirt_supplier` and `dtf_supplier` = simple portals
  (`src/portal/`). Role comes from `workspace_members`.
- **Stack:** Vite + React + TypeScript (strict), Tailwind v4, TanStack Query, Zod, Recharts, SheetJS,
  vite-plugin-pwa. Backend = **Supabase** (Postgres + Auth + RLS), no custom server. Hosted on GitHub Pages.
- **Supabase project ref:** `wqlhgauwsykmbbfheimw` (region ap-northeast-2, free plan). Workspace
  "HavenWear Pakistan" id `32e46137-c1aa-4215-b3b3-d9b65a397ca2`.
- **Layout:** `src/domain/` pure business logic + Zod schemas (unit-tested) · `src/data/` query hooks and
  mutations · `src/screens/` Havenwear screens · `src/portal/` supplier portals · `supabase/migrations/`
  every DB change · `supabase/tests/*_proof.sql` RLS/workflow proofs (run in a rolled-back transaction).

## How the owner wants work done
1. **Never commit features straight to `main`.** New branch → PR → merge with a **merge commit**
   (`gh pr merge N --merge`) so every change is one-click revertible. Docs-only fixes may go to main.
   Previous stable version is tagged `stable-before-production`.
2. Merging to `main` deploys automatically (GitHub Actions: gitleaks, secret scan, lint, typecheck, tests,
   build, Pages). Keep CI green.
3. **Database changes must be additive and backward compatible** (the live app must keep working while a
   PR is open). Add a numbered file to `supabase/migrations/`, try risky SQL in a `begin … rollback`
   transaction first, then apply. Extend the relevant `supabase/tests/*_proof.sql` and run it.
4. Before committing run: `npm run lint`, `npm run typecheck`, `npm test`, build, `npm run check:secrets`.
   On Windows Git Bash build with `MSYS_NO_PATHCONV=1 VITE_BASE=/havenwear-ops/ npm run build`.
5. Edit files with the editor tools, not shell one-liners: backticks in shell strings have been executed
   as commands before.
6. The owner is not a developer: explain changes in plain language, say what was verified (and what
   wasn't), and always give the revert path.

## Security rules (non-negotiable)
- Only the Supabase URL + **publishable/anon** key ever go in the frontend (GitHub secrets
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; locally `.env.local`, gitignored). **Never** use or
  commit the service_role / `sb_secret_` key.
- **RLS on every table.** Data policies use `private.my_workspace_ids()`, which returns **internal roles
  only** — that is what keeps suppliers out of batches, costs, stock, rules and settings.
- Suppliers have **read-only** access to production tables; every supplier action goes through a
  `SECURITY DEFINER` RPC that calls `private.require_role(...)` and logs to `production_events`.
- Suppliers must **never** see costs, bills, the DTF rate (`dtf_costs` is Havenwear-only) or history.
- **No-print products never reach the DTF supplier** — enforced by RLS on production items/runs/issues,
  not just hidden in the UI.
- CSP is injected at build time (`vite.config.ts`): scripts self-only; connections to Supabase and the
  Shopify store only. Never use `dangerouslySetInnerHTML`.

## Business decisions already made
- Classification: product name contains keyword (case-insensitive); longest keyword wins, tie → oldest
  rule; manual category override beats rules. Cost is snapshotted on the item.
- Batch items: tap **Supplier** = allocate for manufacture (`supplier_planned`), **Return** = fulfilled
  from return stock. **Push to production** sends only allocated items, combined per Shopify variant.
- Supplier **Ready** ≠ Havenwear **Received**. Receiving in Production marks batch lines received from
  Supplier and counts as delivered stock (no double entry).
- Stock per category = opening/adjustments + returns in + supplier deliveries (incl. production
  receipts) − all items received.
- Print setting per Shopify product; unconfirmed = Front + Back (flagged). Changing it updates
  not-yet-received production items.
- **DTF:** File Ready requires meters (decimal). Cost = meters × rate **at that moment** (snapshot;
  history never recalculated). Current rate **PKR 1,000 per meter** (More → Settings).
- Shopify pictures/sizes/colours come from the public `products.json` feed — no Shopify API key.
  The database syncs it **hourly** (pg_cron + http in an isolated schema) and matches items server-side;
  the owner can link a product manually once.
- Pakistan time (Asia/Karachi). Money `PKR 1,400`, dates `10-Sep-26`. Mobile-first, bottom sheets, undo.

## Shared database — careful
The same Supabase project also hosts the owner's separate **Creative Radar** app (`radar_*` tables and
`radar_engine_*` functions, token-gated). Don't modify or drop them. They reuse
`private.my_workspace_ids()`, so changing that function affects Radar too.

## Accounts
Owner account plus one test login per supplier role exist (the owner knows the emails). To add a user:
create it in Supabase Auth (Auto Confirm), then
`select private.add_member('<workspace-id>', '<email>', '<role>');`
