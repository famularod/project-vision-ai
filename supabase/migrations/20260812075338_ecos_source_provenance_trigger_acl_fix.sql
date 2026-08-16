-- Close the remaining direct-execution grant on the reference enqueue trigger.
--
-- CREATE OR REPLACE preserves an existing function ACL. The managed-source
-- provenance migration replaced this trigger function and revoked PUBLIC,
-- anon, and authenticated, but the mature function already had an explicit
-- service_role grant. Trigger execution does not require callers to retain
-- EXECUTE on the trigger function, so no non-owner role should keep it.

begin;

-- Keep the held-state precondition stable for this ACL-only transition.
lock table public.ecos_hosted_index_configuration in share row exclusive mode;

do $vitruvius_source_provenance_acl_release_precondition$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '20260809193726', '20260809195802', '20260809201435',
    '20260809222329', '20260810013000', '20260811021601',
    '20260811151028', '20260811235642', '20260812011945',
    '20260812064107'
  ];
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions then
    raise exception
      'ecos_source_provenance_acl_requires_exact_ten_migration_tip';
  end if;

  if exists (
    select 1
    from public.ecos_hosted_index_configuration configuration
    where configuration.enabled
       or configuration.publication_mode is distinct from 'shadow'
  ) then
    raise exception
      'ecos_source_provenance_acl_requires_disabled_shadow_configuration';
  end if;
end
$vitruvius_source_provenance_acl_release_precondition$;

create temporary table vitruvius_source_provenance_acl_catalog_baseline
on commit drop
as
select
  pg_get_functiondef(procedure_record.oid) as function_definition,
  pg_get_triggerdef(trigger_record.oid, true) as trigger_definition
from pg_proc procedure_record
join pg_trigger trigger_record
  on trigger_record.tgfoid = procedure_record.oid
 and trigger_record.tgrelid = 'public.reference_documents'::regclass
 and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
 and not trigger_record.tgisinternal
where procedure_record.oid = to_regprocedure(
  'public.ecos_enqueue_hosted_index_from_reference_document()'
);

do $vitruvius_source_provenance_acl_precondition$
declare
  enqueue_oid oid := to_regprocedure(
    'public.ecos_enqueue_hosted_index_from_reference_document()'
  );
  function_acl text[];
  trigger_count integer;
  function_trigger_count integer;
begin
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
  ) then
    raise exception
      'ecos_source_provenance_enqueue_trigger_function_precondition_failed';
  end if;
  if encode(extensions.digest(
      convert_to(pg_get_functiondef(enqueue_oid), 'UTF8'),
      'sha256'
    ), 'hex') is distinct from
      '043c4984955086c41ee6a343135752384447690e025b79d69b064cfb103dbc8c' then
    raise exception
      'ecos_source_provenance_enqueue_trigger_definition_precondition_failed';
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
      'ecos_source_provenance_enqueue_trigger_acl_precondition_failed:%',
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
  if trigger_count <> 1 then
    raise exception
      'ecos_source_provenance_enqueue_trigger_precondition_failed';
  end if;
  select count(*)::integer into function_trigger_count
  from pg_trigger trigger_record
  where trigger_record.tgfoid = enqueue_oid
    and not trigger_record.tgisinternal;
  if function_trigger_count <> 1 then
    raise exception
      'ecos_source_provenance_enqueue_function_binding_precondition_failed';
  end if;
  if (select count(*) from vitruvius_source_provenance_acl_catalog_baseline) <> 1 then
    raise exception
      'ecos_source_provenance_enqueue_catalog_baseline_precondition_failed';
  end if;
end
$vitruvius_source_provenance_acl_precondition$;

revoke all on function
  public.ecos_enqueue_hosted_index_from_reference_document()
  from public, anon, authenticated, service_role;

do $vitruvius_source_provenance_acl_postcondition$
declare
  enqueue_oid oid := to_regprocedure(
    'public.ecos_enqueue_hosted_index_from_reference_document()'
  );
  function_acl text[];
  trigger_count integer;
  function_trigger_count integer;
begin
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
      'ecos_source_provenance_enqueue_trigger_function_postcondition_failed';
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
  if function_acl is distinct from array[]::text[] then
    raise exception
      'ecos_source_provenance_enqueue_trigger_acl_postcondition_failed:%',
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
  if trigger_count <> 1 then
    raise exception
      'ecos_source_provenance_enqueue_trigger_postcondition_failed';
  end if;
  select count(*)::integer into function_trigger_count
  from pg_trigger trigger_record
  where trigger_record.tgfoid = enqueue_oid
    and not trigger_record.tgisinternal;
  if function_trigger_count <> 1 then
    raise exception
      'ecos_source_provenance_enqueue_function_binding_postcondition_failed';
  end if;

  if not exists (
    select 1
    from vitruvius_source_provenance_acl_catalog_baseline baseline
    join pg_proc procedure_record
      on procedure_record.oid = enqueue_oid
    join pg_trigger trigger_record
      on trigger_record.tgfoid = enqueue_oid
     and trigger_record.tgrelid = 'public.reference_documents'::regclass
     and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
     and not trigger_record.tgisinternal
    where baseline.function_definition = pg_get_functiondef(procedure_record.oid)
      and baseline.trigger_definition = pg_get_triggerdef(trigger_record.oid, true)
  ) then
    raise exception
      'ecos_source_provenance_enqueue_catalog_integrity_postcondition_failed';
  end if;
end
$vitruvius_source_provenance_acl_postcondition$;

commit;
