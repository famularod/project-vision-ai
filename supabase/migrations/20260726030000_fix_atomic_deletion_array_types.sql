begin;

-- Replace the already-deployed project-deletion function with explicitly typed
-- empty arrays. PostgreSQL otherwise treats '{}' as text in this context and
-- reports a function-body warning during linked database linting.
create or replace function public.dave_delete_project_atomically(
  p_project_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  auth_user uuid := auth.uid();
  target_project_name text := btrim(coalesce(p_project_name, ''));
  project_record_id text;
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
  if target_project_name = '' or char_length(target_project_name) > 240 then
    raise invalid_parameter_value using message = 'valid project name required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(auth_user::text || ':delete-project:' || lower(target_project_name), 0)
  );

  select project_record.id::text
  into project_record_id
  from public.projects as project_record
  where project_record.owner_id = auth_user
    and lower(btrim(project_record.name)) = lower(target_project_name)
  order by project_record.created_at asc, project_record.id asc
  limit 1
  for update;

  insert into public.dave_sync_tombstones (
    owner_id,
    entity_type,
    record_id,
    deleted_at
  )
  values (
    auth_user,
    'project',
    lower(target_project_name),
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
    and lower(btrim(update_record.project_name)) = lower(target_project_name)
  on conflict (owner_id, entity_type, record_id)
  do update set deleted_at = greatest(
    public.dave_sync_tombstones.deleted_at,
    excluded.deleted_at
  );
  get diagnostics update_count = row_count;

  insert into public.dave_sync_tombstones (
    owner_id,
    entity_type,
    record_id,
    deleted_at
  )
  select auth_user, 'schedule_item', schedule_record.id::text, deleted_at
  from public.schedule_items as schedule_record
  where schedule_record.owner_id = auth_user
    and lower(btrim(schedule_record.project_name)) = lower(target_project_name)
  on conflict (owner_id, entity_type, record_id)
  do update set deleted_at = greatest(
    public.dave_sync_tombstones.deleted_at,
    excluded.deleted_at
  );
  get diagnostics schedule_count = row_count;

  insert into public.dave_sync_tombstones (
    owner_id,
    entity_type,
    record_id,
    deleted_at
  )
  select auth_user, 'project_area', area_record.id::text, deleted_at
  from public.project_areas as area_record
  where area_record.owner_id = auth_user
    and lower(btrim(coalesce(area_record.area_data ->> 'projectName', ''))) =
      lower(target_project_name)
  on conflict (owner_id, entity_type, record_id)
  do update set deleted_at = greatest(
    public.dave_sync_tombstones.deleted_at,
    excluded.deleted_at
  );
  get diagnostics area_count = row_count;

  -- Shared documents remain attached to their other projects. A document is
  -- deleted only when this project is its sole explicit project scope.
  update public.reference_documents as document_record
  set document_data = jsonb_set(
        jsonb_set(
          document_record.document_data,
          '{projectNames}',
          coalesce((
            select jsonb_agg(project_value)
            from jsonb_array_elements_text(
              case
                when jsonb_typeof(document_record.document_data -> 'projectNames') = 'array'
                  then document_record.document_data -> 'projectNames'
                else '[]'::jsonb
              end
            ) as project_value
            where lower(btrim(project_value)) <> lower(target_project_name)
          ), '[]'::jsonb),
          true
        ),
        '{projectName}',
        coalesce((
          select to_jsonb(project_value)
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(document_record.document_data -> 'projectNames') = 'array'
                then document_record.document_data -> 'projectNames'
              else '[]'::jsonb
            end
          ) as project_value
          where lower(btrim(project_value)) <> lower(target_project_name)
          limit 1
        ), 'null'::jsonb),
        true
      ),
      updated_at = deleted_at
  where document_record.owner_id = auth_user
    and jsonb_typeof(document_record.document_data -> 'projectNames') = 'array'
    and jsonb_array_length(
      case
        when jsonb_typeof(document_record.document_data -> 'projectNames') = 'array'
          then document_record.document_data -> 'projectNames'
        else '[]'::jsonb
      end
    ) > 1
    and exists (
      select 1
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(document_record.document_data -> 'projectNames') = 'array'
            then document_record.document_data -> 'projectNames'
          else '[]'::jsonb
        end
      ) as project_value
      where lower(btrim(project_value)) = lower(target_project_name)
    );

  select coalesce(array_agg(document_record.id::text), array[]::text[])
  into deleted_document_ids
  from public.reference_documents as document_record
  where document_record.owner_id = auth_user
    and (
      lower(btrim(coalesce(document_record.document_data ->> 'projectName', ''))) =
        lower(target_project_name)
      or (
        jsonb_typeof(document_record.document_data -> 'projectNames') = 'array'
        and jsonb_array_length(
          case
            when jsonb_typeof(document_record.document_data -> 'projectNames') = 'array'
              then document_record.document_data -> 'projectNames'
            else '[]'::jsonb
          end
        ) <= 1
        and exists (
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
  get diagnostics document_count = row_count;

  delete from public.project_updates as update_record
  where update_record.owner_id = auth_user
    and lower(btrim(update_record.project_name)) = lower(target_project_name);

  delete from public.schedule_items as schedule_record
  where schedule_record.owner_id = auth_user
    and lower(btrim(schedule_record.project_name)) = lower(target_project_name);

  delete from public.project_areas as area_record
  where area_record.owner_id = auth_user
    and lower(btrim(coalesce(area_record.area_data ->> 'projectName', ''))) =
      lower(target_project_name);

  delete from public.reference_documents as document_record
  where document_record.owner_id = auth_user
    and document_record.id::text = any(deleted_document_ids);

  delete from public.projects as project_record
  where project_record.owner_id = auth_user
    and lower(btrim(project_record.name)) = lower(target_project_name);

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
    coalesce(project_record_id, lower(target_project_name)),
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
    'already_absent', project_record_id is null,
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

revoke all on function public.dave_delete_project_atomically(text)
  from public, anon;
grant execute on function public.dave_delete_project_atomically(text)
  to authenticated;

comment on function public.dave_delete_project_atomically(text) is
  'Owner-scoped atomic project deletion with permanent tombstones and explicitly typed document-id arrays.';

commit;
