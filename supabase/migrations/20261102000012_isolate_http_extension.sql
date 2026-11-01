-- The http functions carry a platform-owned PUBLIC grant that cannot be revoked, so they live in a
-- schema API roles have no USAGE on.
drop extension http;
create schema if not exists shopify_http;
revoke all on schema shopify_http from public, anon, authenticated;
create extension http with schema shopify_http;
do $$
begin
  execute replace(pg_get_functiondef('private.shopify_sync'::regproc), 'extensions.http', 'shopify_http.http');
end $$;
