-- 1) DTF meterage + cost tracking (rate snapshot per file, cost hidden from suppliers)
-- 2) No-print products never reach the DTF supplier (enforced by RLS + validation)
-- Additive; the previous app keeps working (except "File Ready" now requires meters).

------------------------------------------------------------------------------
-- DTF cost setting (Havenwear owner can change it; suppliers cannot read workspaces)
------------------------------------------------------------------------------
alter table public.workspaces add column if not exists dtf_cost_per_meter numeric(10, 2) not null default 100
  check (dtf_cost_per_meter >= 0 and dtf_cost_per_meter <= 100000);

------------------------------------------------------------------------------
-- Meterage per DTF file (DTF supplier can see its own entries — meters only, no money)
------------------------------------------------------------------------------
create table public.dtf_meterage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null,
  meters numeric(10, 2) not null check (meters > 0 and meters <= 10000),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (run_id, workspace_id) references public.production_runs(id, workspace_id) on delete cascade
);
create index dtf_meterage_run_idx on public.dtf_meterage(run_id, workspace_id);
create index dtf_meterage_ws_created_idx on public.dtf_meterage(workspace_id, created_at desc);

-- Cost snapshot: the rate in force when the file was marked ready. Havenwear only.
create table public.dtf_costs (
  meterage_id uuid primary key,
  workspace_id uuid not null,
  meters numeric(10, 2) not null,
  rate_pkr numeric(10, 2) not null check (rate_pkr >= 0),
  cost_pkr numeric(14, 2) generated always as (round(meters * rate_pkr, 2)) stored,
  created_at timestamptz not null default now(),
  foreign key (meterage_id, workspace_id) references public.dtf_meterage(id, workspace_id) on delete cascade
);
create index dtf_costs_ws_idx on public.dtf_costs(workspace_id);

alter table public.dtf_meterage enable row level security;
alter table public.dtf_costs enable row level security;
revoke all on public.dtf_meterage, public.dtf_costs from anon;
grant select on public.dtf_meterage, public.dtf_costs to authenticated;  -- read only; writes via functions

create policy dtf_meterage_select on public.dtf_meterage for select to authenticated using (
  workspace_id in (select private.my_workspace_ids())
  or workspace_id in (select private.my_supplier_workspace_ids('dtf_supplier'))
);
create policy dtf_costs_select on public.dtf_costs for select to authenticated using (
  workspace_id in (select private.my_workspace_ids())
);

------------------------------------------------------------------------------
-- No-print products are invisible to the DTF supplier
------------------------------------------------------------------------------
drop policy if exists production_items_select on public.production_items;
create policy production_items_select on public.production_items for select to authenticated using (
  workspace_id in (select private.my_workspace_ids())
  or workspace_id in (select private.my_supplier_workspace_ids('tshirt_supplier'))
  or (workspace_id in (select private.my_supplier_workspace_ids('dtf_supplier')) and (front_print or back_print))
);

-- A batch is only a DTF job if it contains at least one product that needs a print.
drop policy if exists production_runs_select on public.production_runs;
create policy production_runs_select on public.production_runs for select to authenticated using (
  workspace_id in (select private.my_workspace_ids())
  or workspace_id in (select private.my_supplier_workspace_ids('tshirt_supplier'))
  or (workspace_id in (select private.my_supplier_workspace_ids('dtf_supplier'))
      and exists (select 1 from public.production_items pi
                  where pi.run_id = production_runs.id and (pi.front_print or pi.back_print) and pi.qty_required > 0))
);

drop policy if exists production_issues_select on public.production_issues;
create policy production_issues_select on public.production_issues for select to authenticated using (
  workspace_id in (select private.my_workspace_ids())
  or workspace_id in (select private.my_supplier_workspace_ids('tshirt_supplier'))
  or (dtf_relevant and workspace_id in (select private.my_supplier_workspace_ids('dtf_supplier'))
      and exists (select 1 from public.production_items pi where pi.id = production_issues.item_id and (pi.front_print or pi.back_print)))
);

------------------------------------------------------------------------------
-- Run summaries: + DTF meters, + whether the batch needs DTF at all (columns appended)
------------------------------------------------------------------------------
create or replace view public.production_run_summaries with (security_invoker = true) as
select r.id, r.workspace_id, r.batch_id, r.batch_ref, r.batch_date, r.dtf_status, r.dtf_ready_at, r.pushed_at,
  coalesce(i.products, 0)::int as products, coalesce(i.required, 0)::int as required, coalesce(i.ready, 0)::int as ready,
  coalesce(i.received, 0)::int as received, coalesce(i.front_prints, 0)::int as front_prints, coalesce(i.back_prints, 0)::int as back_prints,
  coalesce(i.ready_not_received, 0)::int as ready_not_received,
  coalesce(x.front_missing, 0)::int as front_missing, coalesce(x.back_missing, 0)::int as back_missing,
  coalesce(x.complete_missing, 0)::int as complete_missing, coalesce(x.garment_missing, 0)::int as garment_missing,
  coalesce(x.other_issues, 0)::int as other_issues, coalesce(x.reprints_pending, 0)::int as reprints_pending,
  coalesce(x.reprints_ready, 0)::int as reprints_ready, coalesce(x.open_issues, 0)::int as open_issues,
  (coalesce(i.received, 0) >= coalesce(i.required, 0) and coalesce(x.open_issues, 0) = 0) as completed,
  coalesce((select sum(d.meters) from public.dtf_meterage d where d.run_id = r.id), 0)::numeric(10, 2) as dtf_meters,
  (coalesce(i.front_prints, 0) + coalesce(i.back_prints, 0)) > 0 as needs_dtf
from public.production_runs r
left join lateral (
  select count(*) as products, sum(p.qty_required) as required, sum(p.qty_ready) as ready, sum(p.qty_received) as received,
         sum(p.qty_required) filter (where p.front_print) as front_prints, sum(p.qty_required) filter (where p.back_print) as back_prints,
         sum(greatest(p.qty_ready - p.qty_received, 0)) as ready_not_received
  from public.production_items p where p.run_id = r.id) i on true
left join lateral (
  select sum(q.qty) filter (where q.kind = 'front_missing' and q.status <> 'resolved') as front_missing,
    sum(q.qty) filter (where q.kind = 'back_missing' and q.status <> 'resolved') as back_missing,
    sum(q.qty) filter (where q.kind = 'complete_missing' and q.status <> 'resolved') as complete_missing,
    sum(q.qty) filter (where q.kind = 'garment_missing' and q.status <> 'resolved') as garment_missing,
    sum(q.qty) filter (where q.kind in ('wrong_print', 'damaged_print', 'damaged_garment', 'other') and q.status <> 'resolved') as other_issues,
    sum(q.qty) filter (where q.dtf_relevant and q.status = 'open') as reprints_pending,
    sum(q.qty) filter (where q.dtf_relevant and q.status = 'reprint_ready') as reprints_ready,
    count(*) filter (where q.status <> 'resolved') as open_issues
  from public.production_issues q where q.run_id = r.id) x on true;

------------------------------------------------------------------------------
-- File Ready now records meterage (and a cost snapshot). Undo removes the latest file entry.
------------------------------------------------------------------------------
drop function if exists public.production_set_dtf_ready(uuid, boolean);
create or replace function public.production_set_dtf_ready(p_run uuid, p_ready boolean default true, p_meters numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; mid uuid; rate numeric; last_id uuid;
begin
  select * into r from public.production_runs where id = p_run;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform private.require_role(r.workspace_id, array['owner', 'member', 'dtf_supplier']);
  if p_ready then
    if r.dtf_status = 'file_ready' then raise exception 'This file is already marked ready'; end if;
    if p_meters is null or p_meters <= 0 or p_meters > 10000 then
      raise exception 'Enter the DTF meterage used for this file (for example 10.2)';
    end if;
    if not exists (select 1 from public.production_items pi where pi.run_id = p_run and (pi.front_print or pi.back_print) and pi.qty_required > 0) then
      raise exception 'This batch has no products that need a DTF print';
    end if;
    insert into public.dtf_meterage (workspace_id, run_id, meters, created_by)
      values (r.workspace_id, p_run, round(p_meters, 2), (select auth.uid())) returning id into mid;
    select dtf_cost_per_meter into rate from public.workspaces where id = r.workspace_id;
    insert into public.dtf_costs (meterage_id, workspace_id, meters, rate_pkr) values (mid, r.workspace_id, round(p_meters, 2), rate);
    update public.production_runs set dtf_status = 'file_ready', dtf_ready_at = now() where id = p_run;
    perform private.log_event(r.workspace_id, p_run, null, null, 'dtf_file_ready', null, round(p_meters, 2)::text || ' m');
  else
    select id into last_id from public.dtf_meterage where run_id = p_run order by created_at desc limit 1;
    if last_id is not null and r.dtf_status = 'file_ready' then delete from public.dtf_meterage where id = last_id; end if;
    update public.production_runs set dtf_status = 'waiting', dtf_ready_at = null where id = p_run;
    perform private.log_event(r.workspace_id, p_run, null, null, 'dtf_file_unready', null, null);
  end if;
end; $$;

------------------------------------------------------------------------------
-- Push: only reset "File ready" when the newly pushed products actually need a print.
------------------------------------------------------------------------------
create or replace function public.production_push(p_batch uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ws uuid; b record; run uuid; l jsonb; bi record; pid uuid; n_lines int := 0; n_pieces int := 0; n_print int := 0;
        was_ready boolean; img text; img2 text; f boolean; bk boolean;
begin
  select * into b from public.batches where id = p_batch;
  if not found then raise exception 'Batch not found' using errcode = 'P0002'; end if;
  ws := b.workspace_id;
  perform private.require_role(ws, array['owner', 'member']);
  if b.archived_at is not null then raise exception 'Batch is archived'; end if;
  insert into public.production_runs (workspace_id, batch_id, batch_ref, batch_date) values (ws, b.id, b.ref, b.batch_date)
  on conflict (batch_id) do update set batch_ref = excluded.batch_ref, batch_date = excluded.batch_date
  returning id, (dtf_status = 'file_ready') into run, was_ready;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    select * into bi from public.batch_items
     where id = (l->>'batch_item_id')::uuid and batch_id = b.id and workspace_id = ws
       and status = 'pending' and supplier_planned and production_item_id is null for update;
    if not found then continue; end if;
    img := l->>'image_url';
    if img is not null and img !~ '^https://cdn\.shopify\.com/' then img := null; end if;
    img2 := l->>'image2_url';
    if img2 is not null and img2 !~ '^https://cdn\.shopify\.com/' then img2 := null; end if;
    f := coalesce((l->>'front_print')::boolean, true);
    bk := coalesce((l->>'back_print')::boolean, true);
    insert into public.production_items (workspace_id, run_id, item_key, product_title, variant_title, size, color, image_url, image2_url,
                                         shopify_product_id, shopify_variant_id, front_print, back_print, category_id, qty_required)
    values (ws, run, left(l->>'item_key', 300), left(coalesce(l->>'product_title', bi.product_name), 300), left(l->>'variant_title', 200),
            left(l->>'size', 100), left(l->>'color', 100), img, img2, (l->>'shopify_product_id')::bigint, (l->>'shopify_variant_id')::bigint,
            f, bk, bi.resolved_category_id, 0)
    on conflict (run_id, item_key) do update set updated_at = now()
    returning id into pid;
    update public.batch_items set production_item_id = pid where id = bi.id;
    perform private.log_event(ws, run, pid, null, 'item_allocated', bi.qty, bi.product_name);
    n_lines := n_lines + 1; n_pieces := n_pieces + bi.qty;
    if f or bk then n_print := n_print + 1; end if;
  end loop;
  if n_lines > 0 then
    perform private.log_event(ws, run, null, null, 'batch_pushed', n_pieces, n_lines || ' lines pushed to production');
    if was_ready and n_print > 0 then
      update public.production_runs set dtf_status = 'waiting', dtf_ready_at = null where id = run;
      perform private.log_event(ws, run, null, null, 'dtf_reset', null, 'New printed products added after DTF file was ready');
    end if;
  end if;
  return jsonb_build_object('run_id', run, 'lines', n_lines, 'pieces', n_pieces);
end; $$;

------------------------------------------------------------------------------
-- Print problems only make sense for sides that are actually printed.
------------------------------------------------------------------------------
create or replace function public.production_report_issue(p_item uuid, p_kind text, p_qty int, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare it record; iid uuid;
begin
  select * into it from public.production_items where id = p_item;
  if it is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform private.require_role(it.workspace_id, array['owner', 'member', 'tshirt_supplier']);
  if p_qty is null or p_qty < 1 or p_qty > greatest(it.qty_required, 1) then raise exception 'Quantity must be between 1 and %', it.qty_required; end if;
  if p_kind = 'front_missing' and not it.front_print then raise exception 'This product has no front print'; end if;
  if p_kind = 'back_missing' and not it.back_print then raise exception 'This product has no back print'; end if;
  if p_kind in ('complete_missing', 'wrong_print', 'damaged_print') and not (it.front_print or it.back_print) then
    raise exception 'This product has no print';
  end if;
  insert into public.production_issues (workspace_id, run_id, item_id, kind, qty, note, created_by)
  values (it.workspace_id, it.run_id, p_item, p_kind, p_qty, nullif(left(trim(coalesce(p_note, '')), 500), ''), (select auth.uid()))
  returning id into iid;
  perform private.log_event(it.workspace_id, it.run_id, p_item, iid, 'issue_reported', p_qty, p_kind);
  return iid;
end; $$;

------------------------------------------------------------------------------
-- Changing a product's print setting also updates its not-yet-received production items.
------------------------------------------------------------------------------
create or replace function public.set_print_config(p_workspace uuid, p_product bigint, p_front boolean, p_back boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare n int := 0; it record;
begin
  perform private.require_role(p_workspace, array['owner', 'member']);
  update public.shopify_products set front_print = p_front, back_print = p_back, print_confirmed = true
   where workspace_id = p_workspace and product_id = p_product;
  for it in
    select pi.id, pi.run_id, pi.front_print, pi.back_print, pi.product_title from public.production_items pi
     where pi.workspace_id = p_workspace and pi.shopify_product_id = p_product and pi.qty_received < pi.qty_required
       and (pi.front_print is distinct from p_front or pi.back_print is distinct from p_back)
  loop
    update public.production_items set front_print = p_front, back_print = p_back where id = it.id;
    perform private.log_event(p_workspace, it.run_id, it.id, null, 'print_config_changed', null,
      case when p_front and p_back then 'Front + Back' when p_front then 'Front only' when p_back then 'Back only' else 'No print' end);
    -- A newly required print side means the DTF file must be redone.
    if (p_front and not it.front_print) or (p_back and not it.back_print) then
      update public.production_runs set dtf_status = 'waiting', dtf_ready_at = null where id = it.run_id and dtf_status = 'file_ready';
      if found then perform private.log_event(p_workspace, it.run_id, null, null, 'dtf_reset', null, 'Print added to ' || it.product_title); end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end; $$;

------------------------------------------------------------------------------
-- DTF analytics for the Havenwear dashboard (security invoker: costs only visible to Havenwear)
------------------------------------------------------------------------------
create or replace function public.dtf_analytics(p_workspace uuid, p_today date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with m as (
    select d.id, d.run_id, d.meters, d.created_at, (d.created_at at time zone 'Asia/Karachi')::date as day,
           c.rate_pkr, coalesce(c.cost_pkr, 0) as cost
    from public.dtf_meterage d left join public.dtf_costs c on c.meterage_id = d.id
    where d.workspace_id = p_workspace
  ),
  printed as (
    select coalesce(sum(pi.qty_required) filter (where pi.front_print or pi.back_print), 0) as pieces,
           coalesce(sum(pi.qty_required) filter (where pi.front_print), 0) + coalesce(sum(pi.qty_required) filter (where pi.back_print), 0) as prints
    from public.production_items pi where pi.run_id in (select distinct run_id from m)
  )
  select jsonb_build_object(
    'rate', (select w.dtf_cost_per_meter from public.workspaces w where w.id = p_workspace),
    'total', (select jsonb_build_object('meters', coalesce(sum(meters), 0), 'cost', coalesce(sum(cost), 0), 'files', count(*), 'batches', count(distinct run_id)) from m),
    'today', (select jsonb_build_object('meters', coalesce(sum(meters), 0), 'cost', coalesce(sum(cost), 0)) from m where day = p_today),
    'week', (select jsonb_build_object('meters', coalesce(sum(meters), 0), 'cost', coalesce(sum(cost), 0)) from m where day >= date_trunc('week', p_today::timestamp)::date),
    'month', (select jsonb_build_object('meters', coalesce(sum(meters), 0), 'cost', coalesce(sum(cost), 0)) from m where day >= date_trunc('month', p_today::timestamp)::date),
    'printed', (select jsonb_build_object('pieces', pieces, 'prints', prints) from printed),
    'by_batch', (select coalesce(jsonb_agg(jsonb_build_object('run_id', x.run_id, 'batch_ref', x.batch_ref, 'batch_date', x.batch_date,
                   'meters', x.meters, 'cost', x.cost, 'rate', x.rate, 'files', x.files, 'last', x.last) order by x.last desc), '[]'::jsonb)
                 from (select r.id as run_id, r.batch_ref, r.batch_date, sum(m.meters) as meters, sum(m.cost) as cost,
                              max(m.rate_pkr) as rate, count(*) as files, max(m.created_at) as last
                       from m join public.production_runs r on r.id = m.run_id group by r.id, r.batch_ref, r.batch_date
                       order by max(m.created_at) desc limit 60) x),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', g.day::date, 'meters', coalesce(s.meters, 0), 'cost', coalesce(s.cost, 0)) order by g.day), '[]'::jsonb)
              from generate_series(p_today - 29, p_today, interval '1 day') g(day)
              left join (select day, sum(meters) as meters, sum(cost) as cost from m group by day) s on s.day = g.day::date),
    'rates', (select coalesce(jsonb_agg(distinct rate_pkr), '[]'::jsonb) from m where rate_pkr is not null)
  );
$$;

do $$ declare f text; begin
  foreach f in array array['production_set_dtf_ready(uuid, boolean, numeric)', 'production_push(uuid, jsonb)',
    'production_report_issue(uuid, text, integer, text)', 'set_print_config(uuid, bigint, boolean, boolean)', 'dtf_analytics(uuid, date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop; end; $$;
