begin;

-- Protected validation needs a stable read identity without repeatedly hashing
-- the large source payload already represented by the exact hosted authority.
create or replace function public.ecos_project_shadow_evidence_manifest_v22(
  p_owner_id uuid,
  p_project_id text,
  p_project_name text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, extensions
as $$
  with authorized as materialized (
    select 1
    where coalesce(auth.jwt()->>'role', '') = 'service_role'
      and p_owner_id is not null
      and length(btrim(coalesce(p_project_id, ''))) between 1 and 500
      and length(btrim(coalesce(p_project_name, ''))) between 1 and 500
      and exists (
        select 1
        from public.projects project
        where project.owner_id = p_owner_id
          and project.id::text = btrim(p_project_id)
          and lower(btrim(project.name)) = lower(btrim(p_project_name))
          and project.archived = false
      )
  ),
  project_rows as materialized (
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
    where project.owner_id = p_owner_id
      and project.id::text = btrim(p_project_id)
      and lower(btrim(project.name)) = lower(btrim(p_project_name))
      and project.archived = false
  ),
  schedule_rows as materialized (
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
    where item.owner_id = p_owner_id
      and (
        lower(btrim(coalesce(item.project_name, ''))) = lower(btrim(p_project_name))
        or lower(btrim(coalesce(item.item_data->>'projectName', ''))) = lower(btrim(p_project_name))
        or lower(btrim(coalesce(item.item_data->>'scheduleProjectName', ''))) = lower(btrim(p_project_name))
      )
  ),
  update_rows as materialized (
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
    where update_record.owner_id = p_owner_id
      and (
        lower(btrim(coalesce(update_record.project_name, ''))) = lower(btrim(p_project_name))
        or lower(btrim(coalesce(update_record.update_data->>'projectName', ''))) = lower(btrim(p_project_name))
        or lower(btrim(coalesce(update_record.update_data->>'scheduleProjectName', ''))) = lower(btrim(p_project_name))
      )
  ),
  note_rows as materialized (
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
    where note.owner_id = p_owner_id
      and (
        lower(btrim(coalesce(note.project_id, ''))) = lower(btrim(p_project_id))
        or lower(btrim(coalesce(note.project_name, ''))) = lower(btrim(p_project_name))
      )
  ),
  document_rows as materialized (
    select
      source.id::text as id,
      greatest(source.updated_at, authority.document_updated_at) as version_at,
      encode(digest(convert_to(jsonb_build_object(
        'id', source.id,
        'name', source.name,
        'category', source.category,
        'projectId', authority.project_id,
        'sourceSha256', authority.source_sha256,
        'sourceRevision', authority.source_revision,
        'drawingStatus', authority.drawing_status,
        'documentUpdatedAt', authority.document_updated_at,
        'sourceUpdatedAt', source.updated_at
      )::text, 'UTF8'), 'sha256'), 'hex') as row_sha256
    from app_private.ecos_reference_document_authority authority
    join public.reference_documents source
      on source.id = authority.document_id
     and source.owner_id = authority.owner_id
    join authorized on true
    where authority.owner_id = p_owner_id
      and authority.project_id = btrim(p_project_id)
      and authority.is_current
      and authority.drawing_status is distinct from 'Superseded'
  ),
  hosted_job_rows as materialized (
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
    join document_rows document on document.id = job.document_id
    join authorized on true
    where job.source_owner_id = p_owner_id
      and job.project_id = btrim(p_project_id)
      and job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and public.pie_layer4_has_active_membership(job.organization_id)
  ),
  payload as materialized (
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

revoke all on function public.ecos_project_shadow_evidence_manifest_v22(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.ecos_project_shadow_evidence_manifest_v22(
  uuid, text, text
) to service_role;

commit;
