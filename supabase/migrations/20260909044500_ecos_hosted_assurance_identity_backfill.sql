-- Older evidence-1.3 pages were accepted before the page Assurance receipt
-- copied the already-verified job/page identity fields into its own payload.
-- Bind only exact, ready shadow pages whose job row, page row, and final page
-- payload already agree. Conflicts remain untouched and therefore fail closed.

begin;

update public.ecos_hosted_index_pages page
set assurance_result = page.assurance_result || jsonb_build_object(
  'sourceSha256', job.source_sha256,
  'projectId', job.project_id,
  'pageNumber', page.page_number
)
from public.ecos_hosted_index_jobs job
where page.job_id = job.id
  and job.mode = 'shadow'
  and job.state = 'ready'
  and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
  and page.state = 'assured'
  and page.unresolved_region_count = 0
  and page.assurance_result->>'accepted' = 'true'
  and page.assurance_result->>'evidenceVersion' = job.committed_evidence_version
  and page.source_sha256 = job.source_sha256
  and page.project_id = job.project_id
  and page.document_id = job.document_id
  and page.final_page_data->>'sourceSha256' = job.source_sha256
  and page.final_page_data->>'projectId' = job.project_id
  and page.final_page_data->>'pageNumber' = page.page_number::text
  and (
    page.assurance_result->>'sourceSha256' is null
    or page.assurance_result->>'projectId' is null
    or page.assurance_result->>'pageNumber' is null
  );

commit;
