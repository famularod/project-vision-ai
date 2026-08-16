begin;

create or replace function public.ecos_reference_document_commit_identity(
  p_document_data jsonb
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'name', coalesce(p_document_data, '{}'::jsonb)->'name',
    'originalFileName', coalesce(p_document_data, '{}'::jsonb)->'originalFileName',
    'category', coalesce(p_document_data, '{}'::jsonb)->'category',
    'projectId', coalesce(p_document_data, '{}'::jsonb)->'projectId',
    'organizationId', coalesce(p_document_data, '{}'::jsonb)->'organizationId',
    'contentSha256', coalesce(p_document_data, '{}'::jsonb)->'contentSha256',
    'webFileFingerprint', coalesce(p_document_data, '{}'::jsonb)->'webFileFingerprint',
    'indexedContentSha256', coalesce(p_document_data, '{}'::jsonb)->'indexedContentSha256',
    'drawingRevision', coalesce(p_document_data, '{}'::jsonb)->'drawingRevision',
    'drawingNumber', coalesce(p_document_data, '{}'::jsonb)->'drawingNumber',
    'drawingDiscipline', coalesce(p_document_data, '{}'::jsonb)->'drawingDiscipline',
    'drawingIssuedAt', coalesce(p_document_data, '{}'::jsonb)->'drawingIssuedAt',
    'webVersionGroupId', coalesce(p_document_data, '{}'::jsonb)->'webVersionGroupId',
    'sourcePageCount', coalesce(p_document_data, '{}'::jsonb)->'sourcePageCount',
    'isCurrent', coalesce(p_document_data, '{}'::jsonb)->'isCurrent',
    'drawingStatus', coalesce(p_document_data, '{}'::jsonb)->'drawingStatus',
    'sourceProvider', coalesce(p_document_data, '{}'::jsonb)->'sourceProvider',
    'storagePath', coalesce(p_document_data, '{}'::jsonb)->'storagePath',
    'externalSource', coalesce(p_document_data, '{}'::jsonb)->'externalSource'
  );
$$;

revoke all on function public.ecos_reference_document_commit_identity(jsonb)
  from public, anon, authenticated;
grant execute on function public.ecos_reference_document_commit_identity(jsonb)
  to service_role;

create or replace function public.ecos_request_jwt_role()
returns text
language sql
stable
security invoker
set search_path = public, auth, pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt()->>'role', ''),
    ''
  );
$$;

revoke all on function public.ecos_request_jwt_role()
  from public, anon, authenticated;
grant execute on function public.ecos_request_jwt_role()
  to service_role;

create or replace function public.ecos_guard_reference_document_authority_keys()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  commit_keys constant text[] := array[
    'ecosVerifiedIndexCommitVersion',
    'ecosVerifiedIndexCommittedAt',
    'ecosVerifiedIndexCommittedSha256',
    'ecosVerifiedIndexCommittedPageCount'
  ];
  hosted_status_keys constant text[] := array[
    'ecosHostedIndexStatus',
    'ecosHostedIndexProgressPercent',
    'ecosHostedIndexCustomerMessage',
    'ecosHostedIndexLimitationCount',
    'ecosHostedIndexSupportReference',
    'ecosHostedIndexEvidenceVersion',
    'ecosHostedIndexUpdatedAt'
  ];
  identity_unchanged boolean := false;
  trusted_current_activation boolean := false;
begin
  -- Hosted status is a live RPC projection. It is never durable client data,
  -- including on service writes.
  new.document_data := coalesce(new.document_data, '{}'::jsonb) - hosted_status_keys;

  -- A migration-only transaction flag performs the intentional one-time purge
  -- without allowing the ordinary identity-preserving path to restore OLD.
  if current_setting('app.ecos_authority_purge', true) = 'allowed' then
    new.document_data := new.document_data - commit_keys;
    return new;
  end if;

  -- Service-role writes and only the exact hosted-ready marker transaction
  -- below may hydrate a commit receipt. Trigger nesting alone is never
  -- authority: unrelated and retired legacy triggers can also be nested.
  if public.ecos_request_jwt_role() = 'service_role'
      or current_setting('app.ecos_hosted_commit_hydration', true) =
        'hosted-evidence-1.3' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    identity_unchanged :=
      old.owner_id is not distinct from new.owner_id
      and old.id is not distinct from new.id
      and old.name is not distinct from new.name
      and old.category is not distinct from new.category
      and public.ecos_reference_document_commit_identity(old.document_data)
        is not distinct from
          public.ecos_reference_document_commit_identity(new.document_data);
    trusted_current_activation :=
      not identity_unchanged
      and current_setting('app.ecos_current_activation', true) = 'allowed'
      and old.document_data->>'isCurrent' is distinct from
        new.document_data->>'isCurrent'
      and public.ecos_reference_document_commit_identity(old.document_data) - 'isCurrent'
        is not distinct from
          public.ecos_reference_document_commit_identity(new.document_data) - 'isCurrent'
      and old.document_data->>'ecosVerifiedIndexCommitVersion' =
        'ecos-verified-index-commit/1.0'
      and coalesce(old.document_data->>'ecosVerifiedIndexCommittedSha256', '') ~
        '^[a-f0-9]{64}$'
      and coalesce(old.document_data->>'ecosVerifiedIndexCommittedPageCount', '') ~
        '^[1-9][0-9]*$'
      and exists (
        select 1
        from public.ecos_hosted_index_jobs ready_job
        where ready_job.document_id = new.id::text
          and ready_job.source_owner_id = new.owner_id
          and ready_job.project_id = new.document_data->>'projectId'
          and ready_job.source_sha256 = old.document_data->>'ecosVerifiedIndexCommittedSha256'
          and ready_job.source_page_count = case
            when coalesce(old.document_data->>'ecosVerifiedIndexCommittedPageCount', '') ~
              '^[1-9][0-9]*$'
              then (old.document_data->>'ecosVerifiedIndexCommittedPageCount')::integer
            else null
          end
          and ready_job.completed_page_count = ready_job.source_page_count
          and ready_job.assured_page_count = ready_job.source_page_count
          and ready_job.unresolved_region_count = 0
          and ready_job.state = 'ready'
          and ready_job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
          and public.ecos_hosted_job_matches_reference(ready_job.id, false)
      );
    identity_unchanged := identity_unchanged or trusted_current_activation;
  end if;

  new.document_data := new.document_data - commit_keys;
  if tg_op = 'UPDATE' and identity_unchanged then
    -- Ignore attacker-supplied replacements. Preserve only the exact OLD
    -- server receipt while the complete source/project identity is unchanged.
    new.document_data := new.document_data || jsonb_strip_nulls(jsonb_build_object(
      'ecosVerifiedIndexCommitVersion', old.document_data->'ecosVerifiedIndexCommitVersion',
      'ecosVerifiedIndexCommittedAt', old.document_data->'ecosVerifiedIndexCommittedAt',
      'ecosVerifiedIndexCommittedSha256', old.document_data->'ecosVerifiedIndexCommittedSha256',
      'ecosVerifiedIndexCommittedPageCount', old.document_data->'ecosVerifiedIndexCommittedPageCount'
    ));
  end if;
  return new;
end;
$$;

revoke all on function public.ecos_guard_reference_document_authority_keys()
  from public, anon, authenticated;
grant execute on function public.ecos_guard_reference_document_authority_keys()
  to service_role;

drop trigger if exists ecos_reference_document_authority_keys_guard
  on public.reference_documents;
create trigger ecos_reference_document_authority_keys_guard
before insert or update of document_data, id, name, category, owner_id
on public.reference_documents
for each row execute function public.ecos_guard_reference_document_authority_keys();

-- Build 160 does not trust the retired owner-writable local index as an
-- independent Assurance receipt. Remove its compact-marker issuer completely;
-- only the exact hosted evidence 1.3 lifecycle below can mint a new marker.
drop trigger if exists ecos_mark_verified_index_commit_trigger
  on public.ecos_document_index_jobs;
revoke all on function public.ecos_mark_verified_index_commit()
  from public, anon, authenticated, service_role;
drop function if exists public.ecos_mark_verified_index_commit();

-- Atomic current-drawing activation must never use display-name aliases to
-- decide which sibling revisions to demote. Distinct durable project IDs may
-- legitimately share the same projectName.
create or replace function public.ecos_reference_documents_share_project(
  p_left jsonb,
  p_right jsonb
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    coalesce(p_left->>'projectId', '') ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_right->>'projectId', '') ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_left->>'projectId' = btrim(p_left->>'projectId')
    and p_right->>'projectId' = btrim(p_right->>'projectId')
    and p_left->>'projectId' = p_right->>'projectId',
    false
  );
$$;

revoke all on function public.ecos_reference_documents_share_project(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.ecos_reference_documents_share_project(jsonb, jsonb)
  to service_role;

-- Replace the legacy name fallback at the common hosted-job authority gate.
-- A hosted job is usable only when its immutable project ID is present on the
-- durable reference row and belongs to the same active owner project.
create or replace function public.ecos_hosted_job_matches_reference(
  p_job_id uuid,
  p_require_current boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.ecos_hosted_index_jobs job
    join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = job.source_owner_id
    where job.id = p_job_id
      and source.document_data->>'drawingStatus' is distinct from 'Superseded'
      and (
        not coalesce(p_require_current, false)
        or source.document_data->>'isCurrent' = 'true'
      )
      and lower(coalesce(
        nullif(source.document_data->>'contentSha256', ''),
        nullif(source.document_data->>'webFileFingerprint', ''),
        nullif(source.document_data->>'indexedContentSha256', '')
      )) = job.source_sha256
      and source.document_data->>'projectId' = job.project_id
      and exists (
        select 1
        from public.projects exact_project
        where exact_project.id::text = job.project_id
          and exact_project.owner_id = source.owner_id
          and coalesce(exact_project.archived, false) = false
      )
      and coalesce(
        nullif(source.document_data->>'drawingRevision', ''),
        nullif(source.document_data->>'webVersionGroupId', '')
      ) is not distinct from job.source_revision
      and (
        nullif(source.document_data->>'organizationId', '') = job.organization_id
        or (
          nullif(source.document_data->>'organizationId', '') is null
          and exists (
            select 1
            from public.organization_memberships membership
            where membership.organization_id = job.organization_id
              and membership.user_id = job.source_owner_id
              and membership.status = 'active'
          )
        )
      )
  );
$$;

revoke all on function public.ecos_hosted_job_matches_reference(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.ecos_hosted_job_matches_reference(uuid, boolean)
  to service_role;

create or replace function public.ecos_mark_hosted_verified_index_commit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  published_page_count integer := 0;
  published_min_page integer := 0;
  published_max_page integer := 0;
  updated_document_count integer := 0;
  previous_hydration_authority text := '';
begin
  if new.state <> 'ready'
      or new.committed_evidence_version <> 'ecos-hosted-evidence/1.3' then
    return new;
  end if;
  if new.source_page_count is null
      or new.source_page_count < 1
      or new.completed_page_count <> new.source_page_count
      or new.assured_page_count <> new.source_page_count
      or new.unresolved_region_count <> 0
      or not public.ecos_hosted_job_matches_reference(new.id, false) then
    raise exception 'Hosted ECOS commit does not match the exact source receipt';
  end if;

  if new.mode = 'live' then
    select
      count(distinct page.page_number)::integer,
      coalesce(min(page.page_number), 0)::integer,
      coalesce(max(page.page_number), 0)::integer
    into published_page_count, published_min_page, published_max_page
    from public.ecos_hosted_document_pages page
    where page.organization_id = new.organization_id
      and page.project_id = new.project_id
      and page.document_id = new.document_id
      and page.source_sha256 = new.source_sha256
      and page.evidence_version = new.committed_evidence_version;
  else
    select
      count(distinct page.page_number)::integer,
      coalesce(min(page.page_number), 0)::integer,
      coalesce(max(page.page_number), 0)::integer
    into published_page_count, published_min_page, published_max_page
    from public.ecos_hosted_index_pages page
    where page.job_id = new.id
      and page.organization_id = new.organization_id
      and page.project_id = new.project_id
      and page.document_id = new.document_id
      and page.source_sha256 = new.source_sha256
      and page.state = 'assured'
      and page.assurance_result->>'accepted' = 'true'
      and page.unresolved_region_count = 0
      and exists (
        select 1
        from public.ecos_hosted_shadow_chunks chunk
        where chunk.job_id = new.id
          and chunk.organization_id = new.organization_id
          and chunk.project_id = new.project_id
          and chunk.document_id = new.document_id
          and chunk.source_sha256 = new.source_sha256
          and chunk.page_number = page.page_number
      );
  end if;
  if published_page_count <> new.source_page_count
      or published_min_page <> 1
      or published_max_page <> new.source_page_count then
    raise exception 'Hosted ECOS commit does not have exact page evidence';
  end if;

  previous_hydration_authority := coalesce(
    current_setting('app.ecos_hosted_commit_hydration', true),
    ''
  );
  perform set_config(
    'app.ecos_hosted_commit_hydration',
    'hosted-evidence-1.3',
    true
  );
  update public.reference_documents source
  set document_data = coalesce(source.document_data, '{}'::jsonb) || jsonb_build_object(
        'indexedContentSha256', new.source_sha256,
        'sourcePageCount', new.source_page_count,
        'documentIntelligenceVersion', 'ecos-document-intelligence/2.0',
        'documentVisualIndexVersion', 'ecos-visual-index/3.0',
        'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0',
        'ecosVerifiedIndexCommittedAt', coalesce(new.ready_at, new.updated_at),
        'ecosVerifiedIndexCommittedSha256', new.source_sha256,
        'ecosVerifiedIndexCommittedPageCount', new.source_page_count
      ),
      updated_at = greatest(source.updated_at, coalesce(new.ready_at, new.updated_at))
  where source.id::text = new.document_id
    and source.owner_id = new.source_owner_id
    and source.document_data->>'projectId' = new.project_id
    and lower(coalesce(
      nullif(source.document_data->>'contentSha256', ''),
      nullif(source.document_data->>'webFileFingerprint', ''),
      nullif(source.document_data->>'indexedContentSha256', '')
    )) = new.source_sha256;
  get diagnostics updated_document_count = row_count;
  perform set_config(
    'app.ecos_hosted_commit_hydration',
    previous_hydration_authority,
    true
  );
  if updated_document_count <> 1 then
    raise exception 'Hosted ECOS commit could not bind one durable source document';
  end if;
  return new;
end;
$$;

revoke all on function public.ecos_mark_hosted_verified_index_commit()
  from public, anon, authenticated;
grant execute on function public.ecos_mark_hosted_verified_index_commit()
  to service_role;

drop trigger if exists ecos_mark_hosted_verified_index_commit_insert_trigger
  on public.ecos_hosted_index_jobs;
create trigger ecos_mark_hosted_verified_index_commit_insert_trigger
after insert on public.ecos_hosted_index_jobs
for each row
when (
  new.state = 'ready'
  and new.committed_evidence_version = 'ecos-hosted-evidence/1.3'
)
execute function public.ecos_mark_hosted_verified_index_commit();

drop trigger if exists ecos_mark_hosted_verified_index_commit_update_trigger
  on public.ecos_hosted_index_jobs;
create trigger ecos_mark_hosted_verified_index_commit_update_trigger
after update of state, committed_evidence_version, completed_page_count,
  assured_page_count, unresolved_region_count
on public.ecos_hosted_index_jobs
for each row
when (
  new.state = 'ready'
  and new.committed_evidence_version = 'ecos-hosted-evidence/1.3'
  and (
    old.state is distinct from new.state
    or old.committed_evidence_version is distinct from new.committed_evidence_version
    or old.completed_page_count is distinct from new.completed_page_count
    or old.assured_page_count is distinct from new.assured_page_count
    or old.unresolved_region_count is distinct from new.unresolved_region_count
  )
)
execute function public.ecos_mark_hosted_verified_index_commit();

-- Preserve the mature queue implementation behind an ungranted private entry
-- point, then put one exact immutable-project check in front of every trigger,
-- authenticated RPC, and service caller. The legacy implementation may still
-- read display names internally, but it is unreachable unless projectId has
-- already matched one active project owned by the durable source-row owner.
alter function public.ecos_enqueue_hosted_reference(text, uuid, uuid)
  rename to ecos_enqueue_hosted_reference_unchecked;
revoke all on function public.ecos_enqueue_hosted_reference_unchecked(text, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.ecos_enqueue_hosted_reference(
  p_document_id text,
  p_owner_id uuid,
  p_requested_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  exact_project_id text;
begin
  if p_document_id is null
      or p_document_id = ''
      or p_document_id <> btrim(p_document_id)
      or p_owner_id is null then
    return null;
  end if;
  select source.document_data->>'projectId'
  into exact_project_id
  from public.reference_documents source
  where source.id::text = p_document_id
    and source.owner_id = p_owner_id;
  if not found
      or exact_project_id is null
      or exact_project_id = ''
      or exact_project_id <> btrim(exact_project_id)
      or not exists (
        select 1
        from public.projects exact_project
        where exact_project.id::text = exact_project_id
          and exact_project.owner_id = p_owner_id
          and coalesce(exact_project.archived, false) = false
      ) then
    return null;
  end if;
  return public.ecos_enqueue_hosted_reference_unchecked(
    p_document_id,
    p_owner_id,
    p_requested_by
  );
end;
$$;

revoke all on function public.ecos_enqueue_hosted_reference(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ecos_enqueue_hosted_reference(text, uuid, uuid)
  to service_role;

create or replace function public.ecos_enqueue_hosted_index(p_document_id text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_actor uuid := auth.uid();
  source_data jsonb;
  exact_project_id text;
  job_id uuid;
begin
  if current_actor is null then raise exception 'Sign in is required'; end if;
  if p_document_id is null
      or p_document_id = ''
      or p_document_id <> btrim(p_document_id) then
    raise exception 'The project document is unavailable';
  end if;
  select source.document_data into source_data
  from public.reference_documents source
  where source.id::text = p_document_id
    and source.owner_id = current_actor;
  if not found then raise exception 'The project document is unavailable'; end if;
  source_data := coalesce(source_data, '{}'::jsonb);
  if source_data->>'drawingStatus' = 'Superseded' then
    raise exception 'A superseded document cannot be prepared for ECOS';
  end if;
  exact_project_id := source_data->>'projectId';
  if exact_project_id is null
      or exact_project_id = ''
      or exact_project_id <> btrim(exact_project_id)
      or not exists (
        select 1
        from public.projects exact_project
        where exact_project.id::text = exact_project_id
          and exact_project.owner_id = current_actor
          and coalesce(exact_project.archived, false) = false
      ) then
    raise exception 'The document must be assigned to one exact project';
  end if;
  if lower(coalesce(
    nullif(source_data->>'contentSha256', ''),
    nullif(source_data->>'webFileFingerprint', ''),
    nullif(source_data->>'indexedContentSha256', '')
  )) !~ '^[a-f0-9]{64}$' then
    raise exception 'The document source checksum is unavailable';
  end if;
  job_id := public.ecos_enqueue_hosted_reference(
    p_document_id,
    current_actor,
    current_actor
  );
  if job_id is null then
    raise exception 'Document preparation is unavailable for this exact source revision';
  end if;
  return job_id;
end;
$$;

revoke all on function public.ecos_enqueue_hosted_index(text)
  from public, anon;
grant execute on function public.ecos_enqueue_hosted_index(text)
  to authenticated;

create or replace function public.ecos_enqueue_hosted_index_from_reference_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
    and old.document_data->>'isCurrent' = 'true'
    and new.document_data->>'isCurrent' is distinct from 'true'
    and coalesce(old.document_data->>'contentSha256', '') = coalesce(new.document_data->>'contentSha256', '')
    and coalesce(old.document_data->>'webFileFingerprint', '') = coalesce(new.document_data->>'webFileFingerprint', '')
    and coalesce(old.document_data->>'indexedContentSha256', '') = coalesce(new.document_data->>'indexedContentSha256', '')
    and coalesce(old.document_data->>'projectId', '') = coalesce(new.document_data->>'projectId', '')
    and coalesce(old.document_data->>'projectName', '') = coalesce(new.document_data->>'projectName', '')
    and coalesce(old.document_data->>'drawingRevision', '') = coalesce(new.document_data->>'drawingRevision', '')
    and coalesce(old.document_data->>'drawingStatus', '') = coalesce(new.document_data->>'drawingStatus', '')
    and coalesce(old.document_data->>'storagePath', '') = coalesce(new.document_data->>'storagePath', '') then
    return new;
  end if;
  perform public.ecos_enqueue_hosted_reference(new.id::text, new.owner_id, new.owner_id);
  return new;
end;
$$;

revoke all on function public.ecos_enqueue_hosted_index_from_reference_document()
  from public, anon, authenticated;

drop trigger if exists ecos_reference_document_hosted_enqueue
  on public.reference_documents;
create trigger ecos_reference_document_hosted_enqueue
after insert or update of document_data on public.reference_documents
for each row execute function public.ecos_enqueue_hosted_index_from_reference_document();

-- This identity backfill may run only while hosted preparation is held. A
-- bounded exact-target rollout will enqueue the repaired documents after this
-- transaction and its cleanup receipts have been verified.
do $$
begin
  if exists (
    select 1
    from public.ecos_hosted_index_configuration configuration
    where configuration.enabled = true
  ) then
    raise exception 'ecos_hosted_configuration_must_be_disabled_for_project_identity_backfill';
  end if;
end;
$$;

-- Bind a legacy name-only document only when exactly one active project owned
-- by the same user has the same canonical display name, and the document itself
-- names exactly one canonical project across projectName plus every projectNames
-- entry. Multi-project legacy documents remain unbound and fail closed.
create temporary table ecos_reference_project_backfill_candidates
on commit drop
as
  with single_document_names as (
    select
      source.id,
      source.owner_id,
      min(project_name.canonical_name) as canonical_name
    from public.reference_documents source
    cross join lateral (
      select regexp_replace(
        lower(btrim(raw_name.project_name)),
        '[[:space:]]+',
        ' ',
        'g'
      ) as canonical_name
      from (
        values (source.document_data->>'projectName')
        union all
        select project_name.value
        from jsonb_array_elements_text(
          case when jsonb_typeof(source.document_data->'projectNames') = 'array'
            then source.document_data->'projectNames'
            else '[]'::jsonb
          end
        ) project_name(value)
      ) raw_name(project_name)
      where btrim(coalesce(raw_name.project_name, '')) <> ''
    ) project_name
    where not exists (
      select 1
      from public.projects exact_project
      where exact_project.owner_id = source.owner_id
        and exact_project.id::text = source.document_data->>'projectId'
        and coalesce(exact_project.archived, false) = false
    )
    group by source.id, source.owner_id
    having count(distinct project_name.canonical_name) = 1
  ), unique_active_projects as (
    select
      project_record.owner_id,
      regexp_replace(
        lower(btrim(project_record.name)),
        '[[:space:]]+',
        ' ',
        'g'
      ) as canonical_name,
      min(project_record.id::text) as project_id
    from public.projects project_record
    where coalesce(project_record.archived, false) = false
    group by
      project_record.owner_id,
      regexp_replace(
        lower(btrim(project_record.name)),
        '[[:space:]]+',
        ' ',
        'g'
      )
    having count(*) = 1
  )
  select
    source_name.id,
    source_name.owner_id,
    project_record.project_id
  from single_document_names source_name
  join unique_active_projects project_record
    on project_record.owner_id = source_name.owner_id
   and project_record.canonical_name = source_name.canonical_name;

create unique index ecos_reference_project_backfill_candidates_id_idx
  on ecos_reference_project_backfill_candidates (id);

create temporary table ecos_reference_authority_purge_documents
on commit drop
as
  select source.id, source.owner_id
  from public.reference_documents source
  where coalesce(source.document_data, '{}'::jsonb) ?| array[
    'ecosVerifiedIndexCommitVersion',
    'ecosVerifiedIndexCommittedAt',
    'ecosVerifiedIndexCommittedSha256',
    'ecosVerifiedIndexCommittedPageCount',
    'ecosHostedIndexStatus',
    'ecosHostedIndexProgressPercent',
    'ecosHostedIndexCustomerMessage',
    'ecosHostedIndexLimitationCount',
    'ecosHostedIndexSupportReference',
    'ecosHostedIndexEvidenceVersion',
    'ecosHostedIndexUpdatedAt'
  ];

create unique index ecos_reference_authority_purge_documents_id_idx
  on ecos_reference_authority_purge_documents (id);

-- Adding projectId changes a current drawing's protected project scope. This
-- trusted migration is the one-time atomic repair, not a customer activation.
select set_config('app.ecos_current_activation', 'allowed', true);
select set_config('app.ecos_authority_purge', 'allowed', true);

-- Do not let the ordinary AFTER trigger create a default-enabled configuration
-- or enqueue halfway through the identity rewrite. DDL and data changes are in
-- one transaction, so any failure restores the enabled trigger automatically.
alter table public.reference_documents
  disable trigger ecos_reference_document_hosted_enqueue;

update public.reference_documents source
set document_data = (
      coalesce(source.document_data, '{}'::jsonb) - array[
        'ecosVerifiedIndexCommitVersion',
        'ecosVerifiedIndexCommittedAt',
        'ecosVerifiedIndexCommittedSha256',
        'ecosVerifiedIndexCommittedPageCount',
        'ecosHostedIndexStatus',
        'ecosHostedIndexProgressPercent',
        'ecosHostedIndexCustomerMessage',
        'ecosHostedIndexLimitationCount',
        'ecosHostedIndexSupportReference',
        'ecosHostedIndexEvidenceVersion',
        'ecosHostedIndexUpdatedAt'
      ]::text[]
    ) || case when candidate.project_id is not null
      then jsonb_build_object('projectId', candidate.project_id)
      else '{}'::jsonb end,
    updated_at = now()
from (select source_record.id, binding.project_id
      from public.reference_documents source_record
      left join ecos_reference_project_backfill_candidates binding
        on binding.id = source_record.id
      where binding.project_id is not null
         or coalesce(source_record.document_data, '{}'::jsonb) ?| array[
           'ecosVerifiedIndexCommitVersion',
           'ecosVerifiedIndexCommittedAt',
           'ecosVerifiedIndexCommittedSha256',
           'ecosVerifiedIndexCommittedPageCount',
           'ecosHostedIndexStatus',
           'ecosHostedIndexProgressPercent',
           'ecosHostedIndexCustomerMessage',
           'ecosHostedIndexLimitationCount',
           'ecosHostedIndexSupportReference',
           'ecosHostedIndexEvidenceVersion',
           'ecosHostedIndexUpdatedAt'
         ]) candidate
where source.id = candidate.id;

alter table public.reference_documents
  enable trigger ecos_reference_document_hosted_enqueue;

select set_config('app.ecos_authority_purge', '', true);
select set_config('app.ecos_current_activation', '', true);

-- Any rebound, unbound, orphaned, or mismatched document loses the complete
-- old hosted graph. Public pages/chunks have no job FK and are purged first;
-- job deletion then cascades every job-bound checkpoint, exception, shadow,
-- usage, materialization, and provider-attempt receipt.
create temporary table ecos_reference_hosted_reset_documents
on commit drop
as
  select source.id::text as document_id, source.owner_id
  from public.reference_documents source
  where exists (
      select 1
      from ecos_reference_project_backfill_candidates rebound
      where rebound.id = source.id
    )
    or exists (
      select 1
      from ecos_reference_authority_purge_documents purged
      where purged.id = source.id
    )
    or not exists (
      select 1
      from public.projects exact_project
      where exact_project.owner_id = source.owner_id
        and exact_project.id::text = source.document_data->>'projectId'
        and coalesce(exact_project.archived, false) = false
    )
    or exists (
      select 1
      from public.ecos_hosted_index_jobs job
      where job.document_id = source.id::text
        and job.source_owner_id = source.owner_id
        and job.project_id is distinct from source.document_data->>'projectId'
    )
  union
  select job.document_id, job.source_owner_id
  from public.ecos_hosted_index_jobs job
  where not exists (
    select 1
    from public.reference_documents source
    where source.id::text = job.document_id
      and source.owner_id = job.source_owner_id
  );

create unique index ecos_reference_hosted_reset_documents_id_owner_idx
  on ecos_reference_hosted_reset_documents (document_id, owner_id);

delete from public.ecos_hosted_document_chunks chunk
using ecos_reference_hosted_reset_documents reset
where chunk.document_id = reset.document_id;

delete from public.ecos_hosted_document_pages page
using ecos_reference_hosted_reset_documents reset
where page.document_id = reset.document_id;

delete from public.ecos_hosted_index_jobs job
using ecos_reference_hosted_reset_documents reset
where job.document_id = reset.document_id
  and job.source_owner_id = reset.owner_id;

do $$
begin
  if exists (
    select 1
    from public.ecos_hosted_index_jobs job
    left join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = job.source_owner_id
    left join public.projects exact_project
      on exact_project.owner_id = source.owner_id
     and exact_project.id::text = source.document_data->>'projectId'
     and coalesce(exact_project.archived, false) = false
    where source.id is null
       or exact_project.id is null
       or job.project_id is distinct from source.document_data->>'projectId'
  ) then
    raise exception 'ecos_noncanonical_hosted_job_survived_project_identity_backfill';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.reference_documents'::regclass
      and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
      and trigger_record.tgenabled = 'O'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'ecos_reference_document_hosted_enqueue_not_enabled';
  end if;
end;
$$;

commit;
