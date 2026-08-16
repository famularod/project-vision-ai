begin;

-- PostgREST does not support overloaded RPCs safely. Remove the legacy
-- display-name route before publishing the exact-ID contract.
revoke all on function public.dave_delete_project_atomically(text)
  from public, anon, authenticated;
drop function if exists public.dave_delete_project_atomically(text);

create function public.dave_delete_project_atomically(
  p_project_id text,
  p_project_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  auth_user uuid := auth.uid();
  target_project_id text := lower(btrim(coalesce(p_project_id, '')));
  target_project_name text := btrim(coalesce(p_project_name, ''));
  project_record_id text;
  project_record_name text;
  project_was_present boolean := false;
  deleted_document_ids text[] := array[]::text[];
  deleted_at timestamptz := now();
  update_count integer := 0;
  schedule_count integer := 0;
  area_count integer := 0;
  document_count integer := 0;
begin
  if auth_user is null or not public.dave_is_app_owner() then
    raise insufficient_privilege using message = 'owner authorization required';
  end if;
  if p_project_id is null
      or p_project_id <> btrim(p_project_id)
      or p_project_id <> lower(p_project_id)
      or target_project_id !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise invalid_parameter_value using message = 'valid immutable project id required';
  end if;
  if target_project_name = '' or char_length(target_project_name) > 240 then
    raise invalid_parameter_value using message = 'valid project name required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(auth_user::text || ':delete-project:' || target_project_id, 0)
  );

  select project_record.id::text, project_record.name
  into project_record_id, project_record_name
  from public.projects as project_record
  where project_record.owner_id = auth_user
    and project_record.id::text = target_project_id
  for update;

  project_was_present := project_record_id is not null;
  if project_was_present then
    if btrim(project_record_name) <> target_project_name then
      raise invalid_parameter_value using
        message = 'project id and display name do not identify the same project';
    end if;

    -- These are legacy rows that look related only by mutable display text.
    -- Guessing would recreate the original cross-project deletion flaw, so
    -- abort the entire transaction before tombstones or deletes are written.
    if exists (
      select 1
      from public.project_updates as update_record
      where update_record.owner_id = auth_user
        and not exists (
          select 1
          from public.projects as bound_project
          where bound_project.owner_id = auth_user
            and bound_project.id::text = update_record.project_id
        )
        and lower(btrim(update_record.project_name)) = lower(target_project_name)
    ) then
      raise check_violation using
        message = 'project deletion blocked by name-only project update';
    end if;

    if exists (
      select 1
      from public.schedule_items as schedule_record
      where schedule_record.owner_id = auth_user
        and not exists (
          select 1
          from public.projects as bound_project
          where bound_project.owner_id = auth_user
            and bound_project.id::text = schedule_record.project_id
        )
        and lower(btrim(schedule_record.project_name)) = lower(target_project_name)
    ) then
      raise check_violation using
        message = 'project deletion blocked by name-only schedule item';
    end if;

    if exists (
      select 1
      from public.project_areas as area_record
      where area_record.owner_id = auth_user
        and not exists (
          select 1
          from public.projects as bound_project
          where bound_project.owner_id = auth_user
            and bound_project.id::text = area_record.area_data ->> 'projectId'
        )
        and lower(btrim(coalesce(area_record.area_data ->> 'projectName', ''))) =
          lower(target_project_name)
    ) then
      raise check_violation using
        message = 'project deletion blocked by name-only project area';
    end if;

    if exists (
      select 1
      from public.reference_documents as document_record
      where document_record.owner_id = auth_user
        and not exists (
          select 1
          from public.projects as bound_project
          where bound_project.owner_id = auth_user
            and bound_project.id::text = document_record.document_data ->> 'projectId'
        )
        and (
          lower(btrim(coalesce(document_record.document_data ->> 'projectName', ''))) =
            lower(target_project_name)
          or exists (
              select 1
              from jsonb_array_elements_text(
                case
                  when jsonb_typeof(document_record.document_data -> 'projectNames') = 'array'
                    then document_record.document_data -> 'projectNames'
                  else '[]'::jsonb
                end
              ) as project_value
              where lower(btrim(project_value)) = lower(target_project_name)
            )
        )
    ) then
      raise check_violation using
        message = 'project deletion blocked by reference document without exact single-project binding';
    end if;
  elsif not exists (
    select 1
    from public.dave_sync_tombstones as existing_tombstone
    where existing_tombstone.owner_id = auth_user
      and existing_tombstone.entity_type = 'project'
      and existing_tombstone.record_id = target_project_id
  ) then
    -- Do not let an owner-authorized caller manufacture a tombstone for an
    -- arbitrary absent UUID. A retry is valid only after the first atomic
    -- delete already established this exact barrier.
    raise invalid_parameter_value using message = 'exact project is unavailable';
  end if;

  select count(*)::integer
  into update_count
  from public.project_updates as update_record
  where update_record.owner_id = auth_user
    and update_record.project_id = target_project_id;

  select count(*)::integer
  into schedule_count
  from public.schedule_items as schedule_record
  where schedule_record.owner_id = auth_user
    and schedule_record.project_id = target_project_id;

  select count(*)::integer
  into area_count
  from public.project_areas as area_record
  where area_record.owner_id = auth_user
    and area_record.area_data ->> 'projectId' = target_project_id;

  select coalesce(array_agg(document_record.id::text), array[]::text[])
  into deleted_document_ids
  from public.reference_documents as document_record
  where document_record.owner_id = auth_user
    and document_record.document_data ->> 'projectId' = target_project_id;
  document_count := cardinality(deleted_document_ids);

  insert into public.dave_sync_tombstones (
    owner_id,
    entity_type,
    record_id,
    deleted_at
  )
  values (
    auth_user,
    'project',
    target_project_id,
    deleted_at
  )
  on conflict (owner_id, entity_type, record_id)
  do update set deleted_at = greatest(
    public.dave_sync_tombstones.deleted_at,
    excluded.deleted_at
  );

  insert into public.dave_sync_tombstones (
    owner_id,
    entity_type,
    record_id,
    deleted_at
  )
  select auth_user, 'project_update', update_record.id::text, deleted_at
  from public.project_updates as update_record
  where update_record.owner_id = auth_user
    and update_record.project_id = target_project_id
  on conflict (owner_id, entity_type, record_id)
  do update set deleted_at = greatest(
    public.dave_sync_tombstones.deleted_at,
    excluded.deleted_at
  );

  insert into public.dave_sync_tombstones (
    owner_id,
    entity_type,
    record_id,
    deleted_at
  )
  select auth_user, 'schedule_item', schedule_record.id::text, deleted_at
  from public.schedule_items as schedule_record
  where schedule_record.owner_id = auth_user
    and schedule_record.project_id = target_project_id
  on conflict (owner_id, entity_type, record_id)
  do update set deleted_at = greatest(
    public.dave_sync_tombstones.deleted_at,
    excluded.deleted_at
  );

  insert into public.dave_sync_tombstones (
    owner_id,
    entity_type,
    record_id,
    deleted_at
  )
  select auth_user, 'project_area', area_record.id::text, deleted_at
  from public.project_areas as area_record
  where area_record.owner_id = auth_user
    and area_record.area_data ->> 'projectId' = target_project_id
  on conflict (owner_id, entity_type, record_id)
  do update set deleted_at = greatest(
    public.dave_sync_tombstones.deleted_at,
    excluded.deleted_at
  );

  insert into public.dave_sync_tombstones (
    owner_id,
    entity_type,
    record_id,
    deleted_at
  )
  select auth_user, 'reference_document', document_id, deleted_at
  from unnest(deleted_document_ids) as document_id
  on conflict (owner_id, entity_type, record_id)
  do update set deleted_at = greatest(
    public.dave_sync_tombstones.deleted_at,
    excluded.deleted_at
  );

  delete from public.project_updates as update_record
  where update_record.owner_id = auth_user
    and update_record.project_id = target_project_id;

  delete from public.schedule_items as schedule_record
  where schedule_record.owner_id = auth_user
    and schedule_record.project_id = target_project_id;

  delete from public.project_areas as area_record
  where area_record.owner_id = auth_user
    and area_record.area_data ->> 'projectId' = target_project_id;

  delete from public.reference_documents as document_record
  where document_record.owner_id = auth_user
    and document_record.id::text = any(deleted_document_ids);

  delete from public.projects as project_record
  where project_record.owner_id = auth_user
    and project_record.id::text = target_project_id;

  insert into public.dave_deletion_audit (
    owner_id,
    entity_type,
    record_id,
    record_name,
    deleted_at,
    child_counts
  )
  values (
    auth_user,
    'project',
    target_project_id,
    target_project_name,
    deleted_at,
    jsonb_build_object(
      'project_updates', update_count,
      'schedule_items', schedule_count,
      'project_areas', area_count,
      'reference_documents', document_count
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_absent', not project_was_present,
    'project_id', target_project_id,
    'project_name', target_project_name,
    'deleted_at', deleted_at,
    'child_counts', jsonb_build_object(
      'project_updates', update_count,
      'schedule_items', schedule_count,
      'project_areas', area_count,
      'reference_documents', document_count
    )
  );
end
$function$;

revoke all on function public.dave_delete_project_atomically(text, text)
  from public, anon;
grant execute on function public.dave_delete_project_atomically(text, text)
  to authenticated;

comment on function public.dave_delete_project_atomically(text, text) is
  'Owner-scoped atomic deletion bound to one immutable project UUID; name-only child relationships fail closed.';

commit;
