begin;

-- Preserve the exact answer-bearing regions inside the bounded page payload.
-- The prior contract could fill its 64-region runtime budget with generic
-- deterministic/OCR regions before a drawing-purpose label such as
-- "ENLARGED LIGHTING PLAN". Equipment schedule relationships remain first,
-- followed by drawing-purpose labels, assured vision, measurements (including
-- airflow), and finally lexical context. Query terms remain literal strings.
create or replace function public.ecos_load_hosted_shadow_bounded_page_evidence_pairs_v27(
  p_project_id text,
  p_document_ids text[],
  p_page_numbers integer[],
  p_query_terms text[],
  p_result_limit integer default 100,
  p_region_limit integer default 160
)
returns table(
  job_id uuid,
  document_id text,
  page_number integer,
  source_sha256 text,
  evidence_version text,
  final_page_data jsonb,
  assurance_result jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_project_id text := btrim(coalesce(p_project_id, ''));
  bounded_result_limit integer := greatest(1, least(coalesce(p_result_limit, 100), 200));
  bounded_region_limit integer := greatest(1, least(coalesce(p_region_limit, 160), 240));
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
    select 1 from unnest(p_page_numbers) requested(page_number)
    where requested.page_number is null or requested.page_number not between 1 and 100000
  ) then
    raise invalid_parameter_value using message = 'canonical page numbers required';
  end if;
  if exists (
    select 1 from unnest(p_query_terms) requested(term)
    where requested.term is null
      or length(requested.term) not between 2 and 100
      or requested.term <> btrim(requested.term)
  ) then
    raise invalid_parameter_value using message = 'canonical bounded query terms required';
  end if;

  return query
  with requested_pairs as materialized (
    select distinct document.document_id, page.page_number
    from unnest(p_document_ids) with ordinality document(document_id, position)
    join unnest(p_page_numbers) with ordinality page(page_number, position)
      using (position)
  ),
  normalized_terms as materialized (
    select distinct lower(term) as term
    from unnest(p_query_terms) requested(term)
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
    jsonb_build_object(
      'text', page.final_page_data->'text',
      'title', page.final_page_data->'title',
      'regions', coalesce((
        select jsonb_agg(selected.region order by selected.position)
        from (
          select
            region.value as region,
            region.position
          from jsonb_array_elements(
            coalesce(page.final_page_data->'regions', '[]'::jsonb)
          ) with ordinality region(value, position)
          cross join lateral (
            select
              lower(coalesce(
                region.value->>'text',
                region.value->>'label',
                ''
              )) as region_text,
              lower(coalesce(
                region.value->>'source',
                region.value->>'rawSource',
                ''
              )) as region_source
          ) normalized
          where normalized.region_source in (
              'deterministic_structured_table_relationship',
              'vision'
            )
            or normalized.region_text ~ $purpose$(?ix)(
              enlarged[[:space:]]+(?:lighting|power|mechanical|plumbing|floor|roof|site|area)[[:space:]]+(?:plan|layout)
              |
              (?:lighting|power|mechanical|plumbing|floor|roof|site|area)[[:space:]]+(?:plan|layout)
            )$purpose$
            or normalized.region_text ~ $measurement$(?ix)(
                [0-9]+(?:[.][0-9]+)?[[:space:]]*
                (?:inches?|inch|in[.]?|feet|foot|ft[.]?|sf|sq[.]?[[:space:]]*ft|square[[:space:]]+feet|cfm|cubic[[:space:]]+feet[[:space:]]+per[[:space:]]+minute)
                |
                [0-9]+(?:[.][0-9]+)?[[:space:]]*['"”’]
              )$measurement$
            or exists (
              select 1 from normalized_terms term
              where position(term.term in normalized.region_text) > 0
            )
          order by
            case
              when normalized.region_source = 'deterministic_structured_table_relationship' then 130
              when normalized.region_text ~ $purpose$(?ix)(
                  enlarged[[:space:]]+(?:lighting|power|mechanical|plumbing|floor|roof|site|area)[[:space:]]+(?:plan|layout)
                  |
                  (?:lighting|power|mechanical|plumbing|floor|roof|site|area)[[:space:]]+(?:plan|layout)
                )$purpose$ then 120
              when normalized.region_source = 'vision' then 115
              when normalized.region_text ~ $measurement$(?ix)(
                  [0-9]+(?:[.][0-9]+)?[[:space:]]*
                  (?:inches?|inch|in[.]?|feet|foot|ft[.]?|sf|sq[.]?[[:space:]]*ft|square[[:space:]]+feet|cfm|cubic[[:space:]]+feet[[:space:]]+per[[:space:]]+minute)
                  |
                  [0-9]+(?:[.][0-9]+)?[[:space:]]*['"”’]
                )$measurement$ then 100
              else 80
            end desc,
            (
              select count(*)
              from normalized_terms term
              where position(term.term in normalized.region_text) > 0
            ) desc,
            region.position
          limit bounded_region_limit
        ) selected
      ), '[]'::jsonb),
      'sheetNumber', page.final_page_data->'sheetNumber',
      'sheetMappingStatus', page.final_page_data->'sheetMappingStatus',
      'sheetMappingSource', page.final_page_data->'sheetMappingSource',
      'sheetMappingEvidence', page.final_page_data->'sheetMappingEvidence',
      'sheetMappingConfidence', page.final_page_data->'sheetMappingConfidence',
      'documentStructuralIdentity', page.final_page_data->'documentStructuralIdentity',
      'structuredTableAnalysis', page.final_page_data->'structuredTableAnalysis'
    ),
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
  limit bounded_result_limit;
end;
$$;

revoke all on function public.ecos_load_hosted_shadow_bounded_page_evidence_pairs_v27(
  text, text[], integer[], text[], integer, integer
) from public, anon, authenticated;
grant execute on function public.ecos_load_hosted_shadow_bounded_page_evidence_pairs_v27(
  text, text[], integer[], text[], integer, integer
) to service_role;

commit;
