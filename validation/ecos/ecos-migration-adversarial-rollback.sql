-- Adversarial transactional acceptance for the two ECOS publication migrations.
--
-- This file is appended after migration bodies with their outer BEGIN/COMMIT
-- removed, then the entire combined script is wrapped in one transaction and
-- rolled back. Every fixture identifier is unique to this test transaction.

do $ecos_annotation_canonical$
declare
  annotation_evidence jsonb := jsonb_build_array(
    jsonb_build_object(
      'id', 'pdf-annotation-1-page-1',
      'pageNumber', 1,
      'source', 'pdf_annotation',
      'annotationSubtype', 'Square',
      'text', 'C6',
      'normalizedBounds', jsonb_build_object(
        'x', 0.950, 'y', 0.910, 'width', 0.010, 'height', 0.010
      )
    ),
    jsonb_build_object(
      'id', 'pdf-annotation-2-page-1',
      'pageNumber', 1,
      'source', 'pdf_annotation',
      'annotationSubtype', 'Square',
      'text', 'SHEET NO.',
      'normalizedBounds', jsonb_build_object(
        'x', 0.949, 'y', 0.895, 'width', 0.012, 'height', 0.010
      )
    )
  );
  annotation_page jsonb;
  annotation_assurance jsonb := jsonb_build_object(
    'accepted', true,
    'method', 'independent_assurance',
    'schemaVersion', '1.0',
    'evidenceVersion', 'ecos-hosted-evidence/1.3',
    'checks', jsonb_build_object('sheetMappingUsable', true),
    'failureCodes', '[]'::jsonb
  );
  canonical jsonb;
begin
  annotation_page := jsonb_build_object(
    'pageNumber', 1,
    'sheetNumber', 'C6',
    'sheetMappingStatus', 'verified',
    'sheetMappingSource', 'pdf_annotation_title_band',
    'sheetMappingEvidence', annotation_evidence,
    'documentStructuralIdentity', jsonb_build_object(
      'sheetNumber', 'C6',
      'source', 'pdf_annotation_title_band',
      'evidence', annotation_evidence
    ),
    'regions', '[]'::jsonb
  );

  canonical := public.ecos_sheet_provenance_payload(
    annotation_page,
    annotation_assurance,
    true
  );
  if canonical->>'sheetNumber' is distinct from 'C6'
      or canonical->>'sheetMappingSource'
        is distinct from 'pdf_annotation_title_band'
      or jsonb_array_length(canonical->'sheetMappingEvidence') <> 2
      or canonical#>>'{sheetMappingEvidence,0,annotationSubtype}'
        is distinct from 'Square'
      or canonical#>>'{documentStructuralIdentity,source}'
        is distinct from 'pdf_annotation_title_band' then
    raise exception
      'ECOS_TEST_FAIL: exact PDF-annotation title-band proof was not canonicalized';
  end if;

  if public.ecos_sheet_provenance_payload(
      jsonb_set(
        annotation_page,
        '{sheetMappingEvidence,0,annotationSubtype}',
        '"FreeText"'::jsonb
      ),
      annotation_assurance,
      true
    ) is not null
      or public.ecos_sheet_provenance_payload(
        jsonb_set(
          annotation_page,
          '{sheetMappingEvidence,0,id}',
          '"fabricated-proof-id"'::jsonb
        ),
        annotation_assurance,
        true
      ) is not null
      or public.ecos_sheet_provenance_payload(
        jsonb_set(
          annotation_page,
          '{sheetMappingEvidence,0,normalizedBounds,x}',
          '0.80'::jsonb
        ),
        annotation_assurance,
        true
      ) is not null
      or public.ecos_sheet_provenance_payload(
        jsonb_set(
          annotation_page,
          '{sheetMappingEvidence}',
          jsonb_build_array(annotation_evidence->0)
        ),
        annotation_assurance,
        true
      ) is not null
      or public.ecos_sheet_provenance_payload(
        annotation_page || jsonb_build_object(
          'sheetMappingSource', 'filename'
        ),
        annotation_assurance,
        true
      ) is not null
      or public.ecos_sheet_provenance_payload(
        annotation_page,
        annotation_assurance || jsonb_build_object('accepted', false),
        true
      ) is not null then
    raise exception
      'ECOS_TEST_FAIL: forged or incomplete PDF-annotation title-band proof was accepted';
  end if;
end;
$ecos_annotation_canonical$;

do $ecos_fixture$
declare
  fixture_owner uuid;
  fixture_project_viewer uuid := gen_random_uuid();
  fixture_org text;
  fixture_project uuid := gen_random_uuid();
  fixture_project_name text := '__ECOS migration adversarial ' || gen_random_uuid()::text;
  fixture_family text := '__ecos-migration-family-' || gen_random_uuid()::text;
  old_document_id text := '__ecos-old-' || gen_random_uuid()::text;
  target_document_id text := '__ecos-target-' || gen_random_uuid()::text;
  unprepared_document_id text := '__ecos-unprepared-' || gen_random_uuid()::text;
  legacy_document_id text := '__ecos-legacy-' || gen_random_uuid()::text;
  old_sha text := repeat('a', 64);
  target_sha text := repeat('b', 64);
  unprepared_sha text := repeat('c', 64);
  legacy_sha text := repeat('d', 64);
begin
  select principal.user_id, membership.organization_id
  into fixture_owner, fixture_org
  from app_private.dave_app_owner principal
  join public.organization_memberships membership
    on membership.user_id = principal.user_id
   and membership.status = 'active'
  where principal.singleton
  order by membership.created_at
  limit 1;

  if fixture_owner is null or fixture_org is null then
    raise exception 'ECOS_TEST_FAIL: no app-owner organization fixture principal';
  end if;

  perform set_config('app.ecos_test_owner', fixture_owner::text, true);
  perform set_config(
    'app.ecos_test_project_viewer',
    fixture_project_viewer::text,
    true
  );
  perform set_config('app.ecos_test_org', fixture_org, true);
  perform set_config('app.ecos_test_project', fixture_project::text, true);
  perform set_config('app.ecos_test_project_name', fixture_project_name, true);
  perform set_config('app.ecos_test_family', fixture_family, true);
  perform set_config('app.ecos_test_old_document', old_document_id, true);
  perform set_config('app.ecos_test_target_document', target_document_id, true);
  perform set_config('app.ecos_test_unprepared_document', unprepared_document_id, true);
  perform set_config('app.ecos_test_legacy_document', legacy_document_id, true);

  insert into public.projects (id, name, status, archived, owner_id)
  values (fixture_project, fixture_project_name, 'Active', false, fixture_owner);

  -- Create one active organization member who deliberately has no project
  -- permission. Later assertions grant this same identity a viewer role so
  -- the v2 status boundary proves both the negative and positive paths.
  insert into auth.users (
    id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    fixture_project_viewer,
    'authenticated',
    'authenticated',
    '__ecos-project-viewer-' || fixture_project_viewer::text || '@example.invalid',
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );

  insert into public.organization_memberships (
    user_id, organization_id, status, role
  ) values (
    fixture_project_viewer, fixture_org, 'active', 'member'
  );

  insert into public.vitruvius_project_memberships (
    organization_id, project_id, user_id, status, role, created_by
  ) values (
    fixture_org,
    fixture_project::text,
    fixture_owner,
    'active',
    'project_admin',
    fixture_owner
  );

  insert into public.ecos_hosted_index_configuration (
    organization_id, publication_mode, enabled, updated_by, updated_at
  ) values (
    fixture_org, 'live', true, fixture_owner, now()
  ) on conflict (organization_id) do update set
    publication_mode = excluded.publication_mode,
    enabled = true,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  -- All drawings begin non-current. The enqueue trigger must still create a
  -- private shadow job for each exact source revision.
  insert into public.reference_documents (
    id, name, category, document_data, owner_id, created_at, updated_at
  ) values
  (
    old_document_id,
    'ECOS adversarial old revision',
    'Drawing',
    jsonb_build_object(
      'name', 'ECOS adversarial old revision',
      'category', 'Drawing',
      'projectId', fixture_project::text,
      'projectName', fixture_project_name,
      'projectNames', jsonb_build_array(fixture_project::text, fixture_project_name),
      'organizationId', fixture_org,
      'webVersionGroupId', fixture_family,
      'drawingNumber', 'A-901',
      'drawingRevision', 'R1',
      'drawingStatus', 'Issued',
      'isCurrent', false,
      'contentSha256', old_sha,
      'storagePath', '__ecos-tests__/old.pdf',
      'sourcePageCount', '1'
    ),
    fixture_owner,
    clock_timestamp() - interval '3 minutes',
    clock_timestamp() - interval '3 minutes'
  ),
  (
    target_document_id,
    'ECOS adversarial target revision',
    'Plans',
    jsonb_build_object(
      'name', 'ECOS adversarial target revision',
      'category', 'Plans',
      'projectId', fixture_project::text,
      'projectName', fixture_project_name,
      'projectNames', jsonb_build_array(fixture_project::text, fixture_project_name),
      'organizationId', fixture_org,
      'webVersionGroupId', fixture_family,
      'drawingNumber', 'A-901',
      'drawingRevision', 'R2',
      'drawingStatus', 'Issued',
      'isCurrent', false,
      'contentSha256', target_sha,
      'storagePath', '__ecos-tests__/target.pdf',
      'sourcePageCount', '1'
    ),
    fixture_owner,
    clock_timestamp() - interval '2 minutes',
    clock_timestamp() - interval '2 minutes'
  ),
  (
    unprepared_document_id,
    'ECOS adversarial unprepared revision',
    'Drawing',
    jsonb_build_object(
      'name', 'ECOS adversarial unprepared revision',
      'category', 'Drawing',
      'projectId', fixture_project::text,
      'projectName', fixture_project_name,
      'projectNames', jsonb_build_array(fixture_project::text, fixture_project_name),
      'organizationId', fixture_org,
      'webVersionGroupId', fixture_family,
      'drawingNumber', 'A-901',
      'drawingRevision', 'R3',
      'drawingStatus', 'Issued',
      'isCurrent', false,
      'contentSha256', unprepared_sha,
      'storagePath', '__ecos-tests__/unprepared.pdf',
      'sourcePageCount', '1'
    ),
    fixture_owner,
    clock_timestamp() - interval '1 minute',
    clock_timestamp() - interval '1 minute'
  ),
  (
    legacy_document_id,
    'ECOS adversarial legacy proof',
    'Drawing',
    jsonb_build_object(
      'name', 'ECOS adversarial legacy proof',
      'category', 'Drawing',
      'projectId', fixture_project::text,
      'projectName', fixture_project_name,
      'projectNames', jsonb_build_array(fixture_project::text, fixture_project_name),
      'organizationId', fixture_org,
      'webVersionGroupId', '__ecos-legacy-family',
      'drawingNumber', 'L-901',
      'drawingRevision', 'R1',
      'drawingStatus', 'Issued',
      'isCurrent', false,
      'contentSha256', legacy_sha,
      'storagePath', '__ecos-tests__/legacy.pdf',
      'sourcePageCount', '1'
    ),
    fixture_owner,
    clock_timestamp(),
    clock_timestamp()
  );

  if (
    select count(*)
    from public.ecos_hosted_index_jobs job
    where job.document_id in (
      old_document_id, target_document_id, unprepared_document_id, legacy_document_id
    )
      and job.mode = 'shadow'
      and job.source_owner_id = fixture_owner
  ) <> 4 then
    raise exception 'ECOS_TEST_FAIL: non-current drawings did not enqueue exact shadow jobs';
  end if;

  -- Establish a prior current revision through the same guarded boundary used
  -- by the activation RPC. This is test setup only and remains in the rollback.
  perform set_config('app.ecos_current_activation', 'allowed', true);
  update public.reference_documents
  set document_data = jsonb_set(document_data, '{isCurrent}', 'true'::jsonb, true),
      updated_at = clock_timestamp()
  where id = old_document_id and owner_id = fixture_owner;
  perform set_config('app.ecos_current_activation', '', true);

  -- Only the target revision receives a ready exact Evidence 1.3 checkpoint.
  -- The old current revision also receives a plain ready job so status v2 can
  -- prove that a page without limitations keeps the existing Ready state.
  update public.ecos_hosted_index_jobs
  set source_scan_status = 'clean',
      source_scan_engine = 'deterministic-test-fixture',
      source_scan_at = clock_timestamp(),
      state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where document_id = old_document_id
    and source_owner_id = fixture_owner
    and source_sha256 = old_sha
    and source_revision = 'R1'
    and mode = 'shadow';

  update public.ecos_hosted_index_jobs
  set source_scan_status = 'clean',
      source_scan_engine = 'deterministic-test-fixture',
      source_scan_at = clock_timestamp(),
      state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where document_id = target_document_id
    and source_owner_id = fixture_owner
    and source_sha256 = target_sha
    and source_revision = 'R2'
    and mode = 'shadow';

  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count, created_at, updated_at
  )
  select
    job.id,
    fixture_org,
    fixture_project::text,
    target_document_id,
    1,
    target_sha,
    'assured',
    jsonb_build_object(
      'pageNumber', 1,
      'sheetNumber', 'A-901',
      'sheetTitle', 'HAZARDOUS MATERIAL STORAGE PLAN',
      'sheetMappingStatus', 'verified',
      'sheetMappingSource', 'native_title_band',
      'sheetMappingEvidence', jsonb_build_array(jsonb_build_object(
        'id', 'title-band-A-901',
        'pageNumber', 1,
        'source', 'embedded_text',
        'text', 'A-901',
        'normalizedBounds', jsonb_build_object(
          'x', 0.80, 'y', 0.90, 'width', 0.08, 'height', 0.04
        )
      )),
      'documentStructuralIdentity', jsonb_build_object(
        'sheetNumber', 'A-901',
        'source', 'native_title_band',
        'evidence', jsonb_build_array(jsonb_build_object(
          'id', 'title-band-A-901',
          'pageNumber', 1,
          'source', 'embedded_text',
          'text', 'A-901',
          'normalizedBounds', jsonb_build_object(
            'x', 0.80, 'y', 0.90, 'width', 0.08, 'height', 0.04
          )
        ))
      ),
      'text', concat_ws(' ',
        'Canopy C is the hazardous material storage area.',
        '2375 NORTH LOT — NEW PCC PAVING — 6.0 INCHES THICK'
      ),
      'regions', jsonb_build_array(
        jsonb_build_object(
          'id', 'title-band-A-901',
          'source', 'embedded_text',
          'text', 'A-901',
          'x', 0.80, 'y', 0.90, 'width', 0.08, 'height', 0.04
        ),
        jsonb_build_object(
          'id', 'structured-relationship-complete',
          'source', 'deterministic_structured_table_relationship',
          'text', '2375 NORTH LOT — NEW PCC PAVING — 6.0 INCHES THICK',
          'searchable', true,
          'factKind', 'structured_table_relationship',
          'subject', 'NEW PCC PAVING',
          'location', '2375 NORTH LOT',
          'evidenceText', '6.0 INCHES THICK',
          'reconstructionMethod', 'deterministic_table_relationship',
          'evidenceSources', jsonb_build_array('embedded_text'),
          'constituentEvidence', jsonb_build_array(
            jsonb_build_object('id', 'raw-subject', 'text', 'NEW PCC PAVING'),
            jsonb_build_object('id', 'raw-value', 'text', '6.0 INCHES THICK')
          ),
          'corroboratingEvidence', '[]'::jsonb,
          'structuredRelationshipId', 'relationship-complete',
          'structuredTableBlockId', 'table-block-1',
          'structuredTableRelationshipType', 'row_relationship',
          'structuredTableRowKey', 'new-pcc-paving',
          'x', 0.20, 'y', 0.30, 'width', 0.40, 'height', 0.05
        ),
        jsonb_build_object(
          'id', 'structured-raw-incomplete',
          'source', 'embedded_text',
          'text', 'INCOMPLETE RAW CELL — 4 INCHES',
          'searchable', false,
          'x', 0.20, 'y', 0.36, 'width', 0.20, 'height', 0.04
        )
      ),
      'visualCoverage', jsonb_build_object('status', 'complete')
    ),
    jsonb_build_object(
      'accepted', true,
      'method', 'independent_assurance',
      'schemaVersion', '1.0',
      'evidenceVersion', 'ecos-hosted-evidence/1.3',
      'assuranceProvider', 'test',
      'assuranceModel', 'deterministic-fixture',
      'confidence', 1.0,
      'checks', jsonb_build_object('sheetMappingUsable', true),
      'failureCodes', '[]'::jsonb,
      'limitationCodes', jsonb_build_array(
        'structured_table_analysis_incomplete'
      )
    ),
    0,
    clock_timestamp(),
    clock_timestamp()
  from public.ecos_hosted_index_jobs job
  where job.document_id = target_document_id
    and job.source_owner_id = fixture_owner
    and job.source_sha256 = target_sha
    and job.source_revision = 'R2'
    and job.mode = 'shadow';

  -- A service-owned live row cannot self-assert verified provenance. With no
  -- matching live checkpoint, its supplied sheet claim must be downgraded.
  insert into public.ecos_hosted_document_pages (
    organization_id, project_id, document_id, page_number, source_sha256,
    evidence_version, sheet_number, sheet_title, sheet_mapping_status,
    sheet_mapping_source, sheet_mapping_evidence, document_structural_identity,
    page_text, regions, assurance_result
  ) values (
    fixture_org,
    fixture_project::text,
    legacy_document_id,
    1,
    legacy_sha,
    'ecos-hosted-evidence/1.3',
    'FAB-999',
    'FABRICATED SHEET',
    'verified',
    'native_title_band',
    jsonb_build_array(jsonb_build_object(
      'id', 'forged', 'pageNumber', 1, 'source', 'embedded_text',
      'text', 'FAB-999',
      'normalizedBounds', jsonb_build_object(
        'x', 0.8, 'y', 0.9, 'width', 0.1, 'height', 0.04
      )
    )),
    jsonb_build_object('sheetNumber', 'FAB-999'),
    'Fabricated hosted proof',
    jsonb_build_array(jsonb_build_object(
      'id', 'forged', 'source', 'embedded_text', 'text', 'FAB-999',
      'x', 0.8, 'y', 0.9, 'width', 0.1, 'height', 0.04
    )),
    jsonb_build_object(
      'accepted', true,
      'checks', jsonb_build_object('sheetMappingUsable', true)
    )
  );

  if exists (
    select 1 from public.ecos_hosted_document_pages page
    where page.organization_id = fixture_org
      and page.document_id = legacy_document_id
      and (
        page.sheet_number is not null
        or page.sheet_mapping_status = 'verified'
        or page.sheet_mapping_source is not null
        or page.sheet_mapping_evidence <> '[]'::jsonb
        or page.document_structural_identity is not null
      )
  ) then
    raise exception 'ECOS_TEST_FAIL: fabricated hosted sheet provenance was retained';
  end if;

  -- Browser-owned legacy page/chunk claims must remain searchable by PDF page
  -- while all fabricated sheet, assurance, and visual attestations are stripped.
  insert into public.ecos_document_pages (
    owner_id, document_id, page_number, sheet_number, title, page_text,
    regions, extraction_method, confidence, source_sha256,
    sheet_mapping_status, sheet_mapping_confidence, sheet_mapping_candidates,
    visual_coverage, index_schema_version, sheet_mapping_source,
    sheet_mapping_evidence, document_structural_identity,
    sheet_mapping_assurance, assurance_result
  ) values (
    fixture_owner,
    legacy_document_id,
    1,
    'FAB-777',
    'Forged legacy page',
    'Legacy text remains searchable.',
    '[]'::jsonb,
    'browser',
    1.0,
    legacy_sha,
    'verified',
    1.0,
    jsonb_build_array('FAB-777'),
    jsonb_build_object('status', 'complete', 'tiles', 6),
    'ecos-document-index/2.0',
    'native_title_band',
    jsonb_build_array(jsonb_build_object(
      'id', 'forged', 'pageNumber', 1, 'source', 'embedded_text',
      'text', 'FAB-777',
      'normalizedBounds', jsonb_build_object(
        'x', 0.8, 'y', 0.9, 'width', 0.1, 'height', 0.04
      )
    )),
    jsonb_build_object('sheetNumber', 'FAB-777'),
    jsonb_build_object('accepted', true),
    jsonb_build_object('accepted', true)
  );

  insert into public.ecos_document_chunks (
    owner_id, document_id, page_number, region_id, chunk_index,
    chunk_text, sheet_number, confidence, metadata
  ) values (
    fixture_owner,
    legacy_document_id,
    1,
    'forged',
    0,
    'Legacy searchable text',
    'FAB-777',
    1.0,
    jsonb_build_object(
      'sheetMappingStatus', 'verified',
      'sheetMappingSource', 'native_title_band',
      'sheetMappingEvidence', jsonb_build_array('forged'),
      'documentStructuralIdentity', jsonb_build_object('sheetNumber', 'FAB-777'),
      'sheetMappingAssurance', jsonb_build_object('accepted', true),
      'assurance', jsonb_build_object('accepted', true),
      'visualCoverage', jsonb_build_object('status', 'complete')
    )
  );

  -- Direct EXECUTE is not required for these trigger-only helpers. Exercise
  -- every provenance trigger while the hardening migration has removed the
  -- exposed API-role grants.
  insert into public.ecos_hosted_document_chunks (
    organization_id, project_id, document_id, page_number, region_id,
    chunk_index, chunk_text, sheet_number, confidence, metadata
  ) values (
    fixture_org,
    fixture_project::text,
    legacy_document_id,
    1,
    'trigger-hardening-hosted',
    0,
    'Hosted trigger hardening proof',
    'FAB-999',
    1.0,
    jsonb_build_object(
      'sheetMappingStatus', 'verified',
      'searchable', true,
      'structuredSearchContract', 'complete-relationship-only-v1',
      'materialization', 'hosted_region'
    )
  );

  insert into public.ecos_hosted_document_chunks (
    organization_id, project_id, document_id, page_number, region_id,
    chunk_index, chunk_text, sheet_number, confidence, metadata
  ) values (
    fixture_org,
    fixture_project::text,
    legacy_document_id,
    1,
    'structured-hosted-true-without-contract',
    0,
    'SEARCHABLE TRUE WITHOUT THE COMPLETE-RELATIONSHIP CONTRACT',
    null,
    1.0,
    jsonb_build_object(
      'materialization', 'hosted_region',
      'searchable', true
    )
  );

  insert into public.ecos_hosted_document_chunks (
    organization_id, project_id, document_id, page_number, region_id,
    chunk_index, chunk_text, sheet_number, confidence, metadata
  ) values (
    fixture_org,
    fixture_project::text,
    legacy_document_id,
    1,
    'structured-hosted-raw-incomplete',
    0,
    'INCOMPLETE HOSTED RAW CELL — 5 INCHES',
    null,
    1.0,
    jsonb_build_object(
      'sourceRegionId', 'structured-hosted-raw-incomplete',
      'rawSource', 'embedded_text',
      'materialization', 'hosted_region',
      'searchable', false
    )
  );

  -- Exercise the real source-time materializer. It must emit the complete
  -- relationship and page text but never the quarantined raw sibling.
  perform public.ecos_refresh_hosted_shadow_page(job.id, 1)
  from public.ecos_hosted_index_jobs job
  where job.document_id = target_document_id
    and job.source_owner_id = fixture_owner
    and job.source_sha256 = target_sha
    and job.source_revision = 'R2'
    and job.mode = 'shadow';

  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata
  )
  select
    job.id,
    fixture_org,
    fixture_project::text,
    target_document_id,
    target_sha,
    1,
    'trigger-hardening-shadow',
    0,
    'Shadow trigger hardening proof',
    'FAB-999',
    1.0,
    jsonb_build_object(
      'sheetMappingStatus', 'verified',
      'searchable', true,
      'structuredSearchContract', 'complete-relationship-only-v1',
      'materialization', 'structured_visual_fact'
    )
  from public.ecos_hosted_index_jobs job
  where job.document_id = target_document_id
    and job.source_owner_id = fixture_owner
    and job.source_sha256 = target_sha
    and job.source_revision = 'R2'
    and job.mode = 'shadow';

  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata
  )
  select
    job.id,
    fixture_org,
    fixture_project::text,
    target_document_id,
    target_sha,
    1,
    'structured-shadow-true-without-contract',
    0,
    'SEARCHABLE TRUE WITHOUT THE COMPLETE-RELATIONSHIP CONTRACT',
    null,
    1.0,
    jsonb_build_object(
      'materialization', 'structured_visual_fact',
      'searchable', true
    )
  from public.ecos_hosted_index_jobs job
  where job.document_id = target_document_id
    and job.source_owner_id = fixture_owner
    and job.source_sha256 = target_sha
    and job.source_revision = 'R2'
    and job.mode = 'shadow';

  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata
  )
  select
    job.id,
    fixture_org,
    fixture_project::text,
    target_document_id,
    target_sha,
    1,
    'structured-raw-incomplete',
    0,
    'INCOMPLETE RAW CELL — 4 INCHES',
    null,
    1.0,
    jsonb_build_object(
      'sourceRegionId', 'structured-raw-incomplete',
      'rawSource', 'embedded_text',
      'materialization', 'structured_visual_fact',
      'searchable', false
    )
  from public.ecos_hosted_index_jobs job
  where job.document_id = target_document_id
    and job.source_owner_id = fixture_owner
    and job.source_sha256 = target_sha
    and job.source_revision = 'R2'
    and job.mode = 'shadow';

  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata
  )
  select
    job.id,
    fixture_org,
    fixture_project::text,
    target_document_id,
    target_sha,
    1,
    'structured-overlap-sanitized',
    0,
    'A-901 6.0 INCHES THICK INCOMPLETE RAW CELL 4 INCHES',
    null,
    1.0,
    jsonb_build_object('materialization', 'overlapping_page_text')
  from public.ecos_hosted_index_jobs job
  where job.document_id = target_document_id
    and job.source_owner_id = fixture_owner
    and job.source_sha256 = target_sha
    and job.source_revision = 'R2'
    and job.mode = 'shadow';

  if exists (
    select 1 from public.ecos_document_pages page
    where page.owner_id = fixture_owner
      and page.document_id = legacy_document_id
      and (
        page.sheet_number is not null
        or page.sheet_mapping_status = 'verified'
        or page.sheet_mapping_source is not null
        or page.sheet_mapping_evidence <> '[]'::jsonb
        or page.document_structural_identity is not null
        or page.sheet_mapping_assurance <> '{}'::jsonb
        or page.assurance_result <> '{}'::jsonb
        or page.visual_coverage <> '{}'::jsonb
      )
  ) then
    raise exception 'ECOS_TEST_FAIL: fabricated legacy page proof was retained';
  end if;

  if exists (
    select 1 from public.ecos_document_chunks chunk
    where chunk.owner_id = fixture_owner
      and chunk.document_id = legacy_document_id
      and (
        chunk.sheet_number is not null
        or chunk.metadata->>'sheetMappingStatus' = 'verified'
        or chunk.metadata ? 'visualCoverage'
        or chunk.metadata#>>'{assurance,accepted}' = 'true'
      )
  ) then
    raise exception 'ECOS_TEST_FAIL: fabricated legacy chunk proof was retained';
  end if;

  if not exists (
    select 1
    from public.ecos_hosted_document_chunks chunk
    where chunk.organization_id = fixture_org
      and chunk.document_id = legacy_document_id
      and chunk.region_id = 'trigger-hardening-hosted'
      and chunk.sheet_number is null
      and chunk.metadata->>'sheetMappingStatus' = 'unverified'
  ) then
    raise exception 'ECOS_TEST_FAIL: hosted provenance trigger did not execute after hardening';
  end if;

  if not exists (
    select 1
    from public.ecos_hosted_shadow_chunks chunk
    where chunk.document_id = target_document_id
      and chunk.region_id = 'trigger-hardening-shadow'
      and chunk.sheet_number = 'A-901'
      and chunk.metadata->>'sheetMappingStatus' = 'verified'
      and jsonb_array_length(chunk.metadata->'sheetMappingEvidence') = 1
  ) then
    raise exception 'ECOS_TEST_FAIL: shadow provenance trigger did not execute after hardening';
  end if;

  if exists (
    select 1
    from public.ecos_hosted_document_chunks chunk
    where chunk.organization_id = fixture_org
      and chunk.document_id = legacy_document_id
      and chunk.region_id in (
        'structured-hosted-raw-incomplete',
        'structured-hosted-true-without-contract'
      )
  ) then
    raise exception
      'ECOS_TEST_FAIL: untrusted hosted structured-table chunk was materialized';
  end if;

  if exists (
    select 1
    from public.ecos_hosted_shadow_chunks chunk
    where chunk.document_id = target_document_id
      and chunk.region_id in (
        'structured-raw-incomplete',
        'structured-shadow-true-without-contract'
      )
  ) then
    raise exception
      'ECOS_TEST_FAIL: untrusted shadow structured-table chunk was materialized';
  end if;

  if not exists (
    select 1
    from public.ecos_hosted_shadow_chunks chunk
    where chunk.document_id = target_document_id
      and chunk.metadata->>'sourceRegionId' = 'structured-relationship-complete'
      and chunk.metadata->>'searchable' = 'true'
      and chunk.metadata->>'rawSource' =
        'deterministic_structured_table_relationship'
      and chunk.metadata->>'structuredRelationshipId' = 'relationship-complete'
      and jsonb_array_length(chunk.metadata->'constituentEvidence') = 2
  ) then
    raise exception 'ECOS_TEST_FAIL: complete structured relationship lost its proof chain';
  end if;

  if not exists (
    select 1
    from public.ecos_hosted_shadow_chunks chunk
    where chunk.document_id = target_document_id
      and chunk.region_id = 'structured-overlap-sanitized'
      and chunk.chunk_text like '%6.0 INCHES THICK%'
      and chunk.chunk_text not like '%INCOMPLETE RAW CELL%'
      and chunk.chunk_text not like '%4 INCHES%'
  ) then
    raise exception 'ECOS_TEST_FAIL: overlapping page text retained a raw table constituent';
  end if;
end;
$ecos_fixture$;

-- Exercise RLS and the authenticated activation/RPC surfaces as the real app
-- role, with auth.uid() bound to the existing app owner.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('app.ecos_test_owner'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $ecos_authenticated$
declare
  target_id text := current_setting('app.ecos_test_target_document');
  old_id text := current_setting('app.ecos_test_old_document');
  unprepared_id text := current_setting('app.ecos_test_unprepared_document');
  legacy_id text := current_setting('app.ecos_test_legacy_document');
  project_id text := current_setting('app.ecos_test_project');
  expected_updated_at timestamptz;
  activation_result jsonb;
  caught_expected boolean;
  visible_count integer;
begin
  caught_expected := false;
  begin
    perform count(*) from public.ecos_hosted_document_pages;
  exception when insufficient_privilege then
    caught_expected := true;
  end;
  if not caught_expected then
    raise exception 'ECOS_TEST_FAIL: authenticated direct hosted-page SELECT was not denied';
  end if;

  select count(*) into visible_count
  from public.ecos_hosted_index_status_v2(array[target_id]) status
  where status.document_id = target_id
    and status.customer_status = 'Prepared with limitations'
    and status.limitation_count = 1
    and status.customer_message like '%Make this revision current%';
  if visible_count <> 1 then
    raise exception
      'ECOS_TEST_FAIL: non-current limited drawing did not report Prepared with limitations';
  end if;

  select count(*) into visible_count
  from public.ecos_hosted_index_status_v2(array[old_id]) status
  where status.document_id = old_id
    and status.customer_status = 'Ready for ECOS'
    and status.limitation_count = 0;
  if visible_count <> 1 then
    raise exception
      'ECOS_TEST_FAIL: plain ready current drawing changed customer status';
  end if;

  if exists (
    select 1
    from public.ecos_hosted_index_status_v2(array[target_id]) status
    where to_jsonb(status) ? 'limitationCodes'
      or to_jsonb(status)::text like '%structured_table_analysis_incomplete%'
  ) then
    raise exception
      'ECOS_TEST_FAIL: raw limitation diagnostics crossed customer status v2';
  end if;

  caught_expected := false;
  begin
    update public.reference_documents source
    set document_data = jsonb_set(source.document_data, '{isCurrent}', 'true'::jsonb, true)
    where source.id = target_id;
  exception when others then
    if sqlerrm = 'ecos_atomic_current_activation_required' then
      caught_expected := true;
    else
      raise;
    end if;
  end;
  if not caught_expected then
    raise exception 'ECOS_TEST_FAIL: direct drawing activation did not fail closed';
  end if;

  select source.updated_at into expected_updated_at
  from public.reference_documents source
  where source.id = unprepared_id;
  caught_expected := false;
  begin
    perform public.ecos_activate_current_reference_document(
      unprepared_id, expected_updated_at
    );
  exception when others then
    if sqlerrm = 'ecos_target_not_prepared' then
      caught_expected := true;
    else
      raise;
    end if;
  end;
  if not caught_expected then
    raise exception 'ECOS_TEST_FAIL: unprepared drawing activation did not fail closed';
  end if;

  select source.updated_at into expected_updated_at
  from public.reference_documents source
  where source.id = target_id;
  select public.ecos_activate_current_reference_document(
    target_id, expected_updated_at
  ) into activation_result;

  if activation_result->>'document_id' is distinct from target_id
      or (activation_result->>'changed_count')::integer <> 2 then
    raise exception 'ECOS_TEST_FAIL: atomic activation result was not exact: %', activation_result;
  end if;
  if (
    select count(*)
    from public.reference_documents source
    where source.id in (old_id, target_id, unprepared_id)
      and source.document_data->>'isCurrent' = 'true'
  ) <> 1 or not exists (
    select 1 from public.reference_documents source
    where source.id = target_id
      and source.document_data->>'isCurrent' = 'true'
  ) then
    raise exception 'ECOS_TEST_FAIL: activation did not leave exactly one current family revision';
  end if;

  select count(*) into visible_count
  from public.ecos_hosted_index_status_v2(array[target_id]) status
  where status.document_id = target_id
    and status.customer_status = 'Ready with limitations'
    and status.limitation_count = 1
    and status.customer_message like '%Ask ECOS can use%';
  if visible_count <> 1 then
    raise exception
      'ECOS_TEST_FAIL: current limited drawing did not report Ready with limitations';
  end if;

  caught_expected := false;
  begin
    perform public.ecos_activate_current_reference_document(
      target_id, expected_updated_at
    );
  exception when others then
    if sqlerrm = 'ecos_current_activation_conflict' then
      caught_expected := true;
    else
      raise;
    end if;
  end;
  if not caught_expected then
    raise exception 'ECOS_TEST_FAIL: stale activation token did not conflict';
  end if;

  select count(*) into visible_count
  from public.ecos_load_current_hosted_page_context(
    project_id,
    array[target_id],
    array[1]
  ) context
  where context.document_id = target_id
    and context.page_number = 1
    and context.sheet_number = 'A-901'
    and context.sheet_mapping_status = 'verified'
    and context.sheet_mapping_source = 'native_title_band'
    and jsonb_array_length(context.sheet_mapping_evidence) = 1
    and context.document_structural_identity->>'sheetNumber' = 'A-901'
    and context.assurance_result->>'accepted' = 'true';
  if visible_count <> 1 then
    raise exception 'ECOS_TEST_FAIL: exact current hosted page context was not returned';
  end if;

  select count(*) into visible_count
  from public.ecos_load_current_hosted_page_context(
    project_id,
    array[old_id, legacy_id],
    array[1]
  );
  if visible_count <> 0 then
    raise exception 'ECOS_TEST_FAIL: stale or fabricated evidence crossed the current-page RPC';
  end if;

end;
$ecos_authenticated$;

reset role;

-- Replace the exact live checkpoint's native title-band proof with one valid
-- PDF-annotation proof, then force the hosted-page trigger to reconstruct its
-- public row from that service-owned checkpoint instead of caller-supplied
-- metadata. This is the full database round trip for the additive source.
do $ecos_annotation_round_trip$
declare
  target_id text := current_setting('app.ecos_test_target_document');
  target_sha text := repeat('b', 64);
  annotation_evidence jsonb := jsonb_build_array(
    jsonb_build_object(
      'id', 'pdf-annotation-1-page-1',
      'pageNumber', 1,
      'source', 'pdf_annotation',
      'annotationSubtype', 'Square',
      'text', 'C6',
      'normalizedBounds', jsonb_build_object(
        'x', 0.950, 'y', 0.910, 'width', 0.010, 'height', 0.010
      )
    ),
    jsonb_build_object(
      'id', 'pdf-annotation-2-page-1',
      'pageNumber', 1,
      'source', 'pdf_annotation',
      'annotationSubtype', 'Square',
      'text', 'SHEET NO.',
      'normalizedBounds', jsonb_build_object(
        'x', 0.949, 'y', 0.895, 'width', 0.012, 'height', 0.010
      )
    )
  );
begin
  -- Activation intentionally keeps the already-prepared job in shadow mode;
  -- the current-page RPC can consume that exact checkpoint directly. Promote
  -- this disposable fixture only to exercise the separate live publication
  -- trigger path without invoking a worker or changing real configuration.
  update public.ecos_hosted_index_jobs job
  set mode = 'live',
      updated_at = clock_timestamp()
  where job.document_id = target_id
    and job.source_sha256 = target_sha
    and job.mode = 'shadow'
    and job.state = 'ready';
  if not found then
    raise exception
      'ECOS_TEST_FAIL: prepared checkpoint was unavailable for live round trip';
  end if;

  update public.ecos_hosted_index_pages page
  set final_page_data = page.final_page_data || jsonb_build_object(
        'sheetNumber', 'C6',
        'sheetMappingStatus', 'verified',
        'sheetMappingSource', 'pdf_annotation_title_band',
        'sheetMappingEvidence', annotation_evidence,
        'documentStructuralIdentity', jsonb_build_object(
          'sheetNumber', 'C6',
          'source', 'pdf_annotation_title_band',
          'evidence', annotation_evidence
        )
      ),
      updated_at = clock_timestamp()
  from public.ecos_hosted_index_jobs job
  where page.job_id = job.id
    and job.document_id = target_id
    and job.source_sha256 = target_sha
    and job.mode = 'live'
    and page.page_number = 1;
  if not found then
    raise exception
      'ECOS_TEST_FAIL: exact live checkpoint was unavailable for annotation round trip';
  end if;

  insert into public.ecos_hosted_document_pages (
    organization_id, project_id, document_id, page_number, source_sha256,
    evidence_version, sheet_number, sheet_title, sheet_mapping_status,
    sheet_mapping_source, sheet_mapping_evidence,
    document_structural_identity, page_text, regions, assurance_result
  )
  select
    job.organization_id,
    job.project_id,
    job.document_id,
    page.page_number,
    job.source_sha256,
    job.committed_evidence_version,
    'FAB-999',
    'CALLER-SUPPLIED TITLE',
    'verified',
    'native_title_band',
    '[]'::jsonb,
    null,
    'Published annotation title-band proof',
    '[]'::jsonb,
    page.assurance_result
  from public.ecos_hosted_index_jobs job
  join public.ecos_hosted_index_pages page on page.job_id = job.id
  where job.document_id = target_id
    and job.source_sha256 = target_sha
    and job.mode = 'live'
    and page.page_number = 1;
  if not found then
    raise exception
      'ECOS_TEST_FAIL: hosted page was unavailable for annotation reconstruction';
  end if;

  if not exists (
    select 1
    from public.ecos_hosted_document_pages page
    where page.document_id = target_id
      and page.source_sha256 = target_sha
      and page.page_number = 1
      and page.sheet_number = 'C6'
      and page.sheet_mapping_status = 'verified'
      and page.sheet_mapping_source = 'pdf_annotation_title_band'
      and jsonb_array_length(page.sheet_mapping_evidence) = 2
      and page.sheet_mapping_evidence#>>'{0,annotationSubtype}' = 'Square'
      and page.document_structural_identity->>'source'
        = 'pdf_annotation_title_band'
  ) then
    raise exception
      'ECOS_TEST_FAIL: PDF-annotation provenance did not survive hosted round trip';
  end if;
end;
$ecos_annotation_round_trip$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('app.ecos_test_owner'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $ecos_annotation_current_rpc$
declare visible_count integer;
begin
  select count(*) into visible_count
  from public.ecos_load_current_hosted_page_context(
    current_setting('app.ecos_test_project'),
    array[current_setting('app.ecos_test_target_document')],
    array[1]
  ) context
  where context.sheet_number = 'C6'
    and context.sheet_mapping_status = 'verified'
    and context.sheet_mapping_source = 'pdf_annotation_title_band'
    and jsonb_array_length(context.sheet_mapping_evidence) = 2
    and context.document_structural_identity->>'source'
      = 'pdf_annotation_title_band';
  if visible_count <> 1 then
    raise exception
      'ECOS_TEST_FAIL: annotation provenance did not cross exact current-page RPC';
  end if;
end;
$ecos_annotation_current_rpc$;

reset role;

-- An active organization member without a project role must see no status.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  current_setting('app.ecos_test_project_viewer'),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $ecos_project_member_denied$
declare visible_count integer;
begin
  select count(*) into visible_count
  from public.ecos_hosted_index_status_v2(
    array[current_setting('app.ecos_test_target_document')]
  );
  if visible_count <> 0 then
    raise exception
      'ECOS_TEST_FAIL: organization member without project permission saw status v2';
  end if;
end;
$ecos_project_member_denied$;

reset role;

insert into public.vitruvius_project_memberships (
  organization_id, project_id, user_id, status, role, created_by
) values (
  current_setting('app.ecos_test_org'),
  current_setting('app.ecos_test_project'),
  current_setting('app.ecos_test_project_viewer')::uuid,
  'active',
  'viewer',
  current_setting('app.ecos_test_owner')::uuid
);

-- The exact same identity becomes scoped to this project after the explicit
-- viewer grant and can see only the customer-safe status row.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  current_setting('app.ecos_test_project_viewer'),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $ecos_project_member_allowed$
declare visible_count integer;
begin
  select count(*) into visible_count
  from public.ecos_hosted_index_status_v2(
    array[current_setting('app.ecos_test_target_document')]
  ) status
  where status.customer_status = 'Ready with limitations'
    and status.limitation_count = 1;
  if visible_count <> 1 then
    raise exception
      'ECOS_TEST_FAIL: authorized project viewer could not see scoped status v2';
  end if;
end;
$ecos_project_member_allowed$;

reset role;

-- An exact-source mismatch must immediately invalidate previously accepted
-- evidence and status even while the document remains marked current.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('app.ecos_test_owner'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $ecos_exact_source_mismatch$
declare
  target_id text := current_setting('app.ecos_test_target_document');
  project_id text := current_setting('app.ecos_test_project');
  visible_count integer;
begin
  update public.reference_documents source
  set document_data = jsonb_set(
    source.document_data,
    '{contentSha256}',
    to_jsonb(repeat('e', 64)),
    true
  )
  where source.id = target_id;

  select count(*) into visible_count
  from public.ecos_load_current_hosted_page_context(
    project_id,
    array[target_id],
    array[1]
  );
  if visible_count <> 0 then
    raise exception 'ECOS_TEST_FAIL: checksum-mismatched evidence remained visible';
  end if;

  select count(*) into visible_count
  from public.ecos_hosted_index_status_v2(array[target_id]) status
  where status.state = 'ready'
    or status.limitation_count <> 0
    or status.customer_status in (
      'Ready with limitations', 'Prepared with limitations',
      'Ready for ECOS', 'Prepared'
    );
  if visible_count <> 0 then
    raise exception
      'ECOS_TEST_FAIL: checksum-mismatched ready evidence remained visible in status v2';
  end if;
end;
$ecos_exact_source_mismatch$;

reset role;

-- A different authenticated identity must be rejected at the RPC boundary.
set local role authenticated;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $ecos_unauthorized$
declare
  caught_expected boolean := false;
begin
  begin
    perform * from public.ecos_load_current_hosted_page_context(
      current_setting('app.ecos_test_project'),
      array[current_setting('app.ecos_test_target_document')],
      array[1]
    );
  exception when insufficient_privilege then
    caught_expected := true;
  end;
  if not caught_expected then
    raise exception 'ECOS_TEST_FAIL: unauthorized identity crossed hosted page-context RPC';
  end if;
end;
$ecos_unauthorized$;

reset role;

do $ecos_trigger_acl$
declare
  trigger_function record;
  expected_trigger_count integer;
  status_v2_oid oid;
begin
  select to_regprocedure(
    'public.ecos_hosted_index_status_v2(text[])'
  )::oid into status_v2_oid;
  if status_v2_oid is null
      or has_function_privilege('anon', status_v2_oid, 'execute')
      or not has_function_privilege('authenticated', status_v2_oid, 'execute')
      or exists (
        select 1
        from pg_proc procedure
        cross join lateral aclexplode(
          coalesce(procedure.proacl, acldefault('f', procedure.proowner))
        ) acl
        where procedure.oid = status_v2_oid
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
      or pg_get_function_result(status_v2_oid)
        not like '%limitation_count integer%'
      or to_regprocedure(
        'public.ecos_hosted_index_status(text[])'
      ) is null
      or not has_function_privilege(
        'authenticated',
        'public.ecos_hosted_index_status(text[])',
        'execute'
      ) then
    raise exception
      'ECOS_TEST_FAIL: customer status v2 ACL, shape, or v1 compatibility is unsafe';
  end if;

  if to_regprocedure(
      'public.ecos_sheet_provenance_payload(jsonb,jsonb,boolean)'
    ) is null
      or to_regprocedure(
        'public.ecos_sheet_provenance_payload_without_annotation_title_band(jsonb,jsonb,boolean)'
      ) is null
      or has_function_privilege(
        'anon',
        'public.ecos_sheet_provenance_payload(jsonb,jsonb,boolean)',
        'execute'
      )
      or has_function_privilege(
        'authenticated',
        'public.ecos_sheet_provenance_payload(jsonb,jsonb,boolean)',
        'execute'
      )
      or not has_function_privilege(
        'service_role',
        'public.ecos_sheet_provenance_payload(jsonb,jsonb,boolean)',
        'execute'
      )
      or has_function_privilege(
        'anon',
        'public.ecos_sheet_provenance_payload_without_annotation_title_band(jsonb,jsonb,boolean)',
        'execute'
      )
      or has_function_privilege(
        'authenticated',
        'public.ecos_sheet_provenance_payload_without_annotation_title_band(jsonb,jsonb,boolean)',
        'execute'
      )
      or not has_function_privilege(
        'service_role',
        'public.ecos_sheet_provenance_payload_without_annotation_title_band(jsonb,jsonb,boolean)',
        'execute'
      )
      or (
        select count(*)
        from pg_constraint constraint_record
        where constraint_record.conname in (
          'ecos_document_pages_sheet_mapping_source_check',
          'ecos_hosted_document_pages_sheet_mapping_source_check'
        )
          and pg_get_constraintdef(constraint_record.oid)
            like '%pdf_annotation_title_band%'
      ) <> 2 then
    raise exception
      'ECOS_TEST_FAIL: PDF-annotation helper ACL or page constraints are unsafe';
  end if;

  for trigger_function in
    select procedure.oid, procedure.proname
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any (array[
        'ecos_prepare_legacy_page_sheet_provenance',
        'ecos_prepare_hosted_page_sheet_provenance',
        'ecos_enrich_legacy_chunk_sheet_provenance',
        'ecos_enrich_hosted_chunk_sheet_provenance',
        'ecos_enrich_shadow_chunk_sheet_provenance'
      ])
      and procedure.prorettype = 'pg_catalog.trigger'::regtype
  loop
    if has_function_privilege('anon', trigger_function.oid, 'execute')
        or has_function_privilege(
          'authenticated', trigger_function.oid, 'execute'
        )
        or not has_function_privilege(
          'service_role', trigger_function.oid, 'execute'
        ) then
      raise exception
        'ECOS_TEST_FAIL: trigger helper execute ACL is unsafe for %',
        trigger_function.proname;
    end if;
  end loop;

  select count(*) into expected_trigger_count
  from pg_trigger trigger_record
  join pg_proc procedure on procedure.oid = trigger_record.tgfoid
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where not trigger_record.tgisinternal
    and namespace.nspname = 'public'
    and procedure.proname = any (array[
      'ecos_prepare_legacy_page_sheet_provenance',
      'ecos_prepare_hosted_page_sheet_provenance',
      'ecos_enrich_legacy_chunk_sheet_provenance',
      'ecos_enrich_hosted_chunk_sheet_provenance',
      'ecos_enrich_shadow_chunk_sheet_provenance'
    ])
    and trigger_record.tgenabled <> 'D';

  if expected_trigger_count <> 5 then
    raise exception
      'ECOS_TEST_FAIL: expected five enabled sheet-provenance triggers, found %',
      expected_trigger_count;
  end if;

  if has_function_privilege(
      'anon',
      'public.ecos_gate_structured_table_shadow_search()',
      'execute'
    ) or has_function_privilege(
      'authenticated',
      'public.ecos_gate_structured_table_shadow_search()',
      'execute'
    ) or not exists (
      select 1
      from pg_trigger trigger_record
      join pg_proc procedure on procedure.oid = trigger_record.tgfoid
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where not trigger_record.tgisinternal
        and trigger_record.tgenabled <> 'D'
        and namespace.nspname = 'public'
        and procedure.proname = 'ecos_gate_structured_table_shadow_search'
    ) then
    raise exception 'ECOS_TEST_FAIL: structured-table search gate ACL or trigger is unsafe';
  end if;

  if has_function_privilege(
      'anon',
      'public.ecos_gate_structured_table_hosted_search()',
      'execute'
    ) or has_function_privilege(
      'authenticated',
      'public.ecos_gate_structured_table_hosted_search()',
      'execute'
    ) or not exists (
      select 1
      from pg_trigger trigger_record
      join pg_proc procedure on procedure.oid = trigger_record.tgfoid
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where not trigger_record.tgisinternal
        and trigger_record.tgenabled <> 'D'
        and namespace.nspname = 'public'
        and procedure.proname = 'ecos_gate_structured_table_hosted_search'
    ) then
    raise exception 'ECOS_TEST_FAIL: hosted structured-table search gate ACL or trigger is unsafe';
  end if;
end;
$ecos_trigger_acl$;

select jsonb_build_object(
  'status', 'PASS',
  'migration_order', jsonb_build_array(
    '20260809065350',
    '20260809070356',
    '20260809120133',
    '20260809121440',
    '20260809130657',
    '20260809131713'
  ),
  'noncurrent_shadow_enqueue', true,
  'atomic_activation', true,
  'direct_activation_guard', true,
  'stale_activation_conflict', true,
  'legacy_provenance_rejection', true,
  'hosted_provenance_reconstruction', true,
  'current_page_rpc', true,
  'rls_direct_hosted_read_denied', true,
  'unauthorized_rpc_denied', true,
  'trigger_function_execute_hardening', true,
  'structured_table_search_gate', true,
  'hosted_status_v2_project_permission', true,
  'hosted_status_v2_limitation_visibility', true,
  'pdf_annotation_title_band_canonicalization', true,
  'pdf_annotation_title_band_round_trip', true,
  'transaction_disposition', 'ROLLBACK'
) as ecos_migration_adversarial_acceptance;
