begin;

create or replace function public.ecos_load_hosted_shadow_page_identity_pairs_v22(
  p_project_id text,
  p_document_ids text[],
  p_page_numbers integer[],
  p_result_limit integer default 100
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
  sheet_mapping_status text,
  sheet_mapping_source text,
  sheet_mapping_evidence jsonb,
  document_structural_identity jsonb,
  sheet_mapping_confidence double precision,
  assurance_result jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_project_id text := btrim(coalesce(p_project_id, ''));
  bounded_limit integer := greatest(1, least(coalesce(p_result_limit, 100), 200));
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
  if p_page_numbers is null or cardinality(p_page_numbers) <> cardinality(p_document_ids) then
    raise invalid_parameter_value using message = 'one exact page number per document id required';
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
    select 1 from unnest(p_page_numbers) requested(page_number)
    where requested.page_number is null or requested.page_number not between 1 and 100000
  ) then
    raise invalid_parameter_value using message = 'canonical page numbers required';
  end if;

  return query
  with requested_pairs as materialized (
    select distinct document.document_id, page.page_number
    from unnest(p_document_ids) with ordinality document(document_id, position)
    join unnest(p_page_numbers) with ordinality page(page_number, position)
      using (position)
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
    where job.project_id = normalized_project_id
      and job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and exists (
        select 1 from requested_pairs requested
        where requested.document_id = job.document_id
      )
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
    coalesce(
      nullif(btrim(coalesce(page.final_page_data->>'sheetMappingStatus', '')), ''),
      'unverified'
    ),
    nullif(btrim(coalesce(page.final_page_data->>'sheetMappingSource', '')), ''),
    case
      when jsonb_typeof(page.final_page_data->'sheetMappingEvidence') = 'array'
        then page.final_page_data->'sheetMappingEvidence'
      else '[]'::jsonb
    end,
    case
      when jsonb_typeof(page.final_page_data->'documentStructuralIdentity') = 'object'
        then page.final_page_data->'documentStructuralIdentity'
      else '{}'::jsonb
    end,
    case
      when coalesce(page.final_page_data->>'sheetMappingConfidence', '')
        ~ '^[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$'
        then (page.final_page_data->>'sheetMappingConfidence')::double precision
      else null
    end,
    page.assurance_result
  from requested_pairs requested
  join exact_jobs job on job.document_id = requested.document_id
  join public.ecos_hosted_index_pages page
    on page.job_id = job.id
   and page.document_id = requested.document_id
   and page.page_number = requested.page_number
   and page.source_sha256 = job.source_sha256
  where page.state = 'assured'
    and page.unresolved_region_count = 0
    and page.assurance_result->>'accepted' = 'true'
  order by page.document_id, page.page_number
  limit bounded_limit;
end;
$$;

revoke all on function public.ecos_load_hosted_shadow_page_identity_pairs_v22(
  text, text[], integer[], integer
) from public, anon, authenticated;
grant execute on function public.ecos_load_hosted_shadow_page_identity_pairs_v22(
  text, text[], integer[], integer
) to service_role;

commit;
