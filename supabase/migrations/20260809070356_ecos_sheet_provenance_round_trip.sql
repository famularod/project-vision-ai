-- ECOS exact sheet-provenance round trip
--
-- Exact sheet citations are useful only when the page-bound mapping evidence
-- and independent Assurance decision survive every persistence boundary. This
-- migration adds that proof to live/legacy page rows and materializes the same
-- canonical payload in every searchable chunk. Invalid legacy labels remain
-- searchable by PDF page, but are never retained as verified sheet citations.

begin;

alter table public.ecos_document_pages
  add column if not exists sheet_mapping_source text,
  add column if not exists sheet_mapping_evidence jsonb not null default '[]'::jsonb,
  add column if not exists document_structural_identity jsonb,
  add column if not exists sheet_mapping_assurance jsonb not null default '{}'::jsonb,
  add column if not exists assurance_result jsonb not null default '{}'::jsonb;

alter table public.ecos_hosted_document_pages
  add column if not exists sheet_mapping_source text,
  add column if not exists sheet_mapping_evidence jsonb not null default '[]'::jsonb,
  add column if not exists document_structural_identity jsonb,
  add column if not exists sheet_mapping_assurance jsonb not null default '{}'::jsonb;

alter table public.ecos_document_pages
  add constraint ecos_document_pages_sheet_mapping_source_check
    check (sheet_mapping_source is null or sheet_mapping_source in (
      'pdf_bookmark', 'native_title_band', 'coordinate_text'
    )),
  add constraint ecos_document_pages_sheet_mapping_evidence_check
    check (jsonb_typeof(sheet_mapping_evidence) = 'array'),
  add constraint ecos_document_pages_structural_identity_check
    check (document_structural_identity is null or jsonb_typeof(document_structural_identity) = 'object'),
  add constraint ecos_document_pages_sheet_assurance_check
    check (jsonb_typeof(sheet_mapping_assurance) = 'object'),
  add constraint ecos_document_pages_assurance_result_check
    check (jsonb_typeof(assurance_result) = 'object');

alter table public.ecos_hosted_document_pages
  add constraint ecos_hosted_document_pages_sheet_mapping_source_check
    check (sheet_mapping_source is null or sheet_mapping_source in (
      'pdf_bookmark', 'native_title_band', 'coordinate_text'
    )),
  add constraint ecos_hosted_document_pages_sheet_mapping_evidence_check
    check (jsonb_typeof(sheet_mapping_evidence) = 'array'),
  add constraint ecos_hosted_document_pages_structural_identity_check
    check (document_structural_identity is null or jsonb_typeof(document_structural_identity) = 'object'),
  add constraint ecos_hosted_document_pages_sheet_assurance_check
    check (jsonb_typeof(sheet_mapping_assurance) = 'object');

create or replace function public.ecos_sheet_provenance_payload(
  p_page jsonb,
  p_assurance jsonb,
  p_require_assurance boolean default true
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  page_data jsonb := case when jsonb_typeof(p_page) = 'object' then p_page else '{}'::jsonb end;
  assurance_data jsonb := case when jsonb_typeof(p_assurance) = 'object' then p_assurance else '{}'::jsonb end;
  mapping_status text := coalesce(nullif(trim(page_data->>'sheetMappingStatus'), ''), 'unverified');
  mapping_source text := nullif(trim(page_data->>'sheetMappingSource'), '');
  sheet_number text := nullif(left(trim(page_data->>'sheetNumber'), 160), '');
  page_number integer;
  evidence_item jsonb;
  evidence_id text;
  evidence_text text;
  evidence_page integer;
  evidence_source text;
  evidence_bounds jsonb;
  canonical_evidence jsonb := '[]'::jsonb;
  canonical_identity jsonb;
  canonical_assurance jsonb;
  failure_codes jsonb := '[]'::jsonb;
  seen_ids text[] := array[]::text[];
  native_match_count integer := 0;
begin
  if coalesce(page_data->>'pageNumber', '') !~ '^[1-9][0-9]*$' then
    return null;
  end if;
  page_number := (page_data->>'pageNumber')::integer;
  if page_number > 10000 then return null; end if;

  if jsonb_typeof(assurance_data->'failureCodes') = 'array' then
    select coalesce(jsonb_agg(to_jsonb(left(trim(code.value), 160)) order by code.ordinality), '[]'::jsonb)
    into failure_codes
    from jsonb_array_elements_text(assurance_data->'failureCodes')
      with ordinality code(value, ordinality)
    where code.ordinality <= 32 and length(trim(code.value)) > 0;
  end if;
  canonical_assurance := jsonb_strip_nulls(jsonb_build_object(
    'accepted', case when jsonb_typeof(assurance_data->'accepted') = 'boolean'
      then assurance_data->'accepted' else 'false'::jsonb end,
    'method', nullif(left(trim(assurance_data->>'method'), 160), ''),
    'schemaVersion', nullif(left(trim(assurance_data->>'schemaVersion'), 160), ''),
    'evidenceVersion', nullif(left(trim(assurance_data->>'evidenceVersion'), 160), ''),
    'assuranceProvider', nullif(left(trim(assurance_data->>'assuranceProvider'), 160), ''),
    'assuranceModel', nullif(left(trim(assurance_data->>'assuranceModel'), 160), ''),
    'confidence', case when jsonb_typeof(assurance_data->'confidence') = 'number'
      and (assurance_data->>'confidence')::numeric between 0 and 1
      then assurance_data->'confidence' else null end,
    'checks', jsonb_build_object(
      'sheetMappingUsable', case
        when jsonb_typeof(assurance_data#>'{checks,sheetMappingUsable}') = 'boolean'
          then assurance_data#>'{checks,sheetMappingUsable}'
        else 'false'::jsonb end
    ),
    'failureCodes', failure_codes
  ));

  if mapping_status not in ('verified', 'conflicted', 'unverified') then
    mapping_status := 'unverified';
  end if;
  if mapping_status <> 'verified' then
    return jsonb_build_object(
      'sheetNumber', null,
      'sheetMappingStatus', mapping_status,
      'sheetMappingSource', case when mapping_source = 'coordinate_text'
        then mapping_source else null end,
      'sheetMappingEvidence', '[]'::jsonb,
      'documentStructuralIdentity', null,
      'sheetMappingAssurance', canonical_assurance
    );
  end if;

  if sheet_number is null or mapping_source not in ('pdf_bookmark', 'native_title_band') then
    return null;
  end if;
  if jsonb_typeof(page_data->'sheetMappingEvidence') <> 'array'
      or jsonb_array_length(page_data->'sheetMappingEvidence') not between 1 and 8 then
    return null;
  end if;

  for evidence_item in
    select item.value from jsonb_array_elements(page_data->'sheetMappingEvidence') item(value)
  loop
    if jsonb_typeof(evidence_item) <> 'object' then return null; end if;
    evidence_id := nullif(left(trim(evidence_item->>'id'), 300), '');
    evidence_text := nullif(left(regexp_replace(trim(evidence_item->>'text'), '\s+', ' ', 'g'), 1000), '');
    evidence_source := nullif(trim(evidence_item->>'source'), '');
    if coalesce(evidence_item->>'pageNumber', '') !~ '^[1-9][0-9]*$' then return null; end if;
    evidence_page := (evidence_item->>'pageNumber')::integer;
    if evidence_id is null or evidence_text is null or evidence_page <> page_number
        or evidence_id = any(seen_ids) then return null; end if;
    seen_ids := array_append(seen_ids, evidence_id);

    if mapping_source = 'pdf_bookmark' then
      if evidence_source <> 'pdf_bookmark'
          or coalesce(jsonb_typeof(evidence_item->'normalizedBounds'), 'null') <> 'null' then
        return null;
      end if;
      evidence_bounds := null;
    else
      evidence_bounds := evidence_item->'normalizedBounds';
      if evidence_source <> 'embedded_text' or jsonb_typeof(evidence_bounds) <> 'object'
          or jsonb_typeof(evidence_bounds->'x') <> 'number'
          or jsonb_typeof(evidence_bounds->'y') <> 'number'
          or jsonb_typeof(evidence_bounds->'width') <> 'number'
          or jsonb_typeof(evidence_bounds->'height') <> 'number'
          or (evidence_bounds->>'x')::numeric not between 0 and 1
          or (evidence_bounds->>'y')::numeric not between 0 and 1
          or (evidence_bounds->>'width')::numeric <= 0
          or (evidence_bounds->>'height')::numeric <= 0
          or (evidence_bounds->>'x')::numeric + (evidence_bounds->>'width')::numeric > 1.001
          or (evidence_bounds->>'y')::numeric + (evidence_bounds->>'height')::numeric > 1.001 then
        return null;
      end if;
    end if;

    canonical_evidence := canonical_evidence || jsonb_build_array(jsonb_build_object(
      'id', evidence_id,
      'pageNumber', evidence_page,
      'source', evidence_source,
      'text', evidence_text,
      'normalizedBounds', evidence_bounds
    ));
  end loop;

  if mapping_source = 'native_title_band' then
    if jsonb_array_length(canonical_evidence) <> 1
        or jsonb_typeof(page_data->'regions') <> 'array' then return null; end if;
    evidence_item := canonical_evidence->0;
    evidence_bounds := evidence_item->'normalizedBounds';
    select count(*)::integer into native_match_count
    from jsonb_array_elements(page_data->'regions') region(value)
    where region.value->>'id' = evidence_item->>'id'
      and regexp_replace(trim(coalesce(region.value->>'text', region.value->>'label')), '\s+', ' ', 'g') = evidence_item->>'text'
      and region.value->>'source' = 'embedded_text'
      and jsonb_typeof(region.value->'x') = 'number'
      and jsonb_typeof(region.value->'y') = 'number'
      and jsonb_typeof(region.value->'width') = 'number'
      and jsonb_typeof(region.value->'height') = 'number'
      and abs((region.value->>'x')::numeric - (evidence_bounds->>'x')::numeric) <= 0.000005
      and abs((region.value->>'y')::numeric - (evidence_bounds->>'y')::numeric) <= 0.000005
      and abs((region.value->>'width')::numeric - (evidence_bounds->>'width')::numeric) <= 0.000005
      and abs((region.value->>'height')::numeric - (evidence_bounds->>'height')::numeric) <= 0.000005;
    if native_match_count <> 1 then return null; end if;
  end if;

  canonical_identity := jsonb_build_object(
    'sheetNumber', sheet_number,
    'source', mapping_source,
    'evidence', canonical_evidence
  );
  if jsonb_typeof(page_data->'documentStructuralIdentity') = 'object'
      and page_data->'documentStructuralIdentity' <> '{}'::jsonb
      and page_data->'documentStructuralIdentity' <> canonical_identity then
    return null;
  end if;
  if p_require_assurance and (
    assurance_data->>'accepted' is distinct from 'true'
    or assurance_data#>>'{checks,sheetMappingUsable}' is distinct from 'true'
  ) then return null; end if;

  return jsonb_build_object(
    'sheetNumber', sheet_number,
    'sheetMappingStatus', 'verified',
    'sheetMappingSource', mapping_source,
    'sheetMappingEvidence', canonical_evidence,
    'documentStructuralIdentity', canonical_identity,
    'sheetMappingAssurance', canonical_assurance
  );
end;
$$;

revoke all on function public.ecos_sheet_provenance_payload(jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.ecos_sheet_provenance_payload(jsonb, jsonb, boolean)
  to service_role;

create or replace function public.ecos_prepare_legacy_page_sheet_provenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Legacy page and checkpoint rows are writable by the authenticated browser
  -- owner. Keep their searchable page content, but never let that client act as
  -- its own independent Assurance authority. Exact sheet provenance is
  -- published only through the service-owned hosted checkpoint boundary.
  new.sheet_number := null;
  new.sheet_mapping_status := case
    when new.sheet_mapping_status = 'conflicted' then 'conflicted'
    else 'unverified'
  end;
  new.sheet_mapping_source := case
    when new.sheet_mapping_status <> 'verified'
      and new.sheet_mapping_source = 'coordinate_text'
      then 'coordinate_text'
    else null
  end;
  new.sheet_mapping_evidence := '[]'::jsonb;
  new.document_structural_identity := null;
  new.sheet_mapping_assurance := '{}'::jsonb;
  new.assurance_result := '{}'::jsonb;
  -- Visual coverage is also an evidence-attestation claim. The browser may
  -- retain extracted page text and coordinates, but it cannot assert that a
  -- drawing received complete high-resolution review.
  new.visual_coverage := '{}'::jsonb;
  return new;
end;
$$;

drop trigger if exists ecos_prepare_legacy_page_sheet_provenance_trigger
  on public.ecos_document_pages;
create trigger ecos_prepare_legacy_page_sheet_provenance_trigger
before insert or update
on public.ecos_document_pages
for each row execute function public.ecos_prepare_legacy_page_sheet_provenance();

create or replace function public.ecos_prepare_hosted_page_sheet_provenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  page_payload jsonb;
  assurance_payload jsonb;
  canonical jsonb;
begin
  page_payload := jsonb_strip_nulls(jsonb_build_object(
    'pageNumber', new.page_number,
    'sheetNumber', new.sheet_number,
    'sheetMappingStatus', coalesce(new.sheet_mapping_status, 'unverified'),
    'sheetMappingSource', new.sheet_mapping_source,
    'sheetMappingEvidence', new.sheet_mapping_evidence,
    'documentStructuralIdentity', new.document_structural_identity,
    'regions', new.regions
  ));
  assurance_payload := new.assurance_result;

  -- A verified hosted sheet is always reconstructed from the exact trusted
  -- live checkpoint. Never accept a verified row's self-supplied provenance,
  -- even when the caller has service-role table access.
  if coalesce(new.sheet_mapping_status, 'unverified') = 'verified' then
    select page.final_page_data, page.assurance_result
    into page_payload, assurance_payload
    from public.ecos_hosted_index_jobs job
    join public.ecos_hosted_index_pages page
      on page.job_id = job.id
     and page.organization_id = job.organization_id
     and page.project_id = job.project_id
     and page.document_id = job.document_id
     and page.source_sha256 = job.source_sha256
     and page.page_number = new.page_number
    where job.organization_id = new.organization_id
      and job.project_id = new.project_id
      and job.document_id = new.document_id
      and job.source_sha256 = new.source_sha256
      and job.mode = 'live'
      and page.state = 'assured'
      and page.unresolved_region_count = 0
      and page.assurance_result->>'accepted' = 'true'
    order by page.updated_at desc
    limit 1;

    if not found then
      page_payload := jsonb_build_object(
        'pageNumber', new.page_number,
        'sheetMappingStatus', 'unverified',
        'sheetMappingSource', null,
        'sheetMappingEvidence', '[]'::jsonb,
        'documentStructuralIdentity', null,
        'regions', new.regions
      );
      assurance_payload := '{}'::jsonb;
    end if;
  end if;

  canonical := public.ecos_sheet_provenance_payload(page_payload, assurance_payload, true);
  if canonical is null then
    canonical := public.ecos_sheet_provenance_payload(
      page_payload || jsonb_build_object(
        'sheetMappingStatus', 'unverified',
        'sheetMappingSource', null,
        'sheetMappingEvidence', '[]'::jsonb,
        'documentStructuralIdentity', null
      ),
      assurance_payload,
      false
    );
  end if;
  new.sheet_number := nullif(canonical->>'sheetNumber', '');
  new.sheet_mapping_status := coalesce(canonical->>'sheetMappingStatus', 'unverified');
  new.sheet_mapping_source := nullif(canonical->>'sheetMappingSource', '');
  new.sheet_mapping_evidence := coalesce(canonical->'sheetMappingEvidence', '[]'::jsonb);
  new.document_structural_identity := case
    when jsonb_typeof(canonical->'documentStructuralIdentity') = 'object'
      then canonical->'documentStructuralIdentity'
    else null end;
  new.sheet_mapping_assurance := coalesce(canonical->'sheetMappingAssurance', '{}'::jsonb);
  new.assurance_result := case when jsonb_typeof(assurance_payload) = 'object'
    then assurance_payload else '{}'::jsonb end;
  return new;
end;
$$;

drop trigger if exists ecos_prepare_hosted_page_sheet_provenance_trigger
  on public.ecos_hosted_document_pages;
create trigger ecos_prepare_hosted_page_sheet_provenance_trigger
before insert or update
on public.ecos_hosted_document_pages
for each row execute function public.ecos_prepare_hosted_page_sheet_provenance();

create or replace function public.ecos_enrich_legacy_chunk_sheet_provenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare page_record public.ecos_document_pages%rowtype;
begin
  select page.* into page_record
  from public.ecos_document_pages page
  where page.owner_id = new.owner_id
    and page.document_id = new.document_id
    and page.page_number = new.page_number;
  if not found then raise exception 'The ECOS chunk page is unavailable'; end if;
  new.sheet_number := page_record.sheet_number;
  new.metadata := (coalesce(new.metadata, '{}'::jsonb) - array[
    'sheetMappingStatus', 'sheetMappingSource', 'sheetMappingEvidence',
    'documentStructuralIdentity', 'sheetMappingAssurance', 'assurance',
    'visualCoverage'
  ]) || jsonb_strip_nulls(jsonb_build_object(
    'sheetMappingStatus', page_record.sheet_mapping_status,
    'sheetMappingSource', page_record.sheet_mapping_source,
    'sheetMappingEvidence', page_record.sheet_mapping_evidence,
    'documentStructuralIdentity', page_record.document_structural_identity,
    'sheetMappingAssurance', page_record.sheet_mapping_assurance,
    'assurance', page_record.assurance_result
  ));
  return new;
end;
$$;

drop trigger if exists ecos_enrich_legacy_chunk_sheet_provenance_trigger
  on public.ecos_document_chunks;
create trigger ecos_enrich_legacy_chunk_sheet_provenance_trigger
before insert or update
on public.ecos_document_chunks
for each row execute function public.ecos_enrich_legacy_chunk_sheet_provenance();

create or replace function public.ecos_enrich_hosted_chunk_sheet_provenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare page_record public.ecos_hosted_document_pages%rowtype;
begin
  select page.* into page_record
  from public.ecos_hosted_document_pages page
  where page.organization_id = new.organization_id
    and page.project_id = new.project_id
    and page.document_id = new.document_id
    and page.page_number = new.page_number;
  if not found then raise exception 'The hosted ECOS chunk page is unavailable'; end if;
  new.sheet_number := page_record.sheet_number;
  new.metadata := (coalesce(new.metadata, '{}'::jsonb) - array[
    'sheetMappingStatus', 'sheetMappingSource', 'sheetMappingEvidence',
    'documentStructuralIdentity', 'sheetMappingAssurance', 'assurance'
  ]) || jsonb_strip_nulls(jsonb_build_object(
    'sheetMappingStatus', page_record.sheet_mapping_status,
    'sheetMappingSource', page_record.sheet_mapping_source,
    'sheetMappingEvidence', page_record.sheet_mapping_evidence,
    'documentStructuralIdentity', page_record.document_structural_identity,
    'sheetMappingAssurance', page_record.sheet_mapping_assurance,
    'assurance', page_record.assurance_result
  ));
  return new;
end;
$$;

drop trigger if exists ecos_enrich_hosted_chunk_sheet_provenance_trigger
  on public.ecos_hosted_document_chunks;
create trigger ecos_enrich_hosted_chunk_sheet_provenance_trigger
before insert or update
on public.ecos_hosted_document_chunks
for each row execute function public.ecos_enrich_hosted_chunk_sheet_provenance();

create or replace function public.ecos_enrich_shadow_chunk_sheet_provenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  page_payload jsonb;
  assurance_payload jsonb;
  canonical jsonb;
begin
  select page.final_page_data, page.assurance_result
  into page_payload, assurance_payload
  from public.ecos_hosted_index_jobs job
  join public.ecos_hosted_index_pages page
    on page.job_id = job.id
   and page.organization_id = job.organization_id
   and page.project_id = job.project_id
   and page.document_id = job.document_id
   and page.source_sha256 = job.source_sha256
  where job.id = new.job_id
    and job.organization_id = new.organization_id
    and job.project_id = new.project_id
    and job.document_id = new.document_id
    and job.source_sha256 = new.source_sha256
    and page.page_number = new.page_number
    and job.mode = 'shadow';
  if not found then raise exception 'The shadow ECOS chunk page is unavailable'; end if;
  canonical := public.ecos_sheet_provenance_payload(page_payload, assurance_payload, true);
  if canonical is null then
    canonical := public.ecos_sheet_provenance_payload(
      page_payload || jsonb_build_object(
        'sheetMappingStatus', 'unverified',
        'sheetMappingSource', null,
        'sheetMappingEvidence', '[]'::jsonb,
        'documentStructuralIdentity', null
      ),
      assurance_payload,
      false
    );
  end if;
  new.sheet_number := nullif(canonical->>'sheetNumber', '');
  new.metadata := (coalesce(new.metadata, '{}'::jsonb) - array[
    'sheetMappingStatus', 'sheetMappingSource', 'sheetMappingEvidence',
    'documentStructuralIdentity', 'sheetMappingAssurance', 'assurance'
  ]) || jsonb_strip_nulls(jsonb_build_object(
    'sheetMappingStatus', canonical->>'sheetMappingStatus',
    'sheetMappingSource', canonical->>'sheetMappingSource',
    'sheetMappingEvidence', canonical->'sheetMappingEvidence',
    'documentStructuralIdentity', canonical->'documentStructuralIdentity',
    'sheetMappingAssurance', canonical->'sheetMappingAssurance',
    'assurance', assurance_payload
  ));
  return new;
end;
$$;

drop trigger if exists ecos_enrich_shadow_chunk_sheet_provenance_trigger
  on public.ecos_hosted_shadow_chunks;
create trigger ecos_enrich_shadow_chunk_sheet_provenance_trigger
before insert or update
on public.ecos_hosted_shadow_chunks
for each row execute function public.ecos_enrich_shadow_chunk_sheet_provenance();

-- Ask ECOS receives bounded hosted page context only through this exact-current
-- boundary. Authenticated clients intentionally have no direct SELECT grant on
-- hosted page tables, so a permission error can never trigger an unsafe table
-- fallback.
create or replace function public.ecos_load_current_hosted_page_context(
  p_project_id text,
  p_document_ids text[],
  p_page_numbers integer[]
)
returns table(
  document_id text,
  page_number integer,
  sheet_number text,
  sheet_title text,
  sheet_mapping_status text,
  sheet_mapping_source text,
  sheet_mapping_evidence jsonb,
  document_structural_identity jsonb,
  page_text text,
  regions jsonb,
  visual_coverage jsonb,
  assurance_result jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '5s'
as $$
declare
  current_user uuid := auth.uid();
  requested_project_id text := nullif(trim(coalesce(p_project_id, '')), '');
  authorized_project_name text;
begin
  if current_user is null or not public.dave_is_app_owner() then
    raise exception 'ECOS hosted page context requires an authorized user'
      using errcode = '42501';
  end if;
  if requested_project_id is null
      or cardinality(coalesce(p_document_ids, array[]::text[])) not between 1 and 24
      or cardinality(coalesce(p_page_numbers, array[]::integer[])) not between 1 and 24
      or exists (
        select 1 from unnest(p_document_ids) requested(document_id)
        where nullif(trim(coalesce(requested.document_id, '')), '') is null
      )
      or exists (
        select 1 from unnest(p_page_numbers) requested(page_number)
        where requested.page_number not between 1 and 10000
      ) then
    raise exception 'The hosted page-context request is invalid'
      using errcode = '22023';
  end if;

  select project_record.name into authorized_project_name
  from public.projects project_record
  where project_record.id::text = requested_project_id
    and project_record.owner_id = current_user
    and project_record.archived = false;
  if not found then
    raise exception 'The requested project is unavailable'
      using errcode = '42501';
  end if;

  return query
  with requested_documents as (
    select distinct trim(requested.document_id) as document_id
    from unnest(p_document_ids) requested(document_id)
  ), requested_pages as (
    select distinct requested.page_number
    from unnest(p_page_numbers) requested(page_number)
  ), live_candidates as (
    select
      page.document_id,
      page.page_number,
      page.sheet_number,
      page.sheet_title,
      page.sheet_mapping_status,
      page.sheet_mapping_source,
      page.sheet_mapping_evidence,
      page.document_structural_identity,
      page.page_text,
      page.regions,
      '{}'::jsonb as visual_coverage,
      page.assurance_result,
      0 as source_priority
    from public.ecos_hosted_document_pages page
    join requested_documents requested_document
      on requested_document.document_id = page.document_id
    join requested_pages requested_page
      on requested_page.page_number = page.page_number
    join public.ecos_hosted_index_jobs job
      on job.organization_id = page.organization_id
     and job.project_id = page.project_id
     and job.document_id = page.document_id
     and job.source_sha256 = page.source_sha256
     and job.mode = 'live'
     and job.state = 'ready'
     and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
     and page.evidence_version = job.committed_evidence_version
    join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = current_user
    join public.organization_memberships membership
      on membership.organization_id = job.organization_id
     and membership.user_id = current_user
     and membership.status = 'active'
    where page.assurance_result->>'accepted' = 'true'
      and lower(trim(job.project_id)) in (
        lower(requested_project_id), lower(trim(authorized_project_name))
      )
      and source.document_data->>'isCurrent' = 'true'
      and source.document_data->>'drawingStatus' is distinct from 'Superseded'
      and public.ecos_hosted_job_matches_reference(job.id, true)
  ), shadow_candidates as (
    select
      page.document_id,
      page.page_number,
      nullif(provenance.value->>'sheetNumber', '') as sheet_number,
      coalesce(
        nullif(page.final_page_data->>'sheetTitle', ''),
        nullif(page.final_page_data->>'title', '')
      ) as sheet_title,
      coalesce(nullif(provenance.value->>'sheetMappingStatus', ''), 'unverified') as sheet_mapping_status,
      nullif(provenance.value->>'sheetMappingSource', '') as sheet_mapping_source,
      coalesce(provenance.value->'sheetMappingEvidence', '[]'::jsonb) as sheet_mapping_evidence,
      case when jsonb_typeof(provenance.value->'documentStructuralIdentity') = 'object'
        then provenance.value->'documentStructuralIdentity' else null end as document_structural_identity,
      coalesce(
        nullif(page.final_page_data->>'text', ''),
        nullif(page.final_page_data->>'pageText', '')
      ) as page_text,
      case when jsonb_typeof(page.final_page_data->'regions') = 'array'
        then page.final_page_data->'regions' else '[]'::jsonb end as regions,
      case when jsonb_typeof(page.final_page_data->'visualCoverage') = 'object'
        then page.final_page_data->'visualCoverage' else '{}'::jsonb end as visual_coverage,
      page.assurance_result,
      1 as source_priority
    from public.ecos_hosted_index_jobs job
    join requested_documents requested_document
      on requested_document.document_id = job.document_id
    join public.ecos_hosted_index_pages page
      on page.job_id = job.id
     and page.organization_id = job.organization_id
     and page.project_id = job.project_id
     and page.document_id = job.document_id
     and page.source_sha256 = job.source_sha256
     and page.state = 'assured'
     and page.unresolved_region_count = 0
     and page.assurance_result->>'accepted' = 'true'
    join requested_pages requested_page
      on requested_page.page_number = page.page_number
    join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = current_user
    join public.organization_memberships membership
      on membership.organization_id = job.organization_id
     and membership.user_id = current_user
     and membership.status = 'active'
    join public.ecos_hosted_index_configuration configuration
      on configuration.organization_id = job.organization_id
     and configuration.enabled = true
     and configuration.publication_mode = 'live'
    cross join lateral (
      select public.ecos_sheet_provenance_payload(
        page.final_page_data,
        page.assurance_result,
        true
      ) as value
    ) provenance
    where job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and lower(trim(job.project_id)) in (
        lower(requested_project_id), lower(trim(authorized_project_name))
      )
      and source.document_data->>'isCurrent' = 'true'
      and source.document_data->>'drawingStatus' is distinct from 'Superseded'
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and provenance.value is not null
  ), ranked as (
    select candidate.*,
      row_number() over (
        partition by candidate.document_id, candidate.page_number
        order by candidate.source_priority
      ) as source_rank
    from (
      select * from live_candidates
      union all
      select * from shadow_candidates
    ) candidate
  )
  select
    ranked.document_id,
    ranked.page_number,
    ranked.sheet_number,
    ranked.sheet_title,
    ranked.sheet_mapping_status,
    ranked.sheet_mapping_source,
    ranked.sheet_mapping_evidence,
    ranked.document_structural_identity,
    ranked.page_text,
    ranked.regions,
    ranked.visual_coverage,
    ranked.assurance_result
  from ranked
  where ranked.source_rank = 1
  order by ranked.document_id, ranked.page_number
  limit 200;
end;
$$;

revoke all on function public.ecos_load_current_hosted_page_context(text, text[], integer[])
  from public, anon;
grant execute on function public.ecos_load_current_hosted_page_context(text, text[], integer[])
  to authenticated, service_role;

-- Retain the proven replacement behavior for browser text/page indexing. The
-- legacy page trigger above deliberately strips client-supplied exact sheet,
-- visual-coverage, and Assurance attestations.
alter function public.ecos_replace_document_index(text, text, text, jsonb)
  rename to ecos_replace_document_index_without_sheet_provenance;

revoke all on function public.ecos_replace_document_index_without_sheet_provenance(text, text, text, jsonb)
  from public, anon, authenticated;

create or replace function public.ecos_replace_document_index(
  p_document_id text,
  p_source_sha256 text,
  p_extraction_method text,
  p_pages jsonb
)
returns table(indexed_pages integer, indexed_chunks integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_owner uuid := auth.uid();
  replacement record;
begin
  if current_owner is null or not public.dave_is_app_owner() then
    raise exception 'ECOS document indexing requires the authorized app owner';
  end if;
  if jsonb_typeof(coalesce(p_pages, '[]'::jsonb)) <> 'array' then
    raise exception 'ECOS pages must be a JSON array';
  end if;

  select * into replacement
  from public.ecos_replace_document_index_without_sheet_provenance(
    p_document_id,
    p_source_sha256,
    p_extraction_method,
    p_pages
  );

  return query select replacement.indexed_pages::integer, replacement.indexed_chunks::integer;
end;
$$;

revoke all on function public.ecos_replace_document_index(text, text, text, jsonb)
  from public, anon;
grant execute on function public.ecos_replace_document_index(text, text, text, jsonb)
  to authenticated;

-- Existing rows can only regain an exact sheet when an exact current
-- checkpoint supplies its proof. Rows without reconstructable proof are
-- deliberately downgraded while their PDF-page text remains searchable.
update public.ecos_document_pages set
  sheet_mapping_source = sheet_mapping_source,
  assurance_result = assurance_result;
update public.ecos_hosted_document_pages set
  sheet_mapping_source = sheet_mapping_source,
  assurance_result = assurance_result;
update public.ecos_document_chunks set metadata = metadata;
update public.ecos_hosted_document_chunks set metadata = metadata;
update public.ecos_hosted_shadow_chunks set metadata = metadata;

commit;
