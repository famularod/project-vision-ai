-- Outer-rollback rehearsal for the source-provenance trigger ACL correction.
--
-- The evidence emitter replaces the one apply marker below with migration
-- 20260812075338 after removing only that migration's BEGIN/COMMIT. The
-- rehearsal does not call a provider or publish evidence. Its only runtime
-- write is a same-value update of the exact canary reference document inside
-- the transaction that is rolled back.

do $vitruvius_source_provenance_acl_rehearsal_precondition$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '20260809193726', '20260809195802', '20260809201435',
    '20260809222329', '20260810013000', '20260811021601',
    '20260811151028', '20260811235642', '20260812011945',
    '20260812064107'
  ];
  enqueue_oid oid := to_regprocedure(
    'public.ecos_enqueue_hosted_index_from_reference_document()'
  );
  function_acl text[];
  trigger_count integer;
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions then
    raise exception
      'source-provenance ACL rehearsal requires the exact sealed ten-migration tip';
  end if;
  if exists (
    select 1
    from public.ecos_hosted_index_configuration configuration
    where configuration.enabled
       or configuration.publication_mode is distinct from 'shadow'
  ) then
    raise exception
      'source-provenance ACL rehearsal requires disabled shadow configuration';
  end if;
  if enqueue_oid is null or not exists (
    select 1
    from pg_proc procedure_record
    join pg_language language_record
      on language_record.oid = procedure_record.prolang
    where procedure_record.oid = enqueue_oid
      and procedure_record.prokind = 'f'
      and procedure_record.proowner = 'postgres'::regrole
      and procedure_record.prosecdef = true
      and procedure_record.provolatile = 'v'
      and procedure_record.proconfig is not distinct from
        array['search_path=public, pg_temp']::text[]
      and language_record.lanname = 'plpgsql'
      and encode(extensions.digest(
        convert_to(pg_get_functiondef(procedure_record.oid), 'UTF8'),
        'sha256'
      ), 'hex') =
        '043c4984955086c41ee6a343135752384447690e025b79d69b064cfb103dbc8c'
  ) then
    raise exception
      'source-provenance ACL rehearsal function precondition failed';
  end if;
  select coalesce(array_agg(
    coalesce(grantee_role.rolname, 'PUBLIC') || ':' ||
      acl.privilege_type || ':' || acl.is_grantable::text
    order by coalesce(grantee_role.rolname, 'PUBLIC'), acl.privilege_type
  ), array[]::text[])
    into function_acl
  from pg_proc procedure_record
  cross join lateral aclexplode(coalesce(
    procedure_record.proacl,
    acldefault('f', procedure_record.proowner)
  )) acl
  left join pg_roles grantee_role on grantee_role.oid = acl.grantee
  where procedure_record.oid = enqueue_oid
    and acl.grantee <> procedure_record.proowner;
  if function_acl is distinct from
      array['service_role:EXECUTE:false']::text[] then
    raise exception
      'source-provenance ACL rehearsal requires exact service grant:%',
      function_acl;
  end if;
  select count(*)::integer into trigger_count
  from pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.reference_documents'::regclass
    and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
    and not trigger_record.tgisinternal
    and trigger_record.tgenabled = 'O'
    and trigger_record.tgfoid = enqueue_oid
    and trigger_record.tgtype = 21
    and trigger_record.tgqual is null
    and (
      select array_agg(attribute_record.attname order by target_column.ordinality)
      from unnest(trigger_record.tgattr) with ordinality
        target_column(attnum, ordinality)
      join pg_attribute attribute_record
        on attribute_record.attrelid = trigger_record.tgrelid
       and attribute_record.attnum = target_column.attnum
    ) = array['document_data']::name[];
  if trigger_count <> 1 or (
    select count(*)
    from pg_trigger trigger_record
    where trigger_record.tgfoid = enqueue_oid
      and not trigger_record.tgisinternal
  ) <> 1 then
    raise exception
      'source-provenance ACL rehearsal trigger binding precondition failed';
  end if;
end
$vitruvius_source_provenance_acl_rehearsal_precondition$;

begin;

create or replace function pg_temp.vitruvius_acl_relation_digest(
  p_relation regclass,
  p_predicate text default 'true',
  p_ignored_keys text[] default array[]::text[]
)
returns jsonb
language plpgsql
as $vitruvius_acl_relation_digest_body$
declare
  result jsonb;
begin
  execute format(
    'select jsonb_build_object(' ||
    '''count'', count(*), ' ||
    '''digest'', encode(extensions.digest(convert_to(coalesce(' ||
    'string_agg(row_digest, '''' order by row_digest), ''''), ''UTF8''), ' ||
    '''sha256''), ''hex'')) ' ||
    'from (select encode(extensions.digest(convert_to((' ||
    'to_jsonb(relation_row) - %L::text[])::text, ''UTF8''), ''sha256''), ''hex'') ' ||
    'as row_digest from %s relation_row where %s) digested_rows',
    p_ignored_keys,
    p_relation,
    p_predicate
  ) into result;
  return result;
end;
$vitruvius_acl_relation_digest_body$;

create or replace function pg_temp.vitruvius_acl_snapshot()
returns table(snapshot_key text, snapshot_value jsonb)
language sql
volatile
as $vitruvius_acl_snapshot_body$
  values
    ('relation:configuration', pg_temp.vitruvius_acl_relation_digest(
      'public.ecos_hosted_index_configuration'::regclass)),
    ('relation:reference_documents_noncanary',
      pg_temp.vitruvius_acl_relation_digest(
      'public.reference_documents'::regclass,
      p_predicate =>
        $$relation_row.id::text <> 'web-document-6052f920-128e-46c5-8d93-46556e86252d'$$)),
    ('relation:reference_document_canary',
      pg_temp.vitruvius_acl_relation_digest(
      'public.reference_documents'::regclass,
      p_predicate =>
        $$relation_row.id::text = 'web-document-6052f920-128e-46c5-8d93-46556e86252d'$$,
      p_ignored_keys => array['updated_at']::text[])),
    ('relation:jobs', pg_temp.vitruvius_acl_relation_digest(
      'public.ecos_hosted_index_jobs'::regclass)),
    ('relation:index_pages', pg_temp.vitruvius_acl_relation_digest(
      'public.ecos_hosted_index_pages'::regclass)),
    ('relation:shadow_chunks', pg_temp.vitruvius_acl_relation_digest(
      'public.ecos_hosted_shadow_chunks'::regclass)),
    ('relation:shadow_queue', pg_temp.vitruvius_acl_relation_digest(
      'public.ecos_hosted_shadow_materialization_queue'::regclass)),
    ('relation:visual_exceptions', pg_temp.vitruvius_acl_relation_digest(
      'public.ecos_hosted_visual_exceptions'::regclass)),
    ('relation:usage', pg_temp.vitruvius_acl_relation_digest(
      'public.ecos_hosted_index_usage'::regclass)),
    ('relation:drawing_requests', pg_temp.vitruvius_acl_relation_digest(
      'public.ecos_drawing_analysis_requests'::regclass)),
    ('relation:drawing_attempts', pg_temp.vitruvius_acl_relation_digest(
      'public.ecos_drawing_provider_attempts'::regclass)),
    ('relation:live_pages', pg_temp.vitruvius_acl_relation_digest(
      'public.ecos_hosted_document_pages'::regclass)),
    ('relation:live_chunks', pg_temp.vitruvius_acl_relation_digest(
      'public.ecos_hosted_document_chunks'::regclass)),
    ('relation:migration_history', pg_temp.vitruvius_acl_relation_digest(
      'supabase_migrations.schema_migrations'::regclass)),
    ('rollback:canary_reference_updated_at', (
      select to_jsonb(source.updated_at)
      from public.reference_documents source
      where source.id::text =
        'web-document-6052f920-128e-46c5-8d93-46556e86252d'
        and source.owner_id = (
          select job.source_owner_id
          from public.ecos_hosted_index_jobs job
          where job.id = '3863b29a-f7c0-4188-b5fb-6aa2e6db8dd2'::uuid
        )
    )),
    ('matrix:source_provider', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'provider', matrix.source_provider,
        'state', matrix.state,
        'count', matrix.row_count
      ) order by matrix.source_provider, matrix.state), '[]'::jsonb)
      from (
        select source_provider, state, count(*)::integer as row_count
        from public.ecos_hosted_index_jobs
        group by source_provider, state
      ) matrix
    ));
$vitruvius_acl_snapshot_body$;

create temporary table vitruvius_source_provenance_acl_baseline (
  snapshot_key text primary key,
  snapshot_value jsonb not null
) on commit preserve rows;

insert into vitruvius_source_provenance_acl_baseline
select snapshot.snapshot_key, snapshot.snapshot_value
from pg_temp.vitruvius_acl_snapshot() snapshot;

insert into vitruvius_source_provenance_acl_baseline
select 'catalog:enqueue_function', jsonb_build_object(
  'definition', pg_get_functiondef(procedure_record.oid),
  'acl', coalesce(procedure_record.proacl::text, ''),
  'owner', procedure_record.proowner::regrole::text,
  'securityDefiner', procedure_record.prosecdef,
  'volatility', procedure_record.provolatile::text,
  'config', procedure_record.proconfig
)
from pg_proc procedure_record
where procedure_record.oid = to_regprocedure(
  'public.ecos_enqueue_hosted_index_from_reference_document()'
);

insert into vitruvius_source_provenance_acl_baseline
select 'catalog:enqueue_trigger', jsonb_build_object(
  'definition', pg_get_triggerdef(trigger_record.oid, true),
  'enabled', trigger_record.tgenabled::text,
  'function', trigger_record.tgfoid::regprocedure::text
)
from pg_trigger trigger_record
where trigger_record.tgrelid = 'public.reference_documents'::regclass
  and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
  and not trigger_record.tgisinternal;

do $vitruvius_source_provenance_acl_baseline_complete$
begin
  if (select count(*) from vitruvius_source_provenance_acl_baseline) <> 18 then
    raise exception 'source-provenance ACL rehearsal baseline is incomplete';
  end if;
end
$vitruvius_source_provenance_acl_baseline_complete$;

commit;

begin isolation level serializable;
set local statement_timeout = '15min';
set local lock_timeout = '5s';

-- @apply-source-provenance-acl-migration 20260812075338

do $vitruvius_source_provenance_acl_catalog_after_apply$
declare
  enqueue_oid oid := to_regprocedure(
    'public.ecos_enqueue_hosted_index_from_reference_document()'
  );
  function_acl text[];
  application_role text;
begin
  select coalesce(array_agg(
    coalesce(grantee_role.rolname, 'PUBLIC') || ':' ||
      acl.privilege_type || ':' || acl.is_grantable::text
    order by coalesce(grantee_role.rolname, 'PUBLIC'), acl.privilege_type
  ), array[]::text[])
    into function_acl
  from pg_proc procedure_record
  cross join lateral aclexplode(coalesce(
    procedure_record.proacl,
    acldefault('f', procedure_record.proowner)
  )) acl
  left join pg_roles grantee_role on grantee_role.oid = acl.grantee
  where procedure_record.oid = enqueue_oid
    and acl.grantee <> procedure_record.proowner;
  if function_acl is distinct from array[]::text[] then
    raise exception
      'source-provenance ACL migration retained a non-owner grant:%',
      function_acl;
  end if;
  foreach application_role in array array[
    'public', 'anon', 'authenticated', 'service_role', 'authenticator'
  ]::text[] loop
    if has_function_privilege(application_role, enqueue_oid, 'EXECUTE') then
      raise exception
        'source-provenance ACL migration retained effective execute for %',
        application_role;
    end if;
  end loop;
  if not exists (
    select 1
    from vitruvius_source_provenance_acl_baseline baseline
    join pg_proc procedure_record on procedure_record.oid = enqueue_oid
    join pg_trigger trigger_record
      on trigger_record.tgfoid = enqueue_oid
     and trigger_record.tgrelid = 'public.reference_documents'::regclass
     and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
     and not trigger_record.tgisinternal
    where baseline.snapshot_key = 'catalog:enqueue_function'
      and baseline.snapshot_value->>'definition' =
        pg_get_functiondef(procedure_record.oid)
      and baseline.snapshot_value->>'owner' =
        procedure_record.proowner::regrole::text
      and (baseline.snapshot_value->>'securityDefiner')::boolean =
        procedure_record.prosecdef
      and baseline.snapshot_value->>'volatility' =
        procedure_record.provolatile::text
      and baseline.snapshot_value->'config' =
        to_jsonb(procedure_record.proconfig)
      and (
        select trigger_baseline.snapshot_value->>'definition'
        from vitruvius_source_provenance_acl_baseline trigger_baseline
        where trigger_baseline.snapshot_key = 'catalog:enqueue_trigger'
      ) = pg_get_triggerdef(trigger_record.oid, true)
  ) then
    raise exception
      'source-provenance ACL migration changed function or trigger definition';
  end if;
end
$vitruvius_source_provenance_acl_catalog_after_apply$;

set local role service_role;
do $vitruvius_source_provenance_acl_direct_service_denied$
declare
  denied boolean := false;
begin
  begin
    perform public.ecos_enqueue_hosted_index_from_reference_document();
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception
      'service_role directly executed the reference enqueue trigger function';
  end if;
end
$vitruvius_source_provenance_acl_direct_service_denied$;

do $vitruvius_source_provenance_acl_service_trigger_runtime$
declare
  updated_count integer;
begin
  with updated as (
    update public.reference_documents source
    set document_data = source.document_data
    where source.id::text =
      'web-document-6052f920-128e-46c5-8d93-46556e86252d'
      and source.owner_id = (
        select job.source_owner_id
        from public.ecos_hosted_index_jobs job
        where job.id = '3863b29a-f7c0-4188-b5fb-6aa2e6db8dd2'::uuid
      )
    returning 1
  )
  select count(*)::integer into updated_count from updated;
  if updated_count <> 1 then
    raise exception
      'service_role trigger runtime did not update the exact canary reference';
  end if;
end
$vitruvius_source_provenance_acl_service_trigger_runtime$;
set local role postgres;

do $vitruvius_source_provenance_acl_in_transaction_isolation$
declare
  canary_job public.ecos_hosted_index_jobs%rowtype;
begin
  if exists (
    select baseline.snapshot_key, baseline.snapshot_value
    from vitruvius_source_provenance_acl_baseline baseline
    where baseline.snapshot_key not like 'catalog:%'
      and baseline.snapshot_key not like 'rollback:%'
    except
    select snapshot.snapshot_key, snapshot.snapshot_value
    from pg_temp.vitruvius_acl_snapshot() snapshot
    where snapshot.snapshot_key not like 'rollback:%'
  ) or exists (
    select snapshot.snapshot_key, snapshot.snapshot_value
    from pg_temp.vitruvius_acl_snapshot() snapshot
    where snapshot.snapshot_key not like 'rollback:%'
    except
    select baseline.snapshot_key, baseline.snapshot_value
    from vitruvius_source_provenance_acl_baseline baseline
    where baseline.snapshot_key not like 'catalog:%'
      and baseline.snapshot_key not like 'rollback:%'
  ) then
    raise exception
      'source-provenance ACL rehearsal changed data, provider matrix, or live state';
  end if;
  select job.* into canary_job
  from public.ecos_hosted_index_jobs job
  where job.id = '3863b29a-f7c0-4188-b5fb-6aa2e6db8dd2'::uuid;
  if not found
      or canary_job.document_id is distinct from
        'web-document-6052f920-128e-46c5-8d93-46556e86252d'
      or canary_job.source_sha256 is distinct from
        '7f69c250a1085df832dbda21daf4db2cfef5ae0cc21a61ecdfdb15d8884c48f6'
      or canary_job.mode is distinct from 'shadow'
      or canary_job.state is distinct from 'ready'
      or canary_job.completed_page_count is distinct from 6
      or canary_job.assured_page_count is distinct from 6
      or canary_job.unresolved_region_count is distinct from 0
      or canary_job.source_provider is distinct from 'managed_upload'
      or canary_job.source_locator is distinct from jsonb_build_object(
        'gcsBucket', 'vitruvius-project-intelligence-ecos-source-staging',
        'gcsObject',
          'shadow/pie-rls-validation-org-a/' ||
          'web-document-6052f920-128e-46c5-8d93-46556e86252d/' ||
          '7f69c250a1085df832dbda21daf4db2cfef5ae0cc21a61ecdfdb15d8884c48f6.pdf'
      ) then
    raise exception 'source-provenance ACL exact canary changed';
  end if;
end
$vitruvius_source_provenance_acl_in_transaction_isolation$;

rollback;

do $vitruvius_source_provenance_acl_rollback_proof$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '20260809193726', '20260809195802', '20260809201435',
    '20260809222329', '20260810013000', '20260811021601',
    '20260811151028', '20260811235642', '20260812011945',
    '20260812064107'
  ];
  current_function jsonb;
  current_trigger jsonb;
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions then
    raise exception
      'source-provenance ACL outer rollback changed the exact ten-migration tip';
  end if;
  select jsonb_build_object(
    'definition', pg_get_functiondef(procedure_record.oid),
    'acl', coalesce(procedure_record.proacl::text, ''),
    'owner', procedure_record.proowner::regrole::text,
    'securityDefiner', procedure_record.prosecdef,
    'volatility', procedure_record.provolatile::text,
    'config', procedure_record.proconfig
  ) into current_function
  from pg_proc procedure_record
  where procedure_record.oid = to_regprocedure(
    'public.ecos_enqueue_hosted_index_from_reference_document()'
  );
  select jsonb_build_object(
    'definition', pg_get_triggerdef(trigger_record.oid, true),
    'enabled', trigger_record.tgenabled::text,
    'function', trigger_record.tgfoid::regprocedure::text
  ) into current_trigger
  from pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.reference_documents'::regclass
    and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
    and not trigger_record.tgisinternal;
  if current_function is distinct from (
      select baseline.snapshot_value
      from vitruvius_source_provenance_acl_baseline baseline
      where baseline.snapshot_key = 'catalog:enqueue_function'
    ) or current_trigger is distinct from (
      select baseline.snapshot_value
      from vitruvius_source_provenance_acl_baseline baseline
      where baseline.snapshot_key = 'catalog:enqueue_trigger'
    ) then
    raise exception
      'source-provenance ACL outer rollback did not restore catalog and service grant';
  end if;
  if exists (
    select baseline.snapshot_key, baseline.snapshot_value
    from vitruvius_source_provenance_acl_baseline baseline
    where baseline.snapshot_key not like 'catalog:%'
    except
    select snapshot.snapshot_key, snapshot.snapshot_value
    from pg_temp.vitruvius_acl_snapshot() snapshot
  ) or exists (
    select snapshot.snapshot_key, snapshot.snapshot_value
    from pg_temp.vitruvius_acl_snapshot() snapshot
    except
    select baseline.snapshot_key, baseline.snapshot_value
    from vitruvius_source_provenance_acl_baseline baseline
    where baseline.snapshot_key not like 'catalog:%'
  ) then
    raise exception
      'source-provenance ACL outer rollback did not restore exact data state';
  end if;
end
$vitruvius_source_provenance_acl_rollback_proof$;

select jsonb_build_object(
  'receipt', 'VITRUVIUS_SOURCE_PROVENANCE_ACL_REHEARSAL_OK',
  'migrationOrder', jsonb_build_array('20260812075338'),
  'outerTransactionRolledBack', true,
  'baselineManifestEqual', true,
  'enqueueAclClosed', true,
  'directServiceInvocationDenied', true,
  'serviceRoleTriggerExecutionPreserved', true,
  'enqueueCatalogUnchangedExceptAcl', true,
  'exactCanaryUnchanged', true,
  'nonTargetUnchanged', true,
  'hostedConfigurationsHeld', true,
  'providerCallsMade', 0
)::text as vitruvius_source_provenance_acl_rehearsal_receipt;
