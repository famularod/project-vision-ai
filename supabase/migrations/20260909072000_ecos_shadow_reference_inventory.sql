begin;

-- Project only the small identity fields needed by protected validation. The
-- validator must never detoast every full customer document payload merely to
-- discover the exact ready shadow document set.
create or replace function public.ecos_list_hosted_shadow_reference_documents_v21(
  p_result_limit integer default 200
)
returns table(
  document_id text,
  document_name text,
  project_id text,
  source_sha256 text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bounded_limit integer := greatest(1, least(coalesce(p_result_limit, 200), 1000));
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;

  return query
  with exact_jobs as materialized (
    select
      job.id,
      job.document_id,
      job.project_id,
      job.source_sha256,
      job.source_owner_id,
      count(*) over (
        partition by job.document_id, job.project_id, job.source_sha256
      ) as exact_job_count
    from public.ecos_hosted_index_jobs job
    where job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.ecos_hosted_job_matches_reference(job.id, true)
  )
  select
    job.document_id,
    source.name,
    job.project_id,
    job.source_sha256
  from exact_jobs job
  join public.reference_documents source
    on source.id = job.document_id
   and source.owner_id = job.source_owner_id
  where job.exact_job_count = 1
  order by job.project_id, source.name, job.document_id
  limit bounded_limit;
end;
$$;

revoke all on function public.ecos_list_hosted_shadow_reference_documents_v21(
  integer
) from public, anon, authenticated;
grant execute on function public.ecos_list_hosted_shadow_reference_documents_v21(
  integer
) to service_role;

commit;
