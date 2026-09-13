begin;

create or replace function public.ecos_load_project_question_records_v1(
  p_project_id text,
  p_project_name text,
  p_task_limit integer default 5000,
  p_update_limit integer default 5000,
  p_note_limit integer default 2000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_project_id text := btrim(coalesce(p_project_id, ''));
  target_project_name text := btrim(coalesce(p_project_name, ''));
  task_limit integer := greatest(1, least(coalesce(p_task_limit, 5000), 5000));
  update_limit integer := greatest(1, least(coalesce(p_update_limit, 5000), 5000));
  note_limit integer := greatest(1, least(coalesce(p_note_limit, 2000), 2000));
  task_rows jsonb;
  update_rows jsonb;
  note_rows jsonb;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authenticated user required';
  end if;
  if target_project_id = '' or target_project_name = '' then
    raise invalid_parameter_value using message = 'project identity required';
  end if;
  if not exists (
    select 1
    from public.projects project
    where project.owner_id = caller_id
      and project.id::text = target_project_id
      and lower(btrim(project.name)) = lower(target_project_name)
      and project.archived = false
  ) then
    raise insufficient_privilege using message = 'project access denied';
  end if;

  select coalesce(jsonb_agg(to_jsonb(scoped) order by scoped.id), '[]'::jsonb)
  into task_rows
  from (
    select item.id, item.project_id, item.project_name, item.task_name,
      item.item_data, item.updated_at
    from public.schedule_items item
    where item.owner_id = caller_id
      and (
        lower(btrim(coalesce(item.project_id, ''))) = lower(target_project_id)
        or (
          btrim(coalesce(item.project_id, '')) = ''
          and (
            lower(btrim(coalesce(item.project_name, ''))) = lower(target_project_name)
            or lower(btrim(coalesce(item.item_data->>'projectName', ''))) = lower(target_project_name)
            or lower(btrim(coalesce(item.item_data->>'scheduleProjectName', ''))) = lower(target_project_name)
          )
        )
      )
    order by item.id
    limit task_limit + 1
  ) scoped;
  if jsonb_array_length(task_rows) > task_limit then
    raise program_limit_exceeded using message = 'ecos_project_task_inventory_limit';
  end if;

  select coalesce(jsonb_agg(to_jsonb(scoped) order by scoped.id), '[]'::jsonb)
  into update_rows
  from (
    select update_record.id, update_record.project_id,
      update_record.project_name, update_record.area_name,
      update_record.update_data, update_record.created_at,
      update_record.updated_at
    from public.project_updates update_record
    where update_record.owner_id = caller_id
      and (
        lower(btrim(coalesce(update_record.project_id, ''))) = lower(target_project_id)
        or (
          btrim(coalesce(update_record.project_id, '')) = ''
          and (
            lower(btrim(coalesce(update_record.project_name, ''))) = lower(target_project_name)
            or lower(btrim(coalesce(update_record.update_data->>'projectName', ''))) = lower(target_project_name)
            or lower(btrim(coalesce(update_record.update_data->>'scheduleProjectName', ''))) = lower(target_project_name)
          )
        )
      )
    order by update_record.id
    limit update_limit + 1
  ) scoped;
  if jsonb_array_length(update_rows) > update_limit then
    raise program_limit_exceeded using message = 'ecos_project_update_inventory_limit';
  end if;

  select coalesce(jsonb_agg(to_jsonb(scoped) order by scoped.id), '[]'::jsonb)
  into note_rows
  from (
    select note.id, note.project_id, note.project_name, note.location_name,
      note.original_text, note.action_kind, note.action_text, note.status,
      note.updated_at
    from public.field_notes note
    where note.owner_id = caller_id
      and (
        lower(btrim(coalesce(note.project_id, ''))) = lower(target_project_id)
        or (
          btrim(coalesce(note.project_id, '')) = ''
          and lower(btrim(coalesce(note.project_name, ''))) = lower(target_project_name)
        )
      )
    order by note.id
    limit note_limit + 1
  ) scoped;
  if jsonb_array_length(note_rows) > note_limit then
    raise program_limit_exceeded using message = 'ecos_project_note_inventory_limit';
  end if;

  return jsonb_build_object(
    'schemaVersion', 'ecos-project-question-records/1.0',
    'projectId', target_project_id,
    'projectName', target_project_name,
    'scheduleItems', task_rows,
    'projectUpdates', update_rows,
    'fieldNotes', note_rows
  );
end;
$$;

revoke all on function public.ecos_load_project_question_records_v1(
  text, text, integer, integer, integer
) from public, anon;
grant execute on function public.ecos_load_project_question_records_v1(
  text, text, integer, integer, integer
) to authenticated, service_role;

commit;
