-- Customer-safe hosted preparation status with explicit Assurance limitation
-- visibility. The result deliberately exposes only the number of accepted
-- pages that require review; raw provider/Assurance diagnostics remain behind
-- the service-role boundary.
create or replace function public.ecos_hosted_index_status_v2(
  p_document_ids text[] default null
)
returns table(
  document_id text,
  project_id text,
  state text,
  customer_status text,
  completed_page_count integer,
  source_page_count integer,
  progress_percent integer,
  customer_message text,
  limitation_count integer,
  support_reference text,
  committed_evidence_version text,
  updated_at timestamptz,
  ready_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with exact_jobs as (
    select
      job.*,
      source.document_data->>'isCurrent' = 'true' as source_is_current,
      configuration.publication_mode,
      case
        when job.state = 'ready'
          and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
          and source.document_data->>'isCurrent' = 'true'
          and (job.mode = 'live' or configuration.publication_mode = 'live') then 0
        when job.state = 'ready'
          and job.committed_evidence_version = 'ecos-hosted-evidence/1.3' then 1
        else 2
      end as status_priority
    from public.ecos_hosted_index_jobs job
    join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = job.source_owner_id
    join public.ecos_hosted_index_configuration configuration
      on configuration.organization_id = job.organization_id
     and configuration.enabled = true
    where public.vitruvius_has_project_permission(
        job.organization_id,
        job.project_id,
        'view_project'
      )
      and (p_document_ids is null or job.document_id = any(p_document_ids))
      and public.ecos_hosted_job_matches_reference(job.id, false)
  ),
  accepted_page_limitations as (
    select
      job.id as job_id,
      count(page.page_number) filter (
        where page.state = 'assured'
          and page.assurance_result->>'accepted' = 'true'
          and jsonb_typeof(page.assurance_result->'limitationCodes') = 'array'
          and exists (
            select 1
            from jsonb_array_elements(
              case
                when jsonb_typeof(page.assurance_result->'limitationCodes') = 'array'
                  then page.assurance_result->'limitationCodes'
                else '[]'::jsonb
              end
            ) as limitation(code)
            where jsonb_typeof(limitation.code) = 'string'
              and btrim(limitation.code #>> '{}') <> ''
          )
      )::integer as limitation_count
    from exact_jobs job
    left join public.ecos_hosted_index_pages page
      on page.job_id = job.id
     and page.organization_id = job.organization_id
     and page.project_id = job.project_id
     and page.document_id = job.document_id
     and page.source_sha256 = job.source_sha256
    group by job.id
  ),
  status_rows as (
    select
      job.*,
      coalesce(limitations.limitation_count, 0)::integer as limitation_count
    from exact_jobs job
    join accepted_page_limitations limitations
      on limitations.job_id = job.id
  )
  select distinct on (job.document_id)
    job.document_id,
    job.project_id,
    job.state,
    case
      when job.state = 'ready'
        and job.committed_evidence_version is distinct from 'ecos-hosted-evidence/1.3'
        then 'Needs Review'
      when job.state = 'ready' and job.limitation_count > 0
        and job.source_is_current
        and (job.mode = 'live' or job.publication_mode = 'live')
        then 'Ready with limitations'
      when job.state = 'ready' and job.limitation_count > 0
        then 'Prepared with limitations'
      when job.state = 'ready' and job.source_is_current
        and (job.mode = 'live' or job.publication_mode = 'live')
        then 'Ready for ECOS'
      when job.state = 'ready' then 'Prepared'
      when job.state = 'queued' then 'Waiting'
      when job.state in (
        'fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring'
      ) then 'Preparing'
      when job.state = 'needs_review' then 'Needs Review'
      when job.state = 'reconnect_source' then 'Reconnect Files'
      when job.state in ('temporarily_unavailable', 'failed_internal')
        then 'Temporarily Unavailable'
      when job.state = 'cancelled' then 'Waiting'
      else 'Preparing'
    end,
    job.completed_page_count,
    coalesce(job.source_page_count, 0),
    case when coalesce(job.source_page_count, 0) > 0
      then least(100, floor(
        (job.completed_page_count::numeric / job.source_page_count) * 100
      )::integer)
      else 0 end,
    case
      when job.state = 'ready'
        and job.committed_evidence_version is distinct from 'ecos-hosted-evidence/1.3'
        then 'This revision must be prepared again with the current ECOS evidence standard.'
      when job.state = 'ready' and job.limitation_count > 0
        and not job.source_is_current
        then job.limitation_count || ' accepted page' ||
          case when job.limitation_count = 1 then '' else 's' end ||
          ' passed ECOS Assurance with review limitations. Make this revision current before Ask ECOS can use it.'
      when job.state = 'ready' and job.limitation_count > 0
        and job.source_is_current
        and (job.mode = 'live' or job.publication_mode = 'live')
        then job.limitation_count || ' accepted page' ||
          case when job.limitation_count = 1 then '' else 's' end ||
          ' passed ECOS Assurance with review limitations. Ask ECOS can use the verified evidence, and the highlighted limitations still need review.'
      when job.state = 'ready' and not job.source_is_current
        then 'Background preparation passed ECOS Assurance. Make this revision current before Ask ECOS can use it.'
      when job.state = 'ready' and job.source_is_current
        and (job.mode = 'live' or job.publication_mode = 'live')
        then 'This current revision is ready for ECOS.'
      else job.customer_message
    end,
    job.limitation_count,
    job.support_reference,
    job.committed_evidence_version,
    job.updated_at,
    job.ready_at
  from status_rows job
  order by job.document_id, job.status_priority, job.updated_at desc;
$$;

revoke all on function public.ecos_hosted_index_status_v2(text[])
  from public, anon;
grant execute on function public.ecos_hosted_index_status_v2(text[])
  to authenticated;
