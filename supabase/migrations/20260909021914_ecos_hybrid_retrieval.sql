begin;

create extension if not exists vector with schema extensions;

create table if not exists public.ecos_hosted_chunk_embeddings (
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null check (length(btrim(project_id)) between 1 and 500),
  document_id text not null check (length(btrim(document_id)) between 1 and 200),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_version text not null check (evidence_version ~ '^ecos-hosted-evidence/[0-9]+\.[0-9]+$'),
  source_kind text not null check (source_kind in ('live', 'shadow')),
  page_number integer not null check (page_number between 1 and 10000),
  region_id text not null default '',
  chunk_index integer not null default 0 check (chunk_index >= 0),
  chunk_sha256 text not null check (chunk_sha256 ~ '^[a-f0-9]{64}$'),
  embedding_model text not null check (length(btrim(embedding_model)) between 3 and 120),
  embedding_dimensions integer not null check (embedding_dimensions = 1536),
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  primary key (job_id, page_number, region_id, chunk_index),
  constraint ecos_hosted_chunk_embedding_job_identity unique (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index
  )
);

create index if not exists ecos_hosted_chunk_embeddings_document_idx
  on public.ecos_hosted_chunk_embeddings (
    organization_id, project_id, document_id, source_kind, job_id
  );
create index if not exists ecos_hosted_chunk_embeddings_cosine_idx
  on public.ecos_hosted_chunk_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.ecos_hosted_chunk_embeddings enable row level security;
alter table public.ecos_hosted_chunk_embeddings force row level security;
revoke all on table public.ecos_hosted_chunk_embeddings from public, anon, authenticated;
grant select, insert, update, delete on table public.ecos_hosted_chunk_embeddings to service_role;

comment on table public.ecos_hosted_chunk_embeddings is
  'Vitruvius-owned semantic retrieval index. Embeddings are exact job/source/chunk derivatives and are never writable or readable by customer clients.';

create or replace function public.ecos_replace_hosted_shadow_chunk_embeddings(
  p_job_id uuid,
  p_claim_token uuid,
  p_embedding_model text,
  p_embedding_dimensions integer,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  selected_job public.ecos_hosted_index_jobs%rowtype;
  expected_count integer;
  inserted_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) > 25000 then
    raise exception 'Embedding rows must be a bounded JSON array';
  end if;
  if p_embedding_dimensions <> 1536
    or length(btrim(coalesce(p_embedding_model, ''))) not between 3 and 120 then
    raise exception 'Embedding identity is invalid';
  end if;

  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
    and job.claim_token = p_claim_token
    and job.mode = 'shadow'
    and job.state not in ('ready', 'cancelled', 'needs_review')
    and job.lease_expires_at > now()
  for update;
  if not found then
    raise exception 'Claimed shadow job was not found';
  end if;

  select count(*)::integer into expected_count
  from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = selected_job.id
    and chunk.organization_id = selected_job.organization_id
    and chunk.project_id = selected_job.project_id
    and chunk.document_id = selected_job.document_id
    and chunk.source_sha256 = selected_job.source_sha256;
  if expected_count = 0 or jsonb_array_length(p_rows) <> expected_count then
    raise exception 'Embedding row count does not match the exact shadow index';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) supplied(value)
    where jsonb_typeof(supplied.value) <> 'object'
      or jsonb_typeof(supplied.value->'embedding') <> 'array'
      or jsonb_array_length(supplied.value->'embedding') <> 1536
      or coalesce(supplied.value->>'pageNumber', '') !~ '^[1-9][0-9]{0,3}$'
      or coalesce(supplied.value->>'chunkIndex', '') !~ '^(0|[1-9][0-9]{0,8})$'
      or length(coalesce(supplied.value->>'regionId', '')) > 1000
      or coalesce(supplied.value->>'chunkSha256', '') !~ '^[a-f0-9]{64}$'
      or not exists (
        select 1
        from public.ecos_hosted_shadow_chunks chunk
        where chunk.job_id = selected_job.id
          and chunk.organization_id = selected_job.organization_id
          and chunk.project_id = selected_job.project_id
          and chunk.document_id = selected_job.document_id
          and chunk.source_sha256 = selected_job.source_sha256
          and chunk.page_number = (supplied.value->>'pageNumber')::integer
          and chunk.region_id = coalesce(supplied.value->>'regionId', '')
          and chunk.chunk_index = (supplied.value->>'chunkIndex')::integer
          and encode(digest(convert_to(
            left(btrim(concat_ws(' ', nullif(btrim(chunk.sheet_number), ''), chunk.chunk_text)), 6000),
            'UTF8'
          ), 'sha256'), 'hex') = supplied.value->>'chunkSha256'
      )
  ) then
    raise exception 'Embedding rows do not match the exact shadow chunks';
  end if;

  delete from public.ecos_hosted_chunk_embeddings embedding
  where embedding.job_id = selected_job.id;

  insert into public.ecos_hosted_chunk_embeddings (
    job_id, organization_id, project_id, document_id, source_sha256,
    evidence_version, source_kind, page_number, region_id, chunk_index,
    chunk_sha256, embedding_model, embedding_dimensions, embedding
  )
  select
    selected_job.id,
    selected_job.organization_id,
    selected_job.project_id,
    selected_job.document_id,
    selected_job.source_sha256,
    'ecos-hosted-evidence/1.3',
    'shadow',
    (supplied.value->>'pageNumber')::integer,
    coalesce(supplied.value->>'regionId', ''),
    (supplied.value->>'chunkIndex')::integer,
    supplied.value->>'chunkSha256',
    btrim(p_embedding_model),
    p_embedding_dimensions,
    ((supplied.value->'embedding')::text)::extensions.vector(1536)
  from jsonb_array_elements(p_rows) supplied(value);
  get diagnostics inserted_count = row_count;

  if inserted_count <> expected_count then
    raise exception 'Semantic index replacement was incomplete';
  end if;
  return inserted_count;
end;
$$;

revoke all on function public.ecos_replace_hosted_shadow_chunk_embeddings(
  uuid, uuid, text, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.ecos_replace_hosted_shadow_chunk_embeddings(
  uuid, uuid, text, integer, jsonb
) to service_role;

create or replace function public.ecos_search_hosted_semantic_chunks(
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
  with job_candidates as (
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
  ), preferred_jobs as (
    select candidate.*
    from (
      select candidate.*,
        min(candidate.source_priority) over (
          partition by candidate.document_id
        ) as preferred_priority
      from job_candidates candidate
    ) candidate
    where candidate.source_priority = candidate.preferred_priority
  ), eligible_jobs as (
    select candidate.*
    from (
      select candidate.*,
        count(*) over (partition by candidate.document_id) as exact_job_count
      from preferred_jobs candidate
    ) candidate
    where candidate.exact_job_count = 1
  ), live_candidates as (
    select
      job.job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.evidence_version,
      chunk.document_id,
      chunk.page_number,
      chunk.region_id,
      chunk.chunk_text,
      chunk.sheet_number,
      chunk.confidence,
      chunk.metadata || jsonb_build_object(
        'retrievalMode', 'semantic',
        'embeddingModel', embedding.embedding_model,
        'embeddingDimensions', embedding.embedding_dimensions
      ) as metadata,
      (1 - (embedding.embedding <=> p_query_embedding))::real as semantic_rank
    from eligible_jobs job
    join public.ecos_hosted_chunk_embeddings embedding
      on job.source_mode = 'live'
     and embedding.job_id = job.job_id
     and embedding.organization_id = job.organization_id
     and embedding.project_id = job.project_id
     and embedding.document_id = job.document_id
     and embedding.source_sha256 = job.source_sha256
     and embedding.evidence_version = job.evidence_version
     and embedding.source_kind = 'live'
    join public.ecos_hosted_document_chunks chunk
      on chunk.organization_id = embedding.organization_id
     and chunk.project_id = embedding.project_id
     and chunk.document_id = embedding.document_id
     and chunk.page_number = embedding.page_number
     and chunk.region_id = embedding.region_id
     and chunk.chunk_index = embedding.chunk_index
    join public.ecos_hosted_document_pages page
      on page.organization_id = chunk.organization_id
     and page.project_id = chunk.project_id
     and page.document_id = chunk.document_id
     and page.page_number = chunk.page_number
     and page.source_sha256 = embedding.source_sha256
     and page.evidence_version = embedding.evidence_version
  ),
  shadow_candidates as (
    select
      job.job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.evidence_version,
      chunk.document_id,
      chunk.page_number,
      chunk.region_id,
      chunk.chunk_text,
      chunk.sheet_number,
      chunk.confidence,
      chunk.metadata || jsonb_build_object(
        'retrievalMode', 'semantic',
        'embeddingModel', embedding.embedding_model,
        'embeddingDimensions', embedding.embedding_dimensions,
        'shadowPublication', true
      ) as metadata,
      (1 - (embedding.embedding <=> p_query_embedding))::real as semantic_rank
    from eligible_jobs job
    join public.ecos_hosted_chunk_embeddings embedding
      on job.source_mode = 'shadow'
     and embedding.job_id = job.job_id
     and embedding.organization_id = job.organization_id
     and embedding.project_id = job.project_id
     and embedding.document_id = job.document_id
     and embedding.source_sha256 = job.source_sha256
     and embedding.evidence_version = job.evidence_version
     and embedding.source_kind = 'shadow'
    join public.ecos_hosted_shadow_chunks chunk
      on chunk.job_id = embedding.job_id
     and chunk.organization_id = embedding.organization_id
     and chunk.project_id = embedding.project_id
     and chunk.document_id = embedding.document_id
     and chunk.source_sha256 = embedding.source_sha256
     and chunk.page_number = embedding.page_number
     and chunk.region_id = embedding.region_id
     and chunk.chunk_index = embedding.chunk_index
  ),
  candidates as (
    select * from live_candidates
    union all
    select * from shadow_candidates
  )
  select
    candidate.job_id,
    candidate.organization_id,
    candidate.project_id,
    candidate.source_sha256,
    candidate.evidence_version,
    candidate.document_id,
    candidate.page_number,
    candidate.region_id,
    candidate.chunk_text,
    candidate.sheet_number,
    candidate.confidence,
    candidate.metadata,
    candidate.semantic_rank
  from candidates candidate
  where candidate.semantic_rank >= 0.20
    and public.vitruvius_has_project_permission(
      candidate.organization_id,
      candidate.project_id,
      'ask_ecos'
    )
  order by candidate.semantic_rank desc, candidate.document_id, candidate.page_number, candidate.region_id
  limit greatest(1, least(coalesce(p_result_limit, 36), 100));
end;
$$;

revoke all on function public.ecos_search_hosted_semantic_chunks(
  extensions.vector, text[], integer
) from public, anon;
grant execute on function public.ecos_search_hosted_semantic_chunks(
  extensions.vector, text[], integer
) to authenticated;

create or replace function public.ecos_search_hosted_shadow_semantic_chunks(
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
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with job_candidates as (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.committed_evidence_version as evidence_version,
      job.document_id
    from public.ecos_hosted_index_jobs job
    where coalesce(auth.jwt()->>'role', '') = 'service_role'
      and job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and (p_document_ids is null or job.document_id = any(p_document_ids))
      and exists (
        select 1
        from public.ecos_hosted_chunk_embeddings candidate_embedding
        where candidate_embedding.job_id = job.id
          and candidate_embedding.organization_id = job.organization_id
          and candidate_embedding.project_id = job.project_id
          and candidate_embedding.document_id = job.document_id
          and candidate_embedding.source_sha256 = job.source_sha256
          and candidate_embedding.evidence_version = job.committed_evidence_version
          and candidate_embedding.source_kind = 'shadow'
      )
  ), eligible_jobs as (
    select candidate.*
    from (
      select candidate.*,
        count(*) over (partition by candidate.document_id) as exact_job_count
      from job_candidates candidate
    ) candidate
    where candidate.exact_job_count = 1
  )
  select
    job.job_id,
    job.organization_id,
    job.project_id,
    job.source_sha256,
    job.evidence_version,
    chunk.document_id,
    chunk.page_number,
    chunk.region_id,
    chunk.chunk_text,
    chunk.sheet_number,
    chunk.confidence,
    chunk.metadata || jsonb_build_object(
      'retrievalMode', 'semantic',
      'embeddingModel', embedding.embedding_model,
      'embeddingDimensions', embedding.embedding_dimensions,
      'shadowValidation', true
    ) as metadata,
    (1 - (embedding.embedding <=> p_query_embedding))::real as rank
  from public.ecos_hosted_chunk_embeddings embedding
  join eligible_jobs job
    on job.job_id = embedding.job_id
   and job.organization_id = embedding.organization_id
   and job.project_id = embedding.project_id
   and job.document_id = embedding.document_id
   and job.source_sha256 = embedding.source_sha256
   and job.evidence_version = embedding.evidence_version
  join public.ecos_hosted_shadow_chunks chunk
    on chunk.job_id = embedding.job_id
   and chunk.organization_id = embedding.organization_id
   and chunk.project_id = embedding.project_id
   and chunk.document_id = embedding.document_id
   and chunk.source_sha256 = embedding.source_sha256
   and chunk.page_number = embedding.page_number
   and chunk.region_id = embedding.region_id
   and chunk.chunk_index = embedding.chunk_index
  where embedding.source_kind = 'shadow'
    and p_query_embedding is not null
    and (p_document_ids is null or chunk.document_id = any(p_document_ids))
    and (1 - (embedding.embedding <=> p_query_embedding)) >= 0.20
  order by embedding.embedding <=> p_query_embedding,
    chunk.document_id, chunk.page_number, chunk.region_id
  limit greatest(1, least(coalesce(p_result_limit, 36), 100));
$$;

revoke all on function public.ecos_search_hosted_shadow_semantic_chunks(
  extensions.vector, text[], integer
) from public, anon, authenticated;
grant execute on function public.ecos_search_hosted_shadow_semantic_chunks(
  extensions.vector, text[], integer
) to service_role;

commit;
