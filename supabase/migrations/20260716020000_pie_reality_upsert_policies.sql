-- The live Reality Model saves current-state rows with idempotent upserts.
-- The original migration granted INSERT but omitted UPDATE, so revision two
-- could be rejected even for the same verified organization owner.

begin;

drop policy if exists pie_reality_models_member_update on public.pie_reality_models;
create policy pie_reality_models_member_update
  on public.pie_reality_models for update to authenticated
  using (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'))
  with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_objects_member_update on public.pie_reality_objects;
create policy pie_reality_objects_member_update
  on public.pie_reality_objects for update to authenticated
  using (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'))
  with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_assertions_member_update on public.pie_reality_assertions;
create policy pie_reality_assertions_member_update
  on public.pie_reality_assertions for update to authenticated
  using (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'))
  with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_relationships_member_update on public.pie_reality_relationships;
create policy pie_reality_relationships_member_update
  on public.pie_reality_relationships for update to authenticated
  using (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'))
  with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_conflicts_member_update on public.pie_reality_conflicts;
create policy pie_reality_conflicts_member_update
  on public.pie_reality_conflicts for update to authenticated
  using (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'))
  with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

drop policy if exists pie_reality_uncertainties_member_update on public.pie_reality_uncertainties;
create policy pie_reality_uncertainties_member_update
  on public.pie_reality_uncertainties for update to authenticated
  using (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'))
  with check (public.pie_layer4_has_permission(organization_id, 'synchronize_decision_history'));

commit;
