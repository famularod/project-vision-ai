begin;

create or replace function public.ecos_load_hosted_shadow_page_context_v21(
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
  final_page_data jsonb,
  assurance_result jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_document_ids text[];
  normalized_page_numbers integer[];
  bounded_limit integer := greatest(1, least(coalesce(p_result_limit, 100), 1000));
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;
  if p_document_ids is null or cardinality(p_document_ids) not between 1 and 200 then
    raise invalid_parameter_value using message = 'one to 200 exact document ids required';
  end if;
  if p_page_numbers is null or cardinality(p_page_numbers) not between 1 and 500 then
    raise invalid_parameter_value using message = 'one to 500 exact page numbers required';
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

  select array_agg(distinct requested.document_id order by requested.document_id)
  into normalized_document_ids
  from unnest(p_document_ids) requested(document_id);
  select array_agg(distinct requested.page_number order by requested.page_number)
  into normalized_page_numbers
  from unnest(p_page_numbers) requested(page_number);

  return query
  with candidate_jobs as materialized (
    select
      job.id,
      job.document_id,
      job.source_sha256,
      job.committed_evidence_version,
      count(*) over (partition by job.document_id) as exact_job_count
    from public.ecos_hosted_index_jobs job
    where job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and job.document_id = any(normalized_document_ids)
      and public.ecos_hosted_job_matches_reference(job.id, true)
  ), exact_jobs as materialized (
    select candidate.* from candidate_jobs candidate
    where candidate.exact_job_count = 1
  )
  select
    job.id,
    page.document_id,
    page.page_number,
    page.source_sha256,
    job.committed_evidence_version,
    page.final_page_data,
    page.assurance_result
  from exact_jobs job
  join public.ecos_hosted_index_pages page
    on page.job_id = job.id
   and page.document_id = job.document_id
   and page.source_sha256 = job.source_sha256
  where page.page_number = any(normalized_page_numbers)
    and page.state = 'assured'
    and page.unresolved_region_count = 0
    and page.assurance_result->>'accepted' = 'true'
  order by page.document_id, page.page_number
  limit bounded_limit;
end;
$$;

revoke all on function public.ecos_load_hosted_shadow_page_context_v21(
  text[], integer[], integer
) from public, anon, authenticated;
grant execute on function public.ecos_load_hosted_shadow_page_context_v21(
  text[], integer[], integer
) to service_role;

commit;
