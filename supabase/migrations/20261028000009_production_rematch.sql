-- Repair production items that were pushed without a Shopify match (no picture).
-- Havenwear only. Only touches items that have NO Shopify product yet; never changes
-- quantities, item keys, ready/received counts, problems or history.

create or replace function public.production_rematch(p_workspace uuid, p_changes jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare c jsonb; it record; n int := 0; img text; img2 text; f boolean; bk boolean;
begin
  perform private.require_role(p_workspace, array['owner', 'member']);
  for c in select * from jsonb_array_elements(coalesce(p_changes, '[]')) loop
    select * into it from public.production_items
     where id = (c->>'id')::uuid and workspace_id = p_workspace and shopify_product_id is null
     for update;
    if not found then continue; end if;
    img := c->>'image_url';
    if img is not null and img !~ '^https://cdn\.shopify\.com/' then img := null; end if;
    img2 := c->>'image2_url';
    if img2 is not null and img2 !~ '^https://cdn\.shopify\.com/' then img2 := null; end if;
    f := coalesce((c->>'front_print')::boolean, it.front_print);
    bk := coalesce((c->>'back_print')::boolean, it.back_print);
    update public.production_items
       set shopify_product_id = (c->>'shopify_product_id')::bigint,
           shopify_variant_id = coalesce((c->>'shopify_variant_id')::bigint, shopify_variant_id),
           image_url = coalesce(img, image_url),
           image2_url = coalesce(img2, image2_url),
           size = coalesce(left(c->>'size', 100), size),
           color = coalesce(left(c->>'color', 100), color),
           front_print = f,
           back_print = bk
     where id = it.id;
    perform private.log_event(p_workspace, it.run_id, it.id, null, 'product_matched', null, it.product_title);
    -- Unmatched items defaulted to Front + Back; if the real product needs MORE than recorded, redo the DTF file.
    if (f and not it.front_print) or (bk and not it.back_print) then
      update public.production_runs set dtf_status = 'waiting', dtf_ready_at = null where id = it.run_id and dtf_status = 'file_ready';
    end if;
    n := n + 1;
  end loop;
  return n;
end; $$;

revoke all on function public.production_rematch(uuid, jsonb) from public, anon;
grant execute on function public.production_rematch(uuid, jsonb) to authenticated;
