-- ECOS Hosted Indexer stale-execution recovery
--
-- Extends the service-only retry boundary to a leased job only after its
-- heartbeat has been silent for five minutes. This lets operations recover an
-- interrupted Cloud Run execution without waiting for the full lease while
-- preventing a healthy worker from being reclaimed underneath active work.

begin;

create or replace function public.ecos_requeue_hosted_index_job(
  p_job_id uuid,
  p_reason text default 'operator_approved_retry'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Retry reason is required'; end if;

  update public.ecos_hosted_index_jobs job
  set state = 'queued',
      retry_count = 0,
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      heartbeat_at = null,
      failure_category = null,
      failure_diagnostics = '{}'::jsonb,
      customer_message = 'Vitruvius is preparing this document in the background.',
      updated_at = now()
  where job.id = p_job_id
    and job.mode = 'shadow'
    and (
      job.state in ('needs_review', 'failed_internal', 'temporarily_unavailable')
      or (
        job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring')
        and coalesce(job.heartbeat_at, job.updated_at) < now() - interval '5 minutes'
      )
    );
  return found;
end;
$$;

revoke all on function public.ecos_requeue_hosted_index_job(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ecos_requeue_hosted_index_job(uuid, text) to service_role;

commit;
