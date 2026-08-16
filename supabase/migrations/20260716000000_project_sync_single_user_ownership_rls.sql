-- Fail-closed ownership boundary for the legacy project sync tables and
-- storage buckets. This app is currently single-user. The migration resolves
-- that one owner from existing owned project evidence; if no owned evidence
-- exists, it only proceeds when auth.users contains exactly one account.
-- Ambiguous ownership aborts the migration rather than guessing.

begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists app_private.dave_app_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  configured_at timestamptz not null default now()
);

revoke all on table app_private.dave_app_owner
  from public, anon, authenticated;

create temporary table dave_owner_candidates (
  user_id uuid primary key
) on commit drop;

do $$
declare
  candidate_table_name text;
  uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
begin
  foreach candidate_table_name in array array[
    'projects',
    'project_updates',
    'project_areas',
    'schedule_items',
    'reference_documents'
  ]
  loop
    if to_regclass(format('public.%I', candidate_table_name)) is not null and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and columns.table_name = candidate_table_name
        and column_name = 'owner_id'
    ) then
      execute format(
        'insert into pg_temp.dave_owner_candidates (user_id)
         select distinct owner_id::text::uuid
         from public.%I
         where owner_id is not null
           and owner_id::text ~ %L
         on conflict do nothing',
        candidate_table_name,
        uuid_pattern
      );
    end if;
  end loop;

  foreach candidate_table_name in array array[
    'pie_evidence_records',
    'pie_photo_assets',
    'pie_vision_analysis_requests'
  ]
  loop
    if to_regclass(format('public.%I', candidate_table_name)) is not null and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and columns.table_name = candidate_table_name
        and column_name = 'organization_id'
    ) then
      execute format(
        'insert into pg_temp.dave_owner_candidates (user_id)
         select distinct organization_id::text::uuid
         from public.%I
         where organization_id is not null
           and organization_id::text ~ %L
         on conflict do nothing',
        candidate_table_name,
        uuid_pattern
      );
    end if;
  end loop;

  delete from pg_temp.dave_owner_candidates candidate
  where not exists (
    select 1 from auth.users account where account.id = candidate.user_id
  );

  if not exists (select 1 from pg_temp.dave_owner_candidates) then
    insert into pg_temp.dave_owner_candidates (user_id)
    select id from auth.users
    on conflict do nothing;
  end if;
end
$$;

do $$
declare
  target_owner uuid;
  candidate_count integer;
  table_name text;
  relation_id regclass;
  owner_attribute smallint;
  owner_is_uuid boolean;
  has_foreign_owner boolean;
  has_owner_fk boolean;
begin
  select count(*), min(user_id::text)::uuid
  into candidate_count, target_owner
  from pg_temp.dave_owner_candidates;

  if candidate_count <> 1 or target_owner is null then
    raise exception
      'DAVE ownership is ambiguous (% candidate accounts). Verify the production Auth UUID before applying this migration.',
      candidate_count;
  end if;

  insert into app_private.dave_app_owner (singleton, user_id)
  values (true, target_owner)
  on conflict (singleton) do update
    set user_id = excluded.user_id,
        configured_at = now();

  -- The existing Reality Model and Decision Ledger use the Layer 4
  -- organization boundary. Provision the same verified single owner so the
  -- live authority can persist instead of remaining permanently degraded.
  if to_regclass('public.organizations') is not null
     and to_regclass('public.organization_memberships') is not null then
    insert into public.organizations (id, name)
    values (target_owner::text, 'DAVE Workspace')
    on conflict (id) do nothing;

    insert into public.organization_memberships (
      user_id,
      organization_id,
      status,
      role
    )
    values (
      target_owner,
      target_owner::text,
      'active',
      'organization_admin'
    )
    on conflict (user_id, organization_id) do update
      set status = 'active',
          role = 'organization_admin',
          updated_at = now();
  end if;

  foreach table_name in array array[
    'projects',
    'project_updates',
    'project_areas',
    'schedule_items',
    'reference_documents'
  ]
  loop
    relation_id := to_regclass(format('public.%I', table_name));
    if relation_id is null then
      raise exception 'Required table public.% does not exist', table_name;
    end if;

    execute format('lock table public.%I in share row exclusive mode', table_name);
    execute format('alter table public.%I add column if not exists owner_id uuid', table_name);

    select attribute.attnum,
           attribute.atttypid = 'uuid'::regtype
      into owner_attribute, owner_is_uuid
      from pg_attribute attribute
      where attribute.attrelid = relation_id
        and attribute.attname = 'owner_id'
        and not attribute.attisdropped;

    if not coalesce(owner_is_uuid, false) then
      raise exception 'public.%.owner_id must be uuid', table_name;
    end if;

    execute format(
      'select exists (
         select 1 from public.%I
         where owner_id is not null and owner_id <> $1
       )',
      table_name
    ) into has_foreign_owner using target_owner;

    if has_foreign_owner then
      raise exception
        'public.% contains rows owned by another account; inspect before deployment',
        table_name;
    end if;

    execute format(
      'update public.%I set owner_id = $1 where owner_id is null',
      table_name
    ) using target_owner;
    execute format(
      'alter table public.%I alter column owner_id set default auth.uid()',
      table_name
    );
    execute format(
      'alter table public.%I alter column owner_id set not null',
      table_name
    );
    execute format(
      'create index if not exists %I on public.%I (owner_id)',
      table_name || '_owner_id_idx',
      table_name
    );

    select exists (
      select 1
      from pg_constraint constraint_record
      where constraint_record.conrelid = relation_id
        and constraint_record.contype = 'f'
        and constraint_record.confrelid = 'auth.users'::regclass
        and constraint_record.conkey = array[owner_attribute]::smallint[]
    ) into has_owner_fk;

    if not has_owner_fk then
      execute format(
        'alter table public.%I
           add constraint %I
           foreign key (owner_id) references auth.users(id)
           on delete restrict not valid',
        table_name,
        table_name || '_owner_id_fkey'
      );
      execute format(
        'alter table public.%I validate constraint %I',
        table_name,
        table_name || '_owner_id_fkey'
      );
    end if;
  end loop;
end
$$;

create or replace function public.dave_is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.dave_app_owner principal
    where principal.singleton
      and principal.user_id = (select auth.uid())
  );
$$;

revoke all on function public.dave_is_app_owner() from public, anon;
grant execute on function public.dave_is_app_owner() to authenticated;

do $$
declare
  table_name text;
  policy_record record;
begin
  for policy_record in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'projects',
        'project_updates',
        'project_areas',
        'schedule_items',
        'reference_documents'
      ])
  loop
    execute format(
      'drop policy %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;

  foreach table_name in array array[
    'projects',
    'project_updates',
    'project_areas',
    'schedule_items',
    'reference_documents'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon', table_name);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      table_name
    );

    execute format(
      'create policy %I on public.%I for select to authenticated
       using ((select public.dave_is_app_owner()) and owner_id = (select auth.uid()))',
      table_name || '_owner_select', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated
       with check ((select public.dave_is_app_owner()) and owner_id = (select auth.uid()))',
      table_name || '_owner_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated
       using ((select public.dave_is_app_owner()) and owner_id = (select auth.uid()))
       with check ((select public.dave_is_app_owner()) and owner_id = (select auth.uid()))',
      table_name || '_owner_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated
       using ((select public.dave_is_app_owner()) and owner_id = (select auth.uid()))',
      table_name || '_owner_delete', table_name
    );
  end loop;
end
$$;

insert into storage.buckets (id, name, public)
values
  ('project-photos', 'project-photos', false),
  ('project-documents', 'project-documents', false)
on conflict (id) do update set public = false;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select distinct policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        policyname like 'project_photos_%'
        or policyname like 'project_documents_%'
        or coalesce(qual, '') ilike '%project-photos%'
        or coalesce(qual, '') ilike '%project-documents%'
        or coalesce(with_check, '') ilike '%project-photos%'
        or coalesce(with_check, '') ilike '%project-documents%'
      )
  loop
    execute format('drop policy %I on storage.objects', policy_record.policyname);
  end loop;
end
$$;

create policy project_photos_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'project-photos' and (select public.dave_is_app_owner()));
create policy project_photos_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-photos' and (select public.dave_is_app_owner()));
create policy project_photos_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'project-photos' and (select public.dave_is_app_owner()))
  with check (bucket_id = 'project-photos' and (select public.dave_is_app_owner()));
create policy project_photos_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-photos' and (select public.dave_is_app_owner()));

create policy project_documents_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'project-documents' and (select public.dave_is_app_owner()));
create policy project_documents_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-documents' and (select public.dave_is_app_owner()));
create policy project_documents_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'project-documents' and (select public.dave_is_app_owner()))
  with check (bucket_id = 'project-documents' and (select public.dave_is_app_owner()));
create policy project_documents_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-documents' and (select public.dave_is_app_owner()));

commit;
