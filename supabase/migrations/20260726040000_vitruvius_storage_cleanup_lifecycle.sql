-- Owner-scoped storage cleanup lifecycle.
--
-- Database records and permanent tombstones already commit atomically. This
-- migration extends that lifecycle to the protected file bytes referenced by
-- deleted projects, field updates, and reference documents. The database
-- records cleanup work transactionally; signed-in clients then remove the
-- object and acknowledge the intent. Failed removals remain visible and
-- retryable instead of being silently forgotten.

begin;

create table if not exists public.dave_storage_cleanup_intents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  bucket_id text not null check (
    bucket_id in ('project-photos', 'project-documents')
  ),
  object_path text not null check (
    btrim(object_path) <> ''
    and char_length(object_path) <= 1024
  ),
  source_entity_type text not null check (
    source_entity_type in ('project', 'project_update', 'reference_document')
  ),
  source_record_id text not null,
  status text not null default 'pending' check (
    status in ('pending', 'completed', 'failed')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (owner_id, bucket_id, object_path)
);

create index if not exists dave_storage_cleanup_owner_status_idx
  on public.dave_storage_cleanup_intents (
    owner_id,
    status,
    updated_at asc
  );

alter table public.dave_storage_cleanup_intents enable row level security;
alter table public.dave_storage_cleanup_intents force row level security;
revoke all on table public.dave_storage_cleanup_intents
  from public, anon, authenticated;

drop policy if exists dave_storage_cleanup_owner_select
  on public.dave_storage_cleanup_intents;
create policy dave_storage_cleanup_owner_select
  on public.dave_storage_cleanup_intents
  for select to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

drop policy if exists dave_storage_cleanup_owner_update
  on public.dave_storage_cleanup_intents;
create policy dave_storage_cleanup_owner_update
  on public.dave_storage_cleanup_intents
  for update to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  )
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

grant select on table public.dave_storage_cleanup_intents to authenticated;
grant update (
  status,
  attempt_count,
  last_error,
  updated_at,
  completed_at
) on table public.dave_storage_cleanup_intents to authenticated;

create or replace function public.dave_enqueue_storage_cleanup(
  p_owner_id uuid,
  p_bucket_id text,
  p_object_path text,
  p_source_entity_type text,
  p_source_record_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_path text := btrim(coalesce(p_object_path, ''));
begin
  if p_owner_id is null
     or p_bucket_id not in ('project-photos', 'project-documents')
     or normalized_path = ''
     or char_length(normalized_path) > 1024
     or p_source_entity_type not in (
       'project',
       'project_update',
       'reference_document'
     )
     or btrim(coalesce(p_source_record_id, '')) = '' then
    return;
  end if;

  insert into public.dave_storage_cleanup_intents (
    owner_id,
    bucket_id,
    object_path,
    source_entity_type,
    source_record_id,
    status,
    attempt_count,
    last_error,
    updated_at,
    completed_at
  )
  values (
    p_owner_id,
    p_bucket_id,
    normalized_path,
    p_source_entity_type,
    p_source_record_id,
    'pending',
    0,
    null,
    now(),
    null
  )
  on conflict (owner_id, bucket_id, object_path)
  do update set
    source_entity_type = excluded.source_entity_type,
    source_record_id = excluded.source_record_id,
    status = case
      when public.dave_storage_cleanup_intents.status = 'completed'
        then 'completed'
      else 'pending'
    end,
    last_error = case
      when public.dave_storage_cleanup_intents.status = 'completed'
        then public.dave_storage_cleanup_intents.last_error
      else null
    end,
    updated_at = now();
end
$function$;

revoke all on function public.dave_enqueue_storage_cleanup(
  uuid,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

create or replace function public.dave_project_update_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  object_record record;
begin
  for object_record in
    select distinct candidate.bucket_id, candidate.object_path
    from (
      select
        'project-photos'::text as bucket_id,
        btrim(photo_value ->> 'cloudStoragePath') as object_path
      from jsonb_array_elements(
        case
          when jsonb_typeof(old.update_data -> 'photos') = 'array'
            then old.update_data -> 'photos'
          else '[]'::jsonb
        end
      ) as photo_value
      where btrim(coalesce(photo_value ->> 'cloudStoragePath', '')) <> ''

      union all

      select
        'project-documents'::text as bucket_id,
        btrim(document_value ->> 'storagePath') as object_path
      from jsonb_array_elements(
        case
          when jsonb_typeof(old.update_data -> 'documents') = 'array'
            then old.update_data -> 'documents'
          else '[]'::jsonb
        end
      ) as document_value
      where btrim(coalesce(document_value ->> 'storagePath', '')) <> ''
    ) as candidate
  loop
    if object_record.bucket_id = 'project-photos' and not exists (
      select 1
      from public.project_updates as other_update
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(other_update.update_data -> 'photos') = 'array'
            then other_update.update_data -> 'photos'
          else '[]'::jsonb
        end
      ) as other_photo
      where other_update.owner_id = old.owner_id
        and btrim(coalesce(other_photo ->> 'cloudStoragePath', '')) =
          object_record.object_path
    ) and not exists (
      select 1
      from public.projects as other_project
      where other_project.owner_id = old.owner_id
        and btrim(coalesce(
          other_project.project_data #>> '{coverPhoto,remotePath}',
          ''
        )) = object_record.object_path
    ) then
      perform public.dave_enqueue_storage_cleanup(
        old.owner_id,
        object_record.bucket_id,
        object_record.object_path,
        'project_update',
        old.id::text
      );
    elsif object_record.bucket_id = 'project-documents' and not exists (
      select 1
      from public.project_updates as other_update
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(other_update.update_data -> 'documents') = 'array'
            then other_update.update_data -> 'documents'
          else '[]'::jsonb
        end
      ) as other_document
      where other_update.owner_id = old.owner_id
        and btrim(coalesce(other_document ->> 'storagePath', '')) =
          object_record.object_path
    ) and not exists (
      select 1
      from public.reference_documents as other_reference
      where other_reference.owner_id = old.owner_id
        and btrim(coalesce(
          other_reference.document_data ->> 'storagePath',
          ''
        )) = object_record.object_path
    ) then
      perform public.dave_enqueue_storage_cleanup(
        old.owner_id,
        object_record.bucket_id,
        object_record.object_path,
        'project_update',
        old.id::text
      );
    end if;
  end loop;

  return old;
end
$function$;

create or replace function public.dave_reference_document_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  storage_path text := btrim(coalesce(
    old.document_data ->> 'storagePath',
    ''
  ));
begin
  if storage_path <> ''
     and not exists (
       select 1
       from public.reference_documents as other_reference
       where other_reference.owner_id = old.owner_id
         and btrim(coalesce(
           other_reference.document_data ->> 'storagePath',
           ''
         )) = storage_path
     )
     and not exists (
       select 1
       from public.project_updates as other_update
       cross join lateral jsonb_array_elements(
         case
           when jsonb_typeof(other_update.update_data -> 'documents') = 'array'
             then other_update.update_data -> 'documents'
           else '[]'::jsonb
         end
       ) as other_document
       where other_update.owner_id = old.owner_id
         and btrim(coalesce(other_document ->> 'storagePath', '')) =
           storage_path
     ) then
    perform public.dave_enqueue_storage_cleanup(
      old.owner_id,
      'project-documents',
      storage_path,
      'reference_document',
      old.id::text
    );
  end if;

  return old;
end
$function$;

create or replace function public.dave_project_cover_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  storage_path text := btrim(coalesce(
    old.project_data #>> '{coverPhoto,remotePath}',
    ''
  ));
begin
  if storage_path <> ''
     and not exists (
       select 1
       from public.projects as other_project
       where other_project.owner_id = old.owner_id
         and btrim(coalesce(
           other_project.project_data #>> '{coverPhoto,remotePath}',
           ''
         )) = storage_path
     )
     and not exists (
       select 1
       from public.project_updates as other_update
       cross join lateral jsonb_array_elements(
         case
           when jsonb_typeof(other_update.update_data -> 'photos') = 'array'
             then other_update.update_data -> 'photos'
           else '[]'::jsonb
         end
       ) as other_photo
       where other_update.owner_id = old.owner_id
         and btrim(coalesce(other_photo ->> 'cloudStoragePath', '')) =
           storage_path
     ) then
    perform public.dave_enqueue_storage_cleanup(
      old.owner_id,
      'project-photos',
      storage_path,
      'project',
      old.id::text
    );
  end if;

  return old;
end
$function$;

drop trigger if exists dave_project_update_storage_cleanup_trigger
  on public.project_updates;
create trigger dave_project_update_storage_cleanup_trigger
after delete on public.project_updates
for each row execute function public.dave_project_update_storage_cleanup();

drop trigger if exists dave_reference_document_storage_cleanup_trigger
  on public.reference_documents;
create trigger dave_reference_document_storage_cleanup_trigger
after delete on public.reference_documents
for each row execute function public.dave_reference_document_storage_cleanup();

drop trigger if exists dave_project_cover_storage_cleanup_trigger
  on public.projects;
create trigger dave_project_cover_storage_cleanup_trigger
after delete on public.projects
for each row execute function public.dave_project_cover_storage_cleanup();

create or replace function public.dave_remove_tombstoned_operational_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.entity_type = 'schedule_item' then
    delete from public.schedule_items
    where owner_id = new.owner_id
      and id::text = new.record_id;
  elsif new.entity_type = 'project_area' then
    delete from public.project_areas
    where owner_id = new.owner_id
      and id::text = new.record_id;
  elsif new.entity_type = 'reference_document' then
    delete from public.reference_documents
    where owner_id = new.owner_id
      and id::text = new.record_id;
  end if;
  return new;
end
$function$;

drop trigger if exists dave_remove_tombstoned_operational_row_trigger
  on public.dave_sync_tombstones;
create trigger dave_remove_tombstoned_operational_row_trigger
after insert or update of deleted_at on public.dave_sync_tombstones
for each row execute function public.dave_remove_tombstoned_operational_row();

-- Reconcile legacy tombstones that predate physical active-row cleanup. The
-- delete triggers above enqueue protected files before those rows disappear.
delete from public.schedule_items as schedule_record
using public.dave_sync_tombstones as tombstone
where tombstone.owner_id = schedule_record.owner_id
  and tombstone.entity_type = 'schedule_item'
  and tombstone.record_id = schedule_record.id::text;

delete from public.project_areas as area_record
using public.dave_sync_tombstones as tombstone
where tombstone.owner_id = area_record.owner_id
  and tombstone.entity_type = 'project_area'
  and tombstone.record_id = area_record.id::text;

delete from public.reference_documents as document_record
using public.dave_sync_tombstones as tombstone
where tombstone.owner_id = document_record.owner_id
  and tombstone.entity_type = 'reference_document'
  and tombstone.record_id = document_record.id::text;

-- Only the verified app owner may access protected project files. Existing
-- object paths are not rewritten, so this also covers older mobile uploads
-- that predate owner-prefixed paths.
drop policy if exists project_photos_anon_select on storage.objects;
drop policy if exists project_photos_anon_insert on storage.objects;
drop policy if exists project_photos_anon_update on storage.objects;
drop policy if exists project_photos_anon_delete on storage.objects;
drop policy if exists project_photos_authenticated_select on storage.objects;
drop policy if exists project_photos_authenticated_insert on storage.objects;
drop policy if exists project_photos_authenticated_update on storage.objects;
drop policy if exists project_photos_authenticated_delete on storage.objects;

create policy project_photos_authenticated_select
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-photos'
    and (select public.dave_is_app_owner())
  );
create policy project_photos_authenticated_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-photos'
    and (select public.dave_is_app_owner())
  );
create policy project_photos_authenticated_update
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-photos'
    and (select public.dave_is_app_owner())
  )
  with check (
    bucket_id = 'project-photos'
    and (select public.dave_is_app_owner())
  );
create policy project_photos_authenticated_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-photos'
    and (select public.dave_is_app_owner())
  );

drop policy if exists project_documents_anon_select on storage.objects;
drop policy if exists project_documents_anon_insert on storage.objects;
drop policy if exists project_documents_anon_update on storage.objects;
drop policy if exists project_documents_anon_delete on storage.objects;
drop policy if exists project_documents_authenticated_select on storage.objects;
drop policy if exists project_documents_authenticated_insert on storage.objects;
drop policy if exists project_documents_authenticated_update on storage.objects;
drop policy if exists project_documents_authenticated_delete on storage.objects;

create policy project_documents_authenticated_select
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-documents'
    and (select public.dave_is_app_owner())
  );
create policy project_documents_authenticated_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and (select public.dave_is_app_owner())
  );
create policy project_documents_authenticated_update
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-documents'
    and (select public.dave_is_app_owner())
  )
  with check (
    bucket_id = 'project-documents'
    and (select public.dave_is_app_owner())
  );
create policy project_documents_authenticated_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-documents'
    and (select public.dave_is_app_owner())
  );

comment on table public.dave_storage_cleanup_intents is
  'Owner-scoped durable outbox for protected files referenced by deleted business records.';

commit;
