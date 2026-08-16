\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create schema auth;
create schema storage;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create function public.dave_is_app_owner()
returns boolean
language sql
stable
as $$ select true $$;

create table public.projects (
  id uuid primary key,
  owner_id uuid not null,
  name text not null,
  archived boolean not null default false,
  project_data jsonb,
  updated_at timestamptz not null default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  metadata jsonb,
  user_metadata jsonb
);
alter table storage.objects enable row level security;

-- Reproduce the full historical policy-chain condition. The forward migration
-- must remove these broad permissive authorizers rather than assuming a newer
-- policy with a different name constrains them.
create policy project_photos_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'project-photos' and (select public.dave_is_app_owner()));
create policy project_photos_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'project-photos' and (select public.dave_is_app_owner()))
  with check (bucket_id = 'project-photos' and (select public.dave_is_app_owner()));
create policy project_photos_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-photos' and (select public.dave_is_app_owner()));

create function public.dave_project_cover_storage_cleanup()
returns trigger
language plpgsql
as $$ begin return new; end $$;

\ir ../../supabase/migrations/20260811151028_dave_project_cover_commit_authority.sql

select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  false
);

insert into public.projects (id, owner_id, name, project_data) values (
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Shared Project',
  '{"coverPhoto":null,"coverPhotoMode":"automatic","coverPhotoUpdatedAt":null}'
);
insert into storage.objects (bucket_id, name, metadata, user_metadata) values
  (
    'project-photos',
    'project-covers/11111111-1111-4111-8111-111111111111/revisions/33333333-3333-4333-8333-333333333333.jpg',
    '{"size":1234}',
    '{"vitruviusContentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","vitruviusSizeBytes":"1234"}'
  ),
  (
    'project-photos',
    'project-covers/11111111-1111-4111-8111-111111111111/revisions/44444444-4444-4444-8444-444444444444.jpg',
    '{"size":1234}',
    '{"vitruviusContentSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","vitruviusSizeBytes":"1234"}'
  );

do $$
declare
  rejected jsonb;
begin
  rejected := public.dave_commit_project_cover_photo(
    '11111111-1111-4111-8111-111111111111',
    'Shared Project',
    null,
    'automatic',
    null,
    '{"remotePath":"project-covers/11111111-1111-4111-8111-111111111111/revisions/44444444-4444-4444-8444-444444444444.jpg","mimeType":"image/jpeg","updatedAt":"2026-08-11T16:00:00.000Z","contentSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","sizeBytes":1234}',
    'manual',
    '2026-08-11T16:00:00.000Z'
  );
  if rejected ->> 'status' <> 'rejected' then
    raise exception 'mismatched storage digest was accepted';
  end if;
end
$$;

do $$
declare
  committed jsonb;
  retried jsonb;
begin
  committed := public.dave_commit_project_cover_photo(
    '11111111-1111-4111-8111-111111111111',
    'Shared Project',
    null,
    'automatic',
    null,
    '{"remotePath":"project-covers/11111111-1111-4111-8111-111111111111/revisions/33333333-3333-4333-8333-333333333333.jpg","mimeType":"image/jpeg","updatedAt":"2026-08-11T16:00:00.000Z","contentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sizeBytes":1234}',
    'manual',
    '2026-08-11T16:00:00.000Z'
  );
  if committed ->> 'status' <> 'committed' then
    raise exception 'exact cover receipt did not commit';
  end if;
  retried := public.dave_commit_project_cover_photo(
    '11111111-1111-4111-8111-111111111111',
    'Shared Project',
    null,
    'automatic',
    null,
    '{"remotePath":"project-covers/11111111-1111-4111-8111-111111111111/revisions/33333333-3333-4333-8333-333333333333.jpg","mimeType":"image/jpeg","updatedAt":"2026-08-11T16:00:00.000Z","contentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sizeBytes":1234}',
    'manual',
    '2026-08-11T16:00:00.000Z'
  );
  if retried ->> 'status' <> 'already_committed' then
    raise exception 'lost-response retry was not idempotent';
  end if;
end
$$;

do $$
declare
  stale jsonb;
begin
  stale := public.dave_commit_project_cover_photo(
    '11111111-1111-4111-8111-111111111111',
    'Shared Project',
    null,
    'automatic',
    null,
    null,
    'automatic',
    '2026-08-11T16:01:00.000Z'
  );
  if stale ->> 'status' <> 'conflict' then
    raise exception 'stale predecessor did not conflict';
  end if;
  if (
    select project_data #>> '{coverPhoto,contentSha256}'
    from public.projects
    where id = '11111111-1111-4111-8111-111111111111'
  ) <> repeat('a', 64) then
    raise exception 'stale predecessor changed committed cover';
  end if;
end
$$;

grant update on public.projects to authenticated;
set role authenticated;
do $$
begin
  begin
    update public.projects
    set project_data = jsonb_set(project_data, '{coverPhotoUpdatedAt}', '"2026-08-11T16:02:00.000Z"')
    where id = '11111111-1111-4111-8111-111111111111';
    raise exception 'direct cover mutation bypassed atomic authority';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
reset role;

grant usage on schema storage to authenticated;
grant select, update, delete on storage.objects to authenticated;
grant select on public.projects to authenticated;
set role authenticated;
do $$
declare
  affected integer;
begin
  update storage.objects
  set user_metadata = jsonb_set(user_metadata, '{forged}', 'true'::jsonb)
  where name =
    'project-covers/11111111-1111-4111-8111-111111111111/revisions/33333333-3333-4333-8333-333333333333.jpg';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'committed immutable cover bytes remained replaceable';
  end if;

  delete from storage.objects
  where name =
    'project-covers/11111111-1111-4111-8111-111111111111/revisions/33333333-3333-4333-8333-333333333333.jpg';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'referenced committed cover remained deletable';
  end if;
end
$$;
reset role;

do $$
begin
  if has_function_privilege(
    'anon',
    'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)',
    'EXECUTE'
  ) then raise exception 'anon can execute cover commit RPC'; end if;
  if not has_function_privilege(
    'authenticated',
    'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)',
    'EXECUTE'
  ) then raise exception 'authenticated cannot execute cover commit RPC'; end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in ('project_photos_owner_update', 'project_photos_owner_delete')
  ) then raise exception 'legacy project-cover mutation policy survived'; end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'project_photos_authenticated_update'
      and cmd = 'UPDATE'
      and qual like '%!~%revisions%'
      and with_check like '%!~%revisions%'
  ) then raise exception 'immutable cover update policy is unsafe'; end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'project_photos_authenticated_delete'
      and cmd = 'DELETE'
      and qual like '%NOT (EXISTS%coverPhoto%remotePath%'
  ) then raise exception 'committed cover delete policy is unsafe'; end if;
end
$$;
