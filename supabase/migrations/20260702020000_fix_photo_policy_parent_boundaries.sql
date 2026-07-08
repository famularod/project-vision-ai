-- Correct photo intelligence child-row boundary policies.
--
-- The original policies used inner aliases with unqualified child columns in
-- correlated subqueries. PostgreSQL can resolve those names to the inner row,
-- producing tautological checks such as event.organization_id = event.organization_id.
-- Recreate only the affected policies with explicit child-table references.

drop policy if exists pie_photo_progress_events_member_insert on public.pie_photo_progress_events;
create policy pie_photo_progress_events_member_insert on public.pie_photo_progress_events
  for insert
  with check (
    public.pie_layer4_has_permission(
      pie_photo_progress_events.organization_id,
      'synchronize_decision_history'
    )
    and exists (
      select 1
      from public.pie_photo_sequences as parent_sequence
      where parent_sequence.id = pie_photo_progress_events.photo_sequence_id
        and parent_sequence.organization_id = pie_photo_progress_events.organization_id
        and parent_sequence.project_id = pie_photo_progress_events.project_id
    )
  );

drop policy if exists pie_photo_progress_events_member_update on public.pie_photo_progress_events;
create policy pie_photo_progress_events_member_update on public.pie_photo_progress_events
  for update
  using (
    public.pie_layer4_has_permission(
      pie_photo_progress_events.organization_id,
      'synchronize_decision_history'
    )
    and exists (
      select 1
      from public.pie_photo_sequences as parent_sequence
      where parent_sequence.id = pie_photo_progress_events.photo_sequence_id
        and parent_sequence.organization_id = pie_photo_progress_events.organization_id
        and parent_sequence.project_id = pie_photo_progress_events.project_id
    )
  )
  with check (
    public.pie_layer4_has_permission(
      pie_photo_progress_events.organization_id,
      'synchronize_decision_history'
    )
    and exists (
      select 1
      from public.pie_photo_sequences as parent_sequence
      where parent_sequence.id = pie_photo_progress_events.photo_sequence_id
        and parent_sequence.organization_id = pie_photo_progress_events.organization_id
        and parent_sequence.project_id = pie_photo_progress_events.project_id
    )
  );

drop policy if exists pie_photo_progress_conflicts_member_insert on public.pie_photo_progress_conflicts;
create policy pie_photo_progress_conflicts_member_insert on public.pie_photo_progress_conflicts
  for insert
  with check (
    public.pie_layer4_has_permission(
      pie_photo_progress_conflicts.organization_id,
      'synchronize_decision_history'
    )
    and exists (
      select 1
      from public.pie_photo_progress_events as parent_event
      where parent_event.id = pie_photo_progress_conflicts.event_id
        and parent_event.organization_id = pie_photo_progress_conflicts.organization_id
        and parent_event.project_id = pie_photo_progress_conflicts.project_id
    )
  );

drop policy if exists pie_photo_progress_conflicts_member_update on public.pie_photo_progress_conflicts;
create policy pie_photo_progress_conflicts_member_update on public.pie_photo_progress_conflicts
  for update
  using (
    public.pie_layer4_has_permission(
      pie_photo_progress_conflicts.organization_id,
      'synchronize_decision_history'
    )
    and exists (
      select 1
      from public.pie_photo_progress_events as parent_event
      where parent_event.id = pie_photo_progress_conflicts.event_id
        and parent_event.organization_id = pie_photo_progress_conflicts.organization_id
        and parent_event.project_id = pie_photo_progress_conflicts.project_id
    )
  )
  with check (
    public.pie_layer4_has_permission(
      pie_photo_progress_conflicts.organization_id,
      'synchronize_decision_history'
    )
    and exists (
      select 1
      from public.pie_photo_progress_events as parent_event
      where parent_event.id = pie_photo_progress_conflicts.event_id
        and parent_event.organization_id = pie_photo_progress_conflicts.organization_id
        and parent_event.project_id = pie_photo_progress_conflicts.project_id
    )
  );

drop policy if exists pie_decision_versions_member_insert on public.pie_decision_versions;
create policy pie_decision_versions_member_insert
on public.pie_decision_versions
for insert
with check (
  (
    public.pie_layer4_has_permission(
      pie_decision_versions.organization_id,
      'append_corrected_version'
    )
    or public.pie_layer4_has_permission(
      pie_decision_versions.organization_id,
      'append_decision_version'
    )
  )
  and exists (
    select 1
    from public.pie_decision_records as parent_record
    where parent_record.id = pie_decision_versions.decision_id
      and parent_record.organization_id = pie_decision_versions.organization_id
      and parent_record.project_id = pie_decision_versions.project_id
  )
);

comment on policy pie_photo_progress_events_member_insert
  on public.pie_photo_progress_events is
  'Requires organization permission and a referenced photo sequence with the same organization_id and project_id as the event row.';

comment on policy pie_photo_progress_events_member_update
  on public.pie_photo_progress_events is
  'Requires organization permission and preserves the referenced sequence organization/project boundary.';

comment on policy pie_photo_progress_conflicts_member_insert
  on public.pie_photo_progress_conflicts is
  'Requires organization permission and a referenced progress event with the same organization_id and project_id as the conflict row.';

comment on policy pie_photo_progress_conflicts_member_update
  on public.pie_photo_progress_conflicts is
  'Requires organization permission and preserves the referenced event organization/project boundary.';

comment on policy pie_decision_versions_member_insert
  on public.pie_decision_versions is
  'Requires organization permission and a referenced decision record with the same organization_id and project_id as the version row.';
