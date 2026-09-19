-- Keep the v2.1 security-definer search functions on trusted schemas only while
-- allowing PostgreSQL to resolve pgvector's distance operator at execution.

alter function public.ecos_search_hosted_semantic_chunks_v21(
  extensions.vector,
  text[],
  integer
)
set search_path = pg_catalog, extensions;

alter function public.ecos_search_hosted_shadow_semantic_chunks_v21(
  extensions.vector,
  text[],
  integer
)
set search_path = pg_catalog, extensions;
