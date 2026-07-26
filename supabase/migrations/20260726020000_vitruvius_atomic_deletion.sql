-- Atomic owner-scoped deletion for projects and field updates. Tombstones and
-- active-record removal commit together so another device cannot resurrect a
-- record after a partially completed client-side cascade.

begin;

alter table public.dave_sync_tombstones
  drop constraint if exists dave_sync_tombstones_entity_type_check;

alter table public.dave_sync_tombstones
  add constraint dave_sync_tombstones_entity_type_check
  check (
    entity_type in (
      'project',
      'project_update',
      'project_area',
      'schedule_item',
      'reference_document'
    )
  );

create table if not exists public.dave_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  entity_type text not null check (
    entity_type in ('project', 'project_update')
  ),
  record_id text not null,
  record_name text,
  deleted_at timestamptz not null default now(),
  child_counts jsonb not null default '{}'::jsonb,
  purge_after timestamptz not null default now() + interval '1 year'
);

create index if not exists dave_deletion_audit_owner_recent_idx
  on public.dave_deletion_audit (owner_id, deleted_at desc);

alter table public.dave_deletion_audit enable row level security;
alter table public.dave_deletion_audit force row level security;
revoke all on table public.dave_deletion_audit
  from public, anon, authenticated;

drop policy if exists dave_deletion_audit_owner_select
  on public.dave_deletion_audit;
create policy dave_deletion_audit_owner_select
  on public.dave_deletion_audit
  for select to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );
grant select on table public.dave_deletion_audit to authenticated;

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
  deleted_document_ids text[] := '{}';
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

  select coalesce(array_agg(document_record.id::text), '{}')
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

create or replace function public.dave_delete_project_update_atomically(
  p_update_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  auth_user uuid := auth.uid();
  update_id text := btrim(coalesce(p_update_id, ''));
  deleted_at timestamptz := now();
  deleted_count integer := 0;
begin
  if auth_user is null or not public.dave_is_app_owner() then
    raise insufficient_privilege using message = 'owner authorization required';
  end if;
  if update_id = '' or char_length(update_id) > 240 then
    raise invalid_parameter_value using message = 'valid field update id required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(auth_user::text || ':delete-update:' || update_id, 0)
  );

  insert into public.dave_sync_tombstones (
    owner_id,
    entity_type,
    record_id,
    deleted_at
  )
  values (auth_user, 'project_update', update_id, deleted_at)
  on conflict (owner_id, entity_type, record_id)
  do update set deleted_at = greatest(
    public.dave_sync_tombstones.deleted_at,
    excluded.deleted_at
  );

  delete from public.project_updates
  where owner_id = auth_user
    and id::text = update_id;
  get diagnostics deleted_count = row_count;

  insert into public.dave_deletion_audit (
    owner_id,
    entity_type,
    record_id,
    deleted_at,
    child_counts
  )
  values (
    auth_user,
    'project_update',
    update_id,
    deleted_at,
    jsonb_build_object('deleted_rows', deleted_count)
  );

  return jsonb_build_object(
    'ok', true,
    'already_absent', deleted_count = 0,
    'record_id', update_id,
    'deleted_at', deleted_at
  );
end
$function$;

create or replace function public.dave_purge_expired_deletion_audit()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  auth_user uuid := auth.uid();
  deleted_count integer;
begin
  if auth_user is null or not public.dave_is_app_owner() then
    raise insufficient_privilege using message = 'owner authorization required';
  end if;
  delete from public.dave_deletion_audit
  where owner_id = auth_user
    and purge_after <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$function$;

revoke all on function public.dave_delete_project_atomically(text)
  from public, anon;
revoke all on function public.dave_delete_project_update_atomically(text)
  from public, anon;
revoke all on function public.dave_purge_expired_deletion_audit()
  from public, anon;

grant execute on function public.dave_delete_project_atomically(text)
  to authenticated;
grant execute on function public.dave_delete_project_update_atomically(text)
  to authenticated;
grant execute on function public.dave_purge_expired_deletion_audit()
  to authenticated;

comment on table public.dave_sync_tombstones is
  'Permanent owner-scoped deletion markers. Retained to prevent stale devices from resurrecting records.';
comment on table public.dave_deletion_audit is
  'Deletion receipts contain metadata only and are eligible for owner-authorized purge after one year.';

commit;
