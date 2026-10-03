-- ROLLBACK for the supplier production workflow (migrations 20261003000005 + 20261003000006).
-- Only needed if you want to remove the production feature from the DATABASE as well as the code.
-- The previous app version works fine with these tables present, so normally you only revert the code.
--
-- ⚠ This permanently deletes all production runs, items, problems, history and the Shopify catalogue.
-- Export a backup first (More → Export / Import).
-- Supplier users must be removed first (their role would violate the restored constraint).

begin;

delete from public.workspace_members where role in ('tshirt_supplier', 'dtf_supplier');

drop trigger if exists production_sync on public.batch_items;
drop function if exists private.batch_item_production_change();
drop function if exists public.production_push(uuid, jsonb);
drop function if exists public.production_set_dtf_ready(uuid, boolean);
drop function if exists public.production_mark_ready(uuid, integer);
drop function if exists public.production_receive(uuid, integer);
drop function if exists public.production_report_issue(uuid, text, integer, text);
drop function if exists public.production_reprint_ready(uuid);
drop function if exists public.production_resolve_issue(uuid);
drop function if exists public.set_supplier_planned(uuid[], boolean);
drop function if exists private.sync_batch_lines(uuid);
drop function if exists private.log_event(uuid, uuid, uuid, uuid, text, integer, text);
drop function if exists private.require_role(uuid, text[]);

-- Restore views/dashboard to the pre-production definitions (migration 20261003000004).
-- Run the "create or replace view public.batch_summaries" and "create or replace function public.dashboard"
-- statements from supabase/migrations/20261003000004_supplier_deliveries.sql BEFORE dropping the tables below.

drop view if exists public.production_run_summaries;
alter table public.batch_items drop constraint if exists batch_items_production_item_fkey;
drop table if exists public.production_events;
drop table if exists public.production_issues;
drop table if exists public.production_items;
drop table if exists public.production_runs;
drop table if exists public.shopify_variants;
drop table if exists public.shopify_products;
alter table public.batch_items drop column if exists production_item_id;
alter table public.batch_items drop column if exists supplier_planned;

drop policy if exists members_select_own on public.workspace_members;
drop function if exists private.my_role(uuid);
drop function if exists private.my_supplier_workspace_ids(text);
alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('owner', 'member'));

commit;
