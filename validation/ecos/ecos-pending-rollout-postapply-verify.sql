-- Read-only post-apply verification for the August 9 ECOS rollout chain.
--
-- Run only after these four migrations have been applied in timestamp order.
-- The script makes no data or schema changes and fails closed on any missing
-- migration, unsafe grant, disabled trigger, changed return shape, or enabled
-- hosted-index configuration.

do $ecos_pending_rollout_verify$
declare
  pending_versions constant text[] := array[
    '20260809120133',
    '20260809121440',
    '20260809130657',
    '20260809131713'
  ];
  trigger_function record;
  status_v2_oid oid;
  present_versions text[];
  enabled_trigger_count integer;
  trigger_function_count integer := 0;
begin
  select array_agg(migration.version order by migration.version)
  into present_versions
  from supabase_migrations.schema_migrations migration
  where migration.version = any(pending_versions);
  if present_versions is distinct from pending_versions then
    raise exception
      'ECOS_POST_APPLY_FAIL: migration history is incomplete or out of order: %',
      coalesce(present_versions::text, 'NULL');
  end if;

  if exists (
    select 1
    from public.ecos_hosted_index_configuration configuration
    where configuration.enabled = true
  ) then
    raise exception
      'ECOS_POST_APPLY_FAIL: hosted indexing was enabled during the sealed rollout';
  end if;

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
      or to_regprocedure('public.ecos_hosted_index_status(text[])') is null
      or not has_function_privilege(
        'authenticated',
        'public.ecos_hosted_index_status(text[])',
        'execute'
      ) then
    raise exception
      'ECOS_POST_APPLY_FAIL: customer status v2 ACL, shape, or v1 compatibility is unsafe';
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
      ) then
    raise exception
      'ECOS_POST_APPLY_FAIL: annotation provenance helper ACL is unsafe';
  end if;

  if (
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
      'ECOS_POST_APPLY_FAIL: annotation source constraints are incomplete';
  end if;

  for trigger_function in
    select procedure.oid, procedure.proname
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'ecos_prepare_legacy_page_sheet_provenance',
        'ecos_prepare_hosted_page_sheet_provenance',
        'ecos_enrich_legacy_chunk_sheet_provenance',
        'ecos_enrich_hosted_chunk_sheet_provenance',
        'ecos_enrich_shadow_chunk_sheet_provenance'
      ])
      and procedure.prorettype = 'pg_catalog.trigger'::regtype
  loop
    trigger_function_count := trigger_function_count + 1;
    if has_function_privilege('anon', trigger_function.oid, 'execute')
        or has_function_privilege(
          'authenticated', trigger_function.oid, 'execute'
        )
        or not has_function_privilege(
          'service_role', trigger_function.oid, 'execute'
        ) then
      raise exception
        'ECOS_POST_APPLY_FAIL: trigger helper ACL is unsafe for %',
        trigger_function.proname;
    end if;
  end loop;
  if trigger_function_count <> 5 then
    raise exception
      'ECOS_POST_APPLY_FAIL: expected 5 sheet-provenance trigger helpers, found %',
      trigger_function_count;
  end if;

  if has_function_privilege(
      'anon',
      'public.ecos_gate_structured_table_shadow_search()',
      'execute'
    )
      or has_function_privilege(
        'authenticated',
        'public.ecos_gate_structured_table_shadow_search()',
        'execute'
      )
      or has_function_privilege(
        'anon',
        'public.ecos_gate_structured_table_hosted_search()',
        'execute'
      )
      or has_function_privilege(
        'authenticated',
        'public.ecos_gate_structured_table_hosted_search()',
        'execute'
      )
      or pg_get_functiondef(to_regprocedure(
        'public.ecos_gate_structured_table_shadow_search()'
      )) not like '%metadata->''searchable'' is distinct from ''true''::jsonb%'
      or pg_get_functiondef(to_regprocedure(
        'public.ecos_gate_structured_table_shadow_search()'
      )) not like '%complete-relationship-only-v1%'
      or pg_get_functiondef(to_regprocedure(
        'public.ecos_gate_structured_table_hosted_search()'
      )) not like '%metadata->''searchable'' is distinct from ''true''::jsonb%'
      or pg_get_functiondef(to_regprocedure(
        'public.ecos_gate_structured_table_hosted_search()'
      )) not like '%complete-relationship-only-v1%' then
    raise exception
      'ECOS_POST_APPLY_FAIL: structured-table gate ACL or exact-true contract is unsafe';
  end if;

  if pg_get_functiondef(to_regprocedure(
      'public.ecos_refresh_hosted_shadow_page(uuid,integer)'
    )) not like '%region.value->''searchable'' = ''true''::jsonb%'
      or pg_get_functiondef(to_regprocedure(
        'public.ecos_append_hosted_shadow_region_text(uuid,integer)'
      )) not like '%complete-relationship-only-v1%'
      or pg_get_functiondef(to_regprocedure(
        'public.ecos_commit_hosted_index_job(uuid,uuid,text)'
      )) not like '%region.value->''searchable'' = ''true''::jsonb%' then
    raise exception
      'ECOS_POST_APPLY_FAIL: source materializers do not require explicit searchable proof';
  end if;

  select count(*) into enabled_trigger_count
  from pg_trigger trigger_record
  where not trigger_record.tgisinternal
    and trigger_record.tgenabled <> 'D'
    and trigger_record.tgname = any(array[
      'ecos_prepare_legacy_page_sheet_provenance_trigger',
      'ecos_prepare_hosted_page_sheet_provenance_trigger',
      'ecos_enrich_legacy_chunk_sheet_provenance_trigger',
      'ecos_enrich_hosted_chunk_sheet_provenance_trigger',
      'ecos_enrich_shadow_chunk_sheet_provenance_trigger',
      'ecos_shadow_chunk_structured_table_search_gate',
      'ecos_hosted_chunk_structured_table_search_gate'
    ]);
  if enabled_trigger_count <> 7 then
    raise exception
      'ECOS_POST_APPLY_FAIL: expected 7 enabled provenance/gate triggers, found %',
      enabled_trigger_count;
  end if;
end;
$ecos_pending_rollout_verify$;

select jsonb_build_object(
  'status', 'PASS',
  'migration_order', jsonb_build_array(
    '20260809120133',
    '20260809121440',
    '20260809130657',
    '20260809131713'
  ),
  'enabled_hosted_configurations', 0,
  'status_v2_acl_and_shape', true,
  'status_v1_compatibility', true,
  'annotation_helper_acl_and_constraints', true,
  'trigger_function_execute_hardening', true,
  'explicit_searchable_true_contract', true,
  'enabled_provenance_and_gate_triggers', 7
) as ecos_pending_rollout_postapply_verification;
