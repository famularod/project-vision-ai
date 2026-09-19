-- Keep semantic-index completion inside the same protected usage ledger as
-- source scanning, visual reservations, page assurance, and document readiness.
-- The embedding pipeline was added after the original event allow-list.

begin;

alter table public.ecos_hosted_index_usage
  drop constraint if exists ecos_hosted_index_usage_event_type_check;

alter table public.ecos_hosted_index_usage
  add constraint ecos_hosted_index_usage_event_type_check check (event_type in (
    'source_scanned',
    'page_assured',
    'visual_region_reserved',
    'semantic_index_ready',
    'document_ready'
  ));

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
  if p_event_type not in ('page_assured', 'semantic_index_ready', 'document_ready') then
    raise exception 'Invalid usage event';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 1 then
    raise exception 'Usage idempotency key required';
  end if;

  select job.* into current_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
    and job.claim_token = p_claim_token;
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

revoke all on function public.ecos_record_hosted_index_usage(
  uuid, uuid, text, text, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.ecos_record_hosted_index_usage(
  uuid, uuid, text, text, integer, integer, jsonb
) to service_role;

comment on function public.ecos_record_hosted_index_usage(
  uuid, uuid, text, text, integer, integer, jsonb
) is 'Records exact-claim hosted indexing milestones, including semantic index completion, for the protected worker only.';

commit;
