-- Fixes a variable/alias name clash in production_repair and matches renamed products by handle.

create or replace function private.production_repair(p_ws uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare it record; pid bigint; vid bigint; prod public.shopify_products; vr public.shopify_variants; n int := 0; img text;
begin
  for it in select * from public.production_items where workspace_id = p_ws and shopify_product_id is null for update loop
    pid := private.resolve_product(p_ws, it.product_title);
    if pid is null then continue; end if;
    vid := private.resolve_variant(p_ws, pid, it.product_title, it.variant_title);
    select * into prod from public.shopify_products where workspace_id = p_ws and product_id = pid;
    vr := null;
    select * into vr from public.shopify_variants where workspace_id = p_ws and variant_id = vid;
    img := coalesce(vr.image_url, prod.image_url);
    update public.production_items
       set shopify_product_id = pid, shopify_variant_id = vid, image_url = coalesce(img, image_url),
           image2_url = coalesce(nullif(prod.image_url, img), nullif(prod.image2_url, img), image2_url),
           size = coalesce(vr.size, size), color = coalesce(vr.color, color),
           front_print = prod.front_print, back_print = prod.back_print
     where id = it.id;
    perform private.log_event(p_ws, it.run_id, it.id, null, 'product_matched', null, it.product_title);
    if (prod.front_print and not it.front_print) or (prod.back_print and not it.back_print) then
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
  -- Renamed on Shopify: the handle keeps the original title ("Metalica Oversized Hoodie" -> metalica-oversized-hoodie).
  select sp.product_id into r from public.shopify_products sp
   where sp.workspace_id = p_ws and sp.handle = btrim(regexp_replace(n, '[^a-z0-9]+', '-', 'g'), '-') limit 1;
  if found then return r; end if;
  select sp.product_id into r from public.shopify_products sp
   where sp.workspace_id = p_ws
     and (starts_with(n, private.norm_title(sp.title) || ' / ') or starts_with(n, private.norm_title(sp.title) || ' - '))
   order by length(sp.title) desc limit 1;
  return r;
end; $$;
