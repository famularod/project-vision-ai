-- Read-only post-apply verification for the managed-source provenance guard.
-- This verifier makes no provider calls and performs no database writes.

do $vitruvius_source_provenance_postapply$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '20260809193726', '20260809195802', '20260809201435',
    '20260809222329', '20260810013000', '20260811021601',
    '20260811151028', '20260811235642', '20260812011945',
    '20260812064107'
  ];
  canary_job_id constant uuid :=
    '3863b29a-f7c0-4188-b5fb-6aa2e6db8dd2'::uuid;
  canary_organization_id constant text := 'pie-rls-validation-org-a';
  canary_project_id constant text :=
    '72e941d8-8114-4082-a976-ae5b2b5daba9';
  canary_document_id constant text :=
    'web-document-6052f920-128e-46c5-8d93-46556e86252d';
  canary_source_sha256 constant text :=
    '7f69c250a1085df832dbda21daf4db2cfef5ae0cc21a61ecdfdb15d8884c48f6';
  canary_gcs_bucket constant text :=
    'vitruvius-project-intelligence-ecos-source-staging';
  canary_gcs_object constant text :=
    'shadow/pie-rls-validation-org-a/web-document-6052f920-128e-46c5-8d93-46556e86252d/7f69c250a1085df832dbda21daf4db2cfef5ae0cc21a61ecdfdb15d8884c48f6.pdf';
  canary_page_graph_sha256 constant text :=
    '755780777226cbae2ee9df553cb10f517a645c1ad6b2a29d903deee17f51dbf8';
  helper_oid oid;
  guard_oid oid;
  enqueue_oid oid;
  function_definition text;
  function_acl text[];
  guard_trigger_count integer;
  enqueue_trigger_count integer;
  canary_job public.ecos_hosted_index_jobs%rowtype;
  canary_page_numbers integer[];
  canary_page_count integer;
  canary_chunk_count integer;
  reference_count integer;
  reference_data jsonb;
  authoritative_page_graph jsonb;
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions then
    raise exception
      'source-provenance migration history is not the exact sealed ten-migration suffix';
  end if;

  if exists (
    select 1
    from public.ecos_hosted_index_configuration configuration
    where configuration.enabled
       or configuration.publication_mode is distinct from 'shadow'
  ) then
    raise exception 'hosted-index configuration is enabled or is not shadow-only';
  end if;
  if (
    select count(*)
    from public.ecos_hosted_index_configuration configuration
    where configuration.organization_id = canary_organization_id
      and configuration.enabled = false
      and configuration.publication_mode = 'shadow'
  ) <> 1 then
    raise exception 'exact canary hosted-index configuration is missing';
  end if;

  helper_oid := to_regprocedure(
    'public.ecos_reference_document_enqueue_identity(jsonb)'
  );
  if helper_oid is null or not exists (
    select 1
    from pg_proc procedure_record
    join pg_language language_record
      on language_record.oid = procedure_record.prolang
    where procedure_record.oid = helper_oid
      and procedure_record.prokind = 'f'
      and procedure_record.prosecdef = false
      and procedure_record.provolatile = 'i'
      and procedure_record.proconfig is not distinct from
        array['search_path=public, pg_temp']::text[]
      and language_record.lanname = 'sql'
  ) then
    raise exception 'enqueue-identity helper security or search_path is unsafe';
  end if;
  select lower(pg_get_functiondef(helper_oid)) into function_definition;
  if function_definition not like '%jsonb_strip_nulls(jsonb_build_object(%'
      or function_definition not like '%''issuperseded''%'
      or function_definition not like '%''sourceprovider''%'
      or function_definition not like '%''storagepath''%'
      or function_definition not like '%''externalsource''%'
      or function_definition not like '%''sourcepagecount''%'
      or function_definition not like '%''projectname''%'
      or function_definition not like '%''projectnames''%'
      or function_definition not like
        '%->>''sourceprovider'' = ''google_drive''%'
      or function_definition not like
        '%->''sourcepagecount''%' then
    raise exception 'enqueue-identity helper definition markers are incomplete';
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
  where procedure_record.oid = helper_oid
    and acl.grantee <> procedure_record.proowner;
  if function_acl is distinct from
      array['service_role:EXECUTE:false']::text[] then
    raise exception 'enqueue-identity helper ACL is not exact: %', function_acl;
  end if;

  guard_oid := to_regprocedure(
    'public.ecos_guard_hosted_managed_source_authority()'
  );
  if guard_oid is null or not exists (
    select 1
    from pg_proc procedure_record
    join pg_language language_record
      on language_record.oid = procedure_record.prolang
    where procedure_record.oid = guard_oid
      and procedure_record.prokind = 'f'
      and procedure_record.prosecdef = true
      and procedure_record.provolatile = 'v'
      and procedure_record.proconfig is not distinct from
        array['search_path=public, pg_temp']::text[]
      and language_record.lanname = 'plpgsql'
  ) then
    raise exception 'managed-source guard security or search_path is unsafe';
  end if;
  select lower(pg_get_functiondef(guard_oid)) into function_definition;
  if function_definition not like '%old.source_provider = ''managed_upload''%'
      or function_definition not like '%old.source_locator->>''gcsbucket''%'
      or function_definition not like '%old.source_locator->>''gcsobject''%'
      or function_definition not like
        '%clean_mutable_managed_job :=%'
      or function_definition not like
        '%old.state in (''queued'', ''reconnect_source'')%'
      or function_definition not like
        '%not clean_mutable_managed_job%'
      or function_definition not like
        '%public.ecos_hosted_index_pages%'
      or function_definition not like
        '%public.ecos_hosted_shadow_chunks%'
      or function_definition not like
        '%public.ecos_hosted_shadow_materialization_queue%'
      or function_definition not like
        '%public.ecos_hosted_visual_exceptions%'
      or function_definition not like
        '%public.ecos_hosted_index_usage%'
      or function_definition not like
        '%public.ecos_drawing_analysis_requests%'
      or function_definition not like
        '%new.source_provider := old.source_provider;%'
      or function_definition not like
        '%new.source_locator := old.source_locator;%' then
    raise exception 'managed-source guard definition markers are incomplete';
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
  where procedure_record.oid = guard_oid
    and acl.grantee <> procedure_record.proowner;
  if function_acl is distinct from array[]::text[] then
    raise exception 'managed-source guard ACL is not exact: %', function_acl;
  end if;

  enqueue_oid := to_regprocedure(
    'public.ecos_enqueue_hosted_index_from_reference_document()'
  );
  if enqueue_oid is null or not exists (
    select 1
    from pg_proc procedure_record
    join pg_language language_record
      on language_record.oid = procedure_record.prolang
    where procedure_record.oid = enqueue_oid
      and procedure_record.prokind = 'f'
      and procedure_record.prosecdef = true
      and procedure_record.provolatile = 'v'
      and procedure_record.proconfig is not distinct from
        array['search_path=public, pg_temp']::text[]
      and language_record.lanname = 'plpgsql'
  ) then
    raise exception 'reference enqueue trigger function security or search_path is unsafe';
  end if;
  select lower(pg_get_functiondef(enqueue_oid)) into function_definition;
  if function_definition not like
      '%ecos_reference_document_enqueue_identity(old.document_data)%'
      or function_definition not like
        '%ecos_reference_document_enqueue_identity(new.document_data)%'
      or function_definition not like
        '%perform public.ecos_enqueue_hosted_reference(new.id::text, new.owner_id, new.owner_id);%' then
    raise exception 'reference enqueue trigger function definition markers are incomplete';
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
    raise exception 'reference enqueue trigger function ACL is not exact: %', function_acl;
  end if;

  select count(*)::integer into guard_trigger_count
  from pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.ecos_hosted_index_jobs'::regclass
    and trigger_record.tgname = 'ecos_hosted_managed_source_authority_guard'
    and not trigger_record.tgisinternal
    and trigger_record.tgenabled = 'O'
    and trigger_record.tgfoid = guard_oid
    and trigger_record.tgtype = 19
    and (
      select array_agg(attribute_record.attname order by target_column.ordinality)
      from unnest(trigger_record.tgattr) with ordinality
        target_column(attnum, ordinality)
      join pg_attribute attribute_record
        on attribute_record.attrelid = trigger_record.tgrelid
       and attribute_record.attnum = target_column.attnum
    ) = array['source_provider', 'source_locator']::name[];
  if guard_trigger_count <> 1 then
    raise exception 'exact enabled before-update managed-source guard trigger is missing';
  end if;

  select count(*)::integer into enqueue_trigger_count
  from pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.reference_documents'::regclass
    and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
    and not trigger_record.tgisinternal
    and trigger_record.tgenabled = 'O'
    and trigger_record.tgfoid = enqueue_oid
    and trigger_record.tgtype = 21
    and (
      select array_agg(attribute_record.attname order by target_column.ordinality)
      from unnest(trigger_record.tgattr) with ordinality
        target_column(attnum, ordinality)
      join pg_attribute attribute_record
        on attribute_record.attrelid = trigger_record.tgrelid
       and attribute_record.attnum = target_column.attnum
    ) = array['document_data']::name[];
  if enqueue_trigger_count <> 1 then
    raise exception 'exact enabled reference-document enqueue trigger is missing';
  end if;

  if exists (
    select 1
    from public.ecos_hosted_index_jobs job
    where job.source_provider = 'managed_upload'
      and not (
        job.state in ('queued', 'reconnect_source')
        and job.completed_page_count = 0
        and job.assured_page_count = 0
        and job.unresolved_region_count = 0
        and job.committed_evidence_version is null
        and job.ready_at is null
        and job.claimed_by is null
        and job.claim_token is null
        and job.lease_expires_at is null
        and job.heartbeat_at is null
        and not exists (
          select 1 from public.ecos_hosted_index_pages page where page.job_id = job.id
        )
        and not exists (
          select 1 from public.ecos_hosted_shadow_chunks chunk where chunk.job_id = job.id
        )
        and not exists (
          select 1 from public.ecos_hosted_shadow_materialization_queue queue_record
          where queue_record.job_id = job.id
        )
        and not exists (
          select 1 from public.ecos_hosted_visual_exceptions exception_record
          where exception_record.job_id = job.id
        )
        and not exists (
          select 1 from public.ecos_hosted_index_usage usage_record
          where usage_record.job_id = job.id
        )
        and not exists (
          select 1 from public.ecos_drawing_analysis_requests request_record
          where request_record.hosted_job_id = job.id
        )
      )
      and (
        jsonb_typeof(job.source_locator) is distinct from 'object'
        or nullif(btrim(job.source_locator->>'gcsBucket'), '') is null
        or nullif(btrim(job.source_locator->>'gcsObject'), '') is null
      )
      and not (
        job.state in ('queued', 'reconnect_source')
        and job.completed_page_count = 0
        and job.assured_page_count = 0
        and job.unresolved_region_count = 0
        and job.committed_evidence_version is null
        and job.ready_at is null
        and job.claimed_by is null
        and job.claim_token is null
        and job.lease_expires_at is null
        and job.heartbeat_at is null
        and not exists (
          select 1 from public.ecos_hosted_index_pages page
          where page.job_id = job.id
        )
        and not exists (
          select 1 from public.ecos_hosted_shadow_chunks chunk
          where chunk.job_id = job.id
        )
        and not exists (
          select 1 from public.ecos_hosted_shadow_materialization_queue queue_record
          where queue_record.job_id = job.id
        )
        and not exists (
          select 1 from public.ecos_hosted_visual_exceptions exception_record
          where exception_record.job_id = job.id
        )
        and not exists (
          select 1 from public.ecos_hosted_index_usage usage_record
          where usage_record.job_id = job.id
        )
        and not exists (
          select 1 from public.ecos_drawing_analysis_requests request_record
          where request_record.hosted_job_id = job.id
        )
      )
  ) then
    raise exception
      'a protected managed-upload hosted job is missing exact GCS authority';
  end if;

  select job.* into canary_job
  from public.ecos_hosted_index_jobs job
  where job.id = canary_job_id;
  if not found
      or canary_job.organization_id is distinct from canary_organization_id
      or canary_job.project_id is distinct from canary_project_id
      or canary_job.document_id is distinct from canary_document_id
      or canary_job.source_sha256 is distinct from canary_source_sha256
      or canary_job.source_page_count is distinct from 6
      or canary_job.mode is distinct from 'shadow'
      or canary_job.state is distinct from 'ready'
      or canary_job.completed_page_count is distinct from 6
      or canary_job.assured_page_count is distinct from 6
      or canary_job.unresolved_region_count is distinct from 0
      or canary_job.committed_evidence_version is distinct from
        'ecos-hosted-evidence/1.3'
      or canary_job.source_provider is distinct from 'managed_upload'
      or canary_job.source_locator is distinct from jsonb_build_object(
        'gcsBucket', canary_gcs_bucket,
        'gcsObject', canary_gcs_object
      )
      or canary_job.claimed_by is not null
      or canary_job.claim_token is not null
      or canary_job.lease_expires_at is not null then
    raise exception 'exact six-page source-provenance canary job is not ready';
  end if;

  select count(*)::integer,
         array_agg(page.page_number order by page.page_number)
    into canary_page_count, canary_page_numbers
  from public.ecos_hosted_index_pages page
  where page.job_id = canary_job_id;
  if canary_page_count <> 6
      or canary_page_numbers is distinct from array[1, 2, 3, 4, 5, 6]
      or exists (
        select 1
        from public.ecos_hosted_index_pages page
        where page.job_id = canary_job_id
          and (
            page.organization_id is distinct from canary_organization_id
            or page.project_id is distinct from canary_project_id
            or page.document_id is distinct from canary_document_id
            or page.source_sha256 is distinct from canary_source_sha256
            or page.state is distinct from 'assured'
            or page.unresolved_region_count is distinct from 0
            or page.assurance_result->>'accepted' is distinct from 'true'
            or page.assurance_result->>'evidenceVersion' is distinct from
              'ecos-hosted-evidence/1.3'
            or page.final_page_data->>'sourceSha256' is distinct from
              canary_source_sha256
            or page.final_page_data->>'projectId' is distinct from
              canary_project_id
            or page.final_page_data->>'pageNumber' is distinct from
              page.page_number::text
          )
      ) then
    raise exception 'exact canary page assurance graph is incomplete';
  end if;

  if exists (
    select 1
    from public.ecos_hosted_shadow_materialization_queue queue_record
    where queue_record.job_id = canary_job_id
  ) or exists (
    select 1
    from public.ecos_hosted_visual_exceptions exception_record
    where exception_record.job_id = canary_job_id
  ) then
    raise exception 'exact canary retains a queue item or visual exception';
  end if;

  select count(*)::integer into canary_chunk_count
  from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = canary_job_id;
  if canary_chunk_count <> 113 or exists (
    select 1
    from public.ecos_hosted_shadow_chunks chunk
    where chunk.job_id = canary_job_id
      and (
        chunk.organization_id is distinct from canary_organization_id
        or chunk.project_id is distinct from canary_project_id
        or chunk.document_id is distinct from canary_document_id
        or chunk.source_sha256 is distinct from canary_source_sha256
        or chunk.page_number not between 1 and 6
      )
  ) then
    raise exception 'exact canary shadow materialization is not 113 bound chunks';
  end if;

  select count(*)::integer into reference_count
  from public.reference_documents source
  where source.id::text = canary_document_id
    and source.owner_id = canary_job.source_owner_id;
  if reference_count <> 1 then
    raise exception 'exact canary reference document is missing or duplicated';
  end if;
  select source.document_data into strict reference_data
  from public.reference_documents source
  where source.id::text = canary_document_id
    and source.owner_id = canary_job.source_owner_id;
  if reference_data->>'projectId' is distinct from canary_project_id
      or reference_data->>'contentSha256' is distinct from canary_source_sha256
      or reference_data->>'indexedContentSha256' is distinct from
        canary_source_sha256
      or reference_data->>'ecosVerifiedIndexCommitVersion' is distinct from
        'ecos-verified-index-commit/1.0'
      or reference_data->>'ecosVerifiedIndexCommittedSha256' is distinct from
        canary_source_sha256
      or reference_data->>'ecosVerifiedIndexCommittedPageCount' is distinct from '6'
      or reference_data->>'ecosVerifiedIndexPageGraphSha256' is distinct from
        canary_page_graph_sha256
      or not public.ecos_hosted_job_matches_reference(canary_job_id, true) then
    raise exception 'exact canary reference authority receipt is incomplete';
  end if;

  authoritative_page_graph :=
    public.ecos_build_hosted_page_graph(canary_job_id);
  if jsonb_typeof(authoritative_page_graph) is distinct from 'array'
      or jsonb_array_length(authoritative_page_graph) <> 6
      or public.ecos_page_graph_sha256(authoritative_page_graph)
        is distinct from canary_page_graph_sha256
      or public.ecos_page_graph_sha256(reference_data->'extractedPages')
        is distinct from canary_page_graph_sha256 then
    raise exception 'exact canary reference page graph digest is not authoritative';
  end if;
end
$vitruvius_source_provenance_postapply$;

select jsonb_build_object(
  'receipt', 'VITRUVIUS_SOURCE_PROVENANCE_POSTAPPLY_OK',
  'migrationOrder', jsonb_build_array(
    '20260809193726', '20260809195802', '20260809201435',
    '20260809222329', '20260810013000', '20260811021601',
    '20260811151028', '20260811235642', '20260812011945',
    '20260812064107'
  ),
  'hostedConfigurationsEnabled', 0,
  'nonShadowConfigurations', 0,
  'managedSourceGuardTriggersEnabled', 1,
  'referenceEnqueueTriggersEnabled', 1,
  'protectedManagedUploadJobsMissingGcsAuthority', 0,
  'canaryJobId', '3863b29a-f7c0-4188-b5fb-6aa2e6db8dd2',
  'canaryPagesAssured', 6,
  'canaryShadowChunks', 113,
  'canaryQueueItems', 0,
  'canaryVisualExceptions', 0,
  'referencePageGraphSha256',
    '755780777226cbae2ee9df553cb10f517a645c1ad6b2a29d903deee17f51dbf8',
  'providerCallsMadeByVerifier', 0
)::text as vitruvius_source_provenance_postapply_receipt;
