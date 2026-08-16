-- Vitruvius Build 160: full five-migration adversarial rehearsal.
--
-- This source is a deterministic composition template, not a directly
-- executable SQL file. Generate the pure-SQL rehearsal only after the frozen
-- migration hashes pass:
--
--   node scripts/migration-static-validation.js --emit-ecos-rehearsal
--
-- The emitter replaces each @apply-frozen-migration line with the exact frozen
-- migration body after removing only its outer BEGIN/COMMIT. The resulting
-- chain runs inside one serializable transaction and is always rolled back.
-- It makes no paid-provider call and performs no deploy or live publication.
-- Execute the emitted file from one uninterrupted database session against the
-- held pre-193726 schema; its pg_temp baseline manifest is session-scoped.

begin;

create temporary table ecos_build160_rehearsal_manifest (
  manifest_key text primary key,
  manifest_value text not null
) on commit preserve rows;

create or replace function pg_temp.ecos_set_request_jwt(
  p_role text,
  p_sub text default null
)
returns void
language plpgsql
set search_path = pg_catalog, pg_temp
as $jwt$
declare
  claims_payload text;
begin
  claims_payload := jsonb_strip_nulls(jsonb_build_object(
    'role', nullif(p_role, ''),
    'sub', nullif(p_sub, '')
  ))::text;
  perform set_config('request.jwt.claim.role', coalesce(p_role, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(p_sub, ''), true);
  perform set_config('request.jwt.claim', claims_payload, true);
  perform set_config('request.jwt.claims', claims_payload, true);
end;
$jwt$;

create or replace function pg_temp.ecos_build160_manifest_snapshot()
returns table(manifest_key text, manifest_value text)
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $manifest$
declare
  relation_name text;
  relation_digest text;
begin
  foreach relation_name in array array[
    'public.organizations',
    'public.organization_memberships',
    'public.projects',
    'public.schedule_items',
    'public.project_updates',
    'public.reference_documents',
    'public.ecos_document_pages',
    'public.ecos_document_chunks',
    'public.ecos_hosted_index_configuration',
    'public.ecos_hosted_index_jobs',
    'public.ecos_hosted_index_pages',
    'public.ecos_hosted_shadow_chunks',
    'public.ecos_hosted_document_pages',
    'public.ecos_hosted_document_chunks',
    'public.ecos_hosted_visual_exceptions',
    'public.ecos_hosted_shadow_materialization_queue',
    'public.ecos_hosted_index_usage',
    'public.ecos_drawing_analysis_requests',
    'public.ecos_drawing_provider_attempts'
  ] loop
    if to_regclass(relation_name) is null then
      relation_digest := '<absent>';
    else
      execute format(
        $sql$
          select count(*)::text || ':' || md5(coalesce(
            string_agg(row_digest, '' order by row_digest),
            ''
          ))
          from (
            select md5(to_jsonb(source_row)::text) as row_digest
            from %s source_row
          ) canonical_rows
        $sql$,
        relation_name
      ) into relation_digest;
    end if;
    manifest_key := 'data:' || relation_name;
    manifest_value := relation_digest;
    return next;
  end loop;

  return query
  with definitions as (
    select concat_ws('|',
      namespace.nspname,
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid),
      procedure.prokind,
      procedure.prosecdef,
      procedure.provolatile,
      procedure.proacl::text,
      procedure.proowner::regrole::text,
      pg_get_functiondef(procedure.oid)
    ) as row_value
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'app_private')
      and (procedure.proname like 'ecos_%' or procedure.proname like 'dave_%')
      and procedure.prokind in ('f', 'p')
  )
  select 'catalog:functions',
    count(*)::text || ':' || md5(coalesce(
      string_agg(row_value, E'\n' order by row_value), ''
    ))
  from definitions;

  return query
  with definitions as (
    select jsonb_build_object(
      'schema', namespace.nspname,
      'relation', relation.relname,
      'kind', relation.relkind,
      'owner', relation.relowner::regrole::text,
      'acl', relation.relacl::text,
      'rls', relation.relrowsecurity,
      'forceRls', relation.relforcerowsecurity
    )::text as row_value
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'app_private')
      and relation.relname = any(array[
        'projects', 'schedule_items', 'project_updates', 'reference_documents',
        'ecos_document_pages', 'ecos_document_chunks',
        'ecos_hosted_index_configuration', 'ecos_hosted_index_jobs',
        'ecos_hosted_index_pages', 'ecos_hosted_shadow_chunks',
        'ecos_hosted_document_pages', 'ecos_hosted_document_chunks',
        'ecos_hosted_visual_exceptions',
        'ecos_hosted_shadow_materialization_queue', 'ecos_hosted_index_usage',
        'ecos_drawing_analysis_requests', 'ecos_drawing_provider_attempts'
      ])
  )
  select 'catalog:relations',
    count(*)::text || ':' || md5(coalesce(
      string_agg(row_value, E'\n' order by row_value), ''
    ))
  from definitions;

  return query
  with definitions as (
    select jsonb_build_object(
      'schema', namespace.nspname,
      'relation', relation.relname,
      'column', attribute.attname,
      'number', attribute.attnum,
      'type', format_type(attribute.atttypid, attribute.atttypmod),
      'notNull', attribute.attnotnull,
      'identity', attribute.attidentity,
      'generated', attribute.attgenerated,
      'default', pg_get_expr(default_value.adbin, default_value.adrelid)
    )::text as row_value
    from pg_attribute attribute
    join pg_class relation on relation.oid = attribute.attrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    left join pg_attrdef default_value
      on default_value.adrelid = relation.oid
     and default_value.adnum = attribute.attnum
    where namespace.nspname in ('public', 'app_private')
      and attribute.attnum > 0
      and not attribute.attisdropped
      and relation.relname = any(array[
        'projects', 'schedule_items', 'project_updates', 'reference_documents',
        'ecos_document_pages', 'ecos_document_chunks',
        'ecos_hosted_index_configuration', 'ecos_hosted_index_jobs',
        'ecos_hosted_index_pages', 'ecos_hosted_shadow_chunks',
        'ecos_hosted_document_pages', 'ecos_hosted_document_chunks',
        'ecos_hosted_visual_exceptions',
        'ecos_hosted_shadow_materialization_queue', 'ecos_hosted_index_usage',
        'ecos_drawing_analysis_requests', 'ecos_drawing_provider_attempts'
      ])
  )
  select 'catalog:columns',
    count(*)::text || ':' || md5(coalesce(
      string_agg(row_value, E'\n' order by row_value), ''
    ))
  from definitions;

  return query
  with definitions as (
    select concat_ws('|',
      namespace.nspname,
      relation.relname,
      constraint_record.conname,
      constraint_record.contype,
      pg_get_constraintdef(constraint_record.oid, true)
    ) as row_value
    from pg_constraint constraint_record
    join pg_class relation on relation.oid = constraint_record.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'app_private')
      and (relation.relname like 'ecos_%'
        or relation.relname in ('schedule_items', 'project_updates', 'reference_documents'))
  )
  select 'catalog:constraints',
    count(*)::text || ':' || md5(coalesce(
      string_agg(row_value, E'\n' order by row_value), ''
    ))
  from definitions;

  return query
  with definitions as (
    select concat_ws('|',
      schemaname, tablename, indexname, indexdef
    ) as row_value
    from pg_indexes
    where schemaname in ('public', 'app_private')
      and (tablename like 'ecos_%'
        or tablename in ('schedule_items', 'project_updates', 'reference_documents'))
  )
  select 'catalog:indexes',
    count(*)::text || ':' || md5(coalesce(
      string_agg(row_value, E'\n' order by row_value), ''
    ))
  from definitions;

  return query
  with definitions as (
    select concat_ws('|',
      namespace.nspname,
      relation.relname,
      trigger_record.tgname,
      trigger_record.tgenabled,
      pg_get_triggerdef(trigger_record.oid, true)
    ) as row_value
    from pg_trigger trigger_record
    join pg_class relation on relation.oid = trigger_record.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where not trigger_record.tgisinternal
      and namespace.nspname = 'public'
      and (relation.relname like 'ecos_%'
        or relation.relname in ('schedule_items', 'project_updates', 'reference_documents'))
  )
  select 'catalog:triggers',
    count(*)::text || ':' || md5(coalesce(
      string_agg(row_value, E'\n' order by row_value), ''
    ))
  from definitions;

  return query
  with definitions as (
    select concat_ws('|',
      schemaname, tablename, policyname, permissive, roles::text,
      cmd, qual, with_check
    ) as row_value
    from pg_policies
    where schemaname = 'public'
      and (tablename like 'ecos_%'
        or tablename in ('schedule_items', 'project_updates', 'reference_documents'))
  )
  select 'catalog:policies',
    count(*)::text || ':' || md5(coalesce(
      string_agg(row_value, E'\n' order by row_value), ''
    ))
  from definitions;

  return query
  select 'catalog:pgcrypto', coalesce(
    (select extension.extversion || ':' || namespace.nspname
     from pg_extension extension
     join pg_namespace namespace on namespace.oid = extension.extnamespace
     where extension.extname = 'pgcrypto'),
    '<absent>'
  );

  for relation_name in
    select format('%I.%I', namespace.nspname, relation.relname)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where relation.relkind = 'S'
      and namespace.nspname in ('public', 'app_private')
      and relation.relname like 'ecos_%'
    order by namespace.nspname, relation.relname
  loop
    execute format(
      'select last_value::text || '':'' || is_called::text from %s',
      relation_name
    ) into relation_digest;
    manifest_key := 'sequence:' || relation_name;
    manifest_value := relation_digest;
    return next;
  end loop;

  if to_regclass('supabase_migrations.schema_migrations') is null then
    return query select 'catalog:migration_history', '<absent>';
  else
    execute $sql$
      select count(*)::text || ':' || md5(coalesce(
        string_agg(row_digest, '' order by row_digest), ''
      ))
      from (
        select md5(to_jsonb(history_row)::text) as row_digest
        from supabase_migrations.schema_migrations history_row
      ) history_rows
    $sql$ into relation_digest;
    return query select 'catalog:migration_history', relation_digest;
  end if;
end;
$manifest$;

insert into ecos_build160_rehearsal_manifest (manifest_key, manifest_value)
select snapshot.manifest_key, snapshot.manifest_value
from pg_temp.ecos_build160_manifest_snapshot() snapshot;

commit;

begin isolation level serializable;

do $ecos_rehearsal_precondition$
declare
  required_versions constant text[] := array[
    '20260809193726',
    '20260809195802',
    '20260809201435',
    '20260809222329',
    '20260810013000'
  ];
  present_versions text[];
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('schedule_items', 'project_updates')
      and column_name = 'project_id'
  )
      or to_regclass('public.ecos_drawing_analysis_requests') is not null
      or to_regclass('public.ecos_drawing_provider_attempts') is not null
      or to_regprocedure(
        'public.ecos_guard_reference_document_authority_keys()'
      ) is not null then
    raise exception
      'ECOS_REHEARSAL_PRECONDITION_FAIL: frozen Build 160 chain is already present';
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    select array_agg(migration.version order by migration.version)
    into present_versions
    from supabase_migrations.schema_migrations migration
    where migration.version >= required_versions[1];
    if present_versions is not null then
      raise exception
        'ECOS_REHEARSAL_PRECONDITION_FAIL: unexpected migration suffix is already recorded: %',
        present_versions::text;
    end if;
  end if;
end;
$ecos_rehearsal_precondition$;

do $ecos_stage_193726$
declare
  fixture_owner uuid;
  fixture_org text := '__ecos-build160-rehearsal-org';
  no_config_org text := '__ecos-build160-rehearsal-no-config';
  activation_updated_at timestamptz;
begin
  select principal.user_id
  into fixture_owner
  from app_private.dave_app_owner principal
  where principal.singleton;
  if fixture_owner is null then
    raise exception 'ECOS_REHEARSAL_PRECONDITION_FAIL: app owner is unavailable';
  end if;
  if exists (
    select 1 from public.organizations organization_record
    where organization_record.id in (fixture_org, no_config_org)
  ) or exists (
    select 1 from public.projects project_record
    where project_record.id in (
      '16000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000002'::uuid,
      '16000000-0000-4000-8000-000000000003'::uuid
    )
  ) or exists (
    select 1 from public.reference_documents source
    where source.id like '__ecos-build160-%'
  ) or exists (
    select 1 from public.schedule_items operational_row
    where operational_row.id like '__ecos-build160-%'
  ) or exists (
    select 1 from public.project_updates operational_row
    where operational_row.id like '__ecos-build160-%'
  ) or exists (
    select 1 from public.ecos_hosted_index_jobs job
    where job.id::text like '16000000-0000-4000-8000-%'
  ) then
    raise exception
      'ECOS_REHEARSAL_PRECONDITION_FAIL: a deterministic fixture identity already exists';
  end if;

  perform set_config('app.ecos_rehearsal_owner', fixture_owner::text, true);
  perform set_config('app.ecos_rehearsal_org', fixture_org, true);
  perform set_config('app.ecos_rehearsal_no_config_org', no_config_org, true);
  perform set_config(
    'app.ecos_rehearsal_unique_project',
    '16000000-0000-4000-8000-000000000001',
    true
  );
  perform set_config(
    'app.ecos_rehearsal_duplicate_a',
    '16000000-0000-4000-8000-000000000002',
    true
  );
  perform set_config(
    'app.ecos_rehearsal_duplicate_b',
    '16000000-0000-4000-8000-000000000003',
    true
  );

  insert into public.organizations (id, name) values
    (fixture_org, 'ECOS Build 160 rehearsal'),
    (no_config_org, 'ECOS Build 160 no-config rehearsal');
  insert into public.organization_memberships (
    user_id, organization_id, status, role
  ) values
    (fixture_owner, fixture_org, 'active', 'organization_admin'),
    (fixture_owner, no_config_org, 'active', 'organization_admin');

  insert into public.projects (id, name, status, archived, owner_id) values
    (
      '16000000-0000-4000-8000-000000000001',
      '  Build 160   Unique Project  ',
      'Active',
      false,
      fixture_owner
    ),
    (
      '16000000-0000-4000-8000-000000000002',
      'Build 160 Shared Name',
      'Active',
      false,
      fixture_owner
    ),
    (
      '16000000-0000-4000-8000-000000000003',
      ' build 160   shared name ',
      'Active',
      false,
      fixture_owner
    );

  insert into public.ecos_hosted_index_configuration (
    organization_id, publication_mode, enabled, updated_by, updated_at
  ) values (
    fixture_org, 'shadow', false, fixture_owner, clock_timestamp()
  );

  insert into public.reference_documents (
    id, name, category, document_data, owner_id, created_at, updated_at
  ) values (
    '__ecos-build160-live-visual-document',
    'Build 160 live visual drawing',
    'Drawing',
    jsonb_build_object(
      'id', '__ecos-build160-live-visual-document',
      'name', 'Build 160 live visual drawing',
      'category', 'Drawing',
      'projectId', '16000000-0000-4000-8000-000000000001',
      'projectName', 'Build 160 Unique Project',
      'contentSha256', repeat('b', 64),
      'drawingRevision', 'V1',
      'drawingNumber', 'V-160',
      'isCurrent', false,
      'drawingStatus', 'For Construction',
      'sourcePageCount', '1',
      'storagePath', '__ecos-tests__/live-visual.pdf'
    ),
    fixture_owner,
    clock_timestamp(),
    clock_timestamp()
  );
  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, source_scan_status, source_scan_engine,
    source_scan_at, target_evidence_version, requested_by,
    created_at, updated_at
  ) values (
    '16000000-0000-4000-8000-000000000050',
    fixture_org,
    '16000000-0000-4000-8000-000000000001',
    '__ecos-build160-live-visual-document',
    fixture_owner,
    'managed_upload',
    '{}'::jsonb,
    repeat('b', 64),
    1,
    'V1',
    'live',
    'queued',
    'clean',
    'rehearsal',
    clock_timestamp(),
    'ecos-hosted-evidence/1.3',
    fixture_owner,
    clock_timestamp(),
    clock_timestamp()
  );
  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count
  ) values (
    '16000000-0000-4000-8000-000000000050',
    fixture_org,
    '16000000-0000-4000-8000-000000000001',
    '__ecos-build160-live-visual-document',
    1,
    repeat('b', 64),
    'assured',
    jsonb_build_object(
      'pageNumber', 1,
      'sheetMappingStatus', 'unverified',
      'text', 'Build 160 exact live visual page',
      'regions', '[]'::jsonb,
      'visualCoverage', jsonb_build_object(
        'status', 'complete',
        'tileCount', 6,
        'receipt', 'build160-live-visual-exact',
        'sourceSha256', repeat('b', 64),
        'evidenceVersion', 'ecos-hosted-evidence/1.3',
        'pageNumber', 1
      )
    ),
    jsonb_build_object(
      'accepted', true,
      'schemaVersion', '1.0',
      'evidenceVersion', 'ecos-hosted-evidence/1.3',
      'checks', jsonb_build_object('sheetMappingUsable', false)
    ),
    0
  );
  insert into public.ecos_hosted_document_pages (
    organization_id, project_id, document_id, page_number, source_sha256,
    evidence_version, sheet_mapping_status, page_text, regions,
    assurance_result
  ) values (
    fixture_org,
    '16000000-0000-4000-8000-000000000001',
    '__ecos-build160-live-visual-document',
    1,
    repeat('b', 64),
    'ecos-hosted-evidence/1.3',
    'unverified',
    'Build 160 exact live visual page',
    '[]'::jsonb,
    jsonb_build_object(
      'accepted', true,
      'schemaVersion', '1.0',
      'evidenceVersion', 'ecos-hosted-evidence/1.3',
      'checks', jsonb_build_object('sheetMappingUsable', false)
    )
  );
  update public.ecos_hosted_index_configuration
  set publication_mode = 'live',
      enabled = true,
      updated_at = clock_timestamp()
  where organization_id = fixture_org;

  perform pg_temp.ecos_set_request_jwt('service_role', fixture_owner::text);
  update public.ecos_hosted_index_jobs
  set state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = '16000000-0000-4000-8000-000000000050';

  select source.updated_at into activation_updated_at
  from public.reference_documents source
  where source.id = '__ecos-build160-live-visual-document'
    and source.owner_id = fixture_owner;
  perform public.ecos_activate_current_reference_document(
    '__ecos-build160-live-visual-document',
    activation_updated_at
  );

  update public.ecos_hosted_index_configuration
  set publication_mode = 'shadow',
      enabled = false,
      updated_at = clock_timestamp()
  where organization_id = fixture_org;

  perform pg_temp.ecos_set_request_jwt('', null);

  if not exists (
    select 1 from public.reference_documents source
    where source.id = '__ecos-build160-live-visual-document'
      and source.owner_id = fixture_owner
      and source.document_data->>'isCurrent' = 'true'
  ) then
    raise exception 'ECOS_REHEARSAL_PRECONDITION_FAIL: live visual fixture was not atomically activated';
  end if;

  perform set_config(
    'app.ecos_rehearsal_live_visual_document',
    '__ecos-build160-live-visual-document',
    true
  );
  perform set_config(
    'app.ecos_rehearsal_live_visual_job',
    '16000000-0000-4000-8000-000000000050',
    true
  );

  insert into public.schedule_items (
    id, owner_id, project_name, task_name, item_data, updated_at
  ) values
    (
      '__ecos-build160-schedule-unique',
      fixture_owner,
      'build 160 unique   project',
      'Unique backfill',
      jsonb_build_object(
        'id', '__ecos-build160-schedule-unique',
        'projectId', '16000000-0000-4000-8000-000000000001',
        'projectName', 'build 160 unique   project',
        'taskName', 'Unique backfill'
      ),
      clock_timestamp()
    ),
    (
      '__ecos-build160-schedule-ambiguous',
      fixture_owner,
      'Build 160 Shared Name',
      'Ambiguous backfill',
      jsonb_build_object(
        'id', '__ecos-build160-schedule-ambiguous',
        'projectName', 'Build 160 Shared Name',
        'taskName', 'Ambiguous backfill'
      ),
      clock_timestamp()
    ),
    (
      '__ecos-build160-schedule-name-only',
      fixture_owner,
      'Build 160 Unique Project',
      'Name-only quarantine',
      jsonb_build_object(
        'id', '__ecos-build160-schedule-name-only',
        'projectName', 'Build 160 Unique Project',
        'taskName', 'Name-only quarantine'
      ),
      clock_timestamp()
    );

  insert into public.project_updates (
    id, owner_id, project_name, area_name, idempotency_key,
    update_data, updated_at
  ) values
    (
      '__ecos-build160-update-unique',
      fixture_owner,
      ' BUILD 160 UNIQUE PROJECT ',
      '',
      '__ecos-build160-update-unique',
      jsonb_build_object(
        'id', '__ecos-build160-update-unique',
        'projectId', '16000000-0000-4000-8000-000000000001',
        'projectName', ' BUILD 160 UNIQUE PROJECT '
      ),
      clock_timestamp()
    ),
    (
      '__ecos-build160-update-ambiguous',
      fixture_owner,
      'Build 160 Shared Name',
      '',
      '__ecos-build160-update-ambiguous',
      jsonb_build_object(
        'id', '__ecos-build160-update-ambiguous',
        'projectName', 'Build 160 Shared Name'
      ),
      clock_timestamp()
    ),
    (
      '__ecos-build160-update-name-only',
      fixture_owner,
      'Build 160 Unique Project',
      '',
      '__ecos-build160-update-name-only',
      jsonb_build_object(
        'id', '__ecos-build160-update-name-only',
        'projectName', 'Build 160 Unique Project'
      ),
      clock_timestamp()
    );
end;
$ecos_stage_193726$;

-- @apply-frozen-migration 20260809193726

do $ecos_assert_193726$
declare
  unique_project text := current_setting('app.ecos_rehearsal_unique_project');
  duplicate_a text := current_setting('app.ecos_rehearsal_duplicate_a');
  duplicate_b text := current_setting('app.ecos_rehearsal_duplicate_b');
  caught_expected boolean;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'schedule_items'
      and column_name = 'project_id'
      and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project_updates'
      and column_name = 'project_id'
      and data_type = 'text'
  ) then
    raise exception 'ECOS_193726_FAIL: immutable project columns are missing';
  end if;

  if not exists (
    select 1 from public.schedule_items row_record
    where row_record.id = '__ecos-build160-schedule-unique'
      and row_record.project_id = unique_project
      and row_record.item_data->>'projectId' = unique_project
  ) or not exists (
    select 1 from public.project_updates row_record
    where row_record.id = '__ecos-build160-update-unique'
      and row_record.project_id = unique_project
      and row_record.update_data->>'projectId' = unique_project
  ) then
    raise exception 'ECOS_193726_FAIL: immutable payload ids did not backfill exactly';
  end if;

  if exists (
    select 1 from public.schedule_items row_record
    where row_record.id in (
      '__ecos-build160-schedule-ambiguous',
      '__ecos-build160-schedule-name-only'
    )
      and (row_record.project_id is not null or row_record.item_data ? 'projectId')
  ) or exists (
    select 1 from public.project_updates row_record
    where row_record.id in (
      '__ecos-build160-update-ambiguous',
      '__ecos-build160-update-name-only'
    )
      and (row_record.project_id is not null or row_record.update_data ? 'projectId')
  ) then
    raise exception 'ECOS_193726_FAIL: name-only evidence was guessed';
  end if;

  update public.projects
  set archived = true
  where id = duplicate_b::uuid;
  caught_expected := false;
  begin
    update public.schedule_items
    set item_data = item_data || jsonb_build_object('notes', 'must stay quarantined')
    where id = '__ecos-build160-schedule-ambiguous';
  exception when check_violation then
    if sqlerrm = 'ecos_operational_project_id_required' then
      caught_expected := true;
    else
      raise;
    end if;
  end;
  update public.projects
  set archived = false
  where id = duplicate_b::uuid;
  if not caught_expected then
    raise exception 'ECOS_193726_FAIL: archived sibling rebound name-only evidence';
  end if;

  caught_expected := false;
  begin
    update public.schedule_items
    set project_id = duplicate_a,
        item_data = jsonb_set(item_data, '{projectId}', to_jsonb(duplicate_b), true)
    where id = '__ecos-build160-schedule-unique';
  exception when check_violation then
    if sqlerrm = 'ecos_operational_project_id_mismatch' then
      caught_expected := true;
    else
      raise;
    end if;
  end;
  if not caught_expected then
    raise exception 'ECOS_193726_FAIL: top-level/payload disagreement was accepted';
  end if;

  caught_expected := false;
  begin
    update public.schedule_items
    set project_id = ' ' || unique_project || ' ',
        item_data = jsonb_set(
          item_data,
          '{projectId}',
          to_jsonb(' ' || unique_project || ' '),
          true
        )
    where id = '__ecos-build160-schedule-unique';
  exception when check_violation then
    if sqlerrm = 'ecos_operational_project_id_invalid' then
      caught_expected := true;
    else
      raise;
    end if;
  end;
  if not caught_expected then
    raise exception 'ECOS_193726_FAIL: whitespace-mutated raw project id was accepted';
  end if;

  caught_expected := false;
  begin
    insert into public.project_updates (
      id, owner_id, project_name, area_name, idempotency_key,
      project_id, update_data, updated_at
    ) values (
      '__ecos-build160-update-display-id',
      current_setting('app.ecos_rehearsal_owner')::uuid,
      'Build 160 Unique Project',
      '',
      '__ecos-build160-update-display-id',
      'Build 160 Unique Project',
      jsonb_build_object(
        'id', '__ecos-build160-update-display-id',
        'projectId', 'Build 160 Unique Project'
      ),
      clock_timestamp()
    );
  exception when check_violation then
    if sqlerrm = 'ecos_operational_project_id_invalid' then
      caught_expected := true;
    else
      raise;
    end if;
  end;
  if not caught_expected then
    raise exception 'ECOS_193726_FAIL: display name was accepted as a raw project id';
  end if;

  update public.schedule_items
  set project_id = duplicate_a,
      item_data = jsonb_set(item_data, '{projectId}', to_jsonb(duplicate_a), true)
  where id = '__ecos-build160-schedule-ambiguous';
  if not exists (
    select 1 from public.schedule_items
    where id = '__ecos-build160-schedule-ambiguous'
      and project_id = duplicate_a
      and item_data->>'projectId' = duplicate_a
  ) then
    raise exception 'ECOS_193726_FAIL: exact durable id did not dominate duplicate names';
  end if;

  if to_regprocedure(
    'public.ecos_load_current_hosted_page_context(text,text[],integer[])'
  ) is null
      or has_function_privilege(
        'anon',
        'public.ecos_load_current_hosted_page_context(text,text[],integer[])',
        'execute'
      ) then
    raise exception 'ECOS_193726_FAIL: exact page-context RPC ACL is unsafe';
  end if;
end;
$ecos_assert_193726$;

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_raw_page_context$
declare
  caught_expected boolean := false;
  exact_visual_coverage jsonb;
begin
  begin
    perform * from public.ecos_load_current_hosted_page_context(
      '  Build 160   Unique Project  ',
      array['__ecos-build160-no-document'],
      array[1]
    );
  exception when invalid_parameter_value then
    caught_expected := true;
  end;
  if not caught_expected then
    raise exception 'ECOS_193726_FAIL: display-name page context was accepted';
  end if;

  select context.visual_coverage
  into exact_visual_coverage
  from public.ecos_load_current_hosted_page_context(
    current_setting('app.ecos_rehearsal_unique_project'),
    array[current_setting('app.ecos_rehearsal_live_visual_document')],
    array[1]
  ) context;
  if exact_visual_coverage is distinct from jsonb_build_object(
      'status', 'complete',
      'tileCount', 6,
      'receipt', 'build160-live-visual-exact',
      'sourceSha256', repeat('b', 64),
      'evidenceVersion', 'ecos-hosted-evidence/1.3',
      'pageNumber', 1
    ) then
    raise exception
      'ECOS_193726_FAIL: live page context lost the exact assured visualCoverage receipt';
  end if;
end;
$ecos_assert_raw_page_context$;
reset role;

do $ecos_stage_ambiguous_live_visual$
declare
  fixture_owner uuid := current_setting('app.ecos_rehearsal_owner')::uuid;
  second_org text := current_setting('app.ecos_rehearsal_no_config_org');
  project_id text := current_setting('app.ecos_rehearsal_unique_project');
  document_id text := current_setting('app.ecos_rehearsal_live_visual_document');
  second_job uuid := '16000000-0000-4000-8000-000000000051';
begin
  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, source_scan_status, source_scan_engine,
    source_scan_at, target_evidence_version, requested_by,
    created_at, updated_at
  ) values (
    second_job,
    second_org,
    project_id,
    document_id,
    fixture_owner,
    'managed_upload',
    '{}'::jsonb,
    repeat('b', 64),
    1,
    'V1',
    'live',
    'queued',
    'clean',
    'rehearsal',
    clock_timestamp(),
    'ecos-hosted-evidence/1.3',
    fixture_owner,
    clock_timestamp(),
    clock_timestamp()
  );
  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count
  ) values (
    second_job,
    second_org,
    project_id,
    document_id,
    1,
    repeat('b', 64),
    'assured',
    jsonb_build_object(
      'pageNumber', 1,
      'sheetMappingStatus', 'unverified',
      'text', 'Ambiguous second live visual page',
      'regions', '[]'::jsonb,
      'visualCoverage', jsonb_build_object(
        'status', 'complete',
        'tileCount', 6,
        'receipt', 'build160-live-visual-ambiguous-second',
        'sourceSha256', repeat('b', 64),
        'evidenceVersion', 'ecos-hosted-evidence/1.3',
        'pageNumber', 1
      )
    ),
    jsonb_build_object(
      'accepted', true,
      'schemaVersion', '1.0',
      'evidenceVersion', 'ecos-hosted-evidence/1.3',
      'checks', jsonb_build_object('sheetMappingUsable', false)
    ),
    0
  );
  insert into public.ecos_hosted_document_pages (
    organization_id, project_id, document_id, page_number, source_sha256,
    evidence_version, sheet_mapping_status, page_text, regions,
    assurance_result
  ) values (
    second_org,
    project_id,
    document_id,
    1,
    repeat('b', 64),
    'ecos-hosted-evidence/1.3',
    'unverified',
    'Ambiguous second live visual page',
    '[]'::jsonb,
    jsonb_build_object(
      'accepted', true,
      'schemaVersion', '1.0',
      'evidenceVersion', 'ecos-hosted-evidence/1.3',
      'checks', jsonb_build_object('sheetMappingUsable', false)
    )
  );
  update public.ecos_hosted_index_jobs
  set state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = second_job;
end;
$ecos_stage_ambiguous_live_visual$;

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_ambiguous_live_visual_denial$
declare
  visible_count integer;
begin
  select count(*) into visible_count
  from public.ecos_load_current_hosted_page_context(
    current_setting('app.ecos_rehearsal_unique_project'),
    array[current_setting('app.ecos_rehearsal_live_visual_document')],
    array[1]
  );
  if visible_count <> 0 then
    raise exception
      'ECOS_193726_FAIL: ambiguous dual-organization exact live jobs returned a visual receipt';
  end if;
end;
$ecos_assert_ambiguous_live_visual_denial$;
reset role;

do $ecos_stage_ambiguous_shadow_visual$
declare
  fixture_owner uuid := current_setting('app.ecos_rehearsal_owner')::uuid;
  first_org text := current_setting('app.ecos_rehearsal_org');
  second_org text := current_setting('app.ecos_rehearsal_no_config_org');
  project_id text := current_setting('app.ecos_rehearsal_unique_project');
  document_id text := '__ecos-build160-shadow-ambiguous-document';
  first_job uuid := '16000000-0000-4000-8000-000000000052';
  second_job uuid := '16000000-0000-4000-8000-000000000053';
  source_sha text := repeat('c', 64);
  activation_updated_at timestamptz;
begin
  insert into public.reference_documents (
    id, name, category, document_data, owner_id, created_at, updated_at
  ) values (
    document_id,
    'Build 160 ambiguous shadow drawing',
    'Drawing',
    jsonb_build_object(
      'id', document_id,
      'name', 'Build 160 ambiguous shadow drawing',
      'category', 'Drawing',
      'projectId', project_id,
      'projectName', 'Build 160 Unique Project',
      'contentSha256', source_sha,
      'drawingRevision', 'S1',
      'drawingNumber', 'S-160',
      'isCurrent', false,
      'drawingStatus', 'For Construction',
      'sourcePageCount', '1',
      'storagePath', '__ecos-tests__/ambiguous-shadow.pdf'
    ),
    fixture_owner,
    clock_timestamp(),
    clock_timestamp()
  );

  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, source_scan_status, source_scan_engine,
    source_scan_at, target_evidence_version, requested_by,
    created_at, updated_at
  ) values
    (
      first_job, first_org, project_id, document_id, fixture_owner,
      'managed_upload', '{}'::jsonb, source_sha, 1,
      'S1', 'shadow', 'queued', 'clean', 'rehearsal',
      clock_timestamp(), 'ecos-hosted-evidence/1.3', fixture_owner,
      clock_timestamp(), clock_timestamp()
    ),
    (
      second_job, second_org, project_id, document_id, fixture_owner,
      'managed_upload', '{}'::jsonb, source_sha, 1,
      'S1', 'shadow', 'queued', 'clean', 'rehearsal',
      clock_timestamp(), 'ecos-hosted-evidence/1.3', fixture_owner,
      clock_timestamp(), clock_timestamp()
    );

  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count
  ) values
    (
      first_job, first_org, project_id, document_id, 1, source_sha,
      'assured',
      jsonb_build_object(
        'pageNumber', 1,
        'sourceSha256', source_sha,
        'sheetMappingStatus', 'unverified',
        'text', 'Ambiguous first shadow page',
        'regions', '[]'::jsonb,
        'visualCoverage', jsonb_build_object(
          'status', 'complete',
          'receipt', 'build160-shadow-exact-first',
          'sourceSha256', source_sha,
          'evidenceVersion', 'ecos-hosted-evidence/1.3',
          'pageNumber', 1
        )
      ),
      jsonb_build_object(
        'accepted', true,
        'schemaVersion', '1.0',
        'evidenceVersion', 'ecos-hosted-evidence/1.3',
        'checks', jsonb_build_object('sheetMappingUsable', false)
      ),
      0
    ),
    (
      second_job, second_org, project_id, document_id, 1, source_sha,
      'assured',
      jsonb_build_object(
        'pageNumber', 1,
        'sourceSha256', source_sha,
        'sheetMappingStatus', 'unverified',
        'text', 'Ambiguous second shadow page',
        'regions', '[]'::jsonb,
        'visualCoverage', jsonb_build_object(
          'status', 'complete',
          'receipt', 'build160-shadow-ambiguous-second',
          'sourceSha256', source_sha,
          'evidenceVersion', 'ecos-hosted-evidence/1.3',
          'pageNumber', 1
        )
      ),
      jsonb_build_object(
        'accepted', true,
        'schemaVersion', '1.0',
        'evidenceVersion', 'ecos-hosted-evidence/1.3',
        'checks', jsonb_build_object('sheetMappingUsable', false)
      ),
      0
    );

  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, metadata
  ) values
    (
      first_job, first_org, project_id, document_id, source_sha,
      1, 'shadow-page-text', 0, 'Ambiguous first shadow page',
      jsonb_build_object(
        'materialization', 'shadow_page_text',
        'searchable', true,
        'structuredSearchContract', 'complete-relationship-only-v1'
      )
    ),
    (
      second_job, second_org, project_id, document_id, source_sha,
      1, 'shadow-page-text', 0, 'Ambiguous second shadow page',
      jsonb_build_object(
        'materialization', 'shadow_page_text',
        'searchable', true,
        'structuredSearchContract', 'complete-relationship-only-v1'
      )
    );

  delete from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id in (first_job, second_job);

  update public.ecos_hosted_index_jobs
  set state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = first_job;

  -- Enable publication only after the fixed-id jobs are fully staged. This
  -- avoids invoking the normal enqueue trigger and therefore avoids consuming
  -- any non-transactional sequence value during the rollback rehearsal.
  insert into public.ecos_hosted_index_configuration (
    organization_id, publication_mode, enabled, updated_by, updated_at
  ) values (
    second_org, 'live', true, fixture_owner, clock_timestamp()
  );
  update public.ecos_hosted_index_configuration
  set publication_mode = 'live',
      enabled = true,
      updated_by = fixture_owner,
      updated_at = clock_timestamp()
  where organization_id = first_org;

  perform pg_temp.ecos_set_request_jwt('service_role', fixture_owner::text);
  select source.updated_at into activation_updated_at
  from public.reference_documents source
  where source.id = document_id and source.owner_id = fixture_owner;
  perform public.ecos_activate_current_reference_document(
    document_id,
    activation_updated_at
  );
  perform pg_temp.ecos_set_request_jwt('', null);

  perform set_config(
    'app.ecos_rehearsal_shadow_ambiguous_document',
    document_id,
    true
  );
end;
$ecos_stage_ambiguous_shadow_visual$;

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_exact_shadow_visual$
declare
  visible_count integer;
  exact_visual_coverage jsonb;
begin
  select count(*), (array_agg(context.visual_coverage))[1]
  into visible_count, exact_visual_coverage
  from public.ecos_load_current_hosted_page_context(
    current_setting('app.ecos_rehearsal_unique_project'),
    array[current_setting('app.ecos_rehearsal_shadow_ambiguous_document')],
    array[1]
  ) context;
  if visible_count <> 1
      or exact_visual_coverage is distinct from jsonb_build_object(
        'status', 'complete',
        'receipt', 'build160-shadow-exact-first',
        'sourceSha256', repeat('c', 64),
        'evidenceVersion', 'ecos-hosted-evidence/1.3',
        'pageNumber', 1
      ) then
    raise exception
      'ECOS_193726_FAIL: exact shadow page lost its bound visual receipt';
  end if;
end;
$ecos_assert_exact_shadow_visual$;
reset role;

do $ecos_assert_shadow_visual_binding_adversaries$
declare
  first_job constant uuid := '16000000-0000-4000-8000-000000000052';
  original_assurance jsonb;
  original_final_page_data jsonb;
  visible_count integer;
begin
  perform pg_temp.ecos_set_request_jwt(
    'authenticated', current_setting('app.ecos_rehearsal_owner')
  );
  select page.assurance_result, page.final_page_data
  into original_assurance, original_final_page_data
  from public.ecos_hosted_index_pages page
  where page.job_id = first_job and page.page_number = 1;

  update public.ecos_hosted_index_pages
  set assurance_result = jsonb_set(
    assurance_result,
    '{evidenceVersion}',
    '"ecos-hosted-evidence/1.2"'::jsonb
  )
  where job_id = first_job and page_number = 1;
  select count(*) into visible_count
  from public.ecos_load_current_hosted_page_context(
    current_setting('app.ecos_rehearsal_unique_project'),
    array[current_setting('app.ecos_rehearsal_shadow_ambiguous_document')],
    array[1]
  );
  if visible_count <> 0 then
    raise exception
      'ECOS_193726_FAIL: shadow assurance evidence version mismatch returned a page receipt';
  end if;
  update public.ecos_hosted_index_pages
  set assurance_result = original_assurance
  where job_id = first_job and page_number = 1;

  update public.ecos_hosted_index_pages
  set final_page_data = jsonb_set(
    final_page_data, '{sourceSha256}', to_jsonb(repeat('d', 64)), false
  )
  where job_id = first_job and page_number = 1;
  select count(*) into visible_count
  from public.ecos_load_current_hosted_page_context(
    current_setting('app.ecos_rehearsal_unique_project'),
    array[current_setting('app.ecos_rehearsal_shadow_ambiguous_document')],
    array[1]
  );
  if visible_count <> 0 then
    raise exception
      'ECOS_193726_FAIL: shadow top-level source checksum mismatch returned a page receipt';
  end if;
  update public.ecos_hosted_index_pages
  set final_page_data = original_final_page_data
  where job_id = first_job and page_number = 1;

  update public.ecos_hosted_index_pages
  set final_page_data = jsonb_set(
    final_page_data,
    '{visualCoverage,sourceSha256}',
    to_jsonb(repeat('d', 64)),
    false
  )
  where job_id = first_job and page_number = 1;
  select count(*) into visible_count
  from public.ecos_load_current_hosted_page_context(
    current_setting('app.ecos_rehearsal_unique_project'),
    array[current_setting('app.ecos_rehearsal_shadow_ambiguous_document')],
    array[1]
  );
  if visible_count <> 0 then
    raise exception
      'ECOS_193726_FAIL: shadow visual source checksum mismatch returned a page receipt';
  end if;
  update public.ecos_hosted_index_pages
  set final_page_data = original_final_page_data
  where job_id = first_job and page_number = 1;

  update public.ecos_hosted_index_pages
  set final_page_data = jsonb_set(
    final_page_data,
    '{visualCoverage,evidenceVersion}',
    '"ecos-hosted-evidence/1.2"'::jsonb,
    false
  )
  where job_id = first_job and page_number = 1;
  select count(*) into visible_count
  from public.ecos_load_current_hosted_page_context(
    current_setting('app.ecos_rehearsal_unique_project'),
    array[current_setting('app.ecos_rehearsal_shadow_ambiguous_document')],
    array[1]
  );
  if visible_count <> 0 then
    raise exception
      'ECOS_193726_FAIL: shadow visual evidence version mismatch returned a page receipt';
  end if;
  update public.ecos_hosted_index_pages
  set final_page_data = original_final_page_data
  where job_id = first_job and page_number = 1;

  update public.ecos_hosted_index_pages
  set final_page_data = jsonb_set(
    final_page_data, '{visualCoverage,pageNumber}', '2'::jsonb, false
  )
  where job_id = first_job and page_number = 1;
  select count(*) into visible_count
  from public.ecos_load_current_hosted_page_context(
    current_setting('app.ecos_rehearsal_unique_project'),
    array[current_setting('app.ecos_rehearsal_shadow_ambiguous_document')],
    array[1]
  );
  if visible_count <> 0 then
    raise exception
      'ECOS_193726_FAIL: shadow visual page number mismatch returned a page receipt';
  end if;
  update public.ecos_hosted_index_pages
  set final_page_data = original_final_page_data
  where job_id = first_job and page_number = 1;
end;
$ecos_assert_shadow_visual_binding_adversaries$;

do $ecos_stage_second_shadow_candidate$
begin
  update public.ecos_hosted_index_jobs
  set state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = '16000000-0000-4000-8000-000000000053'::uuid;
end;
$ecos_stage_second_shadow_candidate$;

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_ambiguous_shadow_visual_denial$
declare
  visible_count integer;
begin
  select count(*) into visible_count
  from public.ecos_load_current_hosted_page_context(
    current_setting('app.ecos_rehearsal_unique_project'),
    array[current_setting('app.ecos_rehearsal_shadow_ambiguous_document')],
    array[1]
  );
  if visible_count <> 0 then
    raise exception
      'ECOS_193726_FAIL: ambiguous dual-organization exact shadow jobs returned a page receipt';
  end if;
end;
$ecos_assert_ambiguous_shadow_visual_denial$;
reset role;

do $ecos_clear_ambiguous_shadow_visual$
declare
  first_org text := current_setting('app.ecos_rehearsal_org');
  second_org text := current_setting('app.ecos_rehearsal_no_config_org');
begin
  delete from public.ecos_hosted_index_jobs
  where id in (
    '16000000-0000-4000-8000-000000000052'::uuid,
    '16000000-0000-4000-8000-000000000053'::uuid
  );
  delete from public.reference_documents
  where id = current_setting('app.ecos_rehearsal_shadow_ambiguous_document');
  delete from public.ecos_hosted_index_configuration
  where organization_id = second_org;
  update public.ecos_hosted_index_configuration
  set publication_mode = 'shadow', enabled = false, updated_at = clock_timestamp()
  where organization_id = first_org;
end;
$ecos_clear_ambiguous_shadow_visual$;

do $ecos_stage_195802$
declare
  old_annotation_evidence jsonb := jsonb_build_array(
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
  old_page jsonb;
  assurance jsonb := jsonb_build_object(
    'accepted', true,
    'checks', jsonb_build_object('sheetMappingUsable', true)
  );
begin
  old_page := jsonb_build_object(
    'pageNumber', 1,
    'sheetNumber', 'C6',
    'sheetMappingStatus', 'verified',
    'sheetMappingSource', 'pdf_annotation_title_band',
    'sheetMappingEvidence', old_annotation_evidence,
    'documentStructuralIdentity', jsonb_build_object(
      'sheetNumber', 'C6',
      'source', 'pdf_annotation_title_band',
      'evidence', old_annotation_evidence
    ),
    'regions', '[]'::jsonb
  );
  if public.ecos_sheet_provenance_payload(old_page, assurance, true) is null then
    raise exception
      'ECOS_195802_FAIL: pre-migration fixture no longer demonstrates the old metadata-only acceptance';
  end if;
end;
$ecos_stage_195802$;

-- @apply-frozen-migration 20260809195802

do $ecos_assert_195802$
declare
  valid_evidence jsonb := jsonb_build_array(
    jsonb_build_object(
      'id', 'pdf-annotation-1-page-1',
      'pageNumber', 1,
      'source', 'pdf_annotation',
      'annotationSubtype', 'Square',
      'text', 'C6',
      'normalizedBounds', jsonb_build_object(
        'x', 0.950, 'y', 0.910, 'width', 0.010, 'height', 0.010
      ),
      'renderedCorroborated', true,
      'renderedCorroboratingRegionIds', jsonb_build_array('ocr-token-1'),
      'renderedCorroboratingSources', jsonb_build_array('title_block_ocr')
    ),
    jsonb_build_object(
      'id', 'pdf-annotation-2-page-1',
      'pageNumber', 1,
      'source', 'pdf_annotation',
      'annotationSubtype', 'Square',
      'text', 'SHEET NO.',
      'normalizedBounds', jsonb_build_object(
        'x', 0.949, 'y', 0.895, 'width', 0.012, 'height', 0.010
      ),
      'renderedCorroborated', true,
      'renderedCorroboratingRegionIds', jsonb_build_array('ocr-label-1'),
      'renderedCorroboratingSources',
        jsonb_build_array('fixed_visual_tile_coordinate_ocr')
    )
  );
  valid_page jsonb;
  assurance jsonb := jsonb_build_object(
    'accepted', true,
    'checks', jsonb_build_object('sheetMappingUsable', true)
  );
  canonical jsonb;
begin
  valid_page := jsonb_build_object(
    'pageNumber', 1,
    'sheetNumber', 'C6',
    'sheetMappingStatus', 'verified',
    'sheetMappingSource', 'pdf_annotation_title_band',
    'sheetMappingEvidence', valid_evidence,
    'regions', '[]'::jsonb
  );
  canonical := public.ecos_sheet_provenance_payload(
    valid_page,
    assurance,
    true
  );
  if canonical->>'sheetNumber' is distinct from 'C6'
      or canonical#>>'{sheetMappingEvidence,0,renderedCorroborated}'
        is distinct from 'true'
      or canonical#>>'{sheetMappingEvidence,0,renderedCorroboratingRegionIds,0}'
        is distinct from 'ocr-token-1'
      or canonical#>>'{sheetMappingEvidence,1,renderedCorroboratingSources,0}'
        is distinct from 'fixed_visual_tile_coordinate_ocr' then
    raise exception 'ECOS_195802_FAIL: rendered corroboration was not canonicalized';
  end if;

  if public.ecos_sheet_provenance_payload(
      jsonb_set(valid_page, '{sheetMappingEvidence,0}',
        (valid_evidence->0) - 'renderedCorroborated'),
      assurance,
      true
    ) is not null
      or public.ecos_sheet_provenance_payload(
        jsonb_set(
          valid_page,
          '{sheetMappingEvidence,0,renderedCorroboratingRegionIds}',
          jsonb_build_array('ocr-token-1', 'ocr-token-1')
        ),
        assurance,
        true
      ) is not null
      or public.ecos_sheet_provenance_payload(
        jsonb_set(
          valid_page,
          '{sheetMappingEvidence,0,renderedCorroboratingSources}',
          jsonb_build_array('title_block_ocr', 'title_block_ocr')
        ),
        assurance,
        true
      ) is not null
      or public.ecos_sheet_provenance_payload(
        jsonb_set(
          valid_page,
          '{sheetMappingEvidence,0,renderedCorroboratingSources,0}',
          '"pdf_annotation"'::jsonb
        ),
        assurance,
        true
      ) is not null
      or public.ecos_sheet_provenance_payload(
        jsonb_set(
          valid_page,
          '{sheetMappingEvidence,0,normalizedBounds,x}',
          '0.80'::jsonb
        ),
        assurance,
        true
      ) is not null
      or public.ecos_sheet_provenance_payload(
        valid_page,
        jsonb_set(assurance, '{accepted}', 'false'::jsonb),
        true
      ) is not null then
    raise exception
      'ECOS_195802_FAIL: missing, duplicate, unknown, displaced, or unassured rendered proof was accepted';
  end if;

  if has_function_privilege(
      'authenticated',
      'public.ecos_sheet_provenance_payload(jsonb,jsonb,boolean)',
      'execute'
    ) or has_function_privilege(
      'anon',
      'public.ecos_sheet_provenance_payload(jsonb,jsonb,boolean)',
      'execute'
    ) or not has_function_privilege(
      'service_role',
      'public.ecos_sheet_provenance_payload(jsonb,jsonb,boolean)',
      'execute'
    ) then
    raise exception 'ECOS_195802_FAIL: annotation helper ACL is unsafe';
  end if;
end;
$ecos_assert_195802$;

do $ecos_stage_201435$
declare
  fixture_owner uuid := current_setting('app.ecos_rehearsal_owner')::uuid;
  fixture_org text := current_setting('app.ecos_rehearsal_org');
  project_id text := current_setting('app.ecos_rehearsal_unique_project');
  job_id uuid := '16000000-0000-4000-8000-000000000101';
  claim_token uuid := '16000000-0000-4000-8000-000000000102';
  document_id text := '__ecos-build160-provider-document';
  source_sha text := repeat('a', 64);
begin
  insert into public.ecos_hosted_index_configuration (
    organization_id, publication_mode, enabled, daily_visual_region_limit,
    updated_by, updated_at
  ) values (
    fixture_org, 'shadow', false, 100, fixture_owner, clock_timestamp()
  ) on conflict (organization_id) do update set
    publication_mode = 'shadow',
    enabled = false,
    daily_visual_region_limit = 100,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.reference_documents (
    id, name, category, document_data, owner_id, created_at, updated_at
  ) values (
    document_id,
    'Build 160 provider drawing',
    'Drawing',
    jsonb_build_object(
      'id', document_id,
      'name', 'Build 160 provider drawing',
      'category', 'Drawing',
      'projectId', project_id,
      'projectName', 'Build 160 Unique Project',
      'organizationId', fixture_org,
      'contentSha256', source_sha,
      'drawingRevision', 'A',
      'drawingNumber', 'A-160',
      'isCurrent', false,
      'drawingStatus', 'For Review',
      'sourcePageCount', '1',
      'storagePath', '__ecos-tests__/build160-provider.pdf'
    ),
    fixture_owner,
    clock_timestamp(),
    clock_timestamp()
  );

  update public.ecos_hosted_index_configuration
  set enabled = true, updated_at = clock_timestamp()
  where organization_id = fixture_org;

  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, source_scan_status, source_scan_engine,
    source_scan_at, target_evidence_version, claimed_by, claim_token,
    lease_expires_at, requested_by, created_at, updated_at
  ) values (
    job_id, fixture_org, project_id, document_id, fixture_owner,
    'managed_upload', '{}'::jsonb, source_sha, 1,
    'A', 'shadow', 'awaiting_visual', 'clean', 'rehearsal',
    clock_timestamp(), 'ecos-hosted-evidence/1.3', 'build160-rehearsal',
    claim_token, clock_timestamp() + interval '1 hour', fixture_owner,
    clock_timestamp(), clock_timestamp()
  );

  insert into public.ecos_hosted_index_usage (
    id, organization_id, project_id, document_id, job_id, event_type,
    idempotency_key, quantity, duration_ms, estimated_cost_microusd,
    details, created_at
  ) overriding system value
  select
    -16000 - fixture.ordinality,
    fixture_org,
    project_id,
    document_id,
    job_id,
    'visual_region_reserved',
    'visual:v2:ecos-hosted-evidence/1.3:' || fixture.fingerprint || ':' ||
      claim_token::text || ':1:' || fixture.region_key,
    1,
    0,
    0,
    jsonb_build_object(
      'pageNumber', 1,
      'regionKey', fixture.region_key,
      'evidenceVersion', 'ecos-hosted-evidence/1.3',
      'exceptionFingerprint', fixture.fingerprint,
      'providerAttempt', 'exact_visual_exception_v2'
    ),
    clock_timestamp()
  from (
    values
      (1, repeat('1', 64), 'low-confidence-ocr-1-1'),
      (2, repeat('2', 64), 'low-confidence-ocr-1-2'),
      (3, repeat('3', 64), 'low-confidence-ocr-1-3'),
      (4, repeat('4', 64), 'low-confidence-ocr-1-4')
  ) fixture(ordinality, fingerprint, region_key);

  perform set_config('app.ecos_rehearsal_provider_job', job_id::text, true);
  perform set_config('app.ecos_rehearsal_provider_claim', claim_token::text, true);
  perform set_config('app.ecos_rehearsal_provider_document', document_id, true);
  perform set_config('app.ecos_rehearsal_provider_sha', source_sha, true);
end;
$ecos_stage_201435$;

-- @apply-frozen-migration 20260809201435

do $ecos_assert_201435_catalog$
declare
  golden text;
begin
  select public.ecos_visual_provider_operation_id_v1(
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
  ) into golden;
  if golden <> '8cb03b0dda19df38df3018f308da0f33cfd1aae77f0af36c0e8b6cf3431e3ea9' then
    raise exception 'ECOS_201435_FAIL: provider golden vector mismatch';
  end if;
  if (
    select count(*)
    from pg_class relation
    where relation.oid in (
      'public.ecos_drawing_analysis_requests'::regclass,
      'public.ecos_drawing_provider_attempts'::regclass
    )
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) <> 2 or exists (
    select 1 from pg_policy policy
    where policy.polrelid in (
      'public.ecos_drawing_analysis_requests'::regclass,
      'public.ecos_drawing_provider_attempts'::regclass
    )
  ) then
    raise exception 'ECOS_201435_FAIL: provider ledger RLS or policy state is unsafe';
  end if;
  if exists (
    select 1
    from unnest(array[
      'anon', 'authenticated', 'service_role'
    ]) as role_name(value)
    cross join unnest(array[
      'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
    ]) as privilege_name(value)
    cross join unnest(array[
      'public.ecos_drawing_analysis_requests',
      'public.ecos_drawing_provider_attempts'
    ]) as ledger_relation(value)
    where has_table_privilege(
      role_name.value, ledger_relation.value, privilege_name.value
    )
  ) then
    raise exception 'ECOS_201435_FAIL: provider ledger has a direct table grant';
  end if;
end;
$ecos_assert_201435_catalog$;

do $ecos_bind_provider_operation_ids$
declare
  fixture_org text := current_setting('app.ecos_rehearsal_org');
  project_id text := current_setting('app.ecos_rehearsal_unique_project');
  job_id uuid := current_setting('app.ecos_rehearsal_provider_job')::uuid;
  claim_token uuid := current_setting('app.ecos_rehearsal_provider_claim')::uuid;
  document_id text := current_setting('app.ecos_rehearsal_provider_document');
  source_sha text := current_setting('app.ecos_rehearsal_provider_sha');
begin
  perform set_config(
    'app.ecos_rehearsal_provider_operation_1',
    public.ecos_visual_provider_operation_id_v1(
      fixture_org, project_id, document_id, source_sha, 1, job_id, claim_token,
      'ecos-hosted-evidence/1.3', repeat('1', 64),
      'low-confidence-ocr-1-1'
    ),
    true
  );
  perform set_config(
    'app.ecos_rehearsal_provider_operation_2',
    public.ecos_visual_provider_operation_id_v1(
      fixture_org, project_id, document_id, source_sha, 1, job_id, claim_token,
      'ecos-hosted-evidence/1.3', repeat('2', 64),
      'low-confidence-ocr-1-2'
    ),
    true
  );
  perform set_config(
    'app.ecos_rehearsal_provider_operation_3',
    public.ecos_visual_provider_operation_id_v1(
      fixture_org, project_id, document_id, source_sha, 1, job_id, claim_token,
      'ecos-hosted-evidence/1.3', repeat('3', 64),
      'low-confidence-ocr-1-3'
    ),
    true
  );
  perform set_config(
    'app.ecos_rehearsal_provider_operation_4',
    public.ecos_visual_provider_operation_id_v1(
      fixture_org, project_id, document_id, source_sha, 1, job_id, claim_token,
      'ecos-hosted-evidence/1.3', repeat('4', 64),
      'low-confidence-ocr-1-4'
    ),
    true
  );
end;
$ecos_bind_provider_operation_ids$;

set local role service_role;
select pg_temp.ecos_set_request_jwt(
  'service_role', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_provider_service_path$
declare
  result jsonb;
  request_id uuid;
  caught_expected boolean := false;
begin
  result := public.ecos_begin_drawing_analysis(
    current_setting('app.ecos_rehearsal_org'),
    current_setting('app.ecos_rehearsal_unique_project'),
    current_setting('app.ecos_rehearsal_provider_document'),
    current_setting('app.ecos_rehearsal_provider_sha'),
    1,
    current_setting('app.ecos_rehearsal_provider_job')::uuid,
    current_setting('app.ecos_rehearsal_provider_claim')::uuid,
    'ecos-hosted-evidence/1.3',
    repeat('1', 64),
    'low-confidence-ocr-1-1',
    current_setting('app.ecos_rehearsal_provider_operation_1'),
    current_setting('app.ecos_rehearsal_provider_operation_1'),
    repeat('f', 64),
    4096
  );
  if result->>'disposition' is distinct from 'started' then
    raise exception 'ECOS_201435_FAIL: exact operation did not start';
  end if;
  request_id := (result->>'requestId')::uuid;
  perform set_config('app.ecos_rehearsal_provider_request_1', request_id::text, true);

  if not public.ecos_reserve_drawing_provider_attempt(
    request_id,
    current_setting('app.ecos_rehearsal_provider_operation_1'),
    'analysis_primary',
    1,
    'openai',
    'rehearsal-model',
    'attempt-1'
  ) then
    raise exception 'ECOS_201435_FAIL: exact paid-attempt reservation failed';
  end if;

  begin
    perform public.ecos_reserve_drawing_provider_attempt(
      request_id,
      current_setting('app.ecos_rehearsal_provider_operation_1'),
      'analysis_primary',
      1,
      'openai',
      'rehearsal-model',
      'attempt-1'
    );
  exception when others then
    if sqlerrm = 'ecos_drawing_provider_attempt_already_reserved' then
      caught_expected := true;
    else
      raise;
    end if;
  end;
  if not caught_expected then
    raise exception 'ECOS_201435_FAIL: provider attempt reservation replayed';
  end if;

  if not public.ecos_finish_drawing_analysis(
    request_id,
    current_setting('app.ecos_rehearsal_provider_operation_1'),
    'completed',
    jsonb_build_object('answer', 'rehearsal'),
    null
  ) then
    raise exception 'ECOS_201435_FAIL: provider request did not finish';
  end if;

  result := public.ecos_begin_drawing_analysis(
    current_setting('app.ecos_rehearsal_org'),
    current_setting('app.ecos_rehearsal_unique_project'),
    current_setting('app.ecos_rehearsal_provider_document'),
    current_setting('app.ecos_rehearsal_provider_sha'),
    1,
    current_setting('app.ecos_rehearsal_provider_job')::uuid,
    current_setting('app.ecos_rehearsal_provider_claim')::uuid,
    'ecos-hosted-evidence/1.3',
    repeat('1', 64),
    'low-confidence-ocr-1-1',
    current_setting('app.ecos_rehearsal_provider_operation_1'),
    current_setting('app.ecos_rehearsal_provider_operation_1'),
    repeat('f', 64),
    4096
  );
  if result->>'disposition' is distinct from 'replay'
      or result#>>'{response,answer}' is distinct from 'rehearsal' then
    raise exception 'ECOS_201435_FAIL: completed exact operation did not replay';
  end if;
end;
$ecos_assert_provider_service_path$;
reset role;

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_provider_authenticated_denial$
declare
  caught_expected boolean := false;
begin
  begin
    perform public.ecos_begin_drawing_analysis(
      current_setting('app.ecos_rehearsal_org'),
      current_setting('app.ecos_rehearsal_unique_project'),
      current_setting('app.ecos_rehearsal_provider_document'),
      current_setting('app.ecos_rehearsal_provider_sha'),
      1,
      current_setting('app.ecos_rehearsal_provider_job')::uuid,
      current_setting('app.ecos_rehearsal_provider_claim')::uuid,
      'ecos-hosted-evidence/1.3',
      repeat('1', 64),
      'low-confidence-ocr-1-1',
      current_setting('app.ecos_rehearsal_provider_operation_1'),
      current_setting('app.ecos_rehearsal_provider_operation_1'),
      repeat('f', 64),
      4096
    );
  exception when insufficient_privilege then
    caught_expected := true;
  end;
  if not caught_expected then
    raise exception 'ECOS_201435_FAIL: authenticated role reached provider ledger RPC';
  end if;
end;
$ecos_assert_provider_authenticated_denial$;
reset role;

set local role service_role;
select pg_temp.ecos_set_request_jwt(
  'service_role', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_provider_quota_and_conflict$
declare
  result jsonb;
  operation_id text;
  fingerprint text;
  region_key text;
  ordinal integer;
  caught_expected boolean;
begin
  foreach ordinal in array array[2, 3] loop
    operation_id := current_setting(
      'app.ecos_rehearsal_provider_operation_' || ordinal::text
    );
    fingerprint := repeat(ordinal::text, 64);
    region_key := 'low-confidence-ocr-1-' || ordinal::text;
    result := public.ecos_begin_drawing_analysis(
      current_setting('app.ecos_rehearsal_org'),
      current_setting('app.ecos_rehearsal_unique_project'),
      current_setting('app.ecos_rehearsal_provider_document'),
      current_setting('app.ecos_rehearsal_provider_sha'),
      1,
      current_setting('app.ecos_rehearsal_provider_job')::uuid,
      current_setting('app.ecos_rehearsal_provider_claim')::uuid,
      'ecos-hosted-evidence/1.3',
      fingerprint,
      region_key,
      operation_id,
      operation_id,
      repeat(ordinal::text, 64),
      4096
    );
    if result->>'disposition' is distinct from 'started' then
      raise exception 'ECOS_201435_FAIL: active quota setup did not start';
    end if;
  end loop;

  caught_expected := false;
  begin
    operation_id := current_setting('app.ecos_rehearsal_provider_operation_4');
    perform public.ecos_begin_drawing_analysis(
      current_setting('app.ecos_rehearsal_org'),
      current_setting('app.ecos_rehearsal_unique_project'),
      current_setting('app.ecos_rehearsal_provider_document'),
      current_setting('app.ecos_rehearsal_provider_sha'),
      1,
      current_setting('app.ecos_rehearsal_provider_job')::uuid,
      current_setting('app.ecos_rehearsal_provider_claim')::uuid,
      'ecos-hosted-evidence/1.3',
      repeat('4', 64),
      'low-confidence-ocr-1-4',
      operation_id,
      operation_id,
      repeat('4', 64),
      4096
    );
  exception when others then
    if sqlerrm = 'active drawing-analysis limit for source owner' then
      caught_expected := true;
    else
      raise;
    end if;
  end;
  if not caught_expected then
    raise exception 'ECOS_201435_FAIL: active owner quota was not atomic';
  end if;

  caught_expected := false;
  begin
    perform public.ecos_begin_drawing_analysis(
      current_setting('app.ecos_rehearsal_org'),
      current_setting('app.ecos_rehearsal_unique_project'),
      current_setting('app.ecos_rehearsal_provider_document'),
      current_setting('app.ecos_rehearsal_provider_sha'),
      1,
      current_setting('app.ecos_rehearsal_provider_job')::uuid,
      current_setting('app.ecos_rehearsal_provider_claim')::uuid,
      'ecos-hosted-evidence/1.3',
      repeat('1', 64),
      'low-confidence-ocr-1-1',
      current_setting('app.ecos_rehearsal_provider_operation_1'),
      current_setting('app.ecos_rehearsal_provider_operation_1'),
      repeat('0', 64),
      4096
    );
  exception when others then
    if sqlerrm = 'ecos_drawing_analysis_idempotency_identity_conflict' then
      caught_expected := true;
    else
      raise;
    end if;
  end;
  if not caught_expected then
    raise exception 'ECOS_201435_FAIL: idempotency identity conflict replayed';
  end if;
end;
$ecos_assert_provider_quota_and_conflict$;
reset role;

do $ecos_stage_222329$
declare
  fixture_owner uuid := current_setting('app.ecos_rehearsal_owner')::uuid;
  fixture_org text := current_setting('app.ecos_rehearsal_org');
  no_config_org text := current_setting('app.ecos_rehearsal_no_config_org');
  unique_project text := current_setting('app.ecos_rehearsal_unique_project');
  duplicate_a text := current_setting('app.ecos_rehearsal_duplicate_a');
  duplicate_b text := current_setting('app.ecos_rehearsal_duplicate_b');
begin
  -- The authority migration is allowed to run only while every organization is
  -- held. This also prevents the project-identity update below from enqueueing.
  update public.ecos_hosted_index_configuration
  set enabled = false, updated_at = clock_timestamp();

  perform set_config('app.ecos_current_activation', 'allowed', true);
  update public.reference_documents
  set document_data = jsonb_set(
        document_data,
        '{projectId}',
        to_jsonb(duplicate_a),
        true
      ),
      updated_at = clock_timestamp()
  where id = current_setting('app.ecos_rehearsal_provider_document')
    and owner_id = fixture_owner;
  perform set_config('app.ecos_current_activation', '', true);

  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count
  ) values (
    current_setting('app.ecos_rehearsal_provider_job')::uuid,
    fixture_org,
    unique_project,
    current_setting('app.ecos_rehearsal_provider_document'),
    1,
    current_setting('app.ecos_rehearsal_provider_sha'),
    'extracted',
    jsonb_build_object('pageNumber', 1, 'sheetMappingStatus', 'unverified'),
    '{}'::jsonb,
    0
  );
  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, metadata
  ) values (
    current_setting('app.ecos_rehearsal_provider_job')::uuid,
    fixture_org,
    unique_project,
    current_setting('app.ecos_rehearsal_provider_document'),
    current_setting('app.ecos_rehearsal_provider_sha'),
    1,
    'provider-graph',
    0,
    'Provider graph purge proof',
    jsonb_build_object(
      'materialization', 'shadow_page_text',
      'searchable', true,
      'structuredSearchContract', 'complete-relationship-only-v1'
    )
  );
  insert into public.ecos_hosted_document_pages (
    organization_id, project_id, document_id, page_number, source_sha256,
    evidence_version, sheet_mapping_status, page_text, regions,
    assurance_result
  ) values (
    fixture_org,
    unique_project,
    current_setting('app.ecos_rehearsal_provider_document'),
    1,
    current_setting('app.ecos_rehearsal_provider_sha'),
    'ecos-hosted-evidence/1.3',
    'unverified',
    'Provider graph public page',
    '[]'::jsonb,
    '{}'::jsonb
  );
  insert into public.ecos_hosted_document_chunks (
    organization_id, project_id, document_id, page_number, region_id,
    chunk_index, chunk_text, metadata
  ) values (
    fixture_org,
    unique_project,
    current_setting('app.ecos_rehearsal_provider_document'),
    1,
    'provider-public-graph',
    0,
    'Provider graph public chunk',
    jsonb_build_object(
      'materialization', 'hosted_region',
      'searchable', true,
      'structuredSearchContract', 'complete-relationship-only-v1'
    )
  );

  -- These rows model legacy pre-migration state, including two already-current
  -- drawings. Fixture setup runs as the controlled database owner and uses the
  -- same narrowly scoped activation marker before the authority migration is
  -- applied; customer-role bypass behavior is tested separately below.
  perform set_config('app.ecos_current_activation', 'allowed', true);
  insert into public.reference_documents (
    id, name, category, document_data, owner_id, created_at, updated_at
  ) values
    (
      '__ecos-build160-legacy-unique',
      'Build 160 legacy unique',
      'Drawing',
      jsonb_build_object(
        'id', '__ecos-build160-legacy-unique',
        'name', 'Build 160 legacy unique',
        'category', 'Drawing',
        'projectName', ' build 160   unique project ',
        'projectNames', jsonb_build_array('BUILD 160 UNIQUE PROJECT'),
        'organizationId', fixture_org,
        'contentSha256', repeat('5', 64),
        'drawingRevision', 'A',
        'isCurrent', true,
        'drawingStatus', 'For Construction',
        'storagePath', '__ecos-tests__/legacy-unique.pdf',
        'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0',
        'ecosVerifiedIndexCommittedSha256', repeat('5', 64),
        'ecosVerifiedIndexCommittedPageCount', 1,
        'ecosHostedIndexStatus', 'Ready for ECOS'
      ),
      fixture_owner,
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      '__ecos-build160-legacy-ambiguous',
      'Build 160 legacy ambiguous',
      'Drawing',
      jsonb_build_object(
        'id', '__ecos-build160-legacy-ambiguous',
        'name', 'Build 160 legacy ambiguous',
        'category', 'Drawing',
        'projectName', 'Build 160 Shared Name',
        'organizationId', fixture_org,
        'contentSha256', repeat('6', 64),
        'drawingRevision', 'A',
        'isCurrent', false,
        'drawingStatus', 'For Review',
        'storagePath', '__ecos-tests__/legacy-ambiguous.pdf',
        'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0'
      ),
      fixture_owner,
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      '__ecos-build160-legacy-multiname',
      'Build 160 legacy multiname',
      'Drawing',
      jsonb_build_object(
        'id', '__ecos-build160-legacy-multiname',
        'name', 'Build 160 legacy multiname',
        'category', 'Drawing',
        'projectName', 'Build 160 Unique Project',
        'projectNames', jsonb_build_array(
          'Build 160 Unique Project', 'Build 160 Shared Name'
        ),
        'organizationId', fixture_org,
        'contentSha256', repeat('7', 64),
        'drawingRevision', 'A',
        'isCurrent', false,
        'drawingStatus', 'For Review',
        'storagePath', '__ecos-tests__/legacy-multiname.pdf',
        'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0'
      ),
      fixture_owner,
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      '__ecos-build160-exact-marker',
      'Build 160 exact marker',
      'Drawing',
      jsonb_build_object(
        'id', '__ecos-build160-exact-marker',
        'name', 'Build 160 exact marker',
        'category', 'Drawing',
        'projectId', unique_project,
        'projectName', 'Build 160 Unique Project',
        'organizationId', fixture_org,
        'contentSha256', repeat('8', 64),
        'drawingRevision', 'A',
        'isCurrent', false,
        'drawingStatus', 'For Review',
        'storagePath', '__ecos-tests__/exact-marker.pdf',
        'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0',
        'ecosVerifiedIndexCommittedSha256', repeat('8', 64),
        'ecosVerifiedIndexCommittedPageCount', 1,
        'ecosHostedIndexStatus', 'Ready for ECOS'
      ),
      fixture_owner,
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      '__ecos-build160-same-name-a',
      'Build 160 same drawing',
      'Drawing',
      jsonb_build_object(
        'id', '__ecos-build160-same-name-a',
        'name', 'Build 160 same drawing',
        'category', 'Drawing',
        'projectId', duplicate_a,
        'projectName', 'Same Display Label',
        'contentSha256', repeat('9', 64),
        'drawingRevision', 'A',
        'isCurrent', true,
        'drawingStatus', 'For Review'
      ),
      fixture_owner,
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      '__ecos-build160-same-name-b',
      'Build 160 same drawing',
      'Drawing',
      jsonb_build_object(
        'id', '__ecos-build160-same-name-b',
        'name', 'Build 160 same drawing',
        'category', 'Drawing',
        'projectId', duplicate_b,
        'projectName', 'Same Display Label',
        'contentSha256', repeat('0', 64),
        'drawingRevision', 'A',
        'isCurrent', false,
        'drawingStatus', 'For Review'
      ),
      fixture_owner,
      clock_timestamp(),
      clock_timestamp()
    );
  perform set_config('app.ecos_current_activation', '', true);

  -- Prove the backfill does not auto-create a configuration while the ordinary
  -- enqueue trigger is intentionally suppressed for the no-config fixture.
  alter table public.reference_documents
    disable trigger ecos_reference_document_hosted_enqueue;
  insert into public.reference_documents (
    id, name, category, document_data, owner_id, created_at, updated_at
  ) values (
    '__ecos-build160-no-config-document',
    'Build 160 no config document',
    'Drawing',
    jsonb_build_object(
      'id', '__ecos-build160-no-config-document',
      'name', 'Build 160 no config document',
      'category', 'Drawing',
      'projectName', 'Build 160 Unique Project',
      'organizationId', no_config_org,
      'contentSha256', repeat('d', 64),
      'drawingRevision', 'A',
      'isCurrent', false,
      'drawingStatus', 'For Review',
      'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0'
    ),
    fixture_owner,
    clock_timestamp(),
    clock_timestamp()
  );
  alter table public.reference_documents
    enable trigger ecos_reference_document_hosted_enqueue;

  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, source_scan_status,
    requested_by, created_at, updated_at
  ) values
    (
      '16000000-0000-4000-8000-000000000201',
      fixture_org,
      'Build 160 Unique Project',
      '__ecos-build160-legacy-unique',
      fixture_owner,
      'managed_upload',
      '{}'::jsonb,
      repeat('5', 64),
      1,
      'A',
      'shadow',
      'queued',
      'pending',
      fixture_owner,
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      '16000000-0000-4000-8000-000000000202',
      fixture_org,
      'Build 160 Shared Name',
      '__ecos-build160-legacy-ambiguous',
      fixture_owner,
      'managed_upload',
      '{}'::jsonb,
      repeat('6', 64),
      1,
      'A',
      'shadow',
      'queued',
      'pending',
      fixture_owner,
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      '16000000-0000-4000-8000-000000000203',
      fixture_org,
      unique_project,
      '__ecos-build160-exact-marker',
      fixture_owner,
      'managed_upload',
      '{}'::jsonb,
      repeat('8', 64),
      1,
      'A',
      'shadow',
      'queued',
      'pending',
      fixture_owner,
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      '16000000-0000-4000-8000-000000000204',
      fixture_org,
      unique_project,
      '__ecos-build160-orphan-source',
      fixture_owner,
      'managed_upload',
      '{}'::jsonb,
      repeat('c', 64),
      1,
      'A',
      'shadow',
      'queued',
      'pending',
      fixture_owner,
      clock_timestamp(),
      clock_timestamp()
    );

  insert into public.ecos_hosted_document_pages (
    organization_id, project_id, document_id, page_number, source_sha256,
    evidence_version, sheet_mapping_status, page_text, regions,
    assurance_result
  ) values (
    fixture_org,
    unique_project,
    '__ecos-build160-exact-marker',
    1,
    repeat('8', 64),
    'ecos-hosted-evidence/1.3',
    'unverified',
    'Exact marker public graph',
    '[]'::jsonb,
    '{}'::jsonb
  );
  insert into public.ecos_hosted_document_chunks (
    organization_id, project_id, document_id, page_number, region_id,
    chunk_index, chunk_text, metadata
  ) values (
    fixture_org,
    unique_project,
    '__ecos-build160-exact-marker',
    1,
    'exact-marker-public-graph',
    0,
    'Exact marker public graph',
    jsonb_build_object(
      'materialization', 'hosted_region',
      'searchable', true,
      'structuredSearchContract', 'complete-relationship-only-v1'
    )
  );
end;
$ecos_stage_222329$;

-- @apply-frozen-migration 20260809222329

do $ecos_assert_222329_backfill$
declare
  unique_project text := current_setting('app.ecos_rehearsal_unique_project');
begin
  if not exists (
    select 1 from public.reference_documents source
    where source.id = '__ecos-build160-legacy-unique'
      and source.document_data->>'projectId' = unique_project
  ) then
    raise exception 'ECOS_222329_FAIL: unique collapsed legacy name did not bind';
  end if;
  if exists (
    select 1 from public.reference_documents source
    where source.id in (
      '__ecos-build160-legacy-ambiguous',
      '__ecos-build160-legacy-multiname'
    )
      and source.document_data ? 'projectId'
  ) then
    raise exception 'ECOS_222329_FAIL: ambiguous or multi-name document was guessed';
  end if;
  if exists (
    select 1 from public.reference_documents source
    where source.id like '__ecos-build160-%'
      and coalesce(source.document_data, '{}'::jsonb) ?| array[
        'ecosVerifiedIndexCommitVersion',
        'ecosVerifiedIndexCommittedAt',
        'ecosVerifiedIndexCommittedSha256',
        'ecosVerifiedIndexCommittedPageCount',
        'ecosHostedIndexStatus',
        'ecosHostedIndexProgressPercent',
        'ecosHostedIndexCustomerMessage',
        'ecosHostedIndexLimitationCount',
        'ecosHostedIndexSupportReference',
        'ecosHostedIndexEvidenceVersion',
        'ecosHostedIndexUpdatedAt'
      ]
  ) then
    raise exception 'ECOS_222329_FAIL: legacy authority or status key survived';
  end if;
  if exists (
    select 1 from public.ecos_hosted_index_jobs job
    where job.id in (
      current_setting('app.ecos_rehearsal_provider_job')::uuid,
      '16000000-0000-4000-8000-000000000201'::uuid,
      '16000000-0000-4000-8000-000000000202'::uuid,
      '16000000-0000-4000-8000-000000000203'::uuid,
      '16000000-0000-4000-8000-000000000204'::uuid
    )
  ) or exists (
    select 1 from public.ecos_hosted_document_pages page
    where page.document_id in (
      current_setting('app.ecos_rehearsal_provider_document'),
      '__ecos-build160-exact-marker'
    )
  ) or exists (
    select 1 from public.ecos_hosted_document_chunks chunk
    where chunk.document_id in (
      current_setting('app.ecos_rehearsal_provider_document'),
      '__ecos-build160-exact-marker'
    )
  ) or exists (
    select 1 from public.ecos_drawing_analysis_requests request
    where request.hosted_job_id =
      current_setting('app.ecos_rehearsal_provider_job')::uuid
  ) or exists (
    select 1 from public.ecos_drawing_provider_attempts attempt
    where attempt.hosted_job_id =
      current_setting('app.ecos_rehearsal_provider_job')::uuid
  ) then
    raise exception 'ECOS_222329_FAIL: old hosted graph or provider ledger survived';
  end if;
  if exists (
    select 1 from public.ecos_hosted_index_configuration configuration
    where configuration.organization_id =
      current_setting('app.ecos_rehearsal_no_config_org')
  ) then
    raise exception 'ECOS_222329_FAIL: backfill auto-created a hosted configuration';
  end if;
  if not exists (
    select 1 from pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.reference_documents'::regclass
      and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
      and trigger_record.tgenabled = 'O'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'ECOS_222329_FAIL: hosted enqueue trigger remained disabled';
  end if;
end;
$ecos_assert_222329_backfill$;

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_client_forge_stripped$
begin
  insert into public.reference_documents (
    id, name, category, document_data, owner_id, created_at, updated_at
  ) values (
    '__ecos-build160-client-forge',
    'Build 160 client forge',
    'Drawing',
    jsonb_build_object(
      'id', '__ecos-build160-client-forge',
      'name', 'Build 160 client forge',
      'category', 'Drawing',
      'projectId', current_setting('app.ecos_rehearsal_unique_project'),
      'organizationId', current_setting('app.ecos_rehearsal_org'),
      'contentSha256', repeat('e', 64),
      'drawingRevision', 'A',
      'isCurrent', false,
      'drawingStatus', 'For Review',
      'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0',
      'ecosVerifiedIndexCommittedSha256', repeat('e', 64),
      'ecosVerifiedIndexCommittedPageCount', 1,
      'ecosHostedIndexStatus', 'Ready for ECOS'
    ),
    current_setting('app.ecos_rehearsal_owner')::uuid,
    clock_timestamp(),
    clock_timestamp()
  );
  if exists (
    select 1 from public.reference_documents source
    where source.id = '__ecos-build160-client-forge'
      and coalesce(source.document_data, '{}'::jsonb) ?| array[
        'ecosVerifiedIndexCommitVersion',
        'ecosVerifiedIndexCommittedSha256',
        'ecosVerifiedIndexCommittedPageCount',
        'ecosHostedIndexStatus'
      ]
  ) then
    raise exception 'ECOS_222329_FAIL: authenticated client self-attested';
  end if;
end;
$ecos_assert_client_forge_stripped$;
reset role;

do $ecos_stage_fresh_hosted_commit$
declare
  fixture_owner uuid := current_setting('app.ecos_rehearsal_owner')::uuid;
  fixture_org text := current_setting('app.ecos_rehearsal_org');
  project_id text := current_setting('app.ecos_rehearsal_unique_project');
  document_id text := '__ecos-build160-fresh-ready';
  fresh_job_id uuid := '16000000-0000-4000-8000-000000000301';
  source_sha text := repeat('f', 64);
  sibling_document_id text := '__ecos-build160-fresh-ready-b';
  sibling_job_id uuid := '16000000-0000-4000-8000-000000000302';
  sibling_sha text := repeat('1', 64);
begin
  perform pg_temp.ecos_set_request_jwt(
    'service_role', current_setting('app.ecos_rehearsal_owner')
  );
  insert into public.reference_documents (
    id, name, category, document_data, owner_id, created_at, updated_at
  ) values (
    document_id,
    'Build 160 fresh ready',
    'Drawing',
    jsonb_build_object(
      'id', document_id,
      'name', 'Build 160 fresh ready',
      'category', 'Drawing',
      'projectId', project_id,
      'projectName', 'Build 160 Unique Project',
      'organizationId', fixture_org,
      'contentSha256', source_sha,
      'drawingRevision', 'A',
      'drawingNumber', 'A-301',
      'drawingDiscipline', 'Architectural',
      'drawingIssuedAt', '2026-08-09',
      'isCurrent', false,
      'drawingStatus', 'For Review',
      'sourcePageCount', '1',
      'storagePath', '__ecos-tests__/fresh-ready.pdf'
    ),
    fixture_owner,
    clock_timestamp(),
    clock_timestamp()
  );

  insert into public.reference_documents (
    id, name, category, document_data, owner_id, created_at, updated_at
  ) values (
    sibling_document_id,
    'Build 160 fresh ready',
    'Drawing',
    jsonb_build_object(
      'id', sibling_document_id,
      'name', 'Build 160 fresh ready',
      'category', 'Drawing',
      'projectId', project_id,
      'projectName', 'Build 160 Unique Project',
      'organizationId', fixture_org,
      'contentSha256', sibling_sha,
      'drawingRevision', 'B',
      'drawingNumber', 'A-301',
      'drawingDiscipline', 'Architectural',
      'drawingIssuedAt', '2026-08-10',
      'isCurrent', false,
      'drawingStatus', 'For Review',
      'sourcePageCount', '1',
      'storagePath', '__ecos-tests__/fresh-ready-b.pdf'
    ),
    fixture_owner,
    clock_timestamp(),
    clock_timestamp()
  );

  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, source_scan_status, source_scan_engine,
    source_scan_at, target_evidence_version, requested_by, created_at, updated_at
  ) values (
    fresh_job_id, fixture_org, project_id, document_id, fixture_owner,
    'managed_upload', '{}'::jsonb, source_sha, 1,
    'A', 'shadow', 'queued', 'clean', 'rehearsal',
    clock_timestamp(), 'ecos-hosted-evidence/1.3', fixture_owner,
    clock_timestamp(), clock_timestamp()
  );
  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count
  ) values (
    fresh_job_id, fixture_org, project_id, document_id, 1, source_sha,
    'assured',
    jsonb_build_object(
      'pageNumber', 1,
      'sheetMappingStatus', 'unverified',
      'text', 'Build 160 fresh exact page',
      'regions', '[]'::jsonb
    ),
    jsonb_build_object(
      'accepted', true,
      'schemaVersion', '1.0',
      'evidenceVersion', 'ecos-hosted-evidence/1.3',
      'checks', jsonb_build_object('sheetMappingUsable', false)
    ),
    0
  );
  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, metadata
  ) values (
    fresh_job_id, fixture_org, project_id, document_id, source_sha,
    1, 'fresh-page-text', 0, 'Build 160 fresh exact page',
    jsonb_build_object(
      'materialization', 'shadow_page_text',
      'searchable', true,
      'structuredSearchContract', 'complete-relationship-only-v1'
    )
  );
  delete from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = fresh_job_id;

  update public.ecos_hosted_index_jobs
  set state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = fresh_job_id;

  if not exists (
    select 1 from public.reference_documents source
    where source.id = document_id
      and source.document_data @> jsonb_build_object(
        'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0',
        'ecosVerifiedIndexCommittedSha256', source_sha,
        'ecosVerifiedIndexCommittedPageCount', 1
      )
  ) then
    raise exception 'ECOS_222329_FAIL: fresh exact hosted commit did not mint receipt';
  end if;

  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, source_scan_status, source_scan_engine,
    source_scan_at, target_evidence_version, requested_by, created_at, updated_at
  ) values (
    sibling_job_id, fixture_org, project_id, sibling_document_id, fixture_owner,
    'managed_upload', '{}'::jsonb, sibling_sha, 1,
    'B', 'shadow', 'queued', 'clean', 'rehearsal',
    clock_timestamp(), 'ecos-hosted-evidence/1.3', fixture_owner,
    clock_timestamp(), clock_timestamp()
  );
  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count
  ) values (
    sibling_job_id, fixture_org, project_id, sibling_document_id, 1, sibling_sha,
    'assured',
    jsonb_build_object(
      'pageNumber', 1,
      'sheetMappingStatus', 'unverified',
      'text', 'Build 160 fresh exact B page',
      'regions', '[]'::jsonb
    ),
    jsonb_build_object(
      'accepted', true,
      'schemaVersion', '1.0',
      'evidenceVersion', 'ecos-hosted-evidence/1.3',
      'checks', jsonb_build_object('sheetMappingUsable', false)
    ),
    0
  );
  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, metadata
  ) values (
    sibling_job_id, fixture_org, project_id, sibling_document_id, sibling_sha,
    1, 'fresh-b-page-text', 0, 'Build 160 fresh exact B page',
    jsonb_build_object(
      'materialization', 'shadow_page_text',
      'searchable', true,
      'structuredSearchContract', 'complete-relationship-only-v1'
    )
  );
  delete from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = sibling_job_id;

  update public.ecos_hosted_index_jobs
  set state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = sibling_job_id;

  if not exists (
    select 1 from public.reference_documents source
    where source.id = sibling_document_id
      and source.document_data @> jsonb_build_object(
        'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0',
        'ecosVerifiedIndexCommittedSha256', sibling_sha,
        'ecosVerifiedIndexCommittedPageCount', 1
      )
  ) then
    raise exception 'ECOS_222329_FAIL: fresh B hosted commit did not mint receipt';
  end if;

  update public.ecos_hosted_index_configuration
  set publication_mode = 'live', enabled = true, updated_at = clock_timestamp()
  where organization_id = fixture_org;
  perform set_config('app.ecos_rehearsal_fresh_document', document_id, true);
  perform set_config('app.ecos_rehearsal_fresh_job', fresh_job_id::text, true);
  perform set_config(
    'app.ecos_rehearsal_fresh_sibling_document', sibling_document_id, true
  );
  perform set_config(
    'app.ecos_rehearsal_fresh_sibling_job', sibling_job_id::text, true
  );
end;
$ecos_stage_fresh_hosted_commit$;

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_authority_lifecycle$
declare
  document_id text := current_setting('app.ecos_rehearsal_fresh_document');
  sibling_document_id text := current_setting(
    'app.ecos_rehearsal_fresh_sibling_document'
  );
  expected_sha text := repeat('f', 64);
  sibling_expected_sha text := repeat('1', 64);
begin
  update public.reference_documents
  set document_data = document_data || jsonb_build_object(
        'notes', 'neutral edit',
        'ecosVerifiedIndexCommittedSha256', repeat('0', 64),
        'ecosHostedIndexStatus', 'Ready for ECOS'
      ),
      updated_at = clock_timestamp()
  where id = document_id;
  if not exists (
    select 1 from public.reference_documents source
    where source.id = document_id
      and source.document_data->>'ecosVerifiedIndexCommittedSha256' = expected_sha
      and source.document_data->>'notes' = 'neutral edit'
      and not (source.document_data ? 'ecosHostedIndexStatus')
  ) then
    raise exception 'ECOS_222329_FAIL: neutral edit replaced or lost server receipt';
  end if;

  -- A -> B -> A: exercise the real authenticated atomic-activation RPC. Both
  -- exact revisions have independent ready hosted receipts; neither receipt
  -- may transfer, disappear, or authorize the other source.
  perform public.ecos_activate_current_reference_document(
    document_id,
    (select source.updated_at from public.reference_documents source
     where source.id = document_id)
  );
  perform public.ecos_activate_current_reference_document(
    sibling_document_id,
    (select source.updated_at from public.reference_documents source
     where source.id = sibling_document_id)
  );
  if not exists (
    select 1 from public.reference_documents source
    where source.id = document_id
      and source.document_data->>'isCurrent' = 'false'
      and source.document_data->>'ecosVerifiedIndexCommitVersion' =
        'ecos-verified-index-commit/1.0'
      and source.document_data->>'ecosVerifiedIndexCommittedSha256' = expected_sha
  ) or not exists (
    select 1 from public.reference_documents source
    where source.id = sibling_document_id
      and source.document_data->>'isCurrent' = 'true'
      and source.document_data->>'ecosVerifiedIndexCommitVersion' =
        'ecos-verified-index-commit/1.0'
      and source.document_data->>'ecosVerifiedIndexCommittedSha256' =
        sibling_expected_sha
  ) then
    raise exception 'ECOS_222329_FAIL: A -> B corrupted authority isolation';
  end if;
  perform public.ecos_activate_current_reference_document(
    document_id,
    (select source.updated_at from public.reference_documents source
     where source.id = document_id)
  );
  if not exists (
    select 1 from public.reference_documents source
    where source.id = document_id
      and source.document_data->>'isCurrent' = 'true'
      and source.document_data->>'ecosVerifiedIndexCommitVersion' =
        'ecos-verified-index-commit/1.0'
      and source.document_data->>'ecosVerifiedIndexCommittedSha256' = expected_sha
  ) or not exists (
    select 1 from public.reference_documents source
    where source.id = sibling_document_id
      and source.document_data->>'isCurrent' = 'false'
      and source.document_data->>'ecosVerifiedIndexCommitVersion' =
        'ecos-verified-index-commit/1.0'
      and source.document_data->>'ecosVerifiedIndexCommittedSha256' =
        sibling_expected_sha
  ) then
    raise exception 'ECOS_222329_FAIL: A -> B -> A stranded the exact receipt';
  end if;

end;
$ecos_assert_authority_lifecycle$;
reset role;

update public.ecos_hosted_index_configuration
set enabled = false, publication_mode = 'shadow', updated_at = clock_timestamp()
where organization_id = current_setting('app.ecos_rehearsal_org');

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_protected_identity_edit$
begin
  update public.reference_documents
  set document_data = document_data || jsonb_build_object('drawingRevision', 'C'),
      updated_at = clock_timestamp()
  where id = current_setting('app.ecos_rehearsal_fresh_document');
  if exists (
    select 1 from public.reference_documents source
    where source.id = current_setting('app.ecos_rehearsal_fresh_document')
      and source.document_data ? 'ecosVerifiedIndexCommitVersion'
  ) then
    raise exception 'ECOS_222329_FAIL: protected identity edit retained receipt';
  end if;
end;
$ecos_assert_protected_identity_edit$;
reset role;

do $ecos_assert_post_lifecycle_hold$
begin
  if exists (
    select 1 from public.ecos_hosted_index_configuration where enabled
  ) then
    raise exception 'ECOS_222329_FAIL: hosted hold was not restored after A -> B -> A';
  end if;
end;
$ecos_assert_post_lifecycle_hold$;

create table public.fixture_nested_authority_updates (
  id integer primary key
);

create function public.fixture_nested_authority_update()
returns trigger
language plpgsql
as $nested$
begin
  update public.reference_documents
  set document_data = document_data || jsonb_build_object(
    'ecosVerifiedIndexCommitVersion', 'forged',
    'ecosHostedIndexStatus', 'Ready for ECOS'
  )
  where id = '__ecos-build160-client-forge';
  return new;
end;
$nested$;

create trigger fixture_nested_authority_update_trigger
after insert on public.fixture_nested_authority_updates
for each row execute function public.fixture_nested_authority_update();

do $ecos_assert_nested_and_same_name$
declare
  left_data jsonb;
  right_data jsonb;
begin
  select document_data into left_data
  from public.reference_documents where id = '__ecos-build160-same-name-a';
  select document_data into right_data
  from public.reference_documents where id = '__ecos-build160-same-name-b';
  if public.ecos_reference_documents_share_project(left_data, right_data)
      or not public.ecos_reference_documents_share_project(left_data, left_data) then
    raise exception 'ECOS_222329_FAIL: same-name cross-project isolation failed';
  end if;

  perform pg_temp.ecos_set_request_jwt(
    'authenticated', current_setting('app.ecos_rehearsal_owner')
  );
  insert into public.fixture_nested_authority_updates values (1);
  if exists (
    select 1 from public.reference_documents source
    where source.id = '__ecos-build160-client-forge'
      and coalesce(source.document_data, '{}'::jsonb) ?| array[
        'ecosVerifiedIndexCommitVersion', 'ecosHostedIndexStatus'
      ]
  ) then
    raise exception 'ECOS_222329_FAIL: nested trigger acquired authority';
  end if;

  if to_regprocedure('public.ecos_mark_verified_index_commit()') is not null
      or exists (
        select 1 from pg_trigger trigger_record
        where trigger_record.tgname = 'ecos_mark_verified_index_commit_trigger'
          and not trigger_record.tgisinternal
      ) then
    raise exception 'ECOS_222329_FAIL: retired local marker surface survived';
  end if;
  if has_function_privilege(
      'service_role',
      'public.ecos_enqueue_hosted_reference_unchecked(text,uuid,uuid)',
      'execute'
    ) or has_function_privilege(
      'authenticated',
      'public.ecos_enqueue_hosted_reference_unchecked(text,uuid,uuid)',
      'execute'
    ) or has_function_privilege(
      'anon',
      'public.ecos_enqueue_hosted_reference_unchecked(text,uuid,uuid)',
      'execute'
    ) then
    raise exception 'ECOS_222329_FAIL: unchecked name-fallback queue is callable';
  end if;
end;
$ecos_assert_nested_and_same_name$;

-- @apply-frozen-migration 20260810013000

do $ecos_assert_100130_purge_and_catalog$
declare
  procedure_definition text;
  expected_owner_predicate constant text :=
    '(( SELECT dave_is_app_owner() AS dave_is_app_owner) AND (owner_id = ( SELECT auth.uid() AS uid)))';
begin
  if exists (
    select 1
    from public.reference_documents source
    where coalesce(source.document_data, '{}'::jsonb) ?| array[
      'ecosVerifiedIndexCommitVersion',
      'ecosVerifiedIndexCommittedAt',
      'ecosVerifiedIndexCommittedSha256',
      'ecosVerifiedIndexCommittedPageCount',
      'ecosVerifiedIndexPageGraphSha256',
      'ecosHostedIndexStatus',
      'ecosHostedIndexProgressPercent',
      'ecosHostedIndexCustomerMessage',
      'ecosHostedIndexLimitationCount',
      'ecosHostedIndexSupportReference',
      'ecosHostedIndexEvidenceVersion',
      'ecosHostedIndexUpdatedAt'
    ]
  ) then
    raise exception 'ECOS_100130_FAIL: pre-graph receipt survived the reseal';
  end if;

  if public.ecos_page_graph_sha256(
    '[{"pageNumber":1,"regions":[{"height":0.05,"id":"r-1","text":"Guardrail required","width":0.4,"x":0.1,"y":0.2}],"text":"Guardrail required"}]'::jsonb
  ) <> '545b03371fb739e594b59a5edeb006654b17e3897ef443cdf36063e6626f85e7' then
    raise exception 'ECOS_100130_FAIL: canonical page-graph golden mismatch';
  end if;

  if not exists (
    select 1 from pg_class relation
    where relation.oid = 'public.reference_documents'::regclass
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) or (
    select count(*) from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'reference_documents'
  ) <> 4 or exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'reference_documents'
      and (
        policy.permissive is distinct from 'PERMISSIVE'
        or policy.roles::text is distinct from '{authenticated}'
        or policy.cmd is distinct from case policy.policyname
          when 'reference_documents_owner_select' then 'SELECT'
          when 'reference_documents_owner_insert' then 'INSERT'
          when 'reference_documents_owner_update' then 'UPDATE'
          when 'reference_documents_owner_delete' then 'DELETE'
          else null
        end
        or regexp_replace(
          coalesce(policy.qual, ''), '[[:space:]]+', ' ', 'g'
        ) is distinct from case policy.policyname
          when 'reference_documents_owner_select' then expected_owner_predicate
          when 'reference_documents_owner_insert' then ''
          when 'reference_documents_owner_update' then expected_owner_predicate
          when 'reference_documents_owner_delete' then expected_owner_predicate
          else null
        end
        or regexp_replace(
          coalesce(policy.with_check, ''), '[[:space:]]+', ' ', 'g'
        ) is distinct from case policy.policyname
          when 'reference_documents_owner_select' then ''
          when 'reference_documents_owner_insert' then expected_owner_predicate
          when 'reference_documents_owner_update' then expected_owner_predicate
          when 'reference_documents_owner_delete' then ''
          else null
        end
      )
  ) or exists (
    select 1
    from pg_class relation
    cross join lateral aclexplode(
      coalesce(relation.relacl, '{}'::aclitem[])
    ) privilege
    left join pg_roles grantee_role on grantee_role.oid = privilege.grantee
    where relation.oid = 'public.reference_documents'::regclass
      and (
        privilege.grantee = 0
        or grantee_role.rolname = 'anon'
        or (
          grantee_role.rolname = 'authenticated'
          and (
            privilege.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
            or privilege.is_grantable
          )
        )
      )
  )
      or not has_table_privilege(
        'authenticated', 'public.reference_documents', 'select'
      )
      or not has_table_privilege(
        'authenticated', 'public.reference_documents', 'insert'
      )
      or not has_table_privilege(
        'authenticated', 'public.reference_documents', 'update'
      )
      or not has_table_privilege(
        'authenticated', 'public.reference_documents', 'delete'
      ) then
    raise exception 'ECOS_100130_FAIL: exact owner RLS catalog is incomplete';
  end if;

  select pg_get_functiondef(
    'public.ecos_guard_reference_document_authority_keys()'::regprocedure
  ) into procedure_definition;
  if procedure_definition like '%app.ecos_hosted_commit_hydration%'
      or procedure_definition not like
        '%public.ecos_request_jwt_role() = ''service_role''%' then
    raise exception 'ECOS_100130_FAIL: custom GUC remained receipt authority';
  end if;

  if not exists (
    select 1 from pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.reference_documents'::regclass
      and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
      and trigger_record.tgenabled = 'O'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'ECOS_100130_FAIL: hosted enqueue trigger remained disabled';
  end if;
end;
$ecos_assert_100130_purge_and_catalog$;

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', current_setting('app.ecos_rehearsal_owner')
);
select set_config(
  'app.ecos_hosted_commit_hydration',
  'hosted-evidence-1.3',
  true
);
do $ecos_assert_100130_authenticated_forge$
begin
  update public.reference_documents
  set document_data = document_data || jsonb_build_object(
        'notes', 'custom GUC is not authority',
        'extractedPages', jsonb_build_array(jsonb_build_object(
          'pageNumber', 1,
          'text', 'Forged page graph',
          'regions', '[]'::jsonb
        )),
        'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0',
        'ecosVerifiedIndexCommittedAt', clock_timestamp(),
        'ecosVerifiedIndexCommittedSha256', repeat('e', 64),
        'ecosVerifiedIndexCommittedPageCount', 1,
        'ecosVerifiedIndexPageGraphSha256', repeat('e', 64)
      ),
      updated_at = clock_timestamp()
  where id = '__ecos-build160-client-forge';

  if not exists (
    select 1 from public.reference_documents source
    where source.id = '__ecos-build160-client-forge'
      and source.document_data->>'notes' = 'custom GUC is not authority'
      and not (coalesce(source.document_data, '{}'::jsonb) ?| array[
        'ecosVerifiedIndexCommitVersion',
        'ecosVerifiedIndexCommittedAt',
        'ecosVerifiedIndexCommittedSha256',
        'ecosVerifiedIndexCommittedPageCount',
        'ecosVerifiedIndexPageGraphSha256'
      ])
  ) then
    raise exception 'ECOS_100130_FAIL: authenticated custom GUC minted authority';
  end if;
end;
$ecos_assert_100130_authenticated_forge$;
reset role;

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', '16000000-0000-4000-8000-000000000099'
);
do $ecos_assert_100130_cross_owner_denied$
declare
  changed_rows integer := 0;
begin
  if exists (
    select 1 from public.reference_documents source
    where source.id = '__ecos-build160-client-forge'
  ) then
    raise exception 'ECOS_100130_FAIL: cross-owner select escaped RLS';
  end if;
  update public.reference_documents
  set name = 'cross-owner mutation'
  where id = '__ecos-build160-client-forge';
  get diagnostics changed_rows = row_count;
  if changed_rows <> 0 then
    raise exception 'ECOS_100130_FAIL: cross-owner update escaped RLS';
  end if;
end;
$ecos_assert_100130_cross_owner_denied$;
reset role;

do $ecos_stage_100130_exact_graph$
declare
  fixture_owner uuid := current_setting('app.ecos_rehearsal_owner')::uuid;
  fixture_org text := current_setting('app.ecos_rehearsal_org');
  second_org text := current_setting('app.ecos_rehearsal_no_config_org');
  project_id text := current_setting('app.ecos_rehearsal_unique_project');
  document_id text := '__ecos-build160-page-graph';
  source_sha text := repeat('2', 64);
  job_id uuid := '16000000-0000-4000-8000-000000000401';
begin
  perform pg_temp.ecos_set_request_jwt(
    'service_role', current_setting('app.ecos_rehearsal_owner')
  );
  insert into public.ecos_hosted_index_configuration (
    organization_id, publication_mode, enabled, updated_by, updated_at
  ) values (
    second_org, 'shadow', false, fixture_owner, clock_timestamp()
  ) on conflict (organization_id) do update set
    publication_mode = 'shadow',
    enabled = false,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
  insert into public.reference_documents (
    id, name, category, document_data, owner_id, created_at, updated_at
  ) values (
    document_id,
    'Build 160 page graph',
    'Drawing',
    jsonb_build_object(
      'id', document_id,
      'name', 'Build 160 page graph',
      'category', 'Drawing',
      'projectId', project_id,
      'projectName', 'Build 160 Unique Project',
      'contentSha256', source_sha,
      'drawingRevision', 'A',
      'isCurrent', true,
      'drawingStatus', 'For Construction',
      'sourcePageCount', '1',
      'storagePath', '__ecos-tests__/page-graph.pdf'
    ),
    fixture_owner,
    clock_timestamp(),
    clock_timestamp()
  );

  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, source_scan_status, source_scan_engine,
    source_scan_at, target_evidence_version, requested_by, created_at, updated_at
  ) values (
    job_id, fixture_org, project_id, document_id, fixture_owner,
    'managed_upload', '{}'::jsonb, source_sha, 1,
    'A', 'live', 'queued', 'clean', 'rehearsal',
    clock_timestamp(), 'ecos-hosted-evidence/1.3', fixture_owner,
    clock_timestamp(), clock_timestamp()
  );

  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count
  ) values (
    job_id, fixture_org, project_id, document_id, 1, source_sha,
    'assured',
    jsonb_build_object(
      'pageNumber', 1,
      'sourceSha256', source_sha,
      'sheetMappingStatus', 'unverified',
      'text', 'Build 160 exact graph page',
      'regions', jsonb_build_array(jsonb_build_object(
        'id', 'page-graph-region-1',
        'text', 'Build 160 exact graph page',
        'x', 0.1, 'y', 0.1, 'width', 0.8, 'height', 0.1
      )),
      'visualCoverage', jsonb_build_object(
        'sourceSha256', source_sha,
        'evidenceVersion', 'ecos-hosted-evidence/1.3',
        'pageNumber', 1
      )
    ),
    jsonb_build_object(
      'accepted', true,
      'evidenceVersion', 'ecos-hosted-evidence/1.3'
    ),
    0
  );

  insert into public.ecos_hosted_document_pages (
    organization_id, project_id, document_id, page_number, source_sha256,
    evidence_version, sheet_mapping_status, page_text, regions,
    assurance_result
  ) values (
    fixture_org, project_id, document_id, 1, source_sha,
    'ecos-hosted-evidence/1.3', 'unverified',
    'Build 160 exact graph page',
    jsonb_build_array(jsonb_build_object(
      'id', 'page-graph-region-1',
      'text', 'Build 160 exact graph page',
      'x', 0.1, 'y', 0.1, 'width', 0.8, 'height', 0.1
    )),
    jsonb_build_object(
      'accepted', true,
      'evidenceVersion', 'ecos-hosted-evidence/1.3'
    )
  );

  insert into public.ecos_hosted_document_chunks (
    organization_id, project_id, document_id, page_number, region_id,
    chunk_index, chunk_text, metadata
  ) values (
    fixture_org, project_id, document_id, 1, 'page-graph-region-1',
    0, 'Build 160 exact graph page',
    jsonb_build_object(
      'materialization', 'hosted_region',
      'searchable', true,
      'structuredSearchContract', 'complete-relationship-only-v1'
    )
  );

  update public.ecos_hosted_index_jobs
  set state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = job_id;

  if not exists (
    select 1 from public.reference_documents source
    where source.id = document_id
      and source.document_data->>'ecosVerifiedIndexCommitVersion' =
        'ecos-verified-index-commit/1.0'
      and source.document_data->>'ecosVerifiedIndexCommittedSha256' = source_sha
      and source.document_data->>'ecosVerifiedIndexCommittedPageCount' = '1'
      and source.document_data->>'ecosVerifiedIndexPageGraphSha256' =
        public.ecos_page_graph_sha256(source.document_data->'extractedPages')
      and jsonb_array_length(source.document_data->'extractedPages') = 1
  ) then
    raise exception 'ECOS_100130_FAIL: service ready commit did not mint exact graph';
  end if;

  perform set_config('app.ecos_rehearsal_page_graph_document', document_id, true);
  perform set_config('app.ecos_rehearsal_page_graph_job', job_id::text, true);
end;
$ecos_stage_100130_exact_graph$;

do $ecos_stage_100130_shadow_graph$
declare
  fixture_owner uuid := current_setting('app.ecos_rehearsal_owner')::uuid;
  fixture_org text := current_setting('app.ecos_rehearsal_org');
  project_id text := current_setting('app.ecos_rehearsal_unique_project');
  document_id text := '__ecos-build160-shadow-page-graph';
  source_sha text := repeat('3', 64);
  job_id uuid := '16000000-0000-4000-8000-000000000403';
begin
  perform pg_temp.ecos_set_request_jwt('service_role', fixture_owner::text);
  insert into public.reference_documents (
    id, name, category, document_data, owner_id, created_at, updated_at
  ) values (
    document_id,
    'Build 160 shadow page graph',
    'Drawing',
    jsonb_build_object(
      'id', document_id,
      'name', 'Build 160 shadow page graph',
      'category', 'Drawing',
      'projectId', project_id,
      'projectName', 'Build 160 Unique Project',
      'contentSha256', source_sha,
      'drawingRevision', 'S',
      'drawingNumber', 'S-401',
      'isCurrent', true,
      'drawingStatus', 'For Construction',
      'sourcePageCount', '1',
      'storagePath', '__ecos-tests__/shadow-page-graph.pdf'
    ),
    fixture_owner,
    clock_timestamp(),
    clock_timestamp()
  );

  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, source_scan_status, source_scan_engine,
    source_scan_at, target_evidence_version, requested_by, created_at, updated_at
  ) values (
    job_id, fixture_org, project_id, document_id, fixture_owner,
    'managed_upload', '{}'::jsonb, source_sha, 1,
    'S', 'shadow', 'queued', 'clean', 'rehearsal',
    clock_timestamp(), 'ecos-hosted-evidence/1.3', fixture_owner,
    clock_timestamp(), clock_timestamp()
  );

  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count
  ) values (
    job_id, fixture_org, project_id, document_id, 1, source_sha,
    'assured',
    jsonb_build_object(
      'pageNumber', 1,
      'sourceSha256', source_sha,
      'sheetMappingStatus', 'unverified',
      'text', 'Build 160 exact shadow graph page',
      'regions', jsonb_build_array(jsonb_build_object(
        'id', 'shadow-page-graph-region-1',
        'text', 'Build 160 exact shadow graph page',
        'x', 0.1, 'y', 0.1, 'width', 0.8, 'height', 0.1
      ))
    ),
    jsonb_build_object(
      'accepted', true,
      'evidenceVersion', 'ecos-hosted-evidence/1.3'
    ),
    0
  );

  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, metadata
  ) values (
    job_id, fixture_org, project_id, document_id, source_sha,
    1, 'shadow-page-graph-region-1', 0,
    'Build 160 exact shadow graph page',
    jsonb_build_object(
      'materialization', 'shadow_page_text',
      'searchable', true,
      'structuredSearchContract', 'complete-relationship-only-v1'
    )
  );

  delete from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = '16000000-0000-4000-8000-000000000403'::uuid;

  update public.ecos_hosted_index_jobs
  set state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = job_id;

  if not exists (
    select 1 from public.reference_documents source
    where source.id = document_id
      and source.document_data->>'ecosVerifiedIndexCommitVersion' =
        'ecos-verified-index-commit/1.0'
      and source.document_data->>'ecosVerifiedIndexCommittedSha256' = source_sha
      and source.document_data->>'ecosVerifiedIndexCommittedPageCount' = '1'
      and source.document_data->>'ecosVerifiedIndexPageGraphSha256' =
        public.ecos_page_graph_sha256(source.document_data->'extractedPages')
      and source.document_data->>'ecosVerifiedIndexPageGraphSha256' =
        public.ecos_page_graph_sha256(
          public.ecos_build_hosted_page_graph(job_id)
        )
      and jsonb_array_length(source.document_data->'extractedPages') = 1
  ) then
    raise exception 'ECOS_100130_FAIL: shadow ready commit did not mint exact graph';
  end if;

  perform set_config(
    'app.ecos_rehearsal_shadow_page_graph_document', document_id, true
  );
  perform set_config(
    'app.ecos_rehearsal_shadow_page_graph_job', job_id::text, true
  );
end;
$ecos_stage_100130_shadow_graph$;

do $ecos_assert_100130_shadow_search_identity$
declare
  expected_job uuid := current_setting(
    'app.ecos_rehearsal_shadow_page_graph_job'
  )::uuid;
  expected_document text := current_setting(
    'app.ecos_rehearsal_shadow_page_graph_document'
  );
  previous_role text := coalesce(
    current_setting('request.jwt.claim.role', true), ''
  );
  previous_claims text := coalesce(
    current_setting('request.jwt.claims', true), ''
  );
  previous_claim text := coalesce(
    current_setting('request.jwt.claim', true), ''
  );
  previous_sub text := coalesce(
    current_setting('request.jwt.claim.sub', true), ''
  );
  observed_rows integer := 0;
begin
  perform pg_temp.ecos_set_request_jwt(
    'service_role', current_setting('app.ecos_rehearsal_owner')
  );
  select count(*) into observed_rows
  from public.ecos_search_hosted_shadow_chunks(
    'exact shadow graph page', array[expected_document], 4
  ) result
  where result.job_id = expected_job
    and result.organization_id = current_setting('app.ecos_rehearsal_org')
    and result.project_id = current_setting('app.ecos_rehearsal_unique_project')
    and result.source_sha256 = repeat('3', 64)
    and result.evidence_version = 'ecos-hosted-evidence/1.3'
    and result.document_id = expected_document;
  perform set_config('request.jwt.claim.role', previous_role, true);
  perform set_config('request.jwt.claim.sub', previous_sub, true);
  perform set_config('request.jwt.claim', previous_claim, true);
  perform set_config('request.jwt.claims', previous_claims, true);
  if observed_rows <> 1 then
    raise exception 'ECOS_100130_FAIL: shadow search lost exact job authority';
  end if;
exception when others then
  perform set_config('request.jwt.claim.role', previous_role, true);
  perform set_config('request.jwt.claim.sub', previous_sub, true);
  perform set_config('request.jwt.claim', previous_claim, true);
  perform set_config('request.jwt.claims', previous_claims, true);
  raise;
end;
$ecos_assert_100130_shadow_search_identity$;

do $ecos_stage_100130_ambiguous_shadow_job$
declare
  fixture_owner uuid := current_setting('app.ecos_rehearsal_owner')::uuid;
  second_org text := current_setting('app.ecos_rehearsal_no_config_org');
  project_id text := current_setting('app.ecos_rehearsal_unique_project');
  document_id text := current_setting(
    'app.ecos_rehearsal_shadow_page_graph_document'
  );
  source_sha text := repeat('3', 64);
  original_job uuid := current_setting(
    'app.ecos_rehearsal_shadow_page_graph_job'
  )::uuid;
  duplicate_job uuid := '16000000-0000-4000-8000-000000000404';
begin
  perform pg_temp.ecos_set_request_jwt('service_role', fixture_owner::text);
  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, source_scan_status, source_scan_engine,
    source_scan_at, target_evidence_version, requested_by, created_at, updated_at
  ) values (
    duplicate_job, second_org, project_id, document_id, fixture_owner,
    'managed_upload', '{}'::jsonb, source_sha, 1,
    'S', 'shadow', 'queued', 'clean', 'rehearsal',
    clock_timestamp(), 'ecos-hosted-evidence/1.3', fixture_owner,
    clock_timestamp(), clock_timestamp()
  );
  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count
  )
  select
    duplicate_job, second_org, page.project_id, page.document_id,
    page.page_number, page.source_sha256, page.state, page.final_page_data,
    page.assurance_result, page.unresolved_region_count
  from public.ecos_hosted_index_pages page
  where page.job_id = original_job;

  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata
  )
  select
    duplicate_job, second_org, chunk.project_id, chunk.document_id,
    chunk.source_sha256, chunk.page_number, chunk.region_id,
    chunk.chunk_index, chunk.chunk_text, chunk.sheet_number,
    chunk.confidence, chunk.metadata
  from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = original_job;

  delete from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = '16000000-0000-4000-8000-000000000404'::uuid;

  update public.ecos_hosted_index_jobs
  set state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = duplicate_job;

  if not exists (
    select 1 from public.reference_documents source
    where source.id = document_id
      and source.document_data->>'ecosVerifiedIndexPageGraphSha256' =
        public.ecos_page_graph_sha256(
          public.ecos_build_hosted_page_graph(duplicate_job)
        )
  ) then
    raise exception 'ECOS_100130_FAIL: second shadow job lacked exact graph receipt';
  end if;
end;
$ecos_stage_100130_ambiguous_shadow_job$;

do $ecos_assert_100130_shadow_ambiguity$
declare
  document_id text := current_setting(
    'app.ecos_rehearsal_shadow_page_graph_document'
  );
  previous_role text := coalesce(
    current_setting('request.jwt.claim.role', true), ''
  );
  previous_claims text := coalesce(
    current_setting('request.jwt.claims', true), ''
  );
  previous_claim text := coalesce(
    current_setting('request.jwt.claim', true), ''
  );
  previous_sub text := coalesce(
    current_setting('request.jwt.claim.sub', true), ''
  );
  observed_rows integer := 0;
begin
  perform pg_temp.ecos_set_request_jwt(
    'service_role', current_setting('app.ecos_rehearsal_owner')
  );
  select count(*) into observed_rows
  from public.ecos_search_hosted_shadow_chunks(
    'exact shadow graph page', array[document_id], 4
  );
  perform set_config('request.jwt.claim.role', previous_role, true);
  perform set_config('request.jwt.claim.sub', previous_sub, true);
  perform set_config('request.jwt.claim', previous_claim, true);
  perform set_config('request.jwt.claims', previous_claims, true);
  if observed_rows <> 0 then
    raise exception 'ECOS_100130_FAIL: ambiguous shadow jobs returned evidence';
  end if;
exception when others then
  perform set_config('request.jwt.claim.role', previous_role, true);
  perform set_config('request.jwt.claim.sub', previous_sub, true);
  perform set_config('request.jwt.claim', previous_claim, true);
  perform set_config('request.jwt.claims', previous_claims, true);
  raise;
end;
$ecos_assert_100130_shadow_ambiguity$;

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_100130_live_search_identity$
declare
  expected_job uuid := current_setting('app.ecos_rehearsal_page_graph_job')::uuid;
  expected_document text := current_setting('app.ecos_rehearsal_page_graph_document');
begin
  if (
    select count(*)
    from public.ecos_search_hosted_document_chunks(
      'exact graph page', array[expected_document], 4
    ) result
    where result.job_id = expected_job
      and result.organization_id = current_setting('app.ecos_rehearsal_org')
      and result.project_id = current_setting('app.ecos_rehearsal_unique_project')
      and result.source_sha256 = repeat('2', 64)
      and result.evidence_version = 'ecos-hosted-evidence/1.3'
      and result.document_id = expected_document
  ) <> 1 then
    raise exception 'ECOS_100130_FAIL: live search lost exact job authority';
  end if;
end;
$ecos_assert_100130_live_search_identity$;
reset role;

do $ecos_stage_100130_ambiguous_live_job$
declare
  fixture_owner uuid := current_setting('app.ecos_rehearsal_owner')::uuid;
  second_org text := current_setting('app.ecos_rehearsal_no_config_org');
  project_id text := current_setting('app.ecos_rehearsal_unique_project');
  document_id text := current_setting('app.ecos_rehearsal_page_graph_document');
  source_sha text := repeat('2', 64);
  duplicate_job uuid := '16000000-0000-4000-8000-000000000402';
begin
  perform pg_temp.ecos_set_request_jwt(
    'service_role', current_setting('app.ecos_rehearsal_owner')
  );
  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, source_scan_status, source_scan_engine,
    source_scan_at, target_evidence_version, requested_by, created_at, updated_at
  ) values (
    duplicate_job, second_org, project_id, document_id, fixture_owner,
    'managed_upload', '{}'::jsonb, source_sha, 1,
    'A', 'live', 'queued', 'clean', 'rehearsal',
    clock_timestamp(), 'ecos-hosted-evidence/1.3', fixture_owner,
    clock_timestamp(), clock_timestamp()
  );
  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count
  )
  select
    duplicate_job, second_org, page.project_id, page.document_id,
    page.page_number, page.source_sha256, page.state, page.final_page_data,
    page.assurance_result, page.unresolved_region_count
  from public.ecos_hosted_index_pages page
  where page.job_id = current_setting('app.ecos_rehearsal_page_graph_job')::uuid;

  insert into public.ecos_hosted_document_pages (
    organization_id, project_id, document_id, page_number, source_sha256,
    evidence_version, sheet_number, sheet_title, sheet_mapping_status,
    page_text, regions, assurance_result, sheet_mapping_source,
    sheet_mapping_evidence, document_structural_identity,
    sheet_mapping_assurance
  )
  select
    second_org, page.project_id, page.document_id, page.page_number,
    page.source_sha256, page.evidence_version, page.sheet_number,
    page.sheet_title, page.sheet_mapping_status, page.page_text, page.regions,
    page.assurance_result, page.sheet_mapping_source,
    page.sheet_mapping_evidence, page.document_structural_identity,
    page.sheet_mapping_assurance
  from public.ecos_hosted_document_pages page
  where page.organization_id = current_setting('app.ecos_rehearsal_org')
    and page.document_id = current_setting(
      'app.ecos_rehearsal_page_graph_document'
    );

  insert into public.ecos_hosted_document_chunks (
    organization_id, project_id, document_id, page_number, region_id,
    chunk_index, chunk_text, sheet_number, confidence, metadata
  )
  select
    second_org, chunk.project_id, chunk.document_id, chunk.page_number,
    chunk.region_id, chunk.chunk_index, chunk.chunk_text,
    chunk.sheet_number, chunk.confidence, chunk.metadata
  from public.ecos_hosted_document_chunks chunk
  where chunk.organization_id = current_setting('app.ecos_rehearsal_org')
    and chunk.document_id = current_setting(
      'app.ecos_rehearsal_page_graph_document'
    );

  update public.ecos_hosted_index_jobs
  set state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = duplicate_job;
end;
$ecos_stage_100130_ambiguous_live_job$;

set local role authenticated;
select pg_temp.ecos_set_request_jwt(
  'authenticated', current_setting('app.ecos_rehearsal_owner')
);
do $ecos_assert_100130_ambiguity_and_graph_mutation$
declare
  document_id text := current_setting('app.ecos_rehearsal_page_graph_document');
begin
  if exists (
    select 1
    from public.ecos_search_hosted_document_chunks(
      'exact graph page', array[document_id], 4
    )
  ) then
    raise exception 'ECOS_100130_FAIL: ambiguous exact live jobs returned evidence';
  end if;

  update public.reference_documents
  set document_data = document_data || jsonb_build_object(
        'extractedPages', jsonb_build_array(jsonb_build_object(
          'pageNumber', 1,
          'text', 'Mutated graph',
          'regions', '[]'::jsonb
        )),
        'ecosVerifiedIndexPageGraphSha256', repeat('0', 64)
      ),
      updated_at = clock_timestamp()
  where id = document_id;
  if exists (
    select 1 from public.reference_documents source
    where source.id = document_id
      and coalesce(source.document_data, '{}'::jsonb) ?| array[
        'ecosVerifiedIndexCommitVersion',
        'ecosVerifiedIndexCommittedAt',
        'ecosVerifiedIndexCommittedSha256',
        'ecosVerifiedIndexCommittedPageCount',
        'ecosVerifiedIndexPageGraphSha256'
      ]
  ) then
    raise exception 'ECOS_100130_FAIL: client graph mutation retained authority';
  end if;
end;
$ecos_assert_100130_ambiguity_and_graph_mutation$;
reset role;

rollback;

do $ecos_assert_exact_rollback$
declare
  mismatch_keys text;
begin
  if to_regclass('pg_temp.ecos_reference_project_backfill_candidates') is not null
      or to_regclass('pg_temp.ecos_reference_authority_purge_documents') is not null
      or to_regclass('pg_temp.ecos_reference_hosted_reset_documents') is not null then
    raise exception
      'ECOS_REHEARSAL_ROLLBACK_FAIL: migration temporary table survived rollback';
  end if;

  with current_manifest as materialized (
    select snapshot.manifest_key, snapshot.manifest_value
    from pg_temp.ecos_build160_manifest_snapshot() snapshot
  ), differences as (
    select coalesce(baseline.manifest_key, current_manifest.manifest_key) as key
    from ecos_build160_rehearsal_manifest baseline
    full join current_manifest using (manifest_key)
    where baseline.manifest_value is distinct from current_manifest.manifest_value
  )
  select string_agg(key, ', ' order by key)
  into mismatch_keys
  from differences;

  if mismatch_keys is not null then
    raise exception
      'ECOS_REHEARSAL_ROLLBACK_FAIL: baseline manifest/digest mismatch for %',
      mismatch_keys;
  end if;
end;
$ecos_assert_exact_rollback$;

select jsonb_build_object(
  'receipt', 'ECOS_BUILD160_MIGRATION_REHEARSAL_OK',
  'migrationOrder', jsonb_build_array(
    '20260809193726',
    '20260809195802',
    '20260809201435',
    '20260809222329',
    '20260810013000'
  ),
  'outerTransactionRolledBack', true,
  'baselineManifestEqual', true,
  'providerCallsMade', 0,
  'projectIdentityAdversaries', true,
  'renderedAnnotationAdversaries', true,
  'providerLedgerReplayAndQuota', true,
  'authorityLifecycleAndGraphPurge', true,
  'pageGraphAndSearchAuthority', true
) as ecos_build160_migration_rehearsal_receipt;
