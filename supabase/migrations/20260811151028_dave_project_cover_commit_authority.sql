begin;

create or replace function public.dave_commit_project_cover_photo(
  p_project_id text,
  p_expected_project_name text,
  p_expected_cover_photo jsonb,
  p_expected_cover_photo_mode text,
  p_expected_cover_updated_at text,
  p_target_cover_photo jsonb,
  p_target_cover_photo_mode text,
  p_target_cover_updated_at text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  auth_user uuid := auth.uid();
  project_id text := lower(btrim(coalesce(p_project_id, '')));
  expected_project_name text := btrim(coalesce(p_expected_project_name, ''));
  current_project_name text;
  current_data jsonb;
  current_cover_photo jsonb;
  current_cover_photo_mode text;
  current_cover_updated_at text;
  target_cover_photo jsonb;
  target_remote_path text;
  target_mime_type text;
  target_content_sha256 text;
  target_size_bytes bigint;
  target_object_updated_at text;
  target_updated_at timestamptz;
  current_updated_at timestamptz;
  next_data jsonb;
begin
  if auth_user is null or not public.dave_is_app_owner() then
    raise insufficient_privilege using message = 'owner authorization required';
  end if;
  if p_project_id is null
      or p_project_id <> btrim(p_project_id)
      or p_project_id <> lower(p_project_id)
      or project_id !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('status', 'rejected', 'reason', 'valid immutable project id required');
  end if;
  if expected_project_name = '' or char_length(expected_project_name) > 240 then
    return jsonb_build_object('status', 'rejected', 'reason', 'valid project name required');
  end if;
  if p_expected_cover_photo_mode not in ('automatic', 'manual')
      or p_target_cover_photo_mode not in ('automatic', 'manual') then
    return jsonb_build_object('status', 'rejected', 'reason', 'valid cover modes required');
  end if;
  if p_target_cover_updated_at is null
      or p_target_cover_updated_at = ''
      or p_target_cover_updated_at <> btrim(p_target_cover_updated_at) then
    return jsonb_build_object('status', 'rejected', 'reason', 'valid target cover revision required');
  end if;
  begin
    target_updated_at := p_target_cover_updated_at::timestamptz;
  exception when others then
    return jsonb_build_object('status', 'rejected', 'reason', 'valid target cover revision required');
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(auth_user::text || ':project-cover:' || project_id, 0)
  );

  select project_record.name, project_record.project_data
    into current_project_name, current_data
  from public.projects as project_record
  where project_record.owner_id = auth_user
    and project_record.id::text = project_id
    and coalesce(project_record.archived, false) = false
  for update;

  if current_project_name is null or btrim(current_project_name) <> expected_project_name then
    return jsonb_build_object('status', 'rejected', 'reason', 'project identity changed');
  end if;

  current_data := case
    when jsonb_typeof(current_data) = 'object' then current_data
    else '{}'::jsonb
  end;
  current_cover_photo := case
    when jsonb_typeof(current_data -> 'coverPhoto') = 'object' then
      jsonb_build_object(
        'remotePath', current_data #>> '{coverPhoto,remotePath}',
        'mimeType', current_data #>> '{coverPhoto,mimeType}',
        'contentSha256', current_data #>> '{coverPhoto,contentSha256}',
        'sizeBytes', case
          when jsonb_typeof(current_data #> '{coverPhoto,sizeBytes}') = 'number'
            then current_data #> '{coverPhoto,sizeBytes}'
          else 'null'::jsonb
        end,
        'updatedAt', current_data #>> '{coverPhoto,updatedAt}'
      )
    else null
  end;
  current_cover_photo_mode := case
    when current_data ->> 'coverPhotoMode' in ('automatic', 'manual')
      then current_data ->> 'coverPhotoMode'
    when current_cover_photo is not null then 'manual'
    else 'automatic'
  end;
  current_cover_updated_at := nullif(
    coalesce(
      current_data ->> 'coverPhotoUpdatedAt',
      current_data #>> '{coverPhoto,updatedAt}'
    ),
    ''
  );

  target_cover_photo := case
    when jsonb_typeof(p_target_cover_photo) = 'object' then
      jsonb_build_object(
        'remotePath', p_target_cover_photo ->> 'remotePath',
        'mimeType', p_target_cover_photo ->> 'mimeType',
        'contentSha256', p_target_cover_photo ->> 'contentSha256',
        'sizeBytes', case
          when jsonb_typeof(p_target_cover_photo -> 'sizeBytes') = 'number'
            then p_target_cover_photo -> 'sizeBytes'
          else 'null'::jsonb
        end,
        'updatedAt', p_target_cover_photo ->> 'updatedAt'
      )
    else null
  end;

  -- A lost response after commit is safe to retry. Confirm the exact already
  -- committed target before evaluating the predecessor compare-and-swap.
  if current_cover_photo_mode = p_target_cover_photo_mode
      and current_cover_updated_at is not distinct from p_target_cover_updated_at
      and current_cover_photo is not distinct from target_cover_photo then
    return jsonb_build_object('status', 'already_committed');
  end if;

  if current_cover_photo_mode <> p_expected_cover_photo_mode
      or current_cover_updated_at is distinct from p_expected_cover_updated_at
      or current_cover_photo is distinct from p_expected_cover_photo then
    return jsonb_build_object('status', 'conflict', 'reason', 'project cover predecessor changed');
  end if;

  if current_cover_updated_at is not null then
    begin
      current_updated_at := current_cover_updated_at::timestamptz;
    exception when others then
      return jsonb_build_object('status', 'conflict', 'reason', 'current cover revision is malformed');
    end;
    if target_updated_at <= current_updated_at then
      return jsonb_build_object('status', 'conflict', 'reason', 'target cover revision is not newer');
    end if;
  end if;

  if p_target_cover_photo_mode = 'manual' then
    if target_cover_photo is null then
      return jsonb_build_object('status', 'rejected', 'reason', 'manual cover object required');
    end if;
    target_remote_path := target_cover_photo ->> 'remotePath';
    target_mime_type := target_cover_photo ->> 'mimeType';
    target_content_sha256 := target_cover_photo ->> 'contentSha256';
    target_object_updated_at := target_cover_photo ->> 'updatedAt';
    begin
      target_size_bytes := (target_cover_photo ->> 'sizeBytes')::bigint;
    exception when others then
      target_size_bytes := null;
    end;
    if target_remote_path is null
        or target_remote_path !~ (
          '^project-covers/' || project_id ||
          '/revisions/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png)$'
        )
        or target_object_updated_at is distinct from p_target_cover_updated_at
        or target_content_sha256 is null
        or target_content_sha256 !~ '^[0-9a-f]{64}$'
        or target_size_bytes is null
        or target_size_bytes <= 0
        or not (
          target_mime_type = 'image/jpeg' and right(target_remote_path, 4) = '.jpg'
          or target_mime_type = 'image/png' and right(target_remote_path, 4) = '.png'
        )
        or not exists (
          select 1
          from storage.objects as cover_object
          where cover_object.bucket_id = 'project-photos'
            and cover_object.name = target_remote_path
            and cover_object.user_metadata ->> 'vitruviusContentSha256' =
              target_content_sha256
            and cover_object.user_metadata ->> 'vitruviusSizeBytes' =
              target_size_bytes::text
            and cover_object.metadata ->> 'size' = target_size_bytes::text
        ) then
      return jsonb_build_object('status', 'rejected', 'reason', 'immutable manual cover receipt required');
    end if;
  elsif target_cover_photo is distinct from current_cover_photo
      and target_cover_photo is not null then
    return jsonb_build_object('status', 'rejected', 'reason', 'automatic mode cannot rebind cover bytes');
  end if;

  next_data := (
    current_data - 'coverPhoto' - 'coverPhotoMode' - 'coverPhotoUpdatedAt'
  ) || jsonb_build_object(
    'coverPhoto', target_cover_photo,
    'coverPhotoMode', p_target_cover_photo_mode,
    'coverPhotoUpdatedAt', p_target_cover_updated_at
  );

  update public.projects as project_record
  set project_data = next_data,
      updated_at = now()
  where project_record.owner_id = auth_user
    and project_record.id::text = project_id;

  return jsonb_build_object('status', 'committed');
end
$function$;

revoke all on function public.dave_commit_project_cover_photo(
  text, text, jsonb, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.dave_commit_project_cover_photo(
  text, text, jsonb, text, text, jsonb, text, text
) to authenticated;

-- Immutable revision paths are insert-only. Authenticated clients may delete
-- an uncommitted attempt after an explicit CAS conflict, but they cannot
-- overwrite or delete bytes referenced by a committed project receipt.
drop policy if exists project_photos_owner_update on storage.objects;
drop policy if exists project_photos_owner_delete on storage.objects;
drop policy if exists project_photos_authenticated_update on storage.objects;
create policy project_photos_authenticated_update
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-photos'
    and (select public.dave_is_app_owner())
    and name !~
      '^project-covers/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/revisions/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png)$'
  )
  with check (
    bucket_id = 'project-photos'
    and (select public.dave_is_app_owner())
    and name !~
      '^project-covers/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/revisions/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png)$'
  );

drop policy if exists project_photos_authenticated_delete on storage.objects;
create policy project_photos_authenticated_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-photos'
    and (select public.dave_is_app_owner())
    and (
      name !~
        '^project-covers/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/revisions/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png)$'
      or not exists (
        select 1
        from public.projects as referenced_project
        where referenced_project.project_data #>> '{coverPhoto,remotePath}' =
          storage.objects.name
      )
    )
  );

create or replace function public.dave_guard_project_cover_authority()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  commit_function_owner name;
begin
  if (new.project_data -> 'coverPhoto') is not distinct from (old.project_data -> 'coverPhoto')
      and (new.project_data -> 'coverPhotoMode') is not distinct from (old.project_data -> 'coverPhotoMode')
      and (new.project_data -> 'coverPhotoUpdatedAt') is not distinct from (old.project_data -> 'coverPhotoUpdatedAt') then
    return new;
  end if;

  select pg_catalog.pg_get_userbyid(function_record.proowner)
    into commit_function_owner
  from pg_catalog.pg_proc as function_record
  where function_record.oid = to_regprocedure(
    'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)'
  );

  if commit_function_owner is null or current_user <> commit_function_owner then
    raise exception 'project cover authority requires atomic commit'
      using errcode = '42501';
  end if;
  return new;
end
$function$;

revoke all on function public.dave_guard_project_cover_authority()
  from public, anon, authenticated;

drop trigger if exists dave_project_cover_authority_guard on public.projects;
create trigger dave_project_cover_authority_guard
before update of project_data on public.projects
for each row execute function public.dave_guard_project_cover_authority();

-- The pre-existing cleanup function first verifies that no surviving project
-- or update references OLD's object. Running it only after the CAS commits
-- avoids deleting bytes that an indeterminate client response may have made
-- current.
drop trigger if exists dave_project_cover_storage_cleanup_update_trigger
  on public.projects;
create trigger dave_project_cover_storage_cleanup_update_trigger
after update of project_data on public.projects
for each row
when (
  (old.project_data #>> '{coverPhoto,remotePath}') is distinct from
  (new.project_data #>> '{coverPhoto,remotePath}')
)
execute function public.dave_project_cover_storage_cleanup();

comment on function public.dave_commit_project_cover_photo(
  text, text, jsonb, text, text, jsonb, text, text
) is
  'Atomically compare-and-swaps one owner project cover onto an immutable per-attempt storage object.';

notify pgrst, 'reload schema';

commit;
