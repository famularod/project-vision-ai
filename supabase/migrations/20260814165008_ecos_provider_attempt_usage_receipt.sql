-- ECOS drawing-provider attempt usage receipt
--
-- The provider-attempt ledger is intentionally private. Expose only bounded
-- daily counts and their fixed safety limits to the service-only resume
-- operator so it can refuse an execution before spending visual reservations.

begin;

create or replace function public.ecos_get_drawing_provider_attempt_usage(
  p_job_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
  day_start timestamptz :=
    date_trunc('day', statement_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
  if auth.role() <> 'service_role' then
    raise exception 'Worker authorization required';
  end if;
  if p_job_id is null then
    raise exception 'Exact hosted job identity is required';
  end if;

  select job.* into current_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id;
  if not found then
    raise exception 'Exact hosted job was not found';
  end if;

  return jsonb_build_object(
    'dayStart', day_start,
    'resetAt', day_start + interval '1 day',
    'sourceOwner', jsonb_build_object(
      'used', (
        select count(*)
        from public.ecos_drawing_provider_attempts attempt
        where attempt.source_owner_id = current_job.source_owner_id
          and attempt.reserved_at >= day_start
      ),
      'limit', 800
    ),
    'project', jsonb_build_object(
      'used', (
        select count(*)
        from public.ecos_drawing_provider_attempts attempt
        where attempt.organization_id = current_job.organization_id
          and attempt.project_id = current_job.project_id
          and attempt.reserved_at >= day_start
      ),
      'limit', 1200
    ),
    'organization', jsonb_build_object(
      'used', (
        select count(*)
        from public.ecos_drawing_provider_attempts attempt
        where attempt.organization_id = current_job.organization_id
          and attempt.reserved_at >= day_start
      ),
      'limit', 1600
    )
  );
end;
$$;

revoke all on function public.ecos_get_drawing_provider_attempt_usage(uuid)
  from public, anon, authenticated;
grant execute on function public.ecos_get_drawing_provider_attempt_usage(uuid)
  to service_role;

commit;
