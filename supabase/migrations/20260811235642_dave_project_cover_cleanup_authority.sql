begin;

create or replace function public.dave_guard_project_cover_storage_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  auth_user uuid := auth.uid();
  project_id text;
  project_exists boolean := false;
begin
  if old.bucket_id <> 'project-photos'
      or old.name !~ '^project-covers/' then
    return old;
  end if;

  -- Service-role retention and administrative cleanup remains available.
  -- Authenticated app deletion takes the exact project lock below.
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return old;
  end if;
  if auth_user is null or not public.dave_is_app_owner() then
    raise insufficient_privilege using message = 'owner authorization required';
  end if;

  project_id := substring(
    old.name from
    '^project-covers/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/'
  );
  if project_id is null then
    raise insufficient_privilege using message = 'exact project cover identity required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(auth_user::text || ':project-cover:' || project_id, 0)
  );
  select true into project_exists
  from public.projects as project_record
  where project_record.owner_id = auth_user
    and project_record.id::text = project_id
  for update;
  if not coalesce(project_exists, false) then
    raise insufficient_privilege using message = 'exact project cover identity changed';
  end if;

  if exists (
    select 1
    from public.projects as referenced_project
    where referenced_project.project_data #>> '{coverPhoto,remotePath}' = old.name
  ) then
    raise insufficient_privilege using message = 'committed project cover cannot be deleted';
  end if;
  return old;
end
$function$;

revoke all on function public.dave_guard_project_cover_storage_delete()
  from public, anon, authenticated;

drop trigger if exists dave_project_cover_storage_delete_guard on storage.objects;
create trigger dave_project_cover_storage_delete_guard
before delete on storage.objects
for each row execute function public.dave_guard_project_cover_storage_delete();

-- The trigger above owns the atomic reference check under the same advisory
-- lock as dave_commit_project_cover_photo(). The policy only establishes the
-- authenticated app-owner boundary; it does not attempt a racy second
-- reference check.
drop policy if exists project_photos_authenticated_delete on storage.objects;
create policy project_photos_authenticated_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-photos'
    and (select public.dave_is_app_owner())
  );

comment on function public.dave_guard_project_cover_storage_delete() is
  'Serializes project-cover Storage deletion with exact cover commit and rejects deletion of a current receipt.';

commit;
