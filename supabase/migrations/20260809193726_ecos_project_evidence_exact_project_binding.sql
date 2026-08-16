begin;

alter table public.schedule_items
  add column if not exists project_id text;

alter table public.project_updates
  add column if not exists project_id text;

create index if not exists schedule_items_owner_project_id_idx
  on public.schedule_items (owner_id, project_id);

create index if not exists project_updates_owner_project_id_idx
  on public.project_updates (owner_id, project_id);

-- Backfill only from an immutable id already persisted in the canonical
-- payload. Display names are not authority: name-only, malformed, foreign,
-- and archived-project rows remain unbound and therefore quarantined from
-- exact-project evidence until a producer supplies a valid id pair.
update public.schedule_items operational_row
set project_id = operational_row.item_data->>'projectId'
where operational_row.project_id is null
  and jsonb_typeof(operational_row.item_data) = 'object'
  and jsonb_typeof(operational_row.item_data->'projectId') = 'string'
  and operational_row.item_data->>'projectId' ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.projects project_record
    where project_record.id::text = operational_row.item_data->>'projectId'
      and project_record.owner_id = operational_row.owner_id
      and coalesce(project_record.archived, false) = false
  );

update public.project_updates operational_row
set project_id = operational_row.update_data->>'projectId'
where operational_row.project_id is null
  and jsonb_typeof(operational_row.update_data) = 'object'
  and jsonb_typeof(operational_row.update_data->'projectId') = 'string'
  and operational_row.update_data->>'projectId' ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.projects project_record
    where project_record.id::text = operational_row.update_data->>'projectId'
      and project_record.owner_id = operational_row.owner_id
      and coalesce(project_record.archived, false) = false
  );

create or replace function public.ecos_bind_operational_row_project_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payload jsonb := to_jsonb(new)->tg_argv[0];
  top_level_project_id text := to_jsonb(new)->>'project_id';
  payload_project_id_value jsonb := payload->'projectId';
  payload_project_id text := payload->>'projectId';
begin
  if top_level_project_id is null
      or top_level_project_id = ''
      or payload_project_id_value is null
      or payload_project_id_value = 'null'::jsonb
      or payload_project_id is null
      or payload_project_id = '' then
    raise exception 'ecos_operational_project_id_required'
      using errcode = '23514';
  end if;

  if jsonb_typeof(payload) is distinct from 'object'
      or jsonb_typeof(payload_project_id_value) is distinct from 'string'
      or top_level_project_id <> btrim(top_level_project_id)
      or payload_project_id <> btrim(payload_project_id)
      or top_level_project_id !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or payload_project_id !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'ecos_operational_project_id_invalid'
      using errcode = '23514';
  end if;

  if top_level_project_id is distinct from payload_project_id then
    raise exception 'ecos_operational_project_id_mismatch'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.projects project_record
    where project_record.id::text = top_level_project_id
      and project_record.owner_id = new.owner_id
      and coalesce(project_record.archived, false) = false
  ) then
    raise exception 'ecos_operational_project_id_invalid'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.ecos_bind_operational_row_project_id() from public;

drop trigger if exists ecos_schedule_items_bind_project_id on public.schedule_items;
create trigger ecos_schedule_items_bind_project_id
before insert or update of project_id, project_name, item_data
on public.schedule_items
for each row execute function public.ecos_bind_operational_row_project_id('item_data');

drop trigger if exists ecos_project_updates_bind_project_id on public.project_updates;
create trigger ecos_project_updates_bind_project_id
before insert or update of project_id, project_name, update_data
on public.project_updates
for each row execute function public.ecos_bind_operational_row_project_id('update_data');

-- Replace the hosted Ask page-context loader so neither its live nor shadow
-- branch can reinterpret a project display name as an immutable project id.
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
  requested_project_id text := coalesce(p_project_id, '');
begin
  if current_actor is null or not public.dave_is_app_owner() then
    raise exception 'ECOS hosted page context requires an authorized user'
      using errcode = '42501';
  end if;
  if requested_project_id = ''
      or requested_project_id <> btrim(requested_project_id)
      or cardinality(coalesce(p_document_ids, array[]::text[])) not between 1 and 24
      or cardinality(coalesce(p_page_numbers, array[]::integer[])) not between 1 and 24
      or exists (
        select 1 from unnest(p_document_ids) requested(document_id)
        where coalesce(requested.document_id, '') = ''
           or requested.document_id <> btrim(requested.document_id)
      )
      or exists (
        select 1 from unnest(p_page_numbers) requested(page_number)
        where requested.page_number not between 1 and 10000
      ) then
    raise exception 'The hosted page-context request is invalid'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.projects project_record
    where project_record.id::text = requested_project_id
      and project_record.owner_id = current_actor
      and coalesce(project_record.archived, false) = false
  ) then
    raise exception 'The requested project is unavailable'
      using errcode = '42501';
  end if;

  return query
  with requested_documents as (
    select distinct requested.document_id
    from unnest(p_document_ids) requested(document_id)
  ), requested_pages as (
    select distinct requested.page_number
    from unnest(p_page_numbers) requested(page_number)
  ), live_job_candidates as (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.document_id,
      job.source_sha256,
      job.committed_evidence_version
    from public.ecos_hosted_index_jobs job
    join requested_documents requested_document
      on requested_document.document_id = job.document_id
    join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = current_actor
    join public.organization_memberships membership
      on membership.organization_id = job.organization_id
     and membership.user_id = current_actor
     and membership.status = 'active'
    where job.mode = 'live'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and job.project_id = requested_project_id
      and source.document_data->>'isCurrent' = 'true'
      and source.document_data->>'drawingStatus' is distinct from 'Superseded'
      and public.ecos_hosted_job_matches_reference(job.id, true)
  ), eligible_live_jobs as (
    -- The durable organization key can be absent for pre-Build-160 rows. In
    -- that compatibility case the authority helper admits an active owner
    -- membership, which may expose two otherwise exact jobs in two
    -- organizations. Never select one by recency or planner order.
    select candidate.*
    from (
      select candidate.*,
        count(*) over (partition by candidate.document_id) as exact_job_count
      from live_job_candidates candidate
    ) candidate
    where candidate.exact_job_count = 1
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
      checkpoint.final_page_data->'visualCoverage' as visual_coverage,
      page.assurance_result,
      0 as source_priority
    from eligible_live_jobs job
    join public.ecos_hosted_document_pages page
      on page.organization_id = job.organization_id
     and page.project_id = job.project_id
     and page.document_id = job.document_id
     and page.source_sha256 = job.source_sha256
     and page.evidence_version = job.committed_evidence_version
    join requested_pages requested_page
      on requested_page.page_number = page.page_number
    join public.ecos_hosted_index_pages checkpoint
      on checkpoint.job_id = job.job_id
     and checkpoint.organization_id = job.organization_id
     and checkpoint.project_id = job.project_id
     and checkpoint.document_id = page.document_id
     and checkpoint.source_sha256 = job.source_sha256
     and checkpoint.page_number = page.page_number
     and checkpoint.state = 'assured'
     and checkpoint.unresolved_region_count = 0
     and checkpoint.assurance_result->>'accepted' = 'true'
    where page.assurance_result->>'accepted' = 'true'
      and page.assurance_result->>'evidenceVersion' = job.committed_evidence_version
      and checkpoint.assurance_result->>'evidenceVersion' = job.committed_evidence_version
      and jsonb_typeof(checkpoint.final_page_data->'visualCoverage') = 'object'
      and checkpoint.final_page_data#>>'{visualCoverage,sourceSha256}' = job.source_sha256
      and checkpoint.final_page_data#>>'{visualCoverage,evidenceVersion}' = job.committed_evidence_version
      and checkpoint.final_page_data#>>'{visualCoverage,pageNumber}' = page.page_number::text
  ), shadow_job_candidates as (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.document_id,
      job.source_sha256,
      job.committed_evidence_version
    from public.ecos_hosted_index_jobs job
    join requested_documents requested_document
      on requested_document.document_id = job.document_id
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
    where job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and job.project_id = requested_project_id
      and source.document_data->>'isCurrent' = 'true'
      and source.document_data->>'drawingStatus' is distinct from 'Superseded'
      and public.ecos_hosted_job_matches_reference(job.id, true)
  ), eligible_shadow_jobs as (
    -- A pre-Build-160 row without a durable organization id may match active
    -- memberships in more than one organization. A same-priority shadow tie
    -- is not authority, so suppress every candidate for that document.
    select candidate.*
    from (
      select candidate.*,
        count(*) over (partition by candidate.document_id) as exact_job_count
      from shadow_job_candidates candidate
    ) candidate
    where candidate.exact_job_count = 1
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
      page.final_page_data->'visualCoverage' as visual_coverage,
      page.assurance_result,
      1 as source_priority
    from eligible_shadow_jobs job
    join public.ecos_hosted_index_pages page
      on page.job_id = job.job_id
     and page.organization_id = job.organization_id
     and page.project_id = job.project_id
     and page.document_id = job.document_id
     and page.source_sha256 = job.source_sha256
     and page.state = 'assured'
     and page.unresolved_region_count = 0
     and page.assurance_result->>'accepted' = 'true'
     and page.assurance_result->>'evidenceVersion' = job.committed_evidence_version
     and page.final_page_data->>'sourceSha256' = job.source_sha256
     and jsonb_typeof(page.final_page_data->'visualCoverage') = 'object'
     and page.final_page_data#>>'{visualCoverage,sourceSha256}' = job.source_sha256
     and page.final_page_data#>>'{visualCoverage,evidenceVersion}' = job.committed_evidence_version
     and page.final_page_data#>>'{visualCoverage,pageNumber}' = page.page_number::text
    join requested_pages requested_page
      on requested_page.page_number = page.page_number
    cross join lateral (
      select public.ecos_sheet_provenance_payload(
        page.final_page_data,
        page.assurance_result,
        true
      ) as value
    ) provenance
    where provenance.value is not null
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
