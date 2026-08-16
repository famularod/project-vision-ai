\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create schema auth;

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
  created_at timestamptz not null default now()
);
create table public.project_updates (
  id uuid primary key,
  owner_id uuid not null,
  project_id text,
  project_name text not null
);
create table public.schedule_items (
  id uuid primary key,
  owner_id uuid not null,
  project_id text,
  project_name text not null
);
create table public.project_areas (
  id uuid primary key,
  owner_id uuid not null,
  area_data jsonb not null
);
create table public.reference_documents (
  id uuid primary key,
  owner_id uuid not null,
  document_data jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.dave_sync_tombstones (
  owner_id uuid not null,
  entity_type text not null,
  record_id text not null,
  deleted_at timestamptz not null,
  unique (owner_id, entity_type, record_id)
);
create table public.dave_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  entity_type text not null,
  record_id text not null,
  record_name text,
  deleted_at timestamptz not null,
  child_counts jsonb not null
);

create function public.dave_delete_project_atomically(p_project_name text)
returns jsonb
language sql
as $$ select jsonb_build_object('legacy', p_project_name) $$;
grant execute on function public.dave_delete_project_atomically(text)
  to anon, authenticated;

\ir ../../supabase/migrations/20260811021601_exact_project_delete_rpc.sql

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  false
);

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Shared Project'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'Shared Project');
insert into public.project_updates (id, owner_id, project_id, project_name) values
  ('aaaaaaaa-0001-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Shared Project'),
  ('bbbbbbbb-0001-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Shared Project');
insert into public.schedule_items (id, owner_id, project_id, project_name) values
  ('aaaaaaaa-0002-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Shared Project'),
  ('bbbbbbbb-0002-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Shared Project');
insert into public.project_areas (id, owner_id, area_data) values
  ('aaaaaaaa-0003-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '{"projectId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","projectName":"Shared Project"}'),
  ('bbbbbbbb-0003-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '{"projectId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","projectName":"Shared Project"}');
insert into public.reference_documents (id, owner_id, document_data) values
  ('aaaaaaaa-0004-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '{"projectId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","projectName":"Shared Project","projectNames":["Shared Project","Historical Alias"]}'),
  ('bbbbbbbb-0004-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '{"projectId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","projectName":"Shared Project","projectNames":["Shared Project"]}');

select public.dave_delete_project_atomically(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Shared Project'
);

do $$
begin
  if exists (
    select 1 from public.projects where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) then raise exception 'exact A project survived'; end if;
  if not exists (
    select 1 from public.projects where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) then raise exception 'same-name B project was deleted'; end if;
  if exists (
    select 1 from public.project_updates where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) then raise exception 'exact A update survived'; end if;
  if not exists (
    select 1 from public.project_updates where project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) then raise exception 'same-name B update was deleted'; end if;
  if exists (
    select 1 from public.schedule_items where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) then raise exception 'exact A schedule survived'; end if;
  if not exists (
    select 1 from public.schedule_items where project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) then raise exception 'same-name B schedule was deleted'; end if;
  if exists (
    select 1 from public.project_areas
    where area_data ->> 'projectId' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) then raise exception 'exact A area survived'; end if;
  if not exists (
    select 1 from public.project_areas
    where area_data ->> 'projectId' = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) then raise exception 'same-name B area was deleted'; end if;
  if exists (
    select 1 from public.reference_documents
    where document_data ->> 'projectId' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) then raise exception 'exact A document survived'; end if;
  if not exists (
    select 1 from public.reference_documents
    where document_data ->> 'projectId' = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) then raise exception 'same-name B document was deleted'; end if;
  if not exists (
    select 1 from public.dave_sync_tombstones
    where entity_type = 'project'
      and record_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) then raise exception 'exact A tombstone missing'; end if;
  if exists (
    select 1 from public.dave_sync_tombstones
    where entity_type = 'project' and record_id = lower('Shared Project')
  ) then raise exception 'display-name project tombstone was written'; end if;
end
$$;

do $$
declare
  retry_result jsonb;
begin
  retry_result := public.dave_delete_project_atomically(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Shared Project'
  );
  if retry_result ->> 'already_absent' <> 'true' then
    raise exception 'exact retry was not idempotent';
  end if;
end
$$;

insert into public.projects (id, owner_id, name) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', 'Legacy Project');
insert into public.project_updates (id, owner_id, project_id, project_name) values
  ('cccccccc-0001-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', null, 'Legacy Project');

do $$
begin
  begin
    perform public.dave_delete_project_atomically(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'Legacy Project'
    );
    raise exception 'name-only child did not block deletion';
  exception when check_violation then
    null;
  end;
  if not exists (
    select 1 from public.projects where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ) then raise exception 'blocked project delete partially committed'; end if;
  if exists (
    select 1 from public.dave_sync_tombstones
    where entity_type = 'project'
      and record_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ) then raise exception 'blocked project delete wrote a tombstone'; end if;
end
$$;

insert into public.projects (id, owner_id, name) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111', 'Renamed Project');

do $$
begin
  begin
    perform public.dave_delete_project_atomically(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'Old Project Name'
    );
    raise exception 'stale name did not fail the exact pair';
  exception when invalid_parameter_value then
    null;
  end;
  if not exists (
    select 1 from public.projects where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ) then raise exception 'stale-name attempt deleted the renamed project'; end if;
end
$$;

select public.dave_delete_project_atomically(
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'Renamed Project'
);

do $$
begin
  if to_regprocedure('public.dave_delete_project_atomically(text)') is not null then
    raise exception 'legacy one-argument RPC still exists';
  end if;
  if to_regprocedure('public.dave_delete_project_atomically(text,text)') is null then
    raise exception 'exact two-argument RPC is missing';
  end if;
  if has_function_privilege(
    'anon',
    'public.dave_delete_project_atomically(text,text)',
    'EXECUTE'
  ) then raise exception 'anon can execute exact deletion RPC'; end if;
  if not has_function_privilege(
    'authenticated',
    'public.dave_delete_project_atomically(text,text)',
    'EXECUTE'
  ) then raise exception 'authenticated cannot execute exact deletion RPC'; end if;
end
$$;
