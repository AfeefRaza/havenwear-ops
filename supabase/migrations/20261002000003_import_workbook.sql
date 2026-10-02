-- Atomic workbook import: everything in one transaction, or nothing.
-- SECURITY INVOKER: every insert is still checked by the caller's RLS policies.
-- Items arrive pre-classified by the client (same domain logic as the app); names are mapped to ids here.

create or replace function public.import_workbook(p_workspace uuid, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n_cats int := 0; n_rules int := 0; n_batches int := 0; n_items int := 0; n_returns int := 0; n_opening int := 0;
  base_sort int;
  r jsonb;
  rid uuid;
begin
  select coalesce(max(sort_order), 0) into base_sort from public.categories where workspace_id = p_workspace;

  insert into public.categories (workspace_id, name, default_cost_pkr, sort_order)
  select p_workspace, c->>'name', coalesce((c->>'default_cost_pkr')::numeric, 0), base_sort + ord::int
  from jsonb_array_elements(coalesce(p->'categories', '[]')) with ordinality as t(c, ord);
  get diagnostics n_cats = row_count;

  insert into public.keyword_rules (workspace_id, keyword, category_id, cost_override_pkr, supplier, active, notes, sort_order)
  select p_workspace, x->>'keyword', c.id, (x->>'cost_override_pkr')::numeric, x->>'supplier',
         coalesce((x->>'active')::boolean, true), x->>'notes', 1000 + ord::int
  from jsonb_array_elements(coalesce(p->'rules', '[]')) with ordinality as t(x, ord)
  join public.categories c on c.workspace_id = p_workspace and lower(c.name) = lower(x->>'category')
  order by ord;
  get diagnostics n_rules = row_count;

  insert into public.batches (workspace_id, ref, batch_date, supplier, invoice_ref, actual_bill_pkr, payment_status, notes, archived_at)
  select p_workspace, b->>'ref', (b->>'batch_date')::date, b->>'supplier', b->>'invoice_ref',
         (b->>'actual_bill_pkr')::numeric, b->>'payment_status', b->>'notes',
         case when (b->>'archived')::boolean then now() end
  from jsonb_array_elements(coalesce(p->'batches', '[]')) as t(b);
  get diagnostics n_batches = row_count;

  insert into public.batch_items (workspace_id, batch_id, product_name, qty, status, received_from, received_date,
                                  category_override_id, resolved_category_id, matched_rule_id, unit_cost_pkr, notes)
  select p_workspace, bt.id, i->>'product_name', (i->>'qty')::int, i->>'status', i->>'received_from', (i->>'received_date')::date,
         oc.id, rc.id, kr.id, coalesce((i->>'unit_cost_pkr')::numeric, 0), i->>'notes'
  from jsonb_array_elements(coalesce(p->'items', '[]')) with ordinality as t(i, ord)
  join public.batches bt on bt.workspace_id = p_workspace and lower(bt.ref) = lower(i->>'batch_ref')
  left join public.categories oc on oc.workspace_id = p_workspace and lower(oc.name) = lower(i->>'override_category')
  left join public.categories rc on rc.workspace_id = p_workspace and lower(rc.name) = lower(i->>'resolved_category')
  left join lateral (
    select k.id from public.keyword_rules k
    where k.workspace_id = p_workspace and lower(k.keyword) = lower(i->>'rule_keyword') and k.category_id = rc.id
    order by k.created_seq limit 1
  ) kr on true
  order by ord;
  get diagnostics n_items = row_count;

  for r in select * from jsonb_array_elements(coalesce(p->'returns', '[]')) loop
    insert into public.return_receipts (workspace_id, date, reference, notes)
      values (p_workspace, (r->>'date')::date, r->>'reference', r->>'notes') returning id into rid;
    insert into public.return_receipt_lines (workspace_id, receipt_id, category_id, qty)
    select p_workspace, rid, c.id, (l->>'qty')::int
    from jsonb_array_elements(r->'lines') as t(l)
    join public.categories c on c.workspace_id = p_workspace and lower(c.name) = lower(l->>'category');
    n_returns := n_returns + 1;
  end loop;

  insert into public.stock_adjustments (workspace_id, date, category_id, qty, kind, notes)
  select p_workspace, (o->>'date')::date, c.id, (o->>'qty')::int, o->>'kind', o->>'notes'
  from jsonb_array_elements(coalesce(p->'opening', '[]')) as t(o)
  join public.categories c on c.workspace_id = p_workspace and lower(c.name) = lower(o->>'category');
  get diagnostics n_opening = row_count;

  return jsonb_build_object('categories', n_cats, 'rules', n_rules, 'batches', n_batches, 'items', n_items,
                            'returns', n_returns, 'opening', n_opening);
end;
$$;

revoke all on function public.import_workbook(uuid, jsonb) from public, anon;
grant execute on function public.import_workbook(uuid, jsonb) to authenticated;
