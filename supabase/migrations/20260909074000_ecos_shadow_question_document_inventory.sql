begin;

-- The protected question path needs only immutable document identity and
-- citation metadata before searching the materialized shadow index. Returning
-- full document payloads here would detoast and transfer every source
-- record for every question without improving retrieval quality.
create or replace function public.ecos_list_hosted_shadow_question_documents_v22(
  p_project_id text,
  p_result_limit integer default 200
)
returns table(
  document_id text,
  document_name text,
  category text,
  project_id text,
  source_sha256 text,
  source_revision text,
  document_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_project_id text := btrim(coalesce(p_project_id, ''));
  bounded_limit integer := greatest(1, least(coalesce(p_result_limit, 200), 1000));
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;
  if length(normalized_project_id) not between 1 and 500 then
    raise invalid_parameter_value using message = 'canonical project id required';
  end if;

  return query
  with exact_jobs as materialized (
    select
      job.id,
      job.document_id,
      job.project_id,
      job.source_sha256,
      job.source_revision,
      job.source_owner_id,
      count(*) over (
        partition by job.document_id, job.project_id, job.source_sha256,
          job.source_revision
      ) as exact_job_count
    from public.ecos_hosted_index_jobs job
    where job.project_id = normalized_project_id
      and job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.ecos_hosted_job_matches_reference(job.id, true)
  )
  select
    job.document_id,
    source.name,
    source.category,
    job.project_id,
    job.source_sha256,
    authority.source_revision,
    authority.document_updated_at
  from exact_jobs job
  join app_private.ecos_reference_document_authority authority
    on authority.document_id = job.document_id
   and authority.owner_id = job.source_owner_id
   and authority.project_id = job.project_id
   and authority.source_sha256 = job.source_sha256
   and authority.source_revision is not distinct from job.source_revision
   and authority.is_current
   and authority.drawing_status is distinct from 'Superseded'
  join public.reference_documents source
    on source.id = job.document_id
   and source.owner_id = job.source_owner_id
  where job.exact_job_count = 1
  order by source.name, job.document_id
  limit bounded_limit;
end;
$$;

revoke all on function public.ecos_list_hosted_shadow_question_documents_v22(
  text, integer
) from public, anon, authenticated;
grant execute on function public.ecos_list_hosted_shadow_question_documents_v22(
  text, integer
) to service_role;

commit;
