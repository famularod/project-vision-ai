-- ECOS hosted evidence 1.3 controlled shadow reset
--
-- Extraction and shadow materialization changed together in evidence 1.3.
-- Reindex must therefore remove every prior checkpoint, search chunk, visual
-- exception, and pending materialization for the exact source checksum. This
-- remains service-only and shadow-only; source documents and live evidence are
-- deliberately outside the function's authority.

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
  -- The lease, not a heartbeat heuristic, is the destructive reset boundary.
  -- A slow page/provider call can legitimately outlive five minutes without
  -- refreshing heartbeat_at. Never delete its checkpoints while its exact
  -- worker lease is still valid.
  if selected_job.lease_expires_at is not null
    and selected_job.lease_expires_at >= now() then
    raise exception 'An active worker lease is still processing this job';
  end if;

  -- Serialize with the out-of-transaction shadow materializer before deleting
  -- anything. If it already owns a queue row, this waits for that transaction
  -- to finish so the chunk delete below removes its result. If reset gets the
  -- row first, the materializer cannot begin old-version work during the reset.
  perform queued.page_number
  from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = selected_job.id
  order by queued.page_number
  for update;

  delete from public.ecos_hosted_visual_exceptions exception
  where exception.job_id = selected_job.id;

  -- The page-delete trigger may enqueue delete materializations. All shadow
  -- chunks are removed directly below, then every resulting queue entry is
  -- cleared in the same transaction, so no 1.2 page or chunk can survive.
  delete from public.ecos_hosted_index_pages page
  where page.job_id = selected_job.id;
  delete from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = selected_job.id;
  delete from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = selected_job.id;

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
        'priorEvidenceVersion', selected_job.committed_evidence_version,
        'targetEvidenceVersion', 'ecos-hosted-evidence/1.3'
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
