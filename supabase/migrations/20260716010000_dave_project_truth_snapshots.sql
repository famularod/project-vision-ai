-- Append-only, versioned Project Truth snapshots for the verified DAVE owner.
-- Depends on 20260716000000_project_sync_single_user_ownership_rls.sql.

begin;

create table if not exists public.dave_project_truth_snapshots (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  project_name text not null,
  revision integer not null check (revision > 0),
  source_fingerprint text not null,
  truth_schema_version text not null,
  generated_at timestamptz not null,
  saved_at timestamptz not null,
  created_at timestamptz not null default now(),
  snapshot jsonb not null,
  unique (owner_id, project_id, revision),
  unique (owner_id, project_id, source_fingerprint)
);

create index if not exists dave_project_truth_latest_idx
  on public.dave_project_truth_snapshots (owner_id, project_id, revision desc);

create or replace function public.dave_project_truth_prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'DAVE Project Truth history is append-only';
end;
$$;

drop trigger if exists dave_project_truth_no_update on public.dave_project_truth_snapshots;
create trigger dave_project_truth_no_update
before update on public.dave_project_truth_snapshots
for each row execute function public.dave_project_truth_prevent_mutation();

drop trigger if exists dave_project_truth_no_delete on public.dave_project_truth_snapshots;
create trigger dave_project_truth_no_delete
before delete on public.dave_project_truth_snapshots
for each row execute function public.dave_project_truth_prevent_mutation();

alter table public.dave_project_truth_snapshots enable row level security;
alter table public.dave_project_truth_snapshots force row level security;
revoke all on table public.dave_project_truth_snapshots from public, anon;
grant select, insert on table public.dave_project_truth_snapshots to authenticated;

drop policy if exists dave_project_truth_owner_select on public.dave_project_truth_snapshots;
create policy dave_project_truth_owner_select
  on public.dave_project_truth_snapshots
  for select to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
    and organization_id = (select auth.uid())::text
  );

drop policy if exists dave_project_truth_owner_insert on public.dave_project_truth_snapshots;
create policy dave_project_truth_owner_insert
  on public.dave_project_truth_snapshots
  for insert to authenticated
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
    and organization_id = (select auth.uid())::text
  );

commit;
