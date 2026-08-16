do $cover_hardening_postapply$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '20260809193726', '20260809195802', '20260809201435',
    '20260809222329', '20260810013000', '20260811021601',
    '20260811151028', '20260811235642', '20260812011945'
  ];
  mutation_policy_catalog text[];
  delete_qual text;
  update_qual text;
  update_check text;
  storage_delete_guard_count integer;
  visual_dismissal_authority_count integer;
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions then
    raise exception 'target migration history is not the exact sealed nine-migration suffix';
  end if;

  select count(*)::integer into visual_dismissal_authority_count
  from pg_proc procedure_record
  join pg_namespace namespace_record
    on namespace_record.oid = procedure_record.pronamespace
  where namespace_record.nspname = 'public'
    and procedure_record.proname = 'ecos_dismiss_hosted_visual_exception_v1'
    and pg_get_function_identity_arguments(procedure_record.oid) =
      'p_job_id uuid, p_claim_token uuid, p_page_number integer, p_region_key text, p_bounds jsonb, p_reason text, p_evidence_version text, p_exception_fingerprint text, p_normalized_dismissal jsonb, p_assurance_result jsonb';
  if visual_dismissal_authority_count <> 1 or has_function_privilege(
    'public',
    'public.ecos_dismiss_hosted_visual_exception_v1(uuid,uuid,integer,text,jsonb,text,text,text,jsonb,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.ecos_dismiss_hosted_visual_exception_v1(uuid,uuid,integer,text,jsonb,text,text,text,jsonb,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.ecos_dismiss_hosted_visual_exception_v1(uuid,uuid,integer,text,jsonb,text,text,text,jsonb,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.ecos_dismiss_hosted_visual_exception_v1(uuid,uuid,integer,text,jsonb,text,text,text,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'visual dismissal authority function or ACL is unsafe';
  end if;

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

  select count(*)::integer into storage_delete_guard_count
  from pg_trigger trigger_record
  where trigger_record.tgrelid = 'storage.objects'::regclass
    and trigger_record.tgname = 'dave_project_cover_storage_delete_guard'
    and trigger_record.tgenabled = 'O'
    and not trigger_record.tgisinternal;
  if storage_delete_guard_count <> 1 then
    raise exception 'cover Storage delete guard trigger is missing or disabled';
  end if;

  select coalesce(array_agg(
    policy_record.policyname || ':' || policy_record.cmd || ':' ||
      policy_record.permissive || ':' || array_to_string(policy_record.roles, ',')
    order by policy_record.policyname, policy_record.cmd
  ), array[]::text[])
  into mutation_policy_catalog
  from pg_policies policy_record
  where policy_record.schemaname = 'storage'
    and policy_record.tablename = 'objects'
    and policy_record.cmd in ('UPDATE', 'DELETE', 'ALL');
  if mutation_policy_catalog is distinct from array[
    'pie_project_evidence_storage_update:UPDATE:PERMISSIVE:public',
    'project_documents_authenticated_delete:DELETE:PERMISSIVE:authenticated',
    'project_documents_authenticated_update:UPDATE:PERMISSIVE:authenticated',
    'project_documents_owner_delete:DELETE:PERMISSIVE:authenticated',
    'project_documents_owner_update:UPDATE:PERMISSIVE:authenticated',
    'project_photos_authenticated_delete:DELETE:PERMISSIVE:authenticated',
    'project_photos_authenticated_update:UPDATE:PERMISSIVE:authenticated'
  ]::text[] then
    raise exception 'storage mutation policy catalog contains an unexpected authorizer';
  end if;

  select lower(policy_record.qual) into delete_qual
  from pg_policies policy_record
  where policy_record.schemaname = 'storage'
    and policy_record.tablename = 'objects'
    and policy_record.policyname = 'project_photos_authenticated_delete'
    and policy_record.cmd = 'DELETE';
  select lower(policy_record.qual), lower(policy_record.with_check)
    into update_qual, update_check
  from pg_policies policy_record
  where policy_record.schemaname = 'storage'
    and policy_record.tablename = 'objects'
    and policy_record.policyname = 'project_photos_authenticated_update'
    and policy_record.cmd = 'UPDATE';
  if delete_qual not like '%project-photos%'
      or delete_qual like '% or %'
      or delete_qual like '%coverphoto%'
      or update_qual not like '%project-photos%name !~%revisions%'
      or update_check not like '%project-photos%name !~%revisions%' then
    raise exception 'project-cover immutable storage policy predicates are unsafe';
  end if;
end
$cover_hardening_postapply$;

select jsonb_build_object(
  'receipt', 'VITRUVIUS_COVER_HARDENING_POSTAPPLY_OK',
  'migrationOrder', jsonb_build_array('20260812011945'),
  'storageDeleteGuardsEnabled', 1,
  'storageMutationPoliciesExact', 7,
  'visualDismissalAuthorityEnabled', 1,
  'providerCallsMadeByVerifier', 0
)::text as vitruvius_cover_hardening_postapply_receipt;
