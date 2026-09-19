begin;

create index if not exists ecos_hosted_chunk_embeddings_source_job_idx
  on public.ecos_hosted_chunk_embeddings (source_kind, job_id);

create or replace function public.ecos_search_hosted_semantic_chunks_v21(
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
declare
  normalized_ids text[];
  bounded_limit integer := greatest(1, least(coalesce(p_result_limit, 36), 100));
begin
  if p_query_embedding is null then
    raise invalid_parameter_value using message = 'query embedding required';
  end if;
  if p_document_ids is null or cardinality(p_document_ids) not between 1 and 200 then
    raise invalid_parameter_value using message = 'one to 200 exact document ids required';
  end if;
  if exists (
    select 1
    from unnest(p_document_ids) requested(document_id)
    where requested.document_id is null
      or length(requested.document_id) not between 1 and 200
      or requested.document_id <> btrim(requested.document_id)
  ) then
    raise invalid_parameter_value using message = 'canonical document ids required';
  end if;

  select array_agg(distinct requested.document_id order by requested.document_id)
  into normalized_ids
  from unnest(p_document_ids) requested(document_id);

  return query
  with job_candidates as materialized (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.committed_evidence_version as evidence_version,
      job.document_id,
      1 as source_priority,
      'live'::text as source_mode
    from public.ecos_hosted_index_jobs job
    where job.mode = 'live'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.pie_layer4_has_active_membership(job.organization_id)
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and public.vitruvius_has_project_permission(job.organization_id, job.project_id, 'ask_ecos')
      and job.document_id = any(normalized_ids)
      and exists (
        select 1
        from public.ecos_hosted_document_pages page
        where page.organization_id = job.organization_id
          and page.project_id = job.project_id
          and page.document_id = job.document_id
          and page.source_sha256 = job.source_sha256
          and page.evidence_version = job.committed_evidence_version
      )
      and exists (
        select 1
        from public.ecos_hosted_chunk_embeddings embedding
        where embedding.job_id = job.id
          and embedding.organization_id = job.organization_id
          and embedding.project_id = job.project_id
          and embedding.document_id = job.document_id
          and embedding.source_sha256 = job.source_sha256
          and embedding.evidence_version = job.committed_evidence_version
          and embedding.source_kind = 'live'
      )
    union all
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.committed_evidence_version as evidence_version,
      job.document_id,
      0 as source_priority,
      'shadow'::text as source_mode
    from public.ecos_hosted_index_jobs job
    join public.ecos_hosted_index_configuration configuration
      on configuration.organization_id = job.organization_id
     and configuration.enabled = true
     and configuration.publication_mode = 'live'
    where job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.pie_layer4_has_active_membership(job.organization_id)
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and public.vitruvius_has_project_permission(job.organization_id, job.project_id, 'ask_ecos')
      and job.document_id = any(normalized_ids)
      and exists (
        select 1
        from public.ecos_hosted_chunk_embeddings embedding
        where embedding.job_id = job.id
          and embedding.organization_id = job.organization_id
          and embedding.project_id = job.project_id
          and embedding.document_id = job.document_id
          and embedding.source_sha256 = job.source_sha256
          and embedding.evidence_version = job.committed_evidence_version
          and embedding.source_kind = 'shadow'
      )
  ), preferred_jobs as materialized (
    select candidate.*
    from (
      select candidate.*,
        min(candidate.source_priority) over (partition by candidate.document_id) as preferred_priority
      from job_candidates candidate
    ) candidate
    where candidate.source_priority = candidate.preferred_priority
  ), eligible_jobs as materialized (
    select candidate.*
    from (
      select candidate.*,
        count(*) over (partition by candidate.document_id) as exact_job_count
      from preferred_jobs candidate
    ) candidate
    where candidate.exact_job_count = 1
  ), live_job_ids as materialized (
    select array_agg(candidate.job_id)::uuid[] as ids
    from eligible_jobs candidate
    where candidate.source_mode = 'live'
  ), shadow_job_ids as materialized (
    select array_agg(candidate.job_id)::uuid[] as ids
    from eligible_jobs candidate
    where candidate.source_mode = 'shadow'
  ), nearest_live as materialized (
    select
      embedding.*,
      (embedding.embedding <=> p_query_embedding) as distance
    from public.ecos_hosted_chunk_embeddings embedding
    where embedding.source_kind = 'live'
      and embedding.job_id = any(coalesce((select ids from live_job_ids), '{}'::uuid[]))
    order by embedding.embedding <=> p_query_embedding
    limit bounded_limit
  ), nearest_shadow as materialized (
    select
      embedding.*,
      (embedding.embedding <=> p_query_embedding) as distance
    from public.ecos_hosted_chunk_embeddings embedding
    where embedding.source_kind = 'shadow'
      and embedding.job_id = any(coalesce((select ids from shadow_job_ids), '{}'::uuid[]))
    order by embedding.embedding <=> p_query_embedding
    limit bounded_limit
  ), nearest as materialized (
    select * from nearest_live
    union all
    select * from nearest_shadow
    order by distance
    limit bounded_limit
  ), live_results as (
    select
      candidate.job_id,
      candidate.organization_id,
      candidate.project_id,
      candidate.source_sha256,
      candidate.evidence_version,
      chunk.document_id,
      chunk.page_number,
      chunk.region_id,
      chunk.chunk_text,
      chunk.sheet_number,
      chunk.confidence,
      chunk.metadata || jsonb_build_object(
        'retrievalMode', 'semantic',
        'embeddingModel', candidate.embedding_model,
        'embeddingDimensions', candidate.embedding_dimensions
      ) as metadata,
      (1 - candidate.distance)::real as rank
    from nearest candidate
    join eligible_jobs job
      on job.job_id = candidate.job_id
     and job.source_mode = 'live'
    join public.ecos_hosted_document_chunks chunk
      on chunk.organization_id = candidate.organization_id
     and chunk.project_id = candidate.project_id
     and chunk.document_id = candidate.document_id
     and chunk.page_number = candidate.page_number
     and chunk.region_id = candidate.region_id
     and chunk.chunk_index = candidate.chunk_index
    join public.ecos_hosted_document_pages page
      on page.organization_id = chunk.organization_id
     and page.project_id = chunk.project_id
     and page.document_id = chunk.document_id
     and page.page_number = chunk.page_number
     and page.source_sha256 = candidate.source_sha256
     and page.evidence_version = candidate.evidence_version
    where (1 - candidate.distance) >= 0.20
  ), shadow_results as (
    select
      candidate.job_id,
      candidate.organization_id,
      candidate.project_id,
      candidate.source_sha256,
      candidate.evidence_version,
      chunk.document_id,
      chunk.page_number,
      chunk.region_id,
      chunk.chunk_text,
      chunk.sheet_number,
      chunk.confidence,
      chunk.metadata || jsonb_build_object(
        'retrievalMode', 'semantic',
        'embeddingModel', candidate.embedding_model,
        'embeddingDimensions', candidate.embedding_dimensions,
        'shadowPublication', true
      ) as metadata,
      (1 - candidate.distance)::real as rank
    from nearest candidate
    join eligible_jobs job
      on job.job_id = candidate.job_id
     and job.source_mode = 'shadow'
    join public.ecos_hosted_shadow_chunks chunk
      on chunk.job_id = candidate.job_id
     and chunk.organization_id = candidate.organization_id
     and chunk.project_id = candidate.project_id
     and chunk.document_id = candidate.document_id
     and chunk.source_sha256 = candidate.source_sha256
     and chunk.page_number = candidate.page_number
     and chunk.region_id = candidate.region_id
     and chunk.chunk_index = candidate.chunk_index
    where (1 - candidate.distance) >= 0.20
  )
  select result.*
  from (
    select * from live_results
    union all
    select * from shadow_results
  ) result
  order by result.rank desc, result.document_id, result.page_number, result.region_id
  limit bounded_limit;
end;
$$;

revoke all on function public.ecos_search_hosted_semantic_chunks_v21(
  extensions.vector, text[], integer
) from public, anon;
grant execute on function public.ecos_search_hosted_semantic_chunks_v21(
  extensions.vector, text[], integer
) to authenticated;

create or replace function public.ecos_search_hosted_shadow_semantic_chunks_v21(
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
declare
  normalized_ids text[];
  bounded_limit integer := greatest(1, least(coalesce(p_result_limit, 36), 100));
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;
  if p_query_embedding is null then
    raise invalid_parameter_value using message = 'query embedding required';
  end if;
  if p_document_ids is null or cardinality(p_document_ids) not between 1 and 200 then
    raise invalid_parameter_value using message = 'one to 200 exact document ids required';
  end if;
  if exists (
    select 1
    from unnest(p_document_ids) requested(document_id)
    where requested.document_id is null
      or length(requested.document_id) not between 1 and 200
      or requested.document_id <> btrim(requested.document_id)
  ) then
    raise invalid_parameter_value using message = 'canonical document ids required';
  end if;

  select array_agg(distinct requested.document_id order by requested.document_id)
  into normalized_ids
  from unnest(p_document_ids) requested(document_id);

  return query
  with job_candidates as materialized (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.committed_evidence_version as evidence_version,
      job.document_id
    from public.ecos_hosted_index_jobs job
    where job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and job.document_id = any(normalized_ids)
      and exists (
        select 1
        from public.ecos_hosted_chunk_embeddings embedding
        where embedding.job_id = job.id
          and embedding.organization_id = job.organization_id
          and embedding.project_id = job.project_id
          and embedding.document_id = job.document_id
          and embedding.source_sha256 = job.source_sha256
          and embedding.evidence_version = job.committed_evidence_version
          and embedding.source_kind = 'shadow'
      )
  ), eligible_jobs as materialized (
    select candidate.*
    from (
      select candidate.*,
        count(*) over (partition by candidate.document_id) as exact_job_count
      from job_candidates candidate
    ) candidate
    where candidate.exact_job_count = 1
  ), eligible_job_ids as materialized (
    select array_agg(candidate.job_id)::uuid[] as ids
    from eligible_jobs candidate
  ), nearest as materialized (
    select
      embedding.*,
      (embedding.embedding <=> p_query_embedding) as distance
    from public.ecos_hosted_chunk_embeddings embedding
    where embedding.source_kind = 'shadow'
      and embedding.job_id = any(coalesce((select ids from eligible_job_ids), '{}'::uuid[]))
    order by embedding.embedding <=> p_query_embedding
    limit bounded_limit
  )
  select result.*
  from (
  select
    candidate.job_id,
    candidate.organization_id,
    candidate.project_id,
    candidate.source_sha256,
    candidate.evidence_version,
    chunk.document_id,
    chunk.page_number,
    chunk.region_id,
    chunk.chunk_text,
    chunk.sheet_number,
    chunk.confidence,
    chunk.metadata || jsonb_build_object(
      'retrievalMode', 'semantic',
      'embeddingModel', candidate.embedding_model,
      'embeddingDimensions', candidate.embedding_dimensions,
      'shadowValidation', true
    ) as metadata,
    (1 - candidate.distance)::real as rank
  from nearest candidate
  join eligible_jobs job
    on job.job_id = candidate.job_id
  join public.ecos_hosted_shadow_chunks chunk
    on chunk.job_id = candidate.job_id
   and chunk.organization_id = candidate.organization_id
   and chunk.project_id = candidate.project_id
   and chunk.document_id = candidate.document_id
   and chunk.source_sha256 = candidate.source_sha256
   and chunk.page_number = candidate.page_number
   and chunk.region_id = candidate.region_id
   and chunk.chunk_index = candidate.chunk_index
  where (1 - candidate.distance) >= 0.20
  ) result
  order by result.rank desc, result.document_id, result.page_number, result.region_id
  limit bounded_limit;
end;
$$;

revoke all on function public.ecos_search_hosted_shadow_semantic_chunks_v21(
  extensions.vector, text[], integer
) from public, anon, authenticated;
grant execute on function public.ecos_search_hosted_shadow_semantic_chunks_v21(
  extensions.vector, text[], integer
) to service_role;

commit;
