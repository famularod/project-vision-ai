-- ECOS hosted shadow retrieval index
--
-- Materializes each Assurance-approved shadow page when its checkpoint is
-- written. Ask ECOS can then search indexed text instead of repeatedly expanding
-- every page's JSON regions for every question token. The table and refresh
-- functions remain service-only and do not publish shadow evidence to customers.

begin;

create table if not exists public.ecos_hosted_shadow_chunks (
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  document_id text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  page_number integer not null check (page_number between 1 and 10000),
  region_id text not null default '',
  chunk_index integer not null default 0 check (chunk_index >= 0),
  chunk_text text not null check (length(trim(chunk_text)) between 1 and 4000),
  sheet_number text,
  confidence numeric(6,5) check (confidence is null or confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(sheet_number, '') || ' ' || chunk_text)
  ) stored,
  indexed_at timestamptz not null default now(),
  primary key (job_id, page_number, region_id, chunk_index)
);

create index if not exists ecos_hosted_shadow_chunks_document_idx
  on public.ecos_hosted_shadow_chunks (document_id, page_number, job_id);
create index if not exists ecos_hosted_shadow_chunks_search_idx
  on public.ecos_hosted_shadow_chunks using gin (search_vector);
create index if not exists ecos_hosted_shadow_chunks_fuzzy_idx
  on public.ecos_hosted_shadow_chunks using gin (lower(chunk_text) extensions.gin_trgm_ops);

alter table public.ecos_hosted_shadow_chunks enable row level security;
alter table public.ecos_hosted_shadow_chunks force row level security;
revoke all on table public.ecos_hosted_shadow_chunks from public, anon, authenticated;
grant all on table public.ecos_hosted_shadow_chunks to service_role;

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
  fallback_count integer := 0;
begin
  delete from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = p_job_id and chunk.page_number = p_page_number;

  with raw_regions as (
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
      region.ordinality::integer as region_ordinality,
      coalesce(nullif(trim(region.value->>'id'), ''), 'region-' || region.ordinality::text) as source_region_id,
      coalesce(nullif(region.value->>'source', ''), 'unknown') as region_source,
      case when jsonb_typeof(region.value->'areaNames') = 'array'
        then region.value->'areaNames' else '[]'::jsonb end as area_names,
      nullif(trim(region.value->>'factKind'), '') as fact_kind,
      nullif(trim(region.value->>'subject'), '') as subject,
      nullif(trim(region.value->>'location'), '') as location,
      nullif(trim(region.value->>'evidenceText'), '') as evidence_text,
      trim(case
        when coalesce(region.value->>'source', '') = 'vision'
          or region.value ? 'factKind'
          or region.value ? 'subject'
          or region.value ? 'evidenceText'
        then concat_ws(' ',
          nullif(trim(region.value->>'text'), ''),
          nullif(trim(region.value->>'label'), ''),
          nullif(trim(region.value->>'subject'), ''),
          nullif(trim(region.value->>'location'), ''),
          nullif(trim(region.value->>'evidenceText'), ''),
          nullif(trim(region.value->>'fact'), '')
        )
        else coalesce(
          nullif(trim(region.value->>'text'), ''),
          nullif(trim(region.value->>'label'), ''),
          nullif(trim(region.value->>'evidenceText'), '')
        )
      end) as region_text,
      case when (region.value->>'x') ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        then (region.value->>'x')::numeric else 0 end as x,
      case when (region.value->>'y') ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        then (region.value->>'y')::numeric else 0 end as y,
      case when (region.value->>'width') ~ '^[0-9]+(?:\.[0-9]+)?$'
        then (region.value->>'width')::numeric else 0 end as width,
      case when (region.value->>'height') ~ '^[0-9]+(?:\.[0-9]+)?$'
        then (region.value->>'height')::numeric else 0 end as height,
      case when (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
        then (region.value->>'confidence')::numeric else null end as confidence,
      coalesce(region.value->>'source', '') = 'vision'
        or region.value ? 'factKind'
        or region.value ? 'subject'
        or region.value ? 'evidenceText' as is_structured,
      least(4, greatest(0, floor((case when (region.value->>'x') ~ '^[0-9]+(?:\.[0-9]+)?$'
        then (region.value->>'x')::numeric else 0 end) * 5)::integer)) as spatial_column,
      least(19, greatest(0, floor((case when (region.value->>'y') ~ '^[0-9]+(?:\.[0-9]+)?$'
        then (region.value->>'y')::numeric else 0 end) * 20)::integer)) as spatial_row
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
  ), ordered_regions as (
    select raw_regions.*,
      row_number() over (
        partition by job_id, page_number, is_structured, spatial_column, spatial_row
        order by y, x, region_ordinality
      ) as spatial_ordinality
    from raw_regions
    where length(region_text) > 0
  ), grouped_regions as (
    select
      job_id,
      organization_id,
      project_id,
      document_id,
      source_sha256,
      page_number,
      sheet_number,
      sheet_mapping_status,
      sheet_title,
      assurance_result,
      is_structured,
      spatial_column,
      spatial_row,
      case when is_structured then region_ordinality
        else floor((spatial_ordinality - 1) / 20.0)::integer end as group_index,
      min(source_region_id) as first_region_id,
      min(region_ordinality) as first_region_ordinality,
      left(trim(string_agg(region_text, ' ' order by y, x, region_ordinality)), 4000) as chunk_text,
      min(x) as x,
      min(y) as y,
      greatest(0, max(x + width) - min(x)) as width,
      greatest(0, max(y + height) - min(y)) as height,
      avg(confidence) as confidence,
      case when count(distinct region_source) = 1 then min(region_source) else 'mixed' end as region_source,
      coalesce((jsonb_agg(area_names) filter (where jsonb_array_length(area_names) > 0))->0, '[]'::jsonb) as area_names,
      max(fact_kind) as fact_kind,
      max(subject) as subject,
      max(location) as location,
      max(evidence_text) as evidence_text,
      jsonb_agg(source_region_id order by y, x, region_ordinality) as source_region_ids
    from ordered_regions
    group by
      job_id, organization_id, project_id, document_id, source_sha256,
      page_number, sheet_number, sheet_mapping_status, sheet_title,
      assurance_result, is_structured, spatial_column, spatial_row,
      case when is_structured then region_ordinality
        else floor((spatial_ordinality - 1) / 20.0)::integer end
  )
  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata, indexed_at
  )
  select
    grouped.job_id,
    grouped.organization_id,
    grouped.project_id,
    grouped.document_id,
    grouped.source_sha256,
    grouped.page_number,
    case when grouped.is_structured then grouped.first_region_id
      else format('cell-%s-%s-%s', grouped.spatial_column, grouped.spatial_row, grouped.group_index) end,
    greatest(grouped.group_index, 0),
    grouped.chunk_text,
    grouped.sheet_number,
    grouped.confidence,
    jsonb_build_object(
      'x', grouped.x,
      'y', grouped.y,
      'width', grouped.width,
      'height', grouped.height,
      'source', grouped.region_source,
      'sourceRegionIds', grouped.source_region_ids,
      'areaNames', grouped.area_names,
      'factKind', grouped.fact_kind,
      'subject', grouped.subject,
      'location', grouped.location,
      'evidenceText', grouped.evidence_text,
      'sheetMappingStatus', grouped.sheet_mapping_status,
      'sheetTitle', grouped.sheet_title,
      'pageIdentity', concat_ws(' — ',
        case when grouped.sheet_mapping_status = 'verified'
          then 'Sheet ' || grouped.sheet_number
          else 'PDF page ' || grouped.page_number::text end,
        grouped.sheet_title
      ),
      'assurance', grouped.assurance_result,
      'shadowValidation', true,
      'materialization', case when grouped.is_structured then 'structured_region' else 'spatial_text_group' end
    ),
    now()
  from grouped_regions grouped
  where length(grouped.chunk_text) > 0;

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
    'page',
    0,
    left(trim(page.final_page_data->>'text'), 4000),
    case when page.final_page_data->>'sheetMappingStatus' = 'verified'
      then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end,
    null,
    jsonb_build_object(
      'fallback', true,
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
    ),
    now()
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
    and jsonb_array_length(case when jsonb_typeof(page.final_page_data->'regions') = 'array'
      then page.final_page_data->'regions' else '[]'::jsonb end) = 0
    and length(trim(page.final_page_data->>'text')) > 0
    and source.document_data->>'isCurrent' = 'true'
    and source.document_data->>'drawingStatus' is distinct from 'Superseded'
    and lower(coalesce(
      nullif(source.document_data->>'contentSha256', ''),
      nullif(source.document_data->>'webFileFingerprint', ''),
      nullif(source.document_data->>'indexedContentSha256', '')
    )) = job.source_sha256;

  get diagnostics fallback_count = row_count;
  inserted_count := inserted_count + fallback_count;
  return inserted_count;
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
  end loop;

  return refreshed_count;
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
  return new;
end;
$$;

drop trigger if exists ecos_hosted_shadow_page_upsert_sync on public.ecos_hosted_index_pages;
create trigger ecos_hosted_shadow_page_upsert_sync
after insert or update of state, final_page_data, assurance_result, unresolved_region_count
on public.ecos_hosted_index_pages
for each row execute function public.ecos_sync_hosted_shadow_page_chunks();

drop trigger if exists ecos_hosted_shadow_page_delete_sync on public.ecos_hosted_index_pages;
create trigger ecos_hosted_shadow_page_delete_sync
after delete on public.ecos_hosted_index_pages
for each row execute function public.ecos_sync_hosted_shadow_page_chunks();

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
  with scored as (
    select
      chunk.document_id,
      chunk.page_number,
      chunk.region_id,
      chunk.chunk_text,
      chunk.sheet_number,
      chunk.confidence,
      chunk.metadata,
      greatest(
        ts_rank_cd(
          chunk.search_vector,
          websearch_to_tsquery('simple', coalesce(p_search_query, ''))
        ),
        extensions.similarity(lower(chunk.chunk_text), lower(coalesce(p_search_query, '')))
      )::real as rank
    from public.ecos_hosted_shadow_chunks chunk
    join public.ecos_hosted_index_jobs job
      on job.id = chunk.job_id
     and job.source_sha256 = chunk.source_sha256
    join public.reference_documents source
      on source.id::text = chunk.document_id
     and source.owner_id = job.source_owner_id
    where job.mode = 'shadow'
      and job.state = 'ready'
      and source.document_data->>'isCurrent' = 'true'
      and source.document_data->>'drawingStatus' is distinct from 'Superseded'
      and lower(coalesce(
        nullif(source.document_data->>'contentSha256', ''),
        nullif(source.document_data->>'webFileFingerprint', ''),
        nullif(source.document_data->>'indexedContentSha256', '')
      )) = chunk.source_sha256
      and length(trim(coalesce(p_search_query, ''))) > 0
      and (p_document_ids is null or chunk.document_id = any(p_document_ids))
      and (
        chunk.search_vector @@ websearch_to_tsquery('simple', p_search_query)
        or extensions.similarity(lower(chunk.chunk_text), lower(p_search_query)) >= 0.18
      )
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
  order by scored.rank desc, scored.document_id, scored.page_number, scored.region_id
  limit greatest(1, least(coalesce(p_result_limit, 24), 100));
$$;

revoke all on function public.ecos_refresh_hosted_shadow_page(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.ecos_refresh_hosted_shadow_chunks(uuid)
  from public, anon, authenticated;
revoke all on function public.ecos_sync_hosted_shadow_page_chunks()
  from public, anon, authenticated;
revoke all on function public.ecos_search_hosted_shadow_chunks(text, text[], integer)
  from public, anon, authenticated;
grant execute on function public.ecos_refresh_hosted_shadow_page(uuid, integer) to service_role;
grant execute on function public.ecos_refresh_hosted_shadow_chunks(uuid) to service_role;
grant execute on function public.ecos_search_hosted_shadow_chunks(text, text[], integer) to service_role;

commit;
