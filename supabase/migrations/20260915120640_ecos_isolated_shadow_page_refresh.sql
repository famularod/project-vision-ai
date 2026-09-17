begin;

-- Isolated preparation shares the exact protected worker/provider contracts,
-- but is never eligible for either shadow search or live publication.
alter table public.ecos_hosted_index_jobs
  drop constraint ecos_hosted_index_jobs_mode_check,
  add constraint ecos_hosted_index_jobs_mode_check
    check (mode in ('shadow', 'live') or mode = 'shadow_refresh:' || id::text);
-- Each isolated attempt has its own non-publishing mode identity. Keep the
-- original unique constraint intact: existing enrollment RPCs depend on its
-- exact ON CONFLICT column contract, including for normal shadow/live jobs.

create table public.ecos_hosted_page_refreshes (
  id uuid primary key default gen_random_uuid(),
  parent_job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  candidate_job_id uuid not null unique references public.ecos_hosted_index_jobs(id) on delete cascade,
  page_number integer not null check (page_number between 1 and 10000),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  parent_page_sha256 text not null check (parent_page_sha256 ~ '^[a-f0-9]{64}$'),
  parent_reference_sha256 text not null check (parent_reference_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'preparing' check (state in ('preparing','verified','promoted','cancelled')),
  created_at timestamptz not null default now()
);
create unique index ecos_one_active_page_refresh_per_job
  on public.ecos_hosted_page_refreshes(parent_job_id)
  where state in ('preparing','verified');
alter table public.ecos_hosted_page_refreshes enable row level security;
alter table public.ecos_hosted_page_refreshes force row level security;
revoke all on public.ecos_hosted_page_refreshes from public, anon, authenticated;
grant select, insert, update on public.ecos_hosted_page_refreshes to service_role;

create function public.ecos_guard_isolated_page_refresh()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.mode <> new.mode
    and (old.mode like 'shadow_refresh:%' or new.mode like 'shadow_refresh:%') then
    raise exception 'hosted_job_mode_is_immutable';
  end if;
  if new.mode like 'shadow_refresh:%' and
    (new.state = 'ready' or new.committed_evidence_version is not null or new.ready_at is not null) then
    raise exception 'isolated_refresh_cannot_publish';
  end if;
  return new;
end;
$$;
revoke all on function public.ecos_guard_isolated_page_refresh() from public, anon, authenticated;
grant execute on function public.ecos_guard_isolated_page_refresh() to service_role;
create trigger ecos_isolated_page_refresh_guard before insert or update
  on public.ecos_hosted_index_jobs for each row
  execute function public.ecos_guard_isolated_page_refresh();

create function public.ecos_guard_isolated_refresh_page()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from public.ecos_hosted_index_jobs where id=new.job_id and mode like 'shadow_refresh:%')
    and not exists (select 1 from public.ecos_hosted_page_refreshes r
      where r.candidate_job_id=new.job_id and r.page_number=new.page_number
      and r.source_sha256=new.source_sha256 and r.state='preparing') then
    raise exception 'isolated_refresh_exact_page_required';
  end if;
  return new;
end;
$$;
revoke all on function public.ecos_guard_isolated_refresh_page() from public,anon,authenticated;
grant execute on function public.ecos_guard_isolated_refresh_page() to service_role;
create trigger ecos_isolated_refresh_page_guard before insert or update
  on public.ecos_hosted_index_pages for each row execute function public.ecos_guard_isolated_refresh_page();

create function public.ecos_begin_isolated_page_refresh(
  p_parent_job_id uuid, p_page_number integer, p_expected_source_sha256 text
) returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare
  parent public.ecos_hosted_index_jobs%rowtype;
  page public.ecos_hosted_index_pages%rowtype;
  source public.reference_documents%rowtype;
  candidate public.ecos_hosted_index_jobs%rowtype;
  candidate_id uuid := gen_random_uuid();
  refresh_id uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise insufficient_privilege using message = 'worker_authorization_required';
  end if;
  if p_expected_source_sha256 is null or p_expected_source_sha256 !~ '^[a-f0-9]{64}$'
    or p_page_number is null or p_page_number not between 1 and 10000 then
    raise invalid_parameter_value using message = 'exact_refresh_identity_required';
  end if;
  select * into parent from public.ecos_hosted_index_jobs where id = p_parent_job_id for update;
  if not found or parent.mode <> 'shadow' or parent.state <> 'ready'
    or parent.source_sha256 <> p_expected_source_sha256 or parent.claim_token is not null
    or parent.unresolved_region_count <> 0 or parent.source_scan_status <> 'clean'
    or parent.committed_evidence_version is distinct from 'ecos-hosted-evidence/1.3'
    or not public.ecos_hosted_job_matches_reference(parent.id,true) then
    raise exception 'current_assured_shadow_source_required';
  end if;
  if exists (select 1 from public.ecos_hosted_page_refreshes
    where parent_job_id=parent.id and state in ('preparing','verified')) then
    raise exception 'refresh_already_in_progress';
  end if;
  if not exists (select 1 from public.ecos_hosted_index_configuration
    where organization_id=parent.organization_id and enabled=false and publication_mode='shadow') then
    raise exception 'disabled_shadow_configuration_required';
  end if;
  select * into page from public.ecos_hosted_index_pages
    where job_id=parent.id and page_number=p_page_number for update;
  if not found or page.state <> 'assured' or page.unresolved_region_count <> 0
    or page.assurance_result->>'accepted' is distinct from 'true' then
    raise exception 'current_assured_page_required';
  end if;
  select * into source from public.reference_documents
    where id::text=parent.document_id and owner_id=parent.source_owner_id for update;
  if not found then raise exception 'current_reference_required'; end if;
  insert into public.ecos_hosted_index_jobs (
    id,organization_id,project_id,document_id,source_owner_id,source_provider,source_locator,
    source_sha256,source_page_count,source_revision,mode,state,claimed_by,claim_token,
    lease_expires_at,requested_by,source_scan_status,source_scan_engine,source_scan_at,
    source_byte_count,target_evidence_version,max_retry_count
  ) values (
    candidate_id,parent.organization_id,parent.project_id,parent.document_id,parent.source_owner_id,
    parent.source_provider,parent.source_locator,parent.source_sha256,parent.source_page_count,
    parent.source_revision,'shadow_refresh:'||candidate_id::text,'extracting','isolated-page-refresh',gen_random_uuid(),
    now()+interval '30 minutes',parent.requested_by,parent.source_scan_status,parent.source_scan_engine,
    parent.source_scan_at,parent.source_byte_count,'ecos-hosted-evidence/1.3',1
  ) returning * into candidate;
  insert into public.ecos_hosted_page_refreshes (
    parent_job_id,candidate_job_id,page_number,source_sha256,parent_page_sha256,parent_reference_sha256
  ) values (parent.id,candidate.id,p_page_number,parent.source_sha256,
    encode(extensions.digest(to_jsonb(page)::text,'sha256'),'hex'),
    encode(extensions.digest(to_jsonb(source)::text,'sha256'),'hex')) returning id into refresh_id;
  return jsonb_build_object('refreshId',refresh_id,'pageNumber',p_page_number,
    'job',to_jsonb(candidate)||jsonb_build_object('job_id',candidate.id));
end;
$$;
revoke all on function public.ecos_begin_isolated_page_refresh(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.ecos_begin_isolated_page_refresh(uuid,integer,text) to service_role;

create function public.ecos_read_isolated_page_refresh(p_refresh_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  r public.ecos_hosted_page_refreshes%rowtype;
  j public.ecos_hosted_index_jobs%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise insufficient_privilege using message = 'worker_authorization_required';
  end if;
  select * into r from public.ecos_hosted_page_refreshes where id=p_refresh_id;
  if not found or r.state not in ('preparing','verified') then raise exception 'active_refresh_required'; end if;
  select * into j from public.ecos_hosted_index_jobs where id=r.candidate_job_id;
  if j.mode <> 'shadow_refresh:'||j.id::text or j.source_sha256 <> r.source_sha256
    or j.claim_token is null or j.lease_expires_at <= now()
    or j.state not in ('extracting','mapping','awaiting_visual','assuring') then
    raise exception 'isolated_refresh_lease_required';
  end if;
  if not exists (select 1 from public.ecos_hosted_index_pages p
    where p.job_id=r.parent_job_id and p.page_number=r.page_number
    and encode(extensions.digest(to_jsonb(p)::text,'sha256'),'hex')=r.parent_page_sha256)
    or not exists (select 1 from public.reference_documents d
      where d.id::text=j.document_id and d.owner_id=j.source_owner_id
      and encode(extensions.digest(to_jsonb(d)::text,'sha256'),'hex')=r.parent_reference_sha256)
    or not public.ecos_hosted_job_matches_reference(r.parent_job_id,true) then
    raise exception 'parent_page_changed';
  end if;
  return jsonb_build_object('refreshId',r.id,'pageNumber',r.page_number,
    'job',to_jsonb(j)||jsonb_build_object('job_id',j.id));
end;
$$;
revoke all on function public.ecos_read_isolated_page_refresh(uuid) from public,anon,authenticated;
grant execute on function public.ecos_read_isolated_page_refresh(uuid) to service_role;

create function public.ecos_finish_isolated_page_refresh(p_refresh_id uuid,p_cancel boolean default false)
returns boolean language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare r public.ecos_hosted_page_refreshes%rowtype; j public.ecos_hosted_index_jobs%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise insufficient_privilege using message='worker_authorization_required';
  end if;
  if p_cancel is null then raise invalid_parameter_value using message='explicit_cancel_flag_required'; end if;
  select * into r from public.ecos_hosted_page_refreshes where id=p_refresh_id for update;
  if not found or r.state not in ('preparing','verified') then raise exception 'active_refresh_required'; end if;
  select * into j from public.ecos_hosted_index_jobs where id=r.candidate_job_id for update;
  if j.mode <> 'shadow_refresh:'||j.id::text or j.source_sha256<>r.source_sha256 then raise exception 'isolated_refresh_required'; end if;
  if not p_cancel and not exists (select 1 from public.ecos_hosted_index_pages p
    where p.job_id=j.id and p.page_number=r.page_number and p.state='assured'
    and p.source_sha256=r.source_sha256 and p.unresolved_region_count=0
    and p.assurance_result->>'accepted'='true'
    and p.assurance_result->>'sourceSha256'=r.source_sha256
    and p.assurance_result->>'projectId'=j.project_id
    and p.assurance_result->>'pageNumber'=r.page_number::text
    and p.assurance_result->>'evidenceVersion'='ecos-hosted-evidence/1.3') then
    raise exception 'fresh_page_assurance_required';
  end if;
  update public.ecos_hosted_page_refreshes set state=case when p_cancel then 'cancelled' else 'verified' end where id=r.id;
  update public.ecos_hosted_index_jobs set state=case when p_cancel then 'cancelled' else 'needs_review' end,
    claim_token=null,claimed_by=null,lease_expires_at=null,updated_at=now() where id=j.id;
  return true;
end;
$$;
revoke all on function public.ecos_finish_isolated_page_refresh(uuid,boolean) from public,anon,authenticated;
grant execute on function public.ecos_finish_isolated_page_refresh(uuid,boolean) to service_role;

commit;
