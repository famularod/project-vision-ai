-- Fail-closed visual-exception evidence contract v2
--
-- A visual provider result is reusable only for the exact extraction evidence
-- version and exception fingerprint that produced it. Resolution is an atomic
-- upsert so an initially successful provider call cannot disappear merely
-- because the unresolved row had not yet been inserted. All RPCs remain
-- service-role only, and shadow readiness also requires durable search chunks.

begin;

alter table public.ecos_hosted_visual_exceptions
  add column if not exists evidence_version text,
  add column if not exists exception_fingerprint text;

alter table public.ecos_hosted_visual_exceptions
  drop constraint if exists ecos_hosted_visual_exceptions_evidence_version_check,
  add constraint ecos_hosted_visual_exceptions_evidence_version_check
    check (
      evidence_version is null or
      evidence_version ~ '^ecos-hosted-evidence/[0-9]+\.[0-9]+$'
    ),
  drop constraint if exists ecos_hosted_visual_exceptions_fingerprint_check,
  add constraint ecos_hosted_visual_exceptions_fingerprint_check
    check (
      exception_fingerprint is null or
      exception_fingerprint ~ '^[a-f0-9]{64}$'
    );

create index if not exists ecos_hosted_visual_exceptions_exact_resolution_idx
  on public.ecos_hosted_visual_exceptions (
    job_id, page_number, region_key, evidence_version, exception_fingerprint
  )
  where state = 'resolved';

alter table public.ecos_hosted_visual_exceptions enable row level security;
alter table public.ecos_hosted_visual_exceptions force row level security;
revoke all on table public.ecos_hosted_visual_exceptions
  from public, anon, authenticated;
grant all on table public.ecos_hosted_visual_exceptions to service_role;

create or replace function public.ecos_reserve_hosted_visual_region_v2(
  p_job_id uuid,
  p_claim_token uuid,
  p_page_number integer,
  p_region_key text,
  p_evidence_version text,
  p_exception_fingerprint text,
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
  normalized_key text;
  normalized_version text;
  normalized_fingerprint text;
  reservation_key text;
  current_count bigint;
  affected_rows integer := 0;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Worker authorization required';
  end if;
  normalized_key := left(trim(coalesce(p_region_key, '')), 300);
  normalized_version := left(trim(coalesce(p_evidence_version, '')), 100);
  normalized_fingerprint := lower(trim(coalesce(p_exception_fingerprint, '')));
  if p_page_number < 1 or normalized_key !~ '^low-confidence-ocr-' then
    raise exception 'Fact-resolvable visual exception identity required';
  end if;
  if normalized_version !~ '^ecos-hosted-evidence/[0-9]+\.[0-9]+$' or
      normalized_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Exact visual evidence version and fingerprint required';
  end if;

  select job.* into current_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
    and job.claim_token = p_claim_token
    and job.lease_expires_at >= now()
  for update;
  if not found then return false; end if;
  if p_page_number > current_job.source_page_count then
    raise exception 'Visual exception page is outside the verified source';
  end if;

  select config.* into current_config
  from public.ecos_hosted_index_configuration config
  where config.organization_id = current_job.organization_id
  for update;
  if not found or not current_config.enabled then return false; end if;

  reservation_key := 'visual:v2:' || normalized_version || ':' ||
    normalized_fingerprint || ':' || p_claim_token::text || ':' ||
    p_page_number::text || ':' || normalized_key;
  if exists (
    select 1 from public.ecos_hosted_index_usage usage
    where usage.job_id = current_job.id
      and usage.idempotency_key = reservation_key
  ) then return true; end if;

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
      'regionKey', normalized_key,
      'evidenceVersion', normalized_version,
      'exceptionFingerprint', normalized_fingerprint,
      'providerAttempt', 'exact_visual_exception_v2'
    )
  ) on conflict (job_id, idempotency_key) do nothing;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

create or replace function public.ecos_upsert_hosted_visual_exception_v2(
  p_job_id uuid,
  p_claim_token uuid,
  p_page_number integer,
  p_region_key text,
  p_bounds jsonb,
  p_reason text,
  p_evidence_version text,
  p_exception_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
  normalized_key text;
  normalized_reason text;
  normalized_version text;
  normalized_fingerprint text;
  affected_rows integer := 0;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Worker authorization required';
  end if;
  normalized_key := left(trim(coalesce(p_region_key, '')), 300);
  normalized_reason := left(trim(coalesce(p_reason, '')), 1000);
  normalized_version := left(trim(coalesce(p_evidence_version, '')), 100);
  normalized_fingerprint := lower(trim(coalesce(p_exception_fingerprint, '')));
  if p_page_number < 1 or length(normalized_key) < 1 or length(normalized_reason) < 1 then
    raise exception 'Complete visual exception identity required';
  end if;
  if normalized_version !~ '^ecos-hosted-evidence/[0-9]+\.[0-9]+$' or
      normalized_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Exact visual evidence version and fingerprint required';
  end if;
  if jsonb_typeof(coalesce(p_bounds, 'null'::jsonb)) <> 'object' or
      jsonb_typeof(p_bounds->'x') <> 'number' or
      jsonb_typeof(p_bounds->'y') <> 'number' or
      jsonb_typeof(p_bounds->'width') <> 'number' or
      jsonb_typeof(p_bounds->'height') <> 'number' or
      (p_bounds->>'x')::numeric < 0 or (p_bounds->>'y')::numeric < 0 or
      (p_bounds->>'width')::numeric <= 0 or (p_bounds->>'height')::numeric <= 0 or
      (p_bounds->>'x')::numeric + (p_bounds->>'width')::numeric > 1.000001 or
      (p_bounds->>'y')::numeric + (p_bounds->>'height')::numeric > 1.000001 then
    raise exception 'Normalized visual exception bounds required';
  end if;

  select job.* into current_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
    and job.claim_token = p_claim_token
    and job.lease_expires_at >= now()
  for update;
  if not found then return false; end if;
  if p_page_number > current_job.source_page_count then
    raise exception 'Visual exception page is outside the verified source';
  end if;

  insert into public.ecos_hosted_visual_exceptions (
    job_id, organization_id, project_id, document_id, page_number,
    region_key, bounds, reason, state, evidence_version,
    exception_fingerprint, provider_result, normalized_evidence,
    assurance_result, claimed_by, lease_expires_at, updated_at
  ) values (
    current_job.id, current_job.organization_id, current_job.project_id,
    current_job.document_id, p_page_number, normalized_key, p_bounds,
    normalized_reason, 'queued', normalized_version, normalized_fingerprint,
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, null, null, now()
  )
  on conflict (job_id, page_number, region_key) do update set
    bounds = excluded.bounds,
    reason = excluded.reason,
    state = 'queued',
    evidence_version = excluded.evidence_version,
    exception_fingerprint = excluded.exception_fingerprint,
    provider_result = '{}'::jsonb,
    normalized_evidence = '{}'::jsonb,
    assurance_result = '{}'::jsonb,
    claimed_by = null,
    lease_expires_at = null,
    updated_at = now();
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

create or replace function public.ecos_resolve_hosted_visual_exception_v2(
  p_job_id uuid,
  p_claim_token uuid,
  p_page_number integer,
  p_region_key text,
  p_bounds jsonb,
  p_reason text,
  p_evidence_version text,
  p_exception_fingerprint text,
  p_normalized_evidence jsonb,
  p_assurance_result jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
  normalized_key text;
  normalized_reason text;
  normalized_version text;
  normalized_fingerprint text;
  fact jsonb;
  exception_x numeric;
  exception_y numeric;
  exception_width numeric;
  exception_height numeric;
  fact_x numeric;
  fact_y numeric;
  fact_width numeric;
  fact_height numeric;
  intersection_width numeric;
  intersection_height numeric;
  intersection_area numeric;
  smaller_area numeric;
  provider_x integer;
  provider_y integer;
  provider_width integer;
  provider_height integer;
  candidate_index jsonb;
  fact_count integer;
  affected_rows integer := 0;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Worker authorization required';
  end if;
  normalized_key := left(trim(coalesce(p_region_key, '')), 300);
  normalized_reason := left(trim(coalesce(p_reason, '')), 1000);
  normalized_version := left(trim(coalesce(p_evidence_version, '')), 100);
  normalized_fingerprint := lower(trim(coalesce(p_exception_fingerprint, '')));
  if p_page_number < 1 or normalized_key !~ '^low-confidence-ocr-' or
      length(normalized_reason) < 1 then
    raise exception 'Fact-resolvable visual exception identity required';
  end if;
  if normalized_version !~ '^ecos-hosted-evidence/[0-9]+\.[0-9]+$' or
      normalized_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Exact visual evidence version and fingerprint required';
  end if;
  if jsonb_typeof(coalesce(p_bounds, 'null'::jsonb)) <> 'object' or
      jsonb_typeof(p_bounds->'x') <> 'number' or
      jsonb_typeof(p_bounds->'y') <> 'number' or
      jsonb_typeof(p_bounds->'width') <> 'number' or
      jsonb_typeof(p_bounds->'height') <> 'number' then
    raise exception 'Normalized visual exception bounds required';
  end if;
  exception_x := (p_bounds->>'x')::numeric;
  exception_y := (p_bounds->>'y')::numeric;
  exception_width := (p_bounds->>'width')::numeric;
  exception_height := (p_bounds->>'height')::numeric;
  if exception_x < 0 or exception_y < 0 or exception_width <= 0 or
      exception_height <= 0 or exception_x + exception_width > 1.000001 or
      exception_y + exception_height > 1.000001 then
    raise exception 'Normalized visual exception bounds required';
  end if;

  if jsonb_typeof(coalesce(p_normalized_evidence, 'null'::jsonb)) <> 'object' or
      p_normalized_evidence->>'schemaVersion' is distinct from 'ecos-drawing-page-analysis/2.0' or
      p_normalized_evidence->>'evidenceVersion' is distinct from normalized_version or
      p_normalized_evidence->>'exceptionFingerprint' is distinct from normalized_fingerprint or
      length(trim(coalesce(p_normalized_evidence->>'evidenceText', ''))) < 1 or
      length(trim(coalesce(p_normalized_evidence->>'visionProvider', ''))) < 1 or
      length(trim(coalesce(p_normalized_evidence->>'model', ''))) < 1 or
      length(trim(coalesce(p_normalized_evidence->>'assuranceProvider', ''))) < 1 or
      length(trim(coalesce(p_normalized_evidence->>'assuranceModel', ''))) < 1 or
      jsonb_typeof(p_normalized_evidence->'confidence') <> 'number' or
      (p_normalized_evidence->>'confidence')::numeric < 0.85 or
      (p_normalized_evidence->>'confidence')::numeric > 1 or
      jsonb_typeof(p_normalized_evidence->'facts') <> 'array' then
    raise exception 'Assured schema-v2 visual evidence required';
  end if;
  fact_count := jsonb_array_length(p_normalized_evidence->'facts');
  if fact_count < 1 or fact_count > 72 then
    raise exception 'Bounded assured visual facts required';
  end if;

  if jsonb_typeof(coalesce(p_assurance_result, 'null'::jsonb)) <> 'object' or
      p_assurance_result->>'accepted' is distinct from 'true' or
      p_assurance_result->>'method' is distinct from 'bounded_visual_exception_v2' or
      p_assurance_result->>'schemaVersion' is distinct from 'ecos-drawing-page-analysis/2.0' or
      p_assurance_result->>'evidenceVersion' is distinct from normalized_version or
      p_assurance_result->>'exceptionFingerprint' is distinct from normalized_fingerprint or
      length(trim(coalesce(p_assurance_result->>'assuranceProvider', ''))) < 1 or
      p_assurance_result->>'assuranceProvider' is distinct from
        p_normalized_evidence->>'assuranceProvider' or
      coalesce(p_assurance_result->>'acceptedFactCount', '') !~ '^[0-9]+$' or
      (p_assurance_result->>'acceptedFactCount')::integer <> fact_count or
      jsonb_typeof(p_assurance_result->'minimumConfidence') <> 'number' or
      (p_assurance_result->>'minimumConfidence')::numeric < 0.85 then
    raise exception 'Independent ECOS Assurance acceptance required';
  end if;

  for fact in select value from jsonb_array_elements(p_normalized_evidence->'facts')
  loop
    if jsonb_typeof(fact) <> 'object' or
        length(trim(coalesce(fact->>'statement', ''))) < 1 or
        length(trim(coalesce(fact->>'evidenceText', ''))) < 1 or
        fact->>'evidenceVersion' is distinct from normalized_version or
        fact->>'exceptionFingerprint' is distinct from normalized_fingerprint or
        length(trim(coalesce(fact->>'visionProvider', ''))) < 1 or
        length(trim(coalesce(fact->>'model', ''))) < 1 or
        length(trim(coalesce(fact->>'assuranceProvider', ''))) < 1 or
        length(trim(coalesce(fact->>'assuranceModel', ''))) < 1 or
        fact->>'visionProvider' is distinct from p_normalized_evidence->>'visionProvider' or
        fact->>'model' is distinct from p_normalized_evidence->>'model' or
        fact->>'assuranceProvider' is distinct from p_normalized_evidence->>'assuranceProvider' or
        fact->>'assuranceModel' is distinct from p_normalized_evidence->>'assuranceModel' or
        jsonb_typeof(fact->'confidence') <> 'number' or
        (fact->>'confidence')::numeric < 0.85 or
        (fact->>'confidence')::numeric > 1 or
        jsonb_typeof(fact->'corroboratedCandidateIndexes') <> 'array' or
        jsonb_array_length(fact->'corroboratedCandidateIndexes') < 1 or
        jsonb_typeof(fact->'bounds') <> 'object' or
        jsonb_typeof(fact->'providerBounds') <> 'object' then
      raise exception 'Every visual fact must retain exact assured provenance';
    end if;
    if jsonb_typeof(fact->'bounds'->'x') <> 'number' or
        jsonb_typeof(fact->'bounds'->'y') <> 'number' or
        jsonb_typeof(fact->'bounds'->'width') <> 'number' or
        jsonb_typeof(fact->'bounds'->'height') <> 'number' or
        coalesce(fact->'providerBounds'->>'x', '') !~ '^[0-9]+$' or
        coalesce(fact->'providerBounds'->>'y', '') !~ '^[0-9]+$' or
        coalesce(fact->'providerBounds'->>'width', '') !~ '^[0-9]+$' or
        coalesce(fact->'providerBounds'->>'height', '') !~ '^[0-9]+$' then
      raise exception 'Exact provider fact bounds required';
    end if;
    for candidate_index in
      select value from jsonb_array_elements(fact->'corroboratedCandidateIndexes')
    loop
      if jsonb_typeof(candidate_index) <> 'number' or
          candidate_index::text !~ '^[0-9]+$' or
          candidate_index::text::integer > 11 then
        raise exception 'Invalid corroborated diagnostic candidate index';
      end if;
    end loop;
    fact_x := (fact->'bounds'->>'x')::numeric;
    fact_y := (fact->'bounds'->>'y')::numeric;
    fact_width := (fact->'bounds'->>'width')::numeric;
    fact_height := (fact->'bounds'->>'height')::numeric;
    provider_x := (fact->'providerBounds'->>'x')::integer;
    provider_y := (fact->'providerBounds'->>'y')::integer;
    provider_width := (fact->'providerBounds'->>'width')::integer;
    provider_height := (fact->'providerBounds'->>'height')::integer;
    if fact_x < 0 or fact_y < 0 or fact_width <= 0 or fact_height <= 0 or
        fact_x + fact_width > 1.000001 or fact_y + fact_height > 1.000001 or
        provider_x < 0 or provider_y < 0 or provider_width < 1 or provider_height < 1 or
        provider_x + provider_width > 1000 or provider_y + provider_height > 1000 or
        abs(fact_x - provider_x::numeric / 1000) > 0.000001 or
        abs(fact_y - provider_y::numeric / 1000) > 0.000001 or
        abs(fact_width - provider_width::numeric / 1000) > 0.000001 or
        abs(fact_height - provider_height::numeric / 1000) > 0.000001 or
        fact_x < exception_x - 0.001 or
        fact_y < exception_y - 0.001 or
        fact_x + fact_width > exception_x + exception_width + 0.001 or
        fact_y + fact_height > exception_y + exception_height + 0.001 then
      raise exception 'Visual fact proof is outside the exact exception bounds';
    end if;
    intersection_width := greatest(
      0,
      least(fact_x + fact_width, exception_x + exception_width) -
        greatest(fact_x, exception_x)
    );
    intersection_height := greatest(
      0,
      least(fact_y + fact_height, exception_y + exception_height) -
        greatest(fact_y, exception_y)
    );
    intersection_area := intersection_width * intersection_height;
    smaller_area := least(
      fact_width * fact_height,
      exception_width * exception_height
    );
    if smaller_area <= 0 or intersection_area < smaller_area * 0.5 then
      raise exception 'Visual fact proof does not materially overlap the exact exception bounds';
    end if;
  end loop;

  select job.* into current_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
    and job.claim_token = p_claim_token
    and job.lease_expires_at >= now()
  for update;
  if not found then return false; end if;
  if p_page_number > current_job.source_page_count then
    raise exception 'Visual exception page is outside the verified source';
  end if;

  insert into public.ecos_hosted_visual_exceptions (
    job_id, organization_id, project_id, document_id, page_number,
    region_key, bounds, reason, state, evidence_version,
    exception_fingerprint, provider_result, normalized_evidence,
    assurance_result, claimed_by, lease_expires_at, updated_at
  ) values (
    current_job.id, current_job.organization_id, current_job.project_id,
    current_job.document_id, p_page_number, normalized_key, p_bounds,
    normalized_reason, 'resolved', normalized_version, normalized_fingerprint,
    jsonb_build_object(
      'schemaVersion', p_normalized_evidence->>'schemaVersion',
      'visionProvider', p_normalized_evidence->>'visionProvider',
      'model', p_normalized_evidence->>'model'
    ),
    p_normalized_evidence, p_assurance_result, null, null, now()
  )
  on conflict (job_id, page_number, region_key) do update set
    bounds = excluded.bounds,
    reason = excluded.reason,
    state = 'resolved',
    evidence_version = excluded.evidence_version,
    exception_fingerprint = excluded.exception_fingerprint,
    provider_result = excluded.provider_result,
    normalized_evidence = excluded.normalized_evidence,
    assurance_result = excluded.assurance_result,
    claimed_by = null,
    lease_expires_at = null,
    updated_at = now();
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

-- A refresh queue entry is removed only after it produced at least one durable
-- search chunk. Raising rolls back both any intermediate deletes and the queue
-- deletion, so a retry cannot silently turn an accepted page into no evidence.
create or replace function public.ecos_materialize_next_hosted_shadow_page(
  p_job_id uuid,
  p_claim_token uuid
)
returns table(page_number integer, operation text, chunk_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '150s'
set lock_timeout = '5s'
as $$
declare
  selected_job public.ecos_hosted_index_jobs%rowtype;
  pending public.ecos_hosted_shadow_materialization_queue%rowtype;
  materialized_count integer := 0;
  affected_rows integer := 0;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Worker authorization required';
  end if;
  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
    and job.claim_token = p_claim_token
    and job.lease_expires_at >= now()
    and job.mode = 'shadow';
  if not found then raise exception 'Shadow worker lease is unavailable'; end if;

  select queued.* into pending
  from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = selected_job.id
  order by queued.requested_at, queued.page_number
  for update skip locked
  limit 1;
  if not found then return; end if;

  if pending.operation = 'delete' then
    delete from public.ecos_hosted_shadow_chunks chunk
    where chunk.job_id = pending.job_id and chunk.page_number = pending.page_number;
    get diagnostics materialized_count = row_count;
  else
    materialized_count := public.ecos_refresh_hosted_shadow_page(
      pending.job_id, pending.page_number
    );
    materialized_count := materialized_count +
      public.ecos_append_hosted_shadow_region_text(
        pending.job_id, pending.page_number
      );
    if materialized_count < 1 or not exists (
      select 1 from public.ecos_hosted_shadow_chunks chunk
      where chunk.job_id = pending.job_id
        and chunk.page_number = pending.page_number
    ) then
      raise exception using
        errcode = '55000',
        message = 'Accepted shadow page produced no durable search chunks';
    end if;
  end if;

  delete from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = pending.job_id and queued.page_number = pending.page_number;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Shadow materialization queue acknowledgement failed';
  end if;
  return query select pending.page_number, pending.operation, materialized_count;
end;
$$;

create or replace function public.ecos_require_complete_shadow_materialization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.mode = 'shadow' and new.state = 'ready' then
    if exists (
      select 1 from public.ecos_hosted_shadow_materialization_queue queued
      where queued.job_id = new.id
    ) then
      raise exception using errcode = '55000',
        message = 'Shadow search materialization is incomplete';
    end if;
    if exists (
      select 1
      from public.ecos_hosted_index_pages page
      where page.job_id = new.id
        and page.state = 'assured'
        and page.assurance_result->>'accepted' = 'true'
        and page.unresolved_region_count = 0
        and not exists (
          select 1 from public.ecos_hosted_shadow_chunks chunk
          where chunk.job_id = page.job_id
            and chunk.page_number = page.page_number
        )
    ) then
      raise exception using errcode = '55000',
        message = 'An accepted shadow page has no durable search chunks';
    end if;
    if exists (
      select 1
      from public.ecos_hosted_visual_exceptions exception
      where exception.job_id = new.id
        and exception.state = 'resolved'
        and (
          exception.evidence_version is distinct from new.committed_evidence_version or
          coalesce(exception.exception_fingerprint, '') !~ '^[a-f0-9]{64}$' or
          exception.assurance_result->>'accepted' is distinct from 'true' or
          exception.assurance_result->>'schemaVersion' is distinct from
            'ecos-drawing-page-analysis/2.0' or
          exception.assurance_result->>'evidenceVersion' is distinct from
            exception.evidence_version or
          exception.assurance_result->>'exceptionFingerprint' is distinct from
            exception.exception_fingerprint or
          length(trim(coalesce(exception.assurance_result->>'assuranceProvider', ''))) < 1
        )
    ) then
      raise exception using errcode = '55000',
        message = 'Resolved visual evidence is stale or unassured';
    end if;
  end if;
  return new;
end;
$$;

-- Cut off every unversioned mutation or reservation path after v2 exists.
revoke all on function public.ecos_upsert_hosted_visual_exception(
  uuid, uuid, integer, text, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.ecos_resolve_hosted_visual_exception(
  uuid, uuid, integer, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.ecos_reserve_hosted_visual_region(
  uuid, uuid, integer, text, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.ecos_reserve_hosted_visual_region_versioned(
  uuid, uuid, integer, text, text, bigint
) from public, anon, authenticated, service_role;

revoke all on function public.ecos_reserve_hosted_visual_region_v2(
  uuid, uuid, integer, text, text, text, bigint
) from public, anon, authenticated;
revoke all on function public.ecos_upsert_hosted_visual_exception_v2(
  uuid, uuid, integer, text, jsonb, text, text, text
) from public, anon, authenticated;
revoke all on function public.ecos_resolve_hosted_visual_exception_v2(
  uuid, uuid, integer, text, jsonb, text, text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.ecos_upsert_hosted_visual_exception_v2(
  uuid, uuid, integer, text, jsonb, text, text, text
) to service_role;
grant execute on function public.ecos_resolve_hosted_visual_exception_v2(
  uuid, uuid, integer, text, jsonb, text, text, text, jsonb, jsonb
) to service_role;
grant execute on function public.ecos_reserve_hosted_visual_region_v2(
  uuid, uuid, integer, text, text, text, bigint
) to service_role;

revoke all on function public.ecos_materialize_next_hosted_shadow_page(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ecos_materialize_next_hosted_shadow_page(uuid, uuid)
  to service_role;
revoke all on function public.ecos_require_complete_shadow_materialization()
  from public, anon, authenticated, service_role;

commit;
