-- Durable deletion history for device-synchronized areas, schedule items,
-- and reference documents. Tombstones prevent a stale second device from
-- uploading or redisplaying a record that was deleted elsewhere.
-- Depends on 20260716000000_project_sync_single_user_ownership_rls.sql.

begin;

create table if not exists public.dave_sync_tombstones (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  entity_type text not null check (
    entity_type in ('project_area', 'schedule_item', 'reference_document')
  ),
  record_id text not null check (length(trim(record_id)) > 0),
  deleted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (owner_id, entity_type, record_id)
);

create index if not exists dave_sync_tombstones_recent_idx
  on public.dave_sync_tombstones (owner_id, deleted_at desc);

alter table public.dave_sync_tombstones enable row level security;
alter table public.dave_sync_tombstones force row level security;

revoke all on table public.dave_sync_tombstones from public, anon;
grant select, insert, update on table public.dave_sync_tombstones to authenticated;

drop policy if exists dave_sync_tombstones_owner_select
  on public.dave_sync_tombstones;
create policy dave_sync_tombstones_owner_select
  on public.dave_sync_tombstones
  for select to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

drop policy if exists dave_sync_tombstones_owner_insert
  on public.dave_sync_tombstones;
create policy dave_sync_tombstones_owner_insert
  on public.dave_sync_tombstones
  for insert to authenticated
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

drop policy if exists dave_sync_tombstones_owner_update
  on public.dave_sync_tombstones;
create policy dave_sync_tombstones_owner_update
  on public.dave_sync_tombstones
  for update to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  )
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

commit;
