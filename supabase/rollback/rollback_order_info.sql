-- ROLLBACK for migration 20261114000013 (order information on batch lines + HIGH PRIORITY threshold).
-- Only needed if you want to remove these columns from the DATABASE as well as the code.
-- The previous app version works fine with the columns present, so normally you only revert the code.
--
-- ⚠ This permanently deletes the saved order names / Shopify order ids on batch lines and the saved threshold.
-- Export a backup first (More → Export / Import).

begin;
drop index if exists public.batch_items_order_idx;
alter table public.batch_items drop column if exists order_name, drop column if exists shopify_order_id, drop column if exists shopify_line_id;
alter table public.workspaces drop column if exists high_priority_pieces;
commit;
