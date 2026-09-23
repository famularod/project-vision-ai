-- Extend the exact isolated-refresh visual gate to the paid provider
-- attempt reservation and operation completion. Other jobs still require
-- an enabled configuration. Existing limits, identities, and authorization
-- remain unchanged.
begin;

CREATE OR REPLACE FUNCTION public.ecos_reserve_drawing_provider_attempt(p_request_id uuid, p_provider_operation_id text, p_call_role text, p_call_ordinal integer, p_provider text, p_model text, p_idempotency_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
declare
  current_request public.ecos_drawing_analysis_requests%rowtype;
  current_job public.ecos_hosted_index_jobs%rowtype;
  normalized_operation_id text := lower(trim(coalesce(p_provider_operation_id, '')));
  normalized_call_role text := trim(coalesce(p_call_role, ''));
  normalized_provider text := trim(coalesce(p_provider, ''));
  normalized_model text := trim(coalesce(p_model, ''));
  normalized_idempotency_key text := trim(coalesce(p_idempotency_key, ''));
  expected_visual_receipt_key text;
  day_start timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  attempt_count bigint;
  active_count bigint;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'ecos_drawing_provider_worker_authorization_required';
  end if;
  if p_request_id is null or normalized_operation_id !~ '^[a-f0-9]{64}$' or
      p_provider_operation_id is distinct from normalized_operation_id or
      normalized_call_role not in (
        'analysis_primary', 'analysis_capacity_fallback',
        'analysis_invalid_output_fallback', 'assurance'
      ) or p_call_ordinal is null or p_call_ordinal not between 1 and 16 or
      normalized_provider !~ '^[!-~]{1,80}$' or p_provider is distinct from normalized_provider or
      normalized_model !~ '^[!-~]{1,160}$' or p_model is distinct from normalized_model or
      octet_length(normalized_idempotency_key) not between 1 and 300 or
      normalized_idempotency_key !~ '^[!-~]+$' or
      p_idempotency_key is distinct from normalized_idempotency_key then
    raise exception 'ecos_drawing_provider_bounded_attempt_identity_required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ecos_drawing_provider_reservation_global', 0)
  );

  select request.* into current_request
  from public.ecos_drawing_analysis_requests request
  where request.id = p_request_id
    and request.provider_operation_id = normalized_operation_id
    and request.status = 'processing'
    and request.processing_expires_at > clock_timestamp()
  for update;
  if not found then
    raise exception 'ecos_drawing_provider_fresh_request_required';
  end if;

  select job.* into current_job
  from public.ecos_hosted_index_jobs job
  join public.ecos_hosted_index_configuration configuration
    on configuration.organization_id = job.organization_id
   and (configuration.enabled = true or public.ecos_private_isolated_visual_refresh_allowed(job.id, current_request.page_number))
  where job.id = current_request.hosted_job_id
    and job.claim_token = current_request.hosted_claim_token
    and job.claimed_by is not null
    and job.lease_expires_at > clock_timestamp()
    and job.state in ('extracting', 'mapping', 'awaiting_visual', 'assuring')
    and job.source_scan_status = 'clean'
    and job.organization_id = current_request.organization_id
    and job.project_id = current_request.project_id
    and job.document_id = current_request.document_id
    and job.source_sha256 = current_request.source_sha256
    and job.target_evidence_version = current_request.evidence_version
    and job.source_page_count is not null
    and current_request.page_number <= job.source_page_count
  for update of job;
  if not found then
    raise exception 'ecos_drawing_provider_live_hosted_lease_required';
  end if;

  expected_visual_receipt_key :=
    'visual:v2:' || current_request.evidence_version || ':' ||
    current_request.visual_exception_fingerprint || ':' ||
    current_request.hosted_claim_token::text || ':' ||
    current_request.page_number::text || ':' || current_request.visual_region_key;
  if not exists (
    select 1
    from public.ecos_hosted_index_usage usage
    where usage.job_id = current_job.id
      and usage.organization_id = current_request.organization_id
      and usage.project_id = current_request.project_id
      and usage.document_id = current_request.document_id
      and usage.event_type = 'visual_region_reserved'
      and usage.idempotency_key = expected_visual_receipt_key
      and usage.quantity = 1
      and usage.details->>'pageNumber' = current_request.page_number::text
      and usage.details->>'regionKey' = current_request.visual_region_key
      and usage.details->>'evidenceVersion' = current_request.evidence_version
      and usage.details->>'exceptionFingerprint' = current_request.visual_exception_fingerprint
      and usage.details->>'providerAttempt' = 'exact_visual_exception_v2'
  ) then
    raise exception 'ecos_drawing_provider_exact_visual_reservation_required';
  end if;

  -- Reusing a reservation could authorize another fetch, so duplicate attempt
  -- idempotency or ordinals fail closed instead of returning success.
  if exists (
    select 1 from public.ecos_drawing_provider_attempts attempt
    where attempt.request_id = current_request.id
      and (attempt.idempotency_key = normalized_idempotency_key or
           attempt.call_ordinal = p_call_ordinal)
  ) then
    raise exception 'ecos_drawing_provider_attempt_already_reserved';
  end if;

  -- provider-attempt limit per drawing request
  select count(*) into attempt_count
  from public.ecos_drawing_provider_attempts attempt
  where attempt.request_id = current_request.id;
  if attempt_count >= 16 then
    raise exception 'provider-attempt limit per drawing request';
  end if;

  -- active drawing-analysis limit is rechecked immediately before each paid
  -- call reservation: two per owner, four per project, eight per organization.
  select count(*) into active_count
  from public.ecos_drawing_analysis_requests request
  where request.source_owner_id = current_request.source_owner_id
    and request.status = 'processing'
    and request.processing_expires_at > clock_timestamp();
  if active_count > 2 then raise exception 'active drawing-analysis limit for source owner'; end if;
  select count(*) into active_count
  from public.ecos_drawing_analysis_requests request
  where request.organization_id = current_request.organization_id
    and request.project_id = current_request.project_id
    and request.status = 'processing'
    and request.processing_expires_at > clock_timestamp();
  if active_count > 4 then raise exception 'active drawing-analysis limit for project'; end if;
  select count(*) into active_count
  from public.ecos_drawing_analysis_requests request
  where request.organization_id = current_request.organization_id
    and request.status = 'processing'
    and request.processing_expires_at > clock_timestamp();
  if active_count > 8 then raise exception 'active drawing-analysis limit for organization'; end if;

  -- daily source-owner provider-attempt limit
  select count(*) into attempt_count
  from public.ecos_drawing_provider_attempts attempt
  where attempt.source_owner_id = current_request.source_owner_id
    and attempt.reserved_at >= day_start;
  if attempt_count >= 800 then raise exception 'daily source-owner provider-attempt limit'; end if;
  -- daily project provider-attempt limit
  select count(*) into attempt_count
  from public.ecos_drawing_provider_attempts attempt
  where attempt.organization_id = current_request.organization_id
    and attempt.project_id = current_request.project_id
    and attempt.reserved_at >= day_start;
  if attempt_count >= 1200 then raise exception 'daily project provider-attempt limit'; end if;
  -- daily organization provider-attempt limit
  select count(*) into attempt_count
  from public.ecos_drawing_provider_attempts attempt
  where attempt.organization_id = current_request.organization_id
    and attempt.reserved_at >= day_start;
  if attempt_count >= 1600 then raise exception 'daily organization provider-attempt limit'; end if;

  insert into public.ecos_drawing_provider_attempts (
    request_id, source_owner_id, organization_id, project_id, document_id,
    source_sha256, page_number, hosted_job_id, provider_operation_id,
    call_role, call_ordinal, provider, model, idempotency_key
  ) values (
    current_request.id, current_request.source_owner_id,
    current_request.organization_id, current_request.project_id,
    current_request.document_id, current_request.source_sha256,
    current_request.page_number, current_request.hosted_job_id,
    current_request.provider_operation_id, normalized_call_role,
    p_call_ordinal, normalized_provider, normalized_model,
    normalized_idempotency_key
  );
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ecos_finish_drawing_analysis(p_request_id uuid, p_provider_operation_id text, p_status text, p_response_payload jsonb DEFAULT NULL::jsonb, p_error_code text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
declare
  current_request public.ecos_drawing_analysis_requests%rowtype;
  normalized_operation_id text := lower(trim(coalesce(p_provider_operation_id, '')));
  normalized_status text := lower(trim(coalesce(p_status, '')));
  normalized_error_code text := lower(trim(coalesce(p_error_code, '')));
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'ecos_drawing_analysis_finish_worker_authorization_required';
  end if;
  if p_request_id is null or normalized_operation_id !~ '^[a-f0-9]{64}$' or
      p_provider_operation_id is distinct from normalized_operation_id or
      normalized_status not in ('completed', 'failed') then
    raise exception 'ecos_drawing_analysis_finish_identity_required';
  end if;
  if normalized_status = 'completed' and (
      jsonb_typeof(coalesce(p_response_payload, 'null'::jsonb)) <> 'object' or
      octet_length(p_response_payload::text) > 1048576 or
      p_error_code is not null
    ) then
    raise exception 'ecos_drawing_analysis_bounded_response_required';
  end if;
  if normalized_status = 'failed' and (
      p_response_payload is not null or
      normalized_error_code !~ '^[a-z0-9][a-z0-9_.:-]{0,119}$' or
      p_error_code is distinct from normalized_error_code
    ) then
    raise exception 'ecos_drawing_analysis_bounded_failure_required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ecos_drawing_provider_reservation_global', 0)
  );
  select request.* into current_request
  from public.ecos_drawing_analysis_requests request
  where request.id = p_request_id
    and request.provider_operation_id = normalized_operation_id
  for update;
  if not found then return false; end if;

  if current_request.status = 'completed' then
    return normalized_status = 'completed' and
      current_request.response_payload = p_response_payload;
  end if;
  if current_request.status = 'failed' then
    return normalized_status = 'failed' and
      current_request.failure_code = normalized_error_code;
  end if;
  if current_request.processing_expires_at <= clock_timestamp() or not exists (
    select 1
    from public.ecos_hosted_index_jobs job
    join public.ecos_hosted_index_configuration configuration
      on configuration.organization_id = job.organization_id
     and (configuration.enabled = true or public.ecos_private_isolated_visual_refresh_allowed(job.id, current_request.page_number))
    where job.id = current_request.hosted_job_id
      and job.claim_token = current_request.hosted_claim_token
      and job.claimed_by is not null
      and job.lease_expires_at > clock_timestamp()
      and job.state in ('extracting', 'mapping', 'awaiting_visual', 'assuring')
      and job.source_scan_status = 'clean'
      and job.organization_id = current_request.organization_id
      and job.project_id = current_request.project_id
      and job.document_id = current_request.document_id
      and job.source_sha256 = current_request.source_sha256
      and job.target_evidence_version = current_request.evidence_version
      and job.source_page_count is not null
      and current_request.page_number <= job.source_page_count
  ) then
    return false;
  end if;

  update public.ecos_drawing_analysis_requests request
  set status = normalized_status,
      response_payload = case when normalized_status = 'completed' then p_response_payload else null end,
      failure_code = case when normalized_status = 'failed' then normalized_error_code else null end,
      completed_at = clock_timestamp()
  where request.id = current_request.id
    and request.status = 'processing';
  return found;
end;
$function$;

commit;
