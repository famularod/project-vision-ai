-- Layer 4 decision ledger hardening.
-- This migration intentionally does not add permissive RLS policies.
-- The repository does not yet include a durable organization membership table,
-- so the four Layer 4 tables remain RLS fail-closed for ordinary clients until
-- public.organization_memberships or an equivalent membership source exists.

create or replace function public.pie_decision_prevent_history_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Layer 4 history is append-only and cannot be updated';
end;
$$;

create or replace function public.pie_decision_prevent_history_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Layer 4 history is append-only and cannot be deleted';
end;
$$;

create or replace function public.pie_decision_validate_child_boundary()
returns trigger
language plpgsql
as $$
declare
  parent_organization_id text;
  parent_project_id text;
begin
  select organization_id, project_id
    into parent_organization_id, parent_project_id
    from public.pie_decision_records
    where id = new.decision_id;

  if parent_organization_id is null then
    raise exception 'Decision parent record does not exist';
  end if;

  if new.organization_id <> parent_organization_id or new.project_id <> parent_project_id then
    raise exception 'Decision child organization/project boundary does not match parent decision';
  end if;

  return new;
end;
$$;

create or replace function public.pie_decision_prevent_snapshot_replace()
returns trigger
language plpgsql
as $$
begin
  if old.immutable_snapshot is distinct from new.immutable_snapshot then
    raise exception 'Original Layer 4 decision snapshot cannot be replaced';
  end if;

  if old.organization_id <> new.organization_id or old.project_id <> new.project_id then
    raise exception 'Layer 4 decision organization/project boundary cannot be changed';
  end if;

  if old.created_by is distinct from new.created_by or old.created_at <> new.created_at then
    raise exception 'Layer 4 decision creation identity cannot be changed';
  end if;

  return new;
end;
$$;

create or replace function public.pie_decision_validate_version_insert()
returns trigger
language plpgsql
as $$
declare
  parent_organization_id text;
  parent_project_id text;
  max_version integer;
begin
  select organization_id, project_id
    into parent_organization_id, parent_project_id
    from public.pie_decision_records
    where id = new.decision_id;

  if parent_organization_id is null then
    raise exception 'Decision parent record does not exist';
  end if;

  if new.organization_id <> parent_organization_id or new.project_id <> parent_project_id then
    raise exception 'Decision version organization/project boundary does not match parent decision';
  end if;

  select coalesce(max(version), 0)
    into max_version
    from public.pie_decision_versions
    where decision_id = new.decision_id;

  if new.version <> max_version + 1 then
    raise exception 'Layer 4 decision versions must be sequential append-only records';
  end if;

  return new;
end;
$$;

create or replace function public.save_pie_decision_record_atomic(
  decision_payload jsonb,
  actor_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.organization_memberships') is null then
    raise exception 'Layer 4 cloud persistence requires public.organization_memberships with active user organization roles before decision records can be trusted.';
  end if;

  raise exception 'Layer 4 atomic decision save is blocked until organization membership roles are finalized in this repository.';
end;
$$;

drop trigger if exists pie_decision_versions_no_update on public.pie_decision_versions;
create trigger pie_decision_versions_no_update
before update on public.pie_decision_versions
for each row execute function public.pie_decision_prevent_history_update();

drop trigger if exists pie_decision_versions_no_delete on public.pie_decision_versions;
create trigger pie_decision_versions_no_delete
before delete on public.pie_decision_versions
for each row execute function public.pie_decision_prevent_history_delete();

drop trigger if exists pie_decision_audit_no_update on public.pie_decision_audit_events;
create trigger pie_decision_audit_no_update
before update on public.pie_decision_audit_events
for each row execute function public.pie_decision_prevent_history_update();

drop trigger if exists pie_decision_audit_no_delete on public.pie_decision_audit_events;
create trigger pie_decision_audit_no_delete
before delete on public.pie_decision_audit_events
for each row execute function public.pie_decision_prevent_history_delete();

drop trigger if exists pie_decision_outcomes_no_update on public.pie_decision_outcomes;
create trigger pie_decision_outcomes_no_update
before update on public.pie_decision_outcomes
for each row execute function public.pie_decision_prevent_history_update();

drop trigger if exists pie_decision_outcomes_no_delete on public.pie_decision_outcomes;
create trigger pie_decision_outcomes_no_delete
before delete on public.pie_decision_outcomes
for each row execute function public.pie_decision_prevent_history_delete();

drop trigger if exists pie_decision_records_guard_snapshot on public.pie_decision_records;
create trigger pie_decision_records_guard_snapshot
before update on public.pie_decision_records
for each row execute function public.pie_decision_prevent_snapshot_replace();

drop trigger if exists pie_decision_versions_boundary on public.pie_decision_versions;
create trigger pie_decision_versions_boundary
before insert on public.pie_decision_versions
for each row execute function public.pie_decision_validate_version_insert();

drop trigger if exists pie_decision_outcomes_boundary on public.pie_decision_outcomes;
create trigger pie_decision_outcomes_boundary
before insert on public.pie_decision_outcomes
for each row execute function public.pie_decision_validate_child_boundary();

drop trigger if exists pie_decision_audit_boundary on public.pie_decision_audit_events;
create trigger pie_decision_audit_boundary
before insert on public.pie_decision_audit_events
for each row execute function public.pie_decision_validate_child_boundary();

comment on table public.pie_decision_records is
  'Layer 4 decision master records. RLS remains fail-closed until organization_memberships policies are added.';
comment on table public.pie_decision_versions is
  'Append-only Layer 4 decision snapshots.';
comment on table public.pie_decision_audit_events is
  'Append-only Layer 4 decision audit trail.';
comment on table public.pie_decision_outcomes is
  'Append-only Layer 4 observed outcome history.';
