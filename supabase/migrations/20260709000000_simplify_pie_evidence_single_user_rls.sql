-- Simplify PIE photo-evidence RLS to a direct single-user ownership check.
--
-- Root cause: pie_project_evidence_storage_insert (and the equivalent insert
-- policies on pie_evidence_records / pie_photo_assets) gate on
-- public.pie_layer4_has_permission(org_id, project_id, permission), which
-- requires an active row in public.organization_memberships for the signed-in
-- user. Nothing in this codebase has ever created that row -- no signup
-- trigger, no seed data, no client-side write path, and organization_memberships
-- itself has no insert policy for regular users. Every mobile client photo
-- upload to the pie-project-evidence bucket has been rejected by RLS
-- ("new row violates row-level security policy") because of this, regardless
-- of area/project.
--
-- The mobile app always sets organizationId to the signed-in user's own auth
-- uid (services/PIEPhotoVisionMobileWorkflow.ts) -- there is no multi-user or
-- team sharing in this app, just a single account. Given that, these policies
-- are simplified to a direct ownership check (organization_id = auth.uid()::text)
-- instead of routing through the organization_memberships table. This matches
-- how the app actually assigns organization_id everywhere and removes the
-- dependency on a membership table that nothing provisions.
--
-- Scope: storage.objects policies for the pie-project-evidence bucket, and
-- the select/insert/update policies on pie_evidence_records and
-- pie_photo_assets (the two tables the mobile client writes evidence rows to
-- directly). Neither table nor the bucket has a delete policy today, so none
-- is added here. No other PIE tables (pie_evidence_analyses,
-- pie_visual_jarvis_results, pie_evidence_corrections, the Decision Ledger
-- tables, etc.) are touched -- they still use organization_memberships and
-- are out of scope for this change.

-- pie_evidence_records ---------------------------------------------------

drop policy if exists pie_evidence_records_member_select on public.pie_evidence_records;
create policy pie_evidence_records_member_select
  on public.pie_evidence_records
  for select
  using (
    not hidden_from_normal_queries
    and pie_evidence_records.organization_id = auth.uid()::text
  );

drop policy if exists pie_evidence_records_member_insert on public.pie_evidence_records;
create policy pie_evidence_records_member_insert
  on public.pie_evidence_records
  for insert
  with check (
    pie_evidence_records.organization_id = auth.uid()::text
  );

drop policy if exists pie_evidence_records_member_update on public.pie_evidence_records;
create policy pie_evidence_records_member_update
  on public.pie_evidence_records
  for update
  using (
    pie_evidence_records.organization_id = auth.uid()::text
  )
  with check (
    pie_evidence_records.organization_id = auth.uid()::text
  );

-- pie_photo_assets --------------------------------------------------------

drop policy if exists pie_photo_assets_member_select on public.pie_photo_assets;
create policy pie_photo_assets_member_select
  on public.pie_photo_assets
  for select
  using (
    not hidden_from_normal_queries
    and pie_photo_assets.organization_id = auth.uid()::text
  );

drop policy if exists pie_photo_assets_member_insert on public.pie_photo_assets;
create policy pie_photo_assets_member_insert
  on public.pie_photo_assets
  for insert
  with check (
    pie_photo_assets.organization_id = auth.uid()::text
    and exists (
      select 1
      from public.pie_evidence_records as parent_evidence
      where parent_evidence.id = pie_photo_assets.evidence_id
        and parent_evidence.organization_id = pie_photo_assets.organization_id
        and parent_evidence.project_id = pie_photo_assets.project_id
        and parent_evidence.evidence_type = 'photo'
    )
  );

drop policy if exists pie_photo_assets_member_update on public.pie_photo_assets;
create policy pie_photo_assets_member_update
  on public.pie_photo_assets
  for update
  using (
    pie_photo_assets.organization_id = auth.uid()::text
  )
  with check (
    pie_photo_assets.organization_id = auth.uid()::text
    and exists (
      select 1
      from public.pie_evidence_records as parent_evidence
      where parent_evidence.id = pie_photo_assets.evidence_id
        and parent_evidence.organization_id = pie_photo_assets.organization_id
        and parent_evidence.project_id = pie_photo_assets.project_id
        and parent_evidence.evidence_type = 'photo'
    )
  );

-- storage.objects (pie-project-evidence bucket) ---------------------------

drop policy if exists pie_project_evidence_storage_select on storage.objects;
create policy pie_project_evidence_storage_select
  on storage.objects
  for select
  using (
    bucket_id = 'pie-project-evidence'
    and split_part(storage.objects.name, '/', 1) = auth.uid()::text
  );

drop policy if exists pie_project_evidence_storage_insert on storage.objects;
create policy pie_project_evidence_storage_insert
  on storage.objects
  for insert
  with check (
    bucket_id = 'pie-project-evidence'
    and split_part(storage.objects.name, '/', 1) = auth.uid()::text
  );

drop policy if exists pie_project_evidence_storage_update on storage.objects;
create policy pie_project_evidence_storage_update
  on storage.objects
  for update
  using (
    bucket_id = 'pie-project-evidence'
    and split_part(storage.objects.name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'pie-project-evidence'
    and split_part(storage.objects.name, '/', 1) = auth.uid()::text
  );
