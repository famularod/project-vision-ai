begin;

create extension if not exists pgcrypto;

create table if not exists public.ecos_project_evidence_snapshots (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null check (schema_version = 'ecos-project-evidence-snapshot/1.0'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null check (length(trim(project_id)) between 1 and 500),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  consistency text not null check (consistency in ('stable_read', 'best_effort_non_atomic')),
  source_counts jsonb not null check (jsonb_typeof(source_counts) = 'object'),
  source_versions jsonb not null check (jsonb_typeof(source_versions) = 'object'),
  unavailable_channels text[] not null default '{}',
  limitations text[] not null default '{}',
  captured_at timestamptz not null default now()
);

create table if not exists public.ecos_question_evidence_dossiers (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null check (schema_version = 'ecos-evidence-dossier/1.0'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null check (length(trim(project_id)) between 1 and 500),
  evidence_snapshot_id uuid not null references public.ecos_project_evidence_snapshots(id) on delete cascade,
  question_sha256 text not null check (question_sha256 ~ '^[a-f0-9]{64}$'),
  dossier_sha256 text not null check (dossier_sha256 ~ '^[a-f0-9]{64}$'),
  retrieval_contract text not null,
  assurance_contract text not null,
  candidate_count integer not null check (candidate_count >= 0),
  selected_count integer not null check (selected_count >= 0 and selected_count <= candidate_count),
  selected_source_hashes text[] not null default '{}',
  conflict_codes text[] not null default '{}',
  limitation_codes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.ecos_question_diagnostic_traces (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null check (schema_version = 'ecos-question-trace/1.0'),
  trace_id uuid not null unique,
  client_request_id uuid not null,
  client_surface text not null check (client_surface in ('web', 'iphone', 'ipad', 'android', 'acceptance', 'shadow', 'unknown')),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null check (length(trim(project_id)) between 1 and 500),
  question_sha256 text not null check (question_sha256 ~ '^[a-f0-9]{64}$'),
  question_character_count integer not null check (question_character_count between 3 and 1000),
  request_contract text not null,
  runtime_identity jsonb not null check (jsonb_typeof(runtime_identity) = 'object'),
  stage_durations_ms jsonb not null check (jsonb_typeof(stage_durations_ms) = 'object'),
  source_counts jsonb not null check (jsonb_typeof(source_counts) = 'object'),
  evidence_snapshot_id uuid references public.ecos_project_evidence_snapshots(id) on delete set null,
  evidence_dossier_id uuid references public.ecos_question_evidence_dossiers(id) on delete set null,
  outcome text not null check (outcome in ('verified', 'verified_with_limits', 'insufficient_evidence', 'replayed', 'failed')),
  failure_stage text,
  error_code text,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (completed_at >= started_at)
);

create index if not exists ecos_project_evidence_snapshots_owner_project_created_idx
  on public.ecos_project_evidence_snapshots (owner_id, project_id, captured_at desc);
create index if not exists ecos_question_evidence_dossiers_owner_project_created_idx
  on public.ecos_question_evidence_dossiers (owner_id, project_id, created_at desc);
create index if not exists ecos_question_diagnostic_traces_owner_project_created_idx
  on public.ecos_question_diagnostic_traces (owner_id, project_id, created_at desc);
create index if not exists ecos_question_diagnostic_traces_client_request_idx
  on public.ecos_question_diagnostic_traces (owner_id, client_request_id, created_at desc);

alter table public.ecos_project_evidence_snapshots enable row level security;
alter table public.ecos_project_evidence_snapshots force row level security;
alter table public.ecos_question_evidence_dossiers enable row level security;
alter table public.ecos_question_evidence_dossiers force row level security;
alter table public.ecos_question_diagnostic_traces enable row level security;
alter table public.ecos_question_diagnostic_traces force row level security;

revoke all on table public.ecos_project_evidence_snapshots from public, anon, authenticated;
revoke all on table public.ecos_question_evidence_dossiers from public, anon, authenticated;
revoke all on table public.ecos_question_diagnostic_traces from public, anon, authenticated;
grant select, insert, delete on table public.ecos_project_evidence_snapshots to service_role;
grant select, insert, delete on table public.ecos_question_evidence_dossiers to service_role;
grant select, insert, delete on table public.ecos_question_diagnostic_traces to service_role;

comment on table public.ecos_project_evidence_snapshots is
  'Private query-time receipts describing which project evidence channels were visible without storing source text.';
comment on table public.ecos_question_evidence_dossiers is
  'Private immutable evidence-selection receipts containing hashes and bounded decision metadata, never customer document text.';
comment on table public.ecos_question_diagnostic_traces is
  'Private per-request Ask ECOS diagnostic traces. Raw questions, answers, source excerpts, credentials, and model prompts are prohibited.';

create or replace function public.ecos_project_evidence_manifest_v1(
  p_project_id text,
  p_project_name text
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with authorized as (
    select 1
    where auth.uid() is not null
      and public.dave_is_app_owner()
      and length(btrim(coalesce(p_project_id, ''))) between 1 and 500
      and length(btrim(coalesce(p_project_name, ''))) between 1 and 500
      and exists (
        select 1
        from public.projects project
        where project.id::text = btrim(p_project_id)
          and lower(btrim(project.name)) = lower(btrim(p_project_name))
          and project.archived = false
      )
  ),
  project_rows as (
    select
      project.id::text as id,
      project.updated_at as version_at,
      encode(digest(convert_to(jsonb_build_object(
        'id', project.id,
        'name', project.name,
        'status', project.status,
        'projectData', project.project_data,
        'updatedAt', project.updated_at
      )::text, 'UTF8'), 'sha256'), 'hex') as row_sha256
    from public.projects project, authorized
    where project.id::text = btrim(p_project_id)
      and lower(btrim(project.name)) = lower(btrim(p_project_name))
      and project.archived = false
  ),
  schedule_rows as (
    select
      item.id::text as id,
      item.updated_at as version_at,
      encode(digest(convert_to(jsonb_build_object(
        'id', item.id,
        'projectName', item.project_name,
        'taskName', item.task_name,
        'itemData', item.item_data,
        'updatedAt', item.updated_at
      )::text, 'UTF8'), 'sha256'), 'hex') as row_sha256
    from public.schedule_items item, authorized
    where lower(btrim(coalesce(item.project_name, ''))) = lower(btrim(p_project_name))
      or lower(btrim(coalesce(item.item_data->>'projectName', ''))) = lower(btrim(p_project_name))
      or lower(btrim(coalesce(item.item_data->>'scheduleProjectName', ''))) = lower(btrim(p_project_name))
  ),
  update_rows as (
    select
      update_record.id::text as id,
      update_record.created_at as version_at,
      encode(digest(convert_to(jsonb_build_object(
        'id', update_record.id,
        'projectName', update_record.project_name,
        'updateData', update_record.update_data,
        'createdAt', update_record.created_at
      )::text, 'UTF8'), 'sha256'), 'hex') as row_sha256
    from public.project_updates update_record, authorized
    where lower(btrim(coalesce(update_record.project_name, ''))) = lower(btrim(p_project_name))
      or lower(btrim(coalesce(update_record.update_data->>'projectName', ''))) = lower(btrim(p_project_name))
      or lower(btrim(coalesce(update_record.update_data->>'scheduleProjectName', ''))) = lower(btrim(p_project_name))
  ),
  note_rows as (
    select
      note.id::text as id,
      note.updated_at as version_at,
      encode(digest(convert_to(jsonb_build_object(
        'id', note.id,
        'projectId', note.project_id,
        'projectName', note.project_name,
        'locationName', note.location_name,
        'originalText', note.original_text,
        'actionKind', note.action_kind,
        'actionText', note.action_text,
        'status', note.status,
        'updatedAt', note.updated_at
      )::text, 'UTF8'), 'sha256'), 'hex') as row_sha256
    from public.field_notes note, authorized
    where lower(btrim(coalesce(note.project_id, ''))) = lower(btrim(p_project_id))
      or lower(btrim(coalesce(note.project_name, ''))) = lower(btrim(p_project_name))
  ),
  document_rows as (
    select
      document.id::text as id,
      document.updated_at as version_at,
      encode(digest(convert_to(jsonb_build_object(
        'id', document.id,
        'name', document.name,
        'category', document.category,
        'documentData', document.document_data,
        'updatedAt', document.updated_at
      )::text, 'UTF8'), 'sha256'), 'hex') as row_sha256
    from public.reference_documents document, authorized
    where lower(btrim(coalesce(document.document_data->>'projectId', ''))) = lower(btrim(p_project_id))
      or lower(btrim(coalesce(document.document_data->>'projectName', ''))) = lower(btrim(p_project_name))
      or exists (
        select 1
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(document.document_data->'projectNames') = 'array'
              then document.document_data->'projectNames'
            else '[]'::jsonb
          end
        ) project_name(value)
        where lower(btrim(project_name.value)) = lower(btrim(p_project_name))
      )
  ),
  hosted_job_rows as (
    select
      job.id::text as id,
      job.updated_at as version_at,
      encode(digest(convert_to(jsonb_build_object(
        'id', job.id,
        'organizationId', job.organization_id,
        'projectId', job.project_id,
        'documentId', job.document_id,
        'sourceSha256', job.source_sha256,
        'sourceRevision', job.source_revision,
        'mode', job.mode,
        'state', job.state,
        'committedEvidenceVersion', job.committed_evidence_version,
        'readyAt', job.ready_at,
        'updatedAt', job.updated_at,
        'publicationMode', configuration.publication_mode,
        'publicationEnabled', configuration.enabled
      )::text, 'UTF8'), 'sha256'), 'hex') as row_sha256
    from public.ecos_hosted_index_jobs job
    join public.ecos_hosted_index_configuration configuration
      on configuration.organization_id = job.organization_id
    join authorized on true
    where job.document_id in (select document_rows.id from document_rows)
      and public.pie_layer4_has_active_membership(job.organization_id)
  ),
  payload as (
    select jsonb_build_object(
      'schemaVersion', 'ecos-project-evidence-manifest/1.0',
      'projectId', btrim(p_project_id),
      'projectName', btrim(p_project_name),
      'projects', coalesce((select jsonb_agg(row_sha256 order by id) from project_rows), '[]'::jsonb),
      'scheduleItems', coalesce((select jsonb_agg(row_sha256 order by id) from schedule_rows), '[]'::jsonb),
      'projectUpdates', coalesce((select jsonb_agg(row_sha256 order by id) from update_rows), '[]'::jsonb),
      'fieldNotes', coalesce((select jsonb_agg(row_sha256 order by id) from note_rows), '[]'::jsonb),
      'referenceDocuments', coalesce((select jsonb_agg(row_sha256 order by id) from document_rows), '[]'::jsonb),
      'hostedIndexJobs', coalesce((select jsonb_agg(row_sha256 order by id) from hosted_job_rows), '[]'::jsonb)
    ) as value
    from authorized
  )
  select jsonb_build_object(
    'schemaVersion', 'ecos-project-evidence-manifest/1.0',
    'snapshotSha256', encode(digest(convert_to(payload.value::text, 'UTF8'), 'sha256'), 'hex'),
    'capturedAt', statement_timestamp(),
    'sourceCounts', jsonb_build_object(
      'projects', (select count(*) from project_rows),
      'scheduleItems', (select count(*) from schedule_rows),
      'projectUpdates', (select count(*) from update_rows),
      'fieldNotes', (select count(*) from note_rows),
      'referenceDocuments', (select count(*) from document_rows),
      'hostedIndexJobs', (select count(*) from hosted_job_rows)
    ),
    'sourceVersions', jsonb_build_object(
      'projects', (select max(version_at) from project_rows),
      'scheduleItems', (select max(version_at) from schedule_rows),
      'projectUpdates', (select max(version_at) from update_rows),
      'fieldNotes', (select max(version_at) from note_rows),
      'referenceDocuments', (select max(version_at) from document_rows),
      'hostedIndexJobs', (select max(version_at) from hosted_job_rows)
    )
  )
  from payload;
$$;

revoke all on function public.ecos_project_evidence_manifest_v1(text, text)
  from public, anon;
grant execute on function public.ecos_project_evidence_manifest_v1(text, text)
  to authenticated;

commit;
