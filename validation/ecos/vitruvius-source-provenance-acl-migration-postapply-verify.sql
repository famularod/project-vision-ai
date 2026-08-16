-- Read-only post-apply verification for the source-provenance trigger ACL fix.

do $vitruvius_source_provenance_acl_postapply$
declare
  expected_versions constant text[] := array[
    '20260809193726', '20260809195802', '20260809201435',
    '20260809222329', '20260810013000', '20260811021601',
    '20260811151028', '20260811235642', '20260812011945',
    '20260812064107', '20260812075338'
  ];
  actual_versions text[];
  enqueue_oid oid := to_regprocedure(
    'public.ecos_enqueue_hosted_index_from_reference_document()'
  );
  guard_oid oid := to_regprocedure(
    'public.ecos_guard_hosted_managed_source_authority()'
  );
  function_acl text[];
  application_role text;
  enqueue_trigger_count integer;
  enqueue_binding_count integer;
  guard_trigger_count integer;
  canary_job public.ecos_hosted_index_jobs%rowtype;
  canary_page_count integer;
  canary_page_numbers integer[];
  canary_chunk_count integer;
  reference_data jsonb;
  authoritative_page_graph jsonb;
  canary_job_id constant uuid :=
    '3863b29a-f7c0-4188-b5fb-6aa2e6db8dd2'::uuid;
  canary_organization_id constant text := 'pie-rls-validation-org-a';
  canary_project_id constant text :=
    '72e941d8-8114-4082-a976-ae5b2b5daba9';
  canary_document_id constant text :=
    'web-document-6052f920-128e-46c5-8d93-46556e86252d';
  canary_source_sha256 constant text :=
    '7f69c250a1085df832dbda21daf4db2cfef5ae0cc21a61ecdfdb15d8884c48f6';
  canary_page_graph_sha256 constant text :=
    '755780777226cbae2ee9df553cb10f517a645c1ad6b2a29d903deee17f51dbf8';
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions then
    raise exception
      'source-provenance ACL postapply requires exact eleven-migration tip';
  end if;

  if exists (
    select 1
    from public.ecos_hosted_index_configuration configuration
    where configuration.enabled
       or configuration.publication_mode is distinct from 'shadow'
  ) then
    raise exception
      'source-provenance ACL postapply requires disabled shadow configuration';
  end if;
  if (
    select count(*)
    from public.ecos_hosted_index_configuration configuration
    where configuration.organization_id = canary_organization_id
      and configuration.enabled = false
      and configuration.publication_mode = 'shadow'
  ) <> 1 then
    raise exception
      'source-provenance ACL postapply exact canary configuration missing';
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
      'source-provenance ACL postapply function definition is not exact';
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
      'source-provenance ACL postapply retained a non-owner grant:%',
      function_acl;
  end if;
  foreach application_role in array array[
    'public', 'anon', 'authenticated', 'service_role', 'authenticator'
  ]::text[] loop
    if has_function_privilege(application_role, enqueue_oid, 'EXECUTE') then
      raise exception
        'source-provenance ACL postapply retained effective execute for %',
        application_role;
    end if;
  end loop;

  select count(*)::integer into enqueue_trigger_count
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
  select count(*)::integer into enqueue_binding_count
  from pg_trigger trigger_record
  where trigger_record.tgfoid = enqueue_oid
    and not trigger_record.tgisinternal;
  if enqueue_trigger_count <> 1 or enqueue_binding_count <> 1 then
    raise exception
      'source-provenance ACL postapply trigger binding is not exact';
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
  if guard_oid is null or guard_trigger_count <> 1 then
    raise exception
      'source-provenance ACL postapply managed-source guard is not exact';
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
      and (
        jsonb_typeof(job.source_locator) is distinct from 'object'
        or nullif(btrim(job.source_locator->>'gcsBucket'), '') is null
        or nullif(btrim(job.source_locator->>'gcsObject'), '') is null
      )
  ) then
    raise exception
      'source-provenance ACL postapply provider authority matrix is invalid';
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
        'gcsBucket', 'vitruvius-project-intelligence-ecos-source-staging',
        'gcsObject',
          'shadow/pie-rls-validation-org-a/' || canary_document_id || '/' ||
          canary_source_sha256 || '.pdf'
      )
      or canary_job.claimed_by is not null
      or canary_job.claim_token is not null
      or canary_job.lease_expires_at is not null then
    raise exception 'source-provenance ACL postapply exact canary is not ready';
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
    raise exception
      'source-provenance ACL postapply canary assurance graph is incomplete';
  end if;
  if exists (
    select 1 from public.ecos_hosted_shadow_materialization_queue queue_record
    where queue_record.job_id = canary_job_id
  ) or exists (
    select 1 from public.ecos_hosted_visual_exceptions exception_record
    where exception_record.job_id = canary_job_id
  ) then
    raise exception
      'source-provenance ACL postapply canary queue/exception is not empty';
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
    raise exception
      'source-provenance ACL postapply canary shadow chunk count changed';
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
    raise exception
      'source-provenance ACL postapply reference authority is incomplete';
  end if;
  authoritative_page_graph := public.ecos_build_hosted_page_graph(canary_job_id);
  if jsonb_typeof(authoritative_page_graph) is distinct from 'array'
      or jsonb_array_length(authoritative_page_graph) <> 6
      or public.ecos_page_graph_sha256(authoritative_page_graph) is distinct from
        canary_page_graph_sha256
      or public.ecos_page_graph_sha256(reference_data->'extractedPages') is distinct from
        canary_page_graph_sha256 then
    raise exception
      'source-provenance ACL postapply reference page graph changed';
  end if;
  if exists (select 1 from public.ecos_hosted_document_pages)
      or exists (select 1 from public.ecos_hosted_document_chunks) then
    raise exception
      'source-provenance ACL postapply found unexpected live publication';
  end if;
end
$vitruvius_source_provenance_acl_postapply$;

select jsonb_build_object(
  'receipt', 'VITRUVIUS_SOURCE_PROVENANCE_ACL_POSTAPPLY_OK',
  'migrationOrder', jsonb_build_array(
    '20260809193726', '20260809195802', '20260809201435',
    '20260809222329', '20260810013000', '20260811021601',
    '20260811151028', '20260811235642', '20260812011945',
    '20260812064107', '20260812075338'
  ),
  'hostedConfigurationsEnabled', 0,
  'nonShadowConfigurations', 0,
  'referenceEnqueueFunctionNonOwnerGrants', 0,
  'managedSourceGuardTriggersEnabled', 1,
  'referenceEnqueueTriggersEnabled', 1,
  'referenceEnqueueFunctionBindings', 1,
  'serviceRoleDirectExecutePrivilege', false,
  'protectedManagedUploadJobsMissingGcsAuthority', 0,
  'canaryJobId', '3863b29a-f7c0-4188-b5fb-6aa2e6db8dd2',
  'canaryPagesAssured', 6,
  'canaryShadowChunks', 113,
  'canaryQueueItems', 0,
  'canaryVisualExceptions', 0,
  'referencePageGraphSha256',
    '755780777226cbae2ee9df553cb10f517a645c1ad6b2a29d903deee17f51dbf8',
  'livePublishedPages', 0,
  'livePublishedChunks', 0,
  'providerCallsMadeByVerifier', 0
)::text as vitruvius_source_provenance_acl_postapply_receipt;
