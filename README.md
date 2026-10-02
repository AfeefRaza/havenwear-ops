# HavenWear Ops

Private, mobile-first production & returns tracker for HavenWear Pakistan.
Installable PWA · Vite + React + TypeScript · Supabase (Postgres + Auth + RLS) · GitHub Pages.

> Full setup guide is being written phase by phase — see the sections below.

## Status
- [x] Phase 0 — scaffold, strict TS, ESLint, Vitest, PWA, CSP, secret scanning CI, Pages deploy
- [ ] Phase 1 — database, RLS, seeds, RLS proof
- [ ] Phase 2 — domain logic + tests
- [ ] Phase 3 — auth, app shell
- [ ] Phase 4 — batches & bulk paste
- [ ] Phase 5 — pending, returns, rules, adjustments
- [ ] Phase 6 — dashboard
- [ ] Phase 7 — import / export
- [ ] Phase 8 — PIN, auto-archive, offline, polish

## Local development
```bash
cp .env.example .env.local   # fill in URL + anon key
npm install
npm run dev
```

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run check:secrets`.
