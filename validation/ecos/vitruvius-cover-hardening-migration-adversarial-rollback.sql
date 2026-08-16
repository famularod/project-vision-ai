-- The sealed nine-migration chain is temporarily rewound inside one outer
-- transaction. The visual dismissal authority migration is then injected,
-- exercised, and
-- rolled back without changing the live database.

do $cover_hardening_precondition$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '20260809193726', '20260809195802', '20260809201435',
    '20260809222329', '20260810013000', '20260811021601',
    '20260811151028', '20260811235642', '20260812011945'
  ];
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions then
    raise exception 'final hardening rehearsal requires the exact verified nine-migration tip';
  end if;
  if to_regprocedure(
    'public.ecos_dismiss_hosted_visual_exception_v1(uuid,uuid,integer,text,jsonb,text,text,text,jsonb,jsonb)'
  ) is null then
    raise exception 'visual dismissal authority is missing from the sealed nine-migration tip';
  end if;
end
$cover_hardening_precondition$;

begin;
set local statement_timeout = '15min';
set local lock_timeout = '5s';

delete from supabase_migrations.schema_migrations
where version = '20260812011945';
drop function public.ecos_dismiss_hosted_visual_exception_v1(
  uuid, uuid, integer, text, jsonb, text, text, text, jsonb, jsonb
);

-- @apply-cover-hardening-migration 20260812011945

do $visual_dismissal_fixture$
declare
  selected_job public.ecos_hosted_index_jobs%rowtype;
  fixture_claim_token constant uuid := '95000000-0000-4000-8000-000000000001';
  candidate_bounds constant jsonb :=
    '{"x":0.1,"y":0.2,"width":0.3,"height":0.4}'::jsonb;
  candidates constant jsonb := jsonb_build_array(jsonb_build_object(
    'text', 'UNRELATED OCR FRAGMENT',
    'source', 'fixed_visual_tile_coordinate_ocr',
    'confidence', 0.42,
    'bounds', candidate_bounds
  ));
  fingerprint constant text := repeat('f', 64);
  dismissal jsonb;
  assurance jsonb;
  dismissed boolean;
begin
  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where job.source_page_count >= 1
  order by job.created_at, job.id
  limit 1
  for update;
  if not found then
    raise exception 'visual dismissal rehearsal requires one held hosted job';
  end if;
  update public.ecos_hosted_index_jobs job set
    claim_token = fixture_claim_token,
    claimed_by = 'visual-dismissal-rehearsal',
    lease_expires_at = now() + interval '5 minutes'
  where job.id = selected_job.id;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', gen_random_uuid()::text, 'role', 'service_role')::text,
    true
  );
  dismissal := jsonb_build_object(
    'schemaVersion', 'ecos-drawing-page-analysis/2.0',
    'resolutionType', 'independently_unverifiable_candidates',
    'facts', '[]'::jsonb,
    'dismissedCandidateIndexes', jsonb_build_array(0),
    'dismissedDiagnosticCandidates', candidates,
    'visionProvider', 'gemini',
    'model', 'primary-model',
    'assuranceProvider', 'openai',
    'assuranceModel', 'assurance-model',
    'evidenceVersion', 'ecos-hosted-evidence/1.3',
    'exceptionFingerprint', fingerprint
  );
  assurance := jsonb_build_object(
    'accepted', true,
    'method', 'bounded_visual_exception_dismissal_v1',
    'schemaVersion', 'ecos-drawing-page-analysis/2.0',
    'evidenceVersion', 'ecos-hosted-evidence/1.3',
    'exceptionFingerprint', fingerprint,
    'assuranceProvider', 'openai',
    'assuranceModel', 'assurance-model',
    'acceptedFactCount', 0,
    'dismissedCandidateCount', 1
  );
  dismissed := public.ecos_dismiss_hosted_visual_exception_v1(
    selected_job.id, fixture_claim_token, 1, 'low-confidence-ocr-rehearsal',
    candidate_bounds, 'Exact bounded candidate requires verification.',
    'ecos-hosted-evidence/1.3', fingerprint, dismissal, assurance
  );
  if dismissed is distinct from true or not exists (
    select 1 from public.ecos_hosted_visual_exceptions exception
    where exception.job_id = selected_job.id
      and exception.page_number = 1
      and exception.region_key = 'low-confidence-ocr-rehearsal'
      and exception.state = 'resolved'
      and exception.normalized_evidence->'facts' = '[]'::jsonb
      and exception.assurance_result->>'method' =
        'bounded_visual_exception_dismissal_v1'
  ) then
    raise exception 'fact-free visual dismissal did not persist exactly';
  end if;
  begin
    perform public.ecos_dismiss_hosted_visual_exception_v1(
      selected_job.id, fixture_claim_token, 1, 'low-confidence-ocr-rehearsal',
      candidate_bounds, 'Exact bounded candidate requires verification.',
      'ecos-hosted-evidence/1.3', fingerprint,
      jsonb_set(dismissal, '{dismissedCandidateIndexes}', '[]'::jsonb),
      assurance
    );
    raise exception 'partial dismissal bypassed exact candidate coverage';
  exception when others then
    if sqlerrm = 'partial dismissal bypassed exact candidate coverage' then raise; end if;
  end;
end
$visual_dismissal_fixture$;

do $cover_hardening_fixture$
declare
  target_owner uuid;
  commit_result jsonb;
  project_id constant uuid := '93000000-0000-4000-8000-000000000001';
  abandoned_path constant text :=
    'project-covers/93000000-0000-4000-8000-000000000001/revisions/94000000-0000-4000-8000-000000000001.jpg';
  retained_path constant text :=
    'project-covers/93000000-0000-4000-8000-000000000001/revisions/94000000-0000-4000-8000-000000000002.jpg';
begin
  if to_regprocedure(
    'public.dave_guard_project_cover_storage_delete()'
  ) is null then
    raise exception 'cover Storage delete guard transition is incomplete';
  end if;
  if has_function_privilege(
    'public',
    'public.dave_guard_project_cover_storage_delete()',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.dave_guard_project_cover_storage_delete()',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.dave_guard_project_cover_storage_delete()',
    'EXECUTE'
  ) then
    raise exception 'cover Storage delete guard function ACL is unsafe';
  end if;

  select owner.user_id into target_owner
  from app_private.dave_app_owner as owner
  where owner.singleton;
  if target_owner is null then
    raise exception 'cover hardening rehearsal could not resolve the sealed app owner';
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', target_owner::text, 'role', 'authenticated')::text,
    true
  );

  insert into public.projects (id, owner_id, name, project_data)
  values (project_id, target_owner, 'Cover Hardening Fixture', '{}'::jsonb);
  insert into storage.objects (bucket_id, name, metadata, user_metadata) values
    ('project-photos', abandoned_path, '{"size":100}'::jsonb, '{}'::jsonb),
    (
      'project-photos', retained_path, '{"size":200}'::jsonb,
      '{"vitruviusContentSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","vitruviusSizeBytes":"200"}'::jsonb
    );

  commit_result := public.dave_commit_project_cover_photo(
    project_id::text,
    'Cover Hardening Fixture',
    null,
    'automatic',
    null,
    jsonb_build_object(
      'remotePath', retained_path,
      'mimeType', 'image/jpeg',
      'contentSha256', repeat('b', 64),
      'sizeBytes', 200,
      'updatedAt', '2026-08-11T23:56:42.000Z'
    ),
    'manual',
    '2026-08-11T23:56:42.000Z'
  );
  if commit_result ->> 'status' <> 'committed' then
    raise exception 'fixture cover receipt did not commit before cleanup check';
  end if;
end
$cover_hardening_fixture$;

set local role authenticated;
-- Supabase Storage sets this transaction-local guard before its supported
-- API removes the database object. The rehearsal reproduces that API-side
-- precondition while still exercising our own row trigger and RLS policy.
set local storage.allow_delete_query = 'true';
do $cover_hardening_direct_delete$
declare
  deleted_count integer;
  abandoned_path constant text :=
    'project-covers/93000000-0000-4000-8000-000000000001/revisions/94000000-0000-4000-8000-000000000001.jpg';
  retained_path constant text :=
    'project-covers/93000000-0000-4000-8000-000000000001/revisions/94000000-0000-4000-8000-000000000002.jpg';
begin
  delete from storage.objects
  where bucket_id = 'project-photos' and name = abandoned_path;
  get diagnostics deleted_count = row_count;
  if deleted_count <> 1 then
    raise exception 'uncommitted immutable cover cleanup did not delete the exact object';
  end if;
  begin
    delete from storage.objects
    where bucket_id = 'project-photos' and name = retained_path;
    raise exception 'direct authenticated delete removed an immutable cover revision';
  exception when insufficient_privilege then
    null;
  end;
end
$cover_hardening_direct_delete$;
reset role;

do $cover_hardening_retained_object$
begin
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'project-photos'
      and name = 'project-covers/93000000-0000-4000-8000-000000000001/revisions/94000000-0000-4000-8000-000000000002.jpg'
  ) then
    raise exception 'direct authenticated delete removed an immutable cover revision';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'project-photos'
      and name = 'project-covers/93000000-0000-4000-8000-000000000001/revisions/94000000-0000-4000-8000-000000000001.jpg'
  ) then
    raise exception 'uncommitted immutable cover cleanup did not delete the exact object';
  end if;
end
$cover_hardening_retained_object$;

rollback;

do $cover_hardening_rollback_proof$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '20260809193726', '20260809195802', '20260809201435',
    '20260809222329', '20260810013000', '20260811021601',
    '20260811151028', '20260811235642', '20260812011945'
  ];
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions
      or to_regprocedure(
        'public.ecos_dismiss_hosted_visual_exception_v1(uuid,uuid,integer,text,jsonb,text,text,text,jsonb,jsonb)'
      ) is null
      or exists (
        select 1 from public.projects
        where id = '93000000-0000-4000-8000-000000000001'
      ) then
    raise exception 'cover hardening outer transaction did not restore the exact preapply state';
  end if;
end
$cover_hardening_rollback_proof$;

select jsonb_build_object(
  'receipt', 'VITRUVIUS_COVER_HARDENING_MIGRATION_REHEARSAL_OK',
  'migrationOrder', jsonb_build_array('20260812011945'),
  'outerTransactionRolledBack', true,
  'uncommittedObjectDeleted', true,
  'referencedObjectRetained', true,
  'directImmutableDeleteDenied', true,
  'factFreeVisualDismissalPersisted', true,
  'providerCallsMade', 0
)::text as vitruvius_cover_hardening_migration_rehearsal_receipt;
