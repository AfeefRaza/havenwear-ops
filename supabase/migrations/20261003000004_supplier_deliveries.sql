-- Supplier deliveries: stock physically delivered by the supplier, by date and category.
-- Stock per category becomes: opening/adjustments + returns in + supplier deliveries − all items received.

create table public.supplier_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null default current_date,
  supplier text,
  reference text,
  batch_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (batch_id, workspace_id) references public.batches(id, workspace_id) on delete set null (batch_id)
);
create index supplier_deliveries_ws_date_idx on public.supplier_deliveries(workspace_id, date desc);
create index supplier_deliveries_batch_idx on public.supplier_deliveries(batch_id, workspace_id);

create table public.supplier_delivery_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  delivery_id uuid not null,
  category_id uuid not null,
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (delivery_id, workspace_id) references public.supplier_deliveries(id, workspace_id) on delete cascade,
  foreign key (category_id, workspace_id) references public.categories(id, workspace_id) on delete restrict
);
create index supplier_delivery_lines_delivery_idx on public.supplier_delivery_lines(delivery_id, workspace_id);
create index supplier_delivery_lines_category_idx on public.supplier_delivery_lines(category_id, workspace_id);
create index supplier_delivery_lines_ws_idx on public.supplier_delivery_lines(workspace_id);

create trigger set_updated_at before update on public.supplier_deliveries for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.supplier_delivery_lines for each row execute function private.set_updated_at();

alter table public.supplier_deliveries enable row level security;
alter table public.supplier_delivery_lines enable row level security;
revoke all on public.supplier_deliveries, public.supplier_delivery_lines from anon;

do $$
declare t text;
begin
  foreach t in array array['supplier_deliveries', 'supplier_delivery_lines'] loop
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

-- Batch summaries gain "delivered_pieces" (deliveries linked to the batch). New column appended at the end.
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
  coalesce((
    select sum(l.qty) from public.supplier_delivery_lines l
    join public.supplier_deliveries d on d.id = l.delivery_id
    where d.batch_id = b.id
  ), 0)::int as delivered_pieces
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

-- Dashboard: per-category "delivered" for stock, and "supplier_delivered" pieces in the period.
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
        'delivered', (select coalesce(sum(l.qty), 0) from public.supplier_delivery_lines l where l.category_id = c.id),
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
