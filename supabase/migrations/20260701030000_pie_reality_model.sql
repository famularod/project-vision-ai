-- Durable PIE Layer 2 Reality Model.

create table if not exists public.pie_reality_models (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  model_version integer not null,
  status text not null check (status in ('authoritative', 'synchronizing', 'needs_review', 'conflicted', 'stale')),
  created_at timestamptz not null default now(),
  generated_at timestamptz not null,
  last_synchronized_at timestamptz not null,
  source_evidence_cutoff_at timestamptz not null,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  readiness text not null check (readiness in ('Ready', 'Needs Verification', 'Uncertain', 'Blocked')),
  expected_future_state text not null,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  unique (organization_id, project_id, model_version)
);

create table if not exists public.pie_reality_objects (
  id text primary key,
  model_id text not null references public.pie_reality_models(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  stable_object_id text not null,
  object_type text not null,
  name text not null,
  description text not null,
  current_state jsonb not null default '{}'::jsonb,
  prior_state jsonb,
  expected_state jsonb,
  owner text,
  location text,
  area_name text,
  readiness text not null,
  risk text not null,
  confidence jsonb not null default '{}'::jsonb,
  next_best_action jsonb not null default '{}'::jsonb,
  source_evidence_references jsonb not null default '[]'::jsonb,
  last_observed_at timestamptz not null,
  last_changed_at timestamptz not null,
  last_updated_at timestamptz not null,
  unique (organization_id, project_id, stable_object_id)
);

create table if not exists public.pie_reality_assertions (
  id text primary key,
  object_id text not null references public.pie_reality_objects(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  statement text not null,
  classification text not null check (classification in ('fact', 'assumption', 'inference', 'prediction')),
  supporting_evidence_ids jsonb not null default '[]'::jsonb,
  contradicting_evidence_ids jsonb not null default '[]'::jsonb,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  source text not null,
  created_at timestamptz not null,
  last_reviewed_at timestamptz not null,
  review_at timestamptz,
  expires_at timestamptz,
  assumptions jsonb not null default '[]'::jsonb,
  expected_timeframe text,
  explanation text not null,
  check (classification <> 'fact' or jsonb_array_length(supporting_evidence_ids) > 0),
  check (classification <> 'inference' or length(explanation) > 0),
  check (classification <> 'prediction' or expected_timeframe is not null)
);

create table if not exists public.pie_reality_relationships (
  id text primary key,
  model_id text not null references public.pie_reality_models(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  source_object_id text not null references public.pie_reality_objects(id) on delete cascade,
  target_object_id text references public.pie_reality_objects(id) on delete cascade,
  relationship_type text not null,
  summary text not null,
  confidence text not null
);

create table if not exists public.pie_reality_object_history (
  id text primary key,
  object_id text not null references public.pie_reality_objects(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  occurred_at timestamptz not null,
  event_type text not null,
  summary text not null,
  previous_status text,
  next_status text not null
);

create table if not exists public.pie_reality_model_snapshots (
  id text primary key,
  model_id text not null references public.pie_reality_models(id) on delete cascade,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  model_version integer not null,
  created_at timestamptz not null default now(),
  source_evidence_cutoff_at timestamptz not null,
  reason text not null,
  snapshot jsonb not null,
  unique (organization_id, project_id, model_version)
);

create table if not exists public.pie_reality_conflicts (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  affected_object_ids jsonb not null default '[]'::jsonb,
  affected_assertion_ids jsonb not null default '[]'::jsonb,
  supporting_evidence_side_a jsonb not null default '[]'::jsonb,
  supporting_evidence_side_b jsonb not null default '[]'::jsonb,
  conflict_type text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  status text not null check (status in ('open', 'investigating', 'resolved', 'accepted_uncertainty', 'dismissed_with_reason')),
  resolution_owner text,
  recommended_next_evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  resolved_at timestamptz,
  resolution_explanation text
);

create table if not exists public.pie_reality_uncertainties (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null,
  affected_object_id text,
  affected_assertion_id text,
  description text not null,
  category text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  confidence_impact text not null check (confidence_impact in ('low', 'medium', 'high')),
  evidence_needed jsonb not null default '[]'::jsonb,
  likely_source_of_evidence text not null,
  owner text,
  review_at timestamptz,
  status text not null check (status in ('open', 'evidence_requested', 'accepted', 'resolved', 'dismissed')),
  created_at timestamptz not null
);

create index if not exists pie_reality_models_org_project_idx
  on public.pie_reality_models (organization_id, project_id, model_version desc);

create index if not exists pie_reality_objects_project_type_idx
  on public.pie_reality_objects (organization_id, project_id, object_type);

create index if not exists pie_reality_objects_state_owner_idx
  on public.pie_reality_objects (organization_id, project_id, owner, risk, last_updated_at desc);

create index if not exists pie_reality_conflicts_project_status_idx
  on public.pie_reality_conflicts (organization_id, project_id, status, severity);

create index if not exists pie_reality_uncertainties_project_status_idx
  on public.pie_reality_uncertainties (organization_id, project_id, status, severity);

alter table public.pie_reality_models enable row level security;
alter table public.pie_reality_objects enable row level security;
alter table public.pie_reality_assertions enable row level security;
alter table public.pie_reality_relationships enable row level security;
alter table public.pie_reality_object_history enable row level security;
alter table public.pie_reality_model_snapshots enable row level security;
alter table public.pie_reality_conflicts enable row level security;
alter table public.pie_reality_uncertainties enable row level security;

create or replace function public.pie_reality_prevent_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'PIE Reality Model history and snapshots are append-only';
end;
$$;

drop trigger if exists pie_reality_history_no_update on public.pie_reality_object_history;
create trigger pie_reality_history_no_update
before update on public.pie_reality_object_history
for each row execute function public.pie_reality_prevent_history_mutation();

drop trigger if exists pie_reality_history_no_delete on public.pie_reality_object_history;
create trigger pie_reality_history_no_delete
before delete on public.pie_reality_object_history
for each row execute function public.pie_reality_prevent_history_mutation();

drop trigger if exists pie_reality_snapshot_no_update on public.pie_reality_model_snapshots;
create trigger pie_reality_snapshot_no_update
before update on public.pie_reality_model_snapshots
for each row execute function public.pie_reality_prevent_history_mutation();

drop trigger if exists pie_reality_snapshot_no_delete on public.pie_reality_model_snapshots;
create trigger pie_reality_snapshot_no_delete
before delete on public.pie_reality_model_snapshots
for each row execute function public.pie_reality_prevent_history_mutation();

drop policy if exists pie_reality_models_member_read on public.pie_reality_models;
create policy pie_reality_models_member_read
on public.pie_reality_models
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_reality_models_member_write on public.pie_reality_models;
create policy pie_reality_models_member_write
on public.pie_reality_models
for insert
with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_objects_member_read on public.pie_reality_objects;
create policy pie_reality_objects_member_read
on public.pie_reality_objects
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_reality_objects_member_write on public.pie_reality_objects;
create policy pie_reality_objects_member_write
on public.pie_reality_objects
for insert
with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_assertions_member_read on public.pie_reality_assertions;
create policy pie_reality_assertions_member_read
on public.pie_reality_assertions
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_reality_assertions_member_write on public.pie_reality_assertions;
create policy pie_reality_assertions_member_write
on public.pie_reality_assertions
for insert
with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_relationships_member_read on public.pie_reality_relationships;
create policy pie_reality_relationships_member_read
on public.pie_reality_relationships
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_reality_relationships_member_write on public.pie_reality_relationships;
create policy pie_reality_relationships_member_write
on public.pie_reality_relationships
for insert
with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_append_member_read on public.pie_reality_model_snapshots;
create policy pie_reality_append_member_read
on public.pie_reality_model_snapshots
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_reality_append_member_write on public.pie_reality_model_snapshots;
create policy pie_reality_append_member_write
on public.pie_reality_model_snapshots
for insert
with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_history_member_read on public.pie_reality_object_history;
create policy pie_reality_history_member_read
on public.pie_reality_object_history
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_reality_history_member_write on public.pie_reality_object_history;
create policy pie_reality_history_member_write
on public.pie_reality_object_history
for insert
with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_conflicts_member_read on public.pie_reality_conflicts;
create policy pie_reality_conflicts_member_read
on public.pie_reality_conflicts
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_reality_conflicts_member_write on public.pie_reality_conflicts;
create policy pie_reality_conflicts_member_write
on public.pie_reality_conflicts
for insert
with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_uncertainties_member_read on public.pie_reality_uncertainties;
create policy pie_reality_uncertainties_member_read
on public.pie_reality_uncertainties
for select
using (public.pie_layer4_has_permission(organization_id, 'view_decision_history'));

drop policy if exists pie_reality_uncertainties_member_write on public.pie_reality_uncertainties;
create policy pie_reality_uncertainties_member_write
on public.pie_reality_uncertainties
for insert
with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

comment on table public.pie_reality_models is
  'Durable organization/project-scoped PIE Layer 2 Reality Model headers.';

comment on table public.pie_reality_model_snapshots is
  'Append-only immutable snapshots of synchronized Reality Model versions.';
