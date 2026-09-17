begin;
create function public.ecos_retry_isolated_page_refresh(p_refresh_id uuid,p_expected_page_sha256 text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r public.ecos_hosted_page_refreshes%rowtype; j public.ecos_hosted_index_jobs%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise insufficient_privilege using message='worker_authorization_required';
  end if;
  select * into r from public.ecos_hosted_page_refreshes where id=p_refresh_id for update;
  if not found or r.state<>'cancelled' then raise exception 'closed_refresh_required'; end if;
  perform 1 from public.ecos_hosted_index_jobs where id=r.parent_job_id for update;
  select * into j from public.ecos_hosted_index_jobs where id=r.candidate_job_id for update;
  if j.mode is distinct from 'shadow_refresh:'||j.id::text or j.state<>'cancelled'
    or j.claim_token is not null or j.retry_count>=1 or j.committed_evidence_version is not null then
    raise exception 'single_isolated_retry_only';
  end if;
  if exists(select 1 from public.ecos_hosted_page_refreshes where parent_job_id=r.parent_job_id
    and id<>r.id and state in ('preparing','verified'))
    or not exists(select 1 from public.ecos_hosted_index_configuration where organization_id=j.organization_id
      and enabled=false and publication_mode='shadow') then
    raise exception 'quiescent_refresh_required';
  end if;
  if p_expected_page_sha256 is null or p_expected_page_sha256 !~ '^[a-f0-9]{64}$'
    or not exists(select 1 from public.ecos_hosted_index_pages p where job_id=j.id and page_number=r.page_number
      and state='awaiting_visual' and unresolved_region_count>0
      and encode(extensions.digest(to_jsonb(p)::text,'sha256'),'hex')=p_expected_page_sha256) then
    raise exception 'exact_unresolved_checkpoint_required';
  end if;
  -- Never retry a timed-out or otherwise uncertain paid operation here.
  -- Only explicit completed responses with closed worker leases qualify.
  if not exists(select 1 from public.ecos_drawing_analysis_requests where hosted_job_id=j.id)
    or exists(select 1 from public.ecos_drawing_analysis_requests where hosted_job_id=j.id
      and (status<>'completed' or completed_at is null or failure_code is not null)) then
    raise exception 'known_completed_provider_outcomes_required';
  end if;
  update public.ecos_hosted_page_refreshes set state='preparing' where id=r.id;
  update public.ecos_hosted_index_jobs set state='extracting',claim_token=gen_random_uuid(),
    claimed_by='isolated-page-refresh-retry',lease_expires_at=now()+interval '30 minutes',
    retry_count=retry_count+1,updated_at=now() where id=j.id;
  -- Re-check the preserved original page/reference and current source before
  -- returning a claim. Any drift rolls back both state changes above.
  return public.ecos_read_isolated_page_refresh(r.id);
end;
$$;
revoke all on function public.ecos_retry_isolated_page_refresh(uuid,text) from public,anon,authenticated;
grant execute on function public.ecos_retry_isolated_page_refresh(uuid,text) to service_role;
commit;
