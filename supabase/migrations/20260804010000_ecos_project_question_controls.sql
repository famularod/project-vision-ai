-- Dedicated owner-scoped control for paid Ask ECOS project questions. This
-- extends the existing AI operation ledger without weakening the controls for
-- schedule, photo, voice, or report operations.

begin;

alter table public.dave_ai_operation_requests
  drop constraint if exists dave_ai_operation_requests_operation_type_check;

alter table public.dave_ai_operation_requests
  add constraint dave_ai_operation_requests_operation_type_check check (
    operation_type in (
      'schedule_extraction',
      'photo_analysis',
      'voice_capture',
      'report_generation',
      'project_question'
    )
  );

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
  recent_request_count integer;
  active_request_count integer;
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

  if p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise invalid_parameter_value using message = 'invalid payload fingerprint';
  end if;

  if p_payload_bytes is null
     or p_payload_bytes < 0
     or p_payload_bytes > 26214400 then
    raise invalid_parameter_value using message = 'invalid payload size';
  end if;

  if not exists (
    select 1
    from public.projects as project_record
    where project_record.owner_id = auth_user
      and project_record.id::text = p_project_id
      and coalesce(project_record.archived, false) = false
  ) then
    raise insufficient_privilege using message = 'project access denied';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(auth_user::text || ':project_question', 0)
  );

  select *
  into existing_request
  from public.dave_ai_operation_requests
  where owner_id = auth_user
    and operation_type = 'project_question'
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if existing_request.payload_fingerprint <> p_payload_fingerprint
       or existing_request.project_ids <> array[p_project_id]::text[] then
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

  select count(*)
  into recent_request_count
  from public.dave_ai_operation_requests
  where owner_id = auth_user
    and operation_type = 'project_question'
    and started_at > now() - interval '1 hour';

  if recent_request_count >= 60 then
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
    and operation_type = 'project_question'
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
    set project_ids = array[p_project_id]::text[],
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
      'project_question',
      p_idempotency_key,
      array[p_project_id]::text[],
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

revoke all on function public.ecos_begin_project_question(
  text,
  text,
  text,
  bigint
) from public, anon;

grant execute on function public.ecos_begin_project_question(
  text,
  text,
  text,
  bigint
) to authenticated;

comment on function public.ecos_begin_project_question(text, text, text, bigint) is
  'Begins or replays one rate-limited, owner-scoped Ask ECOS project question.';

commit;
