-- Simplify the rest of the PIE photo-vision pipeline's RLS to a direct
-- single-user ownership check, same pattern as
-- 20260709000000_simplify_pie_evidence_single_user_rls.sql (which fixed
-- storage.objects / pie_evidence_records / pie_photo_assets).
--
-- Root cause (confirmed live): pie_photo_semantic_comparison_results_member_select
-- is still gated on public.pie_layer4_has_permission(org_id, project_id,
-- permission), which requires an active public.organization_memberships row
-- that has never existed for this account. The pie-photo-vision edge
-- function's writes to pie_vision_analysis_requests, pie_evidence_analyses,
-- pie_visual_jarvis_results, and pie_photo_semantic_comparison_results all use
-- a service-role client and bypass RLS, so those inserts always succeed --
-- but the mobile client's read-back query in PIEPhotoVisionMobileWorkflow.ts
-- (selecting the comparison result by request_id/baseline_evidence_id/
-- current_evidence_id right after invoking the edge function) uses the
-- regular authenticated user client, which RLS silently filtered to zero
-- rows. Symptom: edge function and vision provider both succeed, but the
-- mobile client reports "malformed_response" / "result not available on this
-- device yet", because it can save its own result but can't read it back.
--
-- Scope: every remaining table in the live photo-vision pipeline (written by
-- supabase/functions/pie-photo-vision/index.ts and/or read by
-- services/PIEPhotoVisionMobileWorkflow.ts) that was still gated by
-- pie_layer4_has_permission after the prior migration:
--   - pie_vision_analysis_requests (select/insert/update) -- written by the
--     edge function; not currently read directly by the mobile client, but
--     same broken pattern, fixed now rather than resurfacing later.
--   - pie_photo_semantic_comparison_results (select/insert) -- select is the
--     direct cause of today's symptom; insert isn't currently blocking
--     anything (service-role-only writer) but has the same broken pattern.
--   - pie_evidence_analyses (select/insert) -- written by the edge function
--     via persistRequestAndResult; not currently read directly by the mobile
--     client, fixed for the same reason as pie_vision_analysis_requests.
--   - pie_visual_jarvis_results (select/insert) -- same as pie_evidence_analyses.
--   - pie_evidence_corrections (select/insert) -- checked: this table is not
--     referenced anywhere in the mobile client or the pie-photo-vision edge
--     function today (grep confirmed zero hits in both). Not currently
--     load-bearing for anything, but fixed for consistency since it has the
--     identical broken pattern and lives in the same evidence chain as the
--     tables above.
--
-- Explicitly out of scope, left untouched: pie_photo_sequences,
-- pie_photo_progress_events, pie_photo_progress_conflicts,
-- pie_photo_comparability_results (a separate photo-intelligence subsystem;
-- grep confirmed zero references in the mobile client or this edge
-- function), and the Decision Ledger / Reality Model / Executive Judgment
-- tables (pie_decision_records, pie_reality_*, pie_executive_judgments,
-- organizations, organization_memberships) -- also confirmed untouched by
-- the mobile client or this edge function, and still governed by the
-- original organization_memberships model.
--
-- As before: this app is single-user with no team/org sharing, and
-- organizationId is always the signed-in user's own auth uid everywhere in
-- the mobile client, so a direct ownership check is the correct model here.
-- Parent-boundary integrity checks (exists (...) clauses verifying a child
-- row's org/project matches its parent row) are preserved verbatim on every
-- policy below -- only the membership check is replaced.

-- pie_vision_analysis_requests ---------------------------------------------

drop policy if exists pie_vision_analysis_requests_member_select on public.pie_vision_analysis_requests;
create policy pie_vision_analysis_requests_member_select
  on public.pie_vision_analysis_requests
  for select
  using (
    pie_vision_analysis_requests.organization_id = auth.uid()::text
  );

drop policy if exists pie_vision_analysis_requests_member_insert on public.pie_vision_analysis_requests;
create policy pie_vision_analysis_requests_member_insert
  on public.pie_vision_analysis_requests
  for insert
  with check (
    pie_vision_analysis_requests.organization_id = auth.uid()::text
  );

drop policy if exists pie_vision_analysis_requests_member_update on public.pie_vision_analysis_requests;
create policy pie_vision_analysis_requests_member_update
  on public.pie_vision_analysis_requests
  for update
  using (
    pie_vision_analysis_requests.organization_id = auth.uid()::text
  )
  with check (
    pie_vision_analysis_requests.organization_id = auth.uid()::text
  );

-- pie_photo_semantic_comparison_results -------------------------------------

drop policy if exists pie_photo_semantic_comparison_results_member_select on public.pie_photo_semantic_comparison_results;
create policy pie_photo_semantic_comparison_results_member_select
  on public.pie_photo_semantic_comparison_results
  for select
  using (
    pie_photo_semantic_comparison_results.organization_id = auth.uid()::text
  );

drop policy if exists pie_photo_semantic_comparison_results_member_insert on public.pie_photo_semantic_comparison_results;
create policy pie_photo_semantic_comparison_results_member_insert
  on public.pie_photo_semantic_comparison_results
  for insert
  with check (
    pie_photo_semantic_comparison_results.organization_id = auth.uid()::text
    and exists (
      select 1
      from public.pie_vision_analysis_requests as parent_request
      where parent_request.id = pie_photo_semantic_comparison_results.request_id
        and parent_request.organization_id = pie_photo_semantic_comparison_results.organization_id
        and parent_request.project_id = pie_photo_semantic_comparison_results.project_id
    )
    and exists (
      select 1
      from public.pie_evidence_records as baseline_evidence
      where baseline_evidence.id = pie_photo_semantic_comparison_results.baseline_evidence_id
        and baseline_evidence.organization_id = pie_photo_semantic_comparison_results.organization_id
        and baseline_evidence.project_id = pie_photo_semantic_comparison_results.project_id
    )
    and exists (
      select 1
      from public.pie_evidence_records as current_evidence
      where current_evidence.id = pie_photo_semantic_comparison_results.current_evidence_id
        and current_evidence.organization_id = pie_photo_semantic_comparison_results.organization_id
        and current_evidence.project_id = pie_photo_semantic_comparison_results.project_id
    )
  );

-- pie_evidence_analyses -------------------------------------------------

drop policy if exists pie_evidence_analyses_member_select on public.pie_evidence_analyses;
create policy pie_evidence_analyses_member_select
  on public.pie_evidence_analyses
  for select
  using (
    not hidden_from_normal_queries
    and pie_evidence_analyses.organization_id = auth.uid()::text
  );

drop policy if exists pie_evidence_analyses_member_insert on public.pie_evidence_analyses;
create policy pie_evidence_analyses_member_insert
  on public.pie_evidence_analyses
  for insert
  with check (
    pie_evidence_analyses.organization_id = auth.uid()::text
    and exists (
      select 1
      from public.pie_evidence_records as parent_evidence
      where parent_evidence.id = pie_evidence_analyses.evidence_id
        and parent_evidence.organization_id = pie_evidence_analyses.organization_id
        and parent_evidence.project_id = pie_evidence_analyses.project_id
    )
  );

-- pie_visual_jarvis_results -----------------------------------------------

drop policy if exists pie_visual_jarvis_results_member_select on public.pie_visual_jarvis_results;
create policy pie_visual_jarvis_results_member_select
  on public.pie_visual_jarvis_results
  for select
  using (
    not hidden_from_normal_queries
    and pie_visual_jarvis_results.organization_id = auth.uid()::text
  );

drop policy if exists pie_visual_jarvis_results_member_insert on public.pie_visual_jarvis_results;
create policy pie_visual_jarvis_results_member_insert
  on public.pie_visual_jarvis_results
  for insert
  with check (
    pie_visual_jarvis_results.organization_id = auth.uid()::text
    and exists (
      select 1
      from public.pie_evidence_analyses as parent_analysis
      where parent_analysis.id = pie_visual_jarvis_results.analysis_id
        and parent_analysis.organization_id = pie_visual_jarvis_results.organization_id
        and parent_analysis.project_id = pie_visual_jarvis_results.project_id
    )
  );

-- pie_evidence_corrections -------------------------------------------------
-- Not currently referenced by the mobile client or the pie-photo-vision edge
-- function (confirmed via grep) -- fixed for consistency, not because
-- anything is blocked on it today.

drop policy if exists pie_evidence_corrections_member_select on public.pie_evidence_corrections;
create policy pie_evidence_corrections_member_select
  on public.pie_evidence_corrections
  for select
  using (
    not hidden_from_normal_queries
    and pie_evidence_corrections.organization_id = auth.uid()::text
  );

drop policy if exists pie_evidence_corrections_member_insert on public.pie_evidence_corrections;
create policy pie_evidence_corrections_member_insert
  on public.pie_evidence_corrections
  for insert
  with check (
    pie_evidence_corrections.organization_id = auth.uid()::text
    and exists (
      select 1
      from public.pie_evidence_records as parent_evidence
      where parent_evidence.id = pie_evidence_corrections.evidence_id
        and parent_evidence.organization_id = pie_evidence_corrections.organization_id
        and parent_evidence.project_id = pie_evidence_corrections.project_id
    )
  );
