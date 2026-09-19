-- Promote large semantic indexes without exceeding the hosted statement limit.
-- A ready shadow job temporarily moves to `assuring`, which is already excluded
-- by every search function. Exact vectors are copied from private staging in
-- small indexed batches. The final transaction commits the run receipt and
-- returns the job to `ready`, making the complete index visible atomically.

begin;

alter table public.ecos_hosted_chunk_embeddings
  add column if not exists backfill_run_id uuid
    references public.ecos_hosted_semantic_backfill_runs(id) on delete restrict;

create index if not exists ecos_hosted_chunk_embeddings_backfill_run_idx
  on public.ecos_hosted_chunk_embeddings (backfill_run_id)
  where backfill_run_id is not null;

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
    or selected_job.state not in ('ready', 'assuring')
    or selected_job.source_sha256 <> p_expected_source_sha256
    or selected_job.committed_evidence_version <> p_expected_evidence_version
    or selected_job.claim_token is not null
    or selected_job.lease_expires_at is not null then
    raise exception 'Exact idle ready shadow job was not found';
  end if;
  if not public.ecos_hosted_job_matches_reference(selected_job.id, true) then
    raise exception 'Ready shadow job no longer matches the current reference document';
  end if;

  select run.* into active_run
  from public.ecos_hosted_semantic_backfill_runs run
  where run.job_id = selected_job.id
    and run.state = 'staging'
  for update;
  if selected_job.state = 'assuring' and not found then
    raise exception 'Interrupted semantic backfill receipt was not found';
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

  if active_run.id is not null then
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
    if exists (
      select 1 from public.ecos_hosted_chunk_embeddings embedding
      where embedding.job_id = selected_job.id
    ) then
      raise exception 'The exact shadow job already has a semantic index';
    end if;
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

create or replace function public.ecos_materialize_ready_shadow_semantic_backfill_batch(
  p_run_id uuid,
  p_run_token uuid,
  p_batch_size integer default 64
)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  selected_run public.ecos_hosted_semantic_backfill_runs%rowtype;
  selected_job public.ecos_hosted_index_jobs%rowtype;
  staged_count integer;
  materialized_count integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Semantic backfill authorization required';
  end if;
  if p_batch_size not between 1 and 64 then
    raise exception 'Semantic promotion batch size must be between 1 and 64';
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
    or selected_job.state not in ('ready', 'assuring')
    or selected_job.organization_id <> selected_run.organization_id
    or selected_job.project_id <> selected_run.project_id
    or selected_job.document_id <> selected_run.document_id
    or selected_job.source_sha256 <> selected_run.source_sha256
    or selected_job.committed_evidence_version <> selected_run.evidence_version
    or selected_job.claim_token is not null
    or selected_job.lease_expires_at is not null
    or not public.ecos_hosted_job_matches_reference(selected_job.id, true) then
    raise exception 'Ready shadow evidence changed during semantic promotion';
  end if;

  select count(*)::integer into staged_count
  from public.ecos_hosted_semantic_backfill_embeddings staged
  where staged.run_id = selected_run.id;
  if staged_count <> selected_run.expected_chunk_count then
    raise exception 'Semantic staging must be complete before promotion begins';
  end if;

  if selected_job.state = 'ready' then
    if exists (
      select 1 from public.ecos_hosted_chunk_embeddings embedding
      where embedding.job_id = selected_run.job_id
    ) then
      raise exception 'The exact shadow job already has a semantic index';
    end if;
    update public.ecos_hosted_index_jobs job
    set state = 'assuring', updated_at = now()
    where job.id = selected_job.id;
  elsif exists (
    select 1 from public.ecos_hosted_chunk_embeddings embedding
    where embedding.job_id = selected_run.job_id
      and embedding.backfill_run_id is distinct from selected_run.id
  ) then
    raise exception 'Unexpected semantic rows exist during resumed promotion';
  end if;

  with next_rows as (
    select staged.*
    from public.ecos_hosted_semantic_backfill_embeddings staged
    where staged.run_id = selected_run.id
      and not exists (
        select 1
        from public.ecos_hosted_chunk_embeddings embedding
        where embedding.job_id = selected_run.job_id
          and embedding.page_number = staged.page_number
          and embedding.region_id = staged.region_id
          and embedding.chunk_index = staged.chunk_index
      )
    order by staged.page_number, staged.region_id, staged.chunk_index
    limit p_batch_size
  )
  insert into public.ecos_hosted_chunk_embeddings (
    job_id, organization_id, project_id, document_id, source_sha256,
    evidence_version, source_kind, page_number, region_id, chunk_index,
    chunk_sha256, embedding_model, embedding_dimensions, embedding,
    backfill_run_id
  )
  select
    selected_run.job_id, selected_run.organization_id, selected_run.project_id,
    selected_run.document_id, selected_run.source_sha256,
    selected_run.evidence_version, 'shadow', staged.page_number,
    staged.region_id, staged.chunk_index, staged.chunk_sha256,
    selected_run.embedding_model, selected_run.embedding_dimensions,
    staged.embedding, selected_run.id
  from next_rows staged;

  select count(*)::integer into materialized_count
  from public.ecos_hosted_chunk_embeddings embedding
  where embedding.job_id = selected_run.job_id
    and embedding.backfill_run_id = selected_run.id;
  if materialized_count > selected_run.expected_chunk_count then
    raise exception 'Semantic promotion exceeded the exact chunk inventory';
  end if;
  return materialized_count;
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
  materialized_count integer;
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
    or selected_job.state <> 'assuring'
    or selected_job.organization_id <> selected_run.organization_id
    or selected_job.project_id <> selected_run.project_id
    or selected_job.document_id <> selected_run.document_id
    or selected_job.source_sha256 <> selected_run.source_sha256
    or selected_job.committed_evidence_version <> selected_run.evidence_version
    or selected_job.claim_token is not null
    or selected_job.lease_expires_at is not null
    or not public.ecos_hosted_job_matches_reference(selected_job.id, true) then
    raise exception 'Ready shadow evidence changed before semantic commit';
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
  select count(*)::integer into materialized_count
  from public.ecos_hosted_chunk_embeddings embedding
  where embedding.job_id = selected_run.job_id
    and embedding.backfill_run_id = selected_run.id;
  if exact_chunk_count <> selected_run.expected_chunk_count
    or staged_count <> selected_run.expected_chunk_count
    or materialized_count <> selected_run.expected_chunk_count then
    raise exception 'Semantic promotion is incomplete or the chunk inventory drifted';
  end if;

  if exists (
    select 1
    from public.ecos_hosted_chunk_embeddings embedding
    where embedding.job_id = selected_run.job_id
      and embedding.backfill_run_id = selected_run.id
      and not exists (
        select 1
        from public.ecos_hosted_semantic_backfill_embeddings staged
        join public.ecos_hosted_shadow_chunks chunk
          on chunk.job_id = selected_run.job_id
         and chunk.organization_id = selected_run.organization_id
         and chunk.project_id = selected_run.project_id
         and chunk.document_id = selected_run.document_id
         and chunk.source_sha256 = selected_run.source_sha256
         and chunk.page_number = staged.page_number
         and chunk.region_id = staged.region_id
         and chunk.chunk_index = staged.chunk_index
        where staged.run_id = selected_run.id
          and staged.page_number = embedding.page_number
          and staged.region_id = embedding.region_id
          and staged.chunk_index = embedding.chunk_index
          and staged.chunk_sha256 = embedding.chunk_sha256
          and encode(digest(convert_to(
            left(btrim(concat_ws(
              ' ', nullif(btrim(chunk.sheet_number), ''), chunk.chunk_text
            )), 6000),
            'UTF8'
          ), 'sha256'), 'hex') = embedding.chunk_sha256
      )
  ) or exists (
    select 1
    from public.ecos_hosted_semantic_backfill_embeddings staged
    where staged.run_id = selected_run.id
      and not exists (
        select 1 from public.ecos_hosted_chunk_embeddings embedding
        where embedding.job_id = selected_run.job_id
          and embedding.backfill_run_id = selected_run.id
          and embedding.page_number = staged.page_number
          and embedding.region_id = staged.region_id
          and embedding.chunk_index = staged.chunk_index
          and embedding.chunk_sha256 = staged.chunk_sha256
      )
  ) or exists (
    select 1 from public.ecos_hosted_chunk_embeddings embedding
    where embedding.job_id = selected_run.job_id
      and embedding.backfill_run_id is distinct from selected_run.id
  ) then
    raise exception 'Materialized embeddings do not match the exact staged chunks';
  end if;

  insert into public.ecos_hosted_index_usage (
    organization_id, project_id, document_id, job_id, event_type,
    idempotency_key, quantity, details
  ) values (
    selected_run.organization_id, selected_run.project_id,
    selected_run.document_id, selected_run.job_id, 'semantic_index_ready',
    'semantic-backfill:' || selected_run.source_sha256 || ':' || selected_run.embedding_model,
    materialized_count,
    jsonb_build_object(
      'backfillRunId', selected_run.id,
      'embeddingModel', selected_run.embedding_model,
      'embeddingDimensions', selected_run.embedding_dimensions,
      'chunkCount', materialized_count,
      'sourceSha256', selected_run.source_sha256,
      'promotionMode', 'bounded_batches'
    )
  ) on conflict (job_id, idempotency_key) do update set
    quantity = excluded.quantity,
    details = excluded.details,
    created_at = now();

  update public.ecos_hosted_semantic_backfill_runs run
  set state = 'committed', run_token = gen_random_uuid(),
    committed_at = now(), updated_at = now()
  where run.id = selected_run.id;
  update public.ecos_hosted_index_jobs job
  set state = 'ready', updated_at = now()
  where job.id = selected_job.id;
  return materialized_count;
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
declare
  selected_run public.ecos_hosted_semantic_backfill_runs%rowtype;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Semantic backfill authorization required';
  end if;
  select run.* into selected_run
  from public.ecos_hosted_semantic_backfill_runs run
  where run.id = p_run_id and run.run_token = p_run_token and run.state = 'staging'
  for update;
  if not found then return false; end if;

  delete from public.ecos_hosted_chunk_embeddings embedding
  where embedding.job_id = selected_run.job_id
    and embedding.backfill_run_id = selected_run.id;
  delete from public.ecos_hosted_semantic_backfill_embeddings staged
  where staged.run_id = selected_run.id;
  update public.ecos_hosted_semantic_backfill_runs run
  set state = 'cancelled', run_token = gen_random_uuid(), updated_at = now()
  where run.id = selected_run.id;
  update public.ecos_hosted_index_jobs job
  set state = 'ready', updated_at = now()
  where job.id = selected_run.job_id
    and job.mode = 'shadow'
    and job.state = 'assuring'
    and job.source_sha256 = selected_run.source_sha256
    and job.committed_evidence_version = selected_run.evidence_version
    and job.claim_token is null
    and job.lease_expires_at is null;
  return true;
end;
$$;

revoke all on function public.ecos_materialize_ready_shadow_semantic_backfill_batch(
  uuid, uuid, integer
) from public, anon, authenticated;
grant execute on function public.ecos_materialize_ready_shadow_semantic_backfill_batch(
  uuid, uuid, integer
) to service_role;

commit;
