create table if not exists public.pie_photo_sequences (
  id text primary key,
  organization_id text not null,
  project_id text not null,
  reality_object_id text,
  stable_key text not null,
  project_name text not null,
  area_name text,
  subject text not null,
  approximate_viewpoint text not null,
  photo_ids jsonb not null default '[]'::jsonb,
  identity_confidence text not null check (identity_confidence in ('low', 'medium', 'high')),
  first_capture_date timestamptz,
  last_capture_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pie_photo_progress_events (
  id text primary key,
  organization_id text not null,
  project_id text not null,
  photo_sequence_id text not null references public.pie_photo_sequences(id),
  affected_reality_object_ids jsonb not null default '[]'::jsonb,
  earlier_photo_id text not null,
  later_photo_id text not null,
  observation text not null,
  inferred_meaning text not null,
  progress_category text not null,
  progress_direction text not null,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  comparability_score integer not null,
  corroborating_evidence_ids jsonb not null default '[]'::jsonb,
  contradicting_evidence_ids jsonb not null default '[]'::jsonb,
  verification_status text not null,
  review_status text not null,
  source_signature text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pie_photo_progress_conflicts (
  id text primary key,
  organization_id text not null,
  project_id text not null,
  event_id text not null references public.pie_photo_progress_events(id),
  conflict_type text not null,
  summary text not null,
  evidence_ids jsonb not null default '[]'::jsonb,
  review_required boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pie_photo_comparability_results (
  id text primary key,
  organization_id text not null,
  project_id text not null,
  earlier_photo_id text not null,
  later_photo_id text not null,
  classification text not null,
  score integer not null,
  reasons jsonb not null default '[]'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  normalization_operations jsonb not null default '[]'::jsonb,
  duplicate_detected boolean not null default false,
  input_signature text not null,
  created_at timestamptz not null default now()
);

alter table public.pie_photo_sequences enable row level security;
alter table public.pie_photo_progress_events enable row level security;
alter table public.pie_photo_progress_conflicts enable row level security;
alter table public.pie_photo_comparability_results enable row level security;

create index if not exists pie_photo_sequences_org_project_idx
  on public.pie_photo_sequences(organization_id, project_id);
create index if not exists pie_photo_progress_events_org_project_idx
  on public.pie_photo_progress_events(organization_id, project_id);
create index if not exists pie_photo_progress_conflicts_org_project_idx
  on public.pie_photo_progress_conflicts(organization_id, project_id);
create index if not exists pie_photo_comparability_results_org_project_idx
  on public.pie_photo_comparability_results(organization_id, project_id);

drop policy if exists pie_photo_sequences_membership_select on public.pie_photo_sequences;
create policy pie_photo_sequences_membership_select on public.pie_photo_sequences
  for select using (
    exists (
      select 1 from public.organization_memberships om
      where om.organization_id = pie_photo_sequences.organization_id
        and om.user_id = auth.uid()
        and om.status = 'active'
    )
  );

drop policy if exists pie_photo_sequences_member_insert on public.pie_photo_sequences;
create policy pie_photo_sequences_member_insert on public.pie_photo_sequences
  for insert
  with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_photo_sequences_member_update on public.pie_photo_sequences;
create policy pie_photo_sequences_member_update on public.pie_photo_sequences
  for update
  using (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'))
  with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_photo_progress_events_membership_select on public.pie_photo_progress_events;
create policy pie_photo_progress_events_membership_select on public.pie_photo_progress_events
  for select using (
    exists (
      select 1 from public.organization_memberships om
      where om.organization_id = pie_photo_progress_events.organization_id
        and om.user_id = auth.uid()
        and om.status = 'active'
    )
  );

drop policy if exists pie_photo_progress_events_member_insert on public.pie_photo_progress_events;
create policy pie_photo_progress_events_member_insert on public.pie_photo_progress_events
  for insert
  with check (
    public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history')
    and exists (
      select 1 from public.pie_photo_sequences sequence
      where sequence.id = photo_sequence_id
        and sequence.organization_id = organization_id
        and sequence.project_id = project_id
    )
  );

drop policy if exists pie_photo_progress_events_member_update on public.pie_photo_progress_events;
create policy pie_photo_progress_events_member_update on public.pie_photo_progress_events
  for update
  using (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'))
  with check (
    public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history')
    and exists (
      select 1 from public.pie_photo_sequences sequence
      where sequence.id = photo_sequence_id
        and sequence.organization_id = organization_id
        and sequence.project_id = project_id
    )
  );

drop policy if exists pie_photo_progress_conflicts_membership_select on public.pie_photo_progress_conflicts;
create policy pie_photo_progress_conflicts_membership_select on public.pie_photo_progress_conflicts
  for select using (
    exists (
      select 1 from public.organization_memberships om
      where om.organization_id = pie_photo_progress_conflicts.organization_id
        and om.user_id = auth.uid()
        and om.status = 'active'
    )
  );

drop policy if exists pie_photo_progress_conflicts_member_insert on public.pie_photo_progress_conflicts;
create policy pie_photo_progress_conflicts_member_insert on public.pie_photo_progress_conflicts
  for insert
  with check (
    public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history')
    and exists (
      select 1 from public.pie_photo_progress_events event
      where event.id = event_id
        and event.organization_id = organization_id
        and event.project_id = project_id
    )
  );

drop policy if exists pie_photo_progress_conflicts_member_update on public.pie_photo_progress_conflicts;
create policy pie_photo_progress_conflicts_member_update on public.pie_photo_progress_conflicts
  for update
  using (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'))
  with check (
    public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history')
    and exists (
      select 1 from public.pie_photo_progress_events event
      where event.id = event_id
        and event.organization_id = organization_id
        and event.project_id = project_id
    )
  );

drop policy if exists pie_photo_comparability_results_membership_select on public.pie_photo_comparability_results;
create policy pie_photo_comparability_results_membership_select on public.pie_photo_comparability_results
  for select using (
    exists (
      select 1 from public.organization_memberships om
      where om.organization_id = pie_photo_comparability_results.organization_id
        and om.user_id = auth.uid()
        and om.status = 'active'
    )
  );

drop policy if exists pie_photo_comparability_results_member_insert on public.pie_photo_comparability_results;
create policy pie_photo_comparability_results_member_insert on public.pie_photo_comparability_results
  for insert
  with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_photo_comparability_results_member_update on public.pie_photo_comparability_results;
create policy pie_photo_comparability_results_member_update on public.pie_photo_comparability_results
  for update
  using (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'))
  with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));
