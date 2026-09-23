-- Permit only a replayable, page-bound rendered title-cell identity to retain
-- verified sheet provenance. Other sources continue through the existing
-- bookmark/native/PDF-annotation validator unchanged.
begin;

alter table public.ecos_document_pages
  drop constraint ecos_document_pages_sheet_mapping_source_check;
alter table public.ecos_document_pages
  add constraint ecos_document_pages_sheet_mapping_source_check
  check (sheet_mapping_source is null or sheet_mapping_source in (
    'pdf_bookmark', 'native_title_band', 'pdf_annotation_title_band',
    'rendered_page_bound_title_cell', 'coordinate_text'
  ));

alter table public.ecos_hosted_document_pages
  drop constraint ecos_hosted_document_pages_sheet_mapping_source_check;
alter table public.ecos_hosted_document_pages
  add constraint ecos_hosted_document_pages_sheet_mapping_source_check
  check (sheet_mapping_source is null or sheet_mapping_source in (
    'pdf_bookmark', 'native_title_band', 'pdf_annotation_title_band',
    'rendered_page_bound_title_cell', 'coordinate_text'
  ));

alter function public.ecos_sheet_provenance_payload(jsonb, jsonb, boolean)
  rename to ecos_sheet_provenance_payload_pre_page_bound;
revoke all on function public.ecos_sheet_provenance_payload_pre_page_bound(
  jsonb, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.ecos_sheet_provenance_payload_pre_page_bound(
  jsonb, jsonb, boolean
) to service_role;

create function public.ecos_sheet_provenance_payload(
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
  assurance_data jsonb := case when jsonb_typeof(p_assurance) = 'object'
    then p_assurance else '{}'::jsonb end;
  page_number integer;
  sheet_number text := nullif(trim(page_data->>'sheetNumber'), '');
  evidence jsonb;
  evidence_bounds jsonb;
  region jsonb;
  matching_regions jsonb;
  region_count integer;
  proof jsonb;
  candidate jsonb;
  label jsonb;
  footer jsonb;
  part jsonb;
  part_name text;
  part_id text;
  seen_ids text[] := array[]::text[];
  field_name text;
  base_id text;
  evidence_id text;
  canonical_evidence jsonb;
  canonical_identity jsonb;
  unverified_payload jsonb;
begin
  if page_data->>'sheetMappingSource' is distinct from 'rendered_page_bound_title_cell'
      or page_data->>'sheetMappingStatus' is distinct from 'verified' then
    return public.ecos_sheet_provenance_payload_pre_page_bound(
      page_data, assurance_data, p_require_assurance
    );
  end if;

  if coalesce(page_data->>'pageNumber', '') !~ '^[1-9][0-9]{0,4}$' then
    return null;
  end if;
  page_number := (page_data->>'pageNumber')::integer;
  if page_number > 10000
      or sheet_number is null
      or sheet_number !~ '^A-[1-9][0-9]?([.][0-9]{1,2})?[A-Z]?$'
      or jsonb_typeof(page_data->'sheetMappingEvidence') is distinct from 'array'
      or jsonb_typeof(page_data->'regions') is distinct from 'array' then
    return null;
  end if;
  if jsonb_array_length(page_data->'sheetMappingEvidence') <> 1 then return null; end if;
  evidence := page_data->'sheetMappingEvidence'->0;
  evidence_bounds := evidence->'normalizedBounds';
  base_id := 'sheet-identity-page-bound-validated-' || page_number::text;
  evidence_id := evidence->>'id';
  if jsonb_typeof(evidence) is distinct from 'object'
      or evidence->>'source' is distinct from 'sheet_identity_ocr_page_bound_validated'
      or evidence->>'text' is distinct from sheet_number
      or evidence->>'pageNumber' is distinct from page_number::text
      or (evidence_id is distinct from base_id and evidence_id !~ (
        '^' || base_id || ':refresh:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )) then
    return null;
  end if;

  select count(*)::integer, jsonb_agg(r.value)
  into region_count, matching_regions
  from jsonb_array_elements(page_data->'regions') r(value)
  where r.value->>'id' = evidence_id;
  region := matching_regions->0;
  if region_count <> 1
      or region->>'source' is distinct from 'sheet_identity_ocr_page_bound_validated'
      or region->>'ocrValidationStatus' is distinct from 'structural_title_cell'
      or region->'searchable' is distinct from 'true'::jsonb
      or region->>'text' is distinct from sheet_number
      or (evidence_id = base_id and region ? 'preparedRegionId')
      or (evidence_id <> base_id and region->>'preparedRegionId' is distinct from base_id) then
    return null;
  end if;

  proof := region->'sheetIdentityEvidence';
  if jsonb_typeof(proof) is distinct from 'object'
      or proof <> jsonb_build_object(
        'candidateRegion', proof->'candidateRegion',
        'labelRegion', proof->'labelRegion',
        'footerRegion', proof->'footerRegion'
      ) then
    return null;
  end if;
  candidate := proof->'candidateRegion';
  label := proof->'labelRegion';
  footer := proof->'footerRegion';

  -- Every persisted point used for the title-cell proof must remain a finite,
  -- normalized box; PostgreSQL JSON numbers are finite numeric values.
  foreach part in array array[evidence_bounds, region, candidate, label, footer]
  loop
    if jsonb_typeof(part) is distinct from 'object' then return null; end if;
    foreach field_name in array array['x', 'y', 'width', 'height']
    loop
      if jsonb_typeof(part->field_name) is distinct from 'number' then return null; end if;
    end loop;
    if (part->>'x')::numeric not between 0 and 1
        or (part->>'y')::numeric not between 0 and 1
        or (part->>'width')::numeric <= 0
        or (part->>'height')::numeric <= 0
        or (part->>'x')::numeric + (part->>'width')::numeric > 1.001
        or (part->>'y')::numeric + (part->>'height')::numeric > 1.001 then
      return null;
    end if;
  end loop;

  foreach field_name in array array['x', 'y', 'width', 'height']
  loop
    if abs((region->>field_name)::numeric - (evidence_bounds->>field_name)::numeric) > 0.000005
        or abs((candidate->>field_name)::numeric - (region->>field_name)::numeric) > 0.000005 then
      return null;
    end if;
  end loop;
  if (region->>'x')::numeric not between 0.925 and 0.997
      or (region->>'y')::numeric not between 0.945 and 0.985
      or candidate->>'text' is distinct from sheet_number then
    return null;
  end if;

  foreach part_name in array array['candidateRegion', 'labelRegion', 'footerRegion']
  loop
    part := proof->part_name;
    part_id := part->>'id';
    if part->>'source' is distinct from 'sheet_identity_ocr_page_bound_raw'
        or coalesce(part_id, '') !~ '^sheet-identity-page-bound-word-[0-9]+$'
        or part_id = any(seen_ids) then
      return null;
    end if;
    seen_ids := array_append(seen_ids, part_id);
  end loop;
  if regexp_replace(upper(coalesce(label->>'text', '')), '[^A-Z0-9]', '', 'g')
      not in ('SHEETNO', 'SHEETNUMBER', 'SHEETNUM')
      or regexp_replace(upper(coalesce(footer->>'text', '')), '[^A-Z0-9]', '', 'g')
      not in ('SHEET', 'SHEETS')
      or (label->>'x')::numeric not between 0.885 and (region->>'x')::numeric
      or (label->>'x')::numeric >= (region->>'x')::numeric
      or (region->>'y')::numeric - (label->>'y')::numeric not between -0.015 and 0.035
      or (footer->>'y')::numeric < (region->>'y')::numeric
      or (footer->>'y')::numeric > (region->>'y')::numeric + 0.035
      or (footer->>'y')::numeric > 0.999 then
    return null;
  end if;

  canonical_evidence := jsonb_build_array(jsonb_build_object(
    'id', evidence_id,
    'pageNumber', page_number,
    'source', 'sheet_identity_ocr_page_bound_validated',
    'text', sheet_number,
    'normalizedBounds', evidence_bounds
  ));
  canonical_identity := jsonb_build_object(
    'sheetNumber', sheet_number,
    'source', 'rendered_page_bound_title_cell',
    'evidence', canonical_evidence
  );
  if jsonb_typeof(page_data->'documentStructuralIdentity') = 'object'
      and page_data->'documentStructuralIdentity' <> '{}'::jsonb
      and page_data->'documentStructuralIdentity' <> canonical_identity then
    return null;
  end if;
  if p_require_assurance and (
    assurance_data->'accepted' is distinct from 'true'::jsonb
    or assurance_data#>'{checks,sheetMappingUsable}' is distinct from 'true'::jsonb
  ) then
    return null;
  end if;

  -- Preserve the previous helper's Assurance canonicalization exactly.
  unverified_payload := public.ecos_sheet_provenance_payload_pre_page_bound(
    page_data || jsonb_build_object(
      'sheetMappingStatus', 'unverified',
      'sheetMappingSource', null,
      'sheetNumber', null
    ),
    assurance_data,
    false
  );
  if unverified_payload->'sheetMappingAssurance' is null then return null; end if;
  return jsonb_build_object(
    'sheetNumber', sheet_number,
    'sheetMappingStatus', 'verified',
    'sheetMappingSource', 'rendered_page_bound_title_cell',
    'sheetMappingEvidence', canonical_evidence,
    'documentStructuralIdentity', canonical_identity,
    'sheetMappingAssurance', unverified_payload->'sheetMappingAssurance'
  );
end;
$$;

revoke all on function public.ecos_sheet_provenance_payload(jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.ecos_sheet_provenance_payload(jsonb, jsonb, boolean)
  to service_role;

commit;
