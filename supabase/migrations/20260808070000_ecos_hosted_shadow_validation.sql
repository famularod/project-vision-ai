-- ECOS Hosted Indexer operator-only shadow validation search
--
-- Allows Vitruvius release automation to exercise the production Ask ECOS
-- answer path against Assurance-approved shadow checkpoints before any hosted
-- evidence is customer-visible. Customer roles receive no execute permission.

begin;

create or replace function public.ecos_search_hosted_shadow_chunks(
  p_search_query text,
  p_document_ids text[] default null,
  p_result_limit integer default 24
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
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with assured_regions as (
    select
      job.document_id,
      page.page_number,
      coalesce(nullif(trim(region.value->>'id'), ''), 'page') as region_id,
      left(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label')), 4000) as chunk_text,
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end as sheet_number,
      case when (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
        then (region.value->>'confidence')::numeric else null end as confidence,
      jsonb_build_object(
        'x', region.value->'x',
        'y', region.value->'y',
        'width', region.value->'width',
        'height', region.value->'height',
        'source', region.value->'source',
        'areaNames', coalesce(region.value->'areaNames', '[]'::jsonb),
        'factKind', region.value->'factKind',
        'subject', region.value->'subject',
        'location', region.value->'location',
        'evidenceText', region.value->'evidenceText',
        'sheetMappingStatus', coalesce(page.final_page_data->>'sheetMappingStatus', 'unverified'),
        'sheetTitle', coalesce(page.final_page_data->>'sheetTitle', page.final_page_data->>'title'),
        'pageIdentity', concat_ws(' — ',
          case when page.final_page_data->>'sheetMappingStatus' = 'verified'
            then 'Sheet ' || nullif(trim(page.final_page_data->>'sheetNumber'), '')
            else 'PDF page ' || page.page_number::text end,
          coalesce(page.final_page_data->>'sheetTitle', page.final_page_data->>'title')
        ),
        'assurance', page.assurance_result,
        'shadowValidation', true
      ) as metadata
    from public.ecos_hosted_index_jobs job
    join public.ecos_hosted_index_pages page on page.job_id = job.id
    join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = job.source_owner_id
    cross join lateral jsonb_array_elements(
      case
        when jsonb_array_length(coalesce(page.final_page_data->'regions', '[]'::jsonb)) > 0
          then page.final_page_data->'regions'
        else jsonb_build_array(jsonb_build_object(
          'id', 'page',
          'text', page.final_page_data->>'text',
          'x', 0, 'y', 0, 'width', 1, 'height', 1,
          'source', 'embedded_text'
        ))
      end
    ) with ordinality region(value, ordinality)
    where job.mode = 'shadow'
      and job.state = 'ready'
      and page.state = 'assured'
      and page.assurance_result->>'accepted' = 'true'
      and page.unresolved_region_count = 0
      and source.document_data->>'isCurrent' = 'true'
      and source.document_data->>'drawingStatus' is distinct from 'Superseded'
      and lower(coalesce(
        nullif(source.document_data->>'contentSha256', ''),
        nullif(source.document_data->>'webFileFingerprint', ''),
        nullif(source.document_data->>'indexedContentSha256', '')
      )) = job.source_sha256
      and (p_document_ids is null or job.document_id = any(p_document_ids))
      and length(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label'))) > 0
  ), scored as (
    select
      assured.*,
      greatest(
        ts_rank_cd(
          to_tsvector('simple', assured.chunk_text),
          websearch_to_tsquery('simple', coalesce(p_search_query, ''))
        ),
        extensions.similarity(lower(assured.chunk_text), lower(coalesce(p_search_query, '')))
      )::real as rank
    from assured_regions assured
    where length(trim(coalesce(p_search_query, ''))) > 0
  )
  select
    scored.document_id,
    scored.page_number,
    scored.region_id,
    scored.chunk_text,
    scored.sheet_number,
    scored.confidence,
    scored.metadata,
    scored.rank
  from scored
  where scored.rank > 0
  order by scored.rank desc, scored.document_id, scored.page_number, scored.region_id
  limit greatest(1, least(coalesce(p_result_limit, 24), 100));
$$;

revoke all on function public.ecos_search_hosted_shadow_chunks(text, text[], integer)
  from public, anon, authenticated;
grant execute on function public.ecos_search_hosted_shadow_chunks(text, text[], integer)
  to service_role;

commit;
