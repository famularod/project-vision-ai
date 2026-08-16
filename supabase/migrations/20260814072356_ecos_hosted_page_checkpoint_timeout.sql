-- Dense drawing pages can produce a valid, bounded final checkpoint request
-- whose JSONB upsert overlaps a managed PostgreSQL storage checkpoint.  Keep
-- the operation fail-closed and bounded, but give this service-role-only RPC
-- enough time to finish rather than inheriting the project-wide two-minute
-- statement timeout.  No publication or evidence authority is changed.

alter function public.ecos_checkpoint_hosted_index_page(
  uuid, uuid, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, integer
)
set statement_timeout = '300s';
