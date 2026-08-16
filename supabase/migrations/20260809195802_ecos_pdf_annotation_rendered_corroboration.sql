-- PDF annotation metadata is not visible page content. Keep the narrow
-- annotation title-band source only when the trusted worker also records the
-- exact rendered OCR regions that independently corroborated every identity
-- token. Authenticated clients cannot execute this canonicalizer or use its
-- boolean as a self-attestation.

begin;

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
  assurance_data jsonb := case when jsonb_typeof(p_assurance) = 'object'
    then p_assurance else '{}'::jsonb end;
  mapping_status text := coalesce(nullif(trim(page_data->>'sheetMappingStatus'), ''), 'unverified');
  mapping_source text := nullif(trim(page_data->>'sheetMappingSource'), '');
  sheet_number text := nullif(left(trim(page_data->>'sheetNumber'), 160), '');
  page_number integer;
  evidence_item jsonb;
  evidence_id text;
  evidence_text text;
  evidence_page integer;
  evidence_source text;
  annotation_subtype text;
  evidence_bounds jsonb;
  rendered_value jsonb;
  rendered_text text;
  rendered_region_ids jsonb;
  rendered_sources jsonb;
  canonical_rendered_region_ids jsonb;
  canonical_rendered_sources jsonb;
  seen_rendered_region_ids text[];
  seen_rendered_sources text[];
  canonical_evidence jsonb := '[]'::jsonb;
  canonical_identity jsonb;
  canonical_assurance jsonb;
  unverified_payload jsonb;
  seen_ids text[] := array[]::text[];
  token_count integer := 0;
  label_count integer := 0;
  token_bounds jsonb;
  label_bounds jsonb;
begin
  if mapping_source is distinct from 'pdf_annotation_title_band'
      or mapping_status <> 'verified' then
    return public.ecos_sheet_provenance_payload_without_annotation_title_band(
      page_data,
      assurance_data,
      p_require_assurance
    );
  end if;

  if coalesce(page_data->>'pageNumber', '') !~ '^[1-9][0-9]*$' then return null; end if;
  page_number := (page_data->>'pageNumber')::integer;
  if page_number > 10000
      or sheet_number is null
      or sheet_number !~ '^C[1-9][0-9]{0,2}$' then return null; end if;
  if jsonb_typeof(page_data->'sheetMappingEvidence') <> 'array'
      or jsonb_array_length(page_data->'sheetMappingEvidence') <> 2 then return null; end if;

  for evidence_item in
    select item.value
    from jsonb_array_elements(page_data->'sheetMappingEvidence')
      with ordinality item(value, ordinality)
    order by item.ordinality
  loop
    if jsonb_typeof(evidence_item) <> 'object' then return null; end if;
    evidence_id := nullif(left(trim(evidence_item->>'id'), 300), '');
    evidence_text := nullif(left(regexp_replace(
      trim(evidence_item->>'text'), '[[:space:]]+', ' ', 'g'
    ), 1000), '');
    evidence_source := nullif(trim(evidence_item->>'source'), '');
    annotation_subtype := nullif(trim(evidence_item->>'annotationSubtype'), '');
    if coalesce(evidence_item->>'pageNumber', '') !~ '^[1-9][0-9]*$' then return null; end if;
    evidence_page := (evidence_item->>'pageNumber')::integer;
    evidence_bounds := evidence_item->'normalizedBounds';
    if evidence_id is null
        or evidence_text is null
        or evidence_page <> page_number
        or evidence_source <> 'pdf_annotation'
        or annotation_subtype <> 'Square'
        or evidence_id = any(seen_ids)
        or evidence_id !~ ('^pdf-annotation-[0-9]+-page-' || page_number::text || '$')
        or jsonb_typeof(evidence_bounds) <> 'object'
        or jsonb_typeof(evidence_bounds->'x') <> 'number'
        or jsonb_typeof(evidence_bounds->'y') <> 'number'
        or jsonb_typeof(evidence_bounds->'width') <> 'number'
        or jsonb_typeof(evidence_bounds->'height') <> 'number'
        or (evidence_bounds->>'x')::numeric not between 0 and 1
        or (evidence_bounds->>'y')::numeric not between 0 and 1
        or (evidence_bounds->>'width')::numeric <= 0
        or (evidence_bounds->>'height')::numeric <= 0
        or (evidence_bounds->>'x')::numeric + (evidence_bounds->>'width')::numeric > 1.001
        or (evidence_bounds->>'y')::numeric + (evidence_bounds->>'height')::numeric > 1.001
        or evidence_item->'renderedCorroborated' is distinct from 'true'::jsonb then
      return null;
    end if;
    seen_ids := array_append(seen_ids, evidence_id);

    rendered_region_ids := evidence_item->'renderedCorroboratingRegionIds';
    rendered_sources := evidence_item->'renderedCorroboratingSources';
    if jsonb_typeof(rendered_region_ids) <> 'array'
        or jsonb_array_length(rendered_region_ids) not between 1 and 8
        or jsonb_typeof(rendered_sources) <> 'array'
        or jsonb_array_length(rendered_sources) not between 1 and 8 then
      return null;
    end if;
    canonical_rendered_region_ids := '[]'::jsonb;
    canonical_rendered_sources := '[]'::jsonb;
    seen_rendered_region_ids := array[]::text[];
    seen_rendered_sources := array[]::text[];

    for rendered_value in select value from jsonb_array_elements(rendered_region_ids)
    loop
      if jsonb_typeof(rendered_value) <> 'string' then return null; end if;
      rendered_text := nullif(trim(rendered_value#>>'{}'), '');
      if rendered_text is null
          or length(rendered_text) > 300
          or rendered_text = any(seen_rendered_region_ids) then return null; end if;
      seen_rendered_region_ids := array_append(seen_rendered_region_ids, rendered_text);
      canonical_rendered_region_ids := canonical_rendered_region_ids || jsonb_build_array(rendered_text);
    end loop;

    for rendered_value in select value from jsonb_array_elements(rendered_sources)
    loop
      if jsonb_typeof(rendered_value) <> 'string' then return null; end if;
      rendered_text := nullif(trim(rendered_value#>>'{}'), '');
      if rendered_text is null
          or length(rendered_text) > 80
          or rendered_text = any(seen_rendered_sources)
          or rendered_text not in (
            'fixed_visual_tile_coordinate_ocr',
            'sheet_identity_ocr_landscape_native',
            'sheet_identity_ocr_page_bound_validated',
            'sheet_identity_ocr_vertical_outline',
            'title_block_ocr'
          ) then return null; end if;
      seen_rendered_sources := array_append(seen_rendered_sources, rendered_text);
      canonical_rendered_sources := canonical_rendered_sources || jsonb_build_array(rendered_text);
    end loop;

    if regexp_replace(upper(evidence_text), '[[:space:]–—-]+', '', 'g') = sheet_number then
      token_count := token_count + 1;
      token_bounds := evidence_bounds;
      if (evidence_bounds->>'x')::numeric < 0.948
          or (evidence_bounds->>'y')::numeric < 0.904
          or (evidence_bounds->>'x')::numeric + (evidence_bounds->>'width')::numeric > 0.972
          or (evidence_bounds->>'y')::numeric + (evidence_bounds->>'height')::numeric > 0.925 then
        return null;
      end if;
    elsif upper(evidence_text) = 'SHEET NO.' then
      label_count := label_count + 1;
      label_bounds := evidence_bounds;
      if (evidence_bounds->>'x')::numeric < 0.94
          or (evidence_bounds->>'y')::numeric < 0.888
          or (evidence_bounds->>'x')::numeric + (evidence_bounds->>'width')::numeric > 0.98
          or (evidence_bounds->>'y')::numeric + (evidence_bounds->>'height')::numeric > 0.907 then
        return null;
      end if;
    else
      return null;
    end if;

    canonical_evidence := canonical_evidence || jsonb_build_array(jsonb_build_object(
      'id', evidence_id,
      'pageNumber', evidence_page,
      'source', evidence_source,
      'annotationSubtype', annotation_subtype,
      'text', evidence_text,
      'normalizedBounds', evidence_bounds,
      'renderedCorroborated', true,
      'renderedCorroboratingRegionIds', canonical_rendered_region_ids,
      'renderedCorroboratingSources', canonical_rendered_sources
    ));
  end loop;

  if token_count <> 1 or label_count <> 1 or token_bounds is null or label_bounds is null then
    return null;
  end if;
  if abs(
      ((token_bounds->>'x')::numeric + (token_bounds->>'width')::numeric / 2)
      - ((label_bounds->>'x')::numeric + (label_bounds->>'width')::numeric / 2)
    ) > 0.02
    or (
      (token_bounds->>'y')::numeric
      - ((label_bounds->>'y')::numeric + (label_bounds->>'height')::numeric)
    ) not between 0 and 0.025 then return null; end if;

  canonical_identity := jsonb_build_object(
    'sheetNumber', sheet_number,
    'source', mapping_source,
    'evidence', canonical_evidence
  );
  if jsonb_typeof(page_data->'documentStructuralIdentity') = 'object'
      and page_data->'documentStructuralIdentity' <> '{}'::jsonb
      and page_data->'documentStructuralIdentity' <> canonical_identity then return null; end if;
  if p_require_assurance and (
    assurance_data->>'accepted' is distinct from 'true'
    or assurance_data#>>'{checks,sheetMappingUsable}' is distinct from 'true'
  ) then return null; end if;

  unverified_payload := public.ecos_sheet_provenance_payload_without_annotation_title_band(
    page_data || jsonb_build_object(
      'sheetMappingStatus', 'unverified',
      'sheetMappingSource', null,
      'sheetNumber', null
    ),
    assurance_data,
    false
  );
  canonical_assurance := unverified_payload->'sheetMappingAssurance';
  if canonical_assurance is null then return null; end if;

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

commit;
