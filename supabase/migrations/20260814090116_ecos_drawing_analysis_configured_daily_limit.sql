-- Align the durable drawing-analysis request ceiling with the operator-approved
-- organization visual cap. The provider reservation, exact identity, active
-- concurrency, and dual-provider assurance boundaries remain unchanged.
-- The absolute 500 ceiling keeps the temporary operator increase bounded.

create or replace function public.ecos_begin_drawing_analysis(
  p_organization_id text,
  p_project_id text,
  p_document_id text,
  p_source_sha256 text,
  p_page_number integer,
  p_hosted_job_id uuid,
  p_hosted_claim_token uuid,
  p_evidence_version text,
  p_visual_exception_fingerprint text,
  p_visual_region_key text,
  p_provider_operation_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_payload_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '5s'
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
  existing_request public.ecos_drawing_analysis_requests%rowtype;
  normalized_source_sha256 text := lower(trim(coalesce(p_source_sha256, '')));
  normalized_evidence_version text := trim(coalesce(p_evidence_version, ''));
  normalized_fingerprint text := lower(trim(coalesce(p_visual_exception_fingerprint, '')));
  normalized_region_key text := trim(coalesce(p_visual_region_key, ''));
  normalized_operation_id text := lower(trim(coalesce(p_provider_operation_id, '')));
  normalized_idempotency_key text := lower(trim(coalesce(p_idempotency_key, '')));
  normalized_payload_sha256 text := lower(trim(coalesce(p_payload_sha256, '')));
  expected_operation_id text;
  expected_visual_receipt_key text;
  day_start timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  new_request_id uuid;
  request_count bigint;
  request_daily_limit integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'ecos_drawing_analysis_worker_authorization_required';
  end if;
  if p_hosted_job_id is null or p_hosted_claim_token is null then
    raise exception 'ecos_drawing_analysis_exact_uuid_identity_required';
  end if;
  if p_organization_id is null or
      octet_length(p_organization_id) not between 1 and 500 or
      p_organization_id !~ '^[ -~]+$' or p_organization_id !~ '[!-~]' or
      p_project_id is null or
      octet_length(p_project_id) not between 1 and 500 or
      p_project_id !~ '^[ -~]+$' or p_project_id !~ '[!-~]' or
      p_document_id is null or
      octet_length(p_document_id) not between 1 and 200 or
      p_document_id !~ '^[ -~]+$' or p_document_id !~ '[!-~]' then
    raise exception 'ecos_drawing_analysis_exact_text_identity_required';
  end if;
  if normalized_source_sha256 !~ '^[a-f0-9]{64}$' or
      p_source_sha256 is distinct from normalized_source_sha256 or
      normalized_fingerprint !~ '^[a-f0-9]{64}$' or
      p_visual_exception_fingerprint is distinct from normalized_fingerprint or
      normalized_operation_id !~ '^[a-f0-9]{64}$' or
      p_provider_operation_id is distinct from normalized_operation_id or
      normalized_idempotency_key !~ '^[a-f0-9]{64}$' or
      p_idempotency_key is distinct from normalized_idempotency_key or
      normalized_payload_sha256 !~ '^[a-f0-9]{64}$' or
      p_payload_sha256 is distinct from normalized_payload_sha256 then
    raise exception 'ecos_drawing_analysis_canonical_sha256_identity_required';
  end if;
  if normalized_idempotency_key <> normalized_operation_id then
    raise exception 'ecos_drawing_analysis_operation_idempotency_mismatch';
  end if;
  if p_page_number is null or p_page_number not between 1 and 10000 or
      p_payload_bytes is null or p_payload_bytes not between 1 and 19922944 or
      normalized_evidence_version !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$' or
      p_evidence_version is distinct from normalized_evidence_version or
      octet_length(normalized_region_key) not between 1 and 300 or
      normalized_region_key !~ '^[!-~]+$' or
      p_visual_region_key is distinct from normalized_region_key then
    raise exception 'ecos_drawing_analysis_bounded_identity_required';
  end if;

  expected_operation_id := public.ecos_visual_provider_operation_id_v1(
    p_organization_id,
    p_project_id,
    p_document_id,
    normalized_source_sha256,
    p_page_number,
    p_hosted_job_id,
    p_hosted_claim_token,
    normalized_evidence_version,
    normalized_fingerprint,
    normalized_region_key
  );
  if normalized_operation_id <> expected_operation_id then
    raise exception 'ecos_drawing_analysis_provider_operation_mismatch';
  end if;

  -- One short global transaction lock makes every limit check plus insert
  -- atomic and gives begin/reserve a single, deadlock-free lock order.
  perform pg_advisory_xact_lock(
    hashtextextended('ecos_drawing_provider_reservation_global', 0)
  );

  -- Revalidate the current lease and the earlier visual-region reservation
  -- before returning any idempotent disposition, including a replay.
  select job.* into current_job
  from public.ecos_hosted_index_jobs job
  join public.ecos_hosted_index_configuration configuration
    on configuration.organization_id = job.organization_id
   and configuration.enabled = true
  where job.id = p_hosted_job_id
    and job.claim_token = p_hosted_claim_token
    and job.claimed_by is not null
    and job.lease_expires_at > clock_timestamp()
    and job.state in ('extracting', 'mapping', 'awaiting_visual', 'assuring')
    and job.source_scan_status = 'clean'
    and job.organization_id = p_organization_id
    and job.project_id = p_project_id
    and job.document_id = p_document_id
    and job.source_sha256 = normalized_source_sha256
    and job.target_evidence_version = normalized_evidence_version
    and job.source_page_count is not null
    and p_page_number <= job.source_page_count
  for update of job;
  if not found then
    raise exception 'ecos_drawing_analysis_live_hosted_lease_required';
  end if;

  select least(configuration.daily_visual_region_limit, 500)
  into request_daily_limit
  from public.ecos_hosted_index_configuration configuration
  where configuration.organization_id = current_job.organization_id
    and configuration.enabled = true;
  if request_daily_limit is null then
    raise exception 'ecos_drawing_analysis_configuration_unavailable';
  end if;

  expected_visual_receipt_key :=
    'visual:v2:' || normalized_evidence_version || ':' ||
    normalized_fingerprint || ':' || p_hosted_claim_token::text || ':' ||
    p_page_number::text || ':' || normalized_region_key;
  if not exists (
    select 1
    from public.ecos_hosted_index_usage usage
    where usage.job_id = current_job.id
      and usage.organization_id = current_job.organization_id
      and usage.project_id = current_job.project_id
      and usage.document_id = current_job.document_id
      and usage.event_type = 'visual_region_reserved'
      and usage.idempotency_key = expected_visual_receipt_key
      and usage.quantity = 1
      and usage.details->>'pageNumber' = p_page_number::text
      and usage.details->>'regionKey' = normalized_region_key
      and usage.details->>'evidenceVersion' = normalized_evidence_version
      and usage.details->>'exceptionFingerprint' = normalized_fingerprint
      and usage.details->>'providerAttempt' = 'exact_visual_exception_v2'
  ) then
    raise exception 'ecos_drawing_analysis_exact_visual_reservation_required';
  end if;

  select request.* into existing_request
  from public.ecos_drawing_analysis_requests request
  where request.provider_operation_id = normalized_operation_id
     or (request.hosted_job_id = p_hosted_job_id and request.idempotency_key = normalized_idempotency_key)
  order by request.created_at
  for update
  limit 1;
  if found then
    if existing_request.organization_id <> p_organization_id or
        existing_request.project_id <> p_project_id or
        existing_request.document_id <> p_document_id or
        existing_request.source_sha256 <> normalized_source_sha256 or
        existing_request.page_number <> p_page_number or
        existing_request.hosted_job_id <> p_hosted_job_id or
        existing_request.hosted_claim_token <> p_hosted_claim_token or
        existing_request.evidence_version <> normalized_evidence_version or
        existing_request.visual_exception_fingerprint <> normalized_fingerprint or
        existing_request.visual_region_key <> normalized_region_key or
        existing_request.payload_sha256 <> normalized_payload_sha256 or
        existing_request.payload_bytes <> p_payload_bytes then
      raise exception 'ecos_drawing_analysis_idempotency_identity_conflict';
    end if;
    if existing_request.status = 'completed' then
      return jsonb_build_object(
        'disposition', 'replay',
        'requestId', existing_request.id,
        'response', existing_request.response_payload
      );
    end if;
    if existing_request.status = 'failed' then
      return jsonb_build_object(
        'disposition', 'failed',
        'requestId', existing_request.id,
        'error', existing_request.failure_code
      );
    end if;
    if existing_request.processing_expires_at > clock_timestamp() then
      return jsonb_build_object(
        'disposition', 'in_progress',
        'requestId', existing_request.id
      );
    end if;
    update public.ecos_drawing_analysis_requests request
    set status = 'failed',
        failure_code = 'analysis_operation_expired',
        completed_at = clock_timestamp()
    where request.id = existing_request.id;
    return jsonb_build_object(
      'disposition', 'failed',
      'requestId', existing_request.id,
      'error', 'analysis_operation_expired'
    );
  end if;

  -- active drawing-analysis limit: two per source owner, four per project,
  -- and eight per organization. Expired requests do not consume capacity.
  select count(*) into request_count
  from public.ecos_drawing_analysis_requests request
  where request.source_owner_id = current_job.source_owner_id
    and request.status = 'processing'
    and request.processing_expires_at > clock_timestamp();
  if request_count >= 2 then
    raise exception 'active drawing-analysis limit for source owner';
  end if;
  select count(*) into request_count
  from public.ecos_drawing_analysis_requests request
  where request.organization_id = current_job.organization_id
    and request.project_id = current_job.project_id
    and request.status = 'processing'
    and request.processing_expires_at > clock_timestamp();
  if request_count >= 4 then
    raise exception 'active drawing-analysis limit for project';
  end if;
  select count(*) into request_count
  from public.ecos_drawing_analysis_requests request
  where request.organization_id = current_job.organization_id
    and request.status = 'processing'
    and request.processing_expires_at > clock_timestamp();
  if request_count >= 8 then
    raise exception 'active drawing-analysis limit for organization';
  end if;

  -- Daily request creation follows the currently enabled organization visual
  -- cap, bounded to an absolute maximum of 500. Source-owner, project, and
  -- organization checks all remain fail-closed at the same approved ceiling.
  select count(*) into request_count
  from public.ecos_drawing_analysis_requests request
  where request.source_owner_id = current_job.source_owner_id
    and request.created_at >= day_start;
  if request_count >= request_daily_limit then
    raise exception 'daily source-owner drawing-analysis limit';
  end if;
  select count(*) into request_count
  from public.ecos_drawing_analysis_requests request
  where request.organization_id = current_job.organization_id
    and request.project_id = current_job.project_id
    and request.created_at >= day_start;
  if request_count >= request_daily_limit then
    raise exception 'daily project drawing-analysis limit';
  end if;
  select count(*) into request_count
  from public.ecos_drawing_analysis_requests request
  where request.organization_id = current_job.organization_id
    and request.created_at >= day_start;
  if request_count >= request_daily_limit then
    raise exception 'daily organization drawing-analysis limit';
  end if;

  insert into public.ecos_drawing_analysis_requests (
    source_owner_id, organization_id, project_id, document_id,
    source_sha256, page_number, hosted_job_id, hosted_claim_token,
    evidence_version, visual_exception_fingerprint, visual_region_key,
    provider_operation_id, idempotency_key, payload_sha256, payload_bytes
  ) values (
    current_job.source_owner_id, current_job.organization_id,
    current_job.project_id, current_job.document_id,
    normalized_source_sha256, p_page_number, current_job.id,
    p_hosted_claim_token, normalized_evidence_version,
    normalized_fingerprint, normalized_region_key,
    normalized_operation_id, normalized_idempotency_key,
    normalized_payload_sha256, p_payload_bytes
  ) returning id into new_request_id;

  return jsonb_build_object(
    'disposition', 'started',
    'requestId', new_request_id
  );
end;
$$;

