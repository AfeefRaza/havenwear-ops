# HavenWear Ops

A private, mobile-first production & returns tracker for **HavenWear Pakistan**. It replaces the Excel batch tracker and installs to the home screen as an app (PWA).

**Stack:** Vite · React 19 · TypeScript (strict) · Tailwind CSS v4 · Radix/vaul · TanStack Query · Zod · Recharts · SheetJS · Supabase (Postgres + Auth + Row Level Security) · vite-plugin-pwa · Vitest · GitHub Actions → GitHub Pages.

---

## Contents
1. [What it does](#what-it-does)
2. [Security model](#security-model)
3. [First-time setup](#first-time-setup) — Supabase, your user, GitHub, Pages
4. [Install on iPhone / Android](#install-on-iphone--android)
5. [Back up your data](#back-up-your-data)
6. [Supplier production workflow](#supplier-production-workflow)
7. [Add products from a Shopify orders export](#add-products-from-a-shopify-orders-export)
8. [Import the old Excel workbook](#import-the-old-excel-workbook)
9. [Add a team member](#add-a-team-member)
10. [Local development](#local-development)
11. [Project structure](#project-structure)
12. [Business rules](#business-rules)
13. [Reverting to the previous version](#reverting-to-the-previous-version)

---

## What it does

| Screen | Highlights |
|---|---|
| **Home** | Pending alert banner, housekeeping chips (unmatched names, batches ready to archive, backup due), 10 KPI cards, period switcher (Today / 7 days / This month / All time), return-trend sentence, stock by category (red / amber / green with icon + label), 4 charts. Every chart has a data-table view. |
| **Batches** | Active / Complete / Archived tabs, search by ref **or product name** (searches archived too), progress bar, pending count, payment status, infinite scroll. |
| **Batch detail** | Stats, est. supplier cost vs actual bill, **bulk paste** / Shopify CSV import with live category preview, swipe right / tap **Supplier** = allocate to the supplier (to be manufactured), swipe left / tap **Return** = fulfilled from return stock, multi-select bulk actions, edit/delete with **Undo**, **Push batch to production**, one-tap archive. |
| **Pending** | Every pending item across active batches, filter by batch, days waiting (red after 7 days), allocate / receive directly. Virtualised for long lists. |
| **Production** | Live supplier production: DTF status, ready vs received, problems & reprints, **ready but not received**, full history per batch. |
| **Stock in** | Two switches: **Returns** (log returned parcels by category with large steppers) and **Supplier deliveries** (stock delivered by date and category, optional batch link). |
| **More** | Shopify products (pictures + front/back print settings), Rules & categories (test box, unmatched names → “Create rule”, re-apply rules), opening stock & adjustments, export / import, account & devices, settings (auto-archive, PIN lock). |

Offline: the app shell is cached by the service worker, and the last loaded data is shown **read-only** with an “Offline · read-only” badge. Writes are blocked offline with a clear message (offline write-queueing is a planned stretch goal).

---

## Security model

* **All data lives in Supabase.** The frontend bundle contains only the Supabase URL and the **anon/publishable** key — both are public by design. Access control is done by Postgres **Row Level Security**, not by hiding the key.
* **The service_role / `sb_secret_` key is never used** anywhere in this project. CI fails if anything resembling one (or a JWT signing secret) appears in the repo **or in the built `dist/`** — see `scripts/check-secrets.mjs` (plus gitleaks).
* **RLS is enabled on every table**, no exceptions. Every data table has `workspace_id`; policies allow select/insert/update/delete only when `auth.uid()` is a member of that workspace. Views use `security_invoker = true` and all RPCs are `SECURITY INVOKER`, so they obey the same policies. The anon role has **no table privileges at all** (defence in depth).
* **Proof:** `supabase/tests/rls_proof.sql` (61 checks: anonymous → 0 rows, non-member → 0 rows and cannot write, member sees own rows, RLS on every table, every view is security_invoker) and `npm run test:rls` (the same against the live REST API).
* **Auth:** email + password, optional magic link. Public sign-ups are **disabled**; you create users yourself. Sessions persist on your device and refresh automatically. “Sign out of this device” also wipes the offline cache and PIN.
* **Content-Security-Policy** meta tag (injected at build time): scripts only from the app itself; network connections only to your Supabase project. A frame-buster prevents the app from being embedded in another site.
* **Local storage:** only the Supabase session (localStorage) and, optionally, a salted PBKDF2 hash of your app-lock PIN. The offline data cache lives in IndexedDB on your device, is cleared on sign-out and expires after 7 days.
* **PIN lock** is a *convenience* lock against casual snooping — **not real security** (a 4-digit PIN can be brute-forced by someone with access to the device's storage).
* Pasted Shopify text is always treated as plain text. `dangerouslySetInnerHTML` is banned by ESLint.

---

## First-time setup

### 1. Supabase project
The project **“AfeefRaza's Project”** (ref `wqlhgauwsykmbbfheimw`, free plan) already has all three migrations applied:

```
supabase/migrations/20261002000001_core_schema.sql      tables, RLS, seeds, admin helpers
supabase/migrations/20261002000002_views_and_rpcs.sql   read models + dashboard/re-apply RPCs
supabase/migrations/20261002000003_import_workbook.sql  atomic Excel import
supabase/migrations/20261003000004_supplier_deliveries.sql  supplier delivery log
```

For a **new** project: open **SQL Editor** in the Supabase dashboard and run each file in order (or `supabase link --project-ref <ref>` then `supabase db push` with the Supabase CLI).

### 2. Disable public sign-ups
Dashboard → **Authentication → Sign In / Providers** → turn **off** “Allow new users to sign up”. Keep the **Email** provider enabled.

### 3. Allow the app's URL (needed for magic links)
Dashboard → **Authentication → URL Configuration**:
* **Site URL:** `https://<your-github-username>.github.io/havenwear-ops/`
* **Redirect URLs:** add the same URL, and `http://localhost:5173/` for local development.

### 4. Create your user
Dashboard → **Authentication → Users → Add user → Create new user**: enter your email and a strong password and tick **Auto Confirm User**.

### 5. Create your workspace
Dashboard → **SQL Editor**, run (with your email):

```sql
select private.create_workspace('HavenWear Pakistan', 'you@example.com');
```

This makes you the owner and seeds the default categories (T-shirt 850, Hoodie 1400, Trouser 1000, Other 1, Other 2) and keyword rules.

### 6. Verify RLS (optional but recommended)
* Paste `supabase/tests/rls_proof.sql` into the SQL editor and run it. The first row must read `SUMMARY … true … N passed, 0 failed`. It runs inside a transaction that is rolled back — nothing is left behind.
* Locally: `npm run test:rls` (needs `.env.local`). To also prove the *non-member* case over the network, create a throwaway user that is **not** in any workspace and run
  `RLS_NONMEMBER_EMAIL=… RLS_NONMEMBER_PASSWORD=… npm run test:rls`.

### 7. GitHub repository & secrets
1. Create a new repository named **`havenwear-ops`** (public or private — no data is in it) and push this code to `main`.
2. Repo → **Settings → Secrets and variables → Actions → New repository secret**:
   * `VITE_SUPABASE_URL` = `https://wqlhgauwsykmbbfheimw.supabase.co`
   * `VITE_SUPABASE_ANON_KEY` = the **publishable** key from Dashboard → Project Settings → API Keys (`sb_publishable_…`) — or the legacy `anon` key. **Never** the secret/service_role key.

### 8. Enable GitHub Pages
Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**. Every push to `main` now runs lint, type-check, tests, both secret scans and the build, then deploys to `https://<username>.github.io/havenwear-ops/`.

> Using a different repo name? The workflow sets the Vite `base` from the repo name automatically. Routing uses `HashRouter`, so deep links such as `…/havenwear-ops/#/batches/…` always work on Pages (a `404.html` copy is also deployed).

---

## Install on iPhone / Android

**iPhone (Safari):** open the app URL → tap **Share** → **Add to Home Screen** → **Add**. Open it from the home-screen icon (it runs full-screen and stays signed in).

**Android (Chrome):** open the app URL → **⋮ menu → Install app** (or tap the “Install” banner).

When a new version is deployed, a banner offers **Update** — tap it to reload into the new version.

---

## Back up your data

**More → Export / Import → Excel (.xlsx)** or **JSON**. The Excel file has one sheet per table; the JSON contains everything. The date is recorded as **Last backup** in Settings, and the Home screen nudges you when a backup is a week old. Store the file somewhere safe (Google Drive, email it to yourself).

---

## Supplier production workflow

Three parties, one app: **Havenwear** (full app), the **T-shirt supplier** and the **DTF supplier** (each with a simple, mobile-first portal at the same URL).

1. **Havenwear** creates a batch and pastes / imports products exactly as before.
2. On each pending item tap **Supplier** (= must be manufactured) or **Return** (= fulfilled from return stock, received immediately). Multi-select works too.
3. Tap **Push batch to production**. Only Supplier-allocated items are sent; identical variants are combined. Items added later can be pushed later.
4. **Both suppliers** see the batch with the **normal Shopify product picture**, colour, size, quantity and Front/Back print requirement.
5. **DTF supplier** sees print quantities per design (combined across sizes, e.g. *Motorsport Tee — Front: 7, Back: 7*) → taps **File Ready**. Havenwear and the T-shirt supplier see it.
6. **T-shirt supplier** marks pieces **Ready** gradually (e.g. 6 of 10) and can **Report problem** with an affected quantity.
   - Front / Back / Complete print missing, Wrong print, Damaged print → automatically appear in the DTF portal under **Reprints** → DTF taps **Reprint Ready** → the T-shirt supplier sees it and marks it solved.
   - Garment missing, Damaged garment, Other → stay between Havenwear and the T-shirt supplier (never shown to DTF).
7. **Havenwear** separately marks **Received** when goods physically arrive. Supplier *Ready* is not Havenwear *Received*; the difference is listed under **Ready but not received**. Receiving also marks the matching batch lines "received from Supplier" and counts as supplier-delivered stock (no double entry).
8. The **Production** tab shows: active production batches, total supplier items, DTF waiting / ready, supplier ready / pending, missing prints, garment problems, reprints pending / ready, ready but not received, total received — and a time-stamped **history** per batch (who did what, when).

All production screens refresh automatically every 15 seconds.

### Product pictures & print settings
**More → Shopify products → Sync from Shopify** loads pictures, sizes and colours from the store's public catalogue (`https://havenwearpakistan.com/products.json`). No Shopify password or API key is stored. For each product choose **Front + Back / Front only / Back only / No print** once. Unconfirmed products are assumed Front + Back and flagged.

### DTF meterage & cost
When the DTF supplier taps **File Ready** they must enter the total **DTF meters** used (decimals allowed, e.g. 10.2 / 7.5 / 12.75). Each entry stores the **cost per meter in force at that moment**, so changing the rate later never rewrites past costs (e.g. at PKR 1,000/m: 1.2 m = PKR 1,200, 10.2 m = PKR 10,200). Set the rate in **More → Settings → DTF printing cost** (owner only; currently PKR 1,000 per meter). Suppliers can never see the rate or any cost.

The Home dashboard's **DTF printing** section shows total / today / this week / this month meters and cost, average per batch, cost per printed piece and per print side, current and past rates, a 30-day meters chart and meterage by batch.

**No-print products never reach the DTF supplier.** Products set to *No print* are hidden from the DTF portal by the database, batches containing only no-print products don't appear there at all, and print problems can't be reported against them. Changing a product's print setting also updates its not-yet-received production items (adding a print puts that batch back to "DTF waiting"). Proof: `supabase/tests/dtf_proof.sql` (24 checks, rolled back).

### Create the supplier logins
1. Supabase dashboard → **Authentication → Users → Add user** for each supplier (email + password, tick Auto Confirm).
2. SQL editor (workspace id is shown in More → Account & devices):

   ```sql
   select private.add_member('<workspace-id>', 'tshirt-supplier@example.com', 'tshirt_supplier');
   select private.add_member('<workspace-id>', 'dtf-supplier@example.com', 'dtf_supplier');
   ```
3. They sign in at the same app URL and automatically get their own portal.

### What suppliers can and cannot see (enforced in the database)
Suppliers can read **only** production batches, products, quantities, pictures, print flags and problems — and the DTF supplier only sees *print* problems. They cannot read batches, bills, costs, categories, stock, returns, deliveries, rules, settings, the Shopify catalogue settings or the history log, and cannot write to any table directly: every action (Ready, File Ready, Report problem, Reprint Ready) goes through a database function that checks their role. Proof: `supabase/tests/production_proof.sql` (72 checks, rolled back).

## Add products from a Shopify orders export

In Shopify: **Orders → (filter, e.g. Unfulfilled) → Export → Current page / selected orders → CSV for Excel**. In the app: open a batch → **Add products → Import Shopify orders CSV**.

* One batch line per order line item (multi-item orders included); the order number is saved in the item's notes (`Order #haven32540`).
* Quantity comes from **Lineitem quantity**; pack products such as “(PACK OF TWO)”, “Pack of 3” or “2-Pack” are multiplied into pieces.
* Orders with **Cancelled at** set in Shopify are skipped. (Orders you only *tagged* as cancelled are still included — remove them from the export or cancel the line in the app.)
* Orders already imported into any batch are detected and skipped by default (toggle in the preview).
* The file is read **in your browser only**. Customer names, emails, phones and addresses are ignored — only product name, quantity and order number are saved.

## Import the old Excel workbook

**More → Export / Import → Choose .xlsx file** and pick `Havenwear_Production_Returns_Batch_Tracker_v2.xlsx`.

| Workbook sheet | Becomes |
|---|---|
| Product Rules & Costs | new categories + keyword rules (a rule cost different from its category default becomes a cost override) |
| Batch Register | batches (date, supplier, invoice, actual bill, payment status) |
| Batch Product Checklist | batch items (qty, status, received from, received date) |
| Checklist Archive | batch items; their batches are imported as **archived** |
| Return Stock Received | return receipts (one column per category, or Category + Qty rows) |
| Opening Stock | opening-stock entries |

Columns are matched by name and tolerate common variations (“Batch Ref” / “Batch” / “Ref”, “Qty” / “Quantity”, dates like `10-Sep-26`, `10/09/2026` or real Excel dates). You get a **preview with counts and warnings** before anything is saved; the import runs as **one transaction** — if anything fails, nothing is written. Batches whose ref already exists are skipped, so re-importing is safe.

---

## Add a team member

1. Dashboard → **Authentication → Users → Add user** (their email + a password, Auto Confirm).
2. **SQL Editor:** `select private.add_member('<workspace-id>', 'their@email.com');`
   (Your workspace id is shown in **More → Account & devices**. Use `'owner'` as a third argument to make them an owner.)
3. They sign in at the app URL. To remove someone, delete their row in `workspace_members` (or delete the user).

---

## Local development

```bash
cp .env.example .env.local     # fill in URL + publishable/anon key, VITE_BASE=/
npm install
npm run dev                     # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm test` | Vitest unit tests (domain logic) |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm run typecheck` | TypeScript strict |
| `npm run build` | Production build (CSP injected, service worker generated) |
| `npm run check:secrets` | Scan tracked files for service_role keys / JWT secrets (`node scripts/check-secrets.mjs dist` scans the build) |
| `npm run test:rls` | Live RLS check against Supabase |
| `npm run icons` | Regenerate the PWA icons |

> On Windows Git Bash, prefix commands that pass a path-like env var with `MSYS_NO_PATHCONV=1` (e.g. `MSYS_NO_PATHCONV=1 VITE_BASE=/havenwear-ops/ npm run build`).

---

## Project structure

```
src/domain/        Pure business logic + Zod schemas (fully unit-tested)
  classify.ts        keyword matching, unit cost, re-apply detection
  paste.ts           bulk-paste parser (× 2, tabs, bullets)
  shopifyCsv.ts      Shopify orders CSV → lines (CSV parser, pack sizes, cancelled orders)
  totals.ts          pieces, supplier cost, usage %, avg cost
  stock.ts           stock per category + status
  stage.ts           batch stage + auto-archive rule
  trend.ts           7-day return-usage trend sentence
  importPlan.ts      Excel workbook → import plan
  importPayload.ts   plan → classified RPC payload
src/data/          TanStack Query hooks + mutations (optimistic updates, undo)
src/lib/           Supabase client, auth, workspace, PIN, query cache
src/components/    UI kit, app shell, sheets, charts
src/screens/       One file per screen (lazy-loaded)
supabase/          migrations + RLS proof
scripts/           secret scanner, RLS live check, icon generator
```

---

## Business rules

* **Classification:** a product matches a rule when its name contains the keyword (case-insensitive plain substring). Longest matching keyword wins; ties → the rule created first. A per-item category override beats rules. No match → **Unmatched** (cost 0, flagged everywhere).
* **Unit cost:** rule cost override, else category default — **snapshotted** on the item. After changing rules or costs, Rules shows “Re-apply rules to N items in active batches”. Archived batches are never changed (enforced in the database too).
* **Cancelled items** count only in the line count.
* **Supplier cost (est.)** = Σ qty × unit cost for items received from the supplier, shown against the actual bill.
* **Usage:** Return % = returns ÷ (returns + supplier); Supplier % likewise; Avg cost/piece = est. supplier cost ÷ supplier pieces.
* **Stock** per category = opening/adjustments + returns received + **supplier deliveries** (logged deliveries + pieces received through Production) − all items received (from supplier or returns). Supplier pieces used without a logged delivery therefore show as a shortage. Pending is shown separately. Red < 0, amber ≤ low-stock level, green above.
* **Stages:** No products yet → In progress → Complete → Archived. Archived batches leave working lists but stay in reports and search.
* **Trend:** return usage % last 7 days vs previous 7 days (by batch date), with zero/no-data handled.
* Dates are Pakistan time; shown as `10-Sep-26`; money as `PKR 1,400`.

---

## Reverting to the previous version

The production workflow lives on the branch **`feature/supplier-production-workflow`**. The last version before it is tagged **`stable-before-production`** (identical to what `main` contained).

The **database changes are additive and backward compatible**: the previous app works unchanged against the new database, so reverting the code is all that is needed. (Supplier accounts simply stop having a portal.)

* **Before merging:** nothing to do — `main` and the live site are still the old version.
* **After merging, undo it** — on GitHub open the merged pull request and click **Revert**, or locally:

  ```bash
  git checkout main
  git pull
  git revert -m 1 <merge-commit-sha>
  git push
  ```
  GitHub Actions redeploys the previous version automatically.
* **Hard reset to the tagged version** (rewrites `main`'s history — only if you are sure):

  ```bash
  git checkout main
  git reset --hard stable-before-production
  git push --force-with-lease
  ```
* **Also remove the production tables** (optional; deletes all production data — export a backup first): follow `supabase/rollback/rollback_supplier_production.sql`.
