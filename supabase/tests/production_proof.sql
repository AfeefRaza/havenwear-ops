-- Production workflow proof: permissions + behaviour, end to end.
-- Runs inside a transaction that is ROLLED BACK — nothing is left behind.
-- Paste into the Supabase SQL editor. First row must be SUMMARY … true.

begin;

create temp table pr (check_name text, pass boolean, detail text) on commit drop;
grant all on pr to authenticated;

do $$
declare
  a uuid := gen_random_uuid();   -- Havenwear owner
  t uuid := gen_random_uuid();   -- T-shirt supplier
  d uuid := gen_random_uuid();   -- DTF supplier
  x uuid := gen_random_uuid();   -- outsider
  ws uuid; cat uuid; bat uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid;
  run uuid; it1 uuid; it2 uuid; iss_front uuid; iss_garment uuid;
  n bigint; v int; res jsonb; ok boolean;
  as_user text := 'set local role authenticated';
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'a'||a||'@test.invalid','authenticated','authenticated'), (t, 't'||t||'@test.invalid','authenticated','authenticated'),
    (d, 'd'||d||'@test.invalid','authenticated','authenticated'), (x, 'x'||x||'@test.invalid','authenticated','authenticated');
  insert into public.workspaces (name) values ('Prod test') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, a, 'owner'), (ws, t, 'tshirt_supplier'), (ws, d, 'dtf_supplier');
  select id into cat from public.categories where workspace_id = ws and name = 'T-shirt';
  insert into public.batches (workspace_id, ref, batch_date, actual_bill_pkr) values (ws, 'HW-T1', '2026-10-03', 99999) returning id into bat;
  insert into public.batch_items (workspace_id, batch_id, product_name, qty, resolved_category_id, unit_cost_pkr)
    values (ws, bat, 'Motorsport Tee - L', 2, cat, 850) returning id into l1;
  insert into public.batch_items (workspace_id, batch_id, product_name, qty, resolved_category_id, unit_cost_pkr)
    values (ws, bat, 'Motorsport Tee - L', 1, cat, 850) returning id into l2;
  insert into public.batch_items (workspace_id, batch_id, product_name, qty, resolved_category_id, unit_cost_pkr)
    values (ws, bat, 'Hoodie - M', 1, cat, 1400) returning id into l3;
  insert into public.batch_items (workspace_id, batch_id, product_name, qty, resolved_category_id, unit_cost_pkr)
    values (ws, bat, 'From returns', 1, cat, 850) returning id into l4;

  ------------------------------------------------------------ Havenwear allocates + pushes
  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v := public.set_supplier_planned(array[l1, l2, l3], true);
  insert into pr values ('owner allocates 3 lines to supplier', v = 3, v::text);
  res := public.production_push(bat, jsonb_build_array(
    jsonb_build_object('batch_item_id', l1, 'item_key', 'v:1', 'product_title', 'Motorsport Tee', 'variant_title', 'L', 'size', 'L', 'color', 'Black', 'image_url', 'https://cdn.shopify.com/x.jpg', 'front_print', true, 'back_print', true),
    jsonb_build_object('batch_item_id', l2, 'item_key', 'v:1', 'product_title', 'Motorsport Tee', 'variant_title', 'L', 'size', 'L', 'color', 'Black', 'image_url', 'https://evil.example/x.jpg', 'front_print', true, 'back_print', true),
    jsonb_build_object('batch_item_id', l3, 'item_key', 'v:2', 'product_title', 'Hoodie', 'variant_title', 'M', 'front_print', true, 'back_print', false),
    jsonb_build_object('batch_item_id', l4, 'item_key', 'v:9', 'product_title', 'Not allocated')));
  run := (res->>'run_id')::uuid;
  insert into pr values ('push sends only supplier-allocated lines', (res->>'lines')::int = 3 and (res->>'pieces')::int = 4, res::text);
  select id into it1 from public.production_items where run_id = run and item_key = 'v:1';
  select id into it2 from public.production_items where run_id = run and item_key = 'v:2';
  select qty_required into v from public.production_items where id = it1;
  insert into pr values ('same variant combined (2+1=3)', v = 3, v::text);
  select count(*) into n from public.production_items where image_url is not null and image_url !~ '^https://cdn\.shopify\.com/';
  insert into pr values ('non-Shopify image URLs rejected', n = 0, n::text);
  res := public.production_push(bat, jsonb_build_array(jsonb_build_object('batch_item_id', l1, 'item_key', 'v:1')));
  insert into pr values ('re-push is idempotent', (res->>'lines')::int = 0, res::text);
  execute 'reset role';

  ------------------------------------------------------------ T-shirt supplier: sees production only
  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  select count(*) into n from public.batches;            insert into pr values ('tshirt cannot see batches (bills)', n = 0, n::text);
  select count(*) into n from public.batch_items;        insert into pr values ('tshirt cannot see batch items (costs)', n = 0, n::text);
  select count(*) into n from public.categories;         insert into pr values ('tshirt cannot see categories (costs)', n = 0, n::text);
  select count(*) into n from public.keyword_rules;      insert into pr values ('tshirt cannot see rules', n = 0, n::text);
  select count(*) into n from public.workspaces;         insert into pr values ('tshirt cannot see workspace settings', n = 0, n::text);
  select count(*) into n from public.stock_adjustments;  insert into pr values ('tshirt cannot see stock', n = 0, n::text);
  select count(*) into n from public.supplier_deliveries; insert into pr values ('tshirt cannot see deliveries', n = 0, n::text);
  select count(*) into n from public.shopify_products;   insert into pr values ('tshirt cannot see catalogue settings', n = 0, n::text);
  select count(*) into n from public.workspace_members;  insert into pr values ('tshirt sees only own membership', n = 1, n::text);
  select count(*) into n from public.production_items;   insert into pr values ('tshirt sees production items', n = 2, n::text);
  select count(*) into n from public.production_events;  insert into pr values ('tshirt cannot see history', n = 0, n::text);
  begin
    perform public.dashboard(ws, null, null, current_date);
    select (public.dashboard(ws, null, null, current_date)->'period'->>'est_supplier_cost')::numeric into v;
    insert into pr values ('tshirt dashboard shows no cost', v = 0, v::text);
  exception when others then insert into pr values ('tshirt dashboard shows no cost', true, sqlerrm); end;
  begin
    perform public.production_push(bat, '[]'); insert into pr values ('tshirt cannot push', false, 'allowed');
  exception when insufficient_privilege then insert into pr values ('tshirt cannot push', true, 'denied'); end;
  begin
    perform public.production_receive(it1, 1); insert into pr values ('tshirt cannot mark received', false, 'allowed');
  exception when insufficient_privilege then insert into pr values ('tshirt cannot mark received', true, 'denied'); end;
  begin
    perform public.production_set_dtf_ready(run, true); insert into pr values ('tshirt cannot set DTF ready', false, 'allowed');
  exception when insufficient_privilege then insert into pr values ('tshirt cannot set DTF ready', true, 'denied'); end;
  begin
    perform public.set_supplier_planned(array[l4], true); insert into pr values ('tshirt cannot allocate batch lines', false, 'allowed');
  exception when insufficient_privilege then insert into pr values ('tshirt cannot allocate batch lines', true, 'denied'); end;
  begin
    update public.production_items set qty_ready = 3 where id = it1; get diagnostics n = row_count;
    insert into pr values ('tshirt cannot write tables directly', n = 0, n::text);
  exception when insufficient_privilege then insert into pr values ('tshirt cannot write tables directly', true, 'denied'); end;
  v := public.production_mark_ready(it1, 2);              insert into pr values ('tshirt marks 2 ready (gradual)', v = 2, v::text);
  begin
    perform public.production_mark_ready(it1, 5); insert into pr values ('ready cannot exceed required', false, 'allowed');
  exception when others then insert into pr values ('ready cannot exceed required', true, sqlerrm); end;
  iss_front := public.production_report_issue(it1, 'front_missing', 1, 'smudged');
  iss_garment := public.production_report_issue(it2, 'garment_missing', 1, null);
  insert into pr values ('tshirt reports problems', iss_front is not null and iss_garment is not null, '');
  execute 'reset role';

  ------------------------------------------------------------ DTF supplier
  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  select count(*) into n from public.batch_items;        insert into pr values ('dtf cannot see batch items', n = 0, n::text);
  select count(*) into n from public.production_issues;  insert into pr values ('dtf sees ONLY print problems (1 of 2)', n = 1, n::text);
  select count(*) into n from public.production_issues where kind = 'garment_missing';
  insert into pr values ('garment problem hidden from dtf', n = 0, n::text);
  perform public.production_set_dtf_ready(run, true);
  select (dtf_status = 'file_ready') into ok from public.production_runs where id = run;
  insert into pr values ('dtf marks File Ready', ok, '');
  begin
    perform public.production_mark_ready(it1, 1); insert into pr values ('dtf cannot mark garments ready', false, 'allowed');
  exception when insufficient_privilege then insert into pr values ('dtf cannot mark garments ready', true, 'denied'); end;
  perform public.production_reprint_ready(iss_front);
  select (status = 'reprint_ready') into ok from public.production_issues where id = iss_front;
  insert into pr values ('dtf marks Reprint Ready', ok, '');
  begin
    perform public.production_reprint_ready(iss_garment); insert into pr values ('dtf cannot act on garment problem', false, 'allowed');
  exception when others then insert into pr values ('dtf cannot act on garment problem', true, sqlerrm); end;
  execute 'reset role';

  ------------------------------------------------------------ T-shirt sees DTF + reprint status
  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  select (dtf_status = 'file_ready') into ok from public.production_runs where id = run;
  insert into pr values ('tshirt sees DTF File Ready', ok, '');
  select (status = 'reprint_ready') into ok from public.production_issues where id = iss_front;
  insert into pr values ('tshirt sees Reprint Ready', ok, '');
  perform public.production_resolve_issue(iss_front);
  execute 'reset role';

  ------------------------------------------------------------ Outsider
  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.production_runs;    insert into pr values ('outsider sees no production', n = 0, n::text);
  select count(*) into n from public.production_run_summaries; insert into pr values ('outsider sees no summaries', n = 0, n::text);
  begin
    perform public.production_mark_ready(it1, 1); insert into pr values ('outsider cannot act', false, 'allowed');
  exception when insufficient_privilege then insert into pr values ('outsider cannot act', true, 'denied'); end;
  execute 'reset role';

  ------------------------------------------------------------ Havenwear receives (separate from Ready)
  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select ready_not_received into v from public.production_run_summaries where id = run;
  insert into pr values ('ready-but-not-received = 2 before receiving', v = 2, v::text);
  v := public.production_receive(it1, 2);
  select count(*) into n from public.batch_items where id = l1 and status = 'received' and received_from = 'supplier';
  insert into pr values ('receiving 2 marks the 2-piece batch line received', n = 1, n::text);
  select count(*) into n from public.batch_items where id = l2 and status = 'pending';
  insert into pr values ('third piece still pending', n = 1, n::text);
  select ready_not_received into v from public.production_run_summaries where id = run;
  insert into pr values ('ready-but-not-received = 0 after receiving', v = 0, v::text);
  perform public.production_receive(it1, 1);
  select count(*) into n from public.batch_items where id = l2 and status = 'received';
  insert into pr values ('receiving past Ready allowed', n = 1, n::text);
  perform public.production_receive(it1, -1);
  select count(*) into n from public.batch_items where id = l2 and status = 'pending';
  insert into pr values ('receive correction reverts batch line', n = 1, n::text);
  select (c->>'delivered')::int into v from jsonb_array_elements(public.dashboard(ws, null, null, current_date)->'stock') c where c->>'category_id' = cat::text;
  insert into pr values ('production receipts count as delivered stock', v = 2, v::text);
  update public.batch_items set status = 'cancelled' where id = l3;
  select qty_required into v from public.production_items where id = it2;
  insert into pr values ('cancelling a pushed line reduces production', v = 0, v::text);
  select count(*) into n from public.production_events where run_id = run;
  insert into pr values ('history recorded', n >= 10, n::text);
  select count(*) into n from public.production_events where run_id = run and actor_role = 'tshirt_supplier';
  insert into pr values ('history records who acted', n >= 3, n::text);
  delete from public.batches where id = bat;
  select count(*) into n from public.production_runs where id = run;
  insert into pr values ('deleting the batch cleans up production', n = 0, n::text);
  execute 'reset role';
end $$;

-- Everything still has RLS on.
insert into pr select 'RLS on ' || c.relname, c.relrowsecurity, '' from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind = 'r';
insert into pr select 'view invoker ' || c.relname, coalesce(c.reloptions @> array['security_invoker=true'], false), ''
from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and c.relkind = 'v';

select 'SUMMARY' as check_name, bool_and(pass) as pass, count(*) filter (where pass) || ' passed, ' || count(*) filter (where not pass) || ' failed' as detail from pr
union all
(select check_name, pass, detail from pr order by pass, check_name);

rollback;
