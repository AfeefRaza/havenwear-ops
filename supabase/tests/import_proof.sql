-- Proof for migration 20261114000014 ("Import new batches").
-- Runs inside a transaction that is ROLLED BACK — nothing is left behind. It never contacts Shopify:
-- the import is fed hand-made orders in the same shape the feed returns.
-- Paste into the Supabase SQL editor. First row must be SUMMARY … true.

begin;

create temp table pr (check_name text, pass boolean, detail text) on commit drop;
grant all on pr to authenticated;

do $$
declare
  a uuid := gen_random_uuid();   -- Havenwear owner
  t uuid := gen_random_uuid();   -- T-shirt supplier
  x uuid := gen_random_uuid();   -- outsider
  ws uuid; cat1 uuid; cat2 uuid; rule1 uuid; bat uuid; man uuid; r jsonb; n bigint; n2 bigint; v text; ok boolean; d date; c numeric;
  as_user text := 'set local role authenticated';
  base jsonb;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'a'||a||'@test.invalid','authenticated','authenticated'), (t, 't'||t||'@test.invalid','authenticated','authenticated'),
    (x, 'x'||x||'@test.invalid','authenticated','authenticated');
  insert into public.workspaces (name) values ('Import test') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, a, 'owner'), (ws, t, 'tshirt_supplier');
  select id into cat1 from public.categories where workspace_id = ws order by sort_order, name limit 1;
  select id into cat2 from public.categories where workspace_id = ws order by sort_order, name offset 1 limit 1;

  ------------------------------------------------------------ tags
  insert into pr values
    ('11nov26 is a batch tag', private.is_batch_tag('11nov26'), ''),
    ('capitals and spaces are fine', private.is_batch_tag(' 9NOV26 '), ''),
    ('"done" is not a batch tag', not private.is_batch_tag('done'), ''),
    ('"5pcs26" is not a batch tag', not private.is_batch_tag('5pcs26'), ''),
    ('"cod50" is not a batch tag', not private.is_batch_tag('cod50'), ''),
    ('date from 11nov26', private.batch_tag_date('11nov26') = date '2026-11-11', ''),
    ('date from 9NOV26', private.batch_tag_date('9NOV26') = date '2026-11-09', ''),
    ('31nov26 is not a real date', private.batch_tag_date('31nov26') is null, ''),
    ('29feb26 is not a real date (2026 not a leap year)', private.batch_tag_date('29feb26') is null, ''),
    ('29feb28 is a real date', private.batch_tag_date('29feb28') = date '2028-02-29', '');

  ------------------------------------------------------------ pack sizes (same cases as the TypeScript rule)
  insert into pr values
    ('pack: (PACK OF TWO)', private.pack_size('Basic Oversized T-shirt (PACK OF TWO) - S / Cream / Olive') = 2, ''),
    ('pack: Pack of 3', private.pack_size('Pack of 3 Tees') = 3, ''),
    ('pack: 2-Pack', private.pack_size('2-Pack socks') = 2, ''),
    ('pack: (Pack of Two) in the middle', private.pack_size('Spiderman (Pack of Two) - Medium') = 2, ''),
    ('pack: Bundle of two is not a pack (as in the CSV import)', private.pack_size('Bundle of two Oversized Hoodie - Large') = 1, ''),
    ('pack: absurd size ignored', private.pack_size('Pack of 30') = 1, ''),
    ('pack: ordinary product', private.pack_size('Plain Tee - L') = 1, '');

  ------------------------------------------------------------ classification (longest keyword wins, tie → oldest, inactive ignored)
  insert into public.keyword_rules (workspace_id, keyword, category_id, cost_override_pkr) values (ws, 'zzfoo', cat1, null) returning id into rule1;
  insert into public.keyword_rules (workspace_id, keyword, category_id, cost_override_pkr) values (ws, 'zzfoo bar', cat2, 900);
  insert into public.keyword_rules (workspace_id, keyword, category_id) values (ws, 'zzaaa', cat1), (ws, 'zzbbb', cat2);
  insert into public.keyword_rules (workspace_id, keyword, category_id, active) values (ws, 'zzinactivekw', cat2, false);
  select (select category_id from private.classify_line(ws, 'Zzfoo Bar Thing - L')) = cat2 and (select unit_cost from private.classify_line(ws, 'Zzfoo Bar Thing - L')) = 900 into ok;
  insert into pr values ('classify: longest keyword wins, with its cost override', ok, '');
  select (select category_id from private.classify_line(ws, 'ZZFOO thing - L')) = cat1 and (select rule_id from private.classify_line(ws, 'ZZFOO thing - L')) = rule1
         and (select unit_cost from private.classify_line(ws, 'ZZFOO thing - L')) = (select default_cost_pkr from public.categories where id = cat1) into ok;
  insert into pr values ('classify: case-insensitive, cost = category default', ok, '');
  select (select category_id from private.classify_line(ws, 'zzaaa zzbbb')) = cat1 into ok;
  insert into pr values ('classify: equal length → rule created first', ok, '');
  select count(*) into n from private.classify_line(ws, 'zzinactivekw thing');
  insert into pr values ('classify: inactive rule ignored', n = 0, n::text);
  select count(*) into n from private.classify_line(ws, 'Totally unknown product');
  insert into pr values ('classify: no match → unmatched', n = 0, n::text);

  ------------------------------------------------------------ the import
  -- A batch created by hand earlier, with a different spelling of the ref and one pasted line.
  insert into public.batches (workspace_id, ref, batch_date) values (ws, '9NOV26', '2026-11-09') returning id into bat;
  insert into public.batch_items (workspace_id, batch_id, product_name, qty) values (ws, bat, 'Pasted line - L', 1) returning id into man;

  base := jsonb_build_array(
    jsonb_build_object('id', 1001, 'name', '#T1001', 'tags', jsonb_build_array('Done', '13nov26', 'confirmed'), 'cancelled', false, 'lines', jsonb_build_array(
      jsonb_build_object('id', 5001, 'title', 'Zzfoo Thing', 'variant_title', 'Large', 'qty', 2),
      jsonb_build_object('id', 5002, 'title', 'Basic Tee (PACK OF TWO)', 'variant_title', 'S / Cream', 'qty', 1))),
    jsonb_build_object('id', 1002, 'name', '#T1002', 'tags', jsonb_build_array('done', '13nov26'), 'cancelled', true, 'lines', jsonb_build_array(
      jsonb_build_object('id', 5003, 'title', 'Cancelled thing', 'variant_title', 'L', 'qty', 1))),
    jsonb_build_object('id', 1003, 'name', '#T1003', 'tags', jsonb_build_array('done', 'confirmed'), 'cancelled', false, 'lines', jsonb_build_array(
      jsonb_build_object('id', 5004, 'title', 'No batch tag yet', 'variant_title', 'L', 'qty', 1))),
    jsonb_build_object('id', 1004, 'name', '#T1004', 'tags', jsonb_build_array('13nov26'), 'cancelled', false, 'lines', jsonb_build_array(
      jsonb_build_object('id', 5005, 'title', 'Not done yet', 'variant_title', 'L', 'qty', 1))),
    jsonb_build_object('id', 1005, 'name', '#T1005', 'tags', jsonb_build_array('done', '13nov26', '14nov26'), 'cancelled', false, 'lines', jsonb_build_array(
      jsonb_build_object('id', 5006, 'title', 'Two batch tags', 'variant_title', 'L', 'qty', 1))),
    jsonb_build_object('id', 1006, 'name', '#T1006', 'tags', jsonb_build_array('done', '31nov26'), 'cancelled', false, 'lines', jsonb_build_array(
      jsonb_build_object('id', 5007, 'title', 'Impossible date', 'variant_title', 'L', 'qty', 1))),
    jsonb_build_object('id', 1007, 'name', '#T1007', 'tags', jsonb_build_array('done', '9nov26'), 'cancelled', false, 'lines', jsonb_build_array(
      jsonb_build_object('id', 5008, 'title', 'Zzfoo Thing', 'variant_title', 'Default Title', 'qty', 1),
      jsonb_build_object('id', 5009, 'title', 'Removed line', 'variant_title', 'L', 'qty', 0))),
    jsonb_build_object('id', 1008, 'name', '#T1008', 'tags', jsonb_build_array('done', '5pcs26', '7nov26'), 'cancelled', false, 'lines', jsonb_build_array(
      jsonb_build_object('id', 5010, 'title', 'Zzfoo Bar Thing', 'variant_title', 'M', 'qty', 3))));

  r := private.import_feed_orders(ws, base, false);
  insert into pr values ('import: 7 done orders seen', (r ->> 'seen')::int = 7, r::text);
  insert into pr values ('import: 3 orders imported (1001, 1007, 1008)', (r ->> 'imported_orders')::int = 3, r::text);
  insert into pr values ('import: 2 blocked (two tags, impossible date), 1 skipped (cancelled)', (r ->> 'blocked')::int = 2 and (r ->> 'skipped')::int = 1, r::text);

  select id, batch_date, source into bat, d, v from public.batches where workspace_id = ws and ref = '13nov26';
  insert into pr values ('new batch created from the tag (lower-case ref, right date, source shopify)', bat is not null and d = date '2026-11-13' and v = 'shopify', coalesce(d::text, 'none'));
  select count(*) into n from public.batch_items where batch_id = bat;
  insert into pr values ('13nov26 has the 2 lines of order 1001', n = 2, n::text);
  select count(*) into n from public.batch_items where batch_id = bat and product_name = 'Zzfoo Thing - Large' and qty = 2 and notes = 'Order #T1001' and order_name = '#T1001' and shopify_order_id = 1001 and shopify_line_id = 5001;
  insert into pr values ('line name "Title - Variant", quantity, order note and Shopify ids saved', n = 1, n::text);
  select count(*) into n from public.batch_items where batch_id = bat and product_name = 'Basic Tee (PACK OF TWO) - S / Cream' and qty = 2;
  insert into pr values ('pack of two: 1 unit becomes 2 pieces', n = 1, n::text);
  select count(*) into n from public.batch_items where batch_id = bat and product_name = 'Zzfoo Thing - Large' and resolved_category_id = cat1 and matched_rule_id = rule1;
  insert into pr values ('imported line is classified like a pasted one', n = 1, n::text);
  select count(*) into n from public.batch_items where shopify_order_id = 1007 and product_name = 'Zzfoo Thing';
  insert into pr values ('"Default Title" variant is left out of the name', n = 1, n::text);
  select count(*) into n from public.batch_items where shopify_order_id = 1007;
  insert into pr values ('lines with quantity 0 are not imported', n = 1, n::text);
  select count(*) into n from public.batches where workspace_id = ws and lower(ref) = '9nov26';
  select count(*) into n2 from public.batch_items where batch_id = bat or shopify_order_id = 1007;
  insert into pr values ('order tagged 9nov26 goes into the existing 9NOV26 batch (no second batch)', n = 1 and exists (select 1 from public.batch_items i where i.shopify_order_id = 1007 and i.batch_id = (select id from public.batches where workspace_id = ws and lower(ref) = '9nov26')), n::text);
  select count(*) into n from public.batch_items where id = man and status = 'pending' and notes is null and order_name is null and qty = 1 and product_name = 'Pasted line - L';
  insert into pr values ('the hand-made line in that batch is untouched', n = 1, n::text);
  select count(*) into n from public.batches where workspace_id = ws and ref = '7nov26' and source = 'shopify';
  insert into pr values ('"5pcs26" ignored; 7nov26 batch created for order 1008', n = 1, n::text);
  select count(*) into n from public.shopify_order_imports where workspace_id = ws and shopify_order_id in (1003, 1004);
  insert into pr values ('orders without done or without a batch tag are not recorded', n = 0, n::text);
  select count(*) into n from public.shopify_order_imports where workspace_id = ws and ((shopify_order_id = 1001 and status = 'imported') or (shopify_order_id = 1002 and status = 'skipped') or (shopify_order_id in (1005, 1006) and status = 'blocked' and note is not null));
  insert into pr values ('log: imported / skipped / blocked recorded with reasons', n = 4, n::text);

  -- Running it again changes nothing.
  select count(*) into n from public.batch_items where workspace_id = ws;
  r := private.import_feed_orders(ws, base, false);
  select count(*) into n2 from public.batch_items where workspace_id = ws;
  insert into pr values ('second run imports nothing and adds no lines (no duplicates)', (r ->> 'imported_orders')::int = 0 and n = n2, r::text);
  begin
    insert into public.batch_items (workspace_id, batch_id, product_name, qty, shopify_line_id) values (ws, bat, 'Dup', 1, 5001); ok := false;
  exception when unique_violation then ok := true; end;
  insert into pr values ('the same Shopify line cannot be saved twice', ok, '');

  -- Changes in Shopify afterwards are flagged, never applied.
  r := private.import_feed_orders(ws, jsonb_build_array(jsonb_set(base -> 0, '{lines,0,qty}', '3')), false);
  select note into v from public.shopify_order_imports where workspace_id = ws and shopify_order_id = 1001;
  select count(*) into n from public.batch_items where shopify_order_id = 1001 and product_name = 'Zzfoo Thing - Large' and qty = 2;
  insert into pr values ('quantity change in Shopify is flagged, the line is not changed', (r ->> 'flagged')::int = 1 and v like 'Quantity changed%' and n = 1, coalesce(v, ''));
  r := private.import_feed_orders(ws, jsonb_build_array(jsonb_set(base -> 0, '{lines,0,qty}', '3')), false);
  insert into pr values ('the same change is not flagged again', (r ->> 'flagged')::int = 0, r::text);
  r := private.import_feed_orders(ws, jsonb_build_array(jsonb_set(base -> 0, '{cancelled}', 'true')), false);
  select note into v from public.shopify_order_imports where workspace_id = ws and shopify_order_id = 1001;
  select count(*) into n from public.batch_items where shopify_order_id = 1001;
  insert into pr values ('cancelling in Shopify is flagged, lines stay', v like 'Cancelled%' and n = 2, coalesce(v, ''));
  r := private.import_feed_orders(ws, jsonb_build_array(jsonb_set(base -> 0, '{tags}', '["done","20nov26"]')), false);
  select note into v from public.shopify_order_imports where workspace_id = ws and shopify_order_id = 1001;
  insert into pr values ('moving to another batch tag is flagged, nothing moves', v like 'Batch tag changed%' and (select count(*) from public.batch_items where batch_id = bat) = 2, coalesce(v, ''));

  -- A blocked order is retried once it is fixed in Shopify.
  r := private.import_feed_orders(ws, jsonb_build_array(jsonb_set(base -> 4, '{tags}', '["done","13nov26"]')), false);
  select count(*) into n from public.shopify_order_imports where workspace_id = ws and shopify_order_id = 1005 and status = 'imported';
  insert into pr values ('blocked order is imported after the extra tag is removed', n = 1 and (r ->> 'imported_orders')::int = 1, r::text);

  -- Archived batch: blocked, then imported after unarchiving.
  update public.batches set archived_at = now() where workspace_id = ws and ref = '7nov26';
  r := private.import_feed_orders(ws, jsonb_build_array(jsonb_build_object('id', 1009, 'name', '#T1009', 'tags', jsonb_build_array('done', '7nov26'), 'cancelled', false,
        'lines', jsonb_build_array(jsonb_build_object('id', 5020, 'title', 'Late thing', 'variant_title', 'L', 'qty', 1)))), false);
  select note into v from public.shopify_order_imports where workspace_id = ws and shopify_order_id = 1009 and status = 'blocked';
  insert into pr values ('archived batch: order is blocked with a reason, nothing added', v like '%archived%' and (r ->> 'imported_orders')::int = 0, coalesce(v, ''));
  update public.batches set archived_at = null where workspace_id = ws and ref = '7nov26';
  r := private.import_feed_orders(ws, jsonb_build_array(jsonb_build_object('id', 1009, 'name', '#T1009', 'tags', jsonb_build_array('done', '7nov26'), 'cancelled', false,
        'lines', jsonb_build_array(jsonb_build_object('id', 5020, 'title', 'Late thing', 'variant_title', 'L', 'qty', 1)))), false);
  insert into pr values ('after unarchiving, the order is imported', (r ->> 'imported_orders')::int = 1, r::text);

  -- Starting point: records orders without importing them.
  base := jsonb_build_array(jsonb_build_object('id', 2001, 'name', '#T2001', 'tags', jsonb_build_array('done', '20nov26'), 'cancelled', false,
        'lines', jsonb_build_array(jsonb_build_object('id', 6001, 'title', 'Old thing', 'variant_title', 'L', 'qty', 1))));
  r := private.import_feed_orders(ws, base, true);
  select count(*) into n from public.shopify_order_imports where workspace_id = ws and shopify_order_id = 2001 and status = 'baseline';
  insert into pr values ('starting point: order recorded as already handled', n = 1 and (r ->> 'recorded')::int = 1, r::text);
  select count(*) into n from public.batches where workspace_id = ws and ref = '20nov26';
  select count(*) into n2 from public.batch_items where shopify_order_id = 2001;
  insert into pr values ('starting point: no batch and no lines created', n = 0 and n2 = 0, '');
  r := private.import_feed_orders(ws, base, false);
  select count(*) into n from public.batch_items where shopify_order_id = 2001;
  insert into pr values ('an order recorded at the starting point is never imported later', n = 0 and (r ->> 'imported_orders')::int = 0, r::text);

  ------------------------------------------------------------ permissions
  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    perform public.shopify_import_now(ws); ok := false;
  exception when others then ok := sqlerrm like '%not been switched on%'; end;
  insert into pr values ('owner may press the button (stops safely before the starting point is set)', ok, '');
  select count(*) into n from public.shopify_order_imports where workspace_id = ws;
  insert into pr values ('owner can read the import log', n > 0, n::text);
  perform public.shopify_import_dismiss(ws, 1006);
  execute 'reset role';
  select status into v from public.shopify_order_imports where workspace_id = ws and shopify_order_id = 1006;
  insert into pr values ('owner can dismiss a blocked order', v = 'skipped', coalesce(v, ''));

  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  begin
    perform public.shopify_import_now(ws); ok := false;
  exception when others then ok := sqlerrm like '%Not allowed%'; end;
  insert into pr values ('T-shirt supplier cannot press the button', ok, '');
  begin
    perform public.shopify_import_dismiss(ws, 1005); ok := false;
  exception when others then ok := sqlerrm like '%Not allowed%'; end;
  insert into pr values ('T-shirt supplier cannot dismiss', ok, '');
  select count(*) into n from public.shopify_order_imports where workspace_id = ws;
  insert into pr values ('T-shirt supplier cannot read the import log', n = 0, n::text);
  select count(*) into n from public.shopify_import_status where workspace_id = ws;
  insert into pr values ('T-shirt supplier cannot read the import status', n = 0, n::text);
  begin
    perform private.import_feed_orders(ws, '[]'::jsonb, false); ok := false;
  exception when others then ok := true; end;
  insert into pr values ('import internals are not callable from the app', ok, '');
  execute 'reset role';

  execute as_user;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  begin
    perform public.shopify_import_now(ws); ok := false;
  exception when others then ok := sqlerrm like '%Not allowed%'; end;
  insert into pr values ('outsider cannot press the button', ok, '');
  select count(*) into n from public.shopify_order_imports where workspace_id = ws;
  insert into pr values ('outsider cannot read the import log', n = 0, n::text);
  execute 'reset role';

  ------------------------------------------------------------ the other ways of adding lines are unchanged
  insert into public.batch_items (workspace_id, batch_id, product_name, qty) values (ws, bat, 'Another pasted line - M', 1);
  insert into public.batch_items (workspace_id, batch_id, product_name, qty, notes) values (ws, bat, 'CSV style line - M', 2, 'Order #csv1');
  insert into public.batches (workspace_id, ref, batch_date) values (ws, 'HAND-1', '2026-11-14');
  select source into v from public.batches where workspace_id = ws and ref = 'HAND-1';
  insert into pr values ('pasted / CSV lines and hand-made batches still work (source = manual)', v = 'manual', v);
end $$;

-- Everything still has RLS on.
insert into pr select 'RLS on ' || c.relname, c.relrowsecurity, '' from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind = 'r';

select 'SUMMARY' as check_name, bool_and(pass) as pass, count(*) filter (where pass) || ' passed, ' || count(*) filter (where not pass) || ' failed' as detail from pr
union all
(select check_name, pass, detail from pr order by pass, check_name);

rollback;
