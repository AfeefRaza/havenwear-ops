-- Supplier production workflow: T-shirt supplier + DTF supplier portals.
--
-- Backward compatible: the existing app keeps working unchanged against this schema.
-- Security model:
--   * Internal roles (owner, member) keep full access to everything, as before.
--   * Supplier roles (tshirt_supplier, dtf_supplier) can ONLY read the production tables
--     (no costs, bills, stock, settings). DTF only sees print-related problems.
--   * Suppliers have NO direct write privileges. Every state change goes through
--     SECURITY DEFINER functions that check the caller's role and log history.

------------------------------------------------------------------------------
-- Roles
------------------------------------------------------------------------------
alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'member', 'tshirt_supplier', 'dtf_supplier'));

-- IMPORTANT: every existing RLS policy uses this function. Restricting it to internal roles
-- is what keeps suppliers out of batches, costs, stock, rules, returns, deliveries, settings.
create or replace function private.my_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = (select auth.uid()) and m.role in ('owner', 'member');
$$;

create or replace function private.my_supplier_workspace_ids(p_role text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = (select auth.uid()) and m.role = p_role;
$$;
revoke all on function private.my_supplier_workspace_ids(text) from public, anon;
grant execute on function private.my_supplier_workspace_ids(text) to authenticated;

-- Role of the current user in a workspace (null if not a member).
create or replace function private.my_role(p_workspace uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.workspace_members m
  where m.workspace_id = p_workspace and m.user_id = (select auth.uid());
$$;
revoke all on function private.my_role(uuid) from public, anon, authenticated;

-- Everyone may read their OWN membership row (the app needs it to pick the right portal).
create policy members_select_own on public.workspace_members
  for select to authenticated using (user_id = (select auth.uid()));

------------------------------------------------------------------------------
-- Shopify catalogue (internal only) — synced from the store's public products feed
------------------------------------------------------------------------------
create table public.shopify_products (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id bigint not null,
  handle text not null,
  title text not null,
  product_type text,
  image_url text check (image_url is null or image_url ~ '^https://cdn\.shopify\.com/'),
  front_print boolean not null default true,
  back_print boolean not null default true,
  print_confirmed boolean not null default false,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, product_id)
);

create table public.shopify_variants (
  workspace_id uuid not null,
  variant_id bigint not null,
  product_id bigint not null,
  title text not null,
  size text,
  color text,
  image_url text check (image_url is null or image_url ~ '^https://cdn\.shopify\.com/'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, variant_id),
  foreign key (workspace_id, product_id) references public.shopify_products(workspace_id, product_id) on delete cascade
);
create index shopify_variants_product_idx on public.shopify_variants(workspace_id, product_id);

------------------------------------------------------------------------------
-- Batch items: allocation to supplier + link to the production line they were pushed into
------------------------------------------------------------------------------
alter table public.batch_items add column if not exists supplier_planned boolean not null default false;
alter table public.batch_items add column if not exists production_item_id uuid;

------------------------------------------------------------------------------
-- Production tables
------------------------------------------------------------------------------
create table public.production_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid not null unique,
  batch_ref text not null,
  batch_date date not null,
  dtf_status text not null default 'waiting' check (dtf_status in ('waiting', 'file_ready')),
  dtf_ready_at timestamptz,
  pushed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (batch_id, workspace_id) references public.batches(id, workspace_id) on delete cascade
);
create index production_runs_ws_idx on public.production_runs(workspace_id, pushed_at desc);

create table public.production_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null,
  item_key text not null,
  product_title text not null,
  variant_title text,
  size text,
  color text,
  image_url text check (image_url is null or image_url ~ '^https://cdn\.shopify\.com/'),
  shopify_product_id bigint,
  shopify_variant_id bigint,
  front_print boolean not null default true,
  back_print boolean not null default true,
  category_id uuid,
  qty_required integer not null default 0 check (qty_required >= 0),
  qty_ready integer not null default 0 check (qty_ready >= 0),
  qty_received integer not null default 0 check (qty_received >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, item_key),
  unique (id, workspace_id),
  constraint ready_le_required check (qty_ready <= qty_required),
  constraint received_le_required check (qty_received <= qty_required),
  foreign key (run_id, workspace_id) references public.production_runs(id, workspace_id) on delete cascade,
  foreign key (category_id, workspace_id) references public.categories(id, workspace_id) on delete set null (category_id)
);
create index production_items_run_idx on public.production_items(run_id, workspace_id);
create index production_items_ws_idx on public.production_items(workspace_id);
create index production_items_category_idx on public.production_items(category_id, workspace_id);

alter table public.batch_items
  add constraint batch_items_production_item_fkey
  foreign key (production_item_id, workspace_id) references public.production_items(id, workspace_id)
  on delete set null (production_item_id);
create index batch_items_production_item_idx on public.batch_items(production_item_id, workspace_id);

create table public.production_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null,
  item_id uuid not null,
  kind text not null check (kind in ('front_missing', 'back_missing', 'complete_missing', 'garment_missing',
                                     'wrong_print', 'damaged_print', 'damaged_garment', 'other')),
  qty integer not null check (qty > 0),
  note text check (note is null or length(note) <= 500),
  -- Print problems go to the DTF supplier; garment problems stay between Havenwear and the T-shirt supplier.
  dtf_relevant boolean generated always as (kind in ('front_missing', 'back_missing', 'complete_missing', 'wrong_print', 'damaged_print')) stored,
  status text not null default 'open' check (status in ('open', 'reprint_ready', 'resolved')),
  created_by uuid,
  reprint_ready_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (run_id, workspace_id) references public.production_runs(id, workspace_id) on delete cascade,
  foreign key (item_id, workspace_id) references public.production_items(id, workspace_id) on delete cascade
);
create index production_issues_run_idx on public.production_issues(run_id, workspace_id);
create index production_issues_item_idx on public.production_issues(item_id, workspace_id);
create index production_issues_ws_status_idx on public.production_issues(workspace_id, status);

create table public.production_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null,
  item_id uuid,
  issue_id uuid,
  kind text not null,
  qty integer,
  detail text,
  actor uuid,
  actor_role text,
  created_at timestamptz not null default now(),
  foreign key (run_id, workspace_id) references public.production_runs(id, workspace_id) on delete cascade
);
create index production_events_run_idx on public.production_events(run_id, workspace_id, created_at);
create index production_events_ws_idx on public.production_events(workspace_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['shopify_products', 'shopify_variants', 'production_runs', 'production_items', 'production_issues'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
  end loop;
end;
$$;

------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------
alter table public.shopify_products enable row level security;
alter table public.shopify_variants enable row level security;
alter table public.production_runs enable row level security;
alter table public.production_items enable row level security;
alter table public.production_issues enable row level security;
alter table public.production_events enable row level security;

revoke all on public.shopify_products, public.shopify_variants, public.production_runs,
              public.production_items, public.production_issues, public.production_events from anon;

-- Catalogue: internal only, full CRUD (the app syncs it from the public feed).
do $$
declare t text;
begin
  foreach t in array array['shopify_products', 'shopify_variants'] loop
    execute format('create policy %I on public.%I for select to authenticated using (workspace_id in (select private.my_workspace_ids()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (workspace_id in (select private.my_workspace_ids()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (workspace_id in (select private.my_workspace_ids())) with check (workspace_id in (select private.my_workspace_ids()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (workspace_id in (select private.my_workspace_ids()))', t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Production: read-only for everyone involved; writes only via the functions below.
grant select on public.production_runs, public.production_items, public.production_issues, public.production_events to authenticated;

create policy production_runs_select on public.production_runs for select to authenticated using (
  workspace_id in (select private.my_workspace_ids())
  or workspace_id in (select private.my_supplier_workspace_ids('tshirt_supplier'))
  or workspace_id in (select private.my_supplier_workspace_ids('dtf_supplier'))
);
create policy production_items_select on public.production_items for select to authenticated using (
  workspace_id in (select private.my_workspace_ids())
  or workspace_id in (select private.my_supplier_workspace_ids('tshirt_supplier'))
  or workspace_id in (select private.my_supplier_workspace_ids('dtf_supplier'))
);
create policy production_issues_select on public.production_issues for select to authenticated using (
  workspace_id in (select private.my_workspace_ids())
  or workspace_id in (select private.my_supplier_workspace_ids('tshirt_supplier'))
  or (dtf_relevant and workspace_id in (select private.my_supplier_workspace_ids('dtf_supplier')))
);
-- Full history: Havenwear only.
create policy production_events_select on public.production_events for select to authenticated using (
  workspace_id in (select private.my_workspace_ids())
);

------------------------------------------------------------------------------
-- Run summaries (security_invoker → each role sees only what its policies allow)
------------------------------------------------------------------------------
create view public.production_run_summaries with (security_invoker = true) as
select
  r.id, r.workspace_id, r.batch_id, r.batch_ref, r.batch_date, r.dtf_status, r.dtf_ready_at, r.pushed_at,
  coalesce(i.products, 0)::int as products,
  coalesce(i.required, 0)::int as required,
  coalesce(i.ready, 0)::int as ready,
  coalesce(i.received, 0)::int as received,
  coalesce(i.front_prints, 0)::int as front_prints,
  coalesce(i.back_prints, 0)::int as back_prints,
  coalesce(i.ready_not_received, 0)::int as ready_not_received,
  coalesce(x.front_missing, 0)::int as front_missing,
  coalesce(x.back_missing, 0)::int as back_missing,
  coalesce(x.complete_missing, 0)::int as complete_missing,
  coalesce(x.garment_missing, 0)::int as garment_missing,
  coalesce(x.other_issues, 0)::int as other_issues,
  coalesce(x.reprints_pending, 0)::int as reprints_pending,
  coalesce(x.reprints_ready, 0)::int as reprints_ready,
  coalesce(x.open_issues, 0)::int as open_issues,
  (coalesce(i.received, 0) >= coalesce(i.required, 0) and coalesce(x.open_issues, 0) = 0) as completed
from public.production_runs r
left join lateral (
  select count(*) as products, sum(p.qty_required) as required, sum(p.qty_ready) as ready, sum(p.qty_received) as received,
         sum(p.qty_required) filter (where p.front_print) as front_prints,
         sum(p.qty_required) filter (where p.back_print) as back_prints,
         sum(greatest(p.qty_ready - p.qty_received, 0)) as ready_not_received
  from public.production_items p where p.run_id = r.id
) i on true
left join lateral (
  select
    sum(q.qty) filter (where q.kind = 'front_missing' and q.status <> 'resolved') as front_missing,
    sum(q.qty) filter (where q.kind = 'back_missing' and q.status <> 'resolved') as back_missing,
    sum(q.qty) filter (where q.kind = 'complete_missing' and q.status <> 'resolved') as complete_missing,
    sum(q.qty) filter (where q.kind = 'garment_missing' and q.status <> 'resolved') as garment_missing,
    sum(q.qty) filter (where q.kind in ('wrong_print', 'damaged_print', 'damaged_garment', 'other') and q.status <> 'resolved') as other_issues,
    sum(q.qty) filter (where q.dtf_relevant and q.status = 'open') as reprints_pending,
    sum(q.qty) filter (where q.dtf_relevant and q.status = 'reprint_ready') as reprints_ready,
    count(*) filter (where q.status <> 'resolved') as open_issues
  from public.production_issues q where q.run_id = r.id
) x on true;

revoke all on public.production_run_summaries from anon;
grant select on public.production_run_summaries to authenticated;

------------------------------------------------------------------------------
-- History helper
------------------------------------------------------------------------------
create or replace function private.log_event(p_ws uuid, p_run uuid, p_item uuid, p_issue uuid, p_kind text, p_qty int, p_detail text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.production_events (workspace_id, run_id, item_id, issue_id, kind, qty, detail, actor, actor_role)
  values (p_ws, p_run, p_item, p_issue, p_kind, p_qty, p_detail, (select auth.uid()), private.my_role(p_ws));
$$;
revoke all on function private.log_event(uuid, uuid, uuid, uuid, text, int, text) from public, anon, authenticated;

create or replace function private.require_role(p_ws uuid, p_roles text[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare r text := private.my_role(p_ws);
begin
  if r is null or not (r = any (p_roles)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return r;
end;
$$;
revoke all on function private.require_role(uuid, text[]) from public, anon, authenticated;

------------------------------------------------------------------------------
-- Keep batch lines in step with production (received pieces → batch lines received)
------------------------------------------------------------------------------
create or replace function private.sync_batch_lines(p_item uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  covered int;
  l record;
  today date := (now() at time zone 'Asia/Karachi')::date;
begin
  select qty_received into covered from public.production_items where id = p_item;
  for l in
    select id, qty, status, received_from from public.batch_items
    where production_item_id = p_item and status <> 'cancelled'
    order by created_at, id
  loop
    if covered >= l.qty then
      covered := covered - l.qty;
      if l.status = 'pending' then
        update public.batch_items set status = 'received', received_from = 'supplier', received_date = today where id = l.id;
      end if;
    elsif l.status = 'received' and l.received_from = 'supplier' then
      update public.batch_items set status = 'pending', received_from = null, received_date = null where id = l.id;
    end if;
  end loop;
end;
$$;
revoke all on function private.sync_batch_lines(uuid) from public, anon, authenticated;

-- If a pushed batch line is cancelled / un-cancelled / re-quantified / deleted, adjust what production must make.
create or replace function private.batch_item_production_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_need int := 0; new_need int := 0; pid uuid; delta int; pi record; linking boolean;
begin
  -- Unlinking only happens via ON DELETE SET NULL when production rows are removed: nothing to adjust.
  if tg_op = 'UPDATE' and old.production_item_id is not null and new.production_item_id is null then return new; end if;
  if tg_op in ('UPDATE', 'DELETE') and old.production_item_id is not null and old.status <> 'cancelled' then old_need := old.qty; end if;
  if tg_op = 'UPDATE' and new.production_item_id is not null and new.status <> 'cancelled' then new_need := new.qty; end if;
  pid := coalesce(case when tg_op = 'UPDATE' then new.production_item_id end, old.production_item_id);
  delta := new_need - old_need;
  if pid is null or delta = 0 then return coalesce(new, old); end if;

  -- Skip when the production run or the batch itself is being deleted (cascade).
  select pi2.id, pi2.workspace_id, pi2.run_id, pi2.product_title into pi
    from public.production_items pi2 join public.production_runs r on r.id = pi2.run_id
   where pi2.id = pid and exists (select 1 from public.batches bb where bb.id = r.batch_id);
  if not found then return coalesce(new, old); end if;

  update public.production_items
     set qty_required = greatest(qty_required + delta, 0),
         qty_ready = least(qty_ready, greatest(qty_required + delta, 0)),
         qty_received = least(qty_received, greatest(qty_required + delta, 0))
   where id = pid;

  -- Linking a line during push is logged by production_push itself; log only later changes.
  linking := tg_op = 'UPDATE' and old.production_item_id is distinct from new.production_item_id;
  if not linking then
    perform private.log_event(pi.workspace_id, pi.run_id, pid, null, 'required_changed', delta,
      case when delta < 0 then 'Batch line cancelled, reduced or removed' else 'Batch line re-added or increased' end);
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.batch_item_production_change() from public, anon, authenticated;

create trigger production_sync after update of status, qty, production_item_id or delete on public.batch_items
  for each row execute function private.batch_item_production_change();

------------------------------------------------------------------------------
-- Actions (RPCs)
------------------------------------------------------------------------------

-- Havenwear: push supplier-allocated pending lines of a batch into production.
-- p_lines: [{batch_item_id, item_key, product_title, variant_title, size, color, image_url,
--            shopify_product_id, shopify_variant_id, front_print, back_print}]
create or replace function public.production_push(p_batch uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid; b record; run uuid; l jsonb; bi record; pid uuid;
  n_lines int := 0; n_pieces int := 0; was_ready boolean;
  img text;
begin
  select * into b from public.batches where id = p_batch;
  if not found then raise exception 'Batch not found' using errcode = 'P0002'; end if;
  ws := b.workspace_id;
  perform private.require_role(ws, array['owner', 'member']);
  if b.archived_at is not null then raise exception 'Batch is archived'; end if;

  insert into public.production_runs (workspace_id, batch_id, batch_ref, batch_date)
  values (ws, b.id, b.ref, b.batch_date)
  on conflict (batch_id) do update set batch_ref = excluded.batch_ref, batch_date = excluded.batch_date
  returning id, (dtf_status = 'file_ready') into run, was_ready;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    select * into bi from public.batch_items
     where id = (l->>'batch_item_id')::uuid and batch_id = b.id and workspace_id = ws
       and status = 'pending' and supplier_planned and production_item_id is null
     for update;
    if not found then continue; end if;

    img := l->>'image_url';
    if img is not null and img !~ '^https://cdn\.shopify\.com/' then img := null; end if;

    insert into public.production_items (workspace_id, run_id, item_key, product_title, variant_title, size, color, image_url,
                                         shopify_product_id, shopify_variant_id, front_print, back_print, category_id, qty_required)
    values (ws, run, left(l->>'item_key', 300), left(coalesce(l->>'product_title', bi.product_name), 300), left(l->>'variant_title', 200),
            left(l->>'size', 100), left(l->>'color', 100), img,
            (l->>'shopify_product_id')::bigint, (l->>'shopify_variant_id')::bigint,
            coalesce((l->>'front_print')::boolean, true), coalesce((l->>'back_print')::boolean, true),
            bi.resolved_category_id, 0)
    on conflict (run_id, item_key) do update set updated_at = now()
    returning id into pid;

    -- Linking the line adds its quantity to qty_required (via the production_sync trigger).
    update public.batch_items set production_item_id = pid where id = bi.id;

    perform private.log_event(ws, run, pid, null, 'item_allocated', bi.qty, bi.product_name);
    n_lines := n_lines + 1;
    n_pieces := n_pieces + bi.qty;
  end loop;

  if n_lines > 0 then
    perform private.log_event(ws, run, null, null, 'batch_pushed', n_pieces, n_lines || ' lines pushed to production');
    if was_ready then
      update public.production_runs set dtf_status = 'waiting', dtf_ready_at = null where id = run;
      perform private.log_event(ws, run, null, null, 'dtf_reset', null, 'New products added after DTF file was ready');
    end if;
  end if;

  return jsonb_build_object('run_id', run, 'lines', n_lines, 'pieces', n_pieces);
end;
$$;

-- DTF supplier (or Havenwear): DTF file ready / not ready for a batch.
create or replace function public.production_set_dtf_ready(p_run uuid, p_ready boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare ws uuid;
begin
  select workspace_id into ws from public.production_runs where id = p_run;
  if ws is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform private.require_role(ws, array['owner', 'member', 'dtf_supplier']);
  update public.production_runs
     set dtf_status = case when p_ready then 'file_ready' else 'waiting' end,
         dtf_ready_at = case when p_ready then now() end
   where id = p_run;
  perform private.log_event(ws, p_run, null, null, case when p_ready then 'dtf_file_ready' else 'dtf_file_unready' end, null, null);
end;
$$;

-- T-shirt supplier (or Havenwear): mark pieces ready (negative delta = undo).
create or replace function public.production_mark_ready(p_item uuid, p_delta int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare it record; newv int;
begin
  select * into it from public.production_items where id = p_item;
  if it is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform private.require_role(it.workspace_id, array['owner', 'member', 'tshirt_supplier']);
  if p_delta = 0 then return it.qty_ready; end if;
  update public.production_items set qty_ready = qty_ready + p_delta
   where id = p_item and qty_ready + p_delta between 0 and qty_required
   returning qty_ready into newv;
  if newv is null then raise exception 'Ready quantity must be between 0 and the required quantity'; end if;
  perform private.log_event(it.workspace_id, it.run_id, p_item, null, case when p_delta > 0 then 'marked_ready' else 'ready_undone' end, p_delta, it.product_title);
  return newv;
end;
$$;

-- Havenwear: mark pieces physically received (negative delta = correction). Syncs batch lines.
create or replace function public.production_receive(p_item uuid, p_delta int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare it record; newv int;
begin
  select * into it from public.production_items where id = p_item;
  if it is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform private.require_role(it.workspace_id, array['owner', 'member']);
  if p_delta = 0 then return it.qty_received; end if;
  update public.production_items set qty_received = qty_received + p_delta
   where id = p_item and qty_received + p_delta between 0 and qty_required
   returning qty_received into newv;
  if newv is null then raise exception 'Received quantity must be between 0 and the required quantity'; end if;
  perform private.sync_batch_lines(p_item);
  perform private.log_event(it.workspace_id, it.run_id, p_item, null, case when p_delta > 0 then 'received' else 'receive_undone' end, p_delta, it.product_title);
  return newv;
end;
$$;

-- T-shirt supplier (or Havenwear): report a problem.
create or replace function public.production_report_issue(p_item uuid, p_kind text, p_qty int, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare it record; iid uuid;
begin
  select * into it from public.production_items where id = p_item;
  if it is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform private.require_role(it.workspace_id, array['owner', 'member', 'tshirt_supplier']);
  if p_qty is null or p_qty < 1 or p_qty > greatest(it.qty_required, 1) then
    raise exception 'Quantity must be between 1 and %', it.qty_required;
  end if;
  insert into public.production_issues (workspace_id, run_id, item_id, kind, qty, note, created_by)
  values (it.workspace_id, it.run_id, p_item, p_kind, p_qty, nullif(left(trim(coalesce(p_note, '')), 500), ''), (select auth.uid()))
  returning id into iid;
  perform private.log_event(it.workspace_id, it.run_id, p_item, iid, 'issue_reported', p_qty, p_kind);
  return iid;
end;
$$;

-- DTF supplier (or Havenwear): reprint done for a print problem.
create or replace function public.production_reprint_ready(p_issue uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare q record;
begin
  select * into q from public.production_issues where id = p_issue;
  if q is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform private.require_role(q.workspace_id, array['owner', 'member', 'dtf_supplier']);
  if not q.dtf_relevant then raise exception 'This is not a print problem'; end if;
  if q.status <> 'open' then raise exception 'This reprint is already marked'; end if;
  update public.production_issues set status = 'reprint_ready', reprint_ready_at = now() where id = p_issue;
  perform private.log_event(q.workspace_id, q.run_id, q.item_id, p_issue, 'reprint_ready', q.qty, q.kind);
end;
$$;

-- T-shirt supplier (or Havenwear): problem solved / reprint used.
create or replace function public.production_resolve_issue(p_issue uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare q record;
begin
  select * into q from public.production_issues where id = p_issue;
  if q is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform private.require_role(q.workspace_id, array['owner', 'member', 'tshirt_supplier']);
  if q.status = 'resolved' then return; end if;
  update public.production_issues set status = 'resolved', resolved_at = now() where id = p_issue;
  perform private.log_event(q.workspace_id, q.run_id, q.item_id, p_issue, 'issue_resolved', q.qty, q.kind);
end;
$$;

-- Havenwear: allocate / un-allocate pending batch lines to the supplier (logged once pushed).
create or replace function public.set_supplier_planned(p_items uuid[], p_planned boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int; ws uuid;
begin
  select workspace_id into ws from public.batch_items where id = p_items[1];
  if ws is null then return 0; end if;
  perform private.require_role(ws, array['owner', 'member']);
  update public.batch_items set supplier_planned = p_planned
   where id = any (p_items) and workspace_id = ws and status = 'pending'
     and (p_planned or production_item_id is null);
  get diagnostics n = row_count;
  return n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'production_push(uuid, jsonb)', 'production_set_dtf_ready(uuid, boolean)', 'production_mark_ready(uuid, integer)',
    'production_receive(uuid, integer)', 'production_report_issue(uuid, text, integer, text)',
    'production_reprint_ready(uuid)', 'production_resolve_issue(uuid)', 'set_supplier_planned(uuid[], boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

------------------------------------------------------------------------------
-- Stock & batch summaries: pieces received through production count as supplier-delivered stock
------------------------------------------------------------------------------
create or replace view public.batch_summaries with (security_invoker = true) as
select
  b.id, b.workspace_id, b.ref, b.batch_date, b.supplier, b.invoice_ref, b.actual_bill_pkr,
  b.payment_status, b.notes, b.archived_at, b.created_at, b.updated_at,
  coalesce(s.lines, 0)::int as lines,
  coalesce(s.pending_lines, 0)::int as pending_lines,
  coalesce(s.cancelled_lines, 0)::int as cancelled_lines,
  coalesce(s.unmatched_lines, 0)::int as unmatched_lines,
  coalesce(s.required, 0)::int as required,
  coalesce(s.pending_pieces, 0)::int as pending_pieces,
  coalesce(s.from_returns, 0)::int as from_returns,
  coalesce(s.from_supplier, 0)::int as from_supplier,
  coalesce(s.est_supplier_cost, 0)::numeric(14, 2) as est_supplier_cost,
  s.last_item_change,
  case
    when b.archived_at is not null then 'archived'
    when coalesce(s.lines, 0) = 0 then 'empty'
    when coalesce(s.pending_lines, 0) > 0 then 'in_progress'
    else 'complete'
  end as stage,
  (coalesce((
    select sum(l.qty) from public.supplier_delivery_lines l
    join public.supplier_deliveries d on d.id = l.delivery_id
    where d.batch_id = b.id
  ), 0) + coalesce((
    select sum(pi.qty_received) from public.production_items pi
    join public.production_runs pr on pr.id = pi.run_id
    where pr.batch_id = b.id
  ), 0))::int as delivered_pieces
from public.batches b
left join lateral (
  select
    count(*) as lines,
    count(*) filter (where i.status = 'pending') as pending_lines,
    count(*) filter (where i.status = 'cancelled') as cancelled_lines,
    count(*) filter (where i.status <> 'cancelled' and i.resolved_category_id is null) as unmatched_lines,
    sum(i.qty) filter (where i.status <> 'cancelled') as required,
    sum(i.qty) filter (where i.status = 'pending') as pending_pieces,
    sum(i.qty) filter (where i.status = 'received' and i.received_from = 'return') as from_returns,
    sum(i.qty) filter (where i.status = 'received' and i.received_from = 'supplier') as from_supplier,
    sum(i.qty * i.unit_cost_pkr) filter (where i.status = 'received' and i.received_from = 'supplier') as est_supplier_cost,
    max(i.updated_at) as last_item_change
  from public.batch_items i
  where i.batch_id = b.id
) s on true;

-- Dashboard: production-received pieces count as supplier-delivered stock (same formula as before).
create or replace function public.dashboard(
  p_workspace uuid,
  p_from date default null,
  p_to date default null,
  p_today date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with items as (
    select i.qty, i.status, i.received_from, i.unit_cost_pkr, i.resolved_category_id,
           b.batch_date, b.archived_at
    from public.batch_items i
    join public.batches b on b.id = i.batch_id
    where i.workspace_id = p_workspace
  ),
  period_items as (
    select * from items
    where (p_from is null or batch_date >= p_from) and (p_to is null or batch_date <= p_to)
  )
  select jsonb_build_object(
    'period', (
      select jsonb_build_object(
        'batches', (
          select count(*) from public.batches b
          where b.workspace_id = p_workspace
            and (p_from is null or b.batch_date >= p_from) and (p_to is null or b.batch_date <= p_to)
        ),
        'lines', count(*),
        'cancelled_lines', count(*) filter (where status = 'cancelled'),
        'required', coalesce(sum(qty) filter (where status <> 'cancelled'), 0),
        'pending_pieces', coalesce(sum(qty) filter (where status = 'pending'), 0),
        'from_returns', coalesce(sum(qty) filter (where status = 'received' and received_from = 'return'), 0),
        'from_supplier', coalesce(sum(qty) filter (where status = 'received' and received_from = 'supplier'), 0),
        'est_supplier_cost', coalesce(sum(qty * unit_cost_pkr) filter (where status = 'received' and received_from = 'supplier'), 0)
      )
      from period_items
    ),
    'returned_stock_received', (
      select coalesce(sum(l.qty), 0)
      from public.return_receipt_lines l
      join public.return_receipts r on r.id = l.receipt_id
      where r.workspace_id = p_workspace
        and (p_from is null or r.date >= p_from) and (p_to is null or r.date <= p_to)
    ),
    'supplier_delivered', (
      select coalesce(sum(l.qty), 0)
      from public.supplier_delivery_lines l
      join public.supplier_deliveries d on d.id = l.delivery_id
      where d.workspace_id = p_workspace
        and (p_from is null or d.date >= p_from) and (p_to is null or d.date <= p_to)
    ),
    'alerts', (
      select jsonb_build_object('pending_lines', count(*), 'pending_pieces', coalesce(sum(qty), 0))
      from items where status = 'pending' and archived_at is null
    ),
    'unmatched_lines', (
      select count(*) from items
      where resolved_category_id is null and status <> 'cancelled' and archived_at is null
    ),
    'ready_to_archive', (
      select count(*) from public.batch_summaries s
      where s.workspace_id = p_workspace and s.stage = 'complete'
    ),
    'stock', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'category_id', c.id, 'name', c.name, 'low_stock_level', c.low_stock_level, 'sort_order', c.sort_order,
        'adjustments', (select coalesce(sum(a.qty), 0) from public.stock_adjustments a where a.category_id = c.id),
        'returns_in', (select coalesce(sum(l.qty), 0) from public.return_receipt_lines l where l.category_id = c.id),
        'delivered', (select coalesce(sum(l.qty), 0) from public.supplier_delivery_lines l where l.category_id = c.id)
                   + (select coalesce(sum(pi.qty_received), 0) from public.production_items pi where pi.category_id = c.id),
        'supplier', (select coalesce(sum(i.qty), 0) from items i where i.resolved_category_id = c.id and i.status = 'received' and i.received_from = 'supplier'),
        'returns_used', (select coalesce(sum(i.qty), 0) from items i where i.resolved_category_id = c.id and i.status = 'received' and i.received_from = 'return'),
        'pending', (select coalesce(sum(i.qty), 0) from items i where i.resolved_category_id = c.id and i.status = 'pending')
      ) order by c.sort_order), '[]'::jsonb)
      from public.categories c
      where c.workspace_id = p_workspace
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'returns', d.returns, 'supplier', d.supplier) order by d.day), '[]'::jsonb)
      from (
        select g.day::date as day,
          coalesce(sum(i.qty) filter (where i.received_from = 'return'), 0) as returns,
          coalesce(sum(i.qty) filter (where i.received_from = 'supplier'), 0) as supplier
        from generate_series(p_today - 13, p_today, interval '1 day') g(day)
        left join items i on i.batch_date = g.day::date and i.status = 'received'
        group by g.day
      ) d
    ),
    'weekly_cost', (
      select coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'cost', w.cost) order by w.week), '[]'::jsonb)
      from (
        select g.week::date as week,
          coalesce(sum(i.qty * i.unit_cost_pkr), 0) as cost
        from generate_series(date_trunc('week', (p_today - 77)::timestamp), date_trunc('week', p_today::timestamp), interval '1 week') g(week)
        left join items i
          on i.batch_date >= g.week::date and i.batch_date < (g.week + interval '1 week')::date
         and i.status = 'received' and i.received_from = 'supplier'
        group by g.week
      ) w
    ),
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object('category_id', x.cat, 'name', x.name, 'pieces', x.pieces) order by x.sort_order), '[]'::jsonb)
      from (
        select p.resolved_category_id as cat, coalesce(c.name, 'Unmatched') as name,
               coalesce(c.sort_order, 9999) as sort_order, sum(p.qty) as pieces
        from period_items p
        left join public.categories c on c.id = p.resolved_category_id
        where p.status <> 'cancelled'
        group by p.resolved_category_id, c.name, c.sort_order
      ) x
    )
  );
$$;
