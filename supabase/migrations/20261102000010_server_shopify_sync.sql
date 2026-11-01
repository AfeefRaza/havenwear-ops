-- Product pictures no longer depend on anyone's browser:
--  * the database fetches the public Shopify feed itself, every hour (pg_cron + http; no API key)
--  * every production item is matched to its product by the database, on insert and after each sync
--  * the owner can link a product by hand once; the link is remembered for future batches
-- Only picture/product columns of production items change. Quantities, ready/received counts,
-- problems and history are never touched.

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- Outgoing HTTP is for the sync below only, never for API users.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_depend d join pg_proc p on p.oid = d.objid
     where d.deptype = 'e' and d.classid = 'pg_proc'::regclass
       and d.refobjid = (select oid from pg_extension where extname = 'http')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

create table public.shopify_sync_status (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  products integer not null default 0,
  variants integer not null default 0
);
alter table public.shopify_sync_status enable row level security;
create policy shopify_sync_status_select on public.shopify_sync_status for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));

-- A production title the owner linked by hand to a Shopify product.
create table public.shopify_product_aliases (
  workspace_id uuid not null,
  norm_title text not null,
  product_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, norm_title),
  foreign key (workspace_id, product_id) references public.shopify_products(workspace_id, product_id) on delete cascade
);
alter table public.shopify_product_aliases enable row level security;
create policy shopify_product_aliases_select on public.shopify_product_aliases for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));

-- Same rules as norm() in src/domain/shopifyCatalog.ts.
create or replace function private.norm_title(s text)
returns text language plpgsql immutable set search_path = '' as $$
declare t text := coalesce(s, '');
begin
  t := regexp_replace(t, 'â€[^a-zA-Z0-9 ]', '-', 'g');
  t := regexp_replace(t, '[' || chr(8208) || '-' || chr(8213) || chr(8722) || ']', '-', 'g');
  t := regexp_replace(t, '[' || chr(160) || chr(8192) || '-' || chr(8203) || ']', ' ', 'g');
  -- Roman numerals typed with lowercase L's: "Batman lll" = "Batman III".
  t := regexp_replace(t, '\y[lI]{3}\y', 'iii', 'g');
  t := regexp_replace(t, '\y[lI]{2}\y', 'ii', 'g');
  return btrim(regexp_replace(lower(t), '\s+', ' ', 'g'));
end; $$;

create or replace function private.compact_title(s text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(private.norm_title(s), '[^a-z0-9]', '', 'g')
$$;

create or replace function private.clean_image(src text)
returns text language plpgsql immutable set search_path = '' as $$
declare u text := src;
begin
  if u is null then return null; end if;
  if u like '//%' then u := 'https:' || u; end if;
  u := regexp_replace(u, '^http:', 'https:');
  return case when u ~ '^https://cdn\.shopify\.com/' then u end;
end; $$;

-- Which product is this production title? Only exact matches: a wrong picture is worse than none,
-- so similar names ("Batman II" / "Batman III") are never guessed.
create or replace function private.resolve_product(p_ws uuid, p_title text)
returns bigint language plpgsql stable set search_path = '' as $$
declare n text := private.norm_title(p_title); c text := private.compact_title(p_title); r bigint;
begin
  select a.product_id into r from public.shopify_product_aliases a where a.workspace_id = p_ws and a.norm_title = n;
  if found then return r; end if;
  select sp.product_id into r from public.shopify_products sp
   where sp.workspace_id = p_ws and private.norm_title(sp.title) = n order by sp.synced_at desc limit 1;
  if found then return r; end if;
  select sp.product_id into r from public.shopify_products sp
   where sp.workspace_id = p_ws and private.compact_title(sp.title) = c order by sp.synced_at desc limit 1;
  if found then return r; end if;
  -- "Bundle of two Oversized Hoodie / Black / Olive": title with the option glued on. Longest title wins.
  select sp.product_id into r from public.shopify_products sp
   where sp.workspace_id = p_ws
     and (starts_with(n, private.norm_title(sp.title) || ' / ') or starts_with(n, private.norm_title(sp.title) || ' - '))
   order by length(sp.title) desc limit 1;
  return r;
end; $$;

create or replace function private.resolve_variant(p_ws uuid, p_product bigint, p_title text, p_variant text)
returns bigint language plpgsql stable set search_path = '' as $$
declare
  vt text := private.norm_title(p_variant);
  pt text;
  suffix text;
  r bigint;
begin
  select private.norm_title(title) into pt from public.shopify_products where workspace_id = p_ws and product_id = p_product;
  if starts_with(private.norm_title(p_title), pt || ' ') then
    suffix := regexp_replace(substr(private.norm_title(p_title), length(pt) + 2), '^[/-] ', '');
  end if;
  select v.variant_id into r from public.shopify_variants v
   where v.workspace_id = p_ws and v.product_id = p_product
     and private.norm_title(v.title) in (vt, suffix, vt || ' / ' || suffix, suffix || ' / ' || vt)
   limit 1;
  if found then return r; end if;
  if (select count(*) from public.shopify_variants v where v.workspace_id = p_ws and v.product_id = p_product) = 1 then
    select v.variant_id into r from public.shopify_variants v where v.workspace_id = p_ws and v.product_id = p_product;
  end if;
  return r;
end; $$;

-- New items are matched by the database, whatever the app sent.
create or replace function private.production_item_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sp public.shopify_products; v public.shopify_variants;
begin
  if new.shopify_product_id is null then
    new.shopify_product_id := private.resolve_product(new.workspace_id, new.product_title);
    if new.shopify_product_id is null then return new; end if;
    new.shopify_variant_id := private.resolve_variant(new.workspace_id, new.shopify_product_id, new.product_title, new.variant_title);
    select * into sp from public.shopify_products where workspace_id = new.workspace_id and product_id = new.shopify_product_id;
    new.front_print := sp.front_print;
    new.back_print := sp.back_print;
  end if;
  if new.image_url is null then
    select * into sp from public.shopify_products where workspace_id = new.workspace_id and product_id = new.shopify_product_id;
    select * into v from public.shopify_variants where workspace_id = new.workspace_id and variant_id = new.shopify_variant_id;
    new.image_url := coalesce(v.image_url, sp.image_url);
    new.image2_url := coalesce(new.image2_url, nullif(sp.image_url, new.image_url), nullif(sp.image2_url, new.image_url));
    new.size := coalesce(v.size, new.size);
    new.color := coalesce(v.color, new.color);
  end if;
  return new;
end; $$;

create trigger production_item_fill before insert on public.production_items
  for each row execute function private.production_item_fill();

-- Matches every unmatched item, then keeps pictures of matched items current
-- (a picture replaced on Shopify would otherwise leave a dead link).
create or replace function private.production_repair(p_ws uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare it record; pid bigint; vid bigint; sp public.shopify_products; v public.shopify_variants; n int := 0; img text;
begin
  for it in select * from public.production_items where workspace_id = p_ws and shopify_product_id is null for update loop
    pid := private.resolve_product(p_ws, it.product_title);
    if pid is null then continue; end if;
    vid := private.resolve_variant(p_ws, pid, it.product_title, it.variant_title);
    select * into sp from public.shopify_products where workspace_id = p_ws and product_id = pid;
    v := null;
    select * into v from public.shopify_variants where workspace_id = p_ws and variant_id = vid;
    img := coalesce(v.image_url, sp.image_url);
    update public.production_items
       set shopify_product_id = pid, shopify_variant_id = vid, image_url = coalesce(img, image_url),
           image2_url = coalesce(nullif(sp.image_url, img), nullif(sp.image2_url, img), image2_url),
           size = coalesce(v.size, size), color = coalesce(v.color, color),
           front_print = sp.front_print, back_print = sp.back_print
     where id = it.id;
    perform private.log_event(p_ws, it.run_id, it.id, null, 'product_matched', null, it.product_title);
    -- Unmatched items defaulted to Front + Back; if the real product needs more than recorded, redo the DTF file.
    if (sp.front_print and not it.front_print) or (sp.back_print and not it.back_print) then
      update public.production_runs set dtf_status = 'waiting', dtf_ready_at = null where id = it.run_id and dtf_status = 'file_ready';
    end if;
    n := n + 1;
  end loop;

  update public.production_items pi
     set image_url = x.img, image2_url = x.img2
    from (
      select i.id, coalesce(v.image_url, sp.image_url, i.image_url) img,
             coalesce(nullif(sp.image_url, coalesce(v.image_url, sp.image_url, i.image_url)),
                      nullif(sp.image2_url, coalesce(v.image_url, sp.image_url, i.image_url)), i.image2_url) img2
        from public.production_items i
        join public.shopify_products sp on sp.workspace_id = i.workspace_id and sp.product_id = i.shopify_product_id
        left join public.shopify_variants v on v.workspace_id = i.workspace_id and v.variant_id = i.shopify_variant_id
       where i.workspace_id = p_ws
    ) x
   where pi.id = x.id and (pi.image_url is distinct from x.img or pi.image2_url is distinct from x.img2);
  return n;
end; $$;

-- Mirrors flattenFeed() in src/domain/shopifyCatalog.ts. Print settings are never overwritten, and
-- products that left the feed stay in the catalogue so old batches keep their pictures.
create or replace function private.shopify_sync(p_ws uuid, p_store text default 'havenwearpakistan.com')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  page int := 1; try int; res record; prods jsonb; p jsonb; v jsonb; opts jsonb;
  size_i int; color_is int[]; title_color text; img text; img2 text; pc int := 0; vc int := 0; matched int;
  vals text[]; cs text[]; i int;
begin
  insert into public.shopify_sync_status (workspace_id, last_attempt_at) values (p_ws, now())
    on conflict (workspace_id) do update set last_attempt_at = now();
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '30');
    loop
      try := 1;
      loop
        select status, content into res from extensions.http_get(format('https://%s/products.json?limit=250&page=%s', p_store, page));
        exit when res.status = 200 or try >= 3;
        perform pg_sleep(try * 5);
        try := try + 1;
      end loop;
      if res.status <> 200 then raise exception 'Shopify returned % on page %', res.status, page; end if;
      prods := res.content::jsonb -> 'products';
      for p in select * from jsonb_array_elements(prods) loop
        img := private.clean_image(p #>> '{images,0,src}');
        img2 := nullif(private.clean_image(p #>> '{images,1,src}'), img);
        insert into public.shopify_products (workspace_id, product_id, handle, title, product_type, image_url, image2_url, synced_at)
        values (p_ws, (p->>'id')::bigint, p->>'handle', btrim(p->>'title'), nullif(btrim(p->>'product_type'), ''), img, img2, now())
        on conflict (workspace_id, product_id) do update
          set handle = excluded.handle, title = excluded.title, product_type = excluded.product_type,
              image_url = coalesce(excluded.image_url, public.shopify_products.image_url),
              image2_url = excluded.image2_url, synced_at = now();
        pc := pc + 1;

        opts := p->'options';
        select min(o.ord) into size_i from jsonb_array_elements(opts) with ordinality o(val, ord) where o.val->>'name' ~* 'size';
        select coalesce(array_agg(o.ord::int order by o.ord), '{}') into color_is from jsonb_array_elements(opts) with ordinality o(val, ord) where o.val->>'name' ~* 'colou?r';
        title_color := btrim((regexp_match(btrim(p->>'title'), '\(([^()]{2,30})\)\s*$'))[1]);
        if title_color ~* 'oversized|pack of|regular|fit' then title_color := null; end if;

        for v in select * from jsonb_array_elements(p->'variants') loop
          vals := array[v->>'option1', v->>'option2', v->>'option3'];
          cs := '{}';
          foreach i in array color_is loop
            if vals[i] is not null then cs := cs || vals[i]; end if;
          end loop;
          insert into public.shopify_variants (workspace_id, variant_id, product_id, title, size, color, image_url)
          values (p_ws, (v->>'id')::bigint, (p->>'id')::bigint, v->>'title', vals[size_i],
                  coalesce(nullif(array_to_string(cs, ' + '), ''), title_color),
                  coalesce(private.clean_image(v #>> '{featured_image,src}'), img))
          on conflict (workspace_id, variant_id) do update
            set product_id = excluded.product_id, title = excluded.title, size = excluded.size, color = excluded.color,
                image_url = coalesce(excluded.image_url, public.shopify_variants.image_url);
          vc := vc + 1;
        end loop;
      end loop;
      exit when jsonb_array_length(prods) < 250 or page >= 40;
      page := page + 1;
    end loop;
    matched := private.production_repair(p_ws);
    update public.shopify_sync_status
       set last_success_at = now(), last_error = null, products = pc, variants = vc where workspace_id = p_ws;
    return jsonb_build_object('ok', true, 'products', pc, 'variants', vc, 'rematched', matched);
  exception when others then
    -- Nothing from this attempt is kept; the next hourly run tries again and the app shows the error.
    update public.shopify_sync_status set last_error = left(sqlerrm, 300) where workspace_id = p_ws;
    return jsonb_build_object('ok', false, 'error', left(sqlerrm, 300));
  end;
end; $$;

create or replace function private.shopify_sync_all()
returns void language plpgsql security definer set search_path = '' as $$
declare w uuid;
begin
  for w in select id from public.workspaces loop
    perform private.shopify_sync(w);
  end loop;
end; $$;

-- "Sync now" button.
create or replace function public.shopify_sync_now(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role(p_workspace, array['owner', 'member']);
  return private.shopify_sync(p_workspace);
end; $$;

-- Link one unmatched product by hand. Remembered, so later batches match by themselves.
create or replace function public.production_link_product(p_workspace uuid, p_title text, p_product bigint)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role(p_workspace, array['owner', 'member']);
  if not exists (select 1 from public.shopify_products where workspace_id = p_workspace and product_id = p_product) then
    raise exception 'Unknown Shopify product';
  end if;
  insert into public.shopify_product_aliases (workspace_id, norm_title, product_id)
  values (p_workspace, private.norm_title(p_title), p_product)
  on conflict (workspace_id, norm_title) do update set product_id = excluded.product_id;
  return private.production_repair(p_workspace);
end; $$;

drop function if exists public.production_rematch(uuid, jsonb);

revoke all on function public.shopify_sync_now(uuid) from public, anon;
grant execute on function public.shopify_sync_now(uuid) to authenticated;
revoke all on function public.production_link_product(uuid, text, bigint) from public, anon;
grant execute on function public.production_link_product(uuid, text, bigint) to authenticated;

select cron.schedule('havenwear-shopify-sync', '7 * * * *', 'select private.shopify_sync_all()');
