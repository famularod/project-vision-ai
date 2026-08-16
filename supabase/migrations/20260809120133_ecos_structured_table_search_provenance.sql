-- ECOS structured-table searchable provenance and fail-closed materialization
--
-- The hosted worker retains raw coordinate constituents in final_page_data so
-- Assurance can replay each deterministic table relationship. Those regions
-- are explicitly marked `searchable: false`; only a complete, non-conflicted
-- relationship is emitted as `deterministic_structured_table_relationship`.
-- This migration preserves that boundary when page JSON becomes search rows.

begin;

create or replace function public.ecos_enrich_shadow_chunk_provenance()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  source_region jsonb;
  source_region_id text := nullif(trim(new.metadata->>'sourceRegionId'), '');
  raw_source text := coalesce(
    nullif(trim(new.metadata->>'rawSource'), ''),
    nullif(trim(new.metadata->>'source'), ''),
    ''
  );
begin
  if coalesce(new.metadata->>'materialization', '') = 'structured_visual_fact'
    and new.metadata ? 'searchable' then
    return new;
  end if;
  if raw_source not in (
    'deterministic_label_block',
    'deterministic_structured_table_relationship'
  ) and source_region_id is null then
    return new;
  end if;

  select region.value into source_region
  from public.ecos_hosted_index_pages page
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(page.final_page_data->'regions') = 'array'
      then page.final_page_data->'regions' else '[]'::jsonb end
  ) with ordinality region(value, ordinality)
  where page.job_id = new.job_id
    and page.page_number = new.page_number
    and (
      (source_region_id is not null and region.value->>'id' = source_region_id)
      or 'visual-' || region.ordinality::text = new.region_id
      or coalesce(nullif(trim(region.value->>'id'), ''), 'region-' || region.ordinality::text) = new.region_id
    )
  order by case when source_region_id is not null and region.value->>'id' = source_region_id
    then 0 else 1 end
  limit 1;

  if source_region is null then return new; end if;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'rawSource', nullif(trim(source_region->>'source'), ''),
    'reconstructionMethod', source_region->'reconstructionMethod',
    'evidenceSources', source_region->'evidenceSources',
    'constituentEvidence', source_region->'constituentEvidence',
    'corroboratingEvidence', source_region->'corroboratingEvidence',
    'structuredRelationshipId', source_region->'structuredRelationshipId',
    'structuredTableBlockId', source_region->'structuredTableBlockId',
    'structuredTableRelationshipType', source_region->'structuredTableRelationshipType',
    'structuredTableRowKey', source_region->'structuredTableRowKey'
  ));
  return new;
end;
$$;

create or replace function public.ecos_enrich_hosted_chunk_provenance()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  source_region jsonb;
  raw_source text := coalesce(
    nullif(trim(new.metadata->>'rawSource'), ''),
    nullif(trim(new.metadata->>'source'), ''),
    ''
  );
begin
  if coalesce(new.metadata->>'materialization', '') = 'hosted_region'
    and new.metadata ? 'searchable' then
    return new;
  end if;
  if raw_source not in (
    'deterministic_label_block',
    'deterministic_structured_table_relationship'
  ) or nullif(trim(new.region_id), '') is null then
    return new;
  end if;

  select region.value into source_region
  from public.ecos_hosted_document_pages page
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(page.regions) = 'array' then page.regions else '[]'::jsonb end
  ) region(value)
  where page.organization_id = new.organization_id
    and page.document_id = new.document_id
    and page.page_number = new.page_number
    and region.value->>'id' = new.region_id
  limit 1;

  if source_region is null then return new; end if;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'rawSource', nullif(trim(source_region->>'source'), ''),
    'reconstructionMethod', source_region->'reconstructionMethod',
    'evidenceSources', source_region->'evidenceSources',
    'constituentEvidence', source_region->'constituentEvidence',
    'corroboratingEvidence', source_region->'corroboratingEvidence',
    'structuredRelationshipId', source_region->'structuredRelationshipId',
    'structuredTableBlockId', source_region->'structuredTableBlockId',
    'structuredTableRelationshipType', source_region->'structuredTableRelationshipType',
    'structuredTableRowKey', source_region->'structuredTableRowKey'
  ));
  return new;
end;
$$;

create or replace function public.ecos_enrich_legacy_chunk_provenance()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  source_region jsonb;
  raw_source text := coalesce(
    nullif(trim(new.metadata->>'rawSource'), ''),
    nullif(trim(new.metadata->>'source'), ''),
    ''
  );
begin
  if raw_source not in (
    'deterministic_label_block',
    'deterministic_structured_table_relationship'
  ) or nullif(trim(new.region_id), '') is null then
    return new;
  end if;

  select region.value into source_region
  from public.ecos_document_pages page
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(page.regions) = 'array' then page.regions else '[]'::jsonb end
  ) region(value)
  where page.owner_id = new.owner_id
    and page.document_id = new.document_id
    and page.page_number = new.page_number
    and region.value->>'id' = new.region_id
  limit 1;

  if source_region is null then return new; end if;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'rawSource', nullif(trim(source_region->>'source'), ''),
    'reconstructionMethod', source_region->'reconstructionMethod',
    'evidenceSources', source_region->'evidenceSources',
    'constituentEvidence', source_region->'constituentEvidence',
    'corroboratingEvidence', source_region->'corroboratingEvidence',
    'structuredRelationshipId', source_region->'structuredRelationshipId',
    'structuredTableBlockId', source_region->'structuredTableBlockId',
    'structuredTableRelationshipType', source_region->'structuredTableRelationshipType',
    'structuredTableRowKey', source_region->'structuredTableRowKey'
  ));
  return new;
end;
$$;

create or replace function public.ecos_refresh_hosted_shadow_page(
  p_job_id uuid,
  p_page_number integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
  structured_count integer := 0;
begin
  delete from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = p_job_id and chunk.page_number = p_page_number;

  with eligible_page as (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.document_id,
      job.source_sha256,
      page.page_number,
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end as sheet_number,
      coalesce(page.final_page_data->>'sheetMappingStatus', 'unverified') as sheet_mapping_status,
      coalesce(page.final_page_data->>'sheetTitle', page.final_page_data->>'title') as sheet_title,
      page.assurance_result,
      nullif(trim(page.final_page_data->>'text'), '') as search_text
    from public.ecos_hosted_index_jobs job
    join public.ecos_hosted_index_pages page
      on page.job_id = job.id and page.page_number = p_page_number
    where job.id = p_job_id
      and job.mode = 'shadow'
      and page.state = 'assured'
      and page.assurance_result->>'accepted' = 'true'
      and page.unresolved_region_count = 0
      and public.ecos_hosted_job_matches_reference(job.id, false)
  ), page_chunks as (
    select
      eligible.*,
      chunk_index,
      substring(eligible.search_text from 1 + chunk_index * 3200 for 3500) as chunk_text
    from eligible_page eligible
    cross join lateral generate_series(
      0,
      greatest(0, ceil((length(eligible.search_text) - 3500) / 3200.0)::integer)
    ) chunk_index
    where length(trim(coalesce(eligible.search_text, ''))) > 0
  )
  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata, indexed_at
  )
  select
    page_chunks.job_id,
    page_chunks.organization_id,
    page_chunks.project_id,
    page_chunks.document_id,
    page_chunks.source_sha256,
    page_chunks.page_number,
    'page-text-' || page_chunks.chunk_index::text,
    page_chunks.chunk_index,
    page_chunks.chunk_text,
    page_chunks.sheet_number,
    null,
    jsonb_build_object(
      'pageText', true,
      'searchable', true,
      'sheetMappingStatus', page_chunks.sheet_mapping_status,
      'sheetTitle', page_chunks.sheet_title,
      'pageIdentity', concat_ws(' — ',
        case when page_chunks.sheet_mapping_status = 'verified'
          then 'Sheet ' || page_chunks.sheet_number
          else 'PDF page ' || page_chunks.page_number::text end,
        page_chunks.sheet_title
      ),
      'assurance', page_chunks.assurance_result,
      'shadowValidation', true,
      'structuredSearchContract', 'complete-relationship-only-v1',
      'materialization', 'overlapping_page_text'
    ),
    now()
  from page_chunks
  where length(trim(page_chunks.chunk_text)) > 0;
  get diagnostics inserted_count = row_count;

  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata, indexed_at
  )
  select
    job.id,
    job.organization_id,
    job.project_id,
    job.document_id,
    job.source_sha256,
    page.page_number,
    'visual-' || region.ordinality::text,
    region.ordinality::integer,
    left(trim(concat_ws(' ',
      nullif(trim(region.value->>'text'), ''),
      nullif(trim(region.value->>'label'), ''),
      nullif(trim(region.value->>'subject'), ''),
      nullif(trim(region.value->>'location'), ''),
      nullif(trim(region.value->>'evidenceText'), ''),
      nullif(trim(region.value->>'fact'), '')
    )), 4000),
    case when page.final_page_data->>'sheetMappingStatus' = 'verified'
      then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end,
    case when (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
      then (region.value->>'confidence')::numeric else null end,
    jsonb_build_object(
      'x', region.value->'x',
      'y', region.value->'y',
      'width', region.value->'width',
      'height', region.value->'height',
      'source', coalesce(region.value->'source', '"vision"'::jsonb),
      'rawSource', region.value->'source',
      'sourceRegionId', region.value->'id',
      'searchable', region.value->'searchable',
      'areaNames', coalesce(region.value->'areaNames', '[]'::jsonb),
      'factKind', region.value->'factKind',
      'subject', region.value->'subject',
      'location', region.value->'location',
      'evidenceText', region.value->'evidenceText',
      'reconstructionMethod', region.value->'reconstructionMethod',
      'evidenceSources', region.value->'evidenceSources',
      'constituentEvidence', region.value->'constituentEvidence',
      'corroboratingEvidence', region.value->'corroboratingEvidence',
      'structuredRelationshipId', region.value->'structuredRelationshipId',
      'structuredTableBlockId', region.value->'structuredTableBlockId',
      'structuredTableRelationshipType', region.value->'structuredTableRelationshipType',
      'structuredTableRowKey', region.value->'structuredTableRowKey',
      'sheetMappingStatus', coalesce(page.final_page_data->>'sheetMappingStatus', 'unverified'),
      'sheetTitle', coalesce(page.final_page_data->>'sheetTitle', page.final_page_data->>'title'),
      'pageIdentity', concat_ws(' — ',
        case when page.final_page_data->>'sheetMappingStatus' = 'verified'
          then 'Sheet ' || nullif(trim(page.final_page_data->>'sheetNumber'), '')
          else 'PDF page ' || page.page_number::text end,
        coalesce(page.final_page_data->>'sheetTitle', page.final_page_data->>'title')
      ),
      'assurance', page.assurance_result,
      'shadowValidation', true,
      'structuredSearchContract', 'complete-relationship-only-v1',
      'materialization', 'structured_visual_fact'
    ),
    now()
  from public.ecos_hosted_index_jobs job
  join public.ecos_hosted_index_pages page
    on page.job_id = job.id and page.page_number = p_page_number
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(page.final_page_data->'regions') = 'array'
      then page.final_page_data->'regions' else '[]'::jsonb end
  ) with ordinality region(value, ordinality)
  where job.id = p_job_id
    and job.mode = 'shadow'
    and page.state = 'assured'
    and page.assurance_result->>'accepted' = 'true'
    and page.unresolved_region_count = 0
    and public.ecos_hosted_job_matches_reference(job.id, false)
    and region.value->'searchable' = 'true'::jsonb
    and (
      region.value->>'source' = 'vision'
      or region.value ? 'factKind'
      or region.value ? 'subject'
      or region.value ? 'evidenceText'
    )
    and length(trim(concat_ws(' ',
      nullif(trim(region.value->>'text'), ''),
      nullif(trim(region.value->>'label'), ''),
      nullif(trim(region.value->>'subject'), ''),
      nullif(trim(region.value->>'location'), ''),
      nullif(trim(region.value->>'evidenceText'), ''),
      nullif(trim(region.value->>'fact'), '')
    ))) > 0;
  get diagnostics structured_count = row_count;
  return inserted_count + structured_count;
end;
$$;

create or replace function public.ecos_append_hosted_shadow_region_text(
  p_job_id uuid,
  p_page_number integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
begin
  delete from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = p_job_id
    and chunk.page_number = p_page_number
    and chunk.region_id like 'region-text-%';

  with eligible_page as (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.document_id,
      job.source_sha256,
      page.page_number,
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end as sheet_number,
      coalesce(page.final_page_data->>'sheetMappingStatus', 'unverified') as sheet_mapping_status,
      coalesce(page.final_page_data->>'sheetTitle', page.final_page_data->>'title') as sheet_title,
      page.assurance_result,
      nullif(trim(page.final_page_data->>'text'), '') as search_text
    from public.ecos_hosted_index_jobs job
    join public.ecos_hosted_index_pages page
      on page.job_id = job.id and page.page_number = p_page_number
    where job.id = p_job_id
      and job.mode = 'shadow'
      and page.state = 'assured'
      and page.assurance_result->>'accepted' = 'true'
      and page.unresolved_region_count = 0
      and public.ecos_hosted_job_matches_reference(job.id, false)
  ), region_chunks as (
    select
      eligible.*,
      chunk_index,
      substring(eligible.search_text from 1 + chunk_index * 3200 for 3500) as chunk_text
    from eligible_page eligible
    cross join lateral generate_series(
      0,
      greatest(0, ceil((length(eligible.search_text) - 3500) / 3200.0)::integer)
    ) chunk_index
    where length(trim(coalesce(eligible.search_text, ''))) > 0
  )
  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata, indexed_at
  )
  select
    region_chunks.job_id,
    region_chunks.organization_id,
    region_chunks.project_id,
    region_chunks.document_id,
    region_chunks.source_sha256,
    region_chunks.page_number,
    'region-text-' || region_chunks.chunk_index::text,
    region_chunks.chunk_index,
    region_chunks.chunk_text,
    region_chunks.sheet_number,
    null,
    jsonb_build_object(
      'regionText', true,
      'searchable', true,
      'sheetMappingStatus', region_chunks.sheet_mapping_status,
      'sheetTitle', region_chunks.sheet_title,
      'pageIdentity', concat_ws(' — ',
        case when region_chunks.sheet_mapping_status = 'verified'
          then 'Sheet ' || region_chunks.sheet_number
          else 'PDF page ' || region_chunks.page_number::text end,
        region_chunks.sheet_title
      ),
      'assurance', region_chunks.assurance_result,
      'shadowValidation', true,
      'structuredSearchContract', 'complete-relationship-only-v1',
      'materialization', 'overlapping_assured_region_text'
    ),
    now()
  from region_chunks
  where length(trim(region_chunks.chunk_text)) > 0;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.ecos_refresh_hosted_shadow_page(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.ecos_append_hosted_shadow_region_text(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.ecos_refresh_hosted_shadow_page(uuid, integer)
  to service_role;
grant execute on function public.ecos_append_hosted_shadow_region_text(uuid, integer)
  to service_role;

create or replace function public.ecos_commit_hosted_index_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_evidence_version text
)
returns table(published_pages integer, published_chunks integer, publication_mode text)
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '180s'
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
  current_document_data jsonb;
  current_document_sha text;
  current_document_project text;
  current_document_revision text;
  page_count integer;
  chunk_count integer := 0;
  committed_at timestamptz := clock_timestamp();
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  select job.* into current_job from public.ecos_hosted_index_jobs job
  where job.id = p_job_id and job.claim_token = p_claim_token for update;
  if not found then raise exception 'Worker lease is unavailable'; end if;
  if current_job.source_page_count is null then raise exception 'Verified source page count is required'; end if;
  if length(trim(coalesce(p_evidence_version, ''))) < 3 then raise exception 'Evidence version is required'; end if;

  select source.document_data into current_document_data
  from public.reference_documents source
  where source.id::text = current_job.document_id
    and source.owner_id = current_job.source_owner_id;
  if not found then raise exception 'The current project document is unavailable'; end if;
  current_document_sha := lower(coalesce(
    nullif(current_document_data->>'contentSha256', ''),
    nullif(current_document_data->>'webFileFingerprint', ''),
    nullif(current_document_data->>'indexedContentSha256', '')
  ));
  current_document_project := coalesce(
    nullif(trim(current_document_data->>'projectId'), ''),
    nullif(trim(current_document_data->>'projectName'), ''),
    nullif(trim(current_document_data->'projectNames'->>0), '')
  );
  current_document_revision := coalesce(
    nullif(current_document_data->>'drawingRevision', ''),
    nullif(current_document_data->>'webVersionGroupId', '')
  );
  if current_document_sha is distinct from current_job.source_sha256 then
    raise exception 'The source document changed before the verified commit';
  end if;
  if current_document_project is distinct from current_job.project_id then
    raise exception 'The project identity changed before the verified commit';
  end if;
  if current_document_revision is distinct from current_job.source_revision then
    raise exception 'The document revision changed before the verified commit';
  end if;
  if coalesce(current_document_data->>'isCurrent', 'false') <> 'true'
    or current_document_data->>'drawingStatus' = 'Superseded' then
    raise exception 'Only the current non-superseded document may publish evidence';
  end if;

  select count(*)::integer into page_count
  from public.ecos_hosted_index_pages page
  where page.job_id = current_job.id and page.state = 'assured'
    and page.source_sha256 = current_job.source_sha256
    and page.assurance_result->>'accepted' = 'true'
    and page.unresolved_region_count = 0;
  if page_count <> current_job.source_page_count then
    raise exception 'ECOS Assurance accepted % of % required pages', page_count, current_job.source_page_count;
  end if;
  if exists (
    select expected.page_number from generate_series(1, current_job.source_page_count) expected(page_number)
    except
    select page.page_number from public.ecos_hosted_index_pages page
    where page.job_id = current_job.id and page.state = 'assured'
  ) then raise exception 'Assured page sequence is incomplete'; end if;
  if exists (
    select 1 from public.ecos_hosted_visual_exceptions exception
    where exception.job_id = current_job.id
      and exception.state not in ('resolved', 'cancelled')
  ) then raise exception 'Unresolved visual exceptions remain'; end if;

  if current_job.mode = 'live' then
    delete from public.ecos_hosted_document_chunks chunk
    where chunk.organization_id = current_job.organization_id
      and chunk.document_id = current_job.document_id;
    delete from public.ecos_hosted_document_pages page
    where page.organization_id = current_job.organization_id
      and page.document_id = current_job.document_id;

    insert into public.ecos_hosted_document_pages (
      organization_id, project_id, document_id, page_number, source_sha256,
      evidence_version, sheet_number, sheet_title, sheet_mapping_status,
      page_text, regions, assurance_result, published_at
    )
    select
      current_job.organization_id, current_job.project_id, current_job.document_id,
      page.page_number, current_job.source_sha256, trim(p_evidence_version),
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end,
      nullif(left(trim(page.final_page_data->>'sheetTitle'), 500), ''),
      case when page.final_page_data->>'sheetMappingStatus' in ('verified', 'conflicted', 'unverified')
        then page.final_page_data->>'sheetMappingStatus' else 'unverified' end,
      nullif(left(trim(page.final_page_data->>'text'), 100000), ''),
      coalesce(page.final_page_data->'regions', '[]'::jsonb),
      page.assurance_result,
      committed_at
    from public.ecos_hosted_index_pages page
    where page.job_id = current_job.id
    order by page.page_number;

    insert into public.ecos_hosted_document_chunks (
      organization_id, project_id, document_id, page_number, region_id,
      chunk_index, chunk_text, sheet_number, confidence, metadata, published_at
    )
    select
      current_job.organization_id, current_job.project_id, current_job.document_id,
      page.page_number, coalesce(nullif(trim(region.value->>'id'), ''), ''),
      greatest(region.ordinality::integer - 1, 0),
      left(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label')), 4000),
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end,
      case when (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
        then (region.value->>'confidence')::numeric else null end,
      jsonb_build_object(
        'x', region.value->'x', 'y', region.value->'y',
        'width', region.value->'width', 'height', region.value->'height',
        'source', region.value->'source', 'rawSource', region.value->'source',
        'sourceRegionId', region.value->'id',
        'searchable', region.value->'searchable',
        'structuredSearchContract', 'complete-relationship-only-v1',
        'materialization', 'hosted_region',
        'areaNames', coalesce(region.value->'areaNames', '[]'::jsonb),
        'factKind', region.value->'factKind', 'subject', region.value->'subject',
        'location', region.value->'location', 'evidenceText', region.value->'evidenceText',
        'reconstructionMethod', region.value->'reconstructionMethod',
        'evidenceSources', region.value->'evidenceSources',
        'constituentEvidence', region.value->'constituentEvidence',
        'corroboratingEvidence', region.value->'corroboratingEvidence',
        'structuredRelationshipId', region.value->'structuredRelationshipId',
        'structuredTableBlockId', region.value->'structuredTableBlockId',
        'structuredTableRelationshipType', region.value->'structuredTableRelationshipType',
        'structuredTableRowKey', region.value->'structuredTableRowKey',
        'sheetMappingStatus', coalesce(page.final_page_data->>'sheetMappingStatus', 'unverified'),
        'evidenceVersion', trim(p_evidence_version),
        'assurance', page.assurance_result
      ),
      committed_at
    from public.ecos_hosted_index_pages page
    cross join lateral jsonb_array_elements(coalesce(page.final_page_data->'regions', '[]'::jsonb))
      with ordinality region(value, ordinality)
    where page.job_id = current_job.id
      and region.value->'searchable' = 'true'::jsonb
      and length(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label'))) > 0;

    insert into public.ecos_hosted_document_chunks (
      organization_id, project_id, document_id, page_number, region_id,
      chunk_index, chunk_text, sheet_number, confidence, metadata, published_at
    )
    select
      current_job.organization_id, current_job.project_id, current_job.document_id,
      page.page_number, '', 0, left(trim(page.final_page_data->>'text'), 4000),
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end,
      null,
      jsonb_build_object(
        'fallback', true,
        'searchable', true,
        'structuredSearchContract', 'complete-relationship-only-v1',
        'materialization', 'hosted_page_fallback',
        'evidenceVersion', trim(p_evidence_version),
        'assurance', page.assurance_result
      ),
      committed_at
    from public.ecos_hosted_index_pages page
    where page.job_id = current_job.id
      and jsonb_array_length(coalesce(page.final_page_data->'regions', '[]'::jsonb)) = 0
      and length(trim(page.final_page_data->>'text')) > 0;

    select count(*)::integer into chunk_count
    from public.ecos_hosted_document_chunks chunk
    where chunk.organization_id = current_job.organization_id
      and chunk.document_id = current_job.document_id;
  end if;

  update public.ecos_hosted_index_jobs job set
    state = 'ready',
    completed_page_count = current_job.source_page_count,
    assured_page_count = current_job.source_page_count,
    unresolved_region_count = 0,
    committed_evidence_version = trim(p_evidence_version),
    customer_message = case when current_job.mode = 'live'
      then 'This document is ready for ECOS.'
      else 'This document passed background preparation in validation mode.' end,
    failure_category = null,
    failure_diagnostics = '{}'::jsonb,
    claimed_by = null,
    claim_token = null,
    lease_expires_at = null,
    ready_at = committed_at,
    updated_at = committed_at
  where job.id = current_job.id;

  return query select page_count, chunk_count, current_job.mode;
end;
$$;

revoke all on function public.ecos_commit_hosted_index_job(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ecos_commit_hosted_index_job(uuid, uuid, text)
  to service_role;

-- Both source materializers above stamp an explicit searchable marker.  The
-- triggers are an independent O(1) fail-closed defense: no trigger expands a
-- page's region array.  Page-text chunks are rebuilt only from final_page_data
-- text, which the worker has already assembled from searchable regions.
create or replace function public.ecos_gate_structured_table_shadow_search()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  materialization text := coalesce(new.metadata->>'materialization', '');
  safe_text text;
  safe_chunk text;
begin
  if materialization in (
    'overlapping_page_text',
    'overlapping_assured_region_text'
  ) then
    select nullif(trim(page.final_page_data->>'text'), '') into safe_text
    from public.ecos_hosted_index_pages page
    where page.job_id = new.job_id
      and page.page_number = new.page_number
    limit 1;
    safe_chunk := substring(coalesce(safe_text, '') from 1 + new.chunk_index * 3200 for 3500);
    if length(trim(coalesce(safe_chunk, ''))) = 0 then return null; end if;
    new.chunk_text := safe_chunk;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'searchable', true,
      'structuredSearchContract', 'complete-relationship-only-v1'
    );
    return new;
  end if;

  if new.metadata->'searchable' is distinct from 'true'::jsonb
    or coalesce(new.metadata->>'structuredSearchContract', '')
      <> 'complete-relationship-only-v1' then return null; end if;
  return new;
end;
$$;

create or replace function public.ecos_gate_structured_table_hosted_search()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  materialization text := coalesce(new.metadata->>'materialization', '');
begin
  if new.metadata->'searchable' is distinct from 'true'::jsonb
    or coalesce(new.metadata->>'structuredSearchContract', '')
      <> 'complete-relationship-only-v1' then return null; end if;
  return new;
end;
$$;

revoke all on function public.ecos_gate_structured_table_shadow_search()
  from public, anon, authenticated;
revoke all on function public.ecos_gate_structured_table_hosted_search()
  from public, anon, authenticated;

drop trigger if exists ecos_shadow_chunk_structured_table_search_gate
  on public.ecos_hosted_shadow_chunks;
create trigger ecos_shadow_chunk_structured_table_search_gate
before insert on public.ecos_hosted_shadow_chunks
for each row execute function public.ecos_gate_structured_table_shadow_search();

drop trigger if exists ecos_hosted_chunk_structured_table_search_gate
  on public.ecos_hosted_document_chunks;
create trigger ecos_hosted_chunk_structured_table_search_gate
before insert on public.ecos_hosted_document_chunks
for each row execute function public.ecos_gate_structured_table_hosted_search();

commit;
