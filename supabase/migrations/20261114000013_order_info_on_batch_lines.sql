-- Order information on batch lines (for the "By orders" view) + the HIGH PRIORITY threshold.
--
-- Purely additive and backward compatible: every new column is nullable (or has a default), nothing
-- existing is changed, and the previous app version keeps working with these columns present.
-- Manual batches, pasted lists and the Shopify CSV import write none of these columns and behave as before.

-- Which Shopify order a line came from. Filled by the automatic Shopify import (a later change);
-- until then lines from the CSV import are grouped from their "Order #…" note instead.
alter table public.batch_items
  add column if not exists order_name text check (order_name is null or length(btrim(order_name)) between 1 and 60),
  add column if not exists shopify_order_id bigint,
  add column if not exists shopify_line_id bigint;

create index if not exists batch_items_order_idx on public.batch_items (batch_id, order_name) where order_name is not null;

-- Orders with at least this many pieces are shown with a HIGH PRIORITY label.
-- Default 4: in the last 1,290 batch orders, 81% were 1 piece and only ~2% had 4 or more.
alter table public.workspaces
  add column if not exists high_priority_pieces integer not null default 4 check (high_priority_pieces between 2 and 50);
