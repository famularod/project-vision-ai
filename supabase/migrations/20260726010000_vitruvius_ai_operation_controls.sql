-- Owner-scoped operation control for paid or externally processed AI work.
-- The API begins an operation before calling a provider, and then finalizes
-- the same record. Stable idempotency keys prevent duplicate provider calls.

begin;

create table if not exists public.dave_ai_operation_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  operation_type text not null check (
    operation_type in (
      'schedule_extraction',
      'photo_analysis',
      'voice_capture',
      'report_generation'
    )
  ),
  idempotency_key text not null check (
    char_length(idempotency_key) between 16 and 128
  ),
  project_ids text[] not null default '{}',
  payload_fingerprint text not null check (
    payload_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  payload_bytes bigint not null default 0 check (
    payload_bytes between 0 and 26214400
  ),
  status text not null default 'processing' check (
    status in ('processing', 'completed', 'failed')
  ),
  attempts integer not null default 1 check (attempts between 1 and 20),
  response_payload jsonb,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  response_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, operation_type, idempotency_key)
);

create index if not exists dave_ai_operation_owner_recent_idx
  on public.dave_ai_operation_requests (
    owner_id,
    operation_type,
    started_at desc
  );

create index if not exists dave_ai_operation_expiration_idx
  on public.dave_ai_operation_requests (response_expires_at)
  where response_expires_at is not null;

alter table public.dave_ai_operation_requests enable row level security;
alter table public.dave_ai_operation_requests force row level security;

revoke all on table public.dave_ai_operation_requests
  from public, anon, authenticated;

drop policy if exists dave_ai_operation_owner_select
  on public.dave_ai_operation_requests;

create policy dave_ai_operation_owner_select
  on public.dave_ai_operation_requests
  for select
  to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

grant select on table public.dave_ai_operation_requests to authenticated;

create or replace function public.dave_begin_ai_operation(
  p_operation_type text,
  p_idempotency_key text,
  p_project_ids text[],
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
  normalized_project_ids text[];
  existing_request public.dave_ai_operation_requests%rowtype;
  recent_request_count integer;
  active_request_count integer;
  hourly_limit integer;
  created_request_id uuid;
begin
  if auth_user is null or not public.dave_is_app_owner() then
    raise insufficient_privilege using message = 'owner authorization required';
  end if;

  if p_operation_type not in (
    'schedule_extraction',
    'photo_analysis',
    'voice_capture',
    'report_generation'
  ) then
    raise invalid_parameter_value using message = 'unsupported operation type';
  end if;

  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$' then
    raise invalid_parameter_value using message = 'invalid idempotency key';
  end if;

  if p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise invalid_parameter_value using message = 'invalid payload fingerprint';
  end if;

  if p_payload_bytes is null
     or p_payload_bytes < 0
     or p_payload_bytes > 26214400 then
    raise invalid_parameter_value using message = 'invalid payload size';
  end if;

  select coalesce(array_agg(distinct project_id order by project_id), '{}')
  into normalized_project_ids
  from unnest(coalesce(p_project_ids, '{}')) as project_id
  where project_id is not null
    and btrim(project_id) <> '';

  if cardinality(normalized_project_ids) = 0 then
    raise invalid_parameter_value using message = 'at least one project is required';
  end if;

  if (
    select count(distinct project_record.id::text)
    from public.projects as project_record
    where project_record.owner_id = auth_user
      and project_record.id::text = any(normalized_project_ids)
      and coalesce(project_record.archived, false) = false
  ) <> cardinality(normalized_project_ids) then
    raise insufficient_privilege using message = 'project access denied';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(auth_user::text || ':' || p_operation_type, 0)
  );

  select *
  into existing_request
  from public.dave_ai_operation_requests
  where owner_id = auth_user
    and operation_type = p_operation_type
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if existing_request.payload_fingerprint <> p_payload_fingerprint
       or existing_request.project_ids <> normalized_project_ids then
      return jsonb_build_object(
        'action', 'idempotency_conflict',
        'request_id', existing_request.id
      );
    end if;

    if existing_request.status = 'completed'
       and existing_request.response_payload is not null
       and existing_request.response_expires_at > now() then
      return jsonb_build_object(
        'action', 'replay',
        'request_id', existing_request.id,
        'response_payload', existing_request.response_payload
      );
    end if;

    if existing_request.status = 'processing'
       and existing_request.started_at > now() - interval '2 minutes' then
      return jsonb_build_object(
        'action', 'in_progress',
        'request_id', existing_request.id,
        'retry_after_seconds', 15
      );
    end if;
  end if;

  hourly_limit := case p_operation_type
    when 'schedule_extraction' then 6
    when 'photo_analysis' then 30
    when 'voice_capture' then 30
    else 20
  end;

  select count(*)
  into recent_request_count
  from public.dave_ai_operation_requests
  where owner_id = auth_user
    and operation_type = p_operation_type
    and started_at > now() - interval '1 hour';

  if recent_request_count >= hourly_limit then
    return jsonb_build_object(
      'action', 'rate_limited',
      'request_id', coalesce(existing_request.id, gen_random_uuid()),
      'retry_after_seconds', 300
    );
  end if;

  select count(*)
  into active_request_count
  from public.dave_ai_operation_requests
  where owner_id = auth_user
    and operation_type = p_operation_type
    and status = 'processing'
    and started_at > now() - interval '2 minutes'
    and id <> coalesce(existing_request.id, gen_random_uuid());

  if active_request_count >= 2 then
    return jsonb_build_object(
      'action', 'rate_limited',
      'request_id', coalesce(existing_request.id, gen_random_uuid()),
      'retry_after_seconds', 30
    );
  end if;

  if existing_request.id is not null then
    update public.dave_ai_operation_requests
    set project_ids = normalized_project_ids,
        payload_bytes = p_payload_bytes,
        status = 'processing',
        attempts = attempts + 1,
        response_payload = null,
        error_code = null,
        started_at = now(),
        finished_at = null,
        response_expires_at = null,
        updated_at = now()
    where id = existing_request.id
      and owner_id = auth_user
    returning id into created_request_id;
  else
    insert into public.dave_ai_operation_requests (
      owner_id,
      operation_type,
      idempotency_key,
      project_ids,
      payload_fingerprint,
      payload_bytes
    )
    values (
      auth_user,
      p_operation_type,
      p_idempotency_key,
      normalized_project_ids,
      p_payload_fingerprint,
      p_payload_bytes
    )
    returning id into created_request_id;
  end if;

  return jsonb_build_object(
    'action', 'start',
    'request_id', created_request_id
  );
end
$function$;

create or replace function public.dave_finish_ai_operation(
  p_request_id uuid,
  p_status text,
  p_response_payload jsonb,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  auth_user uuid := auth.uid();
  affected_count integer;
begin
  if auth_user is null or not public.dave_is_app_owner() then
    raise insufficient_privilege using message = 'owner authorization required';
  end if;

  if p_status not in ('completed', 'failed') then
    raise invalid_parameter_value using message = 'invalid completion status';
  end if;

  update public.dave_ai_operation_requests
  set status = p_status,
      response_payload = case
        when p_status = 'completed' then p_response_payload
        else null
      end,
      error_code = case
        when p_status = 'failed' then left(coalesce(p_error_code, 'UNKNOWN'), 80)
        else null
      end,
      finished_at = now(),
      response_expires_at = case
        when p_status = 'completed' then now() + interval '24 hours'
        else null
      end,
      updated_at = now()
  where id = p_request_id
    and owner_id = auth_user
    and status = 'processing';

  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise no_data_found using message = 'operation request not found or already finalized';
  end if;

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'status', p_status
  );
end
$function$;

revoke all on function public.dave_begin_ai_operation(
  text,
  text,
  text[],
  text,
  bigint
) from public, anon;
revoke all on function public.dave_finish_ai_operation(
  uuid,
  text,
  jsonb,
  text
) from public, anon;

grant execute on function public.dave_begin_ai_operation(
  text,
  text,
  text[],
  text,
  bigint
) to authenticated;
grant execute on function public.dave_finish_ai_operation(
  uuid,
  text,
  jsonb,
  text
) to authenticated;

comment on table public.dave_ai_operation_requests is
  'Owner-scoped AI operation ledger. Completed response payloads expire after 24 hours; audit metadata remains for abuse and cost review.';

commit;
