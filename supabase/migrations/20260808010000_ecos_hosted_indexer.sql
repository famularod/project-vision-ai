-- ECOS Hosted Indexer 1.0
--
-- Additive, organization-scoped production queue and verified evidence store.
-- Customer sessions may enqueue and read safe status only. All source fetching,
-- checkpoints, internal diagnostics, visual exceptions, and publication are
-- restricted to the Vitruvius service role. The default organization mode is
-- shadow so this path cannot replace the current index before acceptance.

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.ecos_hosted_index_configuration (
  organization_id text primary key references public.organizations(id) on delete cascade,
  publication_mode text not null default 'shadow'
    check (publication_mode in ('shadow', 'live')),
  enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ecos_hosted_index_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null check (length(trim(project_id)) between 1 and 500),
  document_id text not null check (length(trim(document_id)) between 1 and 200),
  source_owner_id uuid not null references auth.users(id) on delete cascade,
  source_provider text not null
    check (source_provider in ('supabase_storage', 'google_drive', 'managed_upload')),
  source_locator jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_locator) = 'object'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_page_count integer check (
    source_page_count is null or (source_page_count > 0 and source_page_count <= 10000)
  ),
  source_revision text,
  mode text not null default 'shadow' check (mode in ('shadow', 'live')),
  state text not null default 'queued' check (state in (
    'queued',
    'fetching_source',
    'extracting',
    'mapping',
    'awaiting_visual',
    'assuring',
    'ready',
    'needs_review',
    'reconnect_source',
    'temporarily_unavailable',
    'failed_internal',
    'cancelled'
  )),
  completed_page_count integer not null default 0 check (completed_page_count >= 0),
  assured_page_count integer not null default 0 check (assured_page_count >= 0),
  unresolved_region_count integer not null default 0 check (unresolved_region_count >= 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  max_retry_count integer not null default 8 check (max_retry_count between 1 and 50),
  next_attempt_at timestamptz,
  claimed_by text,
  claim_token uuid,
  lease_expires_at timestamptz,
  failure_category text,
  failure_diagnostics jsonb not null default '{}'::jsonb
    check (jsonb_typeof(failure_diagnostics) = 'object'),
  customer_message text,
  support_reference text not null unique default (
    'ECOS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
  ),
  committed_evidence_version text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  unique (organization_id, document_id, source_sha256, mode)
);

create table if not exists public.ecos_hosted_index_pages (
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  document_id text not null,
  page_number integer not null check (page_number between 1 and 10000),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'extracted' check (state in (
    'extracted', 'mapped', 'awaiting_visual', 'assured', 'rejected'
  )),
  native_page_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(native_page_data) = 'object'),
  ocr_page_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(ocr_page_data) = 'object'),
  deterministic_page_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(deterministic_page_data) = 'object'),
  final_page_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(final_page_data) = 'object'),
  assurance_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(assurance_result) = 'object'),
  unresolved_region_count integer not null default 0 check (unresolved_region_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, page_number)
);

create table if not exists public.ecos_hosted_visual_exceptions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  document_id text not null,
  page_number integer not null check (page_number between 1 and 10000),
  region_key text not null check (length(trim(region_key)) between 1 and 300),
  bounds jsonb not null check (jsonb_typeof(bounds) = 'object'),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  state text not null default 'queued' check (state in (
    'queued', 'processing', 'resolved', 'needs_review', 'temporarily_unavailable', 'cancelled'
  )),
  provider_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_result) = 'object'),
  normalized_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(normalized_evidence) = 'object'),
  assurance_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(assurance_result) = 'object'),
  retry_count integer not null default 0 check (retry_count >= 0),
  next_attempt_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, page_number, region_key)
);

create table if not exists public.ecos_hosted_document_pages (
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  document_id text not null,
  page_number integer not null check (page_number between 1 and 10000),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_version text not null,
  sheet_number text,
  sheet_title text,
  sheet_mapping_status text not null
    check (sheet_mapping_status in ('verified', 'conflicted', 'unverified')),
  page_text text,
  regions jsonb not null default '[]'::jsonb check (jsonb_typeof(regions) = 'array'),
  assurance_result jsonb not null check (jsonb_typeof(assurance_result) = 'object'),
  published_at timestamptz not null default now(),
  primary key (organization_id, document_id, page_number)
);

create table if not exists public.ecos_hosted_document_chunks (
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  document_id text not null,
  page_number integer not null check (page_number between 1 and 10000),
  region_id text not null default '',
  chunk_index integer not null default 0 check (chunk_index >= 0),
  chunk_text text not null check (length(trim(chunk_text)) between 1 and 4000),
  sheet_number text,
  confidence numeric(6,5) check (confidence is null or confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(sheet_number, '') || ' ' || chunk_text)
  ) stored,
  published_at timestamptz not null default now(),
  primary key (organization_id, document_id, page_number, region_id, chunk_index)
);

create index if not exists ecos_hosted_index_jobs_queue_idx
  on public.ecos_hosted_index_jobs (state, next_attempt_at, lease_expires_at, created_at);
create index if not exists ecos_hosted_index_jobs_document_idx
  on public.ecos_hosted_index_jobs (organization_id, project_id, document_id, updated_at desc);
create index if not exists ecos_hosted_index_pages_job_idx
  on public.ecos_hosted_index_pages (job_id, state, page_number);
create index if not exists ecos_hosted_visual_exceptions_queue_idx
  on public.ecos_hosted_visual_exceptions (state, next_attempt_at, lease_expires_at, created_at);
create index if not exists ecos_hosted_document_chunks_search_idx
  on public.ecos_hosted_document_chunks using gin (search_vector);
create index if not exists ecos_hosted_document_chunks_fuzzy_idx
  on public.ecos_hosted_document_chunks using gin (lower(chunk_text) extensions.gin_trgm_ops);

alter table public.ecos_hosted_index_configuration enable row level security;
alter table public.ecos_hosted_index_configuration force row level security;
alter table public.ecos_hosted_index_jobs enable row level security;
alter table public.ecos_hosted_index_jobs force row level security;
alter table public.ecos_hosted_index_pages enable row level security;
alter table public.ecos_hosted_index_pages force row level security;
alter table public.ecos_hosted_visual_exceptions enable row level security;
alter table public.ecos_hosted_visual_exceptions force row level security;
alter table public.ecos_hosted_document_pages enable row level security;
alter table public.ecos_hosted_document_pages force row level security;
alter table public.ecos_hosted_document_chunks enable row level security;
alter table public.ecos_hosted_document_chunks force row level security;

revoke all on table public.ecos_hosted_index_configuration from public, anon, authenticated;
revoke all on table public.ecos_hosted_index_jobs from public, anon, authenticated;
revoke all on table public.ecos_hosted_index_pages from public, anon, authenticated;
revoke all on table public.ecos_hosted_visual_exceptions from public, anon, authenticated;
revoke all on table public.ecos_hosted_document_pages from public, anon;
revoke all on table public.ecos_hosted_document_chunks from public, anon;

grant all on table public.ecos_hosted_index_configuration to service_role;
grant all on table public.ecos_hosted_index_jobs to service_role;
grant all on table public.ecos_hosted_index_pages to service_role;
grant all on table public.ecos_hosted_visual_exceptions to service_role;
grant all on table public.ecos_hosted_document_pages to service_role;
grant all on table public.ecos_hosted_document_chunks to service_role;
grant select on table public.ecos_hosted_document_pages to authenticated;
grant select on table public.ecos_hosted_document_chunks to authenticated;

create policy ecos_hosted_document_pages_member_read
  on public.ecos_hosted_document_pages for select to authenticated
  using (public.pie_layer4_has_active_membership(organization_id));

create policy ecos_hosted_document_chunks_member_read
  on public.ecos_hosted_document_chunks for select to authenticated
  using (public.pie_layer4_has_active_membership(organization_id));

create or replace function public.ecos_enqueue_hosted_index_from_reference_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_data jsonb := coalesce(new.document_data, '{}'::jsonb);
  selected_org text;
  selected_project text;
  selected_sha text;
  selected_storage_path text;
  selected_provider text;
  selected_mode text;
  selected_state text;
begin
  if coalesce(source_data->>'isCurrent', 'false') <> 'true'
    or source_data->>'drawingStatus' = 'Superseded' then
    return new;
  end if;
  selected_org := nullif(trim(source_data->>'organizationId'), '');
  if selected_org is null then
    select membership.organization_id into selected_org
    from public.organization_memberships membership
    where membership.user_id = new.owner_id
      and membership.status = 'active'
    order by membership.created_at
    limit 1;
  end if;
  selected_project := coalesce(
    nullif(trim(source_data->>'projectId'), ''),
    nullif(trim(source_data->>'projectName'), ''),
    nullif(trim(source_data->'projectNames'->>0), '')
  );
  selected_sha := lower(coalesce(
    nullif(source_data->>'contentSha256', ''),
    nullif(source_data->>'webFileFingerprint', ''),
    nullif(source_data->>'indexedContentSha256', '')
  ));
  if selected_org is null or selected_project is null or selected_sha !~ '^[a-f0-9]{64}$' then
    return new;
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = selected_org
      and membership.user_id = new.owner_id
      and membership.status = 'active'
  ) then return new; end if;

  selected_storage_path := nullif(trim(source_data->>'storagePath'), '');
  selected_provider := case
    when source_data->>'sourceProvider' = 'google_drive' then 'google_drive'
    when selected_storage_path is not null then 'supabase_storage'
    else 'managed_upload'
  end;
  selected_state := case when selected_storage_path is null
    then 'reconnect_source' else 'queued' end;
  insert into public.ecos_hosted_index_configuration (organization_id)
  values (selected_org)
  on conflict (organization_id) do nothing;
  select configuration.publication_mode into selected_mode
  from public.ecos_hosted_index_configuration configuration
  where configuration.organization_id = selected_org
    and configuration.enabled = true;
  if selected_mode is null then return new; end if;

  insert into public.ecos_hosted_index_jobs (
    organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, customer_message, requested_by
  ) values (
    selected_org, selected_project, new.id::text, new.owner_id,
    selected_provider,
    jsonb_strip_nulls(jsonb_build_object(
      'bucket', case when selected_storage_path is not null then 'project-documents' else null end,
      'path', selected_storage_path,
      'externalSource', source_data->'externalSource'
    )),
    selected_sha,
    case when coalesce(source_data->>'sourcePageCount', '') ~ '^[1-9][0-9]*$'
      then (source_data->>'sourcePageCount')::integer else null end,
    coalesce(nullif(source_data->>'drawingRevision', ''), nullif(source_data->>'webVersionGroupId', '')),
    selected_mode, selected_state,
    case when selected_state = 'reconnect_source'
      then 'Reconnect the source file so Vitruvius can continue preparing it.'
      else 'Vitruvius is preparing this document in the background.' end,
    new.owner_id
  )
  on conflict (organization_id, document_id, source_sha256, mode)
  do update set
    project_id = excluded.project_id,
    source_provider = excluded.source_provider,
    source_locator = excluded.source_locator,
    source_page_count = coalesce(excluded.source_page_count, public.ecos_hosted_index_jobs.source_page_count),
    source_revision = excluded.source_revision,
    state = case
      when public.ecos_hosted_index_jobs.state in ('cancelled', 'reconnect_source', 'failed_internal')
        and excluded.state = 'queued' then 'queued'
      else public.ecos_hosted_index_jobs.state end,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists ecos_reference_document_hosted_enqueue on public.reference_documents;
create trigger ecos_reference_document_hosted_enqueue
after insert or update of document_data on public.reference_documents
for each row execute function public.ecos_enqueue_hosted_index_from_reference_document();

revoke all on function public.ecos_enqueue_hosted_index_from_reference_document()
  from public, anon, authenticated;

create or replace function public.ecos_cleanup_hosted_index_for_reference_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.ecos_hosted_document_chunks chunk
  where chunk.document_id = old.id::text
    and exists (
      select 1 from public.ecos_hosted_index_jobs job
      where job.organization_id = chunk.organization_id
        and job.document_id = old.id::text
        and job.source_owner_id = old.owner_id
    );
  delete from public.ecos_hosted_document_pages page
  where page.document_id = old.id::text
    and exists (
      select 1 from public.ecos_hosted_index_jobs job
      where job.organization_id = page.organization_id
        and job.document_id = old.id::text
        and job.source_owner_id = old.owner_id
    );
  delete from public.ecos_hosted_index_jobs job
  where job.document_id = old.id::text
    and job.source_owner_id = old.owner_id;
  return old;
end;
$$;

drop trigger if exists ecos_reference_document_hosted_cleanup on public.reference_documents;
create trigger ecos_reference_document_hosted_cleanup
before delete on public.reference_documents
for each row execute function public.ecos_cleanup_hosted_index_for_reference_document();

revoke all on function public.ecos_cleanup_hosted_index_for_reference_document()
  from public, anon, authenticated;

create or replace function public.ecos_enqueue_hosted_index(
  p_document_id text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user uuid := auth.uid();
  source_record record;
  source_data jsonb;
  selected_org text;
  selected_project text;
  selected_sha text;
  selected_provider text;
  selected_storage_path text;
  selected_mode text;
  selected_state text;
  job_id uuid;
begin
  if current_user is null then
    raise exception 'Sign in is required';
  end if;

  select source.id, source.owner_id, source.document_data
  into source_record
  from public.reference_documents source
  where source.id::text = trim(p_document_id)
    and source.owner_id = current_user;

  if not found then
    raise exception 'The project document is unavailable';
  end if;

  source_data := coalesce(source_record.document_data, '{}'::jsonb);
  selected_org := nullif(trim(source_data->>'organizationId'), '');
  if selected_org is null then
    select membership.organization_id into selected_org
    from public.organization_memberships membership
    where membership.user_id = current_user
      and membership.status = 'active'
    order by membership.created_at
    limit 1;
  end if;
  if selected_org is null or not public.pie_layer4_has_active_membership(selected_org) then
    raise exception 'An active organization membership is required';
  end if;

  selected_project := coalesce(
    nullif(trim(source_data->>'projectId'), ''),
    nullif(trim(source_data->>'projectName'), ''),
    nullif(trim(source_data->'projectNames'->>0), '')
  );
  if selected_project is null then
    raise exception 'The document must be assigned to a project';
  end if;

  selected_sha := lower(coalesce(
    nullif(source_data->>'contentSha256', ''),
    nullif(source_data->>'webFileFingerprint', ''),
    nullif(source_data->>'indexedContentSha256', '')
  ));
  if selected_sha !~ '^[a-f0-9]{64}$' then
    raise exception 'The document source checksum is unavailable';
  end if;

  selected_storage_path := nullif(trim(source_data->>'storagePath'), '');
  selected_provider := case
    when source_data->>'sourceProvider' = 'google_drive' then 'google_drive'
    when selected_storage_path is not null then 'supabase_storage'
    else 'managed_upload'
  end;
  selected_state := case when selected_storage_path is null
    then 'reconnect_source' else 'queued' end;

  insert into public.ecos_hosted_index_configuration (organization_id)
  values (selected_org)
  on conflict (organization_id) do nothing;
  select configuration.publication_mode into selected_mode
  from public.ecos_hosted_index_configuration configuration
  where configuration.organization_id = selected_org
    and configuration.enabled = true;
  if selected_mode is null then
    raise exception 'Document preparation is not enabled for this organization';
  end if;

  insert into public.ecos_hosted_index_jobs (
    organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, customer_message, requested_by
  ) values (
    selected_org,
    selected_project,
    source_record.id::text,
    current_user,
    selected_provider,
    jsonb_strip_nulls(jsonb_build_object(
      'bucket', case when selected_storage_path is not null then 'project-documents' else null end,
      'path', selected_storage_path,
      'externalSource', source_data->'externalSource'
    )),
    selected_sha,
    case when coalesce(source_data->>'sourcePageCount', '') ~ '^[1-9][0-9]*$'
      then (source_data->>'sourcePageCount')::integer else null end,
    coalesce(nullif(source_data->>'drawingRevision', ''), nullif(source_data->>'webVersionGroupId', '')),
    selected_mode,
    selected_state,
    case when selected_state = 'reconnect_source'
      then 'Reconnect the source file so Vitruvius can continue preparing it.'
      else 'Vitruvius is preparing this document in the background.' end,
    current_user
  )
  on conflict (organization_id, document_id, source_sha256, mode)
  do update set
    project_id = excluded.project_id,
    source_provider = excluded.source_provider,
    source_locator = excluded.source_locator,
    source_page_count = coalesce(excluded.source_page_count, public.ecos_hosted_index_jobs.source_page_count),
    source_revision = excluded.source_revision,
    state = case
      when public.ecos_hosted_index_jobs.state = 'ready' then 'ready'
      when public.ecos_hosted_index_jobs.state in ('cancelled', 'reconnect_source', 'failed_internal')
        and excluded.state = 'queued' then 'queued'
      else public.ecos_hosted_index_jobs.state end,
    customer_message = excluded.customer_message,
    updated_at = now()
  returning id into job_id;

  return job_id;
end;
$$;

create or replace function public.ecos_hosted_index_status(
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
  select distinct on (job.document_id)
    job.document_id,
    job.project_id,
    job.state,
    case job.state
      when 'queued' then 'Waiting'
      when 'fetching_source' then 'Preparing'
      when 'extracting' then 'Preparing'
      when 'mapping' then 'Preparing'
      when 'awaiting_visual' then 'Preparing'
      when 'assuring' then 'Preparing'
      when 'ready' then 'Ready for ECOS'
      when 'needs_review' then 'Needs Review'
      when 'reconnect_source' then 'Reconnect Files'
      when 'temporarily_unavailable' then 'Temporarily Unavailable'
      when 'failed_internal' then 'Temporarily Unavailable'
      when 'cancelled' then 'Waiting'
      else 'Preparing'
    end,
    job.completed_page_count,
    coalesce(job.source_page_count, 0),
    case when coalesce(job.source_page_count, 0) > 0
      then least(100, floor((job.completed_page_count::numeric / job.source_page_count) * 100)::integer)
      else 0 end,
    job.customer_message,
    job.support_reference,
    job.committed_evidence_version,
    job.updated_at,
    job.ready_at
  from public.ecos_hosted_index_jobs job
  where public.pie_layer4_has_active_membership(job.organization_id)
    and (p_document_ids is null or job.document_id = any(p_document_ids))
  order by job.document_id, job.updated_at desc;
$$;

create or replace function public.ecos_cancel_hosted_index(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ecos_hosted_index_jobs job
  set state = 'cancelled',
      lease_expires_at = null,
      claim_token = null,
      claimed_by = null,
      customer_message = 'Document preparation was cancelled.',
      updated_at = now()
  where job.id = p_job_id
    and public.pie_layer4_has_active_membership(job.organization_id)
    and job.requested_by = auth.uid()
    and job.state in ('queued', 'reconnect_source', 'temporarily_unavailable');
  return found;
end;
$$;

create or replace function public.ecos_claim_hosted_index_job(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns table(
  job_id uuid,
  organization_id text,
  project_id text,
  document_id text,
  source_provider text,
  source_locator jsonb,
  source_sha256 text,
  source_page_count integer,
  source_revision text,
  mode text,
  claim_token uuid,
  retry_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_job public.ecos_hosted_index_jobs%rowtype;
  new_claim_token uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if length(trim(coalesce(p_worker_id, ''))) < 3 then raise exception 'Worker id is required'; end if;

  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where (
      (
        job.state in ('queued', 'temporarily_unavailable')
        and coalesce(job.next_attempt_at, now()) <= now()
        and (job.lease_expires_at is null or job.lease_expires_at < now())
      )
      or (
        job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring')
        and job.lease_expires_at < now()
      )
    )
    and job.retry_count < job.max_retry_count
  order by job.created_at
  for update skip locked
  limit 1;

  if not found then return; end if;

  update public.ecos_hosted_index_jobs job
  set state = 'fetching_source',
      retry_count = case
        when selected_job.state in ('fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring')
          then least(job.max_retry_count, job.retry_count + 1)
        else job.retry_count end,
      claimed_by = trim(p_worker_id),
      claim_token = new_claim_token,
      lease_expires_at = now() + make_interval(secs => greatest(60, least(p_lease_seconds, 1800))),
      customer_message = 'Vitruvius is preparing this document in the background.',
      updated_at = now()
  where job.id = selected_job.id;

  return query select
    selected_job.id,
    selected_job.organization_id,
    selected_job.project_id,
    selected_job.document_id,
    selected_job.source_provider,
    selected_job.source_locator,
    selected_job.source_sha256,
    selected_job.source_page_count,
    selected_job.source_revision,
    selected_job.mode,
    new_claim_token,
    selected_job.retry_count;
end;
$$;

create or replace function public.ecos_record_hosted_index_source(
  p_job_id uuid,
  p_claim_token uuid,
  p_source_sha256 text,
  p_source_page_count integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if lower(trim(p_source_sha256)) !~ '^[a-f0-9]{64}$' then raise exception 'Valid SHA-256 required'; end if;
  if p_source_page_count < 1 or p_source_page_count > 10000 then raise exception 'Valid page count required'; end if;

  update public.ecos_hosted_index_jobs job
  set source_page_count = p_source_page_count,
      state = 'extracting',
      lease_expires_at = now() + interval '30 minutes',
      updated_at = now()
  where job.id = p_job_id
    and job.claim_token = p_claim_token
    and job.source_sha256 = lower(trim(p_source_sha256));
  return found;
end;
$$;

create or replace function public.ecos_checkpoint_hosted_index_page(
  p_job_id uuid,
  p_claim_token uuid,
  p_page_number integer,
  p_state text,
  p_native_page_data jsonb,
  p_ocr_page_data jsonb,
  p_deterministic_page_data jsonb,
  p_final_page_data jsonb,
  p_assurance_result jsonb,
  p_unresolved_region_count integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if p_state not in ('extracted', 'mapped', 'awaiting_visual', 'assured', 'rejected') then
    raise exception 'Invalid page state';
  end if;
  select job.* into current_job from public.ecos_hosted_index_jobs job
  where job.id = p_job_id and job.claim_token = p_claim_token for update;
  if not found then raise exception 'Worker lease is unavailable'; end if;
  if p_page_number < 1 or p_page_number > coalesce(current_job.source_page_count, 0) then
    raise exception 'Page number is outside the verified source';
  end if;

  insert into public.ecos_hosted_index_pages (
    job_id, organization_id, project_id, document_id, page_number, source_sha256,
    state, native_page_data, ocr_page_data, deterministic_page_data,
    final_page_data, assurance_result, unresolved_region_count, updated_at
  ) values (
    current_job.id, current_job.organization_id, current_job.project_id,
    current_job.document_id, p_page_number, current_job.source_sha256,
    p_state, coalesce(p_native_page_data, '{}'::jsonb), coalesce(p_ocr_page_data, '{}'::jsonb),
    coalesce(p_deterministic_page_data, '{}'::jsonb), coalesce(p_final_page_data, '{}'::jsonb),
    coalesce(p_assurance_result, '{}'::jsonb), greatest(0, p_unresolved_region_count), now()
  )
  on conflict (job_id, page_number) do update set
    state = excluded.state,
    native_page_data = excluded.native_page_data,
    ocr_page_data = excluded.ocr_page_data,
    deterministic_page_data = excluded.deterministic_page_data,
    final_page_data = excluded.final_page_data,
    assurance_result = excluded.assurance_result,
    unresolved_region_count = excluded.unresolved_region_count,
    updated_at = now();

  update public.ecos_hosted_index_jobs job set
    state = case
      when p_state = 'awaiting_visual' then 'awaiting_visual'
      when p_state in ('assured', 'rejected') then 'assuring'
      else 'mapping' end,
    completed_page_count = (select count(*) from public.ecos_hosted_index_pages page where page.job_id = current_job.id),
    assured_page_count = (select count(*) from public.ecos_hosted_index_pages page where page.job_id = current_job.id and page.state = 'assured'),
    unresolved_region_count = (select coalesce(sum(page.unresolved_region_count), 0) from public.ecos_hosted_index_pages page where page.job_id = current_job.id),
    lease_expires_at = now() + interval '30 minutes',
    updated_at = now()
  where job.id = current_job.id;
  return true;
end;
$$;

create or replace function public.ecos_upsert_hosted_visual_exception(
  p_job_id uuid,
  p_claim_token uuid,
  p_page_number integer,
  p_region_key text,
  p_bounds jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
  exception_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  select job.* into current_job from public.ecos_hosted_index_jobs job
  where job.id = p_job_id and job.claim_token = p_claim_token for update;
  if not found then raise exception 'Worker lease is unavailable'; end if;
  if jsonb_typeof(coalesce(p_bounds, '{}'::jsonb)) <> 'object' then raise exception 'Bounds object required'; end if;

  insert into public.ecos_hosted_visual_exceptions (
    job_id, organization_id, project_id, document_id, page_number,
    region_key, bounds, reason
  ) values (
    current_job.id, current_job.organization_id, current_job.project_id,
    current_job.document_id, p_page_number, left(trim(p_region_key), 300),
    p_bounds, left(trim(p_reason), 1000)
  )
  on conflict (job_id, page_number, region_key) do update set
    bounds = excluded.bounds,
    reason = excluded.reason,
    state = case when public.ecos_hosted_visual_exceptions.state = 'resolved'
      then 'resolved' else 'queued' end,
    updated_at = now()
  returning id into exception_id;
  return exception_id;
end;
$$;

create or replace function public.ecos_fail_hosted_index_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_category text,
  p_diagnostics jsonb,
  p_retryable boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  update public.ecos_hosted_index_jobs job set
    state = case
      when p_category = 'source_reconnect_required' then 'reconnect_source'
      when not p_retryable then 'needs_review'
      when p_retryable and job.retry_count + 1 < job.max_retry_count then 'temporarily_unavailable'
      else 'failed_internal' end,
    retry_count = case when p_category = 'source_reconnect_required'
      then job.retry_count else job.retry_count + 1 end,
    next_attempt_at = case when p_category = 'source_reconnect_required' then null when p_retryable
      then now() + make_interval(secs => least(3600, 30 * (2 ^ least(job.retry_count, 7))::integer))
      else null end,
    failure_category = left(trim(coalesce(p_category, 'internal')), 200),
    failure_diagnostics = coalesce(p_diagnostics, '{}'::jsonb),
    customer_message = case when p_category = 'source_reconnect_required'
      then 'Reconnect the source file so Vitruvius can continue preparing it.'
      when not p_retryable
      then 'This document needs review before Vitruvius can finish preparing it.'
      else 'Vitruvius could not finish preparing this document. It will retry automatically.' end,
    claimed_by = null,
    claim_token = null,
    lease_expires_at = null,
    updated_at = now()
  where job.id = p_job_id and job.claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.ecos_resolve_hosted_visual_exception(
  p_job_id uuid,
  p_claim_token uuid,
  p_page_number integer,
  p_region_key text,
  p_normalized_evidence jsonb,
  p_assurance_result jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  update public.ecos_hosted_visual_exceptions exception set
    state = 'resolved',
    normalized_evidence = coalesce(p_normalized_evidence, '{}'::jsonb),
    assurance_result = coalesce(p_assurance_result, '{}'::jsonb),
    claimed_by = null,
    lease_expires_at = null,
    updated_at = now()
  where exception.job_id = p_job_id
    and exception.page_number = p_page_number
    and exception.region_key = left(trim(p_region_key), 300)
    and exists (
      select 1 from public.ecos_hosted_index_jobs job
      where job.id = p_job_id and job.claim_token = p_claim_token
    );
  return true;
end;
$$;

create or replace function public.ecos_commit_hosted_index_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_evidence_version text
)
returns table(published_pages integer, published_chunks integer, publication_mode text)
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '180s'
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
  current_document_data jsonb;
  current_document_sha text;
  current_document_project text;
  current_document_revision text;
  page_count integer;
  chunk_count integer := 0;
  committed_at timestamptz := clock_timestamp();
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;
  select job.* into current_job from public.ecos_hosted_index_jobs job
  where job.id = p_job_id and job.claim_token = p_claim_token for update;
  if not found then raise exception 'Worker lease is unavailable'; end if;
  if current_job.source_page_count is null then raise exception 'Verified source page count is required'; end if;
  if length(trim(coalesce(p_evidence_version, ''))) < 3 then raise exception 'Evidence version is required'; end if;

  select source.document_data into current_document_data
  from public.reference_documents source
  where source.id::text = current_job.document_id
    and source.owner_id = current_job.source_owner_id;
  if not found then raise exception 'The current project document is unavailable'; end if;
  current_document_sha := lower(coalesce(
    nullif(current_document_data->>'contentSha256', ''),
    nullif(current_document_data->>'webFileFingerprint', ''),
    nullif(current_document_data->>'indexedContentSha256', '')
  ));
  current_document_project := coalesce(
    nullif(trim(current_document_data->>'projectId'), ''),
    nullif(trim(current_document_data->>'projectName'), ''),
    nullif(trim(current_document_data->'projectNames'->>0), '')
  );
  current_document_revision := coalesce(
    nullif(current_document_data->>'drawingRevision', ''),
    nullif(current_document_data->>'webVersionGroupId', '')
  );
  if current_document_sha is distinct from current_job.source_sha256 then
    raise exception 'The source document changed before the verified commit';
  end if;
  if current_document_project is distinct from current_job.project_id then
    raise exception 'The project identity changed before the verified commit';
  end if;
  if current_document_revision is distinct from current_job.source_revision then
    raise exception 'The document revision changed before the verified commit';
  end if;
  if coalesce(current_document_data->>'isCurrent', 'false') <> 'true'
    or current_document_data->>'drawingStatus' = 'Superseded' then
    raise exception 'Only the current non-superseded document may publish evidence';
  end if;

  select count(*)::integer into page_count
  from public.ecos_hosted_index_pages page
  where page.job_id = current_job.id and page.state = 'assured'
    and page.source_sha256 = current_job.source_sha256
    and page.assurance_result->>'accepted' = 'true'
    and page.unresolved_region_count = 0;
  if page_count <> current_job.source_page_count then
    raise exception 'ECOS Assurance accepted % of % required pages', page_count, current_job.source_page_count;
  end if;
  if exists (
    select expected.page_number from generate_series(1, current_job.source_page_count) expected(page_number)
    except
    select page.page_number from public.ecos_hosted_index_pages page
    where page.job_id = current_job.id and page.state = 'assured'
  ) then raise exception 'Assured page sequence is incomplete'; end if;
  if exists (
    select 1 from public.ecos_hosted_visual_exceptions exception
    where exception.job_id = current_job.id
      and exception.state not in ('resolved', 'cancelled')
  ) then raise exception 'Unresolved visual exceptions remain'; end if;

  if current_job.mode = 'live' then
    delete from public.ecos_hosted_document_chunks chunk
    where chunk.organization_id = current_job.organization_id
      and chunk.document_id = current_job.document_id;
    delete from public.ecos_hosted_document_pages page
    where page.organization_id = current_job.organization_id
      and page.document_id = current_job.document_id;

    insert into public.ecos_hosted_document_pages (
      organization_id, project_id, document_id, page_number, source_sha256,
      evidence_version, sheet_number, sheet_title, sheet_mapping_status,
      page_text, regions, assurance_result, published_at
    )
    select
      current_job.organization_id, current_job.project_id, current_job.document_id,
      page.page_number, current_job.source_sha256, trim(p_evidence_version),
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end,
      nullif(left(trim(page.final_page_data->>'sheetTitle'), 500), ''),
      case when page.final_page_data->>'sheetMappingStatus' in ('verified', 'conflicted', 'unverified')
        then page.final_page_data->>'sheetMappingStatus' else 'unverified' end,
      nullif(left(trim(page.final_page_data->>'text'), 100000), ''),
      coalesce(page.final_page_data->'regions', '[]'::jsonb),
      page.assurance_result,
      committed_at
    from public.ecos_hosted_index_pages page
    where page.job_id = current_job.id
    order by page.page_number;

    insert into public.ecos_hosted_document_chunks (
      organization_id, project_id, document_id, page_number, region_id,
      chunk_index, chunk_text, sheet_number, confidence, metadata, published_at
    )
    select
      current_job.organization_id, current_job.project_id, current_job.document_id,
      page.page_number, coalesce(nullif(trim(region.value->>'id'), ''), ''),
      greatest(region.ordinality::integer - 1, 0),
      left(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label')), 4000),
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end,
      case when (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
        then (region.value->>'confidence')::numeric else null end,
      jsonb_build_object(
        'x', region.value->'x', 'y', region.value->'y',
        'width', region.value->'width', 'height', region.value->'height',
        'source', region.value->'source', 'areaNames', coalesce(region.value->'areaNames', '[]'::jsonb),
        'factKind', region.value->'factKind', 'subject', region.value->'subject',
        'location', region.value->'location', 'evidenceText', region.value->'evidenceText',
        'sheetMappingStatus', coalesce(page.final_page_data->>'sheetMappingStatus', 'unverified'),
        'evidenceVersion', trim(p_evidence_version),
        'assurance', page.assurance_result
      ),
      committed_at
    from public.ecos_hosted_index_pages page
    cross join lateral jsonb_array_elements(coalesce(page.final_page_data->'regions', '[]'::jsonb))
      with ordinality region(value, ordinality)
    where page.job_id = current_job.id
      and length(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label'))) > 0;

    insert into public.ecos_hosted_document_chunks (
      organization_id, project_id, document_id, page_number, region_id,
      chunk_index, chunk_text, sheet_number, confidence, metadata, published_at
    )
    select
      current_job.organization_id, current_job.project_id, current_job.document_id,
      page.page_number, '', 0, left(trim(page.final_page_data->>'text'), 4000),
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end,
      null,
      jsonb_build_object('fallback', true, 'evidenceVersion', trim(p_evidence_version), 'assurance', page.assurance_result),
      committed_at
    from public.ecos_hosted_index_pages page
    where page.job_id = current_job.id
      and jsonb_array_length(coalesce(page.final_page_data->'regions', '[]'::jsonb)) = 0
      and length(trim(page.final_page_data->>'text')) > 0;

    select count(*)::integer into chunk_count
    from public.ecos_hosted_document_chunks chunk
    where chunk.organization_id = current_job.organization_id
      and chunk.document_id = current_job.document_id;
  end if;

  update public.ecos_hosted_index_jobs job set
    state = 'ready',
    completed_page_count = current_job.source_page_count,
    assured_page_count = current_job.source_page_count,
    unresolved_region_count = 0,
    committed_evidence_version = trim(p_evidence_version),
    customer_message = case when current_job.mode = 'live'
      then 'This document is ready for ECOS.'
      else 'This document passed background preparation in validation mode.' end,
    failure_category = null,
    failure_diagnostics = '{}'::jsonb,
    claimed_by = null,
    claim_token = null,
    lease_expires_at = null,
    ready_at = committed_at,
    updated_at = committed_at
  where job.id = current_job.id;

  return query select page_count, chunk_count, current_job.mode;
end;
$$;

create or replace function public.ecos_search_hosted_document_chunks(
  p_search_query text,
  p_document_ids text[] default null,
  p_result_limit integer default 12
)
returns table(
  document_id text,
  page_number integer,
  region_id text,
  chunk_text text,
  sheet_number text,
  confidence numeric,
  metadata jsonb,
  rank real
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with scored as (
    select
      chunk.document_id, chunk.page_number, chunk.region_id, chunk.chunk_text,
      chunk.sheet_number, chunk.confidence, chunk.metadata,
      ts_rank_cd(chunk.search_vector, websearch_to_tsquery('simple', coalesce(p_search_query, ''))) lexical_rank,
      extensions.similarity(lower(chunk.chunk_text), lower(coalesce(p_search_query, ''))) fuzzy_rank
    from public.ecos_hosted_document_chunks chunk
    where public.pie_layer4_has_active_membership(chunk.organization_id)
      and length(trim(coalesce(p_search_query, ''))) > 0
      and (p_document_ids is null or chunk.document_id = any(p_document_ids))
      and (
        chunk.search_vector @@ websearch_to_tsquery('simple', p_search_query)
        or extensions.similarity(lower(chunk.chunk_text), lower(p_search_query)) >= 0.18
      )
  )
  select
    scored.document_id, scored.page_number, scored.region_id, scored.chunk_text,
    scored.sheet_number, scored.confidence, scored.metadata,
    (scored.lexical_rank * 0.82 + scored.fuzzy_rank * 0.18)::real
  from scored
  order by 8 desc, confidence desc nulls last, page_number
  limit greatest(1, least(coalesce(p_result_limit, 12), 50));
$$;

revoke all on function public.ecos_enqueue_hosted_index(text) from public, anon;
revoke all on function public.ecos_hosted_index_status(text[]) from public, anon;
revoke all on function public.ecos_cancel_hosted_index(uuid) from public, anon;
grant execute on function public.ecos_enqueue_hosted_index(text) to authenticated;
grant execute on function public.ecos_hosted_index_status(text[]) to authenticated;
grant execute on function public.ecos_cancel_hosted_index(uuid) to authenticated;

revoke all on function public.ecos_claim_hosted_index_job(text, integer) from public, anon, authenticated;
revoke all on function public.ecos_record_hosted_index_source(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.ecos_checkpoint_hosted_index_page(uuid, uuid, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.ecos_upsert_hosted_visual_exception(uuid, uuid, integer, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.ecos_fail_hosted_index_job(uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.ecos_resolve_hosted_visual_exception(uuid, uuid, integer, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.ecos_commit_hosted_index_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ecos_claim_hosted_index_job(text, integer) to service_role;
grant execute on function public.ecos_record_hosted_index_source(uuid, uuid, text, integer) to service_role;
grant execute on function public.ecos_checkpoint_hosted_index_page(uuid, uuid, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, integer) to service_role;
grant execute on function public.ecos_upsert_hosted_visual_exception(uuid, uuid, integer, text, jsonb, text) to service_role;
grant execute on function public.ecos_fail_hosted_index_job(uuid, uuid, text, jsonb, boolean) to service_role;
grant execute on function public.ecos_resolve_hosted_visual_exception(uuid, uuid, integer, text, jsonb, jsonb) to service_role;
grant execute on function public.ecos_commit_hosted_index_job(uuid, uuid, text) to service_role;
grant execute on function public.ecos_search_hosted_document_chunks(text, text[], integer) to authenticated;

commit;
