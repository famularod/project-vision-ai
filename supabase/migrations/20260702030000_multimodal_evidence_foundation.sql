-- PIE multimodal evidence foundation.
-- Raw-pixel analysis is performed by server-side functions only. Mobile clients
-- store evidence records and read authorized results; provider secrets never
-- belong in the app bundle.

insert into storage.buckets (id, name, public)
values ('pie-project-evidence', 'pie-project-evidence', false)
on conflict (id) do update set public = false;

create table if not exists public.pie_evidence_records (
  id text primary key,
  organization_id text not null,
  project_id text not null,
  evidence_type text not null check (
    evidence_type in (
      'photo',
      'drawing',
      'schedule',
      'contract',
      'inspection_report',
      'email',
      'meeting_note',
      'cost_report',
      'equipment_reading',
      'oee_feed',
      'field_measurement'
    )
  ),
  source text not null,
  source_system text not null,
  captured_at timestamptz,
  effective_at timestamptz,
  received_at timestamptz not null default now(),
  author_id uuid,
  storage_refs jsonb not null default '[]'::jsonb,
  content_hash text not null,
  mime_type text not null,
  evidence_version integer not null default 1 check (evidence_version > 0),
  authority text not null check (
    authority in ('authoritative', 'corroborating', 'supporting', 'weak', 'unverified', 'superseded')
  ),
  processing_state text not null default 'queued' check (
    processing_state in ('not_started', 'queued', 'processing', 'succeeded', 'degraded', 'failed', 'blocked')
  ),
  analyzer_id text,
  analyzer_version text,
  lineage jsonb not null default '{"parentEvidenceIds":[],"derivedEvidenceIds":[],"analyzerRunIds":[],"correctionIds":[]}'::jsonb,
  superseded_by_evidence_id text references public.pie_evidence_records(id),
  associations jsonb not null default '[]'::jsonb,
  related_evidence_ids jsonb not null default '[]'::jsonb,
  automated_test_run_id text,
  hidden_from_normal_queries boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, project_id),
  unique (organization_id, project_id, content_hash, evidence_version)
);

create table if not exists public.pie_photo_assets (
  evidence_id text primary key references public.pie_evidence_records(id) on delete cascade,
  organization_id text not null,
  project_id text not null,
  original_storage_path text not null,
  analysis_derivative_path text,
  thumbnail_path text,
  content_hash text not null,
  duplicate_of_evidence_id text references public.pie_evidence_records(id),
  width integer,
  height integer,
  mime_type text not null,
  size_bytes bigint,
  capture_source text not null check (capture_source in ('camera', 'library', 'upload', 'import')),
  captured_at timestamptz,
  exif jsonb not null default '{}'::jsonb,
  analysis_status text not null default 'queued' check (
    analysis_status in ('not_started', 'queued', 'processing', 'succeeded', 'degraded', 'failed', 'blocked')
  ),
  current_analysis_version text,
  automated_test_run_id text,
  hidden_from_normal_queries boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pie_photo_assets_parent_boundary
    foreign key (evidence_id, organization_id, project_id)
    references public.pie_evidence_records(id, organization_id, project_id)
    on delete cascade
);

create table if not exists public.pie_evidence_analyses (
  id text primary key,
  evidence_id text not null references public.pie_evidence_records(id),
  organization_id text not null,
  project_id text not null,
  analysis_type text not null,
  analyzer_id text not null,
  analyzer_version text not null,
  provider_name text,
  model_name text,
  model_version text,
  prompt_version text,
  policy_version text not null,
  status text not null check (status in ('not_started', 'queued', 'processing', 'succeeded', 'degraded', 'failed', 'blocked')),
  observations jsonb not null default '[]'::jsonb,
  inferences jsonb not null default '[]'::jsonb,
  extracted_entities jsonb not null default '[]'::jsonb,
  dates jsonb not null default '[]'::jsonb,
  commitments jsonb not null default '[]'::jsonb,
  owners jsonb not null default '[]'::jsonb,
  measurements jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  limitations jsonb not null default '[]'::jsonb,
  authority text not null check (
    authority in ('visual_observation_only', 'document_extraction', 'reported_claim', 'authoritative_record', 'human_correction')
  ),
  corroboration_required boolean not null default true,
  visual_findings jsonb not null default '[]'::jsonb,
  unsafe_claims_rejected jsonb not null default '[]'::jsonb,
  raw_response jsonb,
  usage jsonb not null default '{}'::jsonb,
  automated_test_run_id text,
  hidden_from_normal_queries boolean not null default false,
  generated_at timestamptz not null default now(),
  unique (id, organization_id, project_id),
  constraint pie_evidence_analyses_parent_boundary
    foreign key (evidence_id, organization_id, project_id)
    references public.pie_evidence_records(id, organization_id, project_id)
    on delete cascade
);

create table if not exists public.pie_visual_jarvis_results (
  id text primary key,
  analysis_id text not null references public.pie_evidence_analyses(id),
  evidence_id text not null,
  organization_id text not null,
  project_id text not null,
  accepted boolean not null,
  outcome text not null check (
    outcome in ('supported', 'supported_with_limitations', 'needs_corroborating_evidence', 'human_review_required', 'blocked')
  ),
  rejected_claims jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  policy_version text not null,
  automated_test_run_id text,
  hidden_from_normal_queries boolean not null default false,
  created_at timestamptz not null default now(),
  constraint pie_visual_jarvis_analysis_boundary
    foreign key (analysis_id, organization_id, project_id)
    references public.pie_evidence_analyses(id, organization_id, project_id)
    on delete cascade
);

create table if not exists public.pie_evidence_corrections (
  id text primary key,
  evidence_id text not null references public.pie_evidence_records(id),
  organization_id text not null,
  project_id text not null,
  corrected_by_user_id uuid not null,
  reason text not null,
  original_analysis_id text references public.pie_evidence_analyses(id),
  supersedes_analysis_id text references public.pie_evidence_analyses(id),
  corrected_observations jsonb not null default '[]'::jsonb,
  corrected_inferences jsonb not null default '[]'::jsonb,
  automated_test_run_id text,
  hidden_from_normal_queries boolean not null default false,
  created_at timestamptz not null default now(),
  constraint pie_evidence_corrections_parent_boundary
    foreign key (evidence_id, organization_id, project_id)
    references public.pie_evidence_records(id, organization_id, project_id)
    on delete cascade
);

alter table public.pie_evidence_records enable row level security;
alter table public.pie_photo_assets enable row level security;
alter table public.pie_evidence_analyses enable row level security;
alter table public.pie_visual_jarvis_results enable row level security;
alter table public.pie_evidence_corrections enable row level security;

create index if not exists pie_evidence_records_org_project_idx
  on public.pie_evidence_records(organization_id, project_id);
create index if not exists pie_evidence_records_type_hash_idx
  on public.pie_evidence_records(evidence_type, content_hash);
create index if not exists pie_photo_assets_org_project_idx
  on public.pie_photo_assets(organization_id, project_id);
create index if not exists pie_evidence_analyses_org_project_idx
  on public.pie_evidence_analyses(organization_id, project_id);
create index if not exists pie_visual_jarvis_results_org_project_idx
  on public.pie_visual_jarvis_results(organization_id, project_id);
create index if not exists pie_evidence_corrections_org_project_idx
  on public.pie_evidence_corrections(organization_id, project_id);

drop policy if exists pie_evidence_records_member_select on public.pie_evidence_records;
create policy pie_evidence_records_member_select
  on public.pie_evidence_records
  for select
  using (
    not hidden_from_normal_queries
    and public.pie_layer4_has_permission(
      pie_evidence_records.organization_id,
      pie_evidence_records.project_id,
      'view_decision_history'
    )
  );

drop policy if exists pie_evidence_records_member_insert on public.pie_evidence_records;
create policy pie_evidence_records_member_insert
  on public.pie_evidence_records
  for insert
  with check (
    public.pie_layer4_has_permission(
      pie_evidence_records.organization_id,
      pie_evidence_records.project_id,
      'synchronize_decision_history'
    )
  );

drop policy if exists pie_evidence_records_member_update on public.pie_evidence_records;
create policy pie_evidence_records_member_update
  on public.pie_evidence_records
  for update
  using (
    public.pie_layer4_has_permission(
      pie_evidence_records.organization_id,
      pie_evidence_records.project_id,
      'synchronize_decision_history'
    )
  )
  with check (
    public.pie_layer4_has_permission(
      pie_evidence_records.organization_id,
      pie_evidence_records.project_id,
      'synchronize_decision_history'
    )
  );

drop policy if exists pie_photo_assets_member_select on public.pie_photo_assets;
create policy pie_photo_assets_member_select
  on public.pie_photo_assets
  for select
  using (
    not hidden_from_normal_queries
    and public.pie_layer4_has_permission(
      pie_photo_assets.organization_id,
      pie_photo_assets.project_id,
      'view_decision_history'
    )
  );

drop policy if exists pie_photo_assets_member_insert on public.pie_photo_assets;
create policy pie_photo_assets_member_insert
  on public.pie_photo_assets
  for insert
  with check (
    public.pie_layer4_has_permission(
      pie_photo_assets.organization_id,
      pie_photo_assets.project_id,
      'synchronize_decision_history'
    )
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
    public.pie_layer4_has_permission(
      pie_photo_assets.organization_id,
      pie_photo_assets.project_id,
      'synchronize_decision_history'
    )
  )
  with check (
    public.pie_layer4_has_permission(
      pie_photo_assets.organization_id,
      pie_photo_assets.project_id,
      'synchronize_decision_history'
    )
    and exists (
      select 1
      from public.pie_evidence_records as parent_evidence
      where parent_evidence.id = pie_photo_assets.evidence_id
        and parent_evidence.organization_id = pie_photo_assets.organization_id
        and parent_evidence.project_id = pie_photo_assets.project_id
        and parent_evidence.evidence_type = 'photo'
    )
  );

drop policy if exists pie_evidence_analyses_member_select on public.pie_evidence_analyses;
create policy pie_evidence_analyses_member_select
  on public.pie_evidence_analyses
  for select
  using (
    not hidden_from_normal_queries
    and public.pie_layer4_has_permission(
      pie_evidence_analyses.organization_id,
      pie_evidence_analyses.project_id,
      'view_decision_history'
    )
  );

drop policy if exists pie_evidence_analyses_member_insert on public.pie_evidence_analyses;
create policy pie_evidence_analyses_member_insert
  on public.pie_evidence_analyses
  for insert
  with check (
    public.pie_layer4_has_permission(
      pie_evidence_analyses.organization_id,
      pie_evidence_analyses.project_id,
      'synchronize_decision_history'
    )
    and exists (
      select 1
      from public.pie_evidence_records as parent_evidence
      where parent_evidence.id = pie_evidence_analyses.evidence_id
        and parent_evidence.organization_id = pie_evidence_analyses.organization_id
        and parent_evidence.project_id = pie_evidence_analyses.project_id
    )
  );

drop policy if exists pie_visual_jarvis_results_member_select on public.pie_visual_jarvis_results;
create policy pie_visual_jarvis_results_member_select
  on public.pie_visual_jarvis_results
  for select
  using (
    not hidden_from_normal_queries
    and public.pie_layer4_has_permission(
      pie_visual_jarvis_results.organization_id,
      pie_visual_jarvis_results.project_id,
      'view_decision_history'
    )
  );

drop policy if exists pie_visual_jarvis_results_member_insert on public.pie_visual_jarvis_results;
create policy pie_visual_jarvis_results_member_insert
  on public.pie_visual_jarvis_results
  for insert
  with check (
    public.pie_layer4_has_permission(
      pie_visual_jarvis_results.organization_id,
      pie_visual_jarvis_results.project_id,
      'synchronize_decision_history'
    )
    and exists (
      select 1
      from public.pie_evidence_analyses as parent_analysis
      where parent_analysis.id = pie_visual_jarvis_results.analysis_id
        and parent_analysis.organization_id = pie_visual_jarvis_results.organization_id
        and parent_analysis.project_id = pie_visual_jarvis_results.project_id
    )
  );

drop policy if exists pie_evidence_corrections_member_select on public.pie_evidence_corrections;
create policy pie_evidence_corrections_member_select
  on public.pie_evidence_corrections
  for select
  using (
    not hidden_from_normal_queries
    and public.pie_layer4_has_permission(
      pie_evidence_corrections.organization_id,
      pie_evidence_corrections.project_id,
      'view_decision_history'
    )
  );

drop policy if exists pie_evidence_corrections_member_insert on public.pie_evidence_corrections;
create policy pie_evidence_corrections_member_insert
  on public.pie_evidence_corrections
  for insert
  with check (
    public.pie_layer4_has_permission(
      pie_evidence_corrections.organization_id,
      pie_evidence_corrections.project_id,
      'synchronize_decision_history'
    )
    and exists (
      select 1
      from public.pie_evidence_records as parent_evidence
      where parent_evidence.id = pie_evidence_corrections.evidence_id
        and parent_evidence.organization_id = pie_evidence_corrections.organization_id
        and parent_evidence.project_id = pie_evidence_corrections.project_id
    )
  );

drop policy if exists pie_project_evidence_storage_select on storage.objects;
create policy pie_project_evidence_storage_select
  on storage.objects
  for select
  using (
    bucket_id = 'pie-project-evidence'
    and public.pie_layer4_has_permission(
      split_part(storage.objects.name, '/', 1),
      split_part(storage.objects.name, '/', 2),
      'view_decision_history'
    )
  );

drop policy if exists pie_project_evidence_storage_insert on storage.objects;
create policy pie_project_evidence_storage_insert
  on storage.objects
  for insert
  with check (
    bucket_id = 'pie-project-evidence'
    and public.pie_layer4_has_permission(
      split_part(storage.objects.name, '/', 1),
      split_part(storage.objects.name, '/', 2),
      'synchronize_decision_history'
    )
  );

drop policy if exists pie_project_evidence_storage_update on storage.objects;
create policy pie_project_evidence_storage_update
  on storage.objects
  for update
  using (
    bucket_id = 'pie-project-evidence'
    and public.pie_layer4_has_permission(
      split_part(storage.objects.name, '/', 1),
      split_part(storage.objects.name, '/', 2),
      'synchronize_decision_history'
    )
  )
  with check (
    bucket_id = 'pie-project-evidence'
    and public.pie_layer4_has_permission(
      split_part(storage.objects.name, '/', 1),
      split_part(storage.objects.name, '/', 2),
      'synchronize_decision_history'
    )
  );

create or replace function public.pie_cleanup_automated_evidence_test_records(
  test_run_id text
)
returns table(table_name text, deleted_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  return query
  with deleted_jarvis as (
    delete from public.pie_visual_jarvis_results
    where automated_test_run_id = test_run_id
      and hidden_from_normal_queries = true
    returning 1
  )
  select 'pie_visual_jarvis_results', count(*)::integer from deleted_jarvis;

  return query
  with deleted_corrections as (
    delete from public.pie_evidence_corrections
    where automated_test_run_id = test_run_id
      and hidden_from_normal_queries = true
    returning 1
  )
  select 'pie_evidence_corrections', count(*)::integer from deleted_corrections;

  return query
  with deleted_analyses as (
    delete from public.pie_evidence_analyses
    where automated_test_run_id = test_run_id
      and hidden_from_normal_queries = true
    returning 1
  )
  select 'pie_evidence_analyses', count(*)::integer from deleted_analyses;

  return query
  with deleted_assets as (
    delete from public.pie_photo_assets
    where automated_test_run_id = test_run_id
      and hidden_from_normal_queries = true
    returning 1
  )
  select 'pie_photo_assets', count(*)::integer from deleted_assets;

  return query
  with deleted_evidence as (
    delete from public.pie_evidence_records
    where automated_test_run_id = test_run_id
      and hidden_from_normal_queries = true
    returning 1
  )
  select 'pie_evidence_records', count(*)::integer from deleted_evidence;
end;
$$;

revoke all on function public.pie_cleanup_automated_evidence_test_records(text) from public;
grant execute on function public.pie_cleanup_automated_evidence_test_records(text) to service_role;

comment on function public.pie_cleanup_automated_evidence_test_records(text) is
  'Service-role-only cleanup for hidden automated evidence validation records. Does not weaken production immutability.';

comment on table public.pie_evidence_records is
  'Universal PIE evidence registry. Project authorization currently means organization authorization plus project identity and parent-child project consistency.';
