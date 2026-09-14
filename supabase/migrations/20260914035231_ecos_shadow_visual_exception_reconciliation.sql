begin;

-- A fresh, complete page check supersedes obsolete detector warnings. Retain
-- those rows as cancelled audit history; never call them verified evidence.
create or replace function public.ecos_reconcile_shadow_visual_exceptions_v2(
  p_job_id uuid, p_claim_token uuid, p_page_number integer,
  p_current_exceptions jsonb
)
returns integer language plpgsql security definer
set search_path = ''
as $$
declare
  job public.ecos_hosted_index_jobs%rowtype;
  page public.ecos_hosted_index_pages%rowtype;
  inventory jsonb;
  affected integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Worker authorization required';
  end if;
  if jsonb_typeof(p_current_exceptions) is distinct from 'array'
    or jsonb_array_length(p_current_exceptions) > 100 then
    raise exception 'Bounded exception inventory required';
  end if;
  if exists (select 1 from jsonb_array_elements(p_current_exceptions) item
    where jsonb_typeof(item) <> 'object'
      or length(btrim(coalesce(item->>'regionKey',''))) not between 1 and 300
      or coalesce(item->>'exceptionFingerprint','') !~ '^[a-f0-9]{64}$')
    or (select count(distinct item->>'regionKey') from jsonb_array_elements(p_current_exceptions) item)
      <> jsonb_array_length(p_current_exceptions) then
    raise exception 'Exact exception identities required';
  end if;
  select j.* into job from public.ecos_hosted_index_jobs j
  where j.id=p_job_id and j.claim_token=p_claim_token and j.lease_expires_at>=now()
    and j.mode='shadow' and j.committed_evidence_version is null and j.ready_at is null
    and j.state in ('fetching_source','extracting','mapping','awaiting_visual','assuring')
    and j.source_scan_status='clean'
  for update;
  if not found or not public.ecos_hosted_job_matches_reference(p_job_id,false) then
    raise exception 'Exact uncommitted shadow claim required';
  end if;
  select p.* into page from public.ecos_hosted_index_pages p
  where p.job_id=job.id and p.page_number=p_page_number
    and p.organization_id=job.organization_id and p.project_id=job.project_id
    and p.document_id=job.document_id
    and p.source_sha256=job.source_sha256 and p.state='assured'
    and p.unresolved_region_count=0 and p.assurance_result->>'accepted'='true'
  for update;
  if not found then raise exception 'Fresh assured page required'; end if;
  inventory := page.final_page_data->'visualExceptionInventory';
  if inventory->>'schemaVersion' is distinct from 'ecos-visual-exception-inventory/1.0'
    or inventory->>'sourceSha256' is distinct from job.source_sha256
    or inventory->'pageNumber' is distinct from to_jsonb(p_page_number)
    or inventory->>'evidenceVersion' is distinct from 'ecos-hosted-evidence/1.3'
    or inventory->>'claimSha256' is distinct from encode(extensions.digest(p_claim_token::text,'sha256'),'hex')
    or inventory->'items' is distinct from p_current_exceptions then
    raise exception 'Fresh extraction inventory does not match current claim';
  end if;
  if not exists (select 1 from public.ecos_hosted_visual_exceptions e
    where e.job_id=job.id and e.page_number=p_page_number and e.state not in ('resolved','cancelled')) then
    return 0;
  end if;
  if page.assurance_result->'checks'->>'visualDetectionCoverageComplete' is distinct from 'true'
    or page.final_page_data->'visualCoverage'->>'coverageComplete' is distinct from 'true'
    or page.final_page_data->'visualCoverage'->>'sourceSha256' is distinct from job.source_sha256
    or page.final_page_data->'visualCoverage'->'pageNumber' is distinct from to_jsonb(p_page_number) then
    raise exception 'Complete exact visual coverage required';
  end if;
  -- A detector warning still in the new inventory must be resolved normally.
  if exists (select 1 from public.ecos_hosted_visual_exceptions e
    join jsonb_array_elements(p_current_exceptions) item on item->>'regionKey'=e.region_key
      and item->>'exceptionFingerprint'=e.exception_fingerprint
    where e.job_id=job.id and e.page_number=p_page_number and e.state not in ('resolved','cancelled')) then
    raise exception 'Current visual exceptions remain';
  end if;
  update public.ecos_hosted_visual_exceptions e
  set state='cancelled', updated_at=now(),
    assurance_result=coalesce(e.assurance_result,'{}'::jsonb) || jsonb_build_object('reconciliation',jsonb_build_object(
      'method','superseded_by_fresh_exact_page_v1','acceptedAsEvidence',false,
      'sourceSha256',job.source_sha256,'pageNumber',p_page_number,
      'pageSha256',encode(extensions.digest(page.final_page_data::text,'sha256'),'hex'),
      'priorState',e.state,'reconciledAt',now()))
  where e.job_id=job.id and e.page_number=p_page_number and e.state not in ('resolved','cancelled');
  get diagnostics affected=row_count;
  return affected;
end;
$$;
revoke all on function public.ecos_reconcile_shadow_visual_exceptions_v2(uuid,uuid,integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.ecos_reconcile_shadow_visual_exceptions_v2(uuid,uuid,integer,jsonb)
  to service_role;
commit;
