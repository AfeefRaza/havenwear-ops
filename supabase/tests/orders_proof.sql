-- Proof for migration 20261114000013 (order information on batch lines + HIGH PRIORITY threshold).
-- Runs inside a transaction that is ROLLED BACK — nothing is left behind.
-- Paste into the Supabase SQL editor. First row must be SUMMARY … true.

begin;

create temp table pr (check_name text, pass boolean, detail text) on commit drop;
grant all on pr to authenticated;

do $$
declare
  a uuid := gen_random_uuid();   -- Havenwear owner
  t uuid := gen_random_uuid();   -- T-shirt supplier
  x uuid := gen_random_uuid();   -- outsider
  ws uuid; cat uuid; bat uuid; l1 uuid; l2 uuid;
  n bigint; v int; ok boolean;
  as_user text := 'set local role authenticated';
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'a'||a||'@test.invalid','authenticated','authenticated'), (t, 't'||t||'@test.invalid','authenticated','authenticated'),
    (x, 'x'||x||'@test.invalid','authenticated','authenticated');
  insert into public.workspaces (name) values ('Orders test') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, a, 'owner'), (ws, t, 'tshirt_supplier');
  select id into cat from public.categories where workspace_id = ws and name = 'T-shirt';
  insert into public.batches (workspace_id, ref, batch_date) values (ws, 'HW-ORD', '2026-11-14') returning id into bat;

  ------------------------------------------------------------ existing ways of adding lines still work unchanged
  insert into public.batch_items (workspace_id, batch_id, product_name, qty, resolved_category_id, unit_cost_pkr)
    values (ws, bat, 'Pasted line - L', 1, cat, 850) returning id into l1;
  insert into public.batch_items (workspace_id, batch_id, product_name, qty, resolved_category_id, unit_cost_pkr, notes)
    values (ws, bat, 'CSV line - M', 2, cat, 850, 'Order #haven1') returning id into l2;
  select count(*) into n from public.batch_items where id in (l1, l2) and order_name is null and shopify_order_id is null and shopify_line_id is null;
  insert into pr values ('lines without order info still insert (new columns default to null)', n = 2, n::text);

  select high_priority_pieces into v from public.workspaces where id = ws;
  insert into pr values ('HIGH PRIORITY threshold defaults to 4', v = 4, v::text);

  ------------------------------------------------------------ constraints
  begin
    update public.batch_items set order_name = '   ' where id = l1; ok := false;
  exception when check_violation then ok := true; end;
  insert into pr values ('blank order name rejected', ok, '');
  begin
    update public.batch_items set order_name = repeat('x', 61) where id = l1; ok := false;
  exception when check_violation then ok := true; end;
  insert into pr values ('over-long order name rejected', ok, '');
  update public.batch_items set order_name = '#haven42', shopify_order_id = 42, shopify_line_id = 4201 where id = l1;
  select count(*) into n from public.batch_items where id = l1 and order_name = '#haven42';
  insert into pr values ('order name and Shopify ids can be saved', n = 1, n::text);
  begin
    update public.workspaces set high_priority_pieces = 1 where id = ws; ok := false;
  exception when check_violation then ok := true; end;
  insert into pr values ('threshold below 2 rejected', ok, '');
  begin
    update public.workspaces set high_priority_pieces = 51 where id = ws; ok := false;
  exception when check_violation then ok := true; end;
  insert into pr values ('threshold above 50 rejected', ok, '');

  ------------------------------------------------------------ permissions: same as the rest of batch data
  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select count(*) into n from public.batch_items where batch_id = bat and order_name = '#haven42';
  insert into pr values ('owner sees order info', n = 1, n::text);
  update public.workspaces set high_priority_pieces = 5 where id = ws;
  select high_priority_pieces into v from public.workspaces where id = ws;
  insert into pr values ('owner can change the threshold', v = 5, v::text);
  execute 'reset role';

  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  select count(*) into n from public.batch_items where batch_id = bat;
  insert into pr values ('T-shirt supplier cannot read batch lines (so no order info)', n = 0, n::text);
  update public.workspaces set high_priority_pieces = 9 where id = ws;
  execute 'reset role';
  select high_priority_pieces into v from public.workspaces where id = ws;
  insert into pr values ('T-shirt supplier cannot change the threshold', v = 5, v::text);

  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.batch_items where batch_id = bat;
  insert into pr values ('outsider cannot read batch lines', n = 0, n::text);
  execute 'reset role';
end $$;

-- Everything still has RLS on.
insert into pr select 'RLS on ' || c.relname, c.relrowsecurity, '' from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind = 'r';

select 'SUMMARY' as check_name, bool_and(pass) as pass, count(*) filter (where pass) || ' passed, ' || count(*) filter (where not pass) || ' failed' as detail from pr
union all
(select check_name, pass, detail from pr order by pass, check_name);

rollback;
