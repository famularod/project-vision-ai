-- ECOS Hosted Indexer controlled shadow reindex
--
-- A worker algorithm upgrade must be able to replace stale shadow checkpoints
-- without changing a customer's source document or exposing a reset control to
-- customer sessions. The expected checksum makes the operator target exact.

begin;

create or replace function public.ecos_reset_hosted_shadow_job_for_reindex(
  p_job_id uuid,
  p_expected_source_sha256 text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_job public.ecos_hosted_index_jobs%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if lower(trim(coalesce(p_expected_source_sha256, ''))) !~ '^[a-f0-9]{64}$' then
    raise exception 'Expected source checksum is required';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then raise exception 'Reindex reason is required'; end if;

  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
    and job.mode = 'shadow'
    and job.source_sha256 = lower(trim(p_expected_source_sha256))
  for update;
  if not found then return false; end if;
  if selected_job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring')
    and coalesce(selected_job.heartbeat_at, selected_job.updated_at) >= now() - interval '5 minutes' then
    raise exception 'A healthy worker is still processing this job';
  end if;

  delete from public.ecos_hosted_visual_exceptions exception
  where exception.job_id = selected_job.id;
  delete from public.ecos_hosted_index_pages page
  where page.job_id = selected_job.id;

  update public.ecos_hosted_index_jobs job
  set state = 'queued',
      completed_page_count = 0,
      assured_page_count = 0,
      unresolved_region_count = 0,
      retry_count = 0,
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      heartbeat_at = null,
      failure_category = null,
      failure_diagnostics = jsonb_build_object(
        'operatorReindexReason', left(trim(p_reason), 300),
        'priorEvidenceVersion', selected_job.committed_evidence_version
      ),
      customer_message = 'Vitruvius is preparing this document in the background.',
      committed_evidence_version = null,
      ready_at = null,
      updated_at = now()
  where job.id = selected_job.id;
  return true;
end;
$$;

revoke all on function public.ecos_reset_hosted_shadow_job_for_reindex(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.ecos_reset_hosted_shadow_job_for_reindex(uuid, text, text)
  to service_role;

commit;
