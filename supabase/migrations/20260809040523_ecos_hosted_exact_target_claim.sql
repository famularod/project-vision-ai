-- ECOS hosted evidence 1.3 exact-target claim
--
-- Controlled validation must never make unrelated queue rows eligible merely
-- to steer the global oldest-first claim. This additive service-only boundary
-- claims one exact shadow job/source/evidence contract while retaining every
-- normal enabled-configuration, due-time, lease, retry, and organization
-- concurrency guard. The ordinary production claim function is unchanged.

begin;

alter table public.ecos_hosted_index_jobs
  add column if not exists target_evidence_version text
    check (
      target_evidence_version is null or
      target_evidence_version ~ '^ecos-hosted-evidence/[0-9]+\.[0-9]+$'
    );

-- Preserve the explicit 1.3 reset intent across retry diagnostics. This is a
-- narrow migration of an existing operator marker, not a queue-state change.
update public.ecos_hosted_index_jobs job
set target_evidence_version = nullif(
      trim(job.failure_diagnostics->>'targetEvidenceVersion'),
      ''
    )
where job.target_evidence_version is null
  and trim(coalesce(job.failure_diagnostics->>'targetEvidenceVersion', ''))
    ~ '^ecos-hosted-evidence/[0-9]+\.[0-9]+$';

create or replace function public.ecos_claim_exact_hosted_index_job(
  p_worker_id text,
  p_job_id uuid,
  p_expected_source_sha256 text,
  p_expected_mode text,
  p_expected_evidence_version text,
  p_lease_seconds integer default 300
)
returns table(
  job_id uuid,
  organization_id text,
  project_id text,
  document_id text,
  source_provider text,
  source_locator jsonb,
  source_sha256 text,
  source_page_count integer,
  source_revision text,
  mode text,
  claim_token uuid,
  retry_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_job public.ecos_hosted_index_jobs%rowtype;
  new_claim_token uuid := gen_random_uuid();
  normalized_source_sha256 text := lower(trim(coalesce(p_expected_source_sha256, '')));
  normalized_mode text := lower(trim(coalesce(p_expected_mode, '')));
  normalized_evidence_version text := trim(coalesce(p_expected_evidence_version, ''));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Worker authorization required';
  end if;
  if length(trim(coalesce(p_worker_id, ''))) < 3 then
    raise exception 'Worker id is required';
  end if;
  if p_job_id is null then
    raise exception 'Exact target job id is required';
  end if;
  if normalized_source_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Exact target source checksum is required';
  end if;
  -- Exact-target execution is intentionally a shadow-validation boundary.
  if normalized_mode <> 'shadow' then
    raise exception 'Exact target mode must be shadow';
  end if;
  -- This migration and the current worker implement one immutable contract.
  if normalized_evidence_version <> 'ecos-hosted-evidence/1.3' then
    raise exception 'Exact target evidence contract is unsupported';
  end if;

  -- Serialize exact and ordinary claims against the same short transaction
  -- lock so they cannot concurrently select the same organization capacity.
  perform pg_advisory_xact_lock(hashtext('ecos_hosted_index_global_claim'));

  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  join public.ecos_hosted_index_configuration config
    on config.organization_id = job.organization_id
   and config.enabled = true
   and config.publication_mode = normalized_mode
  where job.id = p_job_id
    and job.source_sha256 = normalized_source_sha256
    and job.mode = normalized_mode
    and job.committed_evidence_version is null
    -- A fresh service-only reset marker takes precedence over a durable marker
    -- from an older attempt. Once claimed, the durable column survives normal
    -- failure diagnostics so the same exact contract can retry safely.
    and coalesce(
      nullif(trim(job.failure_diagnostics->>'targetEvidenceVersion'), ''),
      job.target_evidence_version
    ) = normalized_evidence_version
    and (
      (
        job.state in ('queued', 'temporarily_unavailable')
        and coalesce(job.next_attempt_at, now()) <= now()
        and (job.lease_expires_at is null or job.lease_expires_at < now())
      )
      or (
        job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring')
        and job.lease_expires_at < now()
      )
    )
    and job.retry_count < job.max_retry_count
    and (
      select count(*)
      from public.ecos_hosted_index_jobs active_job
      where active_job.organization_id = job.organization_id
        and active_job.id <> job.id
        and active_job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring')
        and active_job.lease_expires_at >= now()
    ) < config.max_concurrent_jobs
  for update of job skip locked;

  if not found then
    return;
  end if;

  update public.ecos_hosted_index_jobs job
  set state = 'fetching_source',
      retry_count = case
        when selected_job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring')
          then least(job.max_retry_count, job.retry_count + 1)
        else job.retry_count end,
      claimed_by = trim(p_worker_id),
      claim_token = new_claim_token,
      lease_expires_at = now() + make_interval(secs => greatest(300, least(p_lease_seconds, 1800))),
      heartbeat_at = now(),
      next_attempt_at = null,
      failure_category = null,
      failure_diagnostics = '{}'::jsonb,
      target_evidence_version = normalized_evidence_version,
      customer_message = 'Vitruvius is preparing this document in the background.',
      updated_at = now()
  where job.id = selected_job.id
    and job.source_sha256 = normalized_source_sha256
    and job.mode = normalized_mode;

  if not found then
    raise exception 'Exact target changed before claim';
  end if;

  return query select
    selected_job.id,
    selected_job.organization_id,
    selected_job.project_id,
    selected_job.document_id,
    selected_job.source_provider,
    selected_job.source_locator,
    selected_job.source_sha256,
    selected_job.source_page_count,
    selected_job.source_revision,
    selected_job.mode,
    new_claim_token,
    selected_job.retry_count;
end;
$$;

revoke all on function public.ecos_claim_exact_hosted_index_job(
  text, uuid, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.ecos_claim_exact_hosted_index_job(
  text, uuid, text, text, text, integer
) to service_role;

commit;
