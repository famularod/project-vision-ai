-- Disposable PostgreSQL fixture for
-- 20260809222329_ecos_reference_document_authority_keys_guard.sql.
-- The runner executes everything above the APPLY marker, applies the real
-- migration, then executes everything below the ASSERT marker. Never run this
-- fixture against a shared or production database.

create schema auth;
create role anon;
create role authenticated;
create role service_role;
create extension if not exists pgcrypto;

create function auth.jwt() returns jsonb language sql stable as $$
  select case
    when current_setting('request.jwt.claim.role', true) = '' then '{}'::jsonb
    else jsonb_build_object('role', current_setting('request.jwt.claim.role', true))
  end;
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.fixture_uid', true), '')::uuid;
$$;

create table public.projects (
  id uuid primary key,
  owner_id uuid not null,
  name text not null,
  archived boolean not null default false
);
create table public.reference_documents (
  id text primary key,
  owner_id uuid not null,
  name text not null,
  category text not null,
  document_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.organization_memberships (
  organization_id text not null,
  user_id uuid not null,
  status text not null
);
create table public.ecos_hosted_index_configuration (
  organization_id text primary key,
  publication_mode text not null default 'shadow',
  enabled boolean not null default true
);
create table public.ecos_hosted_index_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  project_id text not null,
  document_id text not null,
  source_owner_id uuid not null,
  source_sha256 text not null,
  source_page_count integer,
  source_revision text,
  source_provider text not null default 'supabase_storage',
  source_locator jsonb not null default '{}'::jsonb,
  mode text not null default 'shadow',
  state text not null default 'queued',
  completed_page_count integer not null default 0,
  assured_page_count integer not null default 0,
  unresolved_region_count integer not null default 0,
  committed_evidence_version text,
  requested_by uuid not null,
  ready_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.ecos_hosted_index_pages (
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  organization_id text not null,
  project_id text not null,
  document_id text not null,
  page_number integer not null,
  source_sha256 text not null,
  state text not null,
  assurance_result jsonb not null default '{}'::jsonb,
  unresolved_region_count integer not null default 0
);
create table public.ecos_hosted_shadow_chunks (
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  organization_id text not null,
  project_id text not null,
  document_id text not null,
  source_sha256 text not null,
  page_number integer not null
);
create table public.ecos_hosted_document_pages (
  organization_id text not null,
  project_id text not null,
  document_id text not null,
  page_number integer not null,
  source_sha256 text not null,
  evidence_version text not null
);
create table public.ecos_hosted_document_chunks (
  organization_id text not null,
  document_id text not null
);
create table public.ecos_hosted_visual_exceptions (
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade
);
create table public.ecos_hosted_shadow_materialization_queue (
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade
);
create table public.ecos_hosted_index_usage (
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade
);
create table public.ecos_drawing_analysis_requests (
  hosted_job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade
);
create table public.ecos_drawing_provider_attempts (
  hosted_job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade
);
create table public.ecos_document_index_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  document_id text not null,
  status text not null default 'queued',
  source_sha256 text not null,
  source_page_count integer not null,
  completed_page_count integer not null default 0,
  updated_at timestamptz not null default now()
);

-- This deliberately models the retired nested legacy marker path. The real
-- migration must remove it rather than trusting generic trigger depth.
create function public.ecos_mark_verified_index_commit()
returns trigger language plpgsql security invoker as $$
begin
  if new.status = 'committed' then
    update public.reference_documents source
    set document_data = source.document_data || jsonb_build_object(
      'ecosVerifiedIndexCommitVersion','ecos-verified-index-commit/1.0',
      'ecosVerifiedIndexCommittedSha256',new.source_sha256,
      'ecosVerifiedIndexCommittedPageCount',new.source_page_count
    )
    where source.id = new.document_id and source.owner_id = new.owner_id;
  end if;
  return new;
end;
$$;
create trigger ecos_mark_verified_index_commit_trigger
after insert or update of status, completed_page_count
on public.ecos_document_index_jobs
for each row when (new.status = 'committed')
execute function public.ecos_mark_verified_index_commit();

create function public.ecos_hosted_job_matches_reference(uuid, boolean default false)
returns boolean language sql stable as $$ select true; $$;

create function public.ecos_enqueue_hosted_reference(text, uuid, uuid)
returns uuid language plpgsql security definer as $$
declare
  selected_org text;
  selected_data jsonb;
  selected_id uuid;
  configured boolean;
begin
  select document_data into selected_data
  from public.reference_documents
  where id = $1 and owner_id = $2;
  if not found then return null; end if;
  selected_org := coalesce(selected_data->>'organizationId', 'org-default');
  insert into public.ecos_hosted_index_configuration(organization_id)
  values (selected_org) on conflict do nothing;
  select enabled into configured from public.ecos_hosted_index_configuration
  where organization_id = selected_org;
  if configured is distinct from true then return null; end if;
  insert into public.ecos_hosted_index_jobs(
    organization_id, project_id, document_id, source_owner_id,
    source_sha256, source_page_count, source_revision, mode, state, requested_by
  ) values (
    selected_org,
    coalesce(selected_data->>'projectId', selected_data->>'projectName'),
    $1, $2, selected_data->>'contentSha256', 1,
    selected_data->>'drawingRevision', 'shadow', 'queued', coalesce($3, $2)
  ) returning id into selected_id;
  return selected_id;
end;
$$;
grant execute on function public.ecos_enqueue_hosted_reference(text, uuid, uuid) to service_role;

create function public.ecos_enqueue_hosted_index_from_reference_document()
returns trigger language plpgsql security definer as $$
begin
  perform public.ecos_enqueue_hosted_reference(new.id, new.owner_id, new.owner_id);
  return new;
end;
$$;
create trigger ecos_reference_document_hosted_enqueue
after insert or update of document_data on public.reference_documents
for each row execute function public.ecos_enqueue_hosted_index_from_reference_document();

create function public.ecos_reference_document_project_scope(jsonb)
returns text language sql immutable as $$ select coalesce($1->>'projectId', $1->>'projectName', ''); $$;
create function public.ecos_require_atomic_current_reference_activation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
      and (
        old.document_data->>'isCurrent' is distinct from new.document_data->>'isCurrent'
        or public.ecos_reference_document_project_scope(old.document_data) is distinct from
          public.ecos_reference_document_project_scope(new.document_data)
      )
      and current_setting('app.ecos_current_activation', true) is distinct from 'allowed' then
    raise exception 'ecos_atomic_current_activation_required';
  end if;
  return new;
end;
$$;
create trigger ecos_reference_document_atomic_current_guard
before update of document_data on public.reference_documents
for each row execute function public.ecos_require_atomic_current_reference_activation();

insert into public.projects(id, owner_id, name) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Unique Project'),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Shared Name'),
  ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Shared  Name');
insert into public.organization_memberships values
  ('org-held', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active'),
  ('org-no-config', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active');
insert into public.ecos_hosted_index_configuration values ('org-held', 'shadow', false);

alter table public.reference_documents disable trigger ecos_reference_document_hosted_enqueue;
insert into public.reference_documents(id, owner_id, name, category, document_data) values
  ('doc-rebound', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A101', 'Drawing', jsonb_build_object(
    'id','doc-rebound','name','A101','category','Drawing','projectName','Unique Project',
    'organizationId','org-held','contentSha256',repeat('a',64),'drawingRevision','A',
    'isCurrent',true,'drawingStatus','For Construction','storagePath','owner/A101.pdf',
    'ecosVerifiedIndexCommitVersion','ecos-verified-index-commit/1.0',
    'ecosVerifiedIndexCommittedSha256',repeat('a',64),'ecosVerifiedIndexCommittedPageCount',1,
    'ecosHostedIndexStatus','Ready for ECOS')),
  ('doc-ambiguous', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A102', 'Drawing', jsonb_build_object(
    'id','doc-ambiguous','name','A102','category','Drawing','projectName','Shared Name',
    'organizationId','org-held','contentSha256',repeat('b',64),'drawingRevision','A',
    'isCurrent',false,'drawingStatus','For Review','storagePath','owner/A102.pdf',
    'ecosVerifiedIndexCommitVersion','ecos-verified-index-commit/1.0')),
  ('doc-exact-purged', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A103', 'Drawing', jsonb_build_object(
    'id','doc-exact-purged','name','A103','category','Drawing',
    'projectId','11111111-1111-4111-8111-111111111111','projectName','Unique Project',
    'organizationId','org-held','contentSha256',repeat('c',64),'drawingRevision','A',
    'isCurrent',true,'drawingStatus','For Construction','storagePath','owner/A103.pdf',
    'ecosVerifiedIndexCommitVersion','ecos-verified-index-commit/1.0',
    'ecosVerifiedIndexCommittedSha256',repeat('c',64),'ecosVerifiedIndexCommittedPageCount',1)),
  ('doc-orphan-public', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A104', 'Drawing', jsonb_build_object(
    'id','doc-orphan-public','name','A104','category','Drawing','projectName','Unique Project',
    'organizationId','org-no-config','contentSha256',repeat('d',64),'drawingRevision','A',
    'isCurrent',false,'drawingStatus','For Review','storagePath','owner/A104.pdf')),
  ('doc-multi-name', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A109', 'Drawing', jsonb_build_object(
    'id','doc-multi-name','name','A109','category','Drawing','projectName','Unique Project',
    'projectNames',jsonb_build_array('Unique Project','Shared Name'),
    'organizationId','org-held','contentSha256',repeat('9',64),'drawingRevision','A',
    'isCurrent',false,'drawingStatus','For Review','storagePath','owner/A109.pdf',
    'ecosVerifiedIndexCommitVersion','ecos-verified-index-commit/1.0'));
alter table public.reference_documents enable trigger ecos_reference_document_hosted_enqueue;

insert into public.ecos_hosted_index_jobs(
  id, organization_id, project_id, document_id, source_owner_id, source_sha256,
  source_page_count, source_revision, mode, state, completed_page_count,
  assured_page_count, committed_evidence_version, requested_by
) values
  ('aaaaaaaa-0000-4000-8000-000000000001','org-held','Unique Project','doc-rebound','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',64),1,'A','shadow','ready',1,1,'ecos-hosted-evidence/1.3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('aaaaaaaa-0000-4000-8000-000000000002','org-held','Shared Name','doc-ambiguous','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('b',64),1,'A','shadow','ready',1,1,'ecos-hosted-evidence/1.3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('aaaaaaaa-0000-4000-8000-000000000003','org-held','11111111-1111-4111-8111-111111111111','doc-exact-purged','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('c',64),1,'A','shadow','ready',1,1,'ecos-hosted-evidence/1.3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('aaaaaaaa-0000-4000-8000-000000000004','org-held','Unique Project','doc-multi-name','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('9',64),1,'A','shadow','ready',1,1,'ecos-hosted-evidence/1.3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.ecos_hosted_index_pages values
  ('aaaaaaaa-0000-4000-8000-000000000001','org-held','Unique Project','doc-rebound',1,repeat('a',64),'assured','{"accepted":true}',0);
insert into public.ecos_hosted_shadow_chunks values
  ('aaaaaaaa-0000-4000-8000-000000000001','org-held','Unique Project','doc-rebound',repeat('a',64),1);
insert into public.ecos_hosted_visual_exceptions values ('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.ecos_hosted_shadow_materialization_queue values ('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.ecos_hosted_index_usage values ('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.ecos_drawing_analysis_requests values ('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.ecos_drawing_provider_attempts values ('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.ecos_hosted_document_pages values
  ('org-held','Unique Project','doc-rebound',1,repeat('a',64),'ecos-hosted-evidence/1.3'),
  ('orphan-org','Unique Project','doc-orphan-public',1,repeat('d',64),'ecos-hosted-evidence/1.3');
insert into public.ecos_hosted_document_chunks values
  ('org-held','doc-rebound'),('orphan-org','doc-orphan-public');

-- APPLY_REAL_MIGRATION_HERE

-- ASSERT_AFTER_REAL_MIGRATION_HERE

do $$
declare
  selected jsonb;
begin
  select document_data into selected from public.reference_documents where id='doc-rebound';
  if selected->>'projectId' <> '11111111-1111-4111-8111-111111111111'
      or selected ? 'ecosVerifiedIndexCommitVersion'
      or selected ? 'ecosHostedIndexStatus' then
    raise exception 'fixture_rebound_or_purge_failed';
  end if;
  select document_data into selected from public.reference_documents where id='doc-ambiguous';
  if selected ? 'projectId' or selected ? 'ecosVerifiedIndexCommitVersion' then
    raise exception 'fixture_ambiguous_name_did_not_fail_closed';
  end if;
  select document_data into selected from public.reference_documents where id='doc-multi-name';
  if selected ? 'projectId' or selected ? 'ecosVerifiedIndexCommitVersion' then
    raise exception 'fixture_multi_project_name_did_not_fail_closed';
  end if;
  if exists (select 1 from public.ecos_hosted_index_jobs)
      or exists (select 1 from public.ecos_hosted_document_pages)
      or exists (select 1 from public.ecos_hosted_document_chunks)
      or exists (select 1 from public.ecos_hosted_index_pages)
      or exists (select 1 from public.ecos_hosted_shadow_chunks)
      or exists (select 1 from public.ecos_hosted_visual_exceptions)
      or exists (select 1 from public.ecos_hosted_shadow_materialization_queue)
      or exists (select 1 from public.ecos_hosted_index_usage)
      or exists (select 1 from public.ecos_drawing_analysis_requests)
      or exists (select 1 from public.ecos_drawing_provider_attempts) then
    raise exception 'fixture_old_hosted_graph_survived';
  end if;
  if exists (select 1 from public.ecos_hosted_index_configuration where organization_id='org-no-config') then
    raise exception 'fixture_backfill_auto_enabled_missing_configuration';
  end if;
end;
$$;

set request.jwt.claim.role = 'authenticated';
insert into public.reference_documents(id,owner_id,name,category,document_data)
values ('doc-auth-forge','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A105','Drawing',jsonb_build_object(
  'id','doc-auth-forge','name','A105','category','Drawing',
  'projectId','11111111-1111-4111-8111-111111111111','organizationId','org-held',
  'contentSha256',repeat('e',64),'drawingRevision','A','isCurrent',false,
  'drawingStatus','For Review','storagePath','owner/A105.pdf',
  'ecosVerifiedIndexCommitVersion','ecos-verified-index-commit/1.0',
  'ecosVerifiedIndexCommittedSha256',repeat('e',64),'ecosVerifiedIndexCommittedPageCount',1,
  'ecosHostedIndexStatus','Ready for ECOS'));
do $$ begin
  if (select document_data ? 'ecosVerifiedIndexCommitVersion' or document_data ? 'ecosHostedIndexStatus'
      from public.reference_documents where id='doc-auth-forge') then
    raise exception 'fixture_authenticated_insert_self_attested';
  end if;
end $$;

-- Authenticated writes to the retired legacy commit table can no longer mint
-- or replace a compact hosted Assurance receipt.
insert into public.ecos_document_index_jobs(
  owner_id,document_id,status,source_sha256,source_page_count,completed_page_count
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','doc-auth-forge','committed',repeat('e',64),1,1
);
do $$ begin
  if (select document_data ? 'ecosVerifiedIndexCommitVersion'
      from public.reference_documents where id='doc-auth-forge') then
    raise exception 'fixture_legacy_commit_minted_hosted_receipt';
  end if;
end $$;

set request.jwt.claim.role = 'service_role';
insert into public.reference_documents(id,owner_id,name,category,document_data)
values ('doc-ready','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A106','Drawing',jsonb_build_object(
  'id','doc-ready','name','A106','category','Drawing',
  'projectId','11111111-1111-4111-8111-111111111111','organizationId','org-held',
  'contentSha256',repeat('f',64),'drawingRevision','A','isCurrent',false,
  'drawingStatus','For Review','storagePath','owner/A106.pdf'));
insert into public.ecos_hosted_index_jobs(
  id,organization_id,project_id,document_id,source_owner_id,source_sha256,
  source_page_count,source_revision,mode,state,requested_by
) values (
  'aaaaaaaa-0000-4000-8000-000000000006','org-held','11111111-1111-4111-8111-111111111111',
  'doc-ready','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('f',64),1,'A','shadow','queued',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.ecos_hosted_index_pages values
  ('aaaaaaaa-0000-4000-8000-000000000006','org-held','11111111-1111-4111-8111-111111111111','doc-ready',1,repeat('f',64),'assured','{"accepted":true}',0);
insert into public.ecos_hosted_shadow_chunks values
  ('aaaaaaaa-0000-4000-8000-000000000006','org-held','11111111-1111-4111-8111-111111111111','doc-ready',repeat('f',64),1);
update public.ecos_hosted_index_jobs set
  state='ready', completed_page_count=1, assured_page_count=1,
  committed_evidence_version='ecos-hosted-evidence/1.3', ready_at=now(), updated_at=now()
where id='aaaaaaaa-0000-4000-8000-000000000006';

do $$ begin
  if not (select document_data @> jsonb_build_object(
      'indexedContentSha256',repeat('f',64),'sourcePageCount',1,
      'ecosVerifiedIndexCommitVersion','ecos-verified-index-commit/1.0',
      'ecosVerifiedIndexCommittedSha256',repeat('f',64),
      'ecosVerifiedIndexCommittedPageCount',1)
    from public.reference_documents where id='doc-ready') then
    raise exception 'fixture_hosted_ready_did_not_restore_commit';
  end if;
end $$;

-- A nested trigger unrelated to hosted evidence cannot acquire marker-writing
-- authority merely because its reference-document update is nested.
create table public.fixture_nested_authority_updates (id integer primary key);
create function public.fixture_nested_authority_update()
returns trigger language plpgsql as $$
begin
  update public.reference_documents
  set document_data = document_data || jsonb_build_object(
    'ecosVerifiedIndexCommittedSha256',repeat('0',64),
    'ecosHostedIndexStatus','Ready for ECOS'
  )
  where id='doc-ready';
  return new;
end;
$$;
create trigger fixture_nested_authority_update_trigger
after insert on public.fixture_nested_authority_updates
for each row execute function public.fixture_nested_authority_update();
set request.jwt.claim.role = 'authenticated';
insert into public.fixture_nested_authority_updates values (1);
do $$ begin
  if (select document_data->>'ecosVerifiedIndexCommittedSha256' <> repeat('f',64)
      or document_data ? 'ecosHostedIndexStatus'
      from public.reference_documents where id='doc-ready') then
    raise exception 'fixture_unrelated_nested_trigger_bypassed_authority_guard';
  end if;
end $$;

set request.jwt.claim.role = 'authenticated';
update public.reference_documents
set document_data = document_data || jsonb_build_object(
  'notes','safe note edit','ecosVerifiedIndexCommittedSha256',repeat('0',64))
where id='doc-ready';
do $$ begin
  if (select document_data->>'ecosVerifiedIndexCommittedSha256' <> repeat('f',64)
      from public.reference_documents where id='doc-ready') then
    raise exception 'fixture_note_edit_did_not_preserve_old_receipt';
  end if;
end $$;

select set_config('app.ecos_current_activation','allowed',true);
update public.reference_documents
set document_data = document_data || jsonb_build_object('isCurrent',true)
where id='doc-ready';
select set_config('app.ecos_current_activation','',true);
do $$ begin
  if (select document_data->>'ecosVerifiedIndexCommitVersion' is distinct from
      'ecos-verified-index-commit/1.0' from public.reference_documents where id='doc-ready') then
    raise exception 'fixture_atomic_activation_stranded_commit';
  end if;
end $$;

-- Switching current revisions A -> B -> A must not strand the already-assured
-- receipt. Currentness is checked separately at answer time; the compact
-- marker attests the unchanged source evidence.
select set_config('app.ecos_current_activation','allowed',true);
update public.reference_documents
set document_data = document_data || jsonb_build_object('isCurrent',false)
where id='doc-ready';
select set_config('app.ecos_current_activation','',true);
do $$ begin
  if (select document_data->>'ecosVerifiedIndexCommitVersion' is distinct from
      'ecos-verified-index-commit/1.0' from public.reference_documents where id='doc-ready') then
    raise exception 'fixture_atomic_demotion_stranded_commit';
  end if;
end $$;

select set_config('app.ecos_current_activation','allowed',true);
update public.reference_documents
set document_data = document_data || jsonb_build_object('isCurrent',true)
where id='doc-ready';
select set_config('app.ecos_current_activation','',true);
do $$ begin
  if (select document_data->>'ecosVerifiedIndexCommitVersion' is distinct from
      'ecos-verified-index-commit/1.0' from public.reference_documents where id='doc-ready') then
    raise exception 'fixture_atomic_reactivation_stranded_commit';
  end if;
end $$;

update public.reference_documents
set document_data = document_data || jsonb_build_object('drawingRevision','B')
where id='doc-ready';
do $$ begin
  if (select document_data ? 'ecosVerifiedIndexCommitVersion'
      from public.reference_documents where id='doc-ready') then
    raise exception 'fixture_identity_change_preserved_commit';
  end if;
end $$;

-- Count equality is insufficient: pages 2..N+1 must never attest pages 1..N.
set request.jwt.claim.role = 'service_role';
insert into public.reference_documents(id,owner_id,name,category,document_data)
values ('doc-shifted-pages','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A108','Drawing',jsonb_build_object(
  'id','doc-shifted-pages','name','A108','category','Drawing',
  'projectId','11111111-1111-4111-8111-111111111111','organizationId','org-held',
  'contentSha256',repeat('8',64),'drawingRevision','A','isCurrent',false,
  'drawingStatus','For Review','storagePath','owner/A108.pdf'));
insert into public.ecos_hosted_index_jobs(
  id,organization_id,project_id,document_id,source_owner_id,source_sha256,
  source_page_count,source_revision,mode,state,requested_by
) values (
  'aaaaaaaa-0000-4000-8000-000000000008','org-held','11111111-1111-4111-8111-111111111111',
  'doc-shifted-pages','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('8',64),2,'A','shadow','queued',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.ecos_hosted_index_pages values
  ('aaaaaaaa-0000-4000-8000-000000000008','org-held','11111111-1111-4111-8111-111111111111','doc-shifted-pages',2,repeat('8',64),'assured','{"accepted":true}',0),
  ('aaaaaaaa-0000-4000-8000-000000000008','org-held','11111111-1111-4111-8111-111111111111','doc-shifted-pages',3,repeat('8',64),'assured','{"accepted":true}',0);
insert into public.ecos_hosted_shadow_chunks values
  ('aaaaaaaa-0000-4000-8000-000000000008','org-held','11111111-1111-4111-8111-111111111111','doc-shifted-pages',repeat('8',64),2),
  ('aaaaaaaa-0000-4000-8000-000000000008','org-held','11111111-1111-4111-8111-111111111111','doc-shifted-pages',repeat('8',64),3);
do $$ begin
  begin
    update public.ecos_hosted_index_jobs set
      state='ready', completed_page_count=2, assured_page_count=2,
      committed_evidence_version='ecos-hosted-evidence/1.3'
    where id='aaaaaaaa-0000-4000-8000-000000000008';
    raise exception 'fixture_shifted_page_set_was_accepted';
  exception
    when others then
      if sqlerrm = 'fixture_shifted_page_set_was_accepted' then raise; end if;
      if sqlerrm not like '%exact page evidence%' then raise; end if;
  end;
end $$;

-- Two exact projects may share a display name. Activating B must leave A's
-- independently-current drawing alone.
alter table public.reference_documents disable trigger ecos_reference_document_hosted_enqueue;
insert into public.reference_documents(id,owner_id,name,category,document_data) values
  ('doc-same-name-a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','C101','Drawing',jsonb_build_object(
    'id','doc-same-name-a','name','C101','category','Drawing',
    'projectId','22222222-2222-4222-8222-222222222222','projectName','Shared Project',
    'isCurrent',true)),
  ('doc-same-name-b','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','C101','Drawing',jsonb_build_object(
    'id','doc-same-name-b','name','C101','category','Drawing',
    'projectId','33333333-3333-4333-8333-333333333333','projectName','Shared Project',
    'isCurrent',false));
select set_config('app.ecos_current_activation','allowed',true);
update public.reference_documents candidate
set document_data = candidate.document_data || jsonb_build_object(
  'isCurrent', candidate.id = 'doc-same-name-b'
)
where candidate.name='C101'
  and public.ecos_reference_documents_share_project(
    (select document_data from public.reference_documents where id='doc-same-name-b'),
    candidate.document_data
  );
select set_config('app.ecos_current_activation','',true);
do $$ begin
  if not (select document_data->>'isCurrent' = 'true'
      from public.reference_documents where id='doc-same-name-a')
      or not (select document_data->>'isCurrent' = 'true'
      from public.reference_documents where id='doc-same-name-b') then
    raise exception 'fixture_same_name_cross_project_activation_demoted_wrong_project';
  end if;
end $$;
alter table public.reference_documents enable trigger ecos_reference_document_hosted_enqueue;

reset request.jwt.claim.role;
insert into public.reference_documents(id,owner_id,name,category,document_data)
values ('doc-no-jwt','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A107','Drawing',jsonb_build_object(
  'id','doc-no-jwt','name','A107','category','Drawing',
  'projectId','11111111-1111-4111-8111-111111111111',
  'organizationId','org-held','contentSha256',repeat('7',64),
  'drawingRevision','A','isCurrent',false,'drawingStatus','For Review',
  'storagePath','owner/A107.pdf',
  'ecosVerifiedIndexCommitVersion','ecos-verified-index-commit/1.0'));
do $$ begin
  if (select document_data ? 'ecosVerifiedIndexCommitVersion'
      from public.reference_documents where id='doc-no-jwt') then
    raise exception 'fixture_no_jwt_insert_self_attested';
  end if;
end $$;

select 'ECOS_REFERENCE_AUTHORITY_TRANSACTION_OK' as receipt;
