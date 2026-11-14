-- "Import new batches" button: pulls orders that carry the `done` tag and a batch-date tag (e.g. 11nov26)
-- from Shopify (through the finance app's read-only feed) and adds them to the matching batch, creating it if needed.
--
-- Additive and backward compatible. Manual batches, pasted lists and the Shopify CSV import are untouched.
-- Duplicate protection: every imported order is recorded in shopify_order_imports, every imported line carries
-- its Shopify line id (unique), and nothing that already exists is ever changed or removed by the import.

alter table public.batches add column if not exists source text not null default 'manual' check (source in ('manual', 'shopify'));

create unique index if not exists batch_items_shopify_line_uniq on public.batch_items (workspace_id, shopify_line_id) where shopify_line_id is not null;

-- One row per Shopify order the import has looked at.
--   imported : its lines were added to a batch
--   baseline : already existed when the import was switched on - recorded, never imported (it was handled by hand)
--   skipped  : nothing to import (cancelled, no items left) or dismissed
--   blocked  : could not be imported yet (two batch tags, bad date, archived batch) - retried on every import
-- `note` on an imported order means something changed in Shopify afterwards; it is only flagged, never applied.
create table if not exists public.shopify_order_imports (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  shopify_order_id bigint not null,
  order_name text not null,
  batch_tag text,
  batch_id uuid,
  status text not null check (status in ('imported', 'baseline', 'skipped', 'blocked')),
  pieces integer not null default 0,
  note text,
  acknowledged_at timestamptz,
  imported_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  primary key (workspace_id, shopify_order_id),
  foreign key (batch_id, workspace_id) references public.batches (id, workspace_id) on delete set null (batch_id)
);

create table if not exists public.shopify_import_status (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  baseline_at timestamptz,
  cursor_at timestamptz,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_result jsonb
);

alter table public.shopify_order_imports enable row level security;
alter table public.shopify_import_status enable row level security;
create policy shopify_order_imports_select on public.shopify_order_imports for select to authenticated using (workspace_id in (select private.my_workspace_ids()));
create policy shopify_import_status_select on public.shopify_import_status for select to authenticated using (workspace_id in (select private.my_workspace_ids()));
revoke all on public.shopify_order_imports, public.shopify_import_status from anon, authenticated;
grant select on public.shopify_order_imports, public.shopify_import_status to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers (mirror the TypeScript rules in src/domain so imported lines behave like pasted ones)
-- ---------------------------------------------------------------------------------------------

-- "11nov26" is a batch tag; "5pcs26" or "done" are not.
create or replace function private.is_batch_tag(p_tag text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(btrim(coalesce(p_tag, ''))) ~ '^\d{1,2}(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\d{2}$'
$$;

-- "11nov26" -> 2026-11-11; null for an impossible date such as 31nov26.
create or replace function private.batch_tag_date(p_tag text) returns date
language plpgsql immutable set search_path = '' as $$
declare m text[];
begin
  m := regexp_match(lower(btrim(coalesce(p_tag, ''))), '^(\d{1,2})(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d{2})$');
  if m is null then return null; end if;
  return make_date(2000 + m[3]::int, array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'], m[2]), m[1]::int);
exception when others then
  return null;
end $$;

-- Mirrors packSize() in src/domain/shopifyCsv.ts: "(PACK OF TWO)" -> 2, "Pack of 3" -> 3, "2-Pack" -> 2, else 1.
create or replace function private.pack_size(p_name text) returns integer
language plpgsql immutable set search_path = '' as $$
declare m text[]; v text; n int;
begin
  m := regexp_match(coalesce(p_name, ''), '\ypack\s+of\s+(two|three|four|five|six|\d{1,2})\y', 'i');
  if m is null then m := regexp_match(coalesce(p_name, ''), '\y(two|three|four|five|six|\d{1,2})\s*-?\s*pack\y', 'i'); end if;
  if m is null then return 1; end if;
  v := lower(m[1]);
  n := case v when 'two' then 2 when 'three' then 3 when 'four' then 4 when 'five' then 5 when 'six' then 6 else v::int end;
  return case when n between 2 and 24 then n else 1 end;
end $$;

-- Mirrors classify() in src/domain/classify.ts for a line without a category override:
-- the longest matching keyword wins, a tie goes to the rule created first; cost = rule override, else the category default.
create or replace function private.classify_line(p_ws uuid, p_name text)
returns table (category_id uuid, rule_id uuid, unit_cost numeric)
language sql stable security definer set search_path = '' as $$
  select r.category_id, r.id, coalesce(r.cost_override_pkr, c.default_cost_pkr)
    from public.keyword_rules r
    join public.categories c on c.id = r.category_id and c.workspace_id = r.workspace_id
   where r.workspace_id = p_ws and r.active
     and btrim(r.keyword) <> ''
     and position(lower(btrim(r.keyword)) in lower(btrim(coalesce(p_name, '')))) > 0
   order by length(btrim(r.keyword)) desc, r.created_seq asc
   limit 1
$$;

create or replace function private.ledger_set(p_ws uuid, p_order bigint, p_name text, p_tag text, p_batch uuid, p_status text, p_pieces integer, p_note text)
returns void language sql security definer set search_path = '' as $$
  insert into public.shopify_order_imports (workspace_id, shopify_order_id, order_name, batch_tag, batch_id, status, pieces, note)
  values (p_ws, p_order, p_name, p_tag, p_batch, p_status, coalesce(p_pieces, 0), p_note)
  on conflict (workspace_id, shopify_order_id) do update
    set order_name = excluded.order_name, batch_tag = excluded.batch_tag, batch_id = excluded.batch_id, status = excluded.status,
        pieces = excluded.pieces, note = excluded.note, acknowledged_at = null, seen_at = now(),
        imported_at = case when excluded.status = 'imported' then now() else public.shopify_order_imports.imported_at end
$$;

-- ---------------------------------------------------------------------------------------------
-- The import itself. p_orders is the feed's order list. With p_baseline it only records orders in the log.
-- ---------------------------------------------------------------------------------------------
create or replace function private.import_feed_orders(p_ws uuid, p_orders jsonb, p_baseline boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o jsonb; l jsonb; lines jsonb;
  v_oid bigint; oname text; tags text[]; btags text[]; tag text; bdate date; cancelled boolean;
  led public.shopify_order_imports%rowtype; have_led boolean; v_note text;
  bid uuid; bref text; barch timestamptz; new_batch boolean;
  nm text; units int; q int; cat uuid; v_rule uuid; cost numeric; ins int; pcs int;
  seen int := 0; imported int := 0; n_lines int := 0; n_pieces int := 0; flagged int := 0; blocked int := 0;
  skipped int := 0; already int := 0; recorded int := 0;
  touched jsonb := '{}'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('shopify_import:' || p_ws::text, 0));

  for o in select value from jsonb_array_elements(coalesce(p_orders, '[]'::jsonb)) order by (value ->> 'id')::bigint loop
    v_oid := (o ->> 'id')::bigint;
    oname := btrim(coalesce(o ->> 'name', ''));
    if v_oid is null or oname = '' then continue; end if;
    tags := array(select lower(btrim(t)) from jsonb_array_elements_text(coalesce(o -> 'tags', '[]'::jsonb)) t);
    if not ('done' = any (tags)) then continue; end if;
    seen := seen + 1;
    btags := array(select distinct t from unnest(tags) t where private.is_batch_tag(t) order by t);
    cancelled := coalesce((o ->> 'cancelled')::boolean, false);

    -- The order's lines as they would be imported: still-wanted quantity, same name format and pack rule as the CSV import.
    lines := '[]'::jsonb; pcs := 0;
    for l in select value from jsonb_array_elements(coalesce(o -> 'lines', '[]'::jsonb)) loop
      units := coalesce((l ->> 'qty')::int, 0);
      if units <= 0 or (l ->> 'id') is null then continue; end if;
      nm := left(btrim(regexp_replace(
              coalesce(l ->> 'title', '') ||
              case when nullif(btrim(coalesce(l ->> 'variant_title', '')), '') is not null and lower(btrim(l ->> 'variant_title')) <> 'default title'
                   then ' - ' || btrim(l ->> 'variant_title') else '' end, '\s+', ' ', 'g')), 300);
      if nm = '' then continue; end if;
      q := least(units * private.pack_size(nm), 9999);
      pcs := pcs + q;
      lines := lines || jsonb_build_object('id', (l ->> 'id')::bigint, 'name', nm, 'qty', q);
    end loop;

    select * into led from public.shopify_order_imports where workspace_id = p_ws and shopify_order_id = v_oid;
    have_led := found;

    -- Already handled: never imported twice. For imported orders, only FLAG what changed in Shopify afterwards.
    if have_led and led.status in ('imported', 'baseline', 'skipped') then
      already := already + 1;
      if led.status = 'imported' and not p_baseline then
        v_note := case
          when cancelled then 'Cancelled in Shopify after it was imported'
          when cardinality(btags) = 1 and btags[1] <> led.batch_tag then format('Batch tag changed from %s to %s in Shopify', led.batch_tag, btags[1])
          when cardinality(btags) <> 1 then 'Batch-date tag removed or duplicated in Shopify'
          when pcs <> led.pieces then format('Quantity changed in Shopify (%s → %s pieces)', led.pieces, pcs)
          else null end;
        if v_note is distinct from led.note then
          update public.shopify_order_imports set note = v_note, acknowledged_at = null, seen_at = now()
           where workspace_id = p_ws and shopify_order_id = v_oid;
          if v_note is not null then flagged := flagged + 1; end if;
        else
          update public.shopify_order_imports set seen_at = now() where workspace_id = p_ws and shopify_order_id = v_oid;
        end if;
      end if;
      continue;
    end if;

    if cardinality(btags) = 0 then continue; end if;  -- done, but no batch-date tag (yet)
    if cardinality(btags) > 1 then
      perform private.ledger_set(p_ws, v_oid, oname, null, null, 'blocked', pcs, format('Has more than one batch-date tag (%s) — keep just one in Shopify', array_to_string(btags, ', ')));
      blocked := blocked + 1; continue;
    end if;
    tag := btags[1];
    bdate := private.batch_tag_date(tag);
    if bdate is null then
      perform private.ledger_set(p_ws, v_oid, oname, tag, null, 'blocked', pcs, format('Batch tag "%s" is not a real date', tag));
      blocked := blocked + 1; continue;
    end if;
    if cancelled then
      perform private.ledger_set(p_ws, v_oid, oname, tag, null, 'skipped', pcs, 'Cancelled in Shopify — not imported');
      skipped := skipped + 1; continue;
    end if;
    if jsonb_array_length(lines) = 0 then
      perform private.ledger_set(p_ws, v_oid, oname, tag, null, 'skipped', 0, 'No items left on the order — not imported');
      skipped := skipped + 1; continue;
    end if;
    if p_baseline then
      perform private.ledger_set(p_ws, v_oid, oname, tag, null, 'baseline', pcs, null);
      recorded := recorded + 1; continue;
    end if;

    -- Find the batch (same ref, any capitals) or create it.
    select b.id, b.ref, b.archived_at into bid, bref, barch
      from public.batches b where b.workspace_id = p_ws and lower(b.ref) = lower(tag) order by b.created_at limit 1;
    if found then
      if barch is not null then
        perform private.ledger_set(p_ws, v_oid, oname, tag, null, 'blocked', pcs, format('Batch %s is archived — unarchive it, then import again', bref));
        blocked := blocked + 1; continue;
      end if;
      new_batch := false;
    else
      insert into public.batches (workspace_id, ref, batch_date, source) values (p_ws, lower(tag), bdate, 'shopify') returning id, ref into bid, bref;
      new_batch := true;
    end if;

    ins := 0;
    for l in select value from jsonb_array_elements(lines) loop
      select c.category_id, c.rule_id, c.unit_cost into cat, v_rule, cost from private.classify_line(p_ws, l ->> 'name') c;
      insert into public.batch_items (workspace_id, batch_id, product_name, qty, resolved_category_id, matched_rule_id, unit_cost_pkr, notes, order_name, shopify_order_id, shopify_line_id)
      values (p_ws, bid, l ->> 'name', (l ->> 'qty')::int, cat, v_rule, coalesce(cost, 0), 'Order ' || oname, oname, v_oid, (l ->> 'id')::bigint)
      on conflict (workspace_id, shopify_line_id) where shopify_line_id is not null do nothing;
      get diagnostics q = row_count;
      ins := ins + q;
    end loop;

    perform private.ledger_set(p_ws, v_oid, oname, tag, bid, 'imported', pcs, null);
    imported := imported + 1; n_lines := n_lines + ins; n_pieces := n_pieces + pcs;
    touched := jsonb_set(touched, array[bref], jsonb_build_object(
      'created', new_batch or coalesce((touched -> bref ->> 'created')::boolean, false),
      'orders', coalesce((touched -> bref ->> 'orders')::int, 0) + 1,
      'lines', coalesce((touched -> bref ->> 'lines')::int, 0) + ins), true);
  end loop;

  return jsonb_build_object(
    'seen', seen, 'imported_orders', imported, 'imported_lines', n_lines, 'imported_pieces', n_pieces,
    'already_handled', already, 'flagged', flagged, 'blocked', blocked, 'skipped', skipped, 'recorded', recorded,
    'batches', coalesce((select jsonb_agg(jsonb_build_object('ref', k, 'created', v -> 'created', 'orders', v -> 'orders', 'lines', v -> 'lines') order by k) from jsonb_each(touched) e(k, v)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Asking the finance app's feed (it holds the Shopify credentials; this app never sees them).
-- The access token lives in Vault; the feed only returns order numbers, tags and line items.
-- ---------------------------------------------------------------------------------------------
create or replace function private.feed_call(p_body jsonb, p_timeout integer default 6)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tok text; url text; res record;
begin
  -- Both values are stored in Vault (haven_batch_feed_token, haven_batch_feed_url): nothing identifying the
  -- finance app is kept in this public repository.
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'haven_batch_feed_token';
  select decrypted_secret into url from vault.decrypted_secrets where name = 'haven_batch_feed_url';
  if tok is null or url is null then raise exception 'The Shopify import is not set up yet'; end if;
  perform shopify_http.http_set_curlopt('CURLOPT_TIMEOUT', p_timeout::text);
  select status, content into res from shopify_http.http((
    'POST', url, array[shopify_http.http_header('x-feed-token', tok)], 'application/json', p_body::text)::shopify_http.http_request);
  if res.status is distinct from 200 then
    raise exception 'The Shopify feed answered % %', res.status, left(coalesce(res.content, ''), 200);
  end if;
  return res.content::jsonb;
end $$;

-- The button. Quick on purpose (the app allows 8 s per request): the feed answers within ~4 s with the orders
-- changed since last time, oldest first. If there are more than fit, click again - it continues where it stopped.
create or replace function public.shopify_import_now(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare st public.shopify_import_status%rowtype; feed jsonb; r jsonb; more boolean; cur timestamptz;
begin
  perform private.require_role(p_workspace, array['owner', 'member']);
  select * into st from public.shopify_import_status where workspace_id = p_workspace;
  if st.baseline_at is null or st.cursor_at is null then raise exception 'Importing from Shopify has not been switched on yet'; end if;
  update public.shopify_import_status set last_run_at = now() where workspace_id = p_workspace;
  begin
    feed := private.feed_call(jsonb_build_object('mode', 'recent', 'since', st.cursor_at));
    r := private.import_feed_orders(p_workspace, feed -> 'orders', false);
    more := coalesce((feed ->> 'has_more')::boolean, false);
    cur := case when more and feed ->> 'last_updated_at' is not null then (feed ->> 'last_updated_at')::timestamptz else now() - interval '10 minutes' end;
    r := r || jsonb_build_object('ok', true, 'has_more', more, 'checked_at', now());
    update public.shopify_import_status set last_success_at = now(), last_error = null, cursor_at = cur, last_result = r where workspace_id = p_workspace;
    return r;
  exception when others then
    -- Nothing from this attempt is kept; it is safe to click again.
    update public.shopify_import_status set last_error = left(sqlerrm, 300) where workspace_id = p_workspace;
    return jsonb_build_object('ok', false, 'error', left(sqlerrm, 300));
  end;
end $$;

-- "Dismiss" on the needs-a-look list: an imported order's note is acknowledged; a blocked order is left out for good.
create or replace function public.shopify_import_dismiss(p_workspace uuid, p_order bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role(p_workspace, array['owner', 'member']);
  update public.shopify_order_imports
     set note = case when status = 'blocked' then 'Dismissed' else note end,
         status = case when status = 'blocked' then 'skipped' else status end,
         acknowledged_at = now()
   where workspace_id = p_workspace and shopify_order_id = p_order and (status = 'blocked' or note is not null);
end $$;

-- One-time starting point, run by the database owner when the feature is switched on (not callable from the app):
-- records every order that is ALREADY tagged, so nothing that was handled by hand is imported a second time.
create or replace function private.shopify_import_baseline(p_ws uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare started timestamptz := now(); v_after bigint := 0; feed jsonb; since timestamptz := now() - interval '3 days'; pages int := 0;
begin
  if exists (select 1 from public.shopify_import_status where workspace_id = p_ws and baseline_at is not null) then
    raise exception 'The starting point was already set';
  end if;
  insert into public.shopify_import_status (workspace_id) values (p_ws) on conflict do nothing;
  loop  -- everything in the finance app's copy
    feed := private.feed_call(jsonb_build_object('mode', 'cached', 'after_id', v_after), 60);
    perform private.import_feed_orders(p_ws, feed -> 'orders', true);
    pages := pages + 1;
    exit when not coalesce((feed ->> 'has_more')::boolean, false) or pages > 50;
    v_after := (feed ->> 'last_id')::bigint;
  end loop;
  pages := 0;
  loop  -- live, the last 3 days: covers tags added since the finance app's copy last synced
    feed := private.feed_call(jsonb_build_object('mode', 'recent', 'since', since), 30);
    perform private.import_feed_orders(p_ws, feed -> 'orders', true);
    pages := pages + 1;
    exit when not coalesce((feed ->> 'has_more')::boolean, false) or feed ->> 'last_updated_at' is null or pages > 100;
    since := (feed ->> 'last_updated_at')::timestamptz;
  end loop;
  update public.shopify_import_status set baseline_at = started, cursor_at = started - interval '30 minutes' where workspace_id = p_ws;
  return (select jsonb_object_agg(status, n) from (select status, count(*) n from public.shopify_order_imports where workspace_id = p_ws group by status) s);
end $$;

revoke all on function private.is_batch_tag(text), private.batch_tag_date(text), private.pack_size(text), private.classify_line(uuid, text),
  private.ledger_set(uuid, bigint, text, text, uuid, text, integer, text), private.import_feed_orders(uuid, jsonb, boolean),
  private.feed_call(jsonb, integer), private.shopify_import_baseline(uuid) from public, anon, authenticated;
revoke all on function public.shopify_import_now(uuid), public.shopify_import_dismiss(uuid, bigint) from public, anon;
grant execute on function public.shopify_import_now(uuid), public.shopify_import_dismiss(uuid, bigint) to authenticated;
