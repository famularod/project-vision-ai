-- Reapply the complete customer Ask ECOS proof and project-record contract in
-- one transaction after the protected source gateway passed its independent
-- package-identity repair. The immediately preceding migration records the
-- automatic rollback of the first staged attempt.

begin;

do $precondition$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regprocedure('public.dave_is_app_owner()') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.dave_is_app_owner()');
  end if;
  if to_regprocedure('public.ecos_hosted_job_matches_reference(uuid,boolean)') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.ecos_hosted_job_matches_reference(uuid,boolean)');
  end if;
  if to_regclass('public.projects') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.projects');
  end if;
  if to_regclass('public.schedule_items') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.schedule_items');
  end if;
  if to_regclass('public.project_updates') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.project_updates');
  end if;
  if to_regclass('public.field_notes') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.field_notes');
  end if;
  if to_regclass('public.ecos_hosted_index_jobs') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.ecos_hosted_index_jobs');
  end if;
  if to_regclass('public.ecos_hosted_index_pages') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.ecos_hosted_index_pages');
  end if;
  if to_regclass('app_private.ecos_reference_document_authority') is null then
    missing_dependencies := array_append(missing_dependencies, 'app_private.ecos_reference_document_authority');
  end if;
  if to_regclass('ecos_private.owner_source_executions') is null then
    missing_dependencies := array_append(missing_dependencies, 'ecos_private.owner_source_executions');
  end if;
  if to_regclass('ecos_private.owner_source_execution_bindings') is null then
    missing_dependencies := array_append(missing_dependencies, 'ecos_private.owner_source_execution_bindings');
  end if;
  if to_regclass('ecos_private.owner_page_observation_heads') is null then
    missing_dependencies := array_append(missing_dependencies, 'ecos_private.owner_page_observation_heads');
  end if;
  if to_regclass('ecos_private.owner_page_observation_attempts') is null then
    missing_dependencies := array_append(missing_dependencies, 'ecos_private.owner_page_observation_attempts');
  end if;
  if to_regclass('ecos_private.owner_page_raster_heads') is null then
    missing_dependencies := array_append(missing_dependencies, 'ecos_private.owner_page_raster_heads');
  end if;
  if to_regclass('ecos_private.owner_page_raster_receipts') is null then
    missing_dependencies := array_append(missing_dependencies, 'ecos_private.owner_page_raster_receipts');
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Ask ECOS customer proof dependencies are missing: %',
      array_to_string(missing_dependencies, ', ');
  end if;
end;
$precondition$;

drop function if exists public.dave_verify_current_ecos_document_proof(
  text, text, text, text, text, integer, text, text
);

create function public.dave_verify_current_ecos_document_proof(
  p_project_id text,
  p_document_id text,
  p_source_sha256 text,
  p_evidence_version text,
  p_revision text,
  p_page_number integer,
  p_sheet_number text default null,
  p_region_id text default null
)
returns table(
  document_id text,
  project_id text,
  source_sha256 text,
  evidence_version text,
  source_revision text,
  page_number integer,
  sheet_number text,
  region_id text,
  region_bounds jsonb,
  source_view_citation jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  current_actor uuid := auth.uid();
  requested_project_id text := nullif(btrim(coalesce(p_project_id, '')), '');
  requested_document_id text := nullif(btrim(coalesce(p_document_id, '')), '');
  requested_source_sha256 text := lower(nullif(btrim(coalesce(p_source_sha256, '')), ''));
  requested_evidence_version text := nullif(btrim(coalesce(p_evidence_version, '')), '');
  requested_revision text := nullif(btrim(coalesce(p_revision, '')), '');
  requested_sheet_number text := nullif(btrim(coalesce(p_sheet_number, '')), '');
  requested_region_id text := nullif(btrim(coalesce(p_region_id, '')), '');
begin
  if current_actor is null or not public.dave_is_app_owner() then
    raise exception 'Ask ECOS proof verification requires an authorized owner'
      using errcode = '42501';
  end if;
  if requested_project_id is null
      or requested_project_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
      or requested_document_id is null
      or length(requested_document_id) > 200
      or requested_source_sha256 !~ '^[0-9a-f]{64}$'
      or requested_evidence_version <> 'ecos-hosted-evidence/1.3'
      or requested_revision is null
      or length(requested_revision) > 200
      or length(coalesce(requested_sheet_number, '')) > 64
      or requested_region_id is null
      or length(requested_region_id) > 512
      or p_page_number is null
      or p_page_number not between 1 and 10000 then
    raise exception 'The Ask ECOS proof claim is invalid'
      using errcode = '22023';
  end if;

  return query
  with exact_job as materialized (
    select job.*
    from public.ecos_hosted_index_jobs job
    join app_private.ecos_reference_document_authority source
      on source.document_id = job.document_id
     and source.owner_id = current_actor
    join public.projects project_record
      on project_record.id::text = job.project_id
     and project_record.owner_id = current_actor
     and coalesce(project_record.archived, false) = false
    where job.project_id = requested_project_id
      and job.document_id = requested_document_id
      and job.source_sha256 = requested_source_sha256
      and job.source_revision = requested_revision
      and job.state = 'ready'
      and job.committed_evidence_version = requested_evidence_version
      and source.is_current
      and source.drawing_status is distinct from 'Superseded'
      and source.source_sha256 = job.source_sha256
      and source.source_revision is not distinct from job.source_revision
      and public.ecos_hosted_job_matches_reference(job.id, true)
    order by case when job.mode = 'live' then 0 else 1 end, job.updated_at desc, job.id
    limit 1
  ), exact_page as materialized (
    select
      job.document_id,
      job.project_id,
      job.source_sha256,
      job.committed_evidence_version,
      job.source_revision,
      page.page_number,
      nullif(provenance.value->>'sheetNumber', '') as sheet_number,
      page.final_page_data
    from exact_job job
    join public.ecos_hosted_index_pages page
      on page.job_id = job.id
     and page.organization_id = job.organization_id
     and page.project_id = job.project_id
     and page.document_id = job.document_id
     and page.source_sha256 = job.source_sha256
     and page.page_number = p_page_number
     and page.state = 'assured'
     and page.unresolved_region_count = 0
     and page.assurance_result->>'accepted' = 'true'
     and page.assurance_result->>'evidenceVersion' = job.committed_evidence_version
     and page.assurance_result->>'sourceSha256' = job.source_sha256
     and page.assurance_result->>'projectId' = job.project_id
     and (page.assurance_result->>'pageNumber')::integer = page.page_number
    cross join lateral (
      select public.ecos_sheet_provenance_payload(
        page.final_page_data,
        page.assurance_result,
        true
      ) as value
    ) provenance
    where provenance.value is not null
      and (
        requested_sheet_number is null
        or upper(regexp_replace(coalesce(provenance.value->>'sheetNumber', ''), '\s+', '', 'g')) =
          upper(regexp_replace(requested_sheet_number, '\s+', '', 'g'))
      )
  ), exact_region as materialized (
    select
      page.document_id,
      region.value,
      jsonb_build_object(
        'x', region.value->'x',
        'y', region.value->'y',
        'width', region.value->'width',
        'height', region.value->'height'
      ) as bounds,
      count(*) over () as match_count
    from exact_page page
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(page.final_page_data->'regions') = 'array'
          then page.final_page_data->'regions'
        else '[]'::jsonb
      end
    ) region(value)
    where region.value->>'id' = requested_region_id
      and jsonb_typeof(region.value->'x') = 'number'
      and jsonb_typeof(region.value->'y') = 'number'
      and jsonb_typeof(region.value->'width') = 'number'
      and jsonb_typeof(region.value->'height') = 'number'
      and (region.value->>'x')::numeric between 0 and 1
      and (region.value->>'y')::numeric between 0 and 1
      and (region.value->>'width')::numeric > 0
      and (region.value->>'height')::numeric > 0
      and (region.value->>'x')::numeric + (region.value->>'width')::numeric <= 1.000001
      and (region.value->>'y')::numeric + (region.value->>'height')::numeric <= 1.000001
  ), source_view_locator as materialized (
    select
      jsonb_build_object(
        'evidence_id', 'e1',
        'context_id', 's1',
        'kind', 'visual_page',
        'selected', true,
        'source_id', execution.source_id,
        'source_sha256', execution.source_sha256,
        'image_id', 'I01',
        'locator', jsonb_build_object(
          'organization_id', execution.owner_id,
          'project_id', execution.project_id,
          'owner_id', execution.owner_id,
          'source_id', execution.source_id,
          'source_sha256', execution.source_sha256,
          'source_revision', execution.source_revision,
          'source_page_count', execution.source_page_count,
          'page_number', page_head.page_number,
          'execution_id', execution.execution_id,
          'binding_id', binding.request_id,
          'extraction_version', execution.extraction_version,
          'authority_decision_id', binding.authority_decision_id,
          'authority_receipt_sha256', binding.authority_receipt_sha256,
          'managed_attempt_id', binding.managed_attempt_id,
          'managed_receipt_sha256', binding.managed_receipt_sha256,
          'page_attempt_id', page_attempt.attempt_id,
          'page_sha256', page_attempt.page_sha256,
          'image_id', 'I01',
          'locator_schema_version', 'ecos-owner-raster-source-locator/2.2',
          'image_payload_sha256', raster.attestation->'image_payload_sha256',
          'visual_payload_sha256', raster.attestation->'visual_payload_sha256',
          'raster_sha256', raster.attestation->'raster_sha256',
          'raster_byte_count', raster.attestation->'raster_byte_count',
          'raster_width', raster.attestation->'raster_width',
          'raster_height', raster.attestation->'raster_height',
          'upload_attempt_id', raster_receipt.upload_attempt_id,
          'raster_receipt_sha256', raster_receipt.receipt_sha256,
          'pixel_box', jsonb_build_array(
            0,
            0,
            (raster.attestation->>'raster_width')::integer,
            (raster.attestation->>'raster_height')::integer
          ),
          'coordinate_system', 'rotated_display_cropbox_pixels_top_left',
          'anchor_kind', 'whole_verified_page_image_not_text_quote'
        )
      ) as citation,
      count(*) over () as match_count
    from ecos_private.owner_source_executions execution
    join ecos_private.owner_source_execution_bindings binding
      on binding.execution_id = execution.execution_id
     and binding.request_id = execution.current_binding_id
     and binding.version = execution.current_binding_version
    join ecos_private.owner_page_observation_heads page_head
      on page_head.execution_id = execution.execution_id
     and page_head.binding_id = binding.request_id
     and page_head.page_number = p_page_number
    join ecos_private.owner_page_observation_attempts page_attempt
      on page_attempt.attempt_id = page_head.attempt_id
     and page_attempt.execution_id = execution.execution_id
     and page_attempt.binding_id = binding.request_id
     and page_attempt.page_number = page_head.page_number
     and page_attempt.version = page_head.version
    join ecos_private.owner_page_raster_heads raster_head
      on raster_head.page_attempt_id = page_attempt.attempt_id
    join ecos_private.owner_page_raster_receipts raster_receipt
      on raster_receipt.upload_attempt_id = raster_head.upload_attempt_id
     and raster_receipt.page_attempt_id = raster_head.page_attempt_id
     and raster_receipt.version = raster_head.version
    cross join lateral (
      select
        raster_receipt.attestation_json::jsonb as attestation
    ) raster
    where execution.owner_id = current_actor
      and execution.project_id = requested_project_id::uuid
      and execution.source_id = requested_document_id
      and execution.source_sha256 = requested_source_sha256
      and execution.source_revision is not distinct from requested_revision
      and execution.source_page_count >= p_page_number
      and execution.extraction_version = 'ecos-owner-native-preview/2.0'
      and raster.attestation->>'schema_version' = 'ecos-owner-page-raster-attestation/2.2'
      and raster.attestation->>'owner_id' = current_actor::text
      and raster.attestation->>'organization_id' = current_actor::text
      and raster.attestation->>'project_id' = requested_project_id
      and raster.attestation->>'execution_id' = execution.execution_id::text
      and raster.attestation->>'binding_id' = binding.request_id::text
      and raster.attestation->>'source_id' = execution.source_id
      and raster.attestation->>'source_sha256' = execution.source_sha256
      and raster.attestation->>'source_revision' is not distinct from execution.source_revision
      and (raster.attestation->>'source_page_count')::integer = execution.source_page_count
      and raster.attestation->>'extraction_version' = execution.extraction_version
      and (raster.attestation->>'page_number')::integer = page_head.page_number
      and raster.attestation->>'page_attempt_id' = page_attempt.attempt_id::text
      and raster.attestation->>'page_sha256' = page_attempt.page_sha256
      and raster.attestation->>'upload_attempt_id' = raster_receipt.upload_attempt_id::text
      and raster.attestation->>'raster_coordinate_system' = 'rotated_display_cropbox_pixels_top_left'
      and raster.attestation->>'verification' = 'exact_png_sha256_and_independent_decode'
      and raster.attestation->'retrieval_authorized' = 'false'::jsonb
      and raster.attestation->'semantic_verified' = 'false'::jsonb
      and raster.attestation->>'image_payload_sha256' ~ '^[0-9a-f]{64}$'
      and (
        raster.attestation->'visual_payload_sha256' = 'null'::jsonb
        or raster.attestation->>'visual_payload_sha256' ~ '^[0-9a-f]{64}$'
      )
      and raster.attestation->>'raster_sha256' ~ '^[0-9a-f]{64}$'
      and (raster.attestation->>'raster_byte_count')::integer between 33 and 8388608
      and (raster.attestation->>'raster_width')::integer between 1 and 8000
      and (raster.attestation->>'raster_height')::integer between 1 and 8000
      and (raster.attestation->>'raster_width')::bigint
        * (raster.attestation->>'raster_height')::bigint <= 24000000
      and raster_receipt.attestation_sha256 =
        encode(sha256(convert_to(raster_receipt.attestation_json, 'UTF8')), 'hex')
      and raster_receipt.receipt_sha256 =
        encode(sha256(convert_to(raster_receipt.receipt_json, 'UTF8')), 'hex')
  )
  select
    page.document_id,
    page.project_id,
    page.source_sha256,
    page.committed_evidence_version,
    page.source_revision,
    page.page_number,
    page.sheet_number,
    requested_region_id,
    region.bounds,
    locator.citation
  from exact_page page
  join exact_region region
    on region.document_id = page.document_id
   and region.value is not null
   and region.match_count = 1
  left join source_view_locator locator
    on locator.match_count = 1
  limit 1;
end;
$$;

revoke all on function public.dave_verify_current_ecos_document_proof(
  text, text, text, text, text, integer, text, text
) from public, anon, service_role;
grant execute on function public.dave_verify_current_ecos_document_proof(
  text, text, text, text, text, integer, text, text
) to authenticated;

comment on function public.dave_verify_current_ecos_document_proof(
  text, text, text, text, text, integer, text, text
) is 'Owner-only exact hosted-region and current protected-page binding. Returns no document text, private object path, or public URL. The source viewer must still reauthorize and revalidate every supplied raster pin before returning bytes.';

create or replace function public.ecos_load_project_question_records_v1(
  p_project_id text,
  p_project_name text,
  p_task_limit integer default 5000,
  p_update_limit integer default 5000,
  p_note_limit integer default 2000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_project_id text := btrim(coalesce(p_project_id, ''));
  target_project_name text := btrim(coalesce(p_project_name, ''));
  task_limit integer := greatest(1, least(coalesce(p_task_limit, 5000), 5000));
  update_limit integer := greatest(1, least(coalesce(p_update_limit, 5000), 5000));
  note_limit integer := greatest(1, least(coalesce(p_note_limit, 2000), 2000));
  task_rows jsonb;
  update_rows jsonb;
  note_rows jsonb;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authenticated user required';
  end if;
  if target_project_id = '' or target_project_name = '' then
    raise invalid_parameter_value using message = 'project identity required';
  end if;
  if not exists (
    select 1
    from public.projects project
    where project.owner_id = caller_id
      and project.id::text = target_project_id
      and lower(btrim(project.name)) = lower(target_project_name)
      and project.archived = false
  ) then
    raise insufficient_privilege using message = 'project access denied';
  end if;

  select coalesce(jsonb_agg(to_jsonb(scoped) order by scoped.id), '[]'::jsonb)
  into task_rows
  from (
    select item.id, item.project_id, item.project_name, item.task_name,
      item.item_data, item.updated_at
    from public.schedule_items item
    where item.owner_id = caller_id
      and (
        lower(btrim(coalesce(item.project_id, ''))) = lower(target_project_id)
        or (
          btrim(coalesce(item.project_id, '')) = ''
          and (
            lower(btrim(coalesce(item.project_name, ''))) = lower(target_project_name)
            or lower(btrim(coalesce(item.item_data->>'projectName', ''))) = lower(target_project_name)
            or lower(btrim(coalesce(item.item_data->>'scheduleProjectName', ''))) = lower(target_project_name)
          )
        )
      )
    order by item.id
    limit task_limit + 1
  ) scoped;
  if jsonb_array_length(task_rows) > task_limit then
    raise program_limit_exceeded using message = 'ecos_project_task_inventory_limit';
  end if;

  select coalesce(jsonb_agg(to_jsonb(scoped) order by scoped.id), '[]'::jsonb)
  into update_rows
  from (
    select update_record.id, update_record.project_id,
      update_record.project_name, update_record.area_name,
      update_record.update_data, update_record.created_at,
      update_record.updated_at
    from public.project_updates update_record
    where update_record.owner_id = caller_id
      and (
        lower(btrim(coalesce(update_record.project_id, ''))) = lower(target_project_id)
        or (
          btrim(coalesce(update_record.project_id, '')) = ''
          and (
            lower(btrim(coalesce(update_record.project_name, ''))) = lower(target_project_name)
            or lower(btrim(coalesce(update_record.update_data->>'projectName', ''))) = lower(target_project_name)
            or lower(btrim(coalesce(update_record.update_data->>'scheduleProjectName', ''))) = lower(target_project_name)
          )
        )
      )
    order by update_record.id
    limit update_limit + 1
  ) scoped;
  if jsonb_array_length(update_rows) > update_limit then
    raise program_limit_exceeded using message = 'ecos_project_update_inventory_limit';
  end if;

  select coalesce(jsonb_agg(to_jsonb(scoped) order by scoped.id), '[]'::jsonb)
  into note_rows
  from (
    select note.id, note.project_id, note.project_name, note.location_name,
      note.original_text, note.action_kind, note.action_text, note.status,
      note.updated_at
    from public.field_notes note
    where note.owner_id = caller_id
      and (
        lower(btrim(coalesce(note.project_id, ''))) = lower(target_project_id)
        or (
          btrim(coalesce(note.project_id, '')) = ''
          and lower(btrim(coalesce(note.project_name, ''))) = lower(target_project_name)
        )
      )
    order by note.id
    limit note_limit + 1
  ) scoped;
  if jsonb_array_length(note_rows) > note_limit then
    raise program_limit_exceeded using message = 'ecos_project_note_inventory_limit';
  end if;

  return jsonb_build_object(
    'schemaVersion', 'ecos-project-question-records/1.0',
    'projectId', target_project_id,
    'projectName', target_project_name,
    'scheduleItems', task_rows,
    'projectUpdates', update_rows,
    'fieldNotes', note_rows
  );
end;
$$;

revoke all on function public.ecos_load_project_question_records_v1(
  text, text, integer, integer, integer
) from public, anon;
grant execute on function public.ecos_load_project_question_records_v1(
  text, text, integer, integer, integer
) to authenticated, service_role;

do $postcondition$
begin
  if to_regprocedure(
    'public.dave_verify_current_ecos_document_proof(text,text,text,text,text,integer,text,text)'
  ) is null then
    raise exception 'Ask ECOS protected proof function was not installed';
  end if;
  if to_regprocedure(
    'public.ecos_load_project_question_records_v1(text,text,integer,integer,integer)'
  ) is null then
    raise exception 'Ask ECOS project records function was not installed';
  end if;
  if has_function_privilege(
    'anon',
    'public.dave_verify_current_ecos_document_proof(text,text,text,text,text,integer,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Anonymous proof execution must remain disabled';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.dave_verify_current_ecos_document_proof(text,text,text,text,text,integer,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated proof execution grant is missing';
  end if;
end;
$postcondition$;

commit;
