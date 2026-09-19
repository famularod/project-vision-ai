-- Proof-preserving reconciliation for metadata-only shadow page refreshes.
--
-- Updating an assured page receipt correctly queues a shadow materialization
-- refresh. When the update changes only non-semantic metadata, the existing
-- embeddings remain exact because their identity is bound to the normalized
-- sheet number and chunk text. This service-only function refreshes one queued
-- page per transaction and acknowledges it only when the complete semantic
-- chunk inventory is byte-for-byte identical and every refreshed chunk still
-- has its exact embedding. Any semantic drift fails closed and rolls back the
-- page refresh and queue acknowledgement together.

begin;

create or replace function public.ecos_reconcile_queued_shadow_semantic_page(
  p_job_id uuid,
  p_expected_source_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '150s'
set lock_timeout = '5s'
as $$
declare
  selected_job public.ecos_hosted_index_jobs%rowtype;
  pending public.ecos_hosted_shadow_materialization_queue%rowtype;
  before_count integer := 0;
  after_count integer := 0;
  refreshed_count integer := 0;
  appended_count integer := 0;
  remaining_count integer := 0;
  before_inventory jsonb := '[]'::jsonb;
  after_inventory jsonb := '[]'::jsonb;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Shadow semantic reconciliation authorization required';
  end if;
  if coalesce(p_expected_source_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Shadow semantic reconciliation identity is invalid';
  end if;

  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
  for update;
  if not found
    or selected_job.mode <> 'shadow'
    or selected_job.state not in ('ready', 'assuring')
    or selected_job.source_sha256 <> p_expected_source_sha256
    or selected_job.committed_evidence_version <> 'ecos-hosted-evidence/1.3'
    or selected_job.claim_token is not null
    or selected_job.lease_expires_at is not null then
    raise exception 'Exact idle shadow semantic job was not found';
  end if;
  if not public.ecos_hosted_job_matches_reference(selected_job.id, true) then
    raise exception 'Shadow semantic job no longer matches the current reference document';
  end if;

  select queued.* into pending
  from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = selected_job.id
  order by queued.requested_at, queued.page_number
  for update skip locked
  limit 1;
  if not found then
    return jsonb_build_object(
      'jobId', selected_job.id,
      'status', 'complete',
      'remainingPageCount', 0
    );
  end if;
  if pending.operation <> 'refresh' then
    raise exception 'A destructive shadow materialization operation cannot be reconciled';
  end if;
  if not exists (
    select 1
    from public.ecos_hosted_index_pages page
    where page.job_id = selected_job.id
      and page.page_number = pending.page_number
      and page.organization_id = selected_job.organization_id
      and page.project_id = selected_job.project_id
      and page.document_id = selected_job.document_id
      and page.source_sha256 = selected_job.source_sha256
      and page.state = 'assured'
      and page.assurance_result->>'accepted' = 'true'
      and page.unresolved_region_count = 0
  ) then
    raise exception 'Queued shadow page is not an exact accepted evidence page';
  end if;

  select
    count(*)::integer,
    coalesce(jsonb_agg(
      jsonb_build_array(
        chunk.page_number,
        chunk.region_id,
        chunk.chunk_index,
        encode(digest(convert_to(
          left(btrim(concat_ws(
            ' ', nullif(btrim(chunk.sheet_number), ''), chunk.chunk_text
          )), 6000),
          'UTF8'
        ), 'sha256'), 'hex')
      ) order by chunk.region_id, chunk.chunk_index
    ), '[]'::jsonb)
  into before_count, before_inventory
  from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = selected_job.id
    and chunk.page_number = pending.page_number
    and chunk.organization_id = selected_job.organization_id
    and chunk.project_id = selected_job.project_id
    and chunk.document_id = selected_job.document_id
    and chunk.source_sha256 = selected_job.source_sha256;
  if before_count < 1 then
    raise exception 'Queued shadow page has no existing semantic chunk inventory';
  end if;
  if exists (
    select 1
    from public.ecos_hosted_shadow_chunks chunk
    where chunk.job_id = selected_job.id
      and chunk.page_number = pending.page_number
      and not exists (
        select 1
        from public.ecos_hosted_chunk_embeddings embedding
        where embedding.job_id = selected_job.id
          and embedding.organization_id = selected_job.organization_id
          and embedding.project_id = selected_job.project_id
          and embedding.document_id = selected_job.document_id
          and embedding.source_sha256 = selected_job.source_sha256
          and embedding.evidence_version = selected_job.committed_evidence_version
          and embedding.source_kind = 'shadow'
          and embedding.page_number = chunk.page_number
          and embedding.region_id = chunk.region_id
          and embedding.chunk_index = chunk.chunk_index
          and embedding.chunk_sha256 = encode(digest(convert_to(
            left(btrim(concat_ws(
              ' ', nullif(btrim(chunk.sheet_number), ''), chunk.chunk_text
            )), 6000),
            'UTF8'
          ), 'sha256'), 'hex')
      )
  ) then
    raise exception 'Queued shadow page is missing an exact semantic embedding';
  end if;

  refreshed_count := public.ecos_refresh_hosted_shadow_page(
    selected_job.id,
    pending.page_number
  );
  appended_count := public.ecos_append_hosted_shadow_region_text(
    selected_job.id,
    pending.page_number
  );

  select
    count(*)::integer,
    coalesce(jsonb_agg(
      jsonb_build_array(
        chunk.page_number,
        chunk.region_id,
        chunk.chunk_index,
        encode(digest(convert_to(
          left(btrim(concat_ws(
            ' ', nullif(btrim(chunk.sheet_number), ''), chunk.chunk_text
          )), 6000),
          'UTF8'
        ), 'sha256'), 'hex')
      ) order by chunk.region_id, chunk.chunk_index
    ), '[]'::jsonb)
  into after_count, after_inventory
  from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = selected_job.id
    and chunk.page_number = pending.page_number
    and chunk.organization_id = selected_job.organization_id
    and chunk.project_id = selected_job.project_id
    and chunk.document_id = selected_job.document_id
    and chunk.source_sha256 = selected_job.source_sha256;
  if after_count <> before_count or after_inventory is distinct from before_inventory then
    raise exception using
      errcode = '55000',
      message = 'Shadow page semantic inventory changed during metadata reconciliation';
  end if;
  if refreshed_count + appended_count < 1 or exists (
    select 1
    from public.ecos_hosted_shadow_chunks chunk
    where chunk.job_id = selected_job.id
      and chunk.page_number = pending.page_number
      and not exists (
        select 1
        from public.ecos_hosted_chunk_embeddings embedding
        where embedding.job_id = selected_job.id
          and embedding.organization_id = selected_job.organization_id
          and embedding.project_id = selected_job.project_id
          and embedding.document_id = selected_job.document_id
          and embedding.source_sha256 = selected_job.source_sha256
          and embedding.evidence_version = selected_job.committed_evidence_version
          and embedding.source_kind = 'shadow'
          and embedding.page_number = chunk.page_number
          and embedding.region_id = chunk.region_id
          and embedding.chunk_index = chunk.chunk_index
          and embedding.chunk_sha256 = encode(digest(convert_to(
            left(btrim(concat_ws(
              ' ', nullif(btrim(chunk.sheet_number), ''), chunk.chunk_text
            )), 6000),
            'UTF8'
          ), 'sha256'), 'hex')
      )
  ) then
    raise exception 'Refreshed shadow page lost exact semantic coverage';
  end if;

  delete from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = pending.job_id
    and queued.page_number = pending.page_number
    and queued.operation = pending.operation;
  if not found then
    raise exception 'Shadow semantic queue acknowledgement failed';
  end if;
  select count(*)::integer into remaining_count
  from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = selected_job.id;

  return jsonb_build_object(
    'jobId', selected_job.id,
    'status', case when remaining_count = 0 then 'complete' else 'reconciled' end,
    'pageNumber', pending.page_number,
    'chunkCount', after_count,
    'remainingPageCount', remaining_count
  );
end;
$$;

revoke all on function public.ecos_reconcile_queued_shadow_semantic_page(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ecos_reconcile_queued_shadow_semantic_page(uuid, text)
  to service_role;

commit;
