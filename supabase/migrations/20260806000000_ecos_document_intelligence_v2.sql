-- ECOS Document Intelligence 2.0
--
-- Persists fail-closed sheet mapping and structured visual evidence. A sheet
-- number is copied into the searchable index only when independent mapping
-- evidence verified it. Conflicted and unverified pages remain searchable by
-- PDF page number but can never be presented as an exact sheet citation.

begin;

create extension if not exists pg_trgm with schema extensions;

alter table public.ecos_document_pages
  add column if not exists sheet_title text,
  add column if not exists sheet_mapping_status text,
  add column if not exists sheet_mapping_confidence numeric(6,5),
  add column if not exists sheet_mapping_candidates jsonb not null default '[]'::jsonb,
  add column if not exists visual_coverage jsonb,
  add column if not exists index_schema_version text;

alter table public.ecos_document_pages
  add constraint ecos_document_pages_sheet_mapping_status_check
    check (sheet_mapping_status is null or sheet_mapping_status in ('verified', 'conflicted', 'unverified')),
  add constraint ecos_document_pages_sheet_mapping_confidence_check
    check (sheet_mapping_confidence is null or
      (sheet_mapping_confidence >= 0 and sheet_mapping_confidence <= 1)),
  add constraint ecos_document_pages_sheet_mapping_candidates_check
    check (jsonb_typeof(sheet_mapping_candidates) = 'array'),
  add constraint ecos_document_pages_visual_coverage_check
    check (visual_coverage is null or jsonb_typeof(visual_coverage) = 'object');

create index if not exists ecos_document_pages_mapping_status_idx
  on public.ecos_document_pages (owner_id, document_id, sheet_mapping_status, page_number);

create index if not exists ecos_document_chunks_fuzzy_text_idx
  on public.ecos_document_chunks using gin (lower(chunk_text) extensions.gin_trgm_ops);

create or replace function public.ecos_replace_document_index(
  p_document_id text,
  p_source_sha256 text,
  p_extraction_method text,
  p_pages jsonb
)
returns table(indexed_pages integer, indexed_chunks integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_owner uuid := auth.uid();
begin
  if current_owner is null or not public.dave_is_app_owner() then
    raise exception 'ECOS document indexing requires the authorized app owner';
  end if;
  if p_document_id is null or length(trim(p_document_id)) = 0 then
    raise exception 'ECOS document id is required';
  end if;
  if jsonb_typeof(coalesce(p_pages, '[]'::jsonb)) <> 'array' then
    raise exception 'ECOS pages must be a JSON array';
  end if;
  if not exists (
    select 1 from public.reference_documents source
    where source.owner_id = current_owner
      and source.id::text = p_document_id
  ) then
    raise exception 'The indexed source document is not available to this owner';
  end if;

  delete from public.ecos_document_chunks
  where owner_id = current_owner and document_id = p_document_id;
  delete from public.ecos_document_pages
  where owner_id = current_owner and document_id = p_document_id;

  insert into public.ecos_document_pages (
    owner_id, document_id, page_number, sheet_number, sheet_title,
    sheet_mapping_status, sheet_mapping_confidence, sheet_mapping_candidates,
    visual_coverage, index_schema_version, title, page_text, regions,
    extraction_method, confidence, source_sha256, indexed_at
  )
  select
    current_owner,
    p_document_id,
    (page.value->>'pageNumber')::integer,
    case when page.value->>'sheetMappingStatus' = 'verified'
      then nullif(trim(page.value->>'sheetNumber'), '') else null end,
    nullif(left(trim(page.value->>'sheetTitle'), 500), ''),
    case when page.value->>'sheetMappingStatus' in ('verified', 'conflicted', 'unverified')
      then page.value->>'sheetMappingStatus' else 'unverified' end,
    case when (page.value->>'sheetMappingConfidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
      then least(1, greatest(0, (page.value->>'sheetMappingConfidence')::numeric)) else null end,
    coalesce(page.value->'sheetMappingCandidates', '[]'::jsonb),
    case when jsonb_typeof(page.value->'visualCoverage') = 'object'
      then page.value->'visualCoverage' else null end,
    'ecos-document-intelligence/2.0',
    nullif(left(trim(page.value->>'title'), 500), ''),
    nullif(left(trim(page.value->>'text'), 100000), ''),
    coalesce(page.value->'regions', '[]'::jsonb),
    nullif(trim(p_extraction_method), ''),
    confidence.average_confidence,
    case when lower(coalesce(p_source_sha256, '')) ~ '^[a-f0-9]{64}$'
      then lower(p_source_sha256) else null end,
    now()
  from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) page(value)
  left join lateral (
    select avg((region.value->>'confidence')::numeric) as average_confidence
    from jsonb_array_elements(coalesce(page.value->'regions', '[]'::jsonb)) region(value)
    where (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
  ) confidence on true
  where (page.value->>'pageNumber') ~ '^[1-9][0-9]*$';

  insert into public.ecos_document_chunks (
    owner_id, document_id, page_number, region_id, chunk_index,
    chunk_text, sheet_number, confidence, metadata, indexed_at
  )
  select
    current_owner,
    p_document_id,
    (page.value->>'pageNumber')::integer,
    coalesce(nullif(trim(region.value->>'id'), ''), ''),
    greatest(region.ordinality::integer - 1, 0),
    left(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label')), 4000),
    case when page.value->>'sheetMappingStatus' = 'verified'
      then nullif(trim(page.value->>'sheetNumber'), '') else null end,
    case when (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
      then (region.value->>'confidence')::numeric else null end,
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
      'sheetMappingStatus', coalesce(page.value->>'sheetMappingStatus', 'unverified'),
      'sheetMappingConfidence', page.value->'sheetMappingConfidence',
      'visualCoverage', page.value->'visualCoverage'
    ),
    now()
  from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) page(value)
  cross join lateral jsonb_array_elements(coalesce(page.value->'regions', '[]'::jsonb))
    with ordinality region(value, ordinality)
  where (page.value->>'pageNumber') ~ '^[1-9][0-9]*$'
    and length(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label'))) > 0;

  insert into public.ecos_document_chunks (
    owner_id, document_id, page_number, region_id, chunk_index,
    chunk_text, sheet_number, confidence, metadata, indexed_at
  )
  select
    current_owner,
    p_document_id,
    (page.value->>'pageNumber')::integer,
    '',
    0,
    left(trim(page.value->>'text'), 4000),
    case when page.value->>'sheetMappingStatus' = 'verified'
      then nullif(trim(page.value->>'sheetNumber'), '') else null end,
    null,
    jsonb_build_object(
      'fallback', true,
      'sheetMappingStatus', coalesce(page.value->>'sheetMappingStatus', 'unverified'),
      'sheetMappingConfidence', page.value->'sheetMappingConfidence',
      'visualCoverage', page.value->'visualCoverage'
    ),
    now()
  from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) page(value)
  where (page.value->>'pageNumber') ~ '^[1-9][0-9]*$'
    and jsonb_array_length(coalesce(page.value->'regions', '[]'::jsonb)) = 0
    and length(trim(page.value->>'text')) > 0;

  return query
    select
      (select count(*)::integer from public.ecos_document_pages
       where owner_id = current_owner and document_id = p_document_id),
      (select count(*)::integer from public.ecos_document_chunks
       where owner_id = current_owner and document_id = p_document_id);
end
$$;

create or replace function public.ecos_search_document_chunks(
  p_search_query text,
  p_document_ids text[] default null,
  p_result_limit integer default 12
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
security invoker
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
      ts_rank_cd(
        chunk.search_vector,
        websearch_to_tsquery('simple', coalesce(p_search_query, ''))
      ) as lexical_rank,
      extensions.similarity(lower(chunk.chunk_text), lower(coalesce(p_search_query, ''))) as fuzzy_rank
    from public.ecos_document_chunks chunk
    where chunk.owner_id = auth.uid()
      and public.dave_is_app_owner()
      and length(trim(coalesce(p_search_query, ''))) > 0
      and (p_document_ids is null or chunk.document_id = any(p_document_ids))
      and (
        chunk.search_vector @@ websearch_to_tsquery('simple', p_search_query) or
        extensions.similarity(lower(chunk.chunk_text), lower(p_search_query)) >= 0.18
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
    (scored.lexical_rank * 0.82 + scored.fuzzy_rank * 0.18)::real as rank
  from scored
  order by rank desc, confidence desc nulls last, page_number
  limit greatest(1, least(coalesce(p_result_limit, 12), 50));
$$;

-- Durable page checkpoints keep lengthy re-indexing work resumable. The
-- current production index is not replaced until all checkpointed pages pass
-- client and database validation and the normal replacement RPC succeeds.
create table if not exists public.ecos_document_index_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_page_count integer not null check (source_page_count > 0 and source_page_count <= 10000),
  status text not null default 'running' check (status in ('running', 'ready', 'committed', 'failed', 'cancelled')),
  completed_page_count integer not null default 0 check (completed_page_count >= 0),
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, document_id, source_sha256)
);

create table if not exists public.ecos_document_index_job_pages (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.ecos_document_index_jobs(id) on delete cascade,
  page_number integer not null check (page_number > 0 and page_number <= 10000),
  page_data jsonb not null check (jsonb_typeof(page_data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (owner_id, job_id, page_number)
);

alter table public.ecos_document_index_jobs enable row level security;
alter table public.ecos_document_index_jobs force row level security;
alter table public.ecos_document_index_job_pages enable row level security;
alter table public.ecos_document_index_job_pages force row level security;

revoke all on table public.ecos_document_index_jobs from public, anon;
revoke all on table public.ecos_document_index_job_pages from public, anon;
grant select, insert, update, delete on table public.ecos_document_index_jobs to authenticated;
grant select, insert, update, delete on table public.ecos_document_index_job_pages to authenticated;

create policy ecos_document_index_jobs_owner_all
  on public.ecos_document_index_jobs for all to authenticated
  using ((select public.dave_is_app_owner()) and owner_id = (select auth.uid()))
  with check (
    (select public.dave_is_app_owner()) and owner_id = (select auth.uid()) and
    exists (
      select 1 from public.reference_documents source
      where source.owner_id = (select auth.uid()) and source.id::text = document_id
    )
  );

create policy ecos_document_index_job_pages_owner_all
  on public.ecos_document_index_job_pages for all to authenticated
  using ((select public.dave_is_app_owner()) and owner_id = (select auth.uid()))
  with check (
    (select public.dave_is_app_owner()) and owner_id = (select auth.uid()) and
    exists (
      select 1 from public.ecos_document_index_jobs job
      where job.id = ecos_document_index_job_pages.job_id
        and job.owner_id = (select auth.uid())
    )
  );

create index if not exists ecos_document_index_jobs_resume_idx
  on public.ecos_document_index_jobs (owner_id, document_id, source_sha256, updated_at desc);

create index if not exists ecos_document_index_job_pages_resume_idx
  on public.ecos_document_index_job_pages (owner_id, job_id, page_number);

commit;
