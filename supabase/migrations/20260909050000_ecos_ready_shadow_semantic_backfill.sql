-- Resumable semantic-only backfill for already-assured shadow evidence.
--
-- Historical evidence-1.3 jobs became ready before semantic embeddings were
-- required. Re-extracting those documents would spend provider capacity and
-- risk changing their already-verified lexical/visual evidence. This contract
-- stages exact chunk-bound vectors privately, then promotes a complete document
-- index in one transaction. Partial batches are never visible to retrieval.

begin;

create table if not exists public.ecos_hosted_semantic_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  run_token uuid not null default gen_random_uuid(),
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  document_id text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_version text not null check (
    evidence_version ~ '^ecos-hosted-evidence/[0-9]+\.[0-9]+$'
  ),
  embedding_model text not null check (length(btrim(embedding_model)) between 3 and 120),
  embedding_dimensions integer not null check (embedding_dimensions = 1536),
  expected_chunk_count integer not null check (expected_chunk_count between 1 and 25000),
  state text not null default 'staging' check (state in ('staging', 'committed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz
);

create unique index if not exists ecos_hosted_semantic_backfill_one_staging_job_idx
  on public.ecos_hosted_semantic_backfill_runs (job_id)
  where state = 'staging';
create index if not exists ecos_hosted_semantic_backfill_job_created_idx
  on public.ecos_hosted_semantic_backfill_runs (job_id, created_at desc);

create table if not exists public.ecos_hosted_semantic_backfill_embeddings (
  run_id uuid not null references public.ecos_hosted_semantic_backfill_runs(id) on delete cascade,
  page_number integer not null check (page_number between 1 and 10000),
  region_id text not null default '',
  chunk_index integer not null check (chunk_index >= 0),
  chunk_sha256 text not null check (chunk_sha256 ~ '^[a-f0-9]{64}$'),
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, page_number, region_id, chunk_index)
);

alter table public.ecos_hosted_semantic_backfill_runs enable row level security;
alter table public.ecos_hosted_semantic_backfill_runs force row level security;
alter table public.ecos_hosted_semantic_backfill_embeddings enable row level security;
alter table public.ecos_hosted_semantic_backfill_embeddings force row level security;
revoke all on table public.ecos_hosted_semantic_backfill_runs
  from public, anon, authenticated;
revoke all on table public.ecos_hosted_semantic_backfill_embeddings
  from public, anon, authenticated;
grant select, insert, update, delete on table public.ecos_hosted_semantic_backfill_runs
  to service_role;
grant select, insert, update, delete on table public.ecos_hosted_semantic_backfill_embeddings
  to service_role;

comment on table public.ecos_hosted_semantic_backfill_runs is
  'Private resumable receipts for semantic-only preparation of immutable ready shadow evidence.';
comment on table public.ecos_hosted_semantic_backfill_embeddings is
  'Private incomplete embedding batches. Retrieval never reads this staging table.';

create or replace function public.ecos_begin_ready_shadow_semantic_backfill(
  p_job_id uuid,
  p_expected_source_sha256 text,
  p_expected_evidence_version text,
  p_embedding_model text,
  p_embedding_dimensions integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  selected_job public.ecos_hosted_index_jobs%rowtype;
  active_run public.ecos_hosted_semantic_backfill_runs%rowtype;
  expected_count integer;
  staged_count integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Semantic backfill authorization required';
  end if;
  if coalesce(p_expected_source_sha256, '') !~ '^[a-f0-9]{64}$'
    or p_expected_evidence_version <> 'ecos-hosted-evidence/1.3'
    or p_embedding_dimensions <> 1536
    or length(btrim(coalesce(p_embedding_model, ''))) not between 3 and 120 then
    raise exception 'Semantic backfill identity is invalid';
  end if;

  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
  for update;
  if not found
    or selected_job.mode <> 'shadow'
    or selected_job.state <> 'ready'
    or selected_job.source_sha256 <> p_expected_source_sha256
    or selected_job.committed_evidence_version <> p_expected_evidence_version
    or selected_job.claim_token is not null
    or selected_job.lease_expires_at is not null then
    raise exception 'Exact idle ready shadow job was not found';
  end if;
  if not public.ecos_hosted_job_matches_reference(selected_job.id, true) then
    raise exception 'Ready shadow job no longer matches the current reference document';
  end if;

  select count(*)::integer into expected_count
  from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = selected_job.id
    and chunk.organization_id = selected_job.organization_id
    and chunk.project_id = selected_job.project_id
    and chunk.document_id = selected_job.document_id
    and chunk.source_sha256 = selected_job.source_sha256;
  if expected_count not between 1 and 25000 then
    raise exception 'Exact shadow chunk inventory is outside the semantic limit';
  end if;

  select run.* into active_run
  from public.ecos_hosted_semantic_backfill_runs run
  where run.job_id = selected_job.id
    and run.state = 'staging'
  for update;
  if found then
    if active_run.organization_id <> selected_job.organization_id
      or active_run.project_id <> selected_job.project_id
      or active_run.document_id <> selected_job.document_id
      or active_run.source_sha256 <> selected_job.source_sha256
      or active_run.evidence_version <> selected_job.committed_evidence_version
      or active_run.embedding_model <> btrim(p_embedding_model)
      or active_run.embedding_dimensions <> p_embedding_dimensions
      or active_run.expected_chunk_count <> expected_count then
      raise exception 'An incompatible semantic backfill is already active';
    end if;
  else
    insert into public.ecos_hosted_semantic_backfill_runs (
      job_id, organization_id, project_id, document_id, source_sha256,
      evidence_version, embedding_model, embedding_dimensions, expected_chunk_count
    ) values (
      selected_job.id, selected_job.organization_id, selected_job.project_id,
      selected_job.document_id, selected_job.source_sha256,
      selected_job.committed_evidence_version, btrim(p_embedding_model),
      p_embedding_dimensions, expected_count
    ) returning * into active_run;
  end if;

  select count(*)::integer into staged_count
  from public.ecos_hosted_semantic_backfill_embeddings staged
  where staged.run_id = active_run.id;

  return jsonb_build_object(
    'runId', active_run.id,
    'runToken', active_run.run_token,
    'jobId', active_run.job_id,
    'expectedChunkCount', active_run.expected_chunk_count,
    'stagedChunkCount', staged_count,
    'state', active_run.state
  );
end;
$$;

create or replace function public.ecos_stage_ready_shadow_semantic_backfill_batch(
  p_run_id uuid,
  p_run_token uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  selected_run public.ecos_hosted_semantic_backfill_runs%rowtype;
  selected_job public.ecos_hosted_index_jobs%rowtype;
  supplied_count integer;
  unique_count integer;
  staged_count integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Semantic backfill authorization required';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 128 then
    raise exception 'Semantic backfill batch must contain 1 to 128 rows';
  end if;

  select run.* into selected_run
  from public.ecos_hosted_semantic_backfill_runs run
  where run.id = p_run_id
    and run.run_token = p_run_token
    and run.state = 'staging'
  for update;
  if not found then raise exception 'Active semantic backfill was not found'; end if;

  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where job.id = selected_run.job_id
  for share;
  if not found
    or selected_job.mode <> 'shadow'
    or selected_job.state <> 'ready'
    or selected_job.organization_id <> selected_run.organization_id
    or selected_job.project_id <> selected_run.project_id
    or selected_job.document_id <> selected_run.document_id
    or selected_job.source_sha256 <> selected_run.source_sha256
    or selected_job.committed_evidence_version <> selected_run.evidence_version
    or selected_job.claim_token is not null
    or selected_job.lease_expires_at is not null
    or not public.ecos_hosted_job_matches_reference(selected_job.id, true) then
    raise exception 'Ready shadow evidence changed during semantic backfill';
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
  ) then
    raise exception 'Semantic backfill row shape is invalid';
  end if;

  supplied_count := jsonb_array_length(p_rows);
  select count(*)::integer into unique_count
  from (
    select
      (supplied.value->>'pageNumber')::integer,
      coalesce(supplied.value->>'regionId', ''),
      (supplied.value->>'chunkIndex')::integer
    from jsonb_array_elements(p_rows) supplied(value)
    group by 1, 2, 3
  ) unique_rows;
  if unique_count <> supplied_count then
    raise exception 'Semantic backfill batch contains duplicate chunk identities';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) supplied(value)
    where not exists (
      select 1
      from public.ecos_hosted_shadow_chunks chunk
      where chunk.job_id = selected_run.job_id
        and chunk.organization_id = selected_run.organization_id
        and chunk.project_id = selected_run.project_id
        and chunk.document_id = selected_run.document_id
        and chunk.source_sha256 = selected_run.source_sha256
        and chunk.page_number = (supplied.value->>'pageNumber')::integer
        and chunk.region_id = coalesce(supplied.value->>'regionId', '')
        and chunk.chunk_index = (supplied.value->>'chunkIndex')::integer
        and encode(digest(convert_to(
          left(btrim(concat_ws(
            ' ', nullif(btrim(chunk.sheet_number), ''), chunk.chunk_text
          )), 6000),
          'UTF8'
        ), 'sha256'), 'hex') = supplied.value->>'chunkSha256'
    )
  ) then
    raise exception 'Semantic backfill rows do not match the exact shadow chunks';
  end if;

  insert into public.ecos_hosted_semantic_backfill_embeddings (
    run_id, page_number, region_id, chunk_index, chunk_sha256, embedding
  )
  select
    selected_run.id,
    (supplied.value->>'pageNumber')::integer,
    coalesce(supplied.value->>'regionId', ''),
    (supplied.value->>'chunkIndex')::integer,
    supplied.value->>'chunkSha256',
    ((supplied.value->'embedding')::text)::extensions.vector(1536)
  from jsonb_array_elements(p_rows) supplied(value)
  on conflict (run_id, page_number, region_id, chunk_index) do update set
    chunk_sha256 = excluded.chunk_sha256,
    embedding = excluded.embedding,
    updated_at = now();

  select count(*)::integer into staged_count
  from public.ecos_hosted_semantic_backfill_embeddings staged
  where staged.run_id = selected_run.id;
  if staged_count > selected_run.expected_chunk_count then
    raise exception 'Semantic backfill exceeded the exact shadow chunk inventory';
  end if;
  update public.ecos_hosted_semantic_backfill_runs run
  set updated_at = now()
  where run.id = selected_run.id;
  return staged_count;
end;
$$;

create or replace function public.ecos_commit_ready_shadow_semantic_backfill(
  p_run_id uuid,
  p_run_token uuid
)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  selected_run public.ecos_hosted_semantic_backfill_runs%rowtype;
  selected_job public.ecos_hosted_index_jobs%rowtype;
  exact_chunk_count integer;
  staged_count integer;
  inserted_count integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Semantic backfill authorization required';
  end if;
  select run.* into selected_run
  from public.ecos_hosted_semantic_backfill_runs run
  where run.id = p_run_id
    and run.run_token = p_run_token
    and run.state = 'staging'
  for update;
  if not found then raise exception 'Active semantic backfill was not found'; end if;

  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where job.id = selected_run.job_id
  for update;
  if not found
    or selected_job.mode <> 'shadow'
    or selected_job.state <> 'ready'
    or selected_job.organization_id <> selected_run.organization_id
    or selected_job.project_id <> selected_run.project_id
    or selected_job.document_id <> selected_run.document_id
    or selected_job.source_sha256 <> selected_run.source_sha256
    or selected_job.committed_evidence_version <> selected_run.evidence_version
    or selected_job.claim_token is not null
    or selected_job.lease_expires_at is not null
    or not public.ecos_hosted_job_matches_reference(selected_job.id, true) then
    raise exception 'Ready shadow evidence changed before semantic promotion';
  end if;

  select count(*)::integer into exact_chunk_count
  from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = selected_run.job_id
    and chunk.organization_id = selected_run.organization_id
    and chunk.project_id = selected_run.project_id
    and chunk.document_id = selected_run.document_id
    and chunk.source_sha256 = selected_run.source_sha256;
  select count(*)::integer into staged_count
  from public.ecos_hosted_semantic_backfill_embeddings staged
  where staged.run_id = selected_run.id;
  if exact_chunk_count <> selected_run.expected_chunk_count
    or staged_count <> selected_run.expected_chunk_count then
    raise exception 'Semantic backfill is incomplete or the chunk inventory drifted';
  end if;

  if exists (
    select 1
    from public.ecos_hosted_semantic_backfill_embeddings staged
    left join public.ecos_hosted_shadow_chunks chunk
      on chunk.job_id = selected_run.job_id
     and chunk.organization_id = selected_run.organization_id
     and chunk.project_id = selected_run.project_id
     and chunk.document_id = selected_run.document_id
     and chunk.source_sha256 = selected_run.source_sha256
     and chunk.page_number = staged.page_number
     and chunk.region_id = staged.region_id
     and chunk.chunk_index = staged.chunk_index
     and encode(digest(convert_to(
       left(btrim(concat_ws(
         ' ', nullif(btrim(chunk.sheet_number), ''), chunk.chunk_text
       )), 6000),
       'UTF8'
     ), 'sha256'), 'hex') = staged.chunk_sha256
    where staged.run_id = selected_run.id
      and chunk.job_id is null
  ) then
    raise exception 'Staged embeddings no longer match the exact shadow chunks';
  end if;

  delete from public.ecos_hosted_chunk_embeddings embedding
  where embedding.job_id = selected_run.job_id;

  insert into public.ecos_hosted_chunk_embeddings (
    job_id, organization_id, project_id, document_id, source_sha256,
    evidence_version, source_kind, page_number, region_id, chunk_index,
    chunk_sha256, embedding_model, embedding_dimensions, embedding
  )
  select
    selected_run.job_id, selected_run.organization_id, selected_run.project_id,
    selected_run.document_id, selected_run.source_sha256,
    selected_run.evidence_version, 'shadow', staged.page_number,
    staged.region_id, staged.chunk_index, staged.chunk_sha256,
    selected_run.embedding_model, selected_run.embedding_dimensions,
    staged.embedding
  from public.ecos_hosted_semantic_backfill_embeddings staged
  where staged.run_id = selected_run.id
  order by staged.page_number, staged.region_id, staged.chunk_index;
  get diagnostics inserted_count = row_count;
  if inserted_count <> selected_run.expected_chunk_count then
    raise exception 'Semantic promotion was incomplete';
  end if;

  insert into public.ecos_hosted_index_usage (
    organization_id, project_id, document_id, job_id, event_type,
    idempotency_key, quantity, details
  ) values (
    selected_run.organization_id, selected_run.project_id,
    selected_run.document_id, selected_run.job_id, 'semantic_index_ready',
    'semantic-backfill:' || selected_run.source_sha256 || ':' || selected_run.embedding_model,
    inserted_count,
    jsonb_build_object(
      'backfillRunId', selected_run.id,
      'embeddingModel', selected_run.embedding_model,
      'embeddingDimensions', selected_run.embedding_dimensions,
      'chunkCount', inserted_count,
      'sourceSha256', selected_run.source_sha256
    )
  ) on conflict (job_id, idempotency_key) do update set
    quantity = excluded.quantity,
    details = excluded.details,
    created_at = now();

  update public.ecos_hosted_semantic_backfill_runs run
  set state = 'committed', run_token = gen_random_uuid(),
    committed_at = now(), updated_at = now()
  where run.id = selected_run.id;
  return inserted_count;
end;
$$;

create or replace function public.ecos_cancel_ready_shadow_semantic_backfill(
  p_run_id uuid,
  p_run_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Semantic backfill authorization required';
  end if;
  if not exists (
    select 1 from public.ecos_hosted_semantic_backfill_runs run
    where run.id = p_run_id and run.run_token = p_run_token and run.state = 'staging'
    for update
  ) then
    return false;
  end if;
  delete from public.ecos_hosted_semantic_backfill_embeddings staged
  where staged.run_id = p_run_id;
  update public.ecos_hosted_semantic_backfill_runs run
  set state = 'cancelled', run_token = gen_random_uuid(), updated_at = now()
  where run.id = p_run_id and run.run_token = p_run_token and run.state = 'staging';
  return found;
end;
$$;

revoke all on function public.ecos_begin_ready_shadow_semantic_backfill(
  uuid, text, text, text, integer
) from public, anon, authenticated;
revoke all on function public.ecos_stage_ready_shadow_semantic_backfill_batch(
  uuid, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.ecos_commit_ready_shadow_semantic_backfill(
  uuid, uuid
) from public, anon, authenticated;
revoke all on function public.ecos_cancel_ready_shadow_semantic_backfill(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.ecos_begin_ready_shadow_semantic_backfill(
  uuid, text, text, text, integer
) to service_role;
grant execute on function public.ecos_stage_ready_shadow_semantic_backfill_batch(
  uuid, uuid, jsonb
) to service_role;
grant execute on function public.ecos_commit_ready_shadow_semantic_backfill(
  uuid, uuid
) to service_role;
grant execute on function public.ecos_cancel_ready_shadow_semantic_backfill(
  uuid, uuid
) to service_role;

commit;
