-- Exact, read-only Ask ECOS proof binding for the owner beta surface.
-- The app receives identity plus one region's coordinates only. It never
-- receives evidence text or neighboring regions through this function.

begin;

create index if not exists ecos_hosted_index_jobs_current_proof_idx
on public.ecos_hosted_index_jobs (
  project_id,
  document_id,
  source_sha256,
  source_revision,
  mode,
  updated_at desc
)
where state = 'ready'
  and committed_evidence_version = 'ecos-hosted-evidence/1.3';

create or replace function public.dave_verify_current_ecos_document_proof(
  p_project_id text,
  p_document_id text,
  p_source_sha256 text,
  p_evidence_version text,
  p_revision text,
  p_page_number integer,
  p_sheet_number text default null,
  p_region_id text default null
)
returns table(
  document_id text,
  project_id text,
  source_sha256 text,
  evidence_version text,
  source_revision text,
  page_number integer,
  sheet_number text,
  region_id text,
  region_bounds jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  current_actor uuid := auth.uid();
  requested_project_id text := nullif(btrim(coalesce(p_project_id, '')), '');
  requested_document_id text := nullif(btrim(coalesce(p_document_id, '')), '');
  requested_source_sha256 text := lower(nullif(btrim(coalesce(p_source_sha256, '')), ''));
  requested_evidence_version text := nullif(btrim(coalesce(p_evidence_version, '')), '');
  requested_revision text := nullif(btrim(coalesce(p_revision, '')), '');
  requested_sheet_number text := nullif(btrim(coalesce(p_sheet_number, '')), '');
  requested_region_id text := nullif(btrim(coalesce(p_region_id, '')), '');
begin
  if current_actor is null or not public.dave_is_app_owner() then
    raise exception 'Ask ECOS proof verification requires an authorized owner'
      using errcode = '42501';
  end if;
  if requested_project_id is null
      or requested_document_id is null
      or length(requested_project_id) > 200
      or length(requested_document_id) > 200
      or requested_source_sha256 !~ '^[0-9a-f]{64}$'
      or requested_evidence_version <> 'ecos-hosted-evidence/1.3'
      or requested_revision is null
      or length(requested_revision) > 200
      or length(coalesce(requested_sheet_number, '')) > 64
      or requested_region_id is null
      or length(requested_region_id) > 512
      or p_page_number is null
      or p_page_number not between 1 and 10000 then
    raise exception 'The Ask ECOS proof claim is invalid'
      using errcode = '22023';
  end if;

  return query
  with exact_job as materialized (
    select job.*
    from public.ecos_hosted_index_jobs job
    join app_private.ecos_reference_document_authority source
      on source.document_id = job.document_id
     and source.owner_id = current_actor
    join public.projects project_record
      on project_record.id::text = job.project_id
     and project_record.owner_id = current_actor
     and coalesce(project_record.archived, false) = false
    where job.project_id = requested_project_id
      and job.document_id = requested_document_id
      and job.source_sha256 = requested_source_sha256
      and job.source_revision = requested_revision
      and job.state = 'ready'
      and job.committed_evidence_version = requested_evidence_version
      and source.is_current
      and source.drawing_status is distinct from 'Superseded'
      and source.source_sha256 = job.source_sha256
      and source.source_revision is not distinct from job.source_revision
      and public.ecos_hosted_job_matches_reference(job.id, true)
    order by case when job.mode = 'live' then 0 else 1 end, job.updated_at desc, job.id
    limit 1
  ), exact_page as materialized (
    select
      job.document_id,
      job.project_id,
      job.source_sha256,
      job.committed_evidence_version,
      job.source_revision,
      page.page_number,
      nullif(provenance.value->>'sheetNumber', '') as sheet_number,
      page.final_page_data
    from exact_job job
    join public.ecos_hosted_index_pages page
      on page.job_id = job.id
     and page.organization_id = job.organization_id
     and page.project_id = job.project_id
     and page.document_id = job.document_id
     and page.source_sha256 = job.source_sha256
     and page.page_number = p_page_number
     and page.state = 'assured'
     and page.unresolved_region_count = 0
     and page.assurance_result->>'accepted' = 'true'
     and page.assurance_result->>'evidenceVersion' = job.committed_evidence_version
     and page.assurance_result->>'sourceSha256' = job.source_sha256
     and page.assurance_result->>'projectId' = job.project_id
     and (page.assurance_result->>'pageNumber')::integer = page.page_number
    cross join lateral (
      select public.ecos_sheet_provenance_payload(
        page.final_page_data,
        page.assurance_result,
        true
      ) as value
    ) provenance
    where provenance.value is not null
      and (
        requested_sheet_number is null
        or upper(regexp_replace(coalesce(provenance.value->>'sheetNumber', ''), '\s+', '', 'g')) =
          upper(regexp_replace(requested_sheet_number, '\s+', '', 'g'))
      )
  ), exact_region as materialized (
    select
      page.document_id,
      region.value,
      jsonb_build_object(
        'x', region.value->'x',
        'y', region.value->'y',
        'width', region.value->'width',
        'height', region.value->'height'
      ) as bounds,
      count(*) over () as match_count
    from exact_page page
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(page.final_page_data->'regions') = 'array'
          then page.final_page_data->'regions'
        else '[]'::jsonb
      end
    ) region(value)
    where region.value->>'id' = requested_region_id
      and jsonb_typeof(region.value->'x') = 'number'
      and jsonb_typeof(region.value->'y') = 'number'
      and jsonb_typeof(region.value->'width') = 'number'
      and jsonb_typeof(region.value->'height') = 'number'
      and (region.value->>'x')::numeric between 0 and 1
      and (region.value->>'y')::numeric between 0 and 1
      and (region.value->>'width')::numeric > 0
      and (region.value->>'height')::numeric > 0
      and (region.value->>'x')::numeric + (region.value->>'width')::numeric <= 1.000001
      and (region.value->>'y')::numeric + (region.value->>'height')::numeric <= 1.000001
  )
  select
    page.document_id,
    page.project_id,
    page.source_sha256,
    page.committed_evidence_version,
    page.source_revision,
    page.page_number,
    page.sheet_number,
    requested_region_id,
    region.bounds
  from exact_page page
  left join exact_region region
    on region.document_id = page.document_id
  where region.value is not null and region.match_count = 1
  limit 1;
end;
$$;

revoke all on function public.dave_verify_current_ecos_document_proof(
  text, text, text, text, text, integer, text, text
) from public, anon, service_role;
grant execute on function public.dave_verify_current_ecos_document_proof(
  text, text, text, text, text, integer, text, text
) to authenticated;

commit;
