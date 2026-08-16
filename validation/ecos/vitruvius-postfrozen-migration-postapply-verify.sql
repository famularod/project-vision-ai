do $postfrozen_postapply$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '20260809193726',
    '20260809195802',
    '20260809201435',
    '20260809222329',
    '20260810013000',
    '20260811021601',
    '20260811151028'
  ];
  cover_trigger_count integer;
  storage_policy_count integer;
  storage_policy_catalog text[];
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions then
    raise exception 'target migration history is not the exact sealed seven-migration suffix';
  end if;

  if to_regprocedure('public.dave_delete_project_atomically(text)') is not null
      or to_regprocedure('public.dave_delete_project_atomically(text,text)') is null
      or to_regprocedure(
        'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)'
      ) is null then
    raise exception 'post-frozen function transition is incomplete';
  end if;

  if has_function_privilege(
    'public', 'public.dave_delete_project_atomically(text,text)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.dave_delete_project_atomically(text,text)', 'EXECUTE'
  ) or not has_function_privilege(
    'authenticated', 'public.dave_delete_project_atomically(text,text)', 'EXECUTE'
  ) then
    raise exception 'exact project-delete function ACL is unsafe';
  end if;
  if has_function_privilege(
    'public',
    'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'project-cover commit function ACL is unsafe';
  end if;

  select count(*)::integer into cover_trigger_count
  from pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.projects'::regclass
    and trigger_record.tgname = 'dave_project_cover_authority_guard'
    and trigger_record.tgenabled = 'O'
    and not trigger_record.tgisinternal;
  if cover_trigger_count <> 1 then
    raise exception 'project-cover authority trigger is missing or disabled';
  end if;

  select count(*)::integer into storage_policy_count
  from pg_policies policy_record
  where policy_record.schemaname = 'storage'
    and policy_record.tablename = 'objects'
    and (
      policy_record.policyname = 'project_photos_authenticated_update'
      and policy_record.cmd = 'UPDATE'
      and policy_record.roles = array['authenticated']::name[]
      and policy_record.qual like '%!~%revisions%'
      and policy_record.with_check like '%!~%revisions%'
      or policy_record.policyname = 'project_photos_authenticated_delete'
      and policy_record.cmd = 'DELETE'
      and policy_record.roles = array['authenticated']::name[]
      and policy_record.qual like '%NOT (EXISTS%coverPhoto%remotePath%'
    );
  if storage_policy_count <> 2 then
    raise exception 'immutable project-cover storage policies are incomplete';
  end if;

  select coalesce(
    array_agg(
      policy_record.policyname || ':' || policy_record.cmd || ':' || policy_record.permissive
      order by policy_record.policyname
    ),
    array[]::text[]
  ) into storage_policy_catalog
  from pg_policies policy_record
  where policy_record.schemaname = 'storage'
    and policy_record.tablename = 'objects'
    and policy_record.policyname like 'project_photos_%'
    and policy_record.cmd in ('UPDATE', 'DELETE');
  if storage_policy_catalog is distinct from array[
    'project_photos_authenticated_delete:DELETE:PERMISSIVE',
    'project_photos_authenticated_update:UPDATE:PERMISSIVE'
  ]::text[] then
    raise exception 'project-cover storage policy catalog contains an unexpected authorizer';
  end if;
end
$postfrozen_postapply$;

select jsonb_build_object(
  'receipt', 'VITRUVIUS_POSTFROZEN_POSTAPPLY_OK',
  'migrationOrder', jsonb_build_array('20260811021601', '20260811151028'),
  'legacyDeleteFunctionsPresent', 0,
  'transitionFunctionsPresent', 2,
  'coverAuthorityTriggersEnabled', 1,
  'storagePoliciesExact', 2,
  'providerCallsMadeByVerifier', 0
)::text as vitruvius_postfrozen_postapply_receipt;
