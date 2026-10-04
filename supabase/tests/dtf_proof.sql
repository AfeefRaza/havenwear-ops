-- DTF meterage + no-print filtering proof. Rolled back — nothing is left behind.
begin;
create temp table dp (check_name text, pass boolean, detail text) on commit drop;
grant all on dp to authenticated;
do $$
declare
  a uuid := gen_random_uuid(); t uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  ws uuid; cat uuid; b1 uuid; b2 uuid; l1 uuid; l2 uuid; l3 uuid; run1 uuid; run2 uuid; it_print uuid; it_plain uuid;
  n bigint; v numeric; res jsonb; ok boolean; as_user text := 'set local role authenticated';
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'a'||a||'@test.invalid','authenticated','authenticated'), (t, 't'||t||'@test.invalid','authenticated','authenticated'),
    (d, 'd'||d||'@test.invalid','authenticated','authenticated');
  insert into public.workspaces (name) values ('DTF test') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, a, 'owner'), (ws, t, 'tshirt_supplier'), (ws, d, 'dtf_supplier');
  select id into cat from public.categories where workspace_id = ws and name = 'T-shirt';
  insert into public.batches (workspace_id, ref, batch_date) values (ws, 'B1', '2026-10-04') returning id into b1;
  insert into public.batches (workspace_id, ref, batch_date) values (ws, 'B2', '2026-10-04') returning id into b2;
  insert into public.batch_items (workspace_id, batch_id, product_name, qty, resolved_category_id, supplier_planned) values (ws, b1, 'Motorsport Tee - L', 3, cat, true) returning id into l1;
  insert into public.batch_items (workspace_id, batch_id, product_name, qty, resolved_category_id, supplier_planned) values (ws, b1, 'Plain Denim - M', 2, cat, true) returning id into l2;
  insert into public.batch_items (workspace_id, batch_id, product_name, qty, resolved_category_id, supplier_planned) values (ws, b2, 'Plain Denim - S', 1, cat, true) returning id into l3;

  execute as_user; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  res := public.production_push(b1, jsonb_build_array(
    jsonb_build_object('batch_item_id', l1, 'item_key', 'v:1', 'product_title', 'Motorsport Tee', 'front_print', true, 'back_print', true, 'shopify_product_id', 1),
    jsonb_build_object('batch_item_id', l2, 'item_key', 'v:2', 'product_title', 'Plain Denim', 'front_print', false, 'back_print', false, 'shopify_product_id', 2)));
  run1 := (res->>'run_id')::uuid;
  res := public.production_push(b2, jsonb_build_array(
    jsonb_build_object('batch_item_id', l3, 'item_key', 'v:3', 'product_title', 'Plain Denim', 'front_print', false, 'back_print', false, 'shopify_product_id', 2)));
  run2 := (res->>'run_id')::uuid;
  select id into it_print from public.production_items where run_id = run1 and item_key = 'v:1';
  select id into it_plain from public.production_items where run_id = run1 and item_key = 'v:2';
  execute 'reset role';

  -- DTF: no-print products and no-print-only batches are invisible
  execute as_user; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  select count(*) into n from public.production_items; insert into dp values ('dtf sees only printed products (1 of 3)', n = 1, n::text);
  select count(*) into n from public.production_runs where id = run2; insert into dp values ('dtf cannot see a no-print-only batch', n = 0, n::text);
  select count(*) into n from public.production_runs where id = run1; insert into dp values ('dtf sees batch with printed products', n = 1, n::text);
  begin perform public.production_set_dtf_ready(run1, true, null); insert into dp values ('File Ready requires meters', false, 'allowed');
  exception when others then insert into dp values ('File Ready requires meters', true, sqlerrm); end;
  begin perform public.production_set_dtf_ready(run1, true, 0); insert into dp values ('meters must be > 0', false, 'allowed');
  exception when others then insert into dp values ('meters must be > 0', true, sqlerrm); end;
  perform public.production_set_dtf_ready(run1, true, 10.2);
  select dtf_meters into v from public.production_run_summaries where id = run1; insert into dp values ('dtf records 10.2 m', v = 10.2, v::text);
  select count(*) into n from public.dtf_costs; insert into dp values ('dtf cannot see DTF cost', n = 0, n::text);
  select count(*) into n from public.workspaces; insert into dp values ('dtf cannot see rate setting', n = 0, n::text);
  execute 'reset role';

  -- T-shirt supplier: still sees no-print products; cannot see costs; cannot report print problems on them
  execute as_user; perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  select count(*) into n from public.production_items; insert into dp values ('tshirt still sees all 3 products', n = 3, n::text);
  select count(*) into n from public.dtf_costs; insert into dp values ('tshirt cannot see DTF cost', n = 0, n::text);
  select count(*) into n from public.dtf_meterage; insert into dp values ('tshirt cannot see meterage', n = 0, n::text);
  begin perform public.production_report_issue(it_plain, 'front_missing', 1, null); insert into dp values ('no print problems on no-print product', false, 'allowed');
  exception when others then insert into dp values ('no print problems on no-print product', true, sqlerrm); end;
  perform public.production_report_issue(it_plain, 'garment_missing', 1, null);
  insert into dp values ('garment problem on no-print product still allowed', true, '');
  execute 'reset role';

  -- Havenwear: cost snapshot, rate change keeps history
  execute as_user; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select cost_pkr into v from public.dtf_costs; insert into dp values ('10.2 m x PKR 100 = PKR 1,020', v = 1020, v::text);
  update public.workspaces set dtf_cost_per_meter = 120 where id = ws;
  select cost_pkr into v from public.dtf_costs; insert into dp values ('rate change does not rewrite history', v = 1020, v::text);
  perform public.production_set_dtf_ready(run1, false);
  select count(*) into n from public.dtf_meterage where run_id = run1; insert into dp values ('undo File Ready removes that entry', n = 0, n::text);
  perform public.production_set_dtf_ready(run1, true, 5);
  select cost_pkr into v from public.dtf_costs; insert into dp values ('new file uses new rate (5 x 120 = 600)', v = 600, v::text);
  res := public.dtf_analytics(ws, (now() at time zone 'Asia/Karachi')::date);
  insert into dp values ('analytics totals', (res->'total'->>'meters')::numeric = 5 and (res->'total'->>'cost')::numeric = 600 and (res->>'rate')::numeric = 120, res->>'total');
  insert into dp values ('analytics today', (res->'today'->>'meters')::numeric = 5, res->>'today');
  insert into dp values ('analytics printed pieces/prints', (res->'printed'->>'pieces')::int = 3 and (res->'printed'->>'prints')::int = 6, res->>'printed');
  -- Print setting change flows to open production items
  n := public.set_print_config(ws, 2, true, false);
  select front_print into ok from public.production_items where id = it_plain; insert into dp values ('print setting updates open items', ok and n = 2, n::text);
  select dtf_status = 'waiting' into ok from public.production_runs where id = run1; insert into dp values ('adding a print resets File Ready', ok, '');
  execute 'reset role';

  execute as_user; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  select count(*) into n from public.production_runs where id = run2; insert into dp values ('dtf now sees batch once it needs a print', n = 1, n::text);
  res := public.dtf_analytics(ws, current_date);
  insert into dp values ('dtf gets no cost from analytics', (res->'total'->>'cost')::numeric = 0 and res->>'rate' is null, res->>'total');
  execute 'reset role';
end $$;
select 'SUMMARY' as check_name, bool_and(pass) as pass, count(*) filter (where pass) || ' passed, ' || count(*) filter (where not pass) || ' failed' as detail from dp
union all (select check_name, pass, detail from dp where not pass);
rollback;
