begin;

-- Exact sheet references are authority constraints. Resolve the verified page
-- identity directly from the current hosted package so lexical or semantic
-- ranking cannot substitute a nearby sheet from the same drawing set.
create or replace function public.ecos_find_hosted_shadow_pages_by_sheet_v25(
  p_project_id text,
  p_document_ids text[],
  p_sheet_numbers text[],
  p_result_limit integer default 40
)
returns table(
  job_id uuid,
  document_id text,
  page_number integer,
  source_sha256 text,
  evidence_version text,
  sheet_number text,
  sheet_title text,
  title text,
  assurance_result jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_project_id text := btrim(coalesce(p_project_id, ''));
  bounded_limit integer := greatest(1, least(coalesce(p_result_limit, 40), 100));
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;
  if length(normalized_project_id) not between 1 and 500 then
    raise invalid_parameter_value using message = 'canonical project id required';
  end if;
  if p_document_ids is null or cardinality(p_document_ids) not between 1 and 200 then
    raise invalid_parameter_value using message = 'one to 200 exact document ids required';
  end if;
  if p_sheet_numbers is null or cardinality(p_sheet_numbers) not between 1 and 20 then
    raise invalid_parameter_value using message = 'one to 20 exact sheet numbers required';
  end if;
  if exists (
    select 1 from unnest(p_document_ids) requested(document_id)
    where requested.document_id is null
      or length(requested.document_id) not between 1 and 200
      or requested.document_id <> btrim(requested.document_id)
  ) then
    raise invalid_parameter_value using message = 'canonical document ids required';
  end if;
  if exists (
    select 1 from unnest(p_sheet_numbers) requested(sheet_number)
    where requested.sheet_number is null
      or length(requested.sheet_number) not between 2 and 40
      or requested.sheet_number <> btrim(requested.sheet_number)
      or regexp_replace(upper(requested.sheet_number), '[^A-Z0-9]', '', 'g') = ''
  ) then
    raise invalid_parameter_value using message = 'canonical sheet numbers required';
  end if;

  return query
  with requested_documents as materialized (
    select distinct requested.document_id
    from unnest(p_document_ids) requested(document_id)
  ),
  requested_sheets as materialized (
    select distinct regexp_replace(upper(requested.sheet_number), '[^A-Z0-9]', '', 'g') as compact_sheet_number
    from unnest(p_sheet_numbers) requested(sheet_number)
  ),
  candidate_jobs as materialized (
    select
      job.id,
      job.document_id,
      job.project_id,
      job.source_sha256,
      job.source_revision,
      job.committed_evidence_version,
      count(*) over (
        partition by job.document_id, job.project_id, job.source_sha256,
          job.source_revision
      ) as exact_job_count
    from public.ecos_hosted_index_jobs job
    join requested_documents requested
      on requested.document_id = job.document_id
    where job.project_id = normalized_project_id
      and job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.ecos_hosted_job_matches_reference(job.id, true)
  ),
  exact_jobs as materialized (
    select candidate.* from candidate_jobs candidate
    where candidate.exact_job_count = 1
  )
  select
    job.id,
    page.document_id,
    page.page_number,
    page.source_sha256,
    job.committed_evidence_version,
    nullif(btrim(coalesce(page.final_page_data->>'sheetNumber', '')), ''),
    nullif(btrim(coalesce(page.final_page_data->>'sheetTitle', '')), ''),
    nullif(btrim(coalesce(page.final_page_data->>'title', '')), ''),
    page.assurance_result
  from exact_jobs job
  join public.ecos_hosted_index_pages page
    on page.job_id = job.id
   and page.document_id = job.document_id
   and page.source_sha256 = job.source_sha256
  join requested_sheets requested
    on requested.compact_sheet_number = regexp_replace(
      upper(coalesce(page.final_page_data->>'sheetNumber', '')),
      '[^A-Z0-9]',
      '',
      'g'
    )
  where page.state = 'assured'
    and page.unresolved_region_count = 0
    and page.assurance_result->>'accepted' = 'true'
    and coalesce(page.final_page_data->>'sheetMappingStatus', '') = 'verified'
  order by page.document_id, page.page_number
  limit bounded_limit;
end;
$$;

revoke all on function public.ecos_find_hosted_shadow_pages_by_sheet_v25(
  text, text[], text[], integer
) from public, anon, authenticated;
grant execute on function public.ecos_find_hosted_shadow_pages_by_sheet_v25(
  text, text[], text[], integer
) to service_role;

commit;
