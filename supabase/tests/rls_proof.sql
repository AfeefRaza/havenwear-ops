-- RLS proof for HavenWear Ops.
-- Paste into the Supabase SQL editor (or run with psql). Everything happens inside a
-- transaction that is ROLLED BACK, so no test data is left behind.
--
-- It creates two throwaway auth users (A = member, B = non-member), a workspace for A
-- with data in every table, then checks — for every table — that:
--   1. an unauthenticated (anon) request sees zero rows,
--   2. an authenticated NON-member sees zero rows and cannot insert/update/delete,
--   3. the member sees their rows (sanity check that the test is meaningful).
-- The final SELECT lists every check; any row with pass = false is a failure.

begin;

create temp table rls_results (check_name text, tbl text, pass boolean, detail text) on commit drop;
grant all on rls_results to anon, authenticated;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  ws uuid;
  cat uuid;
  bat uuid;
  rr uuid;
  t text;
  n bigint;
  tables text[] := array['workspaces', 'workspace_members', 'categories', 'keyword_rules', 'batches',
                         'batch_items', 'return_receipts', 'return_receipt_lines', 'stock_adjustments',
                         'supplier_deliveries', 'supplier_delivery_lines',
                         -- read-model views (security_invoker) must be filtered too
                         'batch_summaries', 'pending_items', 'unmatched_names'];
  dash jsonb;
  item_id uuid;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'rls-a-' || a || '@test.invalid', 'authenticated', 'authenticated'),
    (b, 'rls-b-' || b || '@test.invalid', 'authenticated', 'authenticated');

  insert into public.workspaces (name) values ('RLS test') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, a, 'owner');
  select id into cat from public.categories where workspace_id = ws limit 1;
  insert into public.batches (workspace_id, ref) values (ws, 'RLS-1') returning id into bat;
  insert into public.batch_items (workspace_id, batch_id, product_name) values (ws, bat, 'Oversized Tee');
  insert into public.return_receipts (workspace_id, reference) values (ws, 'RLS') returning id into rr;
  insert into public.return_receipt_lines (workspace_id, receipt_id, category_id, qty) values (ws, rr, cat, 3);
  insert into public.stock_adjustments (workspace_id, category_id, qty, kind) values (ws, cat, 10, 'opening');
  insert into public.supplier_deliveries (workspace_id, reference, batch_id) values (ws, 'DC-1', bat) returning id into rr;
  insert into public.supplier_delivery_lines (workspace_id, delivery_id, category_id, qty) values (ws, rr, cat, 4);
  select id into item_id from public.batch_items where workspace_id = ws limit 1;

  ---------------------------------------------------------------- 1. anon
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  foreach t in array tables loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      insert into rls_results values ('anon sees zero rows', t, n = 0, n || ' rows');
    exception when insufficient_privilege then
      insert into rls_results values ('anon sees zero rows', t, true, 'permission denied');
    end;
  end loop;
  execute 'reset role';

  ---------------------------------------------------------------- 2. non-member
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  foreach t in array tables loop
    execute format('select count(*) from public.%I', t) into n;
    insert into rls_results values ('non-member sees zero rows', t, n = 0, n || ' rows');
  end loop;

  -- Writes into A's workspace must fail or affect nothing.
  begin
    insert into public.batches (workspace_id, ref) values (ws, 'HACK');
    insert into rls_results values ('non-member cannot insert', 'batches', false, 'insert succeeded');
  exception when insufficient_privilege then
    insert into rls_results values ('non-member cannot insert', 'batches', true, 'blocked by RLS');
  end;
  begin
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, b, 'owner');
    insert into rls_results values ('non-member cannot join workspace', 'workspace_members', false, 'insert succeeded');
  exception when insufficient_privilege then
    insert into rls_results values ('non-member cannot join workspace', 'workspace_members', true, 'blocked by RLS');
  end;
  update public.batch_items set qty = 99 where workspace_id = ws;
  get diagnostics n = row_count;
  insert into rls_results values ('non-member cannot update', 'batch_items', n = 0, n || ' rows updated');
  delete from public.batches where workspace_id = ws;
  get diagnostics n = row_count;
  insert into rls_results values ('non-member cannot delete', 'batches', n = 0, n || ' rows deleted');
  dash := public.dashboard(ws, null, null, current_date);
  insert into rls_results values ('non-member dashboard is empty', 'dashboard()',
    (dash->'period'->>'lines')::int = 0 and jsonb_array_length(dash->'stock') = 0, dash->>'period');
  n := public.apply_item_classifications(jsonb_build_array(jsonb_build_object('id', item_id, 'unit_cost_pkr', 1)));
  insert into rls_results values ('non-member cannot re-apply rules', 'apply_item_classifications()', n = 0, n || ' rows updated');
  execute 'reset role';

  ---------------------------------------------------------------- 3. member (sanity)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  foreach t in array tables loop
    execute format('select count(*) from public.%I', t) into n;
    insert into rls_results values ('member sees own rows', t, n > 0, n || ' rows');
  end loop;
  execute 'reset role';
end;
$$;

-- RLS must be enabled on every table in the public schema.
insert into rls_results
select 'RLS enabled', c.relname, c.relrowsecurity, case when c.relrowsecurity then 'on' else 'OFF' end
from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind = 'r';

-- Every view must run with the caller's permissions (otherwise it would bypass RLS).
insert into rls_results
select 'view is security_invoker', c.relname, coalesce(c.reloptions @> array['security_invoker=true'], false),
       coalesce(array_to_string(c.reloptions, ','), 'no options')
from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind = 'v';

-- Summary first, then every individual check.
select 'SUMMARY' as check_name, '' as tbl, bool_and(pass) as pass,
       count(*) filter (where pass) || ' passed, ' || count(*) filter (where not pass) || ' failed' as detail
from rls_results
union all
(select check_name, tbl, pass, detail from rls_results order by pass, check_name, tbl);


rollback;
