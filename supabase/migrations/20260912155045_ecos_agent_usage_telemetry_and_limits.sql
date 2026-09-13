-- Durable, content-free agent telemetry and server-controlled Ask ECOS limits.
-- No question text, answer text, source excerpt, credential, or provider payload
-- may be stored by this migration.

begin;

create table if not exists public.ecos_agent_usage_limits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  organization_id text references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  hourly_question_limit integer not null check (hourly_question_limit between 1 and 1000),
  concurrent_question_limit integer not null check (concurrent_question_limit between 1 and 20),
  daily_cost_limit_usd numeric(12, 6) not null check (daily_cost_limit_usd between 0.01 and 100000),
  monthly_cost_limit_usd numeric(12, 6) not null check (monthly_cost_limit_usd between 0.01 and 1000000),
  per_question_cost_reservation_usd numeric(12, 6) not null
    check (per_question_cost_reservation_usd between 0.001 and 1000),
  max_model_turns integer not null check (max_model_turns between 1 and 12),
  max_tool_calls integer not null check (max_tool_calls between 1 and 32),
  max_elapsed_ms integer not null check (max_elapsed_ms between 5000 and 300000),
  max_tool_elapsed_ms integer not null check (max_tool_elapsed_ms between 1000 and 60000),
  max_tool_output_bytes integer not null check (max_tool_output_bytes between 1024 and 262144),
  max_output_tokens integer not null check (max_output_tokens between 128 and 8192),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_id is null) <> (organization_id is null))
);

create unique index if not exists ecos_agent_usage_limits_owner_unique
  on public.ecos_agent_usage_limits (owner_id)
  where owner_id is not null;
create unique index if not exists ecos_agent_usage_limits_organization_unique
  on public.ecos_agent_usage_limits (organization_id)
  where organization_id is not null;

alter table public.ecos_agent_usage_limits enable row level security;
alter table public.ecos_agent_usage_limits force row level security;
revoke all on table public.ecos_agent_usage_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.ecos_agent_usage_limits to service_role;

comment on table public.ecos_agent_usage_limits is
  'Private service-managed owner or organization Ask ECOS execution, concurrency, and spend limits.';

create table if not exists public.ecos_agent_usage_receipts (
  trace_id uuid primary key,
  request_id uuid not null references public.dave_ai_operation_requests(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  organization_id text references public.organizations(id) on delete set null,
  project_id text not null check (length(trim(project_id)) between 1 and 500),
  model text not null check (length(trim(model)) between 1 and 120),
  usage jsonb not null check (jsonb_typeof(usage) = 'object'),
  estimated_cost_usd numeric(12, 6) not null check (estimated_cost_usd between 0 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists ecos_agent_usage_receipts_owner_created_idx
  on public.ecos_agent_usage_receipts (owner_id, created_at desc);
create index if not exists ecos_agent_usage_receipts_org_created_idx
  on public.ecos_agent_usage_receipts (organization_id, created_at desc)
  where organization_id is not null;

alter table public.ecos_agent_usage_receipts enable row level security;
alter table public.ecos_agent_usage_receipts force row level security;
revoke all on table public.ecos_agent_usage_receipts from public, anon, authenticated;
grant select, insert on table public.ecos_agent_usage_receipts to service_role;

comment on table public.ecos_agent_usage_receipts is
  'Immutable content-free per-attempt Ask ECOS token and estimated-cost receipts used for owner and organization budgets.';

alter table public.dave_ai_operation_requests
  add column if not exists organization_id text references public.organizations(id) on delete set null,
  add column if not exists agent_cost_reservation_usd numeric(12, 6) not null default 0
    check (agent_cost_reservation_usd between 0 and 1000),
  add column if not exists agent_actual_cost_usd numeric(12, 6)
    check (agent_actual_cost_usd is null or agent_actual_cost_usd between 0 and 1000),
  add column if not exists agent_trace_id uuid,
  add column if not exists agent_model text,
  add column if not exists agent_usage jsonb not null default '{}'::jsonb
    check (jsonb_typeof(agent_usage) = 'object');

create unique index if not exists dave_ai_operation_agent_trace_unique
  on public.dave_ai_operation_requests (agent_trace_id)
  where agent_trace_id is not null;
create index if not exists dave_ai_operation_org_cost_window_idx
  on public.dave_ai_operation_requests (organization_id, operation_type, started_at desc)
  where operation_type = 'project_question';

alter table public.ecos_question_diagnostic_traces
  add column if not exists organization_id text references public.organizations(id) on delete set null,
  add column if not exists originating_client_surface text not null default 'unknown'
    check (originating_client_surface in ('web', 'iphone', 'ipad', 'android', 'unknown')),
  add column if not exists agent_metrics jsonb not null default '{}'::jsonb
    check (jsonb_typeof(agent_metrics) = 'object'),
  add column if not exists routing_decision jsonb not null default '{}'::jsonb
    check (jsonb_typeof(routing_decision) = 'object'),
  add column if not exists answer_sha256 text
    check (answer_sha256 is null or answer_sha256 ~ '^[a-f0-9]{64}$'),
  add column if not exists estimated_cost_usd numeric(12, 9)
    check (estimated_cost_usd is null or estimated_cost_usd between 0 and 1000);

create index if not exists ecos_question_diagnostic_traces_org_created_idx
  on public.ecos_question_diagnostic_traces (organization_id, created_at desc)
  where organization_id is not null;

comment on column public.ecos_question_diagnostic_traces.agent_metrics is
  'Sanitized model turns, tool names/statuses/output hashes, token totals, bounded limits, latency, and estimated cost only.';
comment on column public.ecos_question_diagnostic_traces.answer_sha256 is
  'Hash of the response envelope before diagnostics; answer text is not retained here.';

create or replace function public.ecos_begin_project_question(
  p_idempotency_key text,
  p_project_id text,
  p_payload_fingerprint text,
  p_payload_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  auth_user uuid := auth.uid();
  existing_request public.dave_ai_operation_requests%rowtype;
  resolved_organization_id text;
  owner_hourly_limit integer := 60;
  owner_concurrent_limit integer := 2;
  owner_daily_cost_limit numeric := 25;
  owner_monthly_cost_limit numeric := 250;
  owner_reservation numeric := 0.25;
  org_hourly_limit integer := 600;
  org_concurrent_limit integer := 20;
  org_daily_cost_limit numeric := 250;
  org_monthly_cost_limit numeric := 2500;
  org_reservation numeric := 0.25;
  effective_max_model_turns integer := 6;
  effective_max_tool_calls integer := 8;
  effective_max_elapsed_ms integer := 75000;
  effective_max_tool_elapsed_ms integer := 15000;
  effective_max_tool_output_bytes integer := 48000;
  effective_max_output_tokens integer := 2400;
  owner_recent_count integer;
  owner_active_count integer;
  org_recent_count integer := 0;
  org_active_count integer := 0;
  owner_daily_cost numeric := 0;
  owner_monthly_cost numeric := 0;
  org_daily_cost numeric := 0;
  org_monthly_cost numeric := 0;
  cost_reservation numeric;
  created_request_id uuid;
begin
  if auth_user is null or not public.dave_is_app_owner() then
    raise insufficient_privilege using message = 'owner authorization required';
  end if;

  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$' then
    raise invalid_parameter_value using message = 'invalid idempotency key';
  end if;
  if p_project_id is null or btrim(p_project_id) = '' then
    raise invalid_parameter_value using message = 'project is required';
  end if;
  if p_payload_fingerprint is null or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise invalid_parameter_value using message = 'invalid payload fingerprint';
  end if;
  if p_payload_bytes is null or p_payload_bytes < 0 or p_payload_bytes > 26214400 then
    raise invalid_parameter_value using message = 'invalid payload size';
  end if;
  if not exists (
    select 1
    from public.projects project_record
    where project_record.owner_id = auth_user
      and project_record.id::text = p_project_id
      and coalesce(project_record.archived, false) = false
  ) then
    raise insufficient_privilege using message = 'project access denied';
  end if;

  select case when count(distinct organization_id) = 1 then min(organization_id) end
    into resolved_organization_id
  from (
    select membership.organization_id
    from public.vitruvius_project_memberships membership
    where membership.user_id = auth_user
      and membership.project_id = p_project_id
      and membership.status = 'active'
    union
    select job.organization_id
    from public.ecos_hosted_index_jobs job
    join public.organization_memberships membership
      on membership.organization_id = job.organization_id
     and membership.user_id = auth_user
     and membership.status = 'active'
    where job.source_owner_id = auth_user
      and job.project_id = p_project_id
      and job.state = 'ready'
  ) organizations_for_project;

  select
    coalesce(limit_record.hourly_question_limit, owner_hourly_limit),
    coalesce(limit_record.concurrent_question_limit, owner_concurrent_limit),
    coalesce(limit_record.daily_cost_limit_usd, owner_daily_cost_limit),
    coalesce(limit_record.monthly_cost_limit_usd, owner_monthly_cost_limit),
    coalesce(limit_record.per_question_cost_reservation_usd, owner_reservation),
    coalesce(limit_record.max_model_turns, effective_max_model_turns),
    coalesce(limit_record.max_tool_calls, effective_max_tool_calls),
    coalesce(limit_record.max_elapsed_ms, effective_max_elapsed_ms),
    coalesce(limit_record.max_tool_elapsed_ms, effective_max_tool_elapsed_ms),
    coalesce(limit_record.max_tool_output_bytes, effective_max_tool_output_bytes),
    coalesce(limit_record.max_output_tokens, effective_max_output_tokens)
  into owner_hourly_limit, owner_concurrent_limit,
    owner_daily_cost_limit, owner_monthly_cost_limit, owner_reservation,
    effective_max_model_turns, effective_max_tool_calls,
    effective_max_elapsed_ms, effective_max_tool_elapsed_ms,
    effective_max_tool_output_bytes, effective_max_output_tokens
  from (select 1) singleton
  left join public.ecos_agent_usage_limits limit_record
    on limit_record.owner_id = auth_user and limit_record.enabled;

  if resolved_organization_id is not null then
    select
      coalesce(limit_record.hourly_question_limit, org_hourly_limit),
      coalesce(limit_record.concurrent_question_limit, org_concurrent_limit),
      coalesce(limit_record.daily_cost_limit_usd, org_daily_cost_limit),
      coalesce(limit_record.monthly_cost_limit_usd, org_monthly_cost_limit),
      coalesce(limit_record.per_question_cost_reservation_usd, org_reservation),
      least(effective_max_model_turns, coalesce(limit_record.max_model_turns, effective_max_model_turns)),
      least(effective_max_tool_calls, coalesce(limit_record.max_tool_calls, effective_max_tool_calls)),
      least(effective_max_elapsed_ms, coalesce(limit_record.max_elapsed_ms, effective_max_elapsed_ms)),
      least(effective_max_tool_elapsed_ms, coalesce(limit_record.max_tool_elapsed_ms, effective_max_tool_elapsed_ms)),
      least(effective_max_tool_output_bytes, coalesce(limit_record.max_tool_output_bytes, effective_max_tool_output_bytes)),
      least(effective_max_output_tokens, coalesce(limit_record.max_output_tokens, effective_max_output_tokens))
    into org_hourly_limit, org_concurrent_limit,
      org_daily_cost_limit, org_monthly_cost_limit, org_reservation,
      effective_max_model_turns, effective_max_tool_calls,
      effective_max_elapsed_ms, effective_max_tool_elapsed_ms,
      effective_max_tool_output_bytes, effective_max_output_tokens
    from (select 1) singleton
    left join public.ecos_agent_usage_limits limit_record
      on limit_record.organization_id = resolved_organization_id and limit_record.enabled;
  end if;

  cost_reservation := greatest(owner_reservation, org_reservation);
  perform pg_advisory_xact_lock(hashtextextended(auth_user::text || ':project_question', 0));
  if resolved_organization_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(resolved_organization_id || ':project_question', 0));
  end if;

  select * into existing_request
  from public.dave_ai_operation_requests
  where owner_id = auth_user
    and operation_type = 'project_question'
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if existing_request.payload_fingerprint <> p_payload_fingerprint
       or existing_request.project_ids <> array[p_project_id]::text[] then
      return jsonb_build_object('action', 'idempotency_conflict', 'request_id', existing_request.id);
    end if;
    if existing_request.status = 'completed'
       and existing_request.response_payload is not null
       and existing_request.response_expires_at > now() then
      return jsonb_build_object(
        'action', 'replay', 'request_id', existing_request.id,
        'response_payload', existing_request.response_payload
      );
    end if;
    if existing_request.status = 'processing'
       and existing_request.started_at > now() - interval '2 minutes' then
      return jsonb_build_object(
        'action', 'in_progress', 'request_id', existing_request.id,
        'retry_after_seconds', 15
      );
    end if;
  end if;

  select count(*) into owner_recent_count
  from public.ecos_agent_usage_receipts receipt
  where receipt.owner_id = auth_user
    and receipt.created_at > now() - interval '1 hour';

  select
    coalesce(sum(receipt.estimated_cost_usd)
      filter (where receipt.created_at >= date_trunc('day', now())), 0),
    coalesce(sum(receipt.estimated_cost_usd)
      filter (where receipt.created_at >= date_trunc('month', now())), 0)
  into owner_daily_cost, owner_monthly_cost
  from public.ecos_agent_usage_receipts receipt
  where receipt.owner_id = auth_user;

  select owner_daily_cost + coalesce(sum(agent_cost_reservation_usd), 0),
         owner_monthly_cost + coalesce(sum(agent_cost_reservation_usd), 0)
  into owner_daily_cost, owner_monthly_cost
  from public.dave_ai_operation_requests
  where owner_id = auth_user
    and operation_type = 'project_question'
    and status = 'processing'
    and started_at > now() - interval '2 minutes'
    and agent_trace_id is null;

  select count(*) into owner_active_count
  from public.dave_ai_operation_requests
  where owner_id = auth_user
    and operation_type = 'project_question'
    and status = 'processing'
    and started_at > now() - interval '2 minutes'
    and id <> coalesce(existing_request.id, gen_random_uuid());

  if resolved_organization_id is not null then
    select count(*) into org_recent_count
    from public.ecos_agent_usage_receipts receipt
    where receipt.organization_id = resolved_organization_id
      and receipt.created_at > now() - interval '1 hour';
    select count(*) into org_active_count
    from public.dave_ai_operation_requests
    where organization_id = resolved_organization_id
      and operation_type = 'project_question'
      and status = 'processing'
      and started_at > now() - interval '2 minutes'
      and id <> coalesce(existing_request.id, gen_random_uuid());
    select
      coalesce(sum(receipt.estimated_cost_usd)
        filter (where receipt.created_at >= date_trunc('day', now())), 0),
      coalesce(sum(receipt.estimated_cost_usd)
        filter (where receipt.created_at >= date_trunc('month', now())), 0)
    into org_daily_cost, org_monthly_cost
    from public.ecos_agent_usage_receipts receipt
    where receipt.organization_id = resolved_organization_id;
    select org_daily_cost + coalesce(sum(agent_cost_reservation_usd), 0),
           org_monthly_cost + coalesce(sum(agent_cost_reservation_usd), 0)
    into org_daily_cost, org_monthly_cost
    from public.dave_ai_operation_requests
    where organization_id = resolved_organization_id
      and operation_type = 'project_question'
      and status = 'processing'
      and started_at > now() - interval '2 minutes'
      and agent_trace_id is null;
  end if;

  if owner_recent_count >= owner_hourly_limit
     or owner_active_count >= owner_concurrent_limit
     or owner_daily_cost + owner_reservation > owner_daily_cost_limit
     or owner_monthly_cost + owner_reservation > owner_monthly_cost_limit
     or (resolved_organization_id is not null and (
       org_recent_count >= org_hourly_limit
       or org_active_count >= org_concurrent_limit
       or org_daily_cost + org_reservation > org_daily_cost_limit
       or org_monthly_cost + org_reservation > org_monthly_cost_limit
     )) then
    return jsonb_build_object(
      'action', 'rate_limited',
      'request_id', coalesce(existing_request.id, gen_random_uuid()),
      'retry_after_seconds', 300
    );
  end if;

  if existing_request.id is not null then
    update public.dave_ai_operation_requests
    set project_ids = array[p_project_id]::text[],
        organization_id = resolved_organization_id,
        payload_bytes = p_payload_bytes,
        status = 'processing', attempts = attempts + 1,
        response_payload = null, error_code = null,
        agent_cost_reservation_usd = cost_reservation,
        agent_actual_cost_usd = null, agent_trace_id = null,
        agent_model = null, agent_usage = '{}'::jsonb,
        started_at = now(), finished_at = null,
        response_expires_at = null, updated_at = now()
    where id = existing_request.id and owner_id = auth_user
    returning id into created_request_id;
  else
    insert into public.dave_ai_operation_requests (
      owner_id, organization_id, operation_type, idempotency_key,
      project_ids, payload_fingerprint, payload_bytes,
      agent_cost_reservation_usd
    ) values (
      auth_user, resolved_organization_id, 'project_question', p_idempotency_key,
      array[p_project_id]::text[], p_payload_fingerprint, p_payload_bytes,
      cost_reservation
    ) returning id into created_request_id;
  end if;

  return jsonb_build_object(
    'action', 'start',
    'request_id', created_request_id,
    'organization_id', resolved_organization_id,
    'execution_limits', jsonb_build_object(
      'schemaVersion', 'ecos-agent-limits/1.0',
      'maxModelTurns', effective_max_model_turns,
      'maxToolCalls', effective_max_tool_calls,
      'maxElapsedMs', effective_max_elapsed_ms,
      'maxToolElapsedMs', effective_max_tool_elapsed_ms,
      'maxToolOutputBytes', effective_max_tool_output_bytes,
      'maxOutputTokens', effective_max_output_tokens
    )
  );
end
$function$;

revoke all on function public.ecos_begin_project_question(text, text, text, bigint)
  from public, anon;
grant execute on function public.ecos_begin_project_question(text, text, text, bigint)
  to authenticated;

create or replace function public.ecos_record_agent_usage_v1(
  p_request_id uuid,
  p_owner_id uuid,
  p_project_id text,
  p_trace_id uuid,
  p_model text,
  p_estimated_cost_usd numeric,
  p_usage jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_record public.dave_ai_operation_requests%rowtype;
  normalized_cost numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;
  if p_request_id is null or p_owner_id is null or p_trace_id is null
     or p_project_id is null or btrim(p_project_id) = ''
     or p_model is null or length(btrim(p_model)) not between 1 and 120
     or p_usage is null or jsonb_typeof(p_usage) <> 'object' then
    raise invalid_parameter_value using message = 'invalid agent usage receipt';
  end if;
  normalized_cost := round(coalesce(p_estimated_cost_usd, 0), 6);
  if normalized_cost < 0 or normalized_cost > 1000 then
    raise invalid_parameter_value using message = 'invalid estimated cost';
  end if;

  select * into request_record
  from public.dave_ai_operation_requests
  where id = p_request_id
    and owner_id = p_owner_id
    and operation_type = 'project_question'
    and project_ids = array[p_project_id]::text[]
  for update;
  if not found then
    raise no_data_found using message = 'agent operation not found';
  end if;

  if request_record.agent_trace_id is not null then
    if request_record.agent_trace_id = p_trace_id
       and request_record.agent_model = btrim(p_model)
       and request_record.agent_usage = p_usage
       and request_record.agent_actual_cost_usd = normalized_cost then
      return jsonb_build_object('ok', true, 'recorded', false);
    end if;
    raise unique_violation using message = 'agent usage already recorded';
  end if;

  insert into public.ecos_agent_usage_receipts (
    trace_id, request_id, owner_id, organization_id, project_id,
    model, usage, estimated_cost_usd
  ) values (
    p_trace_id, p_request_id, p_owner_id, request_record.organization_id,
    p_project_id, btrim(p_model), p_usage, normalized_cost
  );

  update public.dave_ai_operation_requests
  set agent_trace_id = p_trace_id,
      agent_model = btrim(p_model),
      agent_usage = p_usage,
      agent_actual_cost_usd = normalized_cost,
      updated_at = now()
  where id = p_request_id and owner_id = p_owner_id;

  return jsonb_build_object('ok', true, 'recorded', true);
end
$function$;

revoke all on function public.ecos_record_agent_usage_v1(
  uuid, uuid, text, uuid, text, numeric, jsonb
) from public, anon, authenticated;
grant execute on function public.ecos_record_agent_usage_v1(
  uuid, uuid, text, uuid, text, numeric, jsonb
) to service_role;

comment on function public.ecos_record_agent_usage_v1(
  uuid, uuid, text, uuid, text, numeric, jsonb
) is 'Records one idempotent, content-free agent usage receipt for spend accounting.';

commit;
