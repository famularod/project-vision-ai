-- Layer 4 trusted identity, organization isolation, RLS, and atomic decision sync.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  status text not null check (status in ('active', 'invited', 'suspended', 'removed')),
  role text not null check (role in (
    'member',
    'project_manager',
    'decision_owner',
    'validation_authority',
    'organization_admin'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, organization_id)
);

alter table public.pie_decision_audit_events
  add column if not exists automation jsonb;

create index if not exists organization_memberships_user_status_idx
  on public.organization_memberships (user_id, status, organization_id);

create index if not exists organization_memberships_org_role_idx
  on public.organization_memberships (organization_id, role, status);

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.pie_decision_records enable row level security;
alter table public.pie_decision_versions enable row level security;
alter table public.pie_decision_outcomes enable row level security;
alter table public.pie_decision_audit_events enable row level security;

create or replace function public.pie_layer4_role_has_permission(
  role_name text,
  permission_name text
)
returns boolean
language sql
immutable
as $$
  select case role_name
    when 'organization_admin' then permission_name in (
      'view_decision_history',
      'create_decision_candidate',
      'create_decision_snapshot',
      'approve_decision',
      'reject_decision',
      'defer_decision',
      'implement_decision',
      'cancel_decision',
      'record_outcome_plan',
      'record_implementation_assessment',
      'record_outcome',
      'validate_outcome',
      'dispute_outcome',
      'close_decision',
      'append_corrected_version',
      'append_decision_version',
      'synchronize_decision_history'
    )
    when 'validation_authority' then permission_name in (
      'view_decision_history',
      'record_outcome',
      'validate_outcome',
      'dispute_outcome',
      'close_decision',
      'append_corrected_version',
      'append_decision_version',
      'synchronize_decision_history'
    )
    when 'decision_owner' then permission_name in (
      'view_decision_history',
      'create_decision_candidate',
      'create_decision_snapshot',
      'approve_decision',
      'reject_decision',
      'defer_decision',
      'implement_decision',
      'cancel_decision',
      'record_outcome_plan',
      'record_implementation_assessment',
      'record_outcome',
      'close_decision',
      'append_corrected_version',
      'append_decision_version',
      'synchronize_decision_history'
    )
    when 'project_manager' then permission_name in (
      'view_decision_history',
      'create_decision_candidate',
      'create_decision_snapshot',
      'record_outcome_plan',
      'record_implementation_assessment',
      'record_outcome',
      'append_corrected_version',
      'append_decision_version',
      'synchronize_decision_history'
    )
    when 'member' then permission_name in ('view_decision_history')
    else false
  end;
$$;

create or replace function public.pie_layer4_has_active_membership(
  org_id text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.organization_memberships membership
      where membership.organization_id = org_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
  );
$$;

create or replace function public.pie_layer4_has_permission(
  org_id text,
  permission_name text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.organization_memberships membership
      where membership.organization_id = org_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and public.pie_layer4_role_has_permission(membership.role, permission_name)
  );
$$;

create or replace function public.pie_layer4_current_role(
  org_id text
)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select membership.role
    from public.organization_memberships membership
    where membership.organization_id = org_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
    limit 1;
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

  if exists (
    select 1 from public.pie_decision_versions
      where decision_id = new.decision_id
        and version = new.version
  ) then
    return new;
  end if;

  if new.version <> max_version + 1 then
    raise exception 'Layer 4 decision versions must be sequential append-only records';
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

create or replace function public.save_pie_decision_record_atomic(
  decision_payload jsonb,
  actor_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_user uuid := auth.uid();
  decision_record_id text := decision_payload ->> 'id';
  org_id text := decision_payload ->> 'organizationId';
  decision_project_id text := decision_payload ->> 'projectId';
  existing_record public.pie_decision_records%rowtype;
  version_payload jsonb;
  outcome_payload jsonb;
  audit_payload jsonb;
  server_record jsonb;
begin
  if auth_user is null then
    raise exception 'Layer 4 decision sync requires authenticated Supabase user';
  end if;

  if not public.pie_layer4_has_permission(org_id, 'synchronize_decision_history') then
    raise exception 'Layer 4 decision sync requires active organization membership with synchronize permission';
  end if;

  if actor_payload ->> 'id' <> auth_user::text then
    raise exception 'Layer 4 actor identity must match authenticated Supabase user';
  end if;

  if actor_payload ->> 'organizationId' <> org_id then
    raise exception 'Layer 4 actor organization must match decision organization';
  end if;

  if decision_record_id is null or org_id is null or decision_project_id is null then
    raise exception 'Layer 4 decision payload requires id, organizationId, and projectId';
  end if;

  select *
    into existing_record
    from public.pie_decision_records
    where id = decision_record_id
    for update;

  if found then
    if existing_record.organization_id <> org_id or existing_record.project_id <> decision_project_id then
      raise exception 'Layer 4 decision organization/project conflict';
    end if;

    if existing_record.immutable_snapshot is distinct from (decision_payload -> 'immutableSnapshot') then
      raise exception 'Layer 4 immutable snapshot conflict';
    end if;

    if existing_record.current_status = 'closed' and decision_payload ->> 'currentStatus' <> 'closed' then
      raise exception 'Stale offline data cannot reopen a closed decision';
    end if;

    update public.pie_decision_records
      set current_status = decision_payload ->> 'currentStatus',
          current_version = coalesce((decision_payload ->> 'currentVersion')::integer, existing_record.current_version),
          outcome_plan = decision_payload -> 'outcomePlan',
          implementation_assessment = decision_payload -> 'implementationAssessment',
          updated_at = coalesce((decision_payload ->> 'updatedAt')::timestamptz, now()),
          close_blockers = coalesce(decision_payload -> 'closeBlockers', '[]'::jsonb)
      where id = decision_record_id;
  else
    insert into public.pie_decision_records (
      id,
      organization_id,
      project_id,
      current_status,
      current_version,
      immutable_snapshot,
      outcome_plan,
      implementation_assessment,
      created_by,
      created_at,
      updated_at,
      close_blockers
    ) values (
      decision_record_id,
      org_id,
      decision_project_id,
      decision_payload ->> 'currentStatus',
      coalesce((decision_payload ->> 'currentVersion')::integer, 1),
      decision_payload -> 'immutableSnapshot',
      decision_payload -> 'outcomePlan',
      decision_payload -> 'implementationAssessment',
      decision_payload -> 'createdBy',
      coalesce((decision_payload ->> 'createdAt')::timestamptz, now()),
      coalesce((decision_payload ->> 'updatedAt')::timestamptz, now()),
      coalesce(decision_payload -> 'closeBlockers', '[]'::jsonb)
    );
  end if;

  for version_payload in
    select value from jsonb_array_elements(coalesce(decision_payload -> 'versions', '[]'::jsonb))
  loop
    if exists (
      select 1 from public.pie_decision_versions
      where public.pie_decision_versions.decision_id = decision_record_id
          and version = (version_payload ->> 'version')::integer
          and (
            snapshot is distinct from version_payload -> 'snapshot'
            or created_by is distinct from version_payload -> 'createdBy'
            or reason is distinct from version_payload ->> 'reason'
          )
    ) then
      raise exception 'Layer 4 decision version conflict';
    end if;

    insert into public.pie_decision_versions (
      decision_id,
      organization_id,
      project_id,
      version,
      snapshot,
      created_by,
      created_at,
      reason
    )
    select
      decision_record_id,
      org_id,
      decision_project_id,
      (version_payload ->> 'version')::integer,
      version_payload -> 'snapshot',
      version_payload -> 'createdBy',
      coalesce((version_payload ->> 'createdAt')::timestamptz, now()),
      version_payload ->> 'reason'
    where not exists (
      select 1 from public.pie_decision_versions
        where public.pie_decision_versions.decision_id = decision_record_id
          and version = (version_payload ->> 'version')::integer
    );
  end loop;

  for outcome_payload in
    select value from jsonb_array_elements(coalesce(decision_payload -> 'actualOutcomes', '[]'::jsonb))
  loop
    if outcome_payload ->> 'validationStatus' in ('human_validated', 'disputed') and
      not public.pie_layer4_has_permission(
        org_id,
        case
          when outcome_payload ->> 'validationStatus' = 'disputed'
            then 'dispute_outcome'
          else 'validate_outcome'
        end
      )
    then
      raise exception 'Layer 4 outcome validation requires validation authority';
    end if;

    if exists (
      select 1 from public.pie_decision_outcomes
        where id = outcome_payload ->> 'id'
          and (
            public.pie_decision_outcomes.decision_id <> decision_record_id
            or public.pie_decision_outcomes.organization_id <> org_id
            or public.pie_decision_outcomes.project_id <> decision_project_id
            or classification <> outcome_payload ->> 'classification'
            or summary <> outcome_payload ->> 'summary'
            or validation_status <> outcome_payload ->> 'validationStatus'
          )
    ) then
      raise exception 'Layer 4 outcome history conflict';
    end if;

    insert into public.pie_decision_outcomes (
      id,
      decision_id,
      organization_id,
      project_id,
      classification,
      summary,
      actual_results,
      measured_values,
      prediction_comparisons,
      evidence_references,
      unintended_consequences,
      confounding_factors,
      observation_period,
      validation_status,
      validator,
      validation_date,
      created_by,
      created_at
    )
    select
      outcome_payload ->> 'id',
      decision_record_id,
      org_id,
      decision_project_id,
      outcome_payload ->> 'classification',
      outcome_payload ->> 'summary',
      coalesce(outcome_payload -> 'actualResults', '[]'::jsonb),
      coalesce(outcome_payload -> 'measuredValues', '{}'::jsonb),
      coalesce(outcome_payload -> 'predictionComparisons', '[]'::jsonb),
      coalesce(outcome_payload -> 'evidenceReferences', '[]'::jsonb),
      coalesce(outcome_payload -> 'unintendedConsequences', '[]'::jsonb),
      coalesce(outcome_payload -> 'confoundingFactors', '[]'::jsonb),
      outcome_payload -> 'observationPeriod',
      outcome_payload ->> 'validationStatus',
      outcome_payload -> 'validator',
      nullif(outcome_payload ->> 'validationDate', '')::timestamptz,
      outcome_payload -> 'createdBy',
      coalesce((outcome_payload ->> 'createdAt')::timestamptz, now())
    where not exists (
      select 1 from public.pie_decision_outcomes
        where id = outcome_payload ->> 'id'
    );
  end loop;

  for audit_payload in
    select value from jsonb_array_elements(coalesce(decision_payload -> 'auditHistory', '[]'::jsonb))
  loop
    if exists (
      select 1 from public.pie_decision_audit_events
        where id = audit_payload ->> 'id'
          and (
            public.pie_decision_audit_events.decision_id <> decision_record_id
            or public.pie_decision_audit_events.organization_id <> org_id
            or public.pie_decision_audit_events.project_id <> decision_project_id
            or field <> audit_payload ->> 'field'
            or reason <> audit_payload ->> 'reason'
          )
    ) then
      raise exception 'Layer 4 audit history conflict';
    end if;

    insert into public.pie_decision_audit_events (
      id,
      decision_id,
      organization_id,
      project_id,
      field,
      previous_value,
      new_value,
      changed_by,
      reason,
      source,
      linked_evidence,
      automation,
      created_at
    )
    select
      audit_payload ->> 'id',
      decision_record_id,
      org_id,
      decision_project_id,
      audit_payload ->> 'field',
      audit_payload ->> 'previousValue',
      audit_payload ->> 'newValue',
      audit_payload -> 'changedBy',
      audit_payload ->> 'reason',
      audit_payload ->> 'source',
      coalesce(audit_payload -> 'linkedEvidence', '[]'::jsonb),
      audit_payload -> 'automation',
      coalesce((audit_payload ->> 'timestamp')::timestamptz, now())
    where not exists (
      select 1 from public.pie_decision_audit_events
        where id = audit_payload ->> 'id'
    );
  end loop;

  select jsonb_build_object(
    'id', record.id,
    'organizationId', record.organization_id,
    'projectId', record.project_id,
    'currentStatus', record.current_status,
    'currentVersion', record.current_version,
    'immutableSnapshot', record.immutable_snapshot,
    'outcomePlan', record.outcome_plan,
    'implementationAssessment', record.implementation_assessment,
    'createdBy', record.created_by,
    'createdAt', record.created_at,
    'updatedAt', record.updated_at,
    'closeBlockers', record.close_blockers,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'version', version,
        'snapshot', snapshot,
        'createdAt', created_at,
        'createdBy', created_by,
        'reason', reason
      ) order by version)
      from public.pie_decision_versions
      where decision_id = record.id
    ), '[]'::jsonb),
    'actualOutcomes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'decisionId', decision_id,
        'organizationId', organization_id,
        'projectId', project_id,
        'classification', classification,
        'summary', summary,
        'actualResults', actual_results,
        'measuredValues', measured_values,
        'predictionComparisons', prediction_comparisons,
        'evidenceReferences', evidence_references,
        'unintendedConsequences', unintended_consequences,
        'confoundingFactors', confounding_factors,
        'observationPeriod', observation_period,
        'validationStatus', validation_status,
        'validator', validator,
        'validationDate', validation_date,
        'createdAt', created_at,
        'createdBy', created_by
      ) order by created_at)
      from public.pie_decision_outcomes
      where decision_id = record.id
    ), '[]'::jsonb),
    'auditHistory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'decisionId', decision_id,
        'organizationId', organization_id,
        'projectId', project_id,
        'field', field,
        'previousValue', previous_value,
        'newValue', new_value,
        'timestamp', created_at,
        'changedBy', changed_by,
        'reason', reason,
        'source', source,
        'linkedEvidence', linked_evidence,
        'automation', automation
      ) order by created_at)
      from public.pie_decision_audit_events
      where decision_id = record.id
    ), '[]'::jsonb)
  )
    into server_record
    from public.pie_decision_records record
      where record.id = decision_record_id;

  return server_record;
end;
$$;

drop policy if exists organizations_member_read on public.organizations;
create policy organizations_member_read
on public.organizations
for select
using (public.pie_layer4_has_active_membership(id));

drop policy if exists organization_memberships_self_read on public.organization_memberships;
create policy organization_memberships_self_read
on public.organization_memberships
for select
using (
  user_id = auth.uid()
  or public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history')
);

drop policy if exists pie_decision_records_member_read on public.pie_decision_records;
create policy pie_decision_records_member_read
on public.pie_decision_records
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_decision_records_member_insert on public.pie_decision_records;
create policy pie_decision_records_member_insert
on public.pie_decision_records
for insert
with check (
  public.pie_layer4_has_permission(organization_id, 'create_decision_candidate')
  and immutable_snapshot ->> 'projectId' = project_id
);

drop policy if exists pie_decision_records_member_update on public.pie_decision_records;
create policy pie_decision_records_member_update
on public.pie_decision_records
for update
using (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'))
with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_decision_versions_member_read on public.pie_decision_versions;
create policy pie_decision_versions_member_read
on public.pie_decision_versions
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_decision_versions_member_insert on public.pie_decision_versions;
create policy pie_decision_versions_member_insert
on public.pie_decision_versions
for insert
with check (
  (
    public.pie_layer4_has_permission(organization_id, 'append_corrected_version')
    or public.pie_layer4_has_permission(organization_id, 'append_decision_version')
  )
  and exists (
    select 1
      from public.pie_decision_records record
      where record.id = decision_id
        and record.organization_id = organization_id
        and record.project_id = project_id
  )
);

drop policy if exists pie_decision_outcomes_member_read on public.pie_decision_outcomes;
create policy pie_decision_outcomes_member_read
on public.pie_decision_outcomes
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_decision_outcomes_member_insert on public.pie_decision_outcomes;
create policy pie_decision_outcomes_member_insert
on public.pie_decision_outcomes
for insert
with check (
  public.pie_layer4_has_permission(organization_id, 'record_outcome')
  and (
    validation_status not in ('human_validated', 'disputed')
    or (
      validation_status = 'human_validated'
      and public.pie_layer4_has_permission(organization_id, 'validate_outcome')
    )
    or (
      validation_status = 'disputed'
      and public.pie_layer4_has_permission(organization_id, 'dispute_outcome')
    )
  )
);

drop policy if exists pie_decision_audit_member_read on public.pie_decision_audit_events;
create policy pie_decision_audit_member_read
on public.pie_decision_audit_events
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_decision_audit_member_insert on public.pie_decision_audit_events;
create policy pie_decision_audit_member_insert
on public.pie_decision_audit_events
for insert
with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

comment on table public.organization_memberships is
  'Trusted organization membership model for PIE Layer 4 cloud decision history.';

comment on function public.save_pie_decision_record_atomic(jsonb, jsonb) is
  'Atomic Layer 4 decision-ledger sync transaction with authenticated membership, authorization, immutable history, and child boundary checks.';
