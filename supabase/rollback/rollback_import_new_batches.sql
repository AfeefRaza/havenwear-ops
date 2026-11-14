-- ROLLBACK for migration 20261114000014 ("Import new batches").
-- Only needed if you want to remove the import from the DATABASE as well as the code.
-- The previous app version works fine with these objects present, so normally you only revert the code.
--
-- ⚠ This permanently deletes the import log. Lines and batches that were already imported stay (they are normal
--   batch lines); they keep their Shopify ids until you also run rollback_order_info.sql.
-- Also remove the Vault secrets haven_batch_feed_token and haven_batch_feed_url (Supabase → Vault), and in the
-- finance project the function haven-batch-feed and the table haven_feed_tokens.

begin;
drop function if exists public.shopify_import_now(uuid);
drop function if exists public.shopify_import_dismiss(uuid, bigint);
drop function if exists private.shopify_import_baseline(uuid);
drop function if exists private.feed_call(jsonb, integer);
drop function if exists private.import_feed_orders(uuid, jsonb, boolean);
drop function if exists private.ledger_set(uuid, bigint, text, text, uuid, text, integer, text);
drop function if exists private.classify_line(uuid, text);
drop function if exists private.pack_size(text);
drop function if exists private.batch_tag_date(text);
drop function if exists private.is_batch_tag(text);
drop table if exists public.shopify_order_imports;
drop table if exists public.shopify_import_status;
drop index if exists public.batch_items_shopify_line_uniq;
alter table public.batches drop column if exists source;
commit;
