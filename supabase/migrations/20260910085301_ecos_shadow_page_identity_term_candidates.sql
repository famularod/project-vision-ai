begin;

-- Chunk retrieval is intentionally compact, but rare drawing schedules can
-- contain a decisive row that was preserved only in the assured page dossier.
-- Return bounded page identities whose safe page text matches the normalized
-- question terms. The answer runtime must still load and verify each selected
-- page through the exact document-page evidence RPC before using any content.
create or replace function public.ecos_find_hosted_shadow_page_candidates_v26(
  p_project_id text,
  p_document_ids text[],
  p_query_terms text[],
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
  assurance_result jsonb,
  matched_terms text[],
  matched_term_count integer,
  match_weight integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_project_id text := btrim(coalesce(p_project_id, ''));
  bounded_limit integer := greatest(1, least(coalesce(p_result_limit, 40), 80));
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
  if p_query_terms is null or cardinality(p_query_terms) not between 1 and 100 then
    raise invalid_parameter_value using message = 'one to 100 bounded query terms required';
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
    select 1 from unnest(p_query_terms) requested(query_term)
    where requested.query_term is null
      or length(requested.query_term) not between 2 and 100
      or requested.query_term <> btrim(requested.query_term)
      or requested.query_term <> lower(requested.query_term)
      or requested.query_term ~ '[[:cntrl:]]'
  ) then
    raise invalid_parameter_value using message = 'canonical lowercase query terms required';
  end if;

  return query
  with requested_documents as materialized (
    select distinct requested.document_id
    from unnest(p_document_ids) requested(document_id)
  ),
  requested_terms as materialized (
    select distinct
      requested.query_term,
      case
        when requested.query_term like '% %' and length(requested.query_term) >= 16 then 20
        when requested.query_term like '% %' then 14
        when length(requested.query_term) >= 12 then 10
        when length(requested.query_term) >= 7 then 7
        when length(requested.query_term) >= 4 then 4
        else 1
      end as term_weight
    from unnest(p_query_terms) requested(query_term)
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
  ),
  assured_pages as materialized (
    select
      job.id as job_id,
      page.document_id,
      page.page_number,
      page.source_sha256,
      job.committed_evidence_version,
      nullif(btrim(coalesce(page.final_page_data->>'sheetNumber', '')), '') as sheet_number,
      nullif(btrim(coalesce(page.final_page_data->>'sheetTitle', '')), '') as sheet_title,
      nullif(btrim(coalesce(page.final_page_data->>'title', '')), '') as title,
      page.assurance_result,
      lower(coalesce(page.final_page_data->>'text', '')) as page_text
    from exact_jobs job
    join public.ecos_hosted_index_pages page
      on page.job_id = job.id
     and page.document_id = job.document_id
     and page.source_sha256 = job.source_sha256
    where page.state = 'assured'
      and page.unresolved_region_count = 0
      and page.assurance_result->>'accepted' = 'true'
      and coalesce(page.final_page_data->>'sheetMappingStatus', '') = 'verified'
  )
  select
    page.job_id,
    page.document_id,
    page.page_number,
    page.source_sha256,
    page.committed_evidence_version,
    page.sheet_number,
    page.sheet_title,
    page.title,
    page.assurance_result,
    matches.matched_terms,
    matches.matched_term_count,
    matches.match_weight
  from assured_pages page
  join lateral (
    select
      array_agg(term.query_term order by term.term_weight desc, term.query_term) as matched_terms,
      count(*)::integer as matched_term_count,
      sum(term.term_weight)::integer as match_weight
    from requested_terms term
    where position(term.query_term in page.page_text) > 0
  ) matches on matches.matched_term_count > 0
  order by matches.match_weight desc, matches.matched_term_count desc,
    page.document_id, page.page_number
  limit bounded_limit;
end;
$$;

revoke all on function public.ecos_find_hosted_shadow_page_candidates_v26(
  text, text[], text[], integer
) from public, anon, authenticated;
grant execute on function public.ecos_find_hosted_shadow_page_candidates_v26(
  text, text[], text[], integer
) to service_role;

commit;
