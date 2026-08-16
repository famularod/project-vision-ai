-- ECOS non-current shadow preparation and exact-current publication guard
--
-- A newly uploaded drawing is prepared in the hosted worker before a user
-- promotes it to the current revision. Preparation stays in the private shadow
-- store. Customer Ask/search can see that evidence only after the exact source
-- checksum, project, revision, and current flag still match the authoritative
-- reference-document row. Superseded documents always fail closed.

begin;

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
      and coalesce(
        nullif(trim(source.document_data->>'projectId'), ''),
        nullif(trim(source.document_data->>'projectName'), ''),
        nullif(trim(source.document_data->'projectNames'->>0), '')
      ) is not distinct from job.project_id
      and coalesce(
        nullif(trim(source.document_data->>'drawingRevision'), ''),
        nullif(trim(source.document_data->>'webVersionGroupId'), '')
      ) is not distinct from job.source_revision
      and (
        nullif(trim(source.document_data->>'organizationId'), '') = job.organization_id
        or (
          nullif(trim(source.document_data->>'organizationId'), '') is null
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
  source_record record;
  source_data jsonb;
  selected_org text;
  selected_project text;
  selected_sha text;
  selected_storage_path text;
  selected_provider text;
  configured_mode text;
  selected_mode text;
  selected_state text;
  selected_revision text;
  prepared_job_id uuid;
  job_id uuid;
begin
  select source.id, source.owner_id, source.document_data
  into source_record
  from public.reference_documents source
  where source.id::text = trim(coalesce(p_document_id, ''))
    and source.owner_id = p_owner_id;
  if not found then return null; end if;

  source_data := coalesce(source_record.document_data, '{}'::jsonb);
  if source_data->>'drawingStatus' = 'Superseded' then
    update public.ecos_hosted_index_jobs job
    set state = 'cancelled',
        customer_message = 'This superseded revision is not available to ECOS.',
        claim_token = null,
        claimed_by = null,
        lease_expires_at = null,
        updated_at = now()
    where job.document_id = source_record.id::text
      and job.source_owner_id = source_record.owner_id
      and job.state <> 'ready';
    return null;
  end if;

  selected_org := nullif(trim(source_data->>'organizationId'), '');
  if selected_org is null then
    select membership.organization_id into selected_org
    from public.organization_memberships membership
    where membership.user_id = source_record.owner_id
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
  selected_revision := coalesce(
    nullif(trim(source_data->>'drawingRevision'), ''),
    nullif(trim(source_data->>'webVersionGroupId'), '')
  );
  if selected_org is null or selected_project is null or
      selected_sha !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = selected_org
      and membership.user_id = source_record.owner_id
      and membership.status = 'active'
  ) then return null; end if;

  insert into public.ecos_hosted_index_configuration (organization_id)
  values (selected_org)
  on conflict (organization_id) do nothing;
  select configuration.publication_mode into configured_mode
  from public.ecos_hosted_index_configuration configuration
  where configuration.organization_id = selected_org
    and configuration.enabled = true;
  if configured_mode is null then return null; end if;

  selected_mode := case
    when source_data->>'isCurrent' = 'true' then configured_mode
    else 'shadow'
  end;

  -- A completed exact shadow job becomes active simply by promoting the same
  -- source revision to current. Do not pay to process the same bytes again.
  if source_data->>'isCurrent' = 'true' and configured_mode = 'live' then
    select job.id into prepared_job_id
    from public.ecos_hosted_index_jobs job
    where job.organization_id = selected_org
      and job.document_id = source_record.id::text
      and job.source_owner_id = source_record.owner_id
      and job.project_id = selected_project
      and job.source_sha256 = selected_sha
      and job.source_revision is not distinct from selected_revision
      and job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.ecos_hosted_job_matches_reference(job.id, true)
    order by job.ready_at desc nulls last, job.updated_at desc
    limit 1;
    if prepared_job_id is not null then return prepared_job_id; end if;
  end if;

  selected_storage_path := nullif(trim(source_data->>'storagePath'), '');
  selected_provider := case
    when source_data->>'sourceProvider' = 'google_drive' then 'google_drive'
    when selected_storage_path is not null then 'supabase_storage'
    else 'managed_upload'
  end;
  selected_state := case when selected_storage_path is null
    then 'reconnect_source' else 'queued' end;

  -- The unique job key predates project and revision identity. If a caller
  -- relabels the same bytes as a different revision/project, discard the old
  -- evidence graph and force a fresh exact preparation.
  delete from public.ecos_hosted_index_jobs job
  where job.organization_id = selected_org
    and job.document_id = source_record.id::text
    and job.source_sha256 = selected_sha
    and job.mode = selected_mode
    and (
      job.project_id is distinct from selected_project
      or job.source_revision is distinct from selected_revision
    );

  insert into public.ecos_hosted_index_jobs (
    organization_id, project_id, document_id, source_owner_id,
    source_provider, source_locator, source_sha256, source_page_count,
    source_revision, mode, state, customer_message, requested_by
  ) values (
    selected_org, selected_project, source_record.id::text, source_record.owner_id,
    selected_provider,
    jsonb_strip_nulls(jsonb_build_object(
      'bucket', case when selected_storage_path is not null then 'project-documents' else null end,
      'path', selected_storage_path,
      'externalSource', source_data->'externalSource'
    )),
    selected_sha,
    case when coalesce(source_data->>'sourcePageCount', '') ~ '^[1-9][0-9]*$'
      then (source_data->>'sourcePageCount')::integer else null end,
    selected_revision,
    selected_mode,
    selected_state,
    case when selected_state = 'reconnect_source'
      then 'Reconnect the source file so Vitruvius can continue preparing it.'
      else 'Vitruvius is preparing this document in the background.' end,
    coalesce(p_requested_by, source_record.owner_id)
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
      when public.ecos_hosted_index_jobs.state in (
        'cancelled', 'reconnect_source', 'temporarily_unavailable', 'failed_internal'
      ) and excluded.state = 'queued' then 'queued'
      else public.ecos_hosted_index_jobs.state
    end,
    customer_message = case
      when public.ecos_hosted_index_jobs.state = 'ready'
        then public.ecos_hosted_index_jobs.customer_message
      else excluded.customer_message
    end,
    updated_at = now()
  returning id into job_id;
  return job_id;
end;
$$;

revoke all on function public.ecos_enqueue_hosted_reference(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ecos_enqueue_hosted_reference(text, uuid, uuid)
  to service_role;

create or replace function public.ecos_enqueue_hosted_index_from_reference_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Atomic family activation demotes the previous current row and promotes the
  -- prepared target in one transaction. A pure demotion must not start a new
  -- paid shadow-preparation job for bytes that were already authoritative.
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

create or replace function public.ecos_enqueue_hosted_index(p_document_id text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user uuid := auth.uid();
  source_data jsonb;
  job_id uuid;
begin
  if current_user is null then raise exception 'Sign in is required'; end if;
  select source.document_data into source_data
  from public.reference_documents source
  where source.id::text = trim(coalesce(p_document_id, ''))
    and source.owner_id = current_user;
  if not found then raise exception 'The project document is unavailable'; end if;
  source_data := coalesce(source_data, '{}'::jsonb);
  if source_data->>'drawingStatus' = 'Superseded' then
    raise exception 'A superseded document cannot be prepared for ECOS';
  end if;
  if coalesce(
    nullif(trim(source_data->>'projectId'), ''),
    nullif(trim(source_data->>'projectName'), ''),
    nullif(trim(source_data->'projectNames'->>0), '')
  ) is null then raise exception 'The document must be assigned to a project'; end if;
  if lower(coalesce(
    nullif(source_data->>'contentSha256', ''),
    nullif(source_data->>'webFileFingerprint', ''),
    nullif(source_data->>'indexedContentSha256', '')
  )) !~ '^[a-f0-9]{64}$' then
    raise exception 'The document source checksum is unavailable';
  end if;
  job_id := public.ecos_enqueue_hosted_reference(
    trim(p_document_id), current_user, current_user
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

create or replace function public.ecos_reference_document_category(
  p_category text,
  p_document_data jsonb
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case lower(trim(coalesce(
    nullif(p_document_data->>'category', ''),
    p_category,
    ''
  )))
    when 'schedules' then 'schedule'
    when 'schedule' then 'schedule'
    when 'plans' then 'drawing'
    when 'drawing' then 'drawing'
    else coalesce(nullif(lower(trim(coalesce(
      nullif(p_document_data->>'category', ''), p_category, ''
    ))), ''), 'other')
  end;
$$;

create or replace function public.ecos_reference_document_family(
  p_category text,
  p_name text,
  p_document_data jsonb
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case public.ecos_reference_document_category(p_category, p_document_data)
    when 'schedule' then 'schedule'
    when 'drawing' then coalesce(
      nullif(lower(trim(p_document_data->>'webVersionGroupId')), ''),
      nullif(lower(trim(p_document_data->>'drawingNumber')), ''),
      nullif(trim(regexp_replace(
        regexp_replace(
          lower(trim(coalesce(
            nullif(p_document_data->>'originalFileName', ''),
            nullif(p_document_data->>'name', ''),
            p_name,
            ''
          ))),
          '\.[^.]+$', '', 'g'
        ),
        '\mrev(?:ision)?[[:space:]._-]*[a-z0-9]+\M', '', 'gi'
      )), ''),
      'drawing'
    )
    else coalesce(
      nullif(lower(trim(p_document_data->>'webVersionGroupId')), ''),
      nullif(trim(regexp_replace(
        lower(trim(coalesce(
          nullif(p_document_data->>'originalFileName', ''),
          nullif(p_document_data->>'name', ''),
          p_name,
          ''
        ))),
        '\.[^.]+$', '', 'g'
      )), ''),
      public.ecos_reference_document_category(p_category, p_document_data)
    )
  end;
$$;

create or replace function public.ecos_reference_documents_share_project(
  p_left jsonb,
  p_right jsonb
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  with left_projects as (
    select distinct lower(trim(project_name)) as project_name
    from (
      values
        (p_left->>'projectId'),
        (p_left->>'projectName')
      union all
      select project.value
      from jsonb_array_elements_text(
        case when jsonb_typeof(p_left->'projectNames') = 'array'
          then p_left->'projectNames' else '[]'::jsonb end
      ) project(value)
    ) names(project_name)
    where length(trim(coalesce(project_name, ''))) > 0
  ), right_projects as (
    select distinct lower(trim(project_name)) as project_name
    from (
      values
        (p_right->>'projectId'),
        (p_right->>'projectName')
      union all
      select project.value
      from jsonb_array_elements_text(
        case when jsonb_typeof(p_right->'projectNames') = 'array'
          then p_right->'projectNames' else '[]'::jsonb end
      ) project(value)
    ) names(project_name)
    where length(trim(coalesce(project_name, ''))) > 0
  )
  select exists (
    select 1
    from left_projects left_project
    join right_projects right_project using (project_name)
  );
$$;

create or replace function public.ecos_reference_document_project_scope(
  p_document_data jsonb
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(string_agg(project_name, '|' order by project_name), '')
  from (
    select distinct lower(trim(project_name)) as project_name
    from (
      values
        (p_document_data->>'projectId'),
        (p_document_data->>'projectName')
      union all
      select project.value
      from jsonb_array_elements_text(
        case when jsonb_typeof(p_document_data->'projectNames') = 'array'
          then p_document_data->'projectNames' else '[]'::jsonb end
      ) project(value)
    ) names(project_name)
    where length(trim(coalesce(project_name, ''))) > 0
  ) normalized_projects;
$$;

revoke all on function public.ecos_reference_document_category(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.ecos_reference_document_family(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.ecos_reference_documents_share_project(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.ecos_reference_document_project_scope(jsonb)
  from public, anon, authenticated;
grant execute on function public.ecos_reference_document_category(text, jsonb)
  to service_role;
grant execute on function public.ecos_reference_document_family(text, text, jsonb)
  to service_role;
grant execute on function public.ecos_reference_documents_share_project(jsonb, jsonb)
  to service_role;
grant execute on function public.ecos_reference_document_project_scope(jsonb)
  to service_role;

create or replace function public.ecos_require_atomic_current_reference_activation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_current boolean := case when tg_op = 'INSERT'
    then false else coalesce(old.document_data->>'isCurrent' = 'true', false) end;
  next_current boolean := coalesce(new.document_data->>'isCurrent' = 'true', false);
  drawing_activation_involved boolean := case when tg_op = 'INSERT' then
    public.ecos_reference_document_category(new.category, coalesce(new.document_data, '{}'::jsonb)) = 'drawing'
  else
    public.ecos_reference_document_category(new.category, coalesce(new.document_data, '{}'::jsonb)) = 'drawing'
    or public.ecos_reference_document_category(old.category, coalesce(old.document_data, '{}'::jsonb)) = 'drawing'
  end;
  current_family_identity_changed boolean := case when tg_op = 'INSERT' then false
    when not previous_current or not next_current then false
    else
      public.ecos_reference_document_category(old.category, coalesce(old.document_data, '{}'::jsonb))
        is distinct from
      public.ecos_reference_document_category(new.category, coalesce(new.document_data, '{}'::jsonb))
      or public.ecos_reference_document_family(old.category, old.name, coalesce(old.document_data, '{}'::jsonb))
        is distinct from
      public.ecos_reference_document_family(new.category, new.name, coalesce(new.document_data, '{}'::jsonb))
      or public.ecos_reference_document_project_scope(coalesce(old.document_data, '{}'::jsonb))
        is distinct from
      public.ecos_reference_document_project_scope(coalesce(new.document_data, '{}'::jsonb))
    end;
begin
  -- Mobile schedule imports still use their established current-schedule write
  -- path. This guard protects drawings, whose publication is gated by hosted
  -- ECOS Assurance, without breaking those schedule imports.
  if drawing_activation_involved
    and (previous_current is distinct from next_current or current_family_identity_changed)
    and coalesce(auth.role(), '') <> 'service_role'
    and coalesce(current_setting('app.ecos_current_activation', true), '') <> 'allowed' then
    raise exception 'ecos_atomic_current_activation_required';
  end if;
  return new;
end;
$$;

revoke all on function public.ecos_require_atomic_current_reference_activation()
  from public, anon, authenticated;

drop trigger if exists ecos_reference_document_atomic_current_guard
  on public.reference_documents;
create trigger ecos_reference_document_atomic_current_guard
before insert or update of document_data on public.reference_documents
for each row execute function public.ecos_require_atomic_current_reference_activation();

-- One authenticated transaction owns activation of a complete revision
-- family. Drawing activation fails closed until the exact source checksum,
-- project, and revision have a ready Assurance-backed hosted job.
create or replace function public.ecos_activate_current_reference_document(
  p_document_id text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user uuid := auth.uid();
  target_record public.reference_documents%rowtype;
  target_data jsonb;
  target_category text;
  target_family text;
  activation_at timestamptz := clock_timestamp();
  changed_count integer := 0;
  persisted_updated_at timestamptz;
begin
  if current_user is null then
    raise exception 'ecos_current_activation_target_unavailable';
  end if;

  -- Serialize all current-revision changes for one customer before any target
  -- row is read. Locking only the selected row would allow two concurrent
  -- activations of different revisions to each miss the other's new state.
  perform pg_advisory_xact_lock(hashtextextended(current_user::text, 0));

  select source.* into target_record
  from public.reference_documents source
  where source.id::text = trim(coalesce(p_document_id, ''))
    and source.owner_id = current_user
    and source.updated_at = p_expected_updated_at
  for update;
  if not found then
    raise exception 'ecos_current_activation_conflict';
  end if;

  target_data := coalesce(target_record.document_data, '{}'::jsonb);
  if target_data->>'drawingStatus' = 'Superseded' then
    raise exception 'ecos_current_activation_target_unavailable';
  end if;
  target_category := public.ecos_reference_document_category(
    target_record.category, target_data
  );
  target_family := public.ecos_reference_document_family(
    target_record.category, target_record.name, target_data
  );
  if not public.ecos_reference_documents_share_project(target_data, target_data) then
    raise exception 'ecos_current_activation_target_unavailable';
  end if;

  if target_category = 'drawing' then
    if nullif(trim(target_data->>'drawingNumber'), '') is null
      or nullif(trim(target_data->>'drawingRevision'), '') is null
      or not exists (
        select 1
        from public.ecos_hosted_index_jobs job
        join public.ecos_hosted_index_configuration configuration
          on configuration.organization_id = job.organization_id
         and configuration.enabled = true
        where job.document_id = target_record.id::text
          and job.source_owner_id = target_record.owner_id
          and job.state = 'ready'
          and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
          and (job.mode = 'live' or configuration.publication_mode = 'live')
          and public.ecos_hosted_job_matches_reference(job.id, false)
      ) then
      raise exception 'ecos_target_not_prepared';
    end if;
  end if;

  perform set_config('app.ecos_current_activation', 'allowed', true);

  update public.reference_documents candidate
  set document_data = jsonb_set(
        jsonb_set(
          coalesce(candidate.document_data, '{}'::jsonb),
          '{isCurrent}',
          to_jsonb(candidate.id::text = target_record.id::text),
          true
        ),
        '{updatedAt}',
        to_jsonb(activation_at::text),
        true
      ),
      updated_at = activation_at
  where candidate.owner_id = current_user
    and public.ecos_reference_document_category(
      candidate.category, coalesce(candidate.document_data, '{}'::jsonb)
    ) = target_category
    and public.ecos_reference_document_family(
      candidate.category, candidate.name, coalesce(candidate.document_data, '{}'::jsonb)
    ) = target_family
    and public.ecos_reference_documents_share_project(
      target_data, coalesce(candidate.document_data, '{}'::jsonb)
    )
    and (
      (candidate.document_data->>'isCurrent' = 'true')
        is distinct from (candidate.id::text = target_record.id::text)
    );
  get diagnostics changed_count = row_count;
  perform set_config('app.ecos_current_activation', '', true);

  select source.updated_at into persisted_updated_at
  from public.reference_documents source
  where source.id = target_record.id
    and source.owner_id = current_user;
  if persisted_updated_at is null then
    raise exception 'ecos_current_activation_conflict';
  end if;

  return jsonb_build_object(
    'document_id', target_record.id::text,
    'updated_at', persisted_updated_at,
    'changed_count', changed_count
  );
end;
$$;

revoke all on function public.ecos_activate_current_reference_document(text, timestamptz)
  from public, anon;
grant execute on function public.ecos_activate_current_reference_document(text, timestamptz)
  to authenticated;

-- Customer clients use the exact-current search RPC. Direct table reads would
-- otherwise allow stale rows from a prior revision to bypass that boundary.
drop policy if exists ecos_hosted_document_pages_member_read
  on public.ecos_hosted_document_pages;
drop policy if exists ecos_hosted_document_chunks_member_read
  on public.ecos_hosted_document_chunks;
revoke select on table public.ecos_hosted_document_pages from authenticated;
revoke select on table public.ecos_hosted_document_chunks from authenticated;

-- Shadow materialization is private preparation, not publication. It may run
-- while the revision is still non-current, but every row remains bound to the
-- exact authoritative source identity through the helper above.
create or replace function public.ecos_refresh_hosted_shadow_page(
  p_job_id uuid,
  p_page_number integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
  structured_count integer := 0;
begin
  delete from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = p_job_id and chunk.page_number = p_page_number;

  with eligible_page as (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.document_id,
      job.source_sha256,
      page.page_number,
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end as sheet_number,
      coalesce(page.final_page_data->>'sheetMappingStatus', 'unverified') as sheet_mapping_status,
      coalesce(page.final_page_data->>'sheetTitle', page.final_page_data->>'title') as sheet_title,
      page.assurance_result,
      coalesce(
        nullif(trim(page.final_page_data->>'text'), ''),
        nullif(trim((
          select string_agg(
            trim(coalesce(
              nullif(region.value->>'text', ''),
              nullif(region.value->>'label', ''),
              nullif(region.value->>'evidenceText', '')
            )),
            ' ' order by region.ordinality
          )
          from jsonb_array_elements(
            case when jsonb_typeof(page.final_page_data->'regions') = 'array'
              then page.final_page_data->'regions' else '[]'::jsonb end
          ) with ordinality region(value, ordinality)
          where length(trim(coalesce(
            nullif(region.value->>'text', ''),
            nullif(region.value->>'label', ''),
            nullif(region.value->>'evidenceText', '')
          ))) > 0
        )), '')
      ) as search_text
    from public.ecos_hosted_index_jobs job
    join public.ecos_hosted_index_pages page
      on page.job_id = job.id and page.page_number = p_page_number
    where job.id = p_job_id
      and job.mode = 'shadow'
      and page.state = 'assured'
      and page.assurance_result->>'accepted' = 'true'
      and page.unresolved_region_count = 0
      and public.ecos_hosted_job_matches_reference(job.id, false)
  ), page_chunks as (
    select
      eligible.*,
      chunk_index,
      substring(eligible.search_text from 1 + chunk_index * 3200 for 3500) as chunk_text
    from eligible_page eligible
    cross join lateral generate_series(
      0,
      greatest(0, ceil((length(eligible.search_text) - 3500) / 3200.0)::integer)
    ) chunk_index
    where length(trim(coalesce(eligible.search_text, ''))) > 0
  )
  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata, indexed_at
  )
  select
    page_chunks.job_id,
    page_chunks.organization_id,
    page_chunks.project_id,
    page_chunks.document_id,
    page_chunks.source_sha256,
    page_chunks.page_number,
    'page-text-' || page_chunks.chunk_index::text,
    page_chunks.chunk_index,
    page_chunks.chunk_text,
    page_chunks.sheet_number,
    null,
    jsonb_build_object(
      'pageText', true,
      'sheetMappingStatus', page_chunks.sheet_mapping_status,
      'sheetTitle', page_chunks.sheet_title,
      'pageIdentity', concat_ws(' — ',
        case when page_chunks.sheet_mapping_status = 'verified'
          then 'Sheet ' || page_chunks.sheet_number
          else 'PDF page ' || page_chunks.page_number::text end,
        page_chunks.sheet_title
      ),
      'assurance', page_chunks.assurance_result,
      'shadowValidation', true,
      'materialization', 'overlapping_page_text'
    ),
    now()
  from page_chunks
  where length(trim(page_chunks.chunk_text)) > 0;
  get diagnostics inserted_count = row_count;

  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata, indexed_at
  )
  select
    job.id,
    job.organization_id,
    job.project_id,
    job.document_id,
    job.source_sha256,
    page.page_number,
    'visual-' || region.ordinality::text,
    region.ordinality::integer,
    left(trim(concat_ws(' ',
      nullif(trim(region.value->>'text'), ''),
      nullif(trim(region.value->>'label'), ''),
      nullif(trim(region.value->>'subject'), ''),
      nullif(trim(region.value->>'location'), ''),
      nullif(trim(region.value->>'evidenceText'), ''),
      nullif(trim(region.value->>'fact'), '')
    )), 4000),
    case when page.final_page_data->>'sheetMappingStatus' = 'verified'
      then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end,
    case when (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
      then (region.value->>'confidence')::numeric else null end,
    jsonb_build_object(
      'x', region.value->'x',
      'y', region.value->'y',
      'width', region.value->'width',
      'height', region.value->'height',
      'source', coalesce(region.value->'source', '"vision"'::jsonb),
      'sourceRegionId', region.value->'id',
      'areaNames', coalesce(region.value->'areaNames', '[]'::jsonb),
      'factKind', region.value->'factKind',
      'subject', region.value->'subject',
      'location', region.value->'location',
      'evidenceText', region.value->'evidenceText',
      'sheetMappingStatus', coalesce(page.final_page_data->>'sheetMappingStatus', 'unverified'),
      'sheetTitle', coalesce(page.final_page_data->>'sheetTitle', page.final_page_data->>'title'),
      'pageIdentity', concat_ws(' — ',
        case when page.final_page_data->>'sheetMappingStatus' = 'verified'
          then 'Sheet ' || nullif(trim(page.final_page_data->>'sheetNumber'), '')
          else 'PDF page ' || page.page_number::text end,
        coalesce(page.final_page_data->>'sheetTitle', page.final_page_data->>'title')
      ),
      'assurance', page.assurance_result,
      'shadowValidation', true,
      'materialization', 'structured_visual_fact'
    ),
    now()
  from public.ecos_hosted_index_jobs job
  join public.ecos_hosted_index_pages page
    on page.job_id = job.id and page.page_number = p_page_number
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(page.final_page_data->'regions') = 'array'
      then page.final_page_data->'regions' else '[]'::jsonb end
  ) with ordinality region(value, ordinality)
  where job.id = p_job_id
    and job.mode = 'shadow'
    and page.state = 'assured'
    and page.assurance_result->>'accepted' = 'true'
    and page.unresolved_region_count = 0
    and public.ecos_hosted_job_matches_reference(job.id, false)
    and (
      region.value->>'source' = 'vision'
      or region.value ? 'factKind'
      or region.value ? 'subject'
      or region.value ? 'evidenceText'
    )
    and length(trim(concat_ws(' ',
      nullif(trim(region.value->>'text'), ''),
      nullif(trim(region.value->>'label'), ''),
      nullif(trim(region.value->>'subject'), ''),
      nullif(trim(region.value->>'location'), ''),
      nullif(trim(region.value->>'evidenceText'), ''),
      nullif(trim(region.value->>'fact'), '')
    ))) > 0;
  get diagnostics structured_count = row_count;
  return inserted_count + structured_count;
end;
$$;

create or replace function public.ecos_append_hosted_shadow_region_text(
  p_job_id uuid,
  p_page_number integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
begin
  delete from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = p_job_id
    and chunk.page_number = p_page_number
    and chunk.region_id like 'region-text-%';

  with eligible_page as (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.document_id,
      job.source_sha256,
      page.page_number,
      case when page.final_page_data->>'sheetMappingStatus' = 'verified'
        then nullif(trim(page.final_page_data->>'sheetNumber'), '') else null end as sheet_number,
      coalesce(page.final_page_data->>'sheetMappingStatus', 'unverified') as sheet_mapping_status,
      coalesce(page.final_page_data->>'sheetTitle', page.final_page_data->>'title') as sheet_title,
      page.assurance_result,
      nullif(trim((
        select string_agg(
          trim(concat_ws(' ',
            nullif(trim(region.value->>'text'), ''),
            nullif(trim(region.value->>'label'), ''),
            nullif(trim(region.value->>'subject'), ''),
            nullif(trim(region.value->>'location'), ''),
            nullif(trim(region.value->>'evidenceText'), ''),
            nullif(trim(region.value->>'fact'), '')
          )),
          ' ' order by region.ordinality
        )
        from jsonb_array_elements(
          case when jsonb_typeof(page.final_page_data->'regions') = 'array'
            then page.final_page_data->'regions' else '[]'::jsonb end
        ) with ordinality region(value, ordinality)
        where length(trim(concat_ws(' ',
          nullif(trim(region.value->>'text'), ''),
          nullif(trim(region.value->>'label'), ''),
          nullif(trim(region.value->>'subject'), ''),
          nullif(trim(region.value->>'location'), ''),
          nullif(trim(region.value->>'evidenceText'), ''),
          nullif(trim(region.value->>'fact'), '')
        ))) > 0
      )), '') as search_text
    from public.ecos_hosted_index_jobs job
    join public.ecos_hosted_index_pages page
      on page.job_id = job.id and page.page_number = p_page_number
    where job.id = p_job_id
      and job.mode = 'shadow'
      and page.state = 'assured'
      and page.assurance_result->>'accepted' = 'true'
      and page.unresolved_region_count = 0
      and public.ecos_hosted_job_matches_reference(job.id, false)
  ), region_chunks as (
    select
      eligible.*,
      chunk_index,
      substring(eligible.search_text from 1 + chunk_index * 3200 for 3500) as chunk_text
    from eligible_page eligible
    cross join lateral generate_series(
      0,
      greatest(0, ceil((length(eligible.search_text) - 3500) / 3200.0)::integer)
    ) chunk_index
    where length(trim(coalesce(eligible.search_text, ''))) > 0
  )
  insert into public.ecos_hosted_shadow_chunks (
    job_id, organization_id, project_id, document_id, source_sha256,
    page_number, region_id, chunk_index, chunk_text, sheet_number,
    confidence, metadata, indexed_at
  )
  select
    region_chunks.job_id,
    region_chunks.organization_id,
    region_chunks.project_id,
    region_chunks.document_id,
    region_chunks.source_sha256,
    region_chunks.page_number,
    'region-text-' || region_chunks.chunk_index::text,
    region_chunks.chunk_index,
    region_chunks.chunk_text,
    region_chunks.sheet_number,
    null,
    jsonb_build_object(
      'regionText', true,
      'sheetMappingStatus', region_chunks.sheet_mapping_status,
      'sheetTitle', region_chunks.sheet_title,
      'pageIdentity', concat_ws(' — ',
        case when region_chunks.sheet_mapping_status = 'verified'
          then 'Sheet ' || region_chunks.sheet_number
          else 'PDF page ' || region_chunks.page_number::text end,
        region_chunks.sheet_title
      ),
      'assurance', region_chunks.assurance_result,
      'shadowValidation', true,
      'materialization', 'overlapping_assured_region_text'
    ),
    now()
  from region_chunks
  where length(trim(region_chunks.chunk_text)) > 0;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.ecos_refresh_hosted_shadow_page(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.ecos_append_hosted_shadow_region_text(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.ecos_refresh_hosted_shadow_page(uuid, integer)
  to service_role;
grant execute on function public.ecos_append_hosted_shadow_region_text(uuid, integer)
  to service_role;

create or replace function public.ecos_commit_hosted_shadow_preparation_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_evidence_version text
)
returns table(prepared_pages integer, prepared_chunks integer, preparation_mode text)
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '180s'
as $$
declare
  current_job public.ecos_hosted_index_jobs%rowtype;
  accepted_page_count integer;
  shadow_chunk_count integer;
  committed_at timestamptz := clock_timestamp();
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Worker authorization required';
  end if;
  select job.* into current_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
    and job.claim_token = p_claim_token
    and job.lease_expires_at >= now()
    and job.mode = 'shadow'
  for update;
  if not found then raise exception 'Shadow worker lease is unavailable'; end if;
  if current_job.source_page_count is null then
    raise exception 'Verified source page count is required';
  end if;
  if trim(coalesce(p_evidence_version, '')) <> 'ecos-hosted-evidence/1.3' then
    raise exception 'The required ECOS evidence version is unavailable';
  end if;
  if not public.ecos_hosted_job_matches_reference(current_job.id, false) then
    raise exception 'The exact source project or revision changed before preparation completed';
  end if;

  select count(*)::integer into accepted_page_count
  from public.ecos_hosted_index_pages page
  where page.job_id = current_job.id
    and page.state = 'assured'
    and page.source_sha256 = current_job.source_sha256
    and page.assurance_result->>'accepted' = 'true'
    and page.unresolved_region_count = 0;
  if accepted_page_count <> current_job.source_page_count then
    raise exception 'ECOS Assurance accepted % of % required pages',
      accepted_page_count, current_job.source_page_count;
  end if;
  if exists (
    select expected.page_number
    from generate_series(1, current_job.source_page_count) expected(page_number)
    except
    select page.page_number
    from public.ecos_hosted_index_pages page
    where page.job_id = current_job.id
      and page.state = 'assured'
      and page.source_sha256 = current_job.source_sha256
      and page.assurance_result->>'accepted' = 'true'
      and page.unresolved_region_count = 0
  ) then raise exception 'Assured page sequence is incomplete'; end if;
  if exists (
    select 1
    from public.ecos_hosted_visual_exceptions exception
    where exception.job_id = current_job.id
      and exception.state not in ('resolved', 'cancelled')
  ) then raise exception 'Unresolved visual exceptions remain'; end if;
  if exists (
    select 1
    from public.ecos_hosted_shadow_materialization_queue queued
    where queued.job_id = current_job.id
  ) then raise exception 'Shadow search materialization is incomplete'; end if;
  if exists (
    select 1
    from public.ecos_hosted_index_pages page
    where page.job_id = current_job.id
      and not exists (
        select 1
        from public.ecos_hosted_shadow_chunks chunk
        where chunk.job_id = page.job_id
          and chunk.page_number = page.page_number
          and chunk.source_sha256 = current_job.source_sha256
      )
  ) then raise exception 'An accepted shadow page has no durable search chunks'; end if;

  select count(*)::integer into shadow_chunk_count
  from public.ecos_hosted_shadow_chunks chunk
  where chunk.job_id = current_job.id
    and chunk.source_sha256 = current_job.source_sha256;
  if shadow_chunk_count < current_job.source_page_count then
    raise exception 'Prepared search evidence is incomplete';
  end if;

  update public.ecos_hosted_index_jobs job
  set state = 'ready',
      completed_page_count = current_job.source_page_count,
      assured_page_count = current_job.source_page_count,
      unresolved_region_count = 0,
      committed_evidence_version = trim(p_evidence_version),
      customer_message = case
        when public.ecos_hosted_job_matches_reference(current_job.id, true)
          then 'This current revision is ready for ECOS.'
        else 'Background preparation passed ECOS Assurance. Make this revision current before Ask ECOS can use it.'
      end,
      failure_category = null,
      failure_diagnostics = '{}'::jsonb,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      ready_at = committed_at,
      updated_at = committed_at
  where job.id = current_job.id;

  return query select accepted_page_count, shadow_chunk_count, current_job.mode;
end;
$$;

revoke all on function public.ecos_commit_hosted_shadow_preparation_job(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ecos_commit_hosted_shadow_preparation_job(uuid, uuid, text)
  to service_role;

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
  with exact_jobs as (
    select
      job.*,
      source.document_data->>'isCurrent' = 'true' as source_is_current,
      configuration.publication_mode,
      case
        when job.state = 'ready'
          and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
          and source.document_data->>'isCurrent' = 'true'
          and (job.mode = 'live' or configuration.publication_mode = 'live') then 0
        when job.state = 'ready'
          and job.committed_evidence_version = 'ecos-hosted-evidence/1.3' then 1
        else 2
      end as status_priority
    from public.ecos_hosted_index_jobs job
    join public.reference_documents source
      on source.id::text = job.document_id
     and source.owner_id = job.source_owner_id
    join public.ecos_hosted_index_configuration configuration
      on configuration.organization_id = job.organization_id
     and configuration.enabled = true
    where public.pie_layer4_has_active_membership(job.organization_id)
      and (p_document_ids is null or job.document_id = any(p_document_ids))
      and public.ecos_hosted_job_matches_reference(job.id, false)
  )
  select distinct on (job.document_id)
    job.document_id,
    job.project_id,
    job.state,
    case
      when job.state = 'ready'
        and job.committed_evidence_version is distinct from 'ecos-hosted-evidence/1.3'
        then 'Needs Review'
      when job.state = 'ready' and job.source_is_current
        and (job.mode = 'live' or job.publication_mode = 'live')
        then 'Ready for ECOS'
      when job.state = 'ready' then 'Prepared'
      when job.state = 'queued' then 'Waiting'
      when job.state in (
        'fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring'
      ) then 'Preparing'
      when job.state = 'needs_review' then 'Needs Review'
      when job.state = 'reconnect_source' then 'Reconnect Files'
      when job.state in ('temporarily_unavailable', 'failed_internal')
        then 'Temporarily Unavailable'
      when job.state = 'cancelled' then 'Waiting'
      else 'Preparing'
    end,
    job.completed_page_count,
    coalesce(job.source_page_count, 0),
    case when coalesce(job.source_page_count, 0) > 0
      then least(100, floor(
        (job.completed_page_count::numeric / job.source_page_count) * 100
      )::integer)
      else 0 end,
    case
      when job.state = 'ready'
        and job.committed_evidence_version is distinct from 'ecos-hosted-evidence/1.3'
        then 'This revision must be prepared again with the current ECOS evidence standard.'
      when job.state = 'ready' and not job.source_is_current
        then 'Background preparation passed ECOS Assurance. Make this revision current before Ask ECOS can use it.'
      when job.state = 'ready' and job.source_is_current
        and (job.mode = 'live' or job.publication_mode = 'live')
        then 'This current revision is ready for ECOS.'
      else job.customer_message
    end,
    job.support_reference,
    job.committed_evidence_version,
    job.updated_at,
    job.ready_at
  from exact_jobs job
  order by job.document_id, job.status_priority, job.updated_at desc;
$$;

revoke all on function public.ecos_hosted_index_status(text[])
  from public, anon;
grant execute on function public.ecos_hosted_index_status(text[])
  to authenticated;

create or replace function public.ecos_search_hosted_shadow_chunks(
  p_search_query text,
  p_document_ids text[] default null,
  p_result_limit integer default 24
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
security definer
set search_path = public, extensions, pg_temp
as $$
  with scored as (
    select
      chunk.document_id,
      chunk.page_number,
      chunk.region_id,
      chunk.chunk_text,
      chunk.sheet_number,
      chunk.confidence,
      chunk.metadata,
      greatest(
        ts_rank_cd(
          chunk.search_vector,
          websearch_to_tsquery('simple', coalesce(p_search_query, ''))
        ),
        extensions.similarity(lower(chunk.chunk_text), lower(coalesce(p_search_query, '')))
      )::real as rank
    from public.ecos_hosted_shadow_chunks chunk
    join public.ecos_hosted_index_jobs job
      on job.id = chunk.job_id
     and job.source_sha256 = chunk.source_sha256
     and job.project_id = chunk.project_id
     and job.document_id = chunk.document_id
    where coalesce(auth.jwt()->>'role', '') = 'service_role'
      and job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and length(trim(coalesce(p_search_query, ''))) > 0
      and (p_document_ids is null or chunk.document_id = any(p_document_ids))
      and (
        chunk.search_vector @@ websearch_to_tsquery('simple', p_search_query)
        or extensions.similarity(lower(chunk.chunk_text), lower(p_search_query)) >= 0.18
      )
  )
  select
    scored.document_id,
    scored.page_number,
    scored.region_id,
    scored.chunk_text,
    scored.sheet_number,
    scored.confidence,
    scored.metadata,
    scored.rank
  from scored
  order by scored.rank desc, scored.document_id, scored.page_number, scored.region_id
  limit greatest(1, least(coalesce(p_result_limit, 24), 100));
$$;

revoke all on function public.ecos_search_hosted_shadow_chunks(text, text[], integer)
  from public, anon, authenticated;
grant execute on function public.ecos_search_hosted_shadow_chunks(text, text[], integer)
  to service_role;

-- The customer search boundary accepts only an exact ready current revision.
-- A prepared shadow job may satisfy live search after activation, but only when
-- the organization has explicitly enabled live publication and no exact live
-- publication already supersedes it.
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
security definer
set search_path = public, extensions, pg_temp
as $$
  with live_candidates as (
    select
      chunk.document_id,
      chunk.page_number,
      chunk.region_id,
      chunk.chunk_text,
      chunk.sheet_number,
      chunk.confidence,
      chunk.metadata,
      chunk.search_vector
    from public.ecos_hosted_document_chunks chunk
    join public.ecos_hosted_document_pages page
      on page.organization_id = chunk.organization_id
     and page.project_id = chunk.project_id
     and page.document_id = chunk.document_id
     and page.page_number = chunk.page_number
    join public.ecos_hosted_index_jobs job
      on job.organization_id = page.organization_id
     and job.project_id = page.project_id
     and job.document_id = page.document_id
     and job.source_sha256 = page.source_sha256
     and job.mode = 'live'
     and job.state = 'ready'
     and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
     and job.committed_evidence_version = page.evidence_version
    where public.pie_layer4_has_active_membership(chunk.organization_id)
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and (p_document_ids is null or chunk.document_id = any(p_document_ids))
  ), shadow_candidates as (
    select
      chunk.document_id,
      chunk.page_number,
      chunk.region_id,
      chunk.chunk_text,
      chunk.sheet_number,
      chunk.confidence,
      chunk.metadata,
      chunk.search_vector
    from public.ecos_hosted_shadow_chunks chunk
    join public.ecos_hosted_index_jobs job
      on job.id = chunk.job_id
     and job.organization_id = chunk.organization_id
     and job.project_id = chunk.project_id
     and job.document_id = chunk.document_id
     and job.source_sha256 = chunk.source_sha256
     and job.mode = 'shadow'
     and job.state = 'ready'
     and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
    join public.ecos_hosted_index_configuration configuration
      on configuration.organization_id = job.organization_id
     and configuration.enabled = true
     and configuration.publication_mode = 'live'
    where public.pie_layer4_has_active_membership(chunk.organization_id)
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and (p_document_ids is null or chunk.document_id = any(p_document_ids))
      and not exists (
        select 1
        from public.ecos_hosted_index_jobs live_job
        where live_job.organization_id = job.organization_id
          and live_job.project_id = job.project_id
          and live_job.document_id = job.document_id
          and live_job.source_sha256 = job.source_sha256
          and live_job.source_revision is not distinct from job.source_revision
          and live_job.mode = 'live'
          and live_job.state = 'ready'
          and live_job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
          and public.ecos_hosted_job_matches_reference(live_job.id, true)
      )
  ), candidates as (
    select * from live_candidates
    union all
    select * from shadow_candidates
  ), scored as (
    select
      candidate.document_id,
      candidate.page_number,
      candidate.region_id,
      candidate.chunk_text,
      candidate.sheet_number,
      candidate.confidence,
      candidate.metadata,
      ts_rank_cd(
        candidate.search_vector,
        websearch_to_tsquery('simple', coalesce(p_search_query, ''))
      ) as lexical_rank,
      extensions.similarity(
        lower(candidate.chunk_text), lower(coalesce(p_search_query, ''))
      ) as fuzzy_rank
    from candidates candidate
    where length(trim(coalesce(p_search_query, ''))) > 0
      and (
        candidate.search_vector @@ websearch_to_tsquery('simple', p_search_query)
        or extensions.similarity(lower(candidate.chunk_text), lower(p_search_query)) >= 0.18
      )
  )
  select
    scored.document_id,
    scored.page_number,
    scored.region_id,
    scored.chunk_text,
    scored.sheet_number,
    scored.confidence,
    scored.metadata,
    (scored.lexical_rank * 0.82 + scored.fuzzy_rank * 0.18)::real
  from scored
  order by 8 desc, scored.confidence desc nulls last, scored.page_number
  limit greatest(1, least(coalesce(p_result_limit, 12), 50));
$$;

revoke all on function public.ecos_search_hosted_document_chunks(text, text[], integer)
  from public, anon;
grant execute on function public.ecos_search_hosted_document_chunks(text, text[], integer)
  to authenticated;

commit;
