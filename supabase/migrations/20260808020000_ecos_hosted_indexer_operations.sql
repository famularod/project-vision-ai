-- ECOS Hosted Indexer operations and safety controls
--
-- Adds fail-closed source scanning, bounded provider consumption, durable usage
-- telemetry, retention cleanup, and service-role-only health reporting.

begin;

alter table public.ecos_hosted_index_configuration
  add column if not exists daily_visual_region_limit integer not null default 100
    check (daily_visual_region_limit between 0 and 100000),
  add column if not exists operations_retention_days integer not null default 30
    check (operations_retention_days between 7 and 365),
  add column if not exists maximum_source_bytes bigint not null default 262144000
    check (maximum_source_bytes between 1048576 and 1073741824),
  add column if not exists maximum_source_pages integer not null default 500
    check (maximum_source_pages between 1 and 10000);

alter table public.ecos_hosted_index_jobs
  add column if not exists source_scan_status text not null default 'pending'
    check (source_scan_status in ('pending', 'clean', 'rejected', 'failed')),
  add column if not exists source_scan_engine text,
  add column if not exists source_scan_at timestamptz,
  add column if not exists source_byte_count bigint check (source_byte_count is null or source_byte_count >= 0);

create table if not exists public.ecos_hosted_index_usage (
  id bigint generated always as identity primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  document_id text not null,
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  event_type text not null check (event_type in (
    'source_scanned', 'page_assured', 'visual_region_reserved', 'document_ready'
  )),
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 500),
  quantity integer not null default 1 check (quantity >= 0),
  duration_ms integer not null default 0 check (duration_ms between 0 and 86400000),
  estimated_cost_microusd bigint not null default 0 check (estimated_cost_microusd >= 0),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  unique (job_id, idempotency_key)
);

create index if not exists ecos_hosted_index_usage_org_created_idx
  on public.ecos_hosted_index_usage (organization_id, created_at desc);
create index if not exists ecos_hosted_index_usage_event_created_idx
  on public.ecos_hosted_index_usage (event_type, created_at desc);

alter table public.ecos_hosted_index_usage enable row level security;
alter table public.ecos_hosted_index_usage force row level security;
revoke all on table public.ecos_hosted_index_usage from public, anon, authenticated;
grant all on table public.ecos_hosted_index_usage to service_role;

create or replace function public.ecos_record_hosted_source_scan(
  p_job_id uuid,
  p_claim_token uuid,
  p_scan_status text,
  p_scan_engine text,
  p_source_byte_count bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
  maximum_bytes bigint;
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if p_scan_status not in ('clean', 'rejected', 'failed') then raise exception 'Invalid source scan status'; end if;
  if length(trim(coalesce(p_scan_engine, ''))) < 2 then raise exception 'Source scan engine required'; end if;
  if p_source_byte_count < 1 then raise exception 'Source byte count required'; end if;

  select job.* into current_job from public.ecos_hosted_index_jobs job
  where job.id = p_job_id and job.claim_token = p_claim_token for update;
  if not found then raise exception 'Worker lease is unavailable'; end if;
  select config.maximum_source_bytes into maximum_bytes
  from public.ecos_hosted_index_configuration config
  where config.organization_id = current_job.organization_id;
  if p_source_byte_count > coalesce(maximum_bytes, 262144000) then
    raise exception 'Source exceeds organization processing limit';
  end if;

  update public.ecos_hosted_index_jobs job set
    source_scan_status = p_scan_status,
    source_scan_engine = left(trim(p_scan_engine), 200),
    source_scan_at = now(),
    source_byte_count = p_source_byte_count,
    updated_at = now()
  where job.id = current_job.id;

  insert into public.ecos_hosted_index_usage (
    organization_id, project_id, document_id, job_id, event_type,
    idempotency_key, quantity, details
  ) values (
    current_job.organization_id, current_job.project_id, current_job.document_id,
    current_job.id, 'source_scanned', 'source-scan', p_source_byte_count,
    jsonb_build_object('status', p_scan_status, 'engine', left(trim(p_scan_engine), 200))
  ) on conflict (job_id, idempotency_key) do update set
    quantity = excluded.quantity,
    details = excluded.details,
    created_at = now();
  return true;
end;
$$;

create or replace function public.ecos_require_clean_source_scan()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.state in ('extracting', 'mapping', 'awaiting_visual', 'assuring', 'ready')
    and (new.source_scan_status <> 'clean' or new.source_scan_at is null) then
    raise exception 'A clean protected source scan is required before extraction';
  end if;
  return new;
end;
$$;

drop trigger if exists ecos_hosted_clean_source_guard on public.ecos_hosted_index_jobs;
create trigger ecos_hosted_clean_source_guard
before insert or update on public.ecos_hosted_index_jobs
for each row execute function public.ecos_require_clean_source_scan();

revoke all on function public.ecos_require_clean_source_scan() from public, anon, authenticated;

create or replace function public.ecos_extend_hosted_index_lease(
  p_job_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer default 1800
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if p_lease_seconds < 300 or p_lease_seconds > 3600 then raise exception 'Invalid lease duration'; end if;

  update public.ecos_hosted_index_jobs job set
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    heartbeat_at = now(),
    updated_at = now()
  where job.id = p_job_id
    and job.claim_token = p_claim_token
    and job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring');
  if not found then raise exception 'Worker lease is unavailable'; end if;
  return true;
end;
$$;

create or replace function public.ecos_record_hosted_index_usage(
  p_job_id uuid,
  p_claim_token uuid,
  p_event_type text,
  p_idempotency_key text,
  p_quantity integer default 1,
  p_duration_ms integer default 0,
  p_details jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if p_event_type not in ('page_assured', 'document_ready') then raise exception 'Invalid usage event'; end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 1 then raise exception 'Usage idempotency key required'; end if;
  select job.* into current_job from public.ecos_hosted_index_jobs job
  where job.id = p_job_id and job.claim_token = p_claim_token;
  if not found then raise exception 'Worker lease is unavailable'; end if;

  insert into public.ecos_hosted_index_usage (
    organization_id, project_id, document_id, job_id, event_type,
    idempotency_key, quantity, duration_ms, details
  ) values (
    current_job.organization_id, current_job.project_id, current_job.document_id,
    current_job.id, p_event_type, left(trim(p_idempotency_key), 500),
    greatest(0, p_quantity), greatest(0, least(p_duration_ms, 86400000)),
    coalesce(p_details, '{}'::jsonb)
  ) on conflict (job_id, idempotency_key) do update set
    quantity = excluded.quantity,
    duration_ms = excluded.duration_ms,
    details = excluded.details,
    created_at = now();
  return true;
end;
$$;

create or replace function public.ecos_reserve_hosted_visual_region(
  p_job_id uuid,
  p_claim_token uuid,
  p_page_number integer,
  p_region_key text,
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
  reservation_key text;
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if p_page_number < 1 or length(trim(coalesce(p_region_key, ''))) < 1 then return false; end if;
  select job.* into current_job from public.ecos_hosted_index_jobs job
  where job.id = p_job_id and job.claim_token = p_claim_token;
  if not found then raise exception 'Worker lease is unavailable'; end if;
  select config.* into current_config from public.ecos_hosted_index_configuration config
  where config.organization_id = current_job.organization_id for update;
  if not found or not current_config.enabled then return false; end if;

  reservation_key := 'visual:' || p_page_number::text || ':' || left(trim(p_region_key), 300);
  if exists (
    select 1 from public.ecos_hosted_index_usage usage
    where usage.job_id = current_job.id and usage.idempotency_key = reservation_key
  ) then return true; end if;

  select coalesce(sum(usage.quantity), 0) into current_count
  from public.ecos_hosted_index_usage usage
  where usage.organization_id = current_job.organization_id
    and usage.event_type = 'visual_region_reserved'
    and usage.created_at >= date_trunc('day', now());
  if current_count >= current_config.daily_visual_region_limit then return false; end if;

  insert into public.ecos_hosted_index_usage (
    organization_id, project_id, document_id, job_id, event_type,
    idempotency_key, quantity, estimated_cost_microusd,
    details
  ) values (
    current_job.organization_id, current_job.project_id, current_job.document_id,
    current_job.id, 'visual_region_reserved', reservation_key, 1,
    greatest(0, p_estimated_cost_microusd),
    jsonb_build_object('pageNumber', p_page_number, 'regionKey', left(trim(p_region_key), 300))
  ) on conflict (job_id, idempotency_key) do nothing;
  return true;
end;
$$;

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

create or replace function public.ecos_hosted_index_operations_health()
returns table(
  queued_jobs bigint,
  active_jobs bigint,
  blocked_jobs bigint,
  oldest_queued_seconds bigint,
  pages_assured_last_24h bigint,
  visual_regions_last_24h bigint,
  estimated_visual_cost_microusd_last_24h bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where job.state in ('queued', 'temporarily_unavailable')),
    count(*) filter (where job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring')),
    count(*) filter (where job.state in ('needs_review', 'reconnect_source', 'failed_internal')),
    coalesce(extract(epoch from now() - min(job.created_at) filter (where job.state in ('queued', 'temporarily_unavailable')))::bigint, 0),
    (select coalesce(sum(usage.quantity), 0) from public.ecos_hosted_index_usage usage
      where usage.event_type = 'page_assured' and usage.created_at >= now() - interval '24 hours'),
    (select coalesce(sum(usage.quantity), 0) from public.ecos_hosted_index_usage usage
      where usage.event_type = 'visual_region_reserved' and usage.created_at >= now() - interval '24 hours'),
    (select coalesce(sum(usage.estimated_cost_microusd), 0) from public.ecos_hosted_index_usage usage
      where usage.event_type = 'visual_region_reserved' and usage.created_at >= now() - interval '24 hours')
  from public.ecos_hosted_index_jobs job
  where auth.role() = 'service_role';
$$;

revoke all on function public.ecos_record_hosted_source_scan(uuid, uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.ecos_extend_hosted_index_lease(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.ecos_record_hosted_index_usage(uuid, uuid, text, text, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.ecos_reserve_hosted_visual_region(uuid, uuid, integer, text, bigint) from public, anon, authenticated;
revoke all on function public.ecos_cleanup_hosted_index_operations() from public, anon, authenticated;
revoke all on function public.ecos_hosted_index_operations_health() from public, anon, authenticated;
grant execute on function public.ecos_record_hosted_source_scan(uuid, uuid, text, text, bigint) to service_role;
grant execute on function public.ecos_extend_hosted_index_lease(uuid, uuid, integer) to service_role;
grant execute on function public.ecos_record_hosted_index_usage(uuid, uuid, text, text, integer, integer, jsonb) to service_role;
grant execute on function public.ecos_reserve_hosted_visual_region(uuid, uuid, integer, text, bigint) to service_role;
grant execute on function public.ecos_cleanup_hosted_index_operations() to service_role;
grant execute on function public.ecos_hosted_index_operations_health() to service_role;

commit;
