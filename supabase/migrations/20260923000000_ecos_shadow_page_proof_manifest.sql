begin;

-- The indexed-evidence manifest does not change when a private owner-page
-- raster is refreshed. Bind private question replay to the current page and
-- raster heads as well, so an earlier insufficient answer cannot outlive a
-- repaired protected drawing page. This function returns hashes/counts only.
create or replace function public.ecos_project_shadow_page_proof_manifest_v1(
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
  current_sources as materialized (
    select execution.execution_id, execution.source_id,
           execution.current_binding_id
    from ecos_private.owner_source_executions execution
    join authorized on true
    where execution.owner_id = p_owner_id
      and execution.project_id::text = btrim(p_project_id)
      and execution.current_binding_id is not null
      and exists (
        select 1
        from app_private.ecos_reference_document_authority authority
        where authority.owner_id = p_owner_id
          and authority.project_id = btrim(p_project_id)
          and authority.source_sha256 = execution.source_sha256
          and authority.is_current
          and authority.drawing_status is distinct from 'Superseded'
      )
  ),
  current_pages as materialized (
    select source.source_id, head.page_number, head.attempt_id,
           head.version as page_version, raster.upload_attempt_id,
           raster.version as raster_version
    from current_sources source
    join ecos_private.owner_page_observation_heads head
      on head.execution_id = source.execution_id
     and head.binding_id = source.current_binding_id
    left join ecos_private.owner_page_raster_heads raster
      on raster.page_attempt_id = head.attempt_id
  ),
  page_state as materialized (
    select coalesce(jsonb_agg(jsonb_build_array(
      source_id, page_number, attempt_id, page_version,
      upload_attempt_id, raster_version
    ) order by source_id, page_number), '[]'::jsonb) as value,
    count(*)::integer as page_count,
    count(upload_attempt_id)::integer as raster_count
    from current_pages
  )
  select jsonb_build_object(
    'schemaVersion', 'ecos-shadow-page-proof-manifest/1.0',
    'snapshotSha256', encode(digest(convert_to(page_state.value::text, 'UTF8'), 'sha256'), 'hex'),
    'pageCount', page_state.page_count,
    'rasterCount', page_state.raster_count
  )
  from authorized cross join page_state;
$$;

revoke all on function public.ecos_project_shadow_page_proof_manifest_v1(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.ecos_project_shadow_page_proof_manifest_v1(
  uuid, text, text
) to service_role;

commit;
