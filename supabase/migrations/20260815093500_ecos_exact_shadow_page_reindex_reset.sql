-- ECOS exact-page shadow reindex reset
--
-- A producer correction can invalidate one assured shadow page without
-- invalidating the other source-bound page checkpoints. This service-only
-- operation removes exactly one page and its derived shadow artifacts so the
-- hosted worker recomputes it under a new immutable image. It cannot operate
-- on a committed job, a live job, a changed source, or an active lease.

begin;

create or replace function public.ecos_reset_hosted_shadow_page_for_reindex(
  p_job_id uuid,
  p_expected_source_sha256 text,
  p_page_number integer,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_job public.ecos_hosted_index_jobs%rowtype;
  selected_page public.ecos_hosted_index_pages%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Worker authorization required';
  end if;
  if lower(trim(coalesce(p_expected_source_sha256, ''))) !~ '^[a-f0-9]{64}$' then
    raise exception 'Expected source checksum is required';
  end if;
  if p_page_number is null or p_page_number < 1 then
    raise exception 'Exact page number is required';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Page reindex reason is required';
  end if;

  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
    and job.mode = 'shadow'
    and job.source_sha256 = lower(trim(p_expected_source_sha256))
  for update;
  if not found then return false; end if;
  if p_page_number > selected_job.source_page_count then
    raise exception 'Page number is outside the verified source';
  end if;
  if selected_job.ready_at is not null
    or selected_job.committed_evidence_version is not null then
    raise exception 'Committed shadow evidence cannot be partially reset';
  end if;
  if selected_job.lease_expires_at is not null
    and selected_job.lease_expires_at >= now() then
    raise exception 'An active worker lease is still processing this job';
  end if;

  select page.* into selected_page
  from public.ecos_hosted_index_pages page
  where page.job_id = selected_job.id
    and page.page_number = p_page_number
  for update;
  if not found then return false; end if;

  -- Serialize with any out-of-transaction materialization for this page. The
  -- page-delete trigger may enqueue a deletion, so remove chunks first and
  -- clear the final queue row only after that trigger has run.
  perform queued.page_number
  from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = selected_job.id
    and queued.page_number = p_page_number
  for update;

  delete from public.ecos_hosted_visual_exceptions exception
  where exception.job_id = selected_job.id
    and exception.page_number = p_page_number;
  delete from public.ecos_hosted_index_pages page
  where page.job_id = selected_job.id
    and page.page_number = p_page_number;
  delete from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = selected_job.id
    and chunk.page_number = p_page_number;
  delete from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = selected_job.id
    and queued.page_number = p_page_number;

  update public.ecos_hosted_index_jobs job
  set state = 'queued',
      completed_page_count = (
        select count(*) from public.ecos_hosted_index_pages page
        where page.job_id = selected_job.id
      ),
      assured_page_count = (
        select count(*) from public.ecos_hosted_index_pages page
        where page.job_id = selected_job.id and page.state = 'assured'
      ),
      unresolved_region_count = (
        select coalesce(sum(page.unresolved_region_count), 0)
        from public.ecos_hosted_index_pages page
        where page.job_id = selected_job.id
      ),
      retry_count = 0,
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      heartbeat_at = null,
      failure_category = null,
      failure_diagnostics = jsonb_build_object(
        'operatorPageReindexReason', left(trim(p_reason), 300),
        'resetPageNumber', p_page_number,
        'priorPageState', selected_page.state,
        'sourceSha256', selected_job.source_sha256
      ),
      customer_message = 'Vitruvius is preparing this document in the background.',
      updated_at = now()
  where job.id = selected_job.id;
  return true;
end;
$$;

revoke all on function public.ecos_reset_hosted_shadow_page_for_reindex(
  uuid, text, integer, text
) from public, anon, authenticated;
grant execute on function public.ecos_reset_hosted_shadow_page_for_reindex(
  uuid, text, integer, text
) to service_role;

commit;
