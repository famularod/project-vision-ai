-- Owner answer Q16 (30 Sep 2026): "since the last report" is shared between
-- the owner's phone and iPad. One row per owner, project set (scope_key) and
-- report format holds the last approved report snapshot of that period. The
-- app reads it when Reports opens and writes it on approval and on send; until
-- this table exists each device keeps its own period, as before.
-- Depends on 20260716000000_project_sync_single_user_ownership_rls.sql
-- (public.dave_is_app_owner()).

begin;

create table if not exists public.report_snapshots (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  scope_key text not null check (length(trim(scope_key)) > 0),
  format text not null check (format in ('project_manager', 'executive')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  -- The approved report's as-of time (the app's "the report approved <date>").
  approved_at timestamptz not null,
  -- When the report this period runs from was sent. For an approval not yet
  -- sent, the send of the report it replaced; null before any send.
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner_id, scope_key, format)
);

alter table public.report_snapshots enable row level security;
alter table public.report_snapshots force row level security;

-- No deletes: the app only reads, inserts and updates its own rows.
revoke all on table public.report_snapshots from public, anon, authenticated;
grant select, insert, update on table public.report_snapshots to authenticated;

drop policy if exists report_snapshots_owner_select
  on public.report_snapshots;
create policy report_snapshots_owner_select
  on public.report_snapshots
  for select to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

drop policy if exists report_snapshots_owner_insert
  on public.report_snapshots;
create policy report_snapshots_owner_insert
  on public.report_snapshots
  for insert to authenticated
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

drop policy if exists report_snapshots_owner_update
  on public.report_snapshots;
create policy report_snapshots_owner_update
  on public.report_snapshots
  for update to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  )
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

-- The later sent report stays the period's start: a write from a device that
-- has not seen it yet, or that arrives after the send it preceded, is skipped.
-- A write with the same start (an approval not yet sent) replaces the row.
create or replace function public.report_snapshots_keep_later_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.delivered_at is not null
     and (new.delivered_at is null or new.delivered_at < old.delivered_at) then
    return null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.report_snapshots_keep_later_period()
  from public, anon, authenticated;

drop trigger if exists report_snapshots_keep_later_period
  on public.report_snapshots;
create trigger report_snapshots_keep_later_period
  before update on public.report_snapshots
  for each row execute function public.report_snapshots_keep_later_period();

commit;
