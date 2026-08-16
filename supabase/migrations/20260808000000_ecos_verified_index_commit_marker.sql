-- Give the client a compact, database-verified signal that a drawing index
-- passed the transactional ECOS commit gate. Version fields alone are not
-- sufficient because older partial indexes also used the 2.0/3.0 labels.

begin;

create or replace function public.ecos_mark_verified_index_commit()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  source_data jsonb;
  expected_source_sha text;
  expected_page_count integer;
  indexed_page_count integer;
begin
  if new.status <> 'committed' then
    return new;
  end if;

  select source.document_data
  into source_data
  from public.reference_documents source
  where source.owner_id = new.owner_id
    and source.id::text = new.document_id
  for update;

  if not found then
    raise exception 'The committed ECOS source document is unavailable';
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
      or expected_source_sha <> new.source_sha256
      or expected_page_count is null
      or expected_page_count <> new.source_page_count
      or new.completed_page_count <> new.source_page_count
      or source_data->>'documentIntelligenceVersion' <> 'ecos-document-intelligence/2.0'
      or source_data->>'documentVisualIndexVersion' <> 'ecos-visual-index/3.0' then
    raise exception 'The committed ECOS index does not match the current drawing source';
  end if;

  select count(*)::integer
  into indexed_page_count
  from public.ecos_document_pages page
  where page.owner_id = new.owner_id
    and page.document_id = new.document_id;

  if indexed_page_count <> new.source_page_count or exists (
    select 1
    from public.ecos_document_pages page
    where page.owner_id = new.owner_id
      and page.document_id = new.document_id
      and (
        page.index_schema_version <> 'ecos-document-intelligence/2.0'
        or page.source_sha256 <> new.source_sha256
        or page.visual_coverage->>'overviewAnalyzed' <> 'true'
        or page.visual_coverage->>'coverageComplete' <> 'true'
        or coalesce(page.visual_coverage->>'requestedDeepReadRegionCount', '') !~ '^[0-9]+$'
        or (page.visual_coverage->>'requestedDeepReadRegionCount')::integer < 6
        or coalesce(page.visual_coverage->>'completedDeepReadRegionCount', '') !~ '^[0-9]+$'
        or (page.visual_coverage->>'completedDeepReadRegionCount')::integer < 6
        or not coalesce(
          page.visual_coverage->'completedDeepReadRegionKeys',
          '[]'::jsonb
        ) @> '["0:0:333:500","333:0:333:500","667:0:333:500","0:500:333:500","333:500:333:500","667:500:333:500"]'::jsonb
        or jsonb_typeof(coalesce(page.visual_coverage->'failureCodes', '[]'::jsonb)) <> 'array'
        or jsonb_array_length(coalesce(page.visual_coverage->'failureCodes', '[]'::jsonb)) > 0
      )
  ) then
    raise exception 'The committed ECOS index does not have exact verified page coverage';
  end if;

  update public.reference_documents source
  set document_data = coalesce(source.document_data, '{}'::jsonb) || jsonb_build_object(
        'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0',
        'ecosVerifiedIndexCommittedAt', new.updated_at,
        'ecosVerifiedIndexCommittedSha256', new.source_sha256,
        'ecosVerifiedIndexCommittedPageCount', new.source_page_count
      ),
      updated_at = greatest(source.updated_at, new.updated_at)
  where source.owner_id = new.owner_id
    and source.id::text = new.document_id;

  return new;
end
$$;

drop trigger if exists ecos_mark_verified_index_commit_trigger
  on public.ecos_document_index_jobs;
create trigger ecos_mark_verified_index_commit_trigger
after insert or update of status, completed_page_count
on public.ecos_document_index_jobs
for each row
when (new.status = 'committed')
execute function public.ecos_mark_verified_index_commit();

-- Backfill only jobs that already passed the transactional commit function and
-- whose current protected page rows still satisfy the same exact coverage
-- checks. Partial 2.0/3.0 indexes intentionally receive no marker.
with verified_jobs as (
  select distinct on (job.owner_id, job.document_id)
    job.owner_id,
    job.document_id,
    job.source_sha256,
    job.source_page_count,
    job.updated_at
  from public.ecos_document_index_jobs job
  join public.reference_documents source
    on source.owner_id = job.owner_id
   and source.id::text = job.document_id
  where job.status = 'committed'
    and job.completed_page_count = job.source_page_count
    and source.document_data->>'documentIntelligenceVersion' = 'ecos-document-intelligence/2.0'
    and source.document_data->>'documentVisualIndexVersion' = 'ecos-visual-index/3.0'
    and lower(coalesce(
      nullif(source.document_data->>'webFileFingerprint', ''),
      nullif(source.document_data->>'indexedContentSha256', ''),
      nullif(source.document_data->>'contentSha256', '')
    )) = job.source_sha256
    and coalesce(source.document_data->>'sourcePageCount', '') ~ '^[1-9][0-9]*$'
    and (source.document_data->>'sourcePageCount')::integer = job.source_page_count
    and (
      select count(*)
      from public.ecos_document_pages page
      where page.owner_id = job.owner_id
        and page.document_id = job.document_id
    ) = job.source_page_count
    and not exists (
      select 1
      from public.ecos_document_pages page
      where page.owner_id = job.owner_id
        and page.document_id = job.document_id
        and (
          page.index_schema_version <> 'ecos-document-intelligence/2.0'
          or page.source_sha256 <> job.source_sha256
          or page.visual_coverage->>'overviewAnalyzed' <> 'true'
          or page.visual_coverage->>'coverageComplete' <> 'true'
          or coalesce(page.visual_coverage->>'requestedDeepReadRegionCount', '') !~ '^[0-9]+$'
          or (page.visual_coverage->>'requestedDeepReadRegionCount')::integer < 6
          or coalesce(page.visual_coverage->>'completedDeepReadRegionCount', '') !~ '^[0-9]+$'
          or (page.visual_coverage->>'completedDeepReadRegionCount')::integer < 6
          or not coalesce(
            page.visual_coverage->'completedDeepReadRegionKeys',
            '[]'::jsonb
          ) @> '["0:0:333:500","333:0:333:500","667:0:333:500","0:500:333:500","333:500:333:500","667:500:333:500"]'::jsonb
          or jsonb_typeof(coalesce(page.visual_coverage->'failureCodes', '[]'::jsonb)) <> 'array'
          or jsonb_array_length(coalesce(page.visual_coverage->'failureCodes', '[]'::jsonb)) > 0
        )
    )
  order by job.owner_id, job.document_id, job.updated_at desc
)
update public.reference_documents source
set document_data = coalesce(source.document_data, '{}'::jsonb) || jsonb_build_object(
      'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0',
      'ecosVerifiedIndexCommittedAt', verified.updated_at,
      'ecosVerifiedIndexCommittedSha256', verified.source_sha256,
      'ecosVerifiedIndexCommittedPageCount', verified.source_page_count
    ),
    updated_at = greatest(source.updated_at, verified.updated_at)
from verified_jobs verified
where source.owner_id = verified.owner_id
  and source.id::text = verified.document_id;

revoke all on function public.ecos_mark_verified_index_commit() from public, anon;

commit;
