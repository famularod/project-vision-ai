begin;

-- A low-confidence OCR candidate may be dismissed only when the bounded
-- primary analysis and a separate assurance provider independently agree that
-- every exact candidate is not directly and legibly corroborated. A dismissal
-- resolves the extraction exception but creates no searchable drawing fact.
create or replace function public.ecos_dismiss_hosted_visual_exception_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_page_number integer,
  p_region_key text,
  p_bounds jsonb,
  p_reason text,
  p_evidence_version text,
  p_exception_fingerprint text,
  p_normalized_dismissal jsonb,
  p_assurance_result jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
  normalized_key text := left(trim(coalesce(p_region_key, '')), 300);
  normalized_reason text := left(trim(coalesce(p_reason, '')), 1000);
  normalized_version text := left(trim(coalesce(p_evidence_version, '')), 100);
  normalized_fingerprint text := lower(trim(coalesce(p_exception_fingerprint, '')));
  exception_x numeric;
  exception_y numeric;
  exception_width numeric;
  exception_height numeric;
  candidate_count integer;
  candidate jsonb;
  candidate_x numeric;
  candidate_y numeric;
  candidate_width numeric;
  candidate_height numeric;
  affected_rows integer := 0;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Worker authorization required';
  end if;
  if p_page_number < 1 or normalized_key !~ '^low-confidence-ocr-' or
      length(normalized_reason) < 1 then
    raise exception 'Dismissible visual exception identity required';
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

  if jsonb_typeof(coalesce(p_normalized_dismissal, 'null'::jsonb)) <> 'object' or
      p_normalized_dismissal->>'schemaVersion' is distinct from
        'ecos-drawing-page-analysis/2.0' or
      p_normalized_dismissal->>'resolutionType' is distinct from
        'independently_unverifiable_candidates' or
      p_normalized_dismissal->>'evidenceVersion' is distinct from normalized_version or
      p_normalized_dismissal->>'exceptionFingerprint' is distinct from normalized_fingerprint or
      p_normalized_dismissal->'facts' is distinct from '[]'::jsonb or
      jsonb_typeof(p_normalized_dismissal->'dismissedCandidateIndexes') <> 'array' or
      jsonb_typeof(p_normalized_dismissal->'dismissedDiagnosticCandidates') <> 'array' or
      length(trim(coalesce(p_normalized_dismissal->>'visionProvider', ''))) < 1 or
      length(trim(coalesce(p_normalized_dismissal->>'model', ''))) < 1 or
      length(trim(coalesce(p_normalized_dismissal->>'assuranceProvider', ''))) < 1 or
      length(trim(coalesce(p_normalized_dismissal->>'assuranceModel', ''))) < 1 or
      p_normalized_dismissal->>'visionProvider' =
        p_normalized_dismissal->>'assuranceProvider' then
    raise exception 'Independent non-evidentiary dismissal proof required';
  end if;
  candidate_count := jsonb_array_length(
    p_normalized_dismissal->'dismissedDiagnosticCandidates'
  );
  if candidate_count < 1 or candidate_count > 12 or
      jsonb_array_length(p_normalized_dismissal->'dismissedCandidateIndexes') <>
        candidate_count then
    raise exception 'Every bounded diagnostic candidate must be dismissed';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(
      p_normalized_dismissal->'dismissedCandidateIndexes'
    ) with ordinality as dismissed(value, position)
    where jsonb_typeof(dismissed.value) <> 'number'
       or dismissed.value::text !~ '^[0-9]+$'
       or dismissed.value::text::integer <> dismissed.position - 1
  ) then
    raise exception 'Dismissed candidate indexes must be exact and complete';
  end if;

  for candidate in
    select value from jsonb_array_elements(
      p_normalized_dismissal->'dismissedDiagnosticCandidates'
    )
  loop
    if jsonb_typeof(candidate) <> 'object' or
        length(trim(coalesce(candidate->>'text', ''))) < 1 or
        length(trim(coalesce(candidate->>'source', ''))) < 1 or
        jsonb_typeof(candidate->'confidence') <> 'number' or
        (candidate->>'confidence')::numeric < 0 or
        (candidate->>'confidence')::numeric > 1 or
        jsonb_typeof(candidate->'bounds') <> 'object' or
        jsonb_typeof(candidate->'bounds'->'x') <> 'number' or
        jsonb_typeof(candidate->'bounds'->'y') <> 'number' or
        jsonb_typeof(candidate->'bounds'->'width') <> 'number' or
        jsonb_typeof(candidate->'bounds'->'height') <> 'number' then
      raise exception 'Exact dismissed diagnostic candidate required';
    end if;
    candidate_x := (candidate->'bounds'->>'x')::numeric;
    candidate_y := (candidate->'bounds'->>'y')::numeric;
    candidate_width := (candidate->'bounds'->>'width')::numeric;
    candidate_height := (candidate->'bounds'->>'height')::numeric;
    if candidate_x < exception_x - 0.001 or candidate_y < exception_y - 0.001 or
        candidate_width <= 0 or candidate_height <= 0 or
        candidate_x + candidate_width > exception_x + exception_width + 0.001 or
        candidate_y + candidate_height > exception_y + exception_height + 0.001 then
      raise exception 'Dismissed candidate is outside the exact exception bounds';
    end if;
  end loop;

  if jsonb_typeof(coalesce(p_assurance_result, 'null'::jsonb)) <> 'object' or
      p_assurance_result->>'accepted' is distinct from 'true' or
      p_assurance_result->>'method' is distinct from
        'bounded_visual_exception_dismissal_v1' or
      p_assurance_result->>'schemaVersion' is distinct from
        'ecos-drawing-page-analysis/2.0' or
      p_assurance_result->>'evidenceVersion' is distinct from normalized_version or
      p_assurance_result->>'exceptionFingerprint' is distinct from normalized_fingerprint or
      p_assurance_result->>'assuranceProvider' is distinct from
        p_normalized_dismissal->>'assuranceProvider' or
      p_assurance_result->>'assuranceModel' is distinct from
        p_normalized_dismissal->>'assuranceModel' or
      coalesce(p_assurance_result->>'acceptedFactCount', '') <> '0' or
      coalesce(p_assurance_result->>'dismissedCandidateCount', '') !~ '^[0-9]+$' or
      (p_assurance_result->>'dismissedCandidateCount')::integer <> candidate_count then
    raise exception 'Independent dismissal assurance acceptance required';
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
    normalized_reason, 'resolved', normalized_version, normalized_fingerprint,
    jsonb_build_object(
      'resolutionType', 'independently_unverifiable_candidates',
      'visionProvider', p_normalized_dismissal->>'visionProvider',
      'model', p_normalized_dismissal->>'model'
    ),
    p_normalized_dismissal, p_assurance_result, null, null, now()
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

revoke all on function public.ecos_dismiss_hosted_visual_exception_v1(
  uuid, uuid, integer, text, jsonb, text, text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.ecos_dismiss_hosted_visual_exception_v1(
  uuid, uuid, integer, text, jsonb, text, text, text, jsonb, jsonb
) to service_role;

commit;
