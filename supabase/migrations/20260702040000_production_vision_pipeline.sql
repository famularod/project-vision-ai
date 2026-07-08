-- PIE production vision pipeline persistence.
-- Adds append-friendly request and comparison records without weakening the
-- existing evidence, JARVIS, or immutability protections.

create table if not exists public.pie_vision_analysis_requests (
  id text primary key,
  organization_id text not null,
  project_id text not null,
  mode text not null check (mode in ('single_photo', 'photo_pair')),
  evidence_id text references public.pie_evidence_records(id),
  baseline_evidence_id text references public.pie_evidence_records(id),
  current_evidence_id text references public.pie_evidence_records(id),
  analyzer_id text not null,
  analyzer_version text not null,
  policy_version text not null,
  prompt_version text not null,
  force_reanalysis boolean not null default false,
  status text not null check (status in ('not_started', 'queued', 'processing', 'succeeded', 'degraded', 'failed', 'blocked')),
  failure_reason text,
  latency_ms integer,
  attempt_count integer not null default 0,
  usage jsonb not null default '{}'::jsonb,
  deterministic_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, project_id),
  constraint pie_vision_single_photo_boundary
    check (
      (mode = 'single_photo' and evidence_id is not null and baseline_evidence_id is null and current_evidence_id is null)
      or
      (mode = 'photo_pair' and evidence_id is null and baseline_evidence_id is not null and current_evidence_id is not null)
    )
);

create table if not exists public.pie_photo_semantic_comparison_results (
  id text primary key,
  request_id text not null references public.pie_vision_analysis_requests(id),
  organization_id text not null,
  project_id text not null,
  baseline_evidence_id text not null references public.pie_evidence_records(id),
  current_evidence_id text not null references public.pie_evidence_records(id),
  same_scene_probability numeric not null default 0 check (same_scene_probability >= 0 and same_scene_probability <= 1),
  same_subject_probability numeric not null default 0 check (same_subject_probability >= 0 and same_subject_probability <= 1),
  viewpoint_assessment text not null,
  lighting_differences jsonb not null default '[]'::jsonb,
  obstruction_differences jsonb not null default '[]'::jsonb,
  object_additions jsonb not null default '[]'::jsonb,
  object_removals jsonb not null default '[]'::jsonb,
  material_or_structural_changes jsonb not null default '[]'::jsonb,
  unchanged_conditions jsonb not null default '[]'::jsonb,
  possible_regression jsonb not null default '[]'::jsonb,
  visible_concerns jsonb not null default '[]'::jsonb,
  comparability_classification text not null check (comparability_classification in ('strong', 'probable', 'weak', 'not_comparable')),
  conclusion text not null check (
    conclusion in (
      'progress_visible',
      'partial_progress_visible',
      'no_material_visible_change',
      'possible_regression',
      'unable_to_determine'
    )
  ),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  limitations jsonb not null default '[]'::jsonb,
  repeat_photo_guidance jsonb not null default '[]'::jsonb,
  deterministic_metrics jsonb not null default '{}'::jsonb,
  provider_response jsonb,
  jarvis_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint pie_photo_semantic_request_boundary
    foreign key (request_id, organization_id, project_id)
    references public.pie_vision_analysis_requests(id, organization_id, project_id),
  constraint pie_photo_semantic_baseline_boundary
    foreign key (baseline_evidence_id, organization_id, project_id)
    references public.pie_evidence_records(id, organization_id, project_id),
  constraint pie_photo_semantic_current_boundary
    foreign key (current_evidence_id, organization_id, project_id)
    references public.pie_evidence_records(id, organization_id, project_id)
);

alter table public.pie_vision_analysis_requests enable row level security;
alter table public.pie_photo_semantic_comparison_results enable row level security;

create unique index if not exists pie_vision_requests_org_project_id_idx
  on public.pie_vision_analysis_requests(id, organization_id, project_id);
create index if not exists pie_vision_requests_org_project_idx
  on public.pie_vision_analysis_requests(organization_id, project_id);
create index if not exists pie_photo_semantic_results_org_project_idx
  on public.pie_photo_semantic_comparison_results(organization_id, project_id);

drop policy if exists pie_vision_analysis_requests_member_select on public.pie_vision_analysis_requests;
create policy pie_vision_analysis_requests_member_select
  on public.pie_vision_analysis_requests
  for select
  using (
    public.pie_layer4_has_permission(
      pie_vision_analysis_requests.organization_id,
      pie_vision_analysis_requests.project_id,
      'view_decision_history'
    )
  );

drop policy if exists pie_vision_analysis_requests_member_insert on public.pie_vision_analysis_requests;
create policy pie_vision_analysis_requests_member_insert
  on public.pie_vision_analysis_requests
  for insert
  with check (
    public.pie_layer4_has_permission(
      pie_vision_analysis_requests.organization_id,
      pie_vision_analysis_requests.project_id,
      'synchronize_decision_history'
    )
  );

drop policy if exists pie_vision_analysis_requests_member_update on public.pie_vision_analysis_requests;
create policy pie_vision_analysis_requests_member_update
  on public.pie_vision_analysis_requests
  for update
  using (
    public.pie_layer4_has_permission(
      pie_vision_analysis_requests.organization_id,
      pie_vision_analysis_requests.project_id,
      'synchronize_decision_history'
    )
  )
  with check (
    public.pie_layer4_has_permission(
      pie_vision_analysis_requests.organization_id,
      pie_vision_analysis_requests.project_id,
      'synchronize_decision_history'
    )
  );

drop policy if exists pie_photo_semantic_comparison_results_member_select on public.pie_photo_semantic_comparison_results;
create policy pie_photo_semantic_comparison_results_member_select
  on public.pie_photo_semantic_comparison_results
  for select
  using (
    public.pie_layer4_has_permission(
      pie_photo_semantic_comparison_results.organization_id,
      pie_photo_semantic_comparison_results.project_id,
      'view_decision_history'
    )
  );

drop policy if exists pie_photo_semantic_comparison_results_member_insert on public.pie_photo_semantic_comparison_results;
create policy pie_photo_semantic_comparison_results_member_insert
  on public.pie_photo_semantic_comparison_results
  for insert
  with check (
    public.pie_layer4_has_permission(
      pie_photo_semantic_comparison_results.organization_id,
      pie_photo_semantic_comparison_results.project_id,
      'synchronize_decision_history'
    )
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

comment on table public.pie_vision_analysis_requests is
  'Provider-neutral production vision request log. Requests are idempotent by caller-provided id and scoped by organization/project.';

comment on table public.pie_photo_semantic_comparison_results is
  'Normalized production semantic photo-pair comparison results with deterministic metrics, provider response, and JARVIS result.';
