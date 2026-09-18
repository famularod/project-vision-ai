-- ECOS Hosted Indexer: owner-initiated retry and stale-job sweep (IDX-06, IDX-07)
--
-- 1. A signed-in organization member can ask for one more attempt on a
--    document whose preparation stopped ('failed_internal',
--    'temporarily_unavailable', 'needs_review') or whose worker lease expired.
--    The retry keeps the job's mode and source; it only resets the retry budget.
-- 2. A job whose lease expired after its last permitted retry used to sit in a
--    processing state forever because the claim query skips it. The cleanup
--    that every batch already runs now moves such jobs to 'failed_internal'
--    with an honest customer message.

begin;

create or replace function public.ecos_retry_hosted_index_job_for_document(
  p_document_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.ecos_hosted_index_jobs%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if length(trim(coalesce(p_document_id, ''))) = 0 then raise exception 'Document is required'; end if;

  select job.* into target
  from public.ecos_hosted_index_jobs job
  where job.document_id = trim(p_document_id)
    and public.pie_layer4_has_active_membership(job.organization_id)
  order by job.created_at desc
  limit 1;
  if not found then return false; end if;

  -- One retry per ten minutes per document keeps a tap from becoming a loop.
  if target.state = 'queued' then return false; end if;
  if target.updated_at > now() - interval '10 minutes'
     and target.failure_category = 'owner_retry' then
    return false;
  end if;

  update public.ecos_hosted_index_jobs job
  set state = 'queued',
      retry_count = 0,
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      heartbeat_at = null,
      failure_category = 'owner_retry',
      failure_diagnostics = '{}'::jsonb,
      customer_message = 'Vitruvius is preparing this document in the background.',
      updated_at = now()
  where job.id = target.id
    and (
      job.state in ('needs_review', 'failed_internal', 'temporarily_unavailable')
      or (
        job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring')
        and coalesce(job.lease_expires_at, job.updated_at) < now() - interval '5 minutes'
      )
    );
  return found;
end;
$$;

revoke all on function public.ecos_retry_hosted_index_job_for_document(text) from public, anon;
grant execute on function public.ecos_retry_hosted_index_job_for_document(text) to authenticated;

create or replace function public.ecos_sweep_stale_hosted_index_jobs()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  swept bigint := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;

  update public.ecos_hosted_index_jobs job
  set state = 'failed_internal',
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      heartbeat_at = null,
      failure_category = coalesce(job.failure_category, 'lease_expired_after_max_retries'),
      customer_message = 'Preparation stopped before it finished. Tap Try again, or upload the document again.',
      updated_at = now()
  where job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring')
    and job.lease_expires_at is not null
    and job.lease_expires_at < now() - interval '30 minutes'
    and job.retry_count >= job.max_retry_count;
  get diagnostics swept = row_count;
  return swept;
end;
$$;

revoke all on function public.ecos_sweep_stale_hosted_index_jobs() from public, anon, authenticated;
grant execute on function public.ecos_sweep_stale_hosted_index_jobs() to service_role;

-- The existing per-batch cleanup now sweeps first; its signature is unchanged.
create or replace function public.ecos_cleanup_hosted_index_operations()
returns table(usage_events_removed bigint, old_jobs_removed bigint, diagnostics_cleared bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  usage_count bigint := 0;
  job_count bigint := 0;
  diagnostics_count bigint := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;

  perform public.ecos_sweep_stale_hosted_index_jobs();

  delete from public.ecos_hosted_index_usage usage
  using public.ecos_hosted_index_configuration config
  where usage.organization_id = config.organization_id
    and usage.created_at < now() - make_interval(days => config.operations_retention_days);
  get diagnostics usage_count = row_count;

  update public.ecos_hosted_index_jobs job set
    failure_diagnostics = '{}'::jsonb,
    updated_at = job.updated_at
  from public.ecos_hosted_index_configuration config
  where job.organization_id = config.organization_id
    and job.state in ('ready', 'needs_review', 'failed_internal', 'cancelled')
    and job.updated_at < now() - make_interval(days => config.operations_retention_days)
    and job.failure_diagnostics <> '{}'::jsonb;
  get diagnostics diagnostics_count = row_count;

  delete from public.ecos_hosted_index_jobs old_job
  using public.ecos_hosted_index_configuration config
  where old_job.organization_id = config.organization_id
    and old_job.state in ('needs_review', 'failed_internal', 'cancelled')
    and old_job.updated_at < now() - make_interval(days => config.operations_retention_days)
    and exists (
      select 1 from public.ecos_hosted_index_jobs newer_job
      where newer_job.organization_id = old_job.organization_id
        and newer_job.document_id = old_job.document_id
        and newer_job.created_at > old_job.created_at
    );
  get diagnostics job_count = row_count;
  return query select usage_count, job_count, diagnostics_count;
end;
$$;

revoke all on function public.ecos_cleanup_hosted_index_operations() from public, anon, authenticated;
grant execute on function public.ecos_cleanup_hosted_index_operations() to service_role;

commit;
