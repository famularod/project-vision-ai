begin;

-- Execute the exact protected lexical authority for a bounded query plan in
-- one RPC. This changes transport only: every match still comes from the
-- deployed single-query authority and the exact ready shadow evidence set.
create or replace function public.ecos_search_hosted_shadow_chunks_v23(
  p_search_queries text[],
  p_document_ids text[] default null,
  p_per_query_limit integer default 24,
  p_result_limit integer default 480
)
returns table(
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
declare
  bounded_per_query_limit integer := greatest(
    1,
    least(coalesce(p_per_query_limit, 24), 24)
  );
  bounded_result_limit integer := greatest(
    1,
    least(coalesce(p_result_limit, 480), 480)
  );
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;
  if p_search_queries is null or cardinality(p_search_queries) not between 1 and 20 then
    raise invalid_parameter_value using message = 'one to 20 search queries required';
  end if;
  if exists (
    select 1
    from unnest(p_search_queries) supplied(search_query)
    where supplied.search_query is null
      or supplied.search_query <> btrim(supplied.search_query)
      or length(supplied.search_query) not between 2 and 240
  ) then
    raise invalid_parameter_value using message = 'canonical bounded search queries required';
  end if;

  return query
  with queries as materialized (
    select supplied.search_query, supplied.ordinality::integer as query_ordinal
    from unnest(p_search_queries) with ordinality supplied(search_query, ordinality)
  ), matches as materialized (
    select
      result.document_id,
      result.page_number,
      result.region_id,
      result.chunk_text,
      result.sheet_number,
      result.confidence,
      result.metadata,
      result.rank,
      query.query_ordinal
    from queries query
    cross join lateral public.ecos_search_hosted_shadow_chunks(
      query.search_query,
      p_document_ids,
      bounded_per_query_limit
    ) result
  ), ranked as (
    select
      matches.*,
      row_number() over (
        partition by
          matches.document_id,
          matches.page_number,
          coalesce(matches.region_id, ''),
          matches.chunk_text
        order by matches.rank desc, matches.query_ordinal
      ) as duplicate_ordinal
    from matches
  )
  select
    ranked.document_id,
    ranked.page_number,
    ranked.region_id,
    ranked.chunk_text,
    ranked.sheet_number,
    ranked.confidence,
    ranked.metadata,
    ranked.rank
  from ranked
  where ranked.duplicate_ordinal = 1
  order by
    ranked.rank desc,
    ranked.query_ordinal,
    ranked.document_id,
    ranked.page_number,
    ranked.region_id
  limit bounded_result_limit;
end;
$$;

revoke all on function public.ecos_search_hosted_shadow_chunks_v23(
  text[], text[], integer, integer
) from public, anon, authenticated;
grant execute on function public.ecos_search_hosted_shadow_chunks_v23(
  text[], text[], integer, integer
) to service_role;

commit;
