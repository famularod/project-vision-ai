-- Exact, fail-closed provider-spend reservations for hosted drawing analysis.
--
-- A protected worker must already hold a live hosted-index lease and an exact
-- visual-region reservation receipt before it may begin one drawing-analysis
-- operation. Every provider HTTP attempt (including retries, fallbacks, and
-- Assurance) then consumes a distinct atomic reservation. Customer sessions
-- have no RPC or table access to this ledger.

begin;

create extension if not exists pgcrypto;

-- Keep this function byte-for-byte aligned with
-- workers/ecos-indexer/ecos_indexer/visual.py. All free-text identity fields
-- accepted by the begin RPC are printable ASCII, so PostgreSQL to_json(text)
-- and Python json.dumps(..., ensure_ascii=True) escape the same bytes.
create or replace function public.ecos_visual_provider_operation_id_v1(
  p_organization_id text,
  p_project_id text,
  p_document_id text,
  p_source_sha256 text,
  p_page_number integer,
  p_hosted_job_id uuid,
  p_hosted_claim_token uuid,
  p_evidence_version text,
  p_visual_exception_fingerprint text,
  p_visual_region_key text
)
returns text
language sql
immutable
strict
security invoker
set search_path = public, extensions, pg_temp
as $$
  select encode(
    digest(
      convert_to(
        '{"documentId":' || to_json(p_document_id)::text ||
        ',"evidenceVersion":' || to_json(p_evidence_version)::text ||
        ',"hostedClaimToken":' || to_json(p_hosted_claim_token::text)::text ||
        ',"hostedJobId":' || to_json(p_hosted_job_id::text)::text ||
        ',"organizationId":' || to_json(p_organization_id)::text ||
        ',"pageNumber":' || p_page_number::text ||
        ',"projectId":' || to_json(p_project_id)::text ||
        ',"schemaVersion":"ecos-visual-provider-operation/1.0"' ||
        ',"sourceSha256":' || to_json(p_source_sha256)::text ||
        ',"visualExceptionFingerprint":' ||
          to_json(p_visual_exception_fingerprint)::text ||
        ',"visualRegionKey":' || to_json(p_visual_region_key)::text ||
        '}',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- Shared golden vector from
-- workers/ecos-indexer/tests/visual_provider_operation_id_v1.json. Applying
-- the migration aborts if SQL and the worker ever disagree about canonical
-- bytes, before any paid-call authorization surface becomes callable.
do $ecos_provider_operation_golden$
begin
  if public.ecos_visual_provider_operation_id_v1(
    'pie-rls-validation-org-a',
    '2321 Compliance Project',
    'web-document-09314ce4-aff1-4857-9cc9-5f13ecae4603',
    repeat('a', 64),
    17,
    '44444444-4444-4444-8444-444444444444'::uuid,
    '55555555-5555-4555-8555-555555555555'::uuid,
    'ecos-hosted-evidence/1.3',
    repeat('b', 64),
    'low-confidence-ocr-17-3'
  ) <> '8cb03b0dda19df38df3018f308da0f33cfd1aae77f0af36c0e8b6cf3431e3ea9' then
    raise exception 'ecos_visual_provider_operation_id_golden_mismatch';
  end if;
end;
$ecos_provider_operation_golden$;

create table if not exists public.ecos_drawing_analysis_requests (
  id uuid primary key default gen_random_uuid(),
  source_owner_id uuid not null references auth.users(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  document_id text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  page_number integer not null check (page_number between 1 and 10000),
  hosted_job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  hosted_claim_token uuid not null,
  evidence_version text not null check (
    evidence_version ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$'
  ),
  visual_exception_fingerprint text not null check (
    visual_exception_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  visual_region_key text not null check (
    octet_length(visual_region_key) between 1 and 300
    and visual_region_key ~ '^[!-~]+$'
  ),
  provider_operation_id text not null unique check (
    provider_operation_id ~ '^[a-f0-9]{64}$'
  ),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload_bytes bigint not null check (payload_bytes between 1 and 19922944),
  status text not null default 'processing' check (
    status in ('processing', 'completed', 'failed')
  ),
  response_payload jsonb check (
    response_payload is null or (
      jsonb_typeof(response_payload) = 'object' and
      octet_length(response_payload::text) <= 1048576
    )
  ),
  failure_code text check (
    failure_code is null or failure_code ~ '^[a-z0-9][a-z0-9_.:-]{0,119}$'
  ),
  processing_expires_at timestamptz not null default (clock_timestamp() + interval '6 minutes'),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (hosted_job_id, idempotency_key),
  constraint ecos_drawing_analysis_request_terminal_shape check (
    (status = 'processing' and response_payload is null and failure_code is null and completed_at is null) or
    (status = 'completed' and response_payload is not null and failure_code is null and completed_at is not null) or
    (status = 'failed' and response_payload is null and failure_code is not null and completed_at is not null)
  )
);

create table if not exists public.ecos_drawing_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.ecos_drawing_analysis_requests(id) on delete cascade,
  source_owner_id uuid not null references auth.users(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  document_id text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  page_number integer not null check (page_number between 1 and 10000),
  hosted_job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  provider_operation_id text not null check (provider_operation_id ~ '^[a-f0-9]{64}$'),
  call_role text not null check (call_role in (
    'analysis_primary',
    'analysis_capacity_fallback',
    'analysis_invalid_output_fallback',
    'assurance'
  )),
  call_ordinal integer not null check (call_ordinal between 1 and 16),
  provider text not null check (provider ~ '^[!-~]{1,80}$'),
  model text not null check (model ~ '^[!-~]{1,160}$'),
  idempotency_key text not null check (
    octet_length(idempotency_key) between 1 and 300
    and idempotency_key ~ '^[!-~]+$'
  ),
  reserved_at timestamptz not null default clock_timestamp(),
  unique (request_id, idempotency_key),
  unique (request_id, call_ordinal)
);

create index if not exists ecos_drawing_analysis_requests_owner_day_idx
  on public.ecos_drawing_analysis_requests (source_owner_id, created_at);
create index if not exists ecos_drawing_analysis_requests_org_day_idx
  on public.ecos_drawing_analysis_requests (organization_id, created_at);
create index if not exists ecos_drawing_analysis_requests_project_day_idx
  on public.ecos_drawing_analysis_requests (organization_id, project_id, created_at);
create index if not exists ecos_drawing_analysis_requests_active_idx
  on public.ecos_drawing_analysis_requests (status, processing_expires_at);
create index if not exists ecos_drawing_provider_attempts_owner_day_idx
  on public.ecos_drawing_provider_attempts (source_owner_id, reserved_at);
create index if not exists ecos_drawing_provider_attempts_org_day_idx
  on public.ecos_drawing_provider_attempts (organization_id, reserved_at);
create index if not exists ecos_drawing_provider_attempts_project_day_idx
  on public.ecos_drawing_provider_attempts (organization_id, project_id, reserved_at);
create index if not exists ecos_drawing_provider_attempts_request_idx
  on public.ecos_drawing_provider_attempts (request_id, reserved_at);

alter table public.ecos_drawing_analysis_requests enable row level security;
alter table public.ecos_drawing_analysis_requests force row level security;
alter table public.ecos_drawing_provider_attempts enable row level security;
alter table public.ecos_drawing_provider_attempts force row level security;

-- No table policy or direct grant exists. Even service_role uses only the
-- narrow SECURITY DEFINER functions below, which revalidate the live lease.
revoke all on table public.ecos_drawing_analysis_requests
  from public, anon, authenticated, service_role;
revoke all on table public.ecos_drawing_provider_attempts
  from public, anon, authenticated, service_role;

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

  -- Daily request limits bound request creation even if no provider fetch is
  -- ultimately made: 200 per source owner, 300 per project, 500 per org.
  select count(*) into request_count
  from public.ecos_drawing_analysis_requests request
  where request.source_owner_id = current_job.source_owner_id
    and request.created_at >= day_start;
  if request_count >= 200 then
    raise exception 'daily source-owner drawing-analysis limit';
  end if;
  select count(*) into request_count
  from public.ecos_drawing_analysis_requests request
  where request.organization_id = current_job.organization_id
    and request.project_id = current_job.project_id
    and request.created_at >= day_start;
  if request_count >= 300 then
    raise exception 'daily project drawing-analysis limit';
  end if;
  select count(*) into request_count
  from public.ecos_drawing_analysis_requests request
  where request.organization_id = current_job.organization_id
    and request.created_at >= day_start;
  if request_count >= 500 then
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

create or replace function public.ecos_reserve_drawing_provider_attempt(
  p_request_id uuid,
  p_provider_operation_id text,
  p_call_role text,
  p_call_ordinal integer,
  p_provider text,
  p_model text,
  p_idempotency_key text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '5s'
as $$
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
   and configuration.enabled = true
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
$$;

create or replace function public.ecos_finish_drawing_analysis(
  p_request_id uuid,
  p_provider_operation_id text,
  p_status text,
  p_response_payload jsonb default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '5s'
as $$
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
     and configuration.enabled = true
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
$$;

revoke all on function public.ecos_visual_provider_operation_id_v1(
  text, text, text, text, integer, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.ecos_begin_drawing_analysis(
  text, text, text, text, integer, uuid, uuid, text, text, text,
  text, text, text, bigint
) from public, anon, authenticated;
revoke all on function public.ecos_reserve_drawing_provider_attempt(
  uuid, text, text, integer, text, text, text
) from public, anon, authenticated;
revoke all on function public.ecos_finish_drawing_analysis(
  uuid, text, text, jsonb, text
) from public, anon, authenticated;

grant execute on function public.ecos_begin_drawing_analysis(
  text, text, text, text, integer, uuid, uuid, text, text, text,
  text, text, text, bigint
) to service_role;
grant execute on function public.ecos_reserve_drawing_provider_attempt(
  uuid, text, text, integer, text, text, text
) to service_role;
grant execute on function public.ecos_finish_drawing_analysis(
  uuid, text, text, jsonb, text
) to service_role;

commit;
