-- Run after the base sheet-provenance migrations and the page-bound migration
-- in a disposable PostgreSQL database. This file does not modify live data.
begin;
do $$
declare
  base_id text := 'sheet-identity-page-bound-validated-44';
  identity_id text := base_id || ':refresh:00000000-0000-0000-0000-000000000001';
  bounds jsonb := '{"x":0.927429,"y":0.95609,"width":0.048956,"height":0.012723}';
  candidate jsonb := '{"id":"sheet-identity-page-bound-word-40","text":"A-2.11","source":"sheet_identity_ocr_page_bound_raw","x":0.927429,"y":0.95609,"width":0.048956,"height":0.012723}';
  label jsonb := '{"id":"sheet-identity-page-bound-word-36","text":"SHEETNUMBER","source":"sheet_identity_ocr_page_bound_raw","x":0.887603,"y":0.951233,"width":0.029126,"height":0.003701}';
  footer jsonb := '{"id":"sheet-identity-page-bound-word-48","text":"SHEETS","source":"sheet_identity_ocr_page_bound_raw","x":0.965148,"y":0.974365,"width":0.011361,"height":0.005667}';
  region jsonb;
  page_data jsonb;
  assurance jsonb := '{"accepted":true,"checks":{"sheetMappingUsable":true}}';
  result jsonb;
  changed jsonb;
  legacy jsonb;
begin
  region := jsonb_build_object(
    'id', identity_id, 'preparedRegionId', base_id,
    'source', 'sheet_identity_ocr_page_bound_validated',
    'ocrValidationStatus', 'structural_title_cell', 'searchable', true,
    'text', 'A-2.11', 'x', bounds->'x', 'y', bounds->'y',
    'width', bounds->'width', 'height', bounds->'height',
    'sheetIdentityEvidence', jsonb_build_object(
      'candidateRegion', candidate, 'labelRegion', label, 'footerRegion', footer
    )
  );
  page_data := jsonb_build_object(
    'pageNumber', 44, 'sheetNumber', 'A-2.11',
    'sheetMappingStatus', 'verified',
    'sheetMappingSource', 'rendered_page_bound_title_cell',
    'sheetMappingEvidence', jsonb_build_array(jsonb_build_object(
      'id', identity_id, 'pageNumber', 44,
      'source', 'sheet_identity_ocr_page_bound_validated',
      'text', 'A-2.11', 'normalizedBounds', bounds
    )),
    'regions', jsonb_build_array(region)
  );

  result := public.ecos_sheet_provenance_payload(page_data, assurance, true);
  if result->>'sheetNumber' is distinct from 'A-2.11'
      or result->>'sheetMappingStatus' is distinct from 'verified'
      or result->>'sheetMappingSource' is distinct from 'rendered_page_bound_title_cell' then
    raise exception 'valid page-bound proof was lost: %', result;
  end if;

  changed := jsonb_set(page_data, '{sheetMappingEvidence,0,pageNumber}', '45'::jsonb);
  if public.ecos_sheet_provenance_payload(changed, assurance, true) is not null then
    raise exception 'cross-page evidence accepted';
  end if;
  changed := jsonb_set(page_data, '{regions,0,id}', '"sheet-identity-page-bound-validated-45"'::jsonb);
  if public.ecos_sheet_provenance_payload(changed, assurance, true) is not null then
    raise exception 'copied region accepted';
  end if;
  changed := jsonb_set(page_data, '{regions,0,sheetIdentityEvidence,labelRegion,text}', '"REVISION"'::jsonb);
  if public.ecos_sheet_provenance_payload(changed, assurance, true) is not null then
    raise exception 'unrelated label accepted';
  end if;
  changed := jsonb_set(page_data, '{regions,0,sheetIdentityEvidence,candidateRegion,x}', '0.930000'::jsonb);
  if public.ecos_sheet_provenance_payload(changed, assurance, true) is not null then
    raise exception 'candidate geometry mismatch accepted';
  end if;
  changed := jsonb_set(page_data, '{regions,0,preparedRegionId}', '"sheet-identity-page-bound-validated-45"'::jsonb);
  if public.ecos_sheet_provenance_payload(changed, assurance, true) is not null then
    raise exception 'wrong refresh linkage accepted';
  end if;
  changed := page_data || jsonb_build_object(
    'documentStructuralIdentity', jsonb_build_object('sheetNumber', 'A-2.12')
  );
  if public.ecos_sheet_provenance_payload(changed, assurance, true) is not null then
    raise exception 'conflicting structural identity accepted';
  end if;
  changed := jsonb_set(page_data, '{regions,0,searchable}', 'false'::jsonb);
  if public.ecos_sheet_provenance_payload(changed, assurance, true) is not null then
    raise exception 'nonsearchable region accepted';
  end if;
  changed := jsonb_set(page_data, '{regions}', jsonb_build_array(region, region));
  if public.ecos_sheet_provenance_payload(changed, assurance, true) is not null then
    raise exception 'duplicate identity region accepted';
  end if;
  changed := jsonb_set(page_data, '{sheetMappingEvidence}', '{}'::jsonb);
  if public.ecos_sheet_provenance_payload(changed, assurance, true) is not null then
    raise exception 'malformed evidence accepted';
  end if;
  changed := jsonb_set(page_data, '{regions}', '{}'::jsonb);
  if public.ecos_sheet_provenance_payload(changed, assurance, true) is not null then
    raise exception 'malformed regions accepted';
  end if;
  changed := jsonb_set(page_data, '{sheetMappingEvidence,0,normalizedBounds,x}', '"bad"'::jsonb);
  if public.ecos_sheet_provenance_payload(changed, assurance, true) is not null then
    raise exception 'malformed bounds accepted';
  end if;
  if public.ecos_sheet_provenance_payload(page_data, '{"accepted":false,"checks":{"sheetMappingUsable":true}}', true) is not null then
    raise exception 'rejected Assurance accepted';
  end if;
  if public.ecos_sheet_provenance_payload(page_data, '{"accepted":true,"checks":{"sheetMappingUsable":false}}', true) is not null then
    raise exception 'unusable sheet Assurance accepted';
  end if;
  if public.ecos_sheet_provenance_payload(page_data, '{"accepted":"true","checks":{"sheetMappingUsable":"true"}}', true) is not null then
    raise exception 'untyped Assurance accepted';
  end if;

  legacy := page_data || jsonb_build_object(
    'sheetMappingStatus', 'unverified',
    'sheetMappingSource', 'coordinate_text', 'sheetNumber', null
  );
  if public.ecos_sheet_provenance_payload(legacy, assurance, true)
      is distinct from public.ecos_sheet_provenance_payload_pre_page_bound(legacy, assurance, true) then
    raise exception 'pre-existing unverified behavior changed';
  end if;
  legacy := jsonb_build_object(
    'pageNumber', 44, 'sheetNumber', 'A-2.11',
    'sheetMappingStatus', 'verified', 'sheetMappingSource', 'native_title_band',
    'sheetMappingEvidence', jsonb_build_array(jsonb_build_object(
      'id', 'native-44', 'pageNumber', 44, 'source', 'embedded_text',
      'text', 'A-2.11', 'normalizedBounds', bounds
    )),
    'regions', jsonb_build_array(jsonb_build_object(
      'id', 'native-44', 'source', 'embedded_text', 'text', 'A-2.11',
      'x', bounds->'x', 'y', bounds->'y',
      'width', bounds->'width', 'height', bounds->'height'
    ))
  );
  if public.ecos_sheet_provenance_payload_pre_page_bound(legacy, assurance, true) is null
      or public.ecos_sheet_provenance_payload(legacy, assurance, true)
      is distinct from public.ecos_sheet_provenance_payload_pre_page_bound(legacy, assurance, true) then
    raise exception 'pre-existing verified native behavior changed';
  end if;
end;
$$;

insert into public.ecos_document_pages (sheet_mapping_source)
values ('rendered_page_bound_title_cell');
insert into public.ecos_hosted_document_pages (sheet_mapping_source)
values ('rendered_page_bound_title_cell');

do $$
begin
  if has_function_privilege('anon', 'public.ecos_sheet_provenance_payload(jsonb,jsonb,boolean)', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.ecos_sheet_provenance_payload(jsonb,jsonb,boolean)', 'EXECUTE')
      or not has_function_privilege('service_role', 'public.ecos_sheet_provenance_payload(jsonb,jsonb,boolean)', 'EXECUTE') then
    raise exception 'page-bound helper grant boundary changed';
  end if;
end;
$$;

rollback;
