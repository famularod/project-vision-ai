-- Owner-scoped Field Notes cloud record for iPhone/iPad capture and desktop
-- review. Notes remain independent observations: this table does not create or
-- mutate projects, tasks, issues, or any other formal work record.

begin;

create table if not exists public.field_notes (
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  id text not null check (length(trim(id)) between 1 and 160),
  original_text text not null check (length(trim(original_text)) between 1 and 10000),
  source text not null check (source in ('typed', 'voice')),
  project_id text,
  project_name text,
  location_name text,
  action_kind text not null default 'none' check (
    action_kind in (
      'none',
      'follow_up',
      'task_candidate',
      'issue_candidate',
      'safety_candidate'
    )
  ),
  action_text text,
  status text not null default 'open' check (
    status in ('open', 'resolved', 'archived')
  ),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  archived_at timestamptz,
  primary key (owner_id, id),
  constraint field_notes_project_id_trimmed check (
    project_id is null or length(trim(project_id)) between 1 and 200
  ),
  constraint field_notes_project_name_trimmed check (
    project_name is null or length(trim(project_name)) between 1 and 500
  ),
  constraint field_notes_location_name_trimmed check (
    location_name is null or length(trim(location_name)) between 1 and 500
  ),
  constraint field_notes_action_text_consistent check (
    (action_kind = 'none' and action_text is null)
    or (
      action_kind <> 'none'
      and (action_text is null or length(trim(action_text)) between 1 and 2000)
    )
  ),
  constraint field_notes_status_timestamps_consistent check (
    (status = 'open' and resolved_at is null and archived_at is null)
    or (status = 'resolved' and resolved_at is not null and archived_at is null)
    or (status = 'archived' and archived_at is not null and resolved_at is null)
  )
);

create index if not exists field_notes_owner_status_created_idx
  on public.field_notes (owner_id, status, created_at desc);

create index if not exists field_notes_owner_updated_idx
  on public.field_notes (owner_id, updated_at desc);

alter table public.field_notes enable row level security;
alter table public.field_notes force row level security;

revoke all on table public.field_notes from public, anon;
grant select, insert, update on table public.field_notes to authenticated;

drop policy if exists field_notes_owner_select on public.field_notes;
create policy field_notes_owner_select
  on public.field_notes
  for select to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

drop policy if exists field_notes_owner_insert on public.field_notes;
create policy field_notes_owner_insert
  on public.field_notes
  for insert to authenticated
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

drop policy if exists field_notes_owner_update on public.field_notes;
create policy field_notes_owner_update
  on public.field_notes
  for update to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  )
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'Required publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'field_notes'
  ) then
    alter publication supabase_realtime add table public.field_notes;
  end if;
end
$$;

commit;
