-- Run inside a transaction with ecos.test_parent_job_id set to an approved
-- disabled-shadow fixture. Roll back the transaction: this test must not
-- leave a refresh, visual reservation, or provider request behind.
do $$
declare
  parent public.ecos_hosted_index_jobs%rowtype;
  candidate public.ecos_hosted_index_jobs%rowtype;
  refresh jsonb;
  result jsonb;
  fingerprint text := repeat('a',64);
  payload_sha text := repeat('b',64);
  region_key text := 'low-confidence-ocr-regression';
  operation_id text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'service-role test context required';
  end if;
  select * into parent from public.ecos_hosted_index_jobs
    where id = current_setting('ecos.test_parent_job_id',true)::uuid;
  if not found or parent.mode <> 'shadow' or parent.state <> 'ready'
      or not exists (select 1 from public.ecos_hosted_index_configuration
        where organization_id=parent.organization_id and enabled=false
          and publication_mode='shadow') then
    raise exception 'approved disabled-shadow parent fixture required';
  end if;
  refresh := public.ecos_begin_isolated_page_refresh(
    parent.id,44,parent.source_sha256);
  select * into candidate from public.ecos_hosted_index_jobs
    where id=(refresh->'job'->>'id')::uuid;
  if not public.ecos_private_isolated_visual_refresh_allowed(candidate.id,44)
      or public.ecos_private_isolated_visual_refresh_allowed(candidate.id,45)
      or public.ecos_private_isolated_visual_refresh_allowed(parent.id,44) then
    raise exception 'private visual gate accepted wrong job or page';
  end if;
  if public.ecos_reserve_hosted_visual_region_v2(
      candidate.id,candidate.claim_token,45,region_key,
      candidate.target_evidence_version,fingerprint,0) then
    raise exception 'wrong-page visual reservation accepted';
  end if;
  if not public.ecos_reserve_hosted_visual_region_v2(
      candidate.id,candidate.claim_token,44,region_key,
      candidate.target_evidence_version,fingerprint,0) then
    raise exception 'exact private visual reservation denied';
  end if;
  operation_id := public.ecos_visual_provider_operation_id_v1(
    candidate.organization_id,candidate.project_id,candidate.document_id,
    candidate.source_sha256,44,candidate.id,candidate.claim_token,
    candidate.target_evidence_version,fingerprint,region_key);
  result := public.ecos_begin_drawing_analysis(
    candidate.organization_id,candidate.project_id,candidate.document_id,
    candidate.source_sha256,44,candidate.id,candidate.claim_token,
    candidate.target_evidence_version,fingerprint,region_key,
    operation_id,operation_id,payload_sha,1);
  if result->>'disposition' <> 'started' then
    raise exception 'exact private drawing analysis denied: %', result;
  end if;
  if not public.ecos_reserve_drawing_provider_attempt(
      (result->>'requestId')::uuid,operation_id,'analysis_primary',1,
      'openai','test-model',operation_id||':analysis_primary:1:openai:test-model') then
    raise exception 'exact private provider attempt denied';
  end if;
  if not public.ecos_finish_drawing_analysis(
      (result->>'requestId')::uuid,operation_id,'failed',null,
      'test_only_no_provider_call') then
    raise exception 'exact private provider completion denied';
  end if;
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  if public.ecos_private_isolated_visual_refresh_allowed(candidate.id,44) then
    raise exception 'non-worker was allowed private visual access';
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  update public.ecos_hosted_page_refreshes set state='cancelled'
    where id=(refresh->>'refreshId')::uuid;
  if public.ecos_private_isolated_visual_refresh_allowed(candidate.id,44) then
    raise exception 'cancelled refresh retained visual access';
  end if;
end;
$$;
