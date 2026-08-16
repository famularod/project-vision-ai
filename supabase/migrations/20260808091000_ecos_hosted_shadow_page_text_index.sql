-- ECOS hosted shadow page-text retrieval
--
-- Dense construction sheets can contain thousands of word-level OCR regions.
-- Search needs the complete text, but it does not need one database row per OCR
-- word. Materialize overlapping bounded page-text chunks plus the smaller set
-- of coordinate-backed structured visual facts. Exact page passages and proof
-- regions are still reconstructed from the assured page after retrieval.

begin;

create or replace function public.ecos_refresh_hosted_shadow_page(
  p_job_id uuid,
  p_page_number integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
  structured_count integer := 0;
begin
  delete from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = p_job_id and chunk.page_number = p_page_number;

  with eligible_page as (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.document_id,
      job.source_sha256,
      page.page_number,
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end as sheet_number,
      coalesce(page.final_page_data->>'sheetMappingStatus', 'unverified') as sheet_mapping_status,
      coalesce(page.final_page_data->>'sheetTitle', page.final_page_data->>'title') as sheet_title,
      page.assurance_result,
      coalesce(
        nullif(trim(page.final_page_data->>'text'), ''),
        nullif(trim((
          select string_agg(
            trim(coalesce(
              nullif(region.value->>'text', ''),
              nullif(region.value->>'label', ''),
              nullif(region.value->>'evidenceText', '')
            )),
            ' ' order by region.ordinality
          )
          from jsonb_array_elements(
            case when jsonb_typeof(page.final_page_data->'regions') = 'array'
              then page.final_page_data->'regions' else '[]'::jsonb end
          ) with ordinality region(value, ordinality)
          where length(trim(coalesce(
            nullif(region.value->>'text', ''),
            nullif(region.value->>'label', ''),
            nullif(region.value->>'evidenceText', '')
          ))) > 0
        )), '')
      ) as search_text
    from public.ecos_hosted_index_jobs job
    join public.ecos_hosted_index_pages page
      on page.job_id = job.id and page.page_number = p_page_number
    join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = job.source_owner_id
    where job.id = p_job_id
      and job.mode = 'shadow'
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
  ), page_chunks as (
    select
      eligible.*,
      chunk_index,
      substring(eligible.search_text from 1 + chunk_index * 3200 for 3500) as chunk_text
    from eligible_page eligible
    cross join lateral generate_series(
      0,
      greatest(0, ceil((length(eligible.search_text) - 3500) / 3200.0)::integer)
    ) chunk_index
    where length(trim(coalesce(eligible.search_text, ''))) > 0
  )
  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata, indexed_at
  )
  select
    page_chunks.job_id,
    page_chunks.organization_id,
    page_chunks.project_id,
    page_chunks.document_id,
    page_chunks.source_sha256,
    page_chunks.page_number,
    'page-text-' || page_chunks.chunk_index::text,
    page_chunks.chunk_index,
    page_chunks.chunk_text,
    page_chunks.sheet_number,
    null,
    jsonb_build_object(
      'pageText', true,
      'sheetMappingStatus', page_chunks.sheet_mapping_status,
      'sheetTitle', page_chunks.sheet_title,
      'pageIdentity', concat_ws(' — ',
        case when page_chunks.sheet_mapping_status = 'verified'
          then 'Sheet ' || page_chunks.sheet_number
          else 'PDF page ' || page_chunks.page_number::text end,
        page_chunks.sheet_title
      ),
      'assurance', page_chunks.assurance_result,
      'shadowValidation', true,
      'materialization', 'overlapping_page_text'
    ),
    now()
  from page_chunks
  where length(trim(page_chunks.chunk_text)) > 0;

  get diagnostics inserted_count = row_count;

  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata, indexed_at
  )
  select
    job.id,
    job.organization_id,
    job.project_id,
    job.document_id,
    job.source_sha256,
    page.page_number,
    'visual-' || region.ordinality::text,
    region.ordinality::integer,
    left(trim(concat_ws(' ',
      nullif(trim(region.value->>'text'), ''),
      nullif(trim(region.value->>'label'), ''),
      nullif(trim(region.value->>'subject'), ''),
      nullif(trim(region.value->>'location'), ''),
      nullif(trim(region.value->>'evidenceText'), ''),
      nullif(trim(region.value->>'fact'), '')
    )), 4000),
    case when page.final_page_data->>'sheetMappingStatus' = 'verified'
      then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end,
    case when (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
      then (region.value->>'confidence')::numeric else null end,
    jsonb_build_object(
      'x', region.value->'x',
      'y', region.value->'y',
      'width', region.value->'width',
      'height', region.value->'height',
      'source', coalesce(region.value->'source', '"vision"'::jsonb),
      'sourceRegionId', region.value->'id',
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
      'shadowValidation', true,
      'materialization', 'structured_visual_fact'
    ),
    now()
  from public.ecos_hosted_index_jobs job
  join public.ecos_hosted_index_pages page
    on page.job_id = job.id and page.page_number = p_page_number
  join public.reference_documents source
    on source.id::text = job.document_id
   and source.owner_id = job.source_owner_id
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(page.final_page_data->'regions') = 'array'
      then page.final_page_data->'regions' else '[]'::jsonb end
  ) with ordinality region(value, ordinality)
  where job.id = p_job_id
    and job.mode = 'shadow'
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
    and (
      region.value->>'source' = 'vision'
      or region.value ? 'factKind'
      or region.value ? 'subject'
      or region.value ? 'evidenceText'
    )
    and length(trim(concat_ws(' ',
      nullif(trim(region.value->>'text'), ''),
      nullif(trim(region.value->>'label'), ''),
      nullif(trim(region.value->>'subject'), ''),
      nullif(trim(region.value->>'location'), ''),
      nullif(trim(region.value->>'evidenceText'), ''),
      nullif(trim(region.value->>'fact'), '')
    ))) > 0;

  get diagnostics structured_count = row_count;
  return inserted_count + structured_count;
end;
$$;

revoke all on function public.ecos_refresh_hosted_shadow_page(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.ecos_refresh_hosted_shadow_page(uuid, integer) to service_role;

commit;
