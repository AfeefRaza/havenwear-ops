-- Deterministic order when production receipts are applied to batch lines:
-- oldest first; among lines pasted together (same timestamp), larger lines first; then id.
create or replace function private.sync_batch_lines(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare covered int; l record; today date := (now() at time zone 'Asia/Karachi')::date;
begin
  select qty_received into covered from public.production_items where id = p_item;
  for l in select id, qty, status, received_from from public.batch_items
    where production_item_id = p_item and status <> 'cancelled' order by created_at, qty desc, id
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
end; $$;
revoke all on function private.sync_batch_lines(uuid) from public, anon, authenticated;
