-- ECOS Hosted Indexer controlled-capacity correction
--
-- Adds the durable heartbeat required by lease extension and serializes job
-- claims so the initial one-worker shadow rollout cannot create overlapping
-- document processors when Cloud Scheduler fires while a prior run is active.

begin;

alter table public.ecos_hosted_index_jobs
  add column if not exists heartbeat_at timestamptz;

create or replace function public.ecos_claim_hosted_index_job(
  p_worker_id text,
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
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if length(trim(coalesce(p_worker_id, ''))) < 3 then raise exception 'Worker id is required'; end if;

  perform pg_advisory_xact_lock(hashtext('ecos_hosted_index_global_claim'));
  if exists (
    select 1 from public.ecos_hosted_index_jobs active_job
    where active_job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring')
      and active_job.lease_expires_at >= now()
  ) then return; end if;

  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where (
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
  order by job.created_at
  for update skip locked
  limit 1;

  if not found then return; end if;

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
      customer_message = 'Vitruvius is preparing this document in the background.',
      updated_at = now()
  where job.id = selected_job.id;

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

revoke all on function public.ecos_claim_hosted_index_job(text, integer)
  from public, anon, authenticated;
grant execute on function public.ecos_claim_hosted_index_job(text, integer) to service_role;

commit;
