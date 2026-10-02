-- HavenWear Ops — core schema, Row Level Security and seeds.
-- Every data table carries workspace_id; every table has RLS enabled.

create extension if not exists pg_trgm with schema extensions;

-- Private schema: not exposed through the Supabase Data API.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

------------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
------------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

------------------------------------------------------------------------------
-- Workspaces & membership
------------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  auto_archive_days integer check (auto_archive_days is null or auto_archive_days between 1 and 365),
  last_backup_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);

-- Workspaces the current user belongs to. SECURITY DEFINER so policies on
-- workspace_members do not recurse; it only ever reveals the caller's own memberships.
create or replace function private.my_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid());
$$;

create or replace function private.my_owned_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = (select auth.uid()) and m.role = 'owner';
$$;

revoke all on function private.my_workspace_ids() from public, anon;
revoke all on function private.my_owned_workspace_ids() from public, anon;
grant execute on function private.my_workspace_ids() to authenticated;
grant execute on function private.my_owned_workspace_ids() to authenticated;

------------------------------------------------------------------------------
-- Categories & keyword rules
------------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  default_cost_pkr numeric(12, 2) not null default 0 check (default_cost_pkr >= 0),
  low_stock_level integer not null default 20 check (low_stock_level >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name),
  unique (id, workspace_id)
);

create table public.keyword_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  keyword text not null check (length(trim(keyword)) > 0),
  category_id uuid not null,
  cost_override_pkr numeric(12, 2) check (cost_override_pkr is null or cost_override_pkr >= 0),
  supplier text,
  active boolean not null default true,
  notes text,
  sort_order integer not null default 0,
  -- Monotonic creation order: tie-breaker when two matching keywords have equal length.
  created_seq bigint generated always as identity,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (category_id, workspace_id) references public.categories(id, workspace_id) on delete restrict
);
create index keyword_rules_ws_idx on public.keyword_rules(workspace_id);
create index keyword_rules_category_idx on public.keyword_rules(category_id, workspace_id);

------------------------------------------------------------------------------
-- Batches & items
------------------------------------------------------------------------------
create table public.batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ref text not null check (length(trim(ref)) > 0),
  batch_date date not null default current_date,
  supplier text,
  invoice_ref text,
  actual_bill_pkr numeric(12, 2) check (actual_bill_pkr is null or actual_bill_pkr >= 0),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partially_paid', 'paid')),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, ref),
  unique (id, workspace_id)
);
create index batches_ws_date_idx on public.batches(workspace_id, batch_date desc);
create index batches_ws_archived_idx on public.batches(workspace_id, archived_at);

create table public.batch_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid not null,
  product_name text not null check (length(trim(product_name)) > 0),
  qty integer not null default 1 check (qty > 0),
  status text not null default 'pending' check (status in ('pending', 'received', 'cancelled')),
  received_from text check (received_from in ('supplier', 'return')),
  received_date date,
  category_override_id uuid,
  resolved_category_id uuid,
  matched_rule_id uuid,
  unit_cost_pkr numeric(12, 2) not null default 0 check (unit_cost_pkr >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint received_has_source check ((status = 'received') = (received_from is not null)),
  constraint received_has_date check (status <> 'received' or received_date is not null),
  foreign key (batch_id, workspace_id) references public.batches(id, workspace_id) on delete cascade,
  foreign key (category_override_id, workspace_id) references public.categories(id, workspace_id) on delete restrict,
  foreign key (resolved_category_id, workspace_id) references public.categories(id, workspace_id) on delete restrict,
  foreign key (matched_rule_id, workspace_id) references public.keyword_rules(id, workspace_id) on delete set null (matched_rule_id)
);
create index batch_items_batch_idx on public.batch_items(batch_id, workspace_id);
create index batch_items_ws_status_idx on public.batch_items(workspace_id, status);
create index batch_items_resolved_cat_idx on public.batch_items(resolved_category_id, workspace_id);
create index batch_items_override_cat_idx on public.batch_items(category_override_id, workspace_id);
create index batch_items_rule_idx on public.batch_items(matched_rule_id, workspace_id);
create index batch_items_name_trgm_idx on public.batch_items using gin (product_name extensions.gin_trgm_ops);

------------------------------------------------------------------------------
-- Returns & stock adjustments
------------------------------------------------------------------------------
create table public.return_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null default current_date,
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index return_receipts_ws_date_idx on public.return_receipts(workspace_id, date desc);

create table public.return_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  receipt_id uuid not null,
  category_id uuid not null,
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (receipt_id, workspace_id) references public.return_receipts(id, workspace_id) on delete cascade,
  foreign key (category_id, workspace_id) references public.categories(id, workspace_id) on delete restrict
);
create index return_receipt_lines_receipt_idx on public.return_receipt_lines(receipt_id, workspace_id);
create index return_receipt_lines_category_idx on public.return_receipt_lines(category_id, workspace_id);
create index return_receipt_lines_ws_idx on public.return_receipt_lines(workspace_id);

create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null default current_date,
  category_id uuid not null,
  qty integer not null check (qty <> 0),
  kind text not null default 'adjustment' check (kind in ('opening', 'adjustment')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, workspace_id) references public.categories(id, workspace_id) on delete restrict
);
create index stock_adjustments_ws_date_idx on public.stock_adjustments(workspace_id, date desc);
create index stock_adjustments_category_idx on public.stock_adjustments(category_id, workspace_id);

------------------------------------------------------------------------------
-- updated_at triggers
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['workspaces', 'categories', 'keyword_rules', 'batches', 'batch_items',
                           'return_receipts', 'return_receipt_lines', 'stock_adjustments']
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function private.set_updated_at()', t);
  end loop;
end;
$$;

------------------------------------------------------------------------------
-- Row Level Security — enabled on EVERY table, no exceptions.
------------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.categories enable row level security;
alter table public.keyword_rules enable row level security;
alter table public.batches enable row level security;
alter table public.batch_items enable row level security;
alter table public.return_receipts enable row level security;
alter table public.return_receipt_lines enable row level security;
alter table public.stock_adjustments enable row level security;

-- Anonymous users get no table privileges at all (defence in depth on top of RLS).
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- Workspaces: members can read; only owners can update settings.
-- Creating/deleting workspaces is done by the admin (see README), never from the client.
create policy workspaces_select on public.workspaces
  for select to authenticated using (id in (select private.my_workspace_ids()));
create policy workspaces_update on public.workspaces
  for update to authenticated
  using (id in (select private.my_owned_workspace_ids()))
  with check (id in (select private.my_owned_workspace_ids()));
grant select, update on public.workspaces to authenticated;

-- Members: everyone in the workspace can see who is in it; owners manage membership.
create policy members_select on public.workspace_members
  for select to authenticated using (workspace_id in (select private.my_workspace_ids()));
create policy members_insert on public.workspace_members
  for insert to authenticated with check (workspace_id in (select private.my_owned_workspace_ids()));
create policy members_update on public.workspace_members
  for update to authenticated
  using (workspace_id in (select private.my_owned_workspace_ids()))
  with check (workspace_id in (select private.my_owned_workspace_ids()));
create policy members_delete on public.workspace_members
  for delete to authenticated using (workspace_id in (select private.my_owned_workspace_ids()));
grant select, insert, update, delete on public.workspace_members to authenticated;

-- Data tables: full CRUD for members of the row's workspace only.
do $$
declare t text;
begin
  foreach t in array array['categories', 'keyword_rules', 'batches', 'batch_items',
                           'return_receipts', 'return_receipt_lines', 'stock_adjustments']
  loop
    execute format('create policy %I on public.%I for select to authenticated
                      using (workspace_id in (select private.my_workspace_ids()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated
                      with check (workspace_id in (select private.my_workspace_ids()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated
                      using (workspace_id in (select private.my_workspace_ids()))
                      with check (workspace_id in (select private.my_workspace_ids()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated
                      using (workspace_id in (select private.my_workspace_ids()))', t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

------------------------------------------------------------------------------
-- Seeds: every new workspace gets default categories and keyword rules.
------------------------------------------------------------------------------
create or replace function private.seed_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tee uuid; c_hoodie uuid; c_trouser uuid;
begin
  insert into public.categories (workspace_id, name, default_cost_pkr, sort_order)
    values (new.id, 'T-shirt', 850, 1) returning id into c_tee;
  insert into public.categories (workspace_id, name, default_cost_pkr, sort_order)
    values (new.id, 'Hoodie', 1400, 2) returning id into c_hoodie;
  insert into public.categories (workspace_id, name, default_cost_pkr, sort_order)
    values (new.id, 'Trouser', 1000, 3) returning id into c_trouser;
  insert into public.categories (workspace_id, name, default_cost_pkr, sort_order)
    values (new.id, 'Other 1', 0, 4), (new.id, 'Other 2', 0, 5);

  -- Inserted in this order so created_seq gives a stable tie-break.
  insert into public.keyword_rules (workspace_id, keyword, category_id, sort_order) values
    (new.id, 'Oversized Hoodie', c_hoodie, 1),
    (new.id, 'Hoodie', c_hoodie, 2),
    (new.id, 'Oversized Tee', c_tee, 3),
    (new.id, 'Graphic Tee', c_tee, 4),
    (new.id, 'Tee', c_tee, 5),
    (new.id, 'T-Shirt', c_tee, 6),
    (new.id, 'Trouser', c_trouser, 7);
  return new;
end;
$$;
revoke all on function private.seed_workspace() from public, anon, authenticated;

create trigger seed_workspace after insert on public.workspaces
  for each row execute function private.seed_workspace();

------------------------------------------------------------------------------
-- Admin helper (run from the SQL editor only): create a workspace owned by a user.
--   select private.create_workspace('HavenWear Pakistan', 'you@example.com');
------------------------------------------------------------------------------
create or replace function private.create_workspace(p_name text, p_owner_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_ws uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(p_owner_email);
  if v_user is null then
    raise exception 'No auth user with email %', p_owner_email;
  end if;
  insert into public.workspaces (name) values (p_name) returning id into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_user, 'owner');
  return v_ws;
end;
$$;
revoke all on function private.create_workspace(text, text) from public, anon, authenticated;

create or replace function private.add_member(p_workspace uuid, p_email text, p_role text default 'member')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'No auth user with email %', p_email;
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
    values (p_workspace, v_user, p_role)
    on conflict (workspace_id, user_id) do update set role = excluded.role;
end;
$$;
revoke all on function private.add_member(uuid, text, text) from public, anon, authenticated;
