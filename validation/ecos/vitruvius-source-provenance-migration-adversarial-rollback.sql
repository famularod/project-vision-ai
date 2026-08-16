-- Outer-rollback rehearsal for the managed-source provenance guard.
--
-- The evidence emitter replaces the one apply marker below with migration
-- 20260812064107 after removing only that migration's outer BEGIN/COMMIT. Every
-- fixture and catalog change then remains inside this outer transaction. No
-- provider is called and no live evidence is published by this rehearsal.

do $vitruvius_source_provenance_precondition$
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
    raise exception
      'source-provenance rehearsal requires the exact sealed nine-migration tip';
  end if;
  if exists (
    select 1
    from public.ecos_hosted_index_configuration configuration
    where configuration.enabled
  ) then
    raise exception
      'source-provenance rehearsal requires every hosted configuration held';
  end if;
  if to_regprocedure(
      'public.ecos_reference_document_enqueue_identity(jsonb)'
    ) is not null
      or to_regprocedure(
        'public.ecos_guard_hosted_managed_source_authority()'
      ) is not null
      or exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'public.ecos_hosted_index_jobs'::regclass
          and trigger_record.tgname =
            'ecos_hosted_managed_source_authority_guard'
          and not trigger_record.tgisinternal
      ) then
    raise exception
      'source-provenance rehearsal did not start from the sealed preapply catalog';
  end if;
  if not exists (
    select 1
    from pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.reference_documents'::regclass
      and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
  ) then
    raise exception 'sealed reference-document enqueue trigger is not enabled';
  end if;
end
$vitruvius_source_provenance_precondition$;

-- Capture durable non-target and catalog state outside the outer rollback so
-- both the in-transaction isolation proof and the post-ROLLBACK proof compare
-- against the same exact baseline.
begin;

create or replace function pg_temp.vitruvius_relation_digest(
  p_relation regclass,
  p_predicate text default 'true'
)
returns jsonb
language plpgsql
as $vitruvius_relation_digest_body$
declare
  result jsonb;
begin
  execute format(
    'select jsonb_build_object(' ||
    '''count'', count(*), ' ||
    '''digest'', encode(extensions.digest(convert_to(coalesce(' ||
    'string_agg(row_digest, '''' order by row_digest), ''''), ''UTF8''), ' ||
    '''sha256''), ''hex'')) ' ||
    'from (' ||
    'select encode(extensions.digest(convert_to(' ||
    'to_jsonb(relation_row)::text, ''UTF8''), ''sha256''), ''hex'') ' ||
    'as row_digest ' ||
    'from %s relation_row where %s' ||
    ') digested_rows',
    p_relation,
    p_predicate
  ) into result;
  return result;
end;
$vitruvius_relation_digest_body$;

create or replace function pg_temp.vitruvius_source_provenance_snapshot()
returns table(snapshot_key text, snapshot_value jsonb)
language sql
volatile
as $vitruvius_source_provenance_snapshot_body$
  values
    (
      'relation:configuration',
      pg_temp.vitruvius_relation_digest(
        'public.ecos_hosted_index_configuration'::regclass
      )
    ),
    (
      'relation:reference_documents_nonfixture',
      pg_temp.vitruvius_relation_digest(
        'public.reference_documents'::regclass,
        'id::text not like ''__vitruvius-source-provenance-%'''
      )
    ),
    (
      'relation:jobs_nonfixture',
      pg_temp.vitruvius_relation_digest(
        'public.ecos_hosted_index_jobs'::regclass,
        'document_id not like ''__vitruvius-source-provenance-%'''
      )
    ),
    (
      'relation:index_pages_nonfixture',
      pg_temp.vitruvius_relation_digest(
        'public.ecos_hosted_index_pages'::regclass,
        'job_id::text not like ''96000000-0000-4000-8000-%'''
      )
    ),
    (
      'relation:shadow_chunks_nonfixture',
      pg_temp.vitruvius_relation_digest(
        'public.ecos_hosted_shadow_chunks'::regclass,
        'job_id::text not like ''96000000-0000-4000-8000-%'''
      )
    ),
    (
      'relation:shadow_queue_nonfixture',
      pg_temp.vitruvius_relation_digest(
        'public.ecos_hosted_shadow_materialization_queue'::regclass,
        'job_id::text not like ''96000000-0000-4000-8000-%'''
      )
    ),
    (
      'relation:visual_exceptions_nonfixture',
      pg_temp.vitruvius_relation_digest(
        'public.ecos_hosted_visual_exceptions'::regclass,
        'job_id::text not like ''96000000-0000-4000-8000-%'''
      )
    ),
    (
      'relation:usage_nonfixture',
      pg_temp.vitruvius_relation_digest(
        'public.ecos_hosted_index_usage'::regclass,
        'job_id::text not like ''96000000-0000-4000-8000-%'''
      )
    ),
    (
      'relation:drawing_requests_nonfixture',
      pg_temp.vitruvius_relation_digest(
        'public.ecos_drawing_analysis_requests'::regclass,
        'hosted_job_id::text not like ''96000000-0000-4000-8000-%'''
      )
    ),
    (
      'relation:drawing_attempts_nonfixture',
      pg_temp.vitruvius_relation_digest(
        'public.ecos_drawing_provider_attempts'::regclass,
        'hosted_job_id::text not like ''96000000-0000-4000-8000-%'''
      )
    ),
    (
      'relation:live_pages',
      pg_temp.vitruvius_relation_digest(
        'public.ecos_hosted_document_pages'::regclass
      )
    ),
    (
      'relation:live_chunks',
      pg_temp.vitruvius_relation_digest(
        'public.ecos_hosted_document_chunks'::regclass
      )
    ),
    (
      'relation:migration_history',
      pg_temp.vitruvius_relation_digest(
        'supabase_migrations.schema_migrations'::regclass
      )
    );
$vitruvius_source_provenance_snapshot_body$;

create temporary table vitruvius_source_provenance_rehearsal_baseline (
  snapshot_key text primary key,
  snapshot_value jsonb not null
) on commit preserve rows;

insert into vitruvius_source_provenance_rehearsal_baseline (
  snapshot_key,
  snapshot_value
)
select snapshot.snapshot_key, snapshot.snapshot_value
from pg_temp.vitruvius_source_provenance_snapshot() snapshot;

insert into vitruvius_source_provenance_rehearsal_baseline (
  snapshot_key,
  snapshot_value
)
select
  'catalog:enqueue_function',
  jsonb_build_object(
    'definition', pg_get_functiondef(procedure_record.oid),
    'acl', coalesce(procedure_record.proacl::text, ''),
    'securityDefiner', procedure_record.prosecdef,
    'config', procedure_record.proconfig
  )
from pg_proc procedure_record
where procedure_record.oid = to_regprocedure(
  'public.ecos_enqueue_hosted_index_from_reference_document()'
);

insert into vitruvius_source_provenance_rehearsal_baseline (
  snapshot_key,
  snapshot_value
)
select
  'catalog:enqueue_trigger',
  jsonb_build_object(
    'definition', pg_get_triggerdef(trigger_record.oid, true),
    'enabled', trigger_record.tgenabled::text,
    'function', trigger_record.tgfoid::regprocedure::text
  )
from pg_trigger trigger_record
where trigger_record.tgrelid = 'public.reference_documents'::regclass
  and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
  and not trigger_record.tgisinternal;

do $vitruvius_source_provenance_baseline_complete$
begin
  if (
    select count(*)
    from vitruvius_source_provenance_rehearsal_baseline
  ) <> 15 then
    raise exception 'source-provenance baseline manifest is incomplete';
  end if;
end
$vitruvius_source_provenance_baseline_complete$;

commit;

begin isolation level serializable;
set local statement_timeout = '15min';
set local lock_timeout = '5s';

-- @apply-source-provenance-migration 20260812064107

do $vitruvius_source_provenance_catalog$
declare
  helper_oid oid := to_regprocedure(
    'public.ecos_reference_document_enqueue_identity(jsonb)'
  );
  guard_oid oid := to_regprocedure(
    'public.ecos_guard_hosted_managed_source_authority()'
  );
  enqueue_oid oid := to_regprocedure(
    'public.ecos_enqueue_hosted_index_from_reference_document()'
  );
begin
  if helper_oid is null or guard_oid is null or enqueue_oid is null then
    raise exception 'source-provenance migration function surface is incomplete';
  end if;
  if has_function_privilege(
      'public', helper_oid, 'EXECUTE'
    ) or has_function_privilege(
      'anon', helper_oid, 'EXECUTE'
    ) or has_function_privilege(
      'authenticated', helper_oid, 'EXECUTE'
    ) or not has_function_privilege(
      'service_role', helper_oid, 'EXECUTE'
    ) then
    raise exception 'enqueue-identity helper ACL is unsafe';
  end if;
  if has_function_privilege('public', guard_oid, 'EXECUTE')
      or has_function_privilege('anon', guard_oid, 'EXECUTE')
      or has_function_privilege('authenticated', guard_oid, 'EXECUTE')
      or has_function_privilege('service_role', guard_oid, 'EXECUTE') then
    raise exception 'managed-source guard ACL is unsafe';
  end if;
  if has_function_privilege('public', enqueue_oid, 'EXECUTE')
      or has_function_privilege('anon', enqueue_oid, 'EXECUTE')
      or has_function_privilege('authenticated', enqueue_oid, 'EXECUTE') then
    raise exception 'reference enqueue trigger function ACL is unsafe';
  end if;
  if not exists (
    select 1
    from pg_trigger trigger_record
    where trigger_record.tgrelid =
        'public.ecos_hosted_index_jobs'::regclass
      and trigger_record.tgname =
        'ecos_hosted_managed_source_authority_guard'
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgfoid = guard_oid
      and trigger_record.tgtype = 19
  ) then
    raise exception 'exact enabled managed-source before-update trigger is missing';
  end if;
  if not exists (
    select 1
    from pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.reference_documents'::regclass
      and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgfoid = enqueue_oid
      and trigger_record.tgtype = 21
  ) then
    raise exception 'exact enabled reference enqueue trigger is missing';
  end if;
end
$vitruvius_source_provenance_catalog$;

create temporary table vitruvius_source_provenance_context
on commit drop
as
select
  configuration.organization_id,
  project.id::text as project_id,
  project.name as project_name,
  project.owner_id
from public.ecos_hosted_index_configuration configuration
join public.organization_memberships membership
  on membership.organization_id = configuration.organization_id
 and membership.status = 'active'
join public.projects project
  on project.owner_id = membership.user_id
 and coalesce(project.archived, false) = false
where configuration.enabled = false
order by configuration.organization_id, membership.created_at, project.id
limit 1;

do $vitruvius_source_provenance_context_check$
declare
  context_count integer;
  fixture_count integer;
begin
  select count(*) into context_count
  from vitruvius_source_provenance_context;
  if context_count <> 1 then
    raise exception
      'source-provenance rehearsal requires one held organization/project binding';
  end if;
  select count(*) into fixture_count
  from public.reference_documents source
  where source.id::text like '__vitruvius-source-provenance-%';
  if fixture_count <> 0 or exists (
    select 1
    from public.ecos_hosted_index_jobs job
    where job.id::text like '96000000-0000-4000-8000-%'
  ) then
    raise exception 'source-provenance rehearsal fixture identity is not empty';
  end if;
end
$vitruvius_source_provenance_context_check$;

do $vitruvius_source_provenance_fixture_documents$
declare
  selected_context vitruvius_source_provenance_context%rowtype;
  fixture_name text;
  fixture_sha text;
  fixture_suffix text;
begin
  select * into strict selected_context
  from vitruvius_source_provenance_context;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', selected_context.owner_id::text,
      'role', 'service_role'
    )::text,
    true
  );
  perform set_config(
    'request.jwt.claim.sub', selected_context.owner_id::text, true
  );
  perform set_config('request.jwt.claim.role', 'service_role', true);

  for fixture_name, fixture_sha, fixture_suffix in
    select * from (values
      ('ready', repeat('a', 64), 'R'),
      ('active', repeat('b', 64), 'A'),
      ('dirty-queued', repeat('c', 64), 'D'),
      ('clean-managed', repeat('d', 64), 'M'),
      ('nonmanaged', repeat('e', 64), 'N'),
      ('different-identity', repeat('f', 64), 'I'),
      ('queue-identity', repeat('2', 64), 'Q')
    ) fixture(fixture_name, fixture_sha, fixture_suffix)
  loop
    insert into public.reference_documents (
      id, name, category, document_data, owner_id, created_at, updated_at
    ) values (
      '__vitruvius-source-provenance-' || fixture_name,
      'Source provenance ' || fixture_name,
      'Drawing',
      jsonb_build_object(
        'id', '__vitruvius-source-provenance-' || fixture_name,
        'name', 'Source provenance ' || fixture_name,
        'category', 'Drawing',
        'projectId', selected_context.project_id,
        'projectName', selected_context.project_name,
        'organizationId', selected_context.organization_id,
        'contentSha256', fixture_sha,
        'webFileFingerprint', fixture_sha,
        'indexedContentSha256', fixture_sha,
        'drawingRevision', '1',
        'drawingNumber', 'VSP-' || fixture_suffix,
        'isCurrent', false,
        'drawingStatus', 'For Construction',
        'sourcePageCount', 1,
        'sourceProvider', 'google_drive',
        'externalSource', jsonb_build_object(
          'provider', 'google_drive',
          'fileId', 'source-provenance-' || fixture_name
        )
      ),
      selected_context.owner_id,
      clock_timestamp(),
      clock_timestamp()
    );
  end loop;

  if exists (
    select 1
    from public.ecos_hosted_index_jobs job
    where job.document_id like '__vitruvius-source-provenance-%'
  ) then
    raise exception 'held configuration unexpectedly enqueued fixture documents';
  end if;
end
$vitruvius_source_provenance_fixture_documents$;

do $vitruvius_source_provenance_fixture_jobs$
declare
  selected_context vitruvius_source_provenance_context%rowtype;
begin
  select * into strict selected_context
  from vitruvius_source_provenance_context;

  insert into public.ecos_hosted_index_jobs (
    id, organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, completed_page_count, assured_page_count,
    unresolved_region_count, claimed_by, claim_token, lease_expires_at,
    heartbeat_at, source_scan_status, source_scan_engine, source_scan_at,
    target_evidence_version, requested_by, created_at, updated_at
  ) values
    (
      '96000000-0000-4000-8000-000000000001',
      selected_context.organization_id, selected_context.project_id,
      '__vitruvius-source-provenance-ready', selected_context.owner_id,
      'managed_upload',
      '{"gcsBucket":"vitruvius-source-provenance-rehearsal","gcsObject":"source/ready.pdf"}'::jsonb,
      repeat('a', 64), 1, '1', 'shadow', 'queued', 0, 0, 0,
      null, null, null, null, 'clean', 'rehearsal', clock_timestamp(),
      'ecos-hosted-evidence/1.3', selected_context.owner_id,
      clock_timestamp(), clock_timestamp()
    ),
    (
      '96000000-0000-4000-8000-000000000002',
      selected_context.organization_id, selected_context.project_id,
      '__vitruvius-source-provenance-active', selected_context.owner_id,
      'managed_upload',
      '{"gcsBucket":"vitruvius-source-provenance-rehearsal","gcsObject":"source/active.pdf"}'::jsonb,
      repeat('b', 64), 1, '1', 'shadow', 'extracting', 0, 0, 0,
      'source-provenance-rehearsal',
      '96100000-0000-4000-8000-000000000002',
      clock_timestamp() + interval '5 minutes', clock_timestamp(),
      'clean', 'rehearsal', clock_timestamp(),
      'ecos-hosted-evidence/1.3', selected_context.owner_id,
      clock_timestamp(), clock_timestamp()
    ),
    (
      '96000000-0000-4000-8000-000000000003',
      selected_context.organization_id, selected_context.project_id,
      '__vitruvius-source-provenance-dirty-queued', selected_context.owner_id,
      'managed_upload',
      '{"gcsBucket":"vitruvius-source-provenance-rehearsal","gcsObject":"source/dirty.pdf"}'::jsonb,
      repeat('c', 64), 1, '1', 'shadow', 'queued', 1, 0, 0,
      null, null, null, null, 'clean', 'rehearsal', clock_timestamp(),
      'ecos-hosted-evidence/1.3', selected_context.owner_id,
      clock_timestamp(), clock_timestamp()
    ),
    (
      '96000000-0000-4000-8000-000000000004',
      selected_context.organization_id, selected_context.project_id,
      '__vitruvius-source-provenance-clean-managed', selected_context.owner_id,
      'managed_upload',
      '{"gcsBucket":"vitruvius-source-provenance-rehearsal","gcsObject":"source/clean-old.pdf"}'::jsonb,
      repeat('d', 64), 1, '1', 'shadow', 'queued', 0, 0, 0,
      null, null, null, null, 'clean', 'rehearsal', clock_timestamp(),
      'ecos-hosted-evidence/1.3', selected_context.owner_id,
      clock_timestamp(), clock_timestamp()
    ),
    (
      '96000000-0000-4000-8000-000000000005',
      selected_context.organization_id, selected_context.project_id,
      '__vitruvius-source-provenance-nonmanaged', selected_context.owner_id,
      'google_drive',
      '{"externalSource":{"provider":"google_drive","fileId":"nonmanaged"}}'::jsonb,
      repeat('e', 64), 1, '1', 'shadow', 'reconnect_source', 0, 0, 0,
      null, null, null, null, 'pending', null, null,
      'ecos-hosted-evidence/1.3', selected_context.owner_id,
      clock_timestamp(), clock_timestamp()
    ),
    (
      '96000000-0000-4000-8000-000000000006',
      selected_context.organization_id, selected_context.project_id,
      '__vitruvius-source-provenance-different-identity',
      selected_context.owner_id, 'managed_upload',
      '{"gcsBucket":"vitruvius-source-provenance-rehearsal","gcsObject":"source/different-old.pdf"}'::jsonb,
      repeat('f', 64), 1, '1', 'shadow', 'queued', 1, 0, 0,
      null, null, null, null, 'clean', 'rehearsal', clock_timestamp(),
      'ecos-hosted-evidence/1.3', selected_context.owner_id,
      clock_timestamp(), clock_timestamp()
    ),
    (
      '96000000-0000-4000-8000-000000000007',
      selected_context.organization_id, selected_context.project_id,
      '__vitruvius-source-provenance-queue-identity',
      selected_context.owner_id, 'google_drive',
      '{"externalSource":{"provider":"google_drive","fileId":"queue-old"}}'::jsonb,
      repeat('2', 64), 1, '1', 'shadow', 'reconnect_source', 0, 0, 0,
      null, null, null, null, 'pending', null, null,
      'ecos-hosted-evidence/1.3', selected_context.owner_id,
      clock_timestamp(), clock_timestamp()
    );
end
$vitruvius_source_provenance_fixture_jobs$;

-- Exercise the real ready-commit trigger. Its derived reference-document
-- hydration passes through the reference enqueue trigger while the held
-- configuration remains unchanged.
do $vitruvius_source_provenance_ready_commit$
declare
  selected_context vitruvius_source_provenance_context%rowtype;
  ready_job_id constant uuid :=
    '96000000-0000-4000-8000-000000000001'::uuid;
  source_sha constant text :=
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  expected_locator constant jsonb :=
    '{"gcsBucket":"vitruvius-source-provenance-rehearsal","gcsObject":"source/ready.pdf"}'::jsonb;
begin
  select * into strict selected_context
  from vitruvius_source_provenance_context;

  -- This enable is visible only inside the outer transaction and is restored
  -- before the manifest proof. It makes a failure to skip derived hydration
  -- observable as a real enqueue/upsert instead of a held-configuration no-op.
  update public.ecos_hosted_index_configuration configuration
  set enabled = true
  where configuration.organization_id = selected_context.organization_id;

  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number,
    source_sha256, state, final_page_data, assurance_result,
    unresolved_region_count
  ) values (
    ready_job_id, selected_context.organization_id, selected_context.project_id,
    '__vitruvius-source-provenance-ready', 1, source_sha, 'assured',
    jsonb_build_object(
      'pageNumber', 1,
      'sourceSha256', source_sha,
      'sheetMappingStatus', 'unverified',
      'text', 'Source provenance ready-commit graph',
      'regions', jsonb_build_array(jsonb_build_object(
        'id', 'source-provenance-ready-region-1',
        'text', 'Source provenance ready-commit graph',
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
    ready_job_id, selected_context.organization_id, selected_context.project_id,
    '__vitruvius-source-provenance-ready', source_sha, 1,
    'source-provenance-ready-region-1', 0,
    'Source provenance ready-commit graph',
    '{"materialization":"shadow_page_text","searchable":true,"structuredSearchContract":"complete-relationship-only-v1"}'::jsonb
  );

  delete from public.ecos_hosted_shadow_materialization_queue queue_record
  where queue_record.job_id = ready_job_id;

  update public.ecos_hosted_index_jobs job
  set state = 'ready',
      completed_page_count = 1,
      assured_page_count = 1,
      unresolved_region_count = 0,
      committed_evidence_version = 'ecos-hosted-evidence/1.3',
      ready_at = clock_timestamp(),
      updated_at = '2099-01-01 00:00:00+00'::timestamptz
  where job.id = ready_job_id;

  if not exists (
    select 1
    from public.reference_documents source
    where source.id::text = '__vitruvius-source-provenance-ready'
      and source.document_data->>'ecosVerifiedIndexCommitVersion' =
        'ecos-verified-index-commit/1.0'
      and source.document_data->>'ecosVerifiedIndexCommittedSha256' =
        source_sha
      and source.document_data->>'ecosVerifiedIndexCommittedPageCount' = '1'
  ) then
    raise exception 'ready-commit derived hydration did not persist its receipt';
  end if;
  if not exists (
    select 1
    from public.ecos_hosted_index_jobs job
    where job.id = ready_job_id
      and job.state = 'ready'
      and job.source_provider = 'managed_upload'
      and job.source_locator = expected_locator
      and job.completed_page_count = 1
      and job.assured_page_count = 1
      and job.unresolved_region_count = 0
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and job.updated_at = '2099-01-01 00:00:00+00'::timestamptz
  ) then
    raise exception
      'ready-commit derived trigger path downgraded managed source authority';
  end if;
end
$vitruvius_source_provenance_ready_commit$;

create temporary table vitruvius_source_provenance_protected_before
on commit drop
as
select job.id, to_jsonb(job) as exact_row
from public.ecos_hosted_index_jobs job
where job.id in (
  '96000000-0000-4000-8000-000000000002'::uuid,
  '96000000-0000-4000-8000-000000000003'::uuid
);

do $vitruvius_source_provenance_derived_updates$
begin
  update public.reference_documents source
  set document_data = source.document_data || jsonb_build_object(
        'extractedText', 'Derived active evidence',
        'documentIntelligenceVersion', 'ecos-document-intelligence/2.0',
        'documentVisualIndexVersion', 'ecos-visual-index/3.0'
      ),
      updated_at = clock_timestamp()
  where source.id::text = '__vitruvius-source-provenance-active';

  update public.reference_documents source
  set document_data = source.document_data || jsonb_build_object(
        'extractedText', 'Derived dirty queued evidence',
        'documentIntelligenceVersion', 'ecos-document-intelligence/2.0',
        'documentVisualIndexVersion', 'ecos-visual-index/3.0'
      ),
      updated_at = clock_timestamp()
  where source.id::text = '__vitruvius-source-provenance-dirty-queued';

  if exists (
    select protected.id
    from vitruvius_source_provenance_protected_before protected
    join public.ecos_hosted_index_jobs job on job.id = protected.id
    where to_jsonb(job) is distinct from protected.exact_row
  ) or (
    select count(*)
    from vitruvius_source_provenance_protected_before
  ) <> 2 then
    raise exception
      'derived reference updates mutated an active or dirty queued exact job';
  end if;
end
$vitruvius_source_provenance_derived_updates$;

-- Unlike a derived-evidence-only update, changing one exact queue-driving
-- identity field must reach the mature enqueue path. The transaction-local
-- enabled configuration makes that path observable on the exact fixture job.
do $vitruvius_source_provenance_queue_identity_change$
declare
  selected_context vitruvius_source_provenance_context%rowtype;
begin
  select * into strict selected_context
  from vitruvius_source_provenance_context;

  update public.reference_documents source
  set document_data = jsonb_set(
        source.document_data,
        '{externalSource}',
        '{"provider":"google_drive","fileId":"queue-new"}'::jsonb,
        true
      ),
      updated_at = clock_timestamp()
  where source.id::text = '__vitruvius-source-provenance-queue-identity';

  if not exists (
    select 1
    from public.ecos_hosted_index_jobs job
    where job.id = '96000000-0000-4000-8000-000000000007'::uuid
      and job.state = 'reconnect_source'
      and job.source_provider = 'google_drive'
      and job.source_locator->'externalSource'->>'provider' = 'google_drive'
      and job.source_locator->'externalSource'->>'fileId' = 'queue-new'
  ) then
    raise exception 'queue-driving identity change did not execute exact re-enqueue';
  end if;

  update public.ecos_hosted_index_configuration configuration
  set enabled = false
  where configuration.organization_id = selected_context.organization_id;
  if exists (
    select 1
    from public.ecos_hosted_index_configuration configuration
    where configuration.enabled
  ) then
    raise exception 'queue-identity fixture did not restore the held configuration';
  end if;
end
$vitruvius_source_provenance_queue_identity_change$;

do $vitruvius_source_provenance_guard_adversaries$
declare
  protected_bucket constant text :=
    'vitruvius-source-provenance-rehearsal';
begin
  -- Protected ready, active, and dirty queued jobs reject provider downgrades
  -- and incomplete managed locators for the same exact identity.
  update public.ecos_hosted_index_jobs job
  set source_provider = 'google_drive',
      source_locator =
        '{"externalSource":{"provider":"google_drive","fileId":"attack-ready"}}'::jsonb
  where job.id = '96000000-0000-4000-8000-000000000001'::uuid;

  update public.ecos_hosted_index_jobs job
  set source_provider = 'managed_upload',
      source_locator = jsonb_build_object('gcsBucket', protected_bucket)
  where job.id = '96000000-0000-4000-8000-000000000002'::uuid;

  update public.ecos_hosted_index_jobs job
  set source_provider = 'supabase_storage',
      source_locator = '{"bucket":"project-documents","path":"attack.pdf"}'::jsonb
  where job.id = '96000000-0000-4000-8000-000000000003'::uuid;

  if not exists (
    select 1 from public.ecos_hosted_index_jobs job
    where job.id = '96000000-0000-4000-8000-000000000001'::uuid
      and job.state = 'ready'
      and job.source_provider = 'managed_upload'
      and job.source_locator->>'gcsBucket' = protected_bucket
      and job.source_locator->>'gcsObject' = 'source/ready.pdf'
  ) or not exists (
    select 1 from public.ecos_hosted_index_jobs job
    where job.id = '96000000-0000-4000-8000-000000000002'::uuid
      and job.state = 'extracting'
      and job.source_provider = 'managed_upload'
      and job.source_locator->>'gcsBucket' = protected_bucket
      and job.source_locator->>'gcsObject' = 'source/active.pdf'
      and job.claim_token =
        '96100000-0000-4000-8000-000000000002'::uuid
  ) or not exists (
    select 1 from public.ecos_hosted_index_jobs job
    where job.id = '96000000-0000-4000-8000-000000000003'::uuid
      and job.state = 'queued'
      and job.completed_page_count = 1
      and job.source_provider = 'managed_upload'
      and job.source_locator->>'gcsBucket' = protected_bucket
      and job.source_locator->>'gcsObject' = 'source/dirty.pdf'
  ) then
    raise exception
      'managed source guard did not preserve a protected exact provider/locator pair';
  end if;

  -- A clean, unclaimed, artifact-free managed job may be deliberately restaged
  -- to another complete managed GCS object.
  update public.ecos_hosted_index_jobs job
  set source_provider = 'managed_upload',
      source_locator = jsonb_build_object(
        'gcsBucket', protected_bucket,
        'gcsObject', 'source/clean-new.pdf'
      )
  where job.id = '96000000-0000-4000-8000-000000000004'::uuid;
  if not exists (
    select 1 from public.ecos_hosted_index_jobs job
    where job.id = '96000000-0000-4000-8000-000000000004'::uuid
      and job.source_provider = 'managed_upload'
      and job.source_locator->>'gcsBucket' = protected_bucket
      and job.source_locator->>'gcsObject' = 'source/clean-new.pdf'
  ) then
    raise exception 'valid managed-to-managed restage was not accepted';
  end if;

  -- A non-managed origin may move forward to a complete managed source.
  update public.ecos_hosted_index_jobs job
  set source_provider = 'managed_upload',
      source_locator = jsonb_build_object(
        'gcsBucket', protected_bucket,
        'gcsObject', 'source/nonmanaged-promoted.pdf'
      )
  where job.id = '96000000-0000-4000-8000-000000000005'::uuid;
  if not exists (
    select 1 from public.ecos_hosted_index_jobs job
    where job.id = '96000000-0000-4000-8000-000000000005'::uuid
      and job.source_provider = 'managed_upload'
      and job.source_locator->>'gcsBucket' = protected_bucket
      and job.source_locator->>'gcsObject' =
        'source/nonmanaged-promoted.pdf'
  ) then
    raise exception 'valid nonmanaged-to-managed transition was not accepted';
  end if;

  -- The guard is exact-identity scoped. A simultaneous checksum transition is
  -- not allowed to borrow the predecessor identity's managed-source authority.
  update public.ecos_hosted_index_jobs job
  set source_sha256 = repeat('1', 64),
      source_provider = 'google_drive',
      source_locator =
        '{"externalSource":{"provider":"google_drive","fileId":"new-identity"}}'::jsonb
  where job.id = '96000000-0000-4000-8000-000000000006'::uuid;
  if not exists (
    select 1 from public.ecos_hosted_index_jobs job
    where job.id = '96000000-0000-4000-8000-000000000006'::uuid
      and job.source_sha256 = repeat('1', 64)
      and job.source_provider = 'google_drive'
      and job.source_locator->'externalSource'->>'fileId' = 'new-identity'
  ) then
    raise exception 'different exact identity was incorrectly pinned to predecessor authority';
  end if;
end
$vitruvius_source_provenance_guard_adversaries$;

-- Prove the ACL boundary behavior, not only the catalog grants.
set local role authenticated;
do $vitruvius_source_provenance_authenticated_acl$
declare
  denied boolean := false;
begin
  begin
    perform public.ecos_reference_document_enqueue_identity('{}'::jsonb);
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'authenticated role executed enqueue-identity helper';
  end if;
end
$vitruvius_source_provenance_authenticated_acl$;
set local role postgres;

set local role service_role;
do $vitruvius_source_provenance_service_guard_acl$
declare
  denied boolean := false;
begin
  begin
    perform public.ecos_guard_hosted_managed_source_authority();
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'service role directly executed managed-source trigger guard';
  end if;
end
$vitruvius_source_provenance_service_guard_acl$;
set local role postgres;

-- Before rollback, fixture-excluded relations, held configuration, migration
-- history, and both live publication tables must still match the baseline.
do $vitruvius_source_provenance_nontarget_proof$
begin
  if exists (
    select baseline.snapshot_key, baseline.snapshot_value
    from vitruvius_source_provenance_rehearsal_baseline baseline
    where baseline.snapshot_key like 'relation:%'
    except
    select snapshot.snapshot_key, snapshot.snapshot_value
    from pg_temp.vitruvius_source_provenance_snapshot() snapshot
  ) or exists (
    select snapshot.snapshot_key, snapshot.snapshot_value
    from pg_temp.vitruvius_source_provenance_snapshot() snapshot
    except
    select baseline.snapshot_key, baseline.snapshot_value
    from vitruvius_source_provenance_rehearsal_baseline baseline
    where baseline.snapshot_key like 'relation:%'
  ) then
    raise exception
      'source-provenance rehearsal changed non-target, live, configuration, or migration state';
  end if;
end
$vitruvius_source_provenance_nontarget_proof$;

rollback;

do $vitruvius_source_provenance_rollback_proof$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '20260809193726', '20260809195802', '20260809201435',
    '20260809222329', '20260810013000', '20260811021601',
    '20260811151028', '20260811235642', '20260812011945'
  ];
  current_enqueue_function jsonb;
  current_enqueue_trigger jsonb;
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions then
    raise exception 'outer rollback did not restore the exact nine-migration tip';
  end if;
  if to_regprocedure(
      'public.ecos_reference_document_enqueue_identity(jsonb)'
    ) is not null
      or to_regprocedure(
        'public.ecos_guard_hosted_managed_source_authority()'
      ) is not null
      or exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'public.ecos_hosted_index_jobs'::regclass
          and trigger_record.tgname =
            'ecos_hosted_managed_source_authority_guard'
          and not trigger_record.tgisinternal
      ) then
    raise exception 'outer rollback retained source-provenance catalog objects';
  end if;

  select jsonb_build_object(
      'definition', pg_get_functiondef(procedure_record.oid),
      'acl', coalesce(procedure_record.proacl::text, ''),
      'securityDefiner', procedure_record.prosecdef,
      'config', procedure_record.proconfig
    )
    into current_enqueue_function
  from pg_proc procedure_record
  where procedure_record.oid = to_regprocedure(
    'public.ecos_enqueue_hosted_index_from_reference_document()'
  );
  select jsonb_build_object(
      'definition', pg_get_triggerdef(trigger_record.oid, true),
      'enabled', trigger_record.tgenabled::text,
      'function', trigger_record.tgfoid::regprocedure::text
    )
    into current_enqueue_trigger
  from pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.reference_documents'::regclass
    and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
    and not trigger_record.tgisinternal;

  if current_enqueue_function is distinct from (
      select baseline.snapshot_value
      from vitruvius_source_provenance_rehearsal_baseline baseline
      where baseline.snapshot_key = 'catalog:enqueue_function'
    ) or current_enqueue_trigger is distinct from (
      select baseline.snapshot_value
      from vitruvius_source_provenance_rehearsal_baseline baseline
      where baseline.snapshot_key = 'catalog:enqueue_trigger'
    ) then
    raise exception 'outer rollback did not restore enqueue function/trigger catalog';
  end if;

  if exists (
    select baseline.snapshot_key, baseline.snapshot_value
    from vitruvius_source_provenance_rehearsal_baseline baseline
    where baseline.snapshot_key like 'relation:%'
    except
    select snapshot.snapshot_key, snapshot.snapshot_value
    from pg_temp.vitruvius_source_provenance_snapshot() snapshot
  ) or exists (
    select snapshot.snapshot_key, snapshot.snapshot_value
    from pg_temp.vitruvius_source_provenance_snapshot() snapshot
    except
    select baseline.snapshot_key, baseline.snapshot_value
    from vitruvius_source_provenance_rehearsal_baseline baseline
    where baseline.snapshot_key like 'relation:%'
  ) then
    raise exception 'outer rollback did not restore the exact relation snapshot';
  end if;

  if exists (
    select 1
    from public.reference_documents source
    where source.id::text like '__vitruvius-source-provenance-%'
  ) or exists (
    select 1
    from public.ecos_hosted_index_jobs job
    where job.id::text like '96000000-0000-4000-8000-%'
       or job.document_id like '__vitruvius-source-provenance-%'
  ) or exists (
    select 1
    from public.ecos_hosted_index_pages page
    where page.job_id::text like '96000000-0000-4000-8000-%'
  ) or exists (
    select 1
    from public.ecos_hosted_shadow_chunks chunk
    where chunk.job_id::text like '96000000-0000-4000-8000-%'
  ) or exists (
    select 1
    from public.ecos_hosted_shadow_materialization_queue queue_record
    where queue_record.job_id::text like '96000000-0000-4000-8000-%'
  ) then
    raise exception 'outer rollback retained source-provenance fixture rows';
  end if;
end
$vitruvius_source_provenance_rollback_proof$;

select jsonb_build_object(
  'receipt', 'VITRUVIUS_SOURCE_PROVENANCE_REHEARSAL_OK',
  'migrationOrder', jsonb_build_array('20260812064107'),
  'outerTransactionRolledBack', true,
  'baselineManifestEqual', true,
  'derivedEvidenceUpdateSkippedReenqueue', true,
  'queueIdentityChangeReenqueued', true,
  'durableManagedAuthorityPreserved', true,
  'protectedStatesPreserved', true,
  'cleanManagedReplacementAllowed', true,
  'nonManagedAdvanceAllowed', true,
  'identityChangeNotPreserved', true,
  'aclAdversariesRejected', true,
  'exactCanaryUnchanged', true,
  'providerCallsMade', 0
)::text as vitruvius_source_provenance_rehearsal_receipt;
