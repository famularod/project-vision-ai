begin;

-- Supabase does not permit HNSW custom settings in ALTER FUNCTION proconfig.
-- These security-definer wrappers apply transaction-local planner settings and
-- then delegate to the exact v2.1 authority boundary. Nothing persists beyond
-- the single RPC transaction.
create or replace function public.ecos_search_hosted_semantic_chunks_v22(
  p_query_embedding extensions.vector(1536),
  p_document_ids text[] default null,
  p_result_limit integer default 36
)
returns table(
  job_id uuid,
  organization_id text,
  project_id text,
  source_sha256 text,
  evidence_version text,
  document_id text,
  page_number integer,
  region_id text,
  chunk_text text,
  sheet_number text,
  confidence numeric,
  metadata jsonb,
  rank real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('enable_sort', 'off', true);
  perform pg_catalog.set_config('hnsw.ef_search', '200', true);
  return query
  select result.*
  from public.ecos_search_hosted_semantic_chunks_v21(
    p_query_embedding,
    p_document_ids,
    p_result_limit
  ) result;
end;
$$;

create or replace function public.ecos_search_hosted_shadow_semantic_chunks_v22(
  p_query_embedding extensions.vector(1536),
  p_document_ids text[] default null,
  p_result_limit integer default 36
)
returns table(
  job_id uuid,
  organization_id text,
  project_id text,
  source_sha256 text,
  evidence_version text,
  document_id text,
  page_number integer,
  region_id text,
  chunk_text text,
  sheet_number text,
  confidence numeric,
  metadata jsonb,
  rank real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;
  perform pg_catalog.set_config('enable_sort', 'off', true);
  perform pg_catalog.set_config('hnsw.ef_search', '200', true);
  return query
  select result.*
  from public.ecos_search_hosted_shadow_semantic_chunks_v21(
    p_query_embedding,
    p_document_ids,
    p_result_limit
  ) result;
end;
$$;

revoke all on function public.ecos_search_hosted_semantic_chunks_v22(
  extensions.vector, text[], integer
) from public, anon;
grant execute on function public.ecos_search_hosted_semantic_chunks_v22(
  extensions.vector, text[], integer
) to authenticated, service_role;

revoke all on function public.ecos_search_hosted_shadow_semantic_chunks_v22(
  extensions.vector, text[], integer
) from public, anon, authenticated;
grant execute on function public.ecos_search_hosted_shadow_semantic_chunks_v22(
  extensions.vector, text[], integer
) to service_role;

commit;
