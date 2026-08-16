-- Commit a fully checkpointed ECOS Document Intelligence index without
-- transferring every page back through one oversized RPC argument.
--
-- The function remains fail-closed: it replaces the current searchable index
-- only when the source fingerprint, page count, page sequence, and all six
-- deterministic high-resolution visual tiles are verified for every page.

begin;

create or replace function public.ecos_commit_verified_index_job(
  p_job_id uuid,
  p_extraction_method text default null
)
returns table(indexed_pages integer, indexed_chunks integer)
language plpgsql
security invoker
set search_path = public, pg_temp
set statement_timeout = '180s'
as $$
declare
  current_owner uuid := auth.uid();
  job_record public.ecos_document_index_jobs%rowtype;
  source_data jsonb;
  expected_source_sha text;
  expected_page_count integer;
  committed_at timestamptz := clock_timestamp();
  page_count integer;
  chunk_count integer;
begin
  if current_owner is null or not public.dave_is_app_owner() then
    raise exception 'ECOS document indexing requires the authorized app owner';
  end if;

  select job.*
  into job_record
  from public.ecos_document_index_jobs job
  where job.id = p_job_id
    and job.owner_id = current_owner
  for update;

  if not found then
    raise exception 'The ECOS index job is unavailable to this owner';
  end if;

  select source.document_data
  into source_data
  from public.reference_documents source
  where source.owner_id = current_owner
    and source.id::text = job_record.document_id
  for update;

  if not found then
    raise exception 'The indexed source document is not available to this owner';
  end if;

  expected_source_sha := lower(coalesce(
    nullif(source_data->>'webFileFingerprint', ''),
    nullif(source_data->>'indexedContentSha256', ''),
    nullif(source_data->>'contentSha256', '')
  ));
  expected_page_count := case
    when coalesce(source_data->>'sourcePageCount', '') ~ '^[1-9][0-9]*$'
      then (source_data->>'sourcePageCount')::integer
    else null
  end;

  if expected_source_sha !~ '^[a-f0-9]{64}$'
      or expected_source_sha <> job_record.source_sha256 then
    raise exception 'The checkpoint source fingerprint does not match the current document';
  end if;
  if expected_page_count is null
      or expected_page_count <> job_record.source_page_count then
    raise exception 'The checkpoint page count does not match the current document';
  end if;

  select count(*)::integer
  into page_count
  from public.ecos_document_index_job_pages checkpoint
  where checkpoint.owner_id = current_owner
    and checkpoint.job_id = job_record.id;

  if page_count <> job_record.source_page_count then
    raise exception 'The ECOS index job has % of % required pages',
      page_count, job_record.source_page_count;
  end if;

  if exists (
    select 1
    from public.ecos_document_index_job_pages checkpoint
    where checkpoint.owner_id = current_owner
      and checkpoint.job_id = job_record.id
      and (
        (checkpoint.page_data->>'pageNumber')::integer <> checkpoint.page_number
        or checkpoint.page_number < 1
        or checkpoint.page_number > job_record.source_page_count
        or checkpoint.page_data->'visualCoverage'->>'overviewAnalyzed' <> 'true'
        or checkpoint.page_data->'visualCoverage'->>'coverageComplete' <> 'true'
        or coalesce(checkpoint.page_data->'visualCoverage'->>'requestedDeepReadRegionCount', '') !~ '^[0-9]+$'
        or (checkpoint.page_data->'visualCoverage'->>'requestedDeepReadRegionCount')::integer < 6
        or coalesce(checkpoint.page_data->'visualCoverage'->>'completedDeepReadRegionCount', '') !~ '^[0-9]+$'
        or (checkpoint.page_data->'visualCoverage'->>'completedDeepReadRegionCount')::integer < 6
        or not coalesce(
          checkpoint.page_data->'visualCoverage'->'completedDeepReadRegionKeys',
          '[]'::jsonb
        ) @> '["0:0:333:500","333:0:333:500","667:0:333:500","0:500:333:500","333:500:333:500","667:500:333:500"]'::jsonb
        or jsonb_array_length(coalesce(
          checkpoint.page_data->'visualCoverage'->'failureCodes',
          '[]'::jsonb
        )) > 0
      )
  ) then
    raise exception 'Every ECOS index page must pass exact 6-of-6 visual coverage';
  end if;

  if exists (
    select expected.page_number
    from generate_series(1, job_record.source_page_count) expected(page_number)
    except
    select checkpoint.page_number
    from public.ecos_document_index_job_pages checkpoint
    where checkpoint.owner_id = current_owner
      and checkpoint.job_id = job_record.id
  ) then
    raise exception 'The ECOS index job does not contain a contiguous page sequence';
  end if;

  delete from public.ecos_document_chunks
  where owner_id = current_owner
    and document_id = job_record.document_id;
  delete from public.ecos_document_pages
  where owner_id = current_owner
    and document_id = job_record.document_id;

  insert into public.ecos_document_pages (
    owner_id, document_id, page_number, sheet_number, sheet_title,
    sheet_mapping_status, sheet_mapping_confidence, sheet_mapping_candidates,
    visual_coverage, index_schema_version, title, page_text, regions,
    extraction_method, confidence, source_sha256, indexed_at
  )
  select
    current_owner,
    job_record.document_id,
    checkpoint.page_number,
    case when checkpoint.page_data->>'sheetMappingStatus' = 'verified'
      then nullif(trim(checkpoint.page_data->>'sheetNumber'), '') else null end,
    nullif(left(trim(checkpoint.page_data->>'sheetTitle'), 500), ''),
    case when checkpoint.page_data->>'sheetMappingStatus' in ('verified', 'conflicted', 'unverified')
      then checkpoint.page_data->>'sheetMappingStatus' else 'unverified' end,
    case when (checkpoint.page_data->>'sheetMappingConfidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
      then least(1, greatest(0, (checkpoint.page_data->>'sheetMappingConfidence')::numeric)) else null end,
    coalesce(checkpoint.page_data->'sheetMappingCandidates', '[]'::jsonb),
    checkpoint.page_data->'visualCoverage',
    'ecos-document-intelligence/2.0',
    nullif(left(trim(checkpoint.page_data->>'title'), 500), ''),
    nullif(left(trim(checkpoint.page_data->>'text'), 100000), ''),
    coalesce(checkpoint.page_data->'regions', '[]'::jsonb),
    nullif(trim(p_extraction_method), ''),
    confidence.average_confidence,
    job_record.source_sha256,
    committed_at
  from public.ecos_document_index_job_pages checkpoint
  left join lateral (
    select avg((region.value->>'confidence')::numeric) as average_confidence
    from jsonb_array_elements(coalesce(checkpoint.page_data->'regions', '[]'::jsonb)) region(value)
    where (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
  ) confidence on true
  where checkpoint.owner_id = current_owner
    and checkpoint.job_id = job_record.id
  order by checkpoint.page_number;

  insert into public.ecos_document_chunks (
    owner_id, document_id, page_number, region_id, chunk_index,
    chunk_text, sheet_number, confidence, metadata, indexed_at
  )
  select
    current_owner,
    job_record.document_id,
    checkpoint.page_number,
    coalesce(nullif(trim(region.value->>'id'), ''), ''),
    greatest(region.ordinality::integer - 1, 0),
    left(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label')), 4000),
    case when checkpoint.page_data->>'sheetMappingStatus' = 'verified'
      then nullif(trim(checkpoint.page_data->>'sheetNumber'), '') else null end,
    case when (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
      then (region.value->>'confidence')::numeric else null end,
    jsonb_build_object(
      'x', region.value->'x',
      'y', region.value->'y',
      'width', region.value->'width',
      'height', region.value->'height',
      'source', region.value->'source',
      'areaNames', coalesce(region.value->'areaNames', '[]'::jsonb),
      'factKind', region.value->'factKind',
      'subject', region.value->'subject',
      'location', region.value->'location',
      'evidenceText', region.value->'evidenceText',
      'sheetMappingStatus', coalesce(checkpoint.page_data->>'sheetMappingStatus', 'unverified'),
      'sheetMappingConfidence', checkpoint.page_data->'sheetMappingConfidence',
      'visualCoverage', checkpoint.page_data->'visualCoverage'
    ),
    committed_at
  from public.ecos_document_index_job_pages checkpoint
  cross join lateral jsonb_array_elements(coalesce(checkpoint.page_data->'regions', '[]'::jsonb))
    with ordinality region(value, ordinality)
  where checkpoint.owner_id = current_owner
    and checkpoint.job_id = job_record.id
    and length(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label'))) > 0;

  insert into public.ecos_document_chunks (
    owner_id, document_id, page_number, region_id, chunk_index,
    chunk_text, sheet_number, confidence, metadata, indexed_at
  )
  select
    current_owner,
    job_record.document_id,
    checkpoint.page_number,
    '',
    0,
    left(trim(checkpoint.page_data->>'text'), 4000),
    case when checkpoint.page_data->>'sheetMappingStatus' = 'verified'
      then nullif(trim(checkpoint.page_data->>'sheetNumber'), '') else null end,
    null,
    jsonb_build_object(
      'fallback', true,
      'sheetMappingStatus', coalesce(checkpoint.page_data->>'sheetMappingStatus', 'unverified'),
      'sheetMappingConfidence', checkpoint.page_data->'sheetMappingConfidence',
      'visualCoverage', checkpoint.page_data->'visualCoverage'
    ),
    committed_at
  from public.ecos_document_index_job_pages checkpoint
  where checkpoint.owner_id = current_owner
    and checkpoint.job_id = job_record.id
    and jsonb_array_length(coalesce(checkpoint.page_data->'regions', '[]'::jsonb)) = 0
    and length(trim(checkpoint.page_data->>'text')) > 0;

  select count(*)::integer into page_count
  from public.ecos_document_pages
  where owner_id = current_owner and document_id = job_record.document_id;
  select count(*)::integer into chunk_count
  from public.ecos_document_chunks
  where owner_id = current_owner and document_id = job_record.document_id;

  if page_count <> job_record.source_page_count then
    raise exception 'The committed ECOS index failed its page-count verification';
  end if;

  update public.reference_documents source
  set document_data = coalesce(source.document_data, '{}'::jsonb) || jsonb_build_object(
        'extractedText', null,
        'extractedPages', '[]'::jsonb,
        'extractionStatus', 'complete',
        'documentIntelligenceVersion', 'ecos-document-intelligence/2.0',
        'indexedAt', committed_at,
        'searchablePageCount', job_record.source_page_count,
        'indexedContentSha256', job_record.source_sha256,
        'extractionLimitations', coalesce((
          select jsonb_agg(limitation.value)
          from jsonb_array_elements_text(coalesce(
            source.document_data->'extractionLimitations',
            '[]'::jsonb
          )) limitation(value)
          where limitation.value !~* 'visual coverage remains incomplete|high-resolution visual'
        ), '[]'::jsonb)
      ),
      updated_at = committed_at
  where source.owner_id = current_owner
    and source.id::text = job_record.document_id;

  update public.ecos_document_index_jobs job
  set status = 'committed',
      completed_page_count = job.source_page_count,
      failure_message = null,
      updated_at = committed_at
  where job.id = job_record.id
    and job.owner_id = current_owner;

  return query select page_count, chunk_count;
end
$$;

revoke all on function public.ecos_commit_verified_index_job(uuid, text) from public, anon;
grant execute on function public.ecos_commit_verified_index_job(uuid, text) to authenticated;

commit;
