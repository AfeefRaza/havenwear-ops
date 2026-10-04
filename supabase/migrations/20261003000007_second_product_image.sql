-- Second product picture for suppliers (often shows the other print side). Additive and backward compatible.

alter table public.shopify_products add column if not exists image2_url text
  check (image2_url is null or image2_url ~ '^https://cdn\.shopify\.com/');
alter table public.production_items add column if not exists image2_url text
  check (image2_url is null or image2_url ~ '^https://cdn\.shopify\.com/');

-- production_push: same as before, plus image2_url (validated to the Shopify CDN).
create or replace function public.production_push(p_batch uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ws uuid; b record; run uuid; l jsonb; bi record; pid uuid; n_lines int := 0; n_pieces int := 0; was_ready boolean; img text; img2 text;
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
    insert into public.production_items (workspace_id, run_id, item_key, product_title, variant_title, size, color, image_url, image2_url,
                                         shopify_product_id, shopify_variant_id, front_print, back_print, category_id, qty_required)
    values (ws, run, left(l->>'item_key', 300), left(coalesce(l->>'product_title', bi.product_name), 300), left(l->>'variant_title', 200),
            left(l->>'size', 100), left(l->>'color', 100), img, img2, (l->>'shopify_product_id')::bigint, (l->>'shopify_variant_id')::bigint,
            coalesce((l->>'front_print')::boolean, true), coalesce((l->>'back_print')::boolean, true), bi.resolved_category_id, 0)
    on conflict (run_id, item_key) do update set updated_at = now()
    returning id into pid;
    -- Linking the line adds its quantity to qty_required (via the production_sync trigger).
    update public.batch_items set production_item_id = pid where id = bi.id;
    perform private.log_event(ws, run, pid, null, 'item_allocated', bi.qty, bi.product_name);
    n_lines := n_lines + 1; n_pieces := n_pieces + bi.qty;
  end loop;
  if n_lines > 0 then
    perform private.log_event(ws, run, null, null, 'batch_pushed', n_pieces, n_lines || ' lines pushed to production');
    if was_ready then
      update public.production_runs set dtf_status = 'waiting', dtf_ready_at = null where id = run;
      perform private.log_event(ws, run, null, null, 'dtf_reset', null, 'New products added after DTF file was ready');
    end if;
  end if;
  return jsonb_build_object('run_id', run, 'lines', n_lines, 'pieces', n_pieces);
end; $$;

-- Havenwear: fill missing pictures on already-pushed products from the synced catalogue
-- (called automatically after "Sync from Shopify").
create or replace function public.production_refresh_images(p_workspace uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.require_role(p_workspace, array['owner', 'member']);
  update public.production_items pi
     set image_url = coalesce(pi.image_url, sp.image_url),
         image2_url = coalesce(nullif(sp.image_url, coalesce(pi.image_url, sp.image_url)), nullif(sp.image2_url, coalesce(pi.image_url, sp.image_url)))
    from public.shopify_products sp
   where sp.workspace_id = pi.workspace_id and sp.product_id = pi.shopify_product_id
     and pi.workspace_id = p_workspace and pi.image2_url is null
     and (sp.image2_url is not null or pi.image_url is null);
  get diagnostics n = row_count;
  return n;
end; $$;

revoke all on function public.production_push(uuid, jsonb) from public, anon;
grant execute on function public.production_push(uuid, jsonb) to authenticated;
revoke all on function public.production_refresh_images(uuid) from public, anon;
grant execute on function public.production_refresh_images(uuid) to authenticated;
