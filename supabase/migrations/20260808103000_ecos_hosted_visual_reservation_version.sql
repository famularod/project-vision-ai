-- Versioned ECOS hosted visual reservation accounting
--
-- Evidence resets intentionally retain immutable usage audit rows. A new
-- extraction evidence version must therefore use a new idempotency namespace.
-- A provider retry under a new worker claim is a new billable attempt and gets
-- a new reservation; duplicate reservation calls inside one exact claim remain
-- idempotent. The organization daily limit counts every version and attempt.

begin;

create or replace function public.ecos_reserve_hosted_visual_region_versioned(
  p_job_id uuid,
  p_claim_token uuid,
  p_page_number integer,
  p_region_key text,
  p_evidence_version text,
  p_estimated_cost_microusd bigint default 0
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
  current_config public.ecos_hosted_index_configuration%rowtype;
  current_count bigint;
  normalized_version text;
  reservation_key text;
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if p_page_number < 1 or length(trim(coalesce(p_region_key, ''))) < 1 then return false; end if;
  normalized_version := left(trim(coalesce(p_evidence_version, '')), 100);
  if normalized_version !~ '^ecos-hosted-evidence/[0-9]+\.[0-9]+$' then
    raise exception 'Valid evidence version required';
  end if;

  select job.* into current_job from public.ecos_hosted_index_jobs job
  where job.id = p_job_id and job.claim_token = p_claim_token;
  if not found then raise exception 'Worker lease is unavailable'; end if;
  select config.* into current_config from public.ecos_hosted_index_configuration config
  where config.organization_id = current_job.organization_id for update;
  if not found or not current_config.enabled then return false; end if;

  reservation_key := 'visual:' || normalized_version || ':' ||
    p_claim_token::text || ':' || p_page_number::text || ':' ||
    left(trim(p_region_key), 300);
  if exists (
    select 1 from public.ecos_hosted_index_usage usage
    where usage.job_id = current_job.id and usage.idempotency_key = reservation_key
  ) then return true; end if;

  -- Deliberately no evidence-version filter: the daily organization cap is a
  -- cost boundary across every old and current algorithm version.
  select coalesce(sum(usage.quantity), 0) into current_count
  from public.ecos_hosted_index_usage usage
  where usage.organization_id = current_job.organization_id
    and usage.event_type = 'visual_region_reserved'
    and usage.created_at >= date_trunc('day', now());
  if current_count >= current_config.daily_visual_region_limit then return false; end if;

  insert into public.ecos_hosted_index_usage (
    organization_id, project_id, document_id, job_id, event_type,
    idempotency_key, quantity, estimated_cost_microusd, details
  ) values (
    current_job.organization_id, current_job.project_id, current_job.document_id,
    current_job.id, 'visual_region_reserved', reservation_key, 1,
    greatest(0, p_estimated_cost_microusd),
    jsonb_build_object(
      'pageNumber', p_page_number,
      'regionKey', left(trim(p_region_key), 300),
      'evidenceVersion', normalized_version,
      'providerAttempt', 'worker_claim'
    )
  ) on conflict (job_id, idempotency_key) do nothing;
  return true;
end;
$$;

revoke all on function public.ecos_reserve_hosted_visual_region_versioned(
  uuid, uuid, integer, text, text, bigint
) from public, anon, authenticated;
grant execute on function public.ecos_reserve_hosted_visual_region_versioned(
  uuid, uuid, integer, text, text, bigint
) to service_role;

commit;
