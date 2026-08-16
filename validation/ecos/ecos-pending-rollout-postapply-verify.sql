-- Vitruvius Build 160 read-only post-apply verification.
--
-- Run immediately after the five frozen migrations have been applied in order
-- and before enabling hosted indexing, enqueuing the controlled target, or
-- making any paid provider call. This script performs no writes. Any unsafe
-- history, catalog, ACL, trigger, data, graph, or hold state raises and prevents
-- rollout advancement.

do $ecos_build160_postapply$
declare
  required_versions constant text[] := array[
    '20260809193726',
    '20260809195802',
    '20260809201435',
    '20260809222329',
    '20260810013000'
  ];
  present_versions text[];
  procedure_oid oid;
  procedure_definition text;
  trigger_name text;
  relation_name text;
  expected_owner_predicate constant text :=
    '(( SELECT dave_is_app_owner() AS dave_is_app_owner) AND (owner_id = ( SELECT auth.uid() AS uid)))';
begin
  select array_agg(migration.version order by migration.version)
  into present_versions
  from supabase_migrations.schema_migrations migration
  where migration.version >= required_versions[1];
  if present_versions is distinct from required_versions then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: exact migration history is incomplete or out of order: %',
      coalesce(present_versions::text, 'NULL');
  end if;

  if exists (
    select 1
    from public.ecos_hosted_index_configuration configuration
    where configuration.enabled = true
  ) then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_hosted_configuration_must_remain_disabled';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('schedule_items', 'project_updates')
      and column_name = 'project_id'
      and data_type = 'text'
  ) <> 2
      or to_regclass('public.schedule_items_owner_project_id_idx') is null
      or to_regclass('public.project_updates_owner_project_id_idx') is null then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_operational_project_binding_invalid';
  end if;

  if exists (
    select 1
    from public.schedule_items operational_row
    where coalesce(operational_row.project_id, '') is distinct from
      coalesce(operational_row.item_data->>'projectId', '')
       or (
         operational_row.project_id is not null
         and (
           operational_row.project_id <> btrim(operational_row.project_id)
           or operational_row.project_id !~
             '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           or not exists (
             select 1 from public.projects exact_project
             where exact_project.id::text = operational_row.project_id
               and exact_project.owner_id = operational_row.owner_id
               and coalesce(exact_project.archived, false) = false
           )
         )
       )
  ) or exists (
    select 1
    from public.project_updates operational_row
    where coalesce(operational_row.project_id, '') is distinct from
      coalesce(operational_row.update_data->>'projectId', '')
       or (
         operational_row.project_id is not null
         and (
           operational_row.project_id <> btrim(operational_row.project_id)
           or operational_row.project_id !~
             '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           or not exists (
             select 1 from public.projects exact_project
             where exact_project.id::text = operational_row.project_id
               and exact_project.owner_id = operational_row.owner_id
               and coalesce(exact_project.archived, false) = false
           )
         )
       )
  ) then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_operational_project_binding_invalid';
  end if;

  procedure_oid := to_regprocedure(
    'public.ecos_bind_operational_row_project_id()'
  );
  if procedure_oid is null then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_operational_project_binding_invalid';
  end if;
  procedure_definition := pg_get_functiondef(procedure_oid);
  if procedure_definition not like '%ecos_operational_project_id_required%'
      or procedure_definition not like '%project_record.id::text = top_level_project_id%'
      or procedure_definition like '%matching_project_ids%'
      or procedure_definition like '%legacy_project_name%'
      or procedure_definition like '%regexp_replace(lower(btrim(project_record.name))%' then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_operational_name_fallback_survived';
  end if;

  if exists (
    select 1
    from public.reference_documents source
    where nullif(source.document_data->>'projectId', '') is not null
      and (
        source.document_data->>'projectId' <>
          btrim(source.document_data->>'projectId')
        or source.document_data->>'projectId' !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or not exists (
          select 1 from public.projects exact_project
          where exact_project.id::text = source.document_data->>'projectId'
            and exact_project.owner_id = source.owner_id
            and coalesce(exact_project.archived, false) = false
        )
      )
  ) then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_reference_project_binding_invalid';
  end if;

  if exists (
    with single_document_names as (
      select
        source.id,
        source.owner_id,
        min(project_name.canonical_name) as canonical_name
      from public.reference_documents source
      cross join lateral (
        select regexp_replace(
          lower(btrim(raw_name.project_name)), '[[:space:]]+', ' ', 'g'
        ) as canonical_name
        from (
          values (source.document_data->>'projectName')
          union all
          select listed_name.value
          from jsonb_array_elements_text(
            case when jsonb_typeof(source.document_data->'projectNames') = 'array'
              then source.document_data->'projectNames'
              else '[]'::jsonb
            end
          ) listed_name(value)
        ) raw_name(project_name)
        where btrim(coalesce(raw_name.project_name, '')) <> ''
      ) project_name
      where not exists (
        select 1 from public.projects exact_project
        where exact_project.id::text = source.document_data->>'projectId'
          and exact_project.owner_id = source.owner_id
          and coalesce(exact_project.archived, false) = false
      )
      group by source.id, source.owner_id
      having count(distinct project_name.canonical_name) = 1
    ), unique_projects as (
      select
        project_record.owner_id,
        regexp_replace(
          lower(btrim(project_record.name)), '[[:space:]]+', ' ', 'g'
        ) as canonical_name
      from public.projects project_record
      where coalesce(project_record.archived, false) = false
      group by project_record.owner_id,
        regexp_replace(
          lower(btrim(project_record.name)), '[[:space:]]+', ' ', 'g'
        )
      having count(*) = 1
    )
    select 1
    from single_document_names source_name
    join unique_projects project_record
      on project_record.owner_id = source_name.owner_id
     and project_record.canonical_name = source_name.canonical_name
  ) then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_reference_unique_name_backfill_incomplete';
  end if;

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
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_authority_key_survived_rollout';
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
  ) <> 4
      or exists (
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
      )
      or has_table_privilege('anon', 'public.reference_documents', 'select')
      or has_table_privilege('anon', 'public.reference_documents', 'insert')
      or has_table_privilege('anon', 'public.reference_documents', 'update')
      or has_table_privilege('anon', 'public.reference_documents', 'delete')
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
      )
      or exists (
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
      ) then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_reference_document_owner_rls_unsafe';
  end if;

  if exists (
    select 1
    from public.ecos_hosted_index_jobs job
    left join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = job.source_owner_id
    left join public.projects exact_project
      on exact_project.id::text = source.document_data->>'projectId'
     and exact_project.owner_id = source.owner_id
     and coalesce(exact_project.archived, false) = false
    where source.id is null
       or exact_project.id is null
       or job.project_id is distinct from source.document_data->>'projectId'
       or not public.ecos_hosted_job_matches_reference(job.id, false)
  ) or exists (
    select 1
    from public.ecos_hosted_index_pages page
    join public.ecos_hosted_index_jobs job on job.id = page.job_id
    where page.organization_id is distinct from job.organization_id
       or page.project_id is distinct from job.project_id
       or page.document_id is distinct from job.document_id
       or page.source_sha256 is distinct from job.source_sha256
  ) or exists (
    select 1
    from public.ecos_hosted_visual_exceptions exception_record
    join public.ecos_hosted_index_jobs job on job.id = exception_record.job_id
    where exception_record.organization_id is distinct from job.organization_id
       or exception_record.project_id is distinct from job.project_id
       or exception_record.document_id is distinct from job.document_id
  ) or exists (
    select 1
    from public.ecos_hosted_shadow_chunks chunk
    join public.ecos_hosted_index_jobs job on job.id = chunk.job_id
    where chunk.organization_id is distinct from job.organization_id
       or chunk.project_id is distinct from job.project_id
       or chunk.document_id is distinct from job.document_id
       or chunk.source_sha256 is distinct from job.source_sha256
  ) or exists (
    select 1
    from public.ecos_hosted_index_usage usage
    join public.ecos_hosted_index_jobs job on job.id = usage.job_id
    where usage.organization_id is distinct from job.organization_id
       or usage.project_id is distinct from job.project_id
       or usage.document_id is distinct from job.document_id
  ) or exists (
    select 1
    from public.ecos_hosted_document_pages page
    left join public.reference_documents source
      on source.id::text = page.document_id
    where source.id is null
       or page.project_id is distinct from source.document_data->>'projectId'
       or page.source_sha256 is distinct from lower(coalesce(
         nullif(source.document_data->>'contentSha256', ''),
         nullif(source.document_data->>'webFileFingerprint', ''),
         nullif(source.document_data->>'indexedContentSha256', '')
       ))
  ) or exists (
    select 1
    from public.ecos_hosted_document_chunks chunk
    left join public.ecos_hosted_document_pages page
      on page.organization_id = chunk.organization_id
     and page.document_id = chunk.document_id
     and page.page_number = chunk.page_number
    where page.document_id is null
       or chunk.project_id is distinct from page.project_id
  ) then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_noncanonical_hosted_graph_survived';
  end if;

  if exists (select 1 from public.ecos_drawing_analysis_requests)
      or exists (select 1 from public.ecos_drawing_provider_attempts) then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_provider_ledger_not_empty_before_canary';
  end if;

  foreach relation_name in array array[
    'ecos_drawing_analysis_requests',
    'ecos_drawing_provider_attempts'
  ] loop
    if not exists (
      select 1 from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = relation_name
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) or exists (
      select 1 from pg_policy policy
      where policy.polrelid = format('public.%I', relation_name)::regclass
    ) or exists (
      select 1
      from unnest(array[
        'anon', 'authenticated', 'service_role'
      ]) as role_name(value)
      cross join unnest(array[
        'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
      ]) as privilege_name(value)
      where has_table_privilege(
        role_name.value,
        format('public.%I', relation_name),
        privilege_name.value
      )
    ) then
      raise exception
        'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_provider_ledger_rls_or_policy_unsafe (%)',
        relation_name;
    end if;
  end loop;

  procedure_oid := to_regprocedure(
    'public.ecos_visual_provider_operation_id_v1(text,text,text,text,integer,uuid,uuid,text,text,text)'
  );
  if procedure_oid is null
      or has_function_privilege('anon', procedure_oid, 'execute')
      or has_function_privilege('authenticated', procedure_oid, 'execute')
      or has_function_privilege('service_role', procedure_oid, 'execute')
      or exists (
        select 1 from pg_proc procedure
        cross join lateral aclexplode(
          coalesce(procedure.proacl, acldefault('f', procedure.proowner))
        ) acl
        where procedure.oid = procedure_oid
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      ) then
    raise exception 'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_function_acl_unsafe (operation id)';
  end if;

  if public.ecos_visual_provider_operation_id_v1(
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
  ) <> '8cb03b0dda19df38df3018f308da0f33cfd1aae77f0af36c0e8b6cf3431e3ea9' then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_provider_golden_vector_mismatch';
  end if;

  foreach procedure_oid in array array[
    to_regprocedure(
      'public.ecos_begin_drawing_analysis(text,text,text,text,integer,uuid,uuid,text,text,text,text,text,text,bigint)'
    )::oid,
    to_regprocedure(
      'public.ecos_reserve_drawing_provider_attempt(uuid,text,text,integer,text,text,text)'
    )::oid,
    to_regprocedure(
      'public.ecos_finish_drawing_analysis(uuid,text,text,jsonb,text)'
    )::oid
  ] loop
    if procedure_oid is null
        or has_function_privilege('anon', procedure_oid, 'execute')
        or has_function_privilege('authenticated', procedure_oid, 'execute')
        or not has_function_privilege('service_role', procedure_oid, 'execute')
        or exists (
          select 1 from pg_proc procedure
          cross join lateral aclexplode(
            coalesce(procedure.proacl, acldefault('f', procedure.proowner))
          ) acl
          where procedure.oid = procedure_oid
            and acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
        ) then
      raise exception 'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_function_acl_unsafe (provider RPC)';
    end if;
  end loop;

  procedure_oid := to_regprocedure(
    'public.ecos_sheet_provenance_payload(jsonb,jsonb,boolean)'
  );
  if procedure_oid is null
      or has_function_privilege('anon', procedure_oid, 'execute')
      or has_function_privilege('authenticated', procedure_oid, 'execute')
      or not has_function_privilege('service_role', procedure_oid, 'execute') then
    raise exception 'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_function_acl_unsafe (annotation)';
  end if;
  procedure_definition := pg_get_functiondef(procedure_oid);
  if procedure_definition not like '%renderedCorroborated%'
      or procedure_definition not like '%renderedCorroboratingRegionIds%'
      or procedure_definition not like '%renderedCorroboratingSources%'
      or procedure_definition not like '%fixed_visual_tile_coordinate_ocr%'
      or procedure_definition not like '%title_block_ocr%' then
    raise exception 'ECOS_BUILD160_POSTAPPLY_FAIL: rendered annotation contract is incomplete';
  end if;

  procedure_oid := to_regprocedure(
    'public.ecos_load_current_hosted_page_context(text,text[],integer[])'
  );
  if procedure_oid is null
      or has_function_privilege('anon', procedure_oid, 'execute')
      or not has_function_privilege('authenticated', procedure_oid, 'execute')
      or not has_function_privilege('service_role', procedure_oid, 'execute') then
    raise exception 'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_function_acl_unsafe (page context)';
  end if;
  procedure_definition := pg_get_functiondef(procedure_oid);
  if procedure_definition not like '%job.project_id = requested_project_id%'
      or procedure_definition not like '%public.ecos_hosted_job_matches_reference(job.id, true)%'
      or lower(procedure_definition) not like '%live_job_candidates as%'
      or lower(procedure_definition) not like '%eligible_live_jobs as%'
      or lower(procedure_definition) not like
        '%count(*) over (partition by candidate.document_id)%'
      or lower(procedure_definition) not like '%candidate.exact_job_count = 1%'
      or lower(procedure_definition) not like '%checkpoint.job_id = job.job_id%'
      or lower(procedure_definition) not like
        '%checkpoint.final_page_data->''visualcoverage'' as visual_coverage%'
      or lower(procedure_definition) not like
        '%checkpoint.final_page_data#>>''{visualcoverage,sourcesha256}'' = job.source_sha256%'
      or lower(procedure_definition) not like
        '%checkpoint.final_page_data#>>''{visualcoverage,evidenceversion}'' = job.committed_evidence_version%'
      or lower(procedure_definition) not like
        '%checkpoint.final_page_data#>>''{visualcoverage,pagenumber}'' = page.page_number::text%'
      or lower(procedure_definition) not like '%shadow_job_candidates as%'
      or lower(procedure_definition) not like '%eligible_shadow_jobs as%'
      or lower(procedure_definition) not like '%page.job_id = job.job_id%'
      or lower(procedure_definition) not like
        '%page.assurance_result->>''evidenceversion'' = job.committed_evidence_version%'
      or lower(procedure_definition) not like
        '%page.final_page_data->>''sourcesha256'' = job.source_sha256%'
      or lower(procedure_definition) not like
        '%page.final_page_data->''visualcoverage'' as visual_coverage%'
      or lower(procedure_definition) not like
        '%page.final_page_data#>>''{visualcoverage,sourcesha256}'' = job.source_sha256%'
      or lower(procedure_definition) not like
        '%page.final_page_data#>>''{visualcoverage,evidenceversion}'' = job.committed_evidence_version%'
      or lower(procedure_definition) not like
        '%page.final_page_data#>>''{visualcoverage,pagenumber}'' = page.page_number::text%'
      or procedure_definition like '%document_data->>''projectName''%'
      or procedure_definition like '%document_data->''projectNames''%' then
    raise exception 'ECOS_BUILD160_POSTAPPLY_FAIL: exact page-context contract is incomplete';
  end if;

  procedure_oid := to_regprocedure(
    'public.ecos_hosted_job_matches_reference(uuid,boolean)'
  );
  if procedure_oid is null
      or has_function_privilege('anon', procedure_oid, 'execute')
      or has_function_privilege('authenticated', procedure_oid, 'execute')
      or not has_function_privilege('service_role', procedure_oid, 'execute') then
    raise exception 'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_function_acl_unsafe (exact hosted gate)';
  end if;
  procedure_definition := pg_get_functiondef(procedure_oid);
  if procedure_definition not like '%source.document_data->>''projectId'' = job.project_id%'
      or procedure_definition like '%source.document_data->>''projectName''%'
      or procedure_definition like '%source.document_data->''projectNames''%' then
    raise exception 'ECOS_BUILD160_POSTAPPLY_FAIL: exact hosted authority gate is incomplete';
  end if;

  procedure_oid := to_regprocedure(
    'public.ecos_activate_current_reference_document(text,timestamptz)'
  );
  if procedure_oid is null
      or has_function_privilege('anon', procedure_oid, 'execute')
      or not has_function_privilege('authenticated', procedure_oid, 'execute') then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_atomic_activation_contract_unsafe';
  end if;
  procedure_definition := pg_get_functiondef(procedure_oid);
  if procedure_definition not like
        '%public.ecos_reference_documents_share_project(%'
      or procedure_definition not like
        '%public.ecos_hosted_job_matches_reference(job.id, false)%'
      or procedure_definition not like '%configuration.enabled = true%'
      or procedure_definition not like
        '%perform set_config(''app.ecos_current_activation'', ''allowed'', true)%' then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_atomic_activation_contract_unsafe';
  end if;

  if to_regprocedure('public.ecos_mark_verified_index_commit()') is not null
      or exists (
        select 1 from pg_trigger trigger_record
        where trigger_record.tgname = 'ecos_mark_verified_index_commit_trigger'
          and not trigger_record.tgisinternal
      ) then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_retired_local_marker_surface_survived';
  end if;

  procedure_oid := to_regprocedure(
    'public.ecos_enqueue_hosted_reference_unchecked(text,uuid,uuid)'
  );
  if procedure_oid is null
      or has_function_privilege('anon', procedure_oid, 'execute')
      or has_function_privilege('authenticated', procedure_oid, 'execute')
      or has_function_privilege('service_role', procedure_oid, 'execute')
      or exists (
        select 1 from pg_proc procedure
        cross join lateral aclexplode(
          coalesce(procedure.proacl, acldefault('f', procedure.proowner))
        ) acl
        where procedure.oid = procedure_oid
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      ) then
    raise exception 'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_function_acl_unsafe (unchecked queue)';
  end if;

  foreach procedure_oid in array array[
    to_regprocedure('public.ecos_canonical_json_text(jsonb)')::oid,
    to_regprocedure('public.ecos_page_graph_sha256(jsonb)')::oid,
    to_regprocedure('public.ecos_build_hosted_page_graph(uuid)')::oid,
    to_regprocedure('public.ecos_reference_document_commit_identity(jsonb)')::oid,
    to_regprocedure('public.ecos_request_jwt_role()')::oid,
    to_regprocedure('public.ecos_guard_reference_document_authority_keys()')::oid,
    to_regprocedure('public.ecos_reference_documents_share_project(jsonb,jsonb)')::oid,
    to_regprocedure('public.ecos_mark_hosted_verified_index_commit()')::oid,
    to_regprocedure('public.ecos_enqueue_hosted_reference(text,uuid,uuid)')::oid
  ] loop
    if procedure_oid is null
        or has_function_privilege('anon', procedure_oid, 'execute')
        or has_function_privilege('authenticated', procedure_oid, 'execute')
        or not has_function_privilege('service_role', procedure_oid, 'execute')
        or exists (
          select 1 from pg_proc procedure
          cross join lateral aclexplode(
            coalesce(procedure.proacl, acldefault('f', procedure.proowner))
          ) acl
          where procedure.oid = procedure_oid
            and acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
        ) then
      raise exception 'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_function_acl_unsafe (authority helper)';
    end if;
  end loop;

  if public.ecos_page_graph_sha256(
    '[{"pageNumber":1,"regions":[{"height":0.05,"id":"r-1","text":"Guardrail required","width":0.4,"x":0.1,"y":0.2}],"text":"Guardrail required"}]'::jsonb
  ) <> '545b03371fb739e594b59a5edeb006654b17e3897ef443cdf36063e6626f85e7' then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_page_graph_golden_vector_mismatch';
  end if;

  procedure_definition := pg_get_functiondef(
    'public.ecos_guard_reference_document_authority_keys()'::regprocedure
  );
  if procedure_definition like '%app.ecos_hosted_commit_hydration%'
      or procedure_definition not like
        '%public.ecos_request_jwt_role() = ''service_role''%'
      or procedure_definition not like '%ecosVerifiedIndexPageGraphSha256%'
      or procedure_definition not like '%public.ecos_build_hosted_page_graph%'
      or procedure_definition not like '%public.ecos_page_graph_sha256%' then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_page_graph_receipt_guard_unsafe';
  end if;

  procedure_oid := to_regprocedure(
    'public.ecos_search_hosted_shadow_chunks(text,text[],integer)'
  );
  if procedure_oid is null
      or has_function_privilege('anon', procedure_oid, 'execute')
      or has_function_privilege('authenticated', procedure_oid, 'execute')
      or not has_function_privilege('service_role', procedure_oid, 'execute')
      or pg_get_function_result(procedure_oid) not like '%job_id uuid%'
      or pg_get_function_result(procedure_oid) not like '%organization_id text%'
      or pg_get_function_result(procedure_oid) not like '%project_id text%'
      or pg_get_function_result(procedure_oid) not like '%source_sha256 text%'
      or pg_get_function_result(procedure_oid) not like '%evidence_version text%' then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_shadow_search_authority_unsafe';
  end if;
  procedure_definition := lower(pg_get_functiondef(procedure_oid));
  if procedure_definition not like '%count(*) over (partition by candidate.document_id)%'
      or procedure_definition not like '%candidate.exact_job_count = 1%'
      or procedure_definition not like '%chunk.job_id = job.job_id%'
      or procedure_definition not like '%chunk.organization_id = job.organization_id%'
      or procedure_definition not like '%chunk.project_id = job.project_id%'
      or procedure_definition not like '%chunk.source_sha256 = job.source_sha256%' then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_shadow_search_authority_unsafe';
  end if;

  procedure_oid := to_regprocedure(
    'public.ecos_search_hosted_document_chunks(text,text[],integer)'
  );
  if procedure_oid is null
      or has_function_privilege('anon', procedure_oid, 'execute')
      or not has_function_privilege('authenticated', procedure_oid, 'execute')
      or pg_get_function_result(procedure_oid) not like '%job_id uuid%'
      or pg_get_function_result(procedure_oid) not like '%organization_id text%'
      or pg_get_function_result(procedure_oid) not like '%project_id text%'
      or pg_get_function_result(procedure_oid) not like '%source_sha256 text%'
      or pg_get_function_result(procedure_oid) not like '%evidence_version text%' then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_live_search_authority_unsafe';
  end if;
  procedure_definition := lower(pg_get_functiondef(procedure_oid));
  if procedure_definition not like '%count(*) over (partition by candidate.document_id)%'
      or procedure_definition not like '%candidate.exact_job_count = 1%'
      or procedure_definition not like '%page.source_sha256 = job.source_sha256%'
      or procedure_definition not like '%page.evidence_version = job.evidence_version%'
      or procedure_definition not like '%chunk.job_id = job.job_id%'
      or procedure_definition not like '%chunk.organization_id = job.organization_id%'
      or procedure_definition not like '%chunk.project_id = job.project_id%'
      or procedure_definition not like '%chunk.source_sha256 = job.source_sha256%' then
    raise exception
      'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_live_search_authority_unsafe';
  end if;

  foreach trigger_name in array array[
    'ecos_schedule_items_bind_project_id',
    'ecos_project_updates_bind_project_id',
    'ecos_reference_document_authority_keys_guard',
    'ecos_reference_document_atomic_current_guard',
    'ecos_reference_document_hosted_enqueue',
    'ecos_mark_hosted_verified_index_commit_insert_trigger',
    'ecos_mark_hosted_verified_index_commit_update_trigger',
    'ecos_prepare_legacy_page_sheet_provenance_trigger',
    'ecos_prepare_hosted_page_sheet_provenance_trigger',
    'ecos_enrich_legacy_chunk_sheet_provenance_trigger',
    'ecos_enrich_hosted_chunk_sheet_provenance_trigger',
    'ecos_enrich_shadow_chunk_sheet_provenance_trigger',
    'ecos_shadow_chunk_structured_table_search_gate',
    'ecos_hosted_chunk_structured_table_search_gate'
  ] loop
    if (
      select count(*)
      from pg_trigger trigger_record
      where trigger_record.tgname = trigger_name
        and trigger_record.tgenabled = 'O'
        and not trigger_record.tgisinternal
    ) <> 1 then
      raise exception
        'ECOS_BUILD160_POSTAPPLY_FAIL: ecos_required_trigger_missing_or_disabled (%)',
        trigger_name;
    end if;
  end loop;
end;
$ecos_build160_postapply$;

select jsonb_build_object(
  'receipt', 'ECOS_BUILD160_POSTAPPLY_OK',
  'migrationOrder', jsonb_build_array(
    '20260809193726',
    '20260809195802',
    '20260809201435',
    '20260809222329',
    '20260810013000'
  ),
  'hostedConfigurationsEnabled', (
    select count(*) from public.ecos_hosted_index_configuration where enabled
  ),
  'scheduleRowsBound', (
    select count(*) from public.schedule_items where project_id is not null
  ),
  'scheduleRowsDeferred', (
    select count(*) from public.schedule_items where project_id is null
  ),
  'projectUpdateRowsBound', (
    select count(*) from public.project_updates where project_id is not null
  ),
  'projectUpdateRowsDeferred', (
    select count(*) from public.project_updates where project_id is null
  ),
  'referenceDocumentsBound', (
    select count(*) from public.reference_documents
    where nullif(document_data->>'projectId', '') is not null
  ),
  'referenceDocumentsDeferred', (
    select count(*) from public.reference_documents
    where nullif(document_data->>'projectId', '') is null
  ),
  'authorityKeysPresent', 0,
  'pageGraphReceiptsPresent', 0,
  'providerRequestsBeforeCanary', 0,
  'providerAttemptsBeforeCanary', 0,
  'requiredTriggersEnabled', 14,
  'providerCallsMadeByVerifier', 0
) as ecos_build160_postapply_receipt;
