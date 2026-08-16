-- Prevent PostgreSQL's CURRENT_USER keyword from shadowing authenticated UUID
-- variables inside the ECOS SECURITY DEFINER RPCs. The applied migrations are
-- immutable; this additive correction preserves their exact authorization and
-- evidence boundaries while giving the actor variable an unambiguous name.

begin;

create or replace function public.ecos_enqueue_hosted_index(p_document_id text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_actor uuid := auth.uid();
  source_data jsonb;
  job_id uuid;
begin
  if current_actor is null then raise exception 'Sign in is required'; end if;
  select source.document_data into source_data
  from public.reference_documents source
  where source.id::text = trim(coalesce(p_document_id, ''))
    and source.owner_id = current_actor;
  if not found then raise exception 'The project document is unavailable'; end if;
  source_data := coalesce(source_data, '{}'::jsonb);
  if source_data->>'drawingStatus' = 'Superseded' then
    raise exception 'A superseded document cannot be prepared for ECOS';
  end if;
  if coalesce(
    nullif(trim(source_data->>'projectId'), ''),
    nullif(trim(source_data->>'projectName'), ''),
    nullif(trim(source_data->'projectNames'->>0), '')
  ) is null then raise exception 'The document must be assigned to a project'; end if;
  if lower(coalesce(
    nullif(source_data->>'contentSha256', ''),
    nullif(source_data->>'webFileFingerprint', ''),
    nullif(source_data->>'indexedContentSha256', '')
  )) !~ '^[a-f0-9]{64}$' then
    raise exception 'The document source checksum is unavailable';
  end if;
  job_id := public.ecos_enqueue_hosted_reference(
    trim(p_document_id), current_actor, current_actor
  );
  if job_id is null then
    raise exception 'Document preparation is unavailable for this exact source revision';
  end if;
  return job_id;
end;
$$;

revoke all on function public.ecos_enqueue_hosted_index(text)
  from public, anon;
grant execute on function public.ecos_enqueue_hosted_index(text)
  to authenticated;

create or replace function public.ecos_activate_current_reference_document(
  p_document_id text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_actor uuid := auth.uid();
  target_record public.reference_documents%rowtype;
  target_data jsonb;
  target_category text;
  target_family text;
  activation_at timestamptz := clock_timestamp();
  changed_count integer := 0;
  persisted_updated_at timestamptz;
begin
  if current_actor is null then
    raise exception 'ecos_current_activation_target_unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_actor::text, 0));

  select source.* into target_record
  from public.reference_documents source
  where source.id::text = trim(coalesce(p_document_id, ''))
    and source.owner_id = current_actor
    and source.updated_at = p_expected_updated_at
  for update;
  if not found then
    raise exception 'ecos_current_activation_conflict';
  end if;

  target_data := coalesce(target_record.document_data, '{}'::jsonb);
  if target_data->>'drawingStatus' = 'Superseded' then
    raise exception 'ecos_current_activation_target_unavailable';
  end if;
  target_category := public.ecos_reference_document_category(
    target_record.category, target_data
  );
  target_family := public.ecos_reference_document_family(
    target_record.category, target_record.name, target_data
  );
  if not public.ecos_reference_documents_share_project(target_data, target_data) then
    raise exception 'ecos_current_activation_target_unavailable';
  end if;

  if target_category = 'drawing' then
    if nullif(trim(target_data->>'drawingNumber'), '') is null
      or nullif(trim(target_data->>'drawingRevision'), '') is null
      or not exists (
        select 1
        from public.ecos_hosted_index_jobs job
        join public.ecos_hosted_index_configuration configuration
          on configuration.organization_id = job.organization_id
         and configuration.enabled = true
        where job.document_id = target_record.id::text
          and job.source_owner_id = target_record.owner_id
          and job.state = 'ready'
          and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
          and (job.mode = 'live' or configuration.publication_mode = 'live')
          and public.ecos_hosted_job_matches_reference(job.id, false)
      ) then
      raise exception 'ecos_target_not_prepared';
    end if;
  end if;

  perform set_config('app.ecos_current_activation', 'allowed', true);

  update public.reference_documents candidate
  set document_data = jsonb_set(
        jsonb_set(
          coalesce(candidate.document_data, '{}'::jsonb),
          '{isCurrent}',
          to_jsonb(candidate.id::text = target_record.id::text),
          true
        ),
        '{updatedAt}',
        to_jsonb(activation_at::text),
        true
      ),
      updated_at = activation_at
  where candidate.owner_id = current_actor
    and public.ecos_reference_document_category(
      candidate.category, coalesce(candidate.document_data, '{}'::jsonb)
    ) = target_category
    and public.ecos_reference_document_family(
      candidate.category, candidate.name, coalesce(candidate.document_data, '{}'::jsonb)
    ) = target_family
    and public.ecos_reference_documents_share_project(
      target_data, coalesce(candidate.document_data, '{}'::jsonb)
    )
    and (
      (candidate.document_data->>'isCurrent' = 'true')
        is distinct from (candidate.id::text = target_record.id::text)
    );
  get diagnostics changed_count = row_count;
  perform set_config('app.ecos_current_activation', '', true);

  select source.updated_at into persisted_updated_at
  from public.reference_documents source
  where source.id = target_record.id
    and source.owner_id = current_actor;
  if persisted_updated_at is null then
    raise exception 'ecos_current_activation_conflict';
  end if;

  return jsonb_build_object(
    'document_id', target_record.id::text,
    'updated_at', persisted_updated_at,
    'changed_count', changed_count
  );
end;
$$;

revoke all on function public.ecos_activate_current_reference_document(text, timestamptz)
  from public, anon;
grant execute on function public.ecos_activate_current_reference_document(text, timestamptz)
  to authenticated;

create or replace function public.ecos_load_current_hosted_page_context(
  p_project_id text,
  p_document_ids text[],
  p_page_numbers integer[]
)
returns table(
  document_id text,
  page_number integer,
  sheet_number text,
  sheet_title text,
  sheet_mapping_status text,
  sheet_mapping_source text,
  sheet_mapping_evidence jsonb,
  document_structural_identity jsonb,
  page_text text,
  regions jsonb,
  visual_coverage jsonb,
  assurance_result jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '5s'
as $$
declare
  current_actor uuid := auth.uid();
  requested_project_id text := nullif(trim(coalesce(p_project_id, '')), '');
  authorized_project_name text;
begin
  if current_actor is null or not public.dave_is_app_owner() then
    raise exception 'ECOS hosted page context requires an authorized user'
      using errcode = '42501';
  end if;
  if requested_project_id is null
      or cardinality(coalesce(p_document_ids, array[]::text[])) not between 1 and 24
      or cardinality(coalesce(p_page_numbers, array[]::integer[])) not between 1 and 24
      or exists (
        select 1 from unnest(p_document_ids) requested(document_id)
        where nullif(trim(coalesce(requested.document_id, '')), '') is null
      )
      or exists (
        select 1 from unnest(p_page_numbers) requested(page_number)
        where requested.page_number not between 1 and 10000
      ) then
    raise exception 'The hosted page-context request is invalid'
      using errcode = '22023';
  end if;

  select project_record.name into authorized_project_name
  from public.projects project_record
  where project_record.id::text = requested_project_id
    and project_record.owner_id = current_actor
    and project_record.archived = false;
  if not found then
    raise exception 'The requested project is unavailable'
      using errcode = '42501';
  end if;

  return query
  with requested_documents as (
    select distinct trim(requested.document_id) as document_id
    from unnest(p_document_ids) requested(document_id)
  ), requested_pages as (
    select distinct requested.page_number
    from unnest(p_page_numbers) requested(page_number)
  ), live_candidates as (
    select
      page.document_id,
      page.page_number,
      page.sheet_number,
      page.sheet_title,
      page.sheet_mapping_status,
      page.sheet_mapping_source,
      page.sheet_mapping_evidence,
      page.document_structural_identity,
      page.page_text,
      page.regions,
      '{}'::jsonb as visual_coverage,
      page.assurance_result,
      0 as source_priority
    from public.ecos_hosted_document_pages page
    join requested_documents requested_document
      on requested_document.document_id = page.document_id
    join requested_pages requested_page
      on requested_page.page_number = page.page_number
    join public.ecos_hosted_index_jobs job
      on job.organization_id = page.organization_id
     and job.project_id = page.project_id
     and job.document_id = page.document_id
     and job.source_sha256 = page.source_sha256
     and job.mode = 'live'
     and job.state = 'ready'
     and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
     and page.evidence_version = job.committed_evidence_version
    join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = current_actor
    join public.organization_memberships membership
      on membership.organization_id = job.organization_id
     and membership.user_id = current_actor
     and membership.status = 'active'
    where page.assurance_result->>'accepted' = 'true'
      and lower(trim(job.project_id)) in (
        lower(requested_project_id), lower(trim(authorized_project_name))
      )
      and source.document_data->>'isCurrent' = 'true'
      and source.document_data->>'drawingStatus' is distinct from 'Superseded'
      and public.ecos_hosted_job_matches_reference(job.id, true)
  ), shadow_candidates as (
    select
      page.document_id,
      page.page_number,
      nullif(provenance.value->>'sheetNumber', '') as sheet_number,
      coalesce(
        nullif(page.final_page_data->>'sheetTitle', ''),
        nullif(page.final_page_data->>'title', '')
      ) as sheet_title,
      coalesce(nullif(provenance.value->>'sheetMappingStatus', ''), 'unverified') as sheet_mapping_status,
      nullif(provenance.value->>'sheetMappingSource', '') as sheet_mapping_source,
      coalesce(provenance.value->'sheetMappingEvidence', '[]'::jsonb) as sheet_mapping_evidence,
      case when jsonb_typeof(provenance.value->'documentStructuralIdentity') = 'object'
        then provenance.value->'documentStructuralIdentity' else null end as document_structural_identity,
      coalesce(
        nullif(page.final_page_data->>'text', ''),
        nullif(page.final_page_data->>'pageText', '')
      ) as page_text,
      case when jsonb_typeof(page.final_page_data->'regions') = 'array'
        then page.final_page_data->'regions' else '[]'::jsonb end as regions,
      case when jsonb_typeof(page.final_page_data->'visualCoverage') = 'object'
        then page.final_page_data->'visualCoverage' else '{}'::jsonb end as visual_coverage,
      page.assurance_result,
      1 as source_priority
    from public.ecos_hosted_index_jobs job
    join requested_documents requested_document
      on requested_document.document_id = job.document_id
    join public.ecos_hosted_index_pages page
      on page.job_id = job.id
     and page.organization_id = job.organization_id
     and page.project_id = job.project_id
     and page.document_id = job.document_id
     and page.source_sha256 = job.source_sha256
     and page.state = 'assured'
     and page.unresolved_region_count = 0
     and page.assurance_result->>'accepted' = 'true'
    join requested_pages requested_page
      on requested_page.page_number = page.page_number
    join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = current_actor
    join public.organization_memberships membership
      on membership.organization_id = job.organization_id
     and membership.user_id = current_actor
     and membership.status = 'active'
    join public.ecos_hosted_index_configuration configuration
      on configuration.organization_id = job.organization_id
     and configuration.enabled = true
     and configuration.publication_mode = 'live'
    cross join lateral (
      select public.ecos_sheet_provenance_payload(
        page.final_page_data,
        page.assurance_result,
        true
      ) as value
    ) provenance
    where job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and lower(trim(job.project_id)) in (
        lower(requested_project_id), lower(trim(authorized_project_name))
      )
      and source.document_data->>'isCurrent' = 'true'
      and source.document_data->>'drawingStatus' is distinct from 'Superseded'
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and provenance.value is not null
  ), ranked as (
    select candidate.*,
      row_number() over (
        partition by candidate.document_id, candidate.page_number
        order by candidate.source_priority
      ) as source_rank
    from (
      select * from live_candidates
      union all
      select * from shadow_candidates
    ) candidate
  )
  select
    ranked.document_id,
    ranked.page_number,
    ranked.sheet_number,
    ranked.sheet_title,
    ranked.sheet_mapping_status,
    ranked.sheet_mapping_source,
    ranked.sheet_mapping_evidence,
    ranked.document_structural_identity,
    ranked.page_text,
    ranked.regions,
    ranked.visual_coverage,
    ranked.assurance_result
  from ranked
  where ranked.source_rank = 1
  order by ranked.document_id, ranked.page_number
  limit 200;
end;
$$;

revoke all on function public.ecos_load_current_hosted_page_context(text, text[], integer[])
  from public, anon;
grant execute on function public.ecos_load_current_hosted_page_context(text, text[], integer[])
  to authenticated, service_role;

commit;
