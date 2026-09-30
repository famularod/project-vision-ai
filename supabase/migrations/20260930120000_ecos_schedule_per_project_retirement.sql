-- Owner answer Q15 (30 Sep 2026): making one project's schedule current leaves
-- a combined schedule current for its other projects.
--
-- ecos_activate_current_reference_document retired every current schedule
-- sharing any project with the chosen one, so making project A's schedule
-- current retired a combined A+B schedule for B too: B was left with no
-- current schedule, or fell back to an older one.
--
-- For schedules only, a current schedule that also covers projects the chosen
-- schedule does not cover now stays current. The chosen schedule's projects
-- are recorded in its document_data.retiredForProjectNames (its project list
-- is never trimmed), and every device leaves those projects out when it picks
-- each project's current schedule. Making that schedule current again clears
-- the list. A current schedule covering only the chosen schedule's projects
-- (or sharing only a project id) is retired as before. Drawings and other
-- documents are unchanged, as are the compare-and-set on updated_at, the
-- owner scope and the per-owner activation lock.
--
-- ecos_schedule_retirement_scope() lets a device ask, before it activates,
-- whether this database keeps combined schedules current per project, so the
-- question it asks the owner is true before and after this migration.

begin;

create or replace function public.ecos_schedule_after_current_activation(
  p_candidate jsonb,
  p_target jsonb,
  p_is_target boolean
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  candidate_data jsonb := case when jsonb_typeof(p_candidate) = 'object'
    then p_candidate else '{}'::jsonb end;
  target_data jsonb := case when jsonb_typeof(p_target) = 'object'
    then p_target else '{}'::jsonb end;
  scope_count integer;
  retired_count integer;
  retired_names jsonb;
begin
  -- The chosen schedule is current for every project it covers.
  if p_is_target then
    candidate_data := candidate_data - 'retiredForProjectNames';
    if candidate_data->>'isCurrent' is distinct from 'true' then
      candidate_data := jsonb_set(candidate_data, '{isCurrent}', 'true'::jsonb, true);
    end if;
    return candidate_data;
  end if;

  if candidate_data->>'isCurrent' is distinct from 'true'
    or not public.ecos_reference_documents_share_project(target_data, candidate_data) then
    return candidate_data;
  end if;

  -- The candidate's projects as every device reads them: its project list,
  -- or its single project name when the list is empty. A project is covered
  -- when the chosen schedule names it, or the candidate was already retired
  -- for it.
  with listed as (
    select trim(item.value) as name, item.position
    from jsonb_array_elements_text(
      case when jsonb_typeof(candidate_data->'projectNames') = 'array'
        then candidate_data->'projectNames' else '[]'::jsonb end
    ) with ordinality as item(value, position)
    where length(trim(item.value)) > 0
  ), scope as (
    select listed.name, listed.position from listed
    union all
    select trim(candidate_data->>'projectName'), 1
    where not exists (select 1 from listed)
      and length(trim(coalesce(candidate_data->>'projectName', ''))) > 0
  ), distinct_scope as (
    select distinct on (lower(scope.name)) scope.name, scope.position
    from scope
    order by lower(scope.name), scope.position
  ), covered as (
    select lower(trim(keys.value)) as key
    from (
      values (target_data->>'projectId'), (target_data->>'projectName')
      union all
      select item.value
      from jsonb_array_elements_text(
        case when jsonb_typeof(target_data->'projectNames') = 'array'
          then target_data->'projectNames' else '[]'::jsonb end
      ) as item(value)
      union all
      select item.value
      from jsonb_array_elements_text(
        case when jsonb_typeof(candidate_data->'retiredForProjectNames') = 'array'
          then candidate_data->'retiredForProjectNames' else '[]'::jsonb end
      ) as item(value)
    ) as keys(value)
    where length(trim(coalesce(keys.value, ''))) > 0
  ), marked as (
    select distinct_scope.name, distinct_scope.position,
      exists (
        select 1 from covered where covered.key = lower(distinct_scope.name)
      ) as is_covered
    from distinct_scope
  )
  select
    count(*)::integer,
    (count(*) filter (where marked.is_covered))::integer,
    coalesce(
      jsonb_agg(to_jsonb(marked.name) order by marked.position)
        filter (where marked.is_covered),
      '[]'::jsonb
    )
  into scope_count, retired_count, retired_names
  from marked;

  -- Shared through a project id only, or every project it covers is now
  -- another schedule's: retired, as before.
  if retired_count = 0 or retired_count = scope_count then
    return jsonb_set(
      candidate_data - 'retiredForProjectNames', '{isCurrent}', 'false'::jsonb, true
    );
  end if;
  return jsonb_set(candidate_data, '{retiredForProjectNames}', retired_names, true);
end;
$$;

revoke all on function public.ecos_schedule_after_current_activation(jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.ecos_schedule_after_current_activation(jsonb, jsonb, boolean)
  to service_role;

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
  current_actor uuid := auth.uid();
  target_record public.reference_documents%rowtype;
  target_data jsonb;
  target_category text;
  target_family text;
  activation_at timestamptz := clock_timestamp();
  changed_count integer := 0;
  persisted_updated_at timestamptz;
begin
  if current_actor is null then
    raise exception 'ecos_current_activation_target_unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_actor::text, 0));

  select source.* into target_record
  from public.reference_documents source
  where source.id::text = trim(coalesce(p_document_id, ''))
    and source.owner_id = current_actor
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

  if target_category = 'schedule' then
    -- Q15: a current schedule that also covers other projects stays current
    -- for them (ecos_schedule_after_current_activation).
    update public.reference_documents candidate
    set document_data = jsonb_set(
          public.ecos_schedule_after_current_activation(
            candidate.document_data,
            target_data,
            candidate.id::text = target_record.id::text
          ),
          '{updatedAt}',
          to_jsonb(activation_at::text),
          true
        ),
        updated_at = activation_at
    where candidate.owner_id = current_actor
      and public.ecos_reference_document_category(
        candidate.category, coalesce(candidate.document_data, '{}'::jsonb)
      ) = target_category
      and public.ecos_reference_document_family(
        candidate.category, candidate.name, coalesce(candidate.document_data, '{}'::jsonb)
      ) = target_family
      and public.ecos_reference_documents_share_project(
        target_data, coalesce(candidate.document_data, '{}'::jsonb)
      )
      and public.ecos_schedule_after_current_activation(
        candidate.document_data,
        target_data,
        candidate.id::text = target_record.id::text
      ) is distinct from coalesce(candidate.document_data, '{}'::jsonb);
    get diagnostics changed_count = row_count;
  else
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
    where candidate.owner_id = current_actor
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
  end if;
  perform set_config('app.ecos_current_activation', '', true);

  select source.updated_at into persisted_updated_at
  from public.reference_documents source
  where source.id = target_record.id
    and source.owner_id = current_actor;
  if persisted_updated_at is null then
    raise exception 'ecos_current_activation_conflict';
  end if;

  return jsonb_build_object(
    'document_id', target_record.id::text,
    'updated_at', persisted_updated_at,
    'changed_count', changed_count,
    'schedule_retirement_scope', 'project'
  );
end;
$$;

revoke all on function public.ecos_activate_current_reference_document(text, timestamptz)
  from public, anon;
grant execute on function public.ecos_activate_current_reference_document(text, timestamptz)
  to authenticated;

-- Asked by a device before it activates a schedule: 'project' means a
-- combined schedule stays current for the projects the chosen one does not
-- cover. Before this migration the call does not exist, which a device reads
-- as the old whole-schedule retirement.
create or replace function public.ecos_schedule_retirement_scope()
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select 'project'::text;
$$;

revoke all on function public.ecos_schedule_retirement_scope()
  from public, anon;
grant execute on function public.ecos_schedule_retirement_scope()
  to authenticated, service_role;

-- The activation never started preparation for the rows it retired (a pure
-- demotion is skipped below). Recording or clearing the projects a current
-- combined schedule no longer speaks for changes nothing about its source
-- either, so it starts no preparation.
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
  if tg_op = 'UPDATE'
    and old.document_data->'retiredForProjectNames'
      is distinct from new.document_data->'retiredForProjectNames'
    and coalesce(old.document_data, '{}'::jsonb) - 'retiredForProjectNames' - 'updatedAt'
      = coalesce(new.document_data, '{}'::jsonb) - 'retiredForProjectNames' - 'updatedAt' then
    return new;
  end if;
  perform public.ecos_enqueue_hosted_reference(new.id::text, new.owner_id, new.owner_id);
  return new;
end;
$$;

revoke all on function public.ecos_enqueue_hosted_index_from_reference_document()
  from public, anon, authenticated;

commit;
