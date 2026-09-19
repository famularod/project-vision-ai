-- ECOS hosted shadow assured-region text retrieval
--
-- Native page text and OCR/visual regions are complementary. Keep the compact
-- page-text index, then add the complete assured region stream as overlapping
-- bounded chunks so OCR-only facts remain searchable without one row per word.

begin;

create or replace function public.ecos_append_hosted_shadow_region_text(
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
begin
  delete from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = p_job_id
    and chunk.page_number = p_page_number
    and chunk.region_id like 'region-text-%';

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
      nullif(trim((
        select string_agg(
          trim(concat_ws(' ',
            nullif(trim(region.value->>'text'), ''),
            nullif(trim(region.value->>'label'), ''),
            nullif(trim(region.value->>'subject'), ''),
            nullif(trim(region.value->>'location'), ''),
            nullif(trim(region.value->>'evidenceText'), ''),
            nullif(trim(region.value->>'fact'), '')
          )),
          ' ' order by region.ordinality
        )
        from jsonb_array_elements(
          case when jsonb_typeof(page.final_page_data->'regions') = 'array'
            then page.final_page_data->'regions' else '[]'::jsonb end
        ) with ordinality region(value, ordinality)
        where length(trim(concat_ws(' ',
          nullif(trim(region.value->>'text'), ''),
          nullif(trim(region.value->>'label'), ''),
          nullif(trim(region.value->>'subject'), ''),
          nullif(trim(region.value->>'location'), ''),
          nullif(trim(region.value->>'evidenceText'), ''),
          nullif(trim(region.value->>'fact'), '')
        ))) > 0
      )), '') as search_text
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
  ), region_chunks as (
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
    region_chunks.job_id,
    region_chunks.organization_id,
    region_chunks.project_id,
    region_chunks.document_id,
    region_chunks.source_sha256,
    region_chunks.page_number,
    'region-text-' || region_chunks.chunk_index::text,
    region_chunks.chunk_index,
    region_chunks.chunk_text,
    region_chunks.sheet_number,
    null,
    jsonb_build_object(
      'regionText', true,
      'sheetMappingStatus', region_chunks.sheet_mapping_status,
      'sheetTitle', region_chunks.sheet_title,
      'pageIdentity', concat_ws(' — ',
        case when region_chunks.sheet_mapping_status = 'verified'
          then 'Sheet ' || region_chunks.sheet_number
          else 'PDF page ' || region_chunks.page_number::text end,
        region_chunks.sheet_title
      ),
      'assurance', region_chunks.assurance_result,
      'shadowValidation', true,
      'materialization', 'overlapping_assured_region_text'
    ),
    now()
  from region_chunks
  where length(trim(region_chunks.chunk_text)) > 0;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.ecos_sync_hosted_shadow_page_chunks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.ecos_hosted_shadow_chunks chunk
    where chunk.job_id = old.job_id and chunk.page_number = old.page_number;
    return old;
  end if;

  if tg_op = 'UPDATE'
    and (old.job_id, old.page_number) is distinct from (new.job_id, new.page_number) then
    delete from public.ecos_hosted_shadow_chunks chunk
    where chunk.job_id = old.job_id and chunk.page_number = old.page_number;
  end if;

  perform public.ecos_refresh_hosted_shadow_page(new.job_id, new.page_number);
  perform public.ecos_append_hosted_shadow_region_text(new.job_id, new.page_number);
  return new;
end;
$$;

create or replace function public.ecos_refresh_hosted_shadow_chunks(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_page integer;
  page_count integer := 0;
  refreshed_count integer := 0;
begin
  delete from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = p_job_id
    and not exists (
      select 1
      from public.ecos_hosted_index_pages page
      where page.job_id = chunk.job_id and page.page_number = chunk.page_number
    );

  for current_page in
    select page.page_number
    from public.ecos_hosted_index_pages page
    where page.job_id = p_job_id
    order by page.page_number
  loop
    page_count := public.ecos_refresh_hosted_shadow_page(p_job_id, current_page);
    refreshed_count := refreshed_count + page_count;
    page_count := public.ecos_append_hosted_shadow_region_text(p_job_id, current_page);
    refreshed_count := refreshed_count + page_count;
  end loop;

  return refreshed_count;
end;
$$;

revoke all on function public.ecos_append_hosted_shadow_region_text(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.ecos_sync_hosted_shadow_page_chunks()
  from public, anon, authenticated;
revoke all on function public.ecos_refresh_hosted_shadow_chunks(uuid)
  from public, anon, authenticated;
grant execute on function public.ecos_append_hosted_shadow_region_text(uuid, integer) to service_role;
grant execute on function public.ecos_refresh_hosted_shadow_chunks(uuid) to service_role;

commit;
