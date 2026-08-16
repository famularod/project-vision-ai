-- Preserve the exact managed source used by hosted ECOS processing.
--
-- A ready hosted commit hydrates derived evidence back into the authoritative
-- reference document. That UPDATE must not feed through the general enqueue
-- trigger and replace the job's verified GCS locator with the reference's
-- original Google Drive provenance. The job locator is execution authority;
-- sourceProvider/externalSource on the reference remains origin provenance.

begin;

-- Serialize the held-state check with any concurrent configuration enable.
lock table public.ecos_hosted_index_configuration in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.ecos_hosted_index_configuration configuration
    where configuration.enabled = true
  ) then
    raise exception 'ecos_hosted_configuration_must_be_disabled_for_source_provenance_guard';
  end if;
end;
$$;

create or replace function public.ecos_reference_document_enqueue_identity(
  p_document_data jsonb
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'isCurrent', coalesce(p_document_data, '{}'::jsonb)->>'isCurrent' = 'true',
    'isSuperseded', coalesce(p_document_data, '{}'::jsonb)->>'drawingStatus' = 'Superseded',
    'organizationId', nullif(btrim(coalesce(p_document_data, '{}'::jsonb)->>'organizationId'), ''),
    -- The public authority wrapper rejects padded projectId values before the
    -- mature enqueue implementation trims its internal fallbacks. Preserve the
    -- raw project binding so an invalid-to-valid transition cannot compare equal.
    'projectId', coalesce(p_document_data, '{}'::jsonb)->'projectId',
    'projectName', coalesce(p_document_data, '{}'::jsonb)->'projectName',
    'projectNames', coalesce(p_document_data, '{}'::jsonb)->'projectNames',
    'sourceSha256', lower(coalesce(
      nullif(coalesce(p_document_data, '{}'::jsonb)->>'contentSha256', ''),
      nullif(coalesce(p_document_data, '{}'::jsonb)->>'webFileFingerprint', ''),
      nullif(coalesce(p_document_data, '{}'::jsonb)->>'indexedContentSha256', '')
    )),
    'sourceRevision', coalesce(
      nullif(btrim(coalesce(p_document_data, '{}'::jsonb)->>'drawingRevision'), ''),
      nullif(btrim(coalesce(p_document_data, '{}'::jsonb)->>'webVersionGroupId'), '')
    ),
    -- Keep the raw scalar in the comparison. The mature enqueue code may
    -- reject/cast it later, but a derived-only UPDATE must never overflow in
    -- this trigger before the held-configuration gate can return.
    'sourcePageCount', coalesce(p_document_data, '{}'::jsonb)->'sourcePageCount',
    -- Mirror the enqueue implementation's exact, case-sensitive provider
    -- selection instead of normalizing origin metadata more broadly.
    'sourceProvider', case
      when coalesce(p_document_data, '{}'::jsonb)->>'sourceProvider' = 'google_drive'
        then 'google_drive'
      when nullif(btrim(coalesce(p_document_data, '{}'::jsonb)->>'storagePath'), '') is not null
        then 'supabase_storage'
      else 'managed_upload'
    end,
    'storagePath', nullif(btrim(coalesce(p_document_data, '{}'::jsonb)->>'storagePath'), ''),
    'externalSource', coalesce(p_document_data, '{}'::jsonb)->'externalSource'
  ));
$$;

revoke all on function public.ecos_reference_document_enqueue_identity(jsonb)
  from public, anon, authenticated;
grant execute on function public.ecos_reference_document_enqueue_identity(jsonb)
  to service_role;

create or replace function public.ecos_enqueue_hosted_index_from_reference_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Atomic family activation demotes the previous current row and promotes the
  -- prepared target in one transaction. A pure demotion must not start a new
  -- paid shadow-preparation job for bytes that were already authoritative.
  if tg_op = 'UPDATE'
    and old.document_data->>'isCurrent' = 'true'
    and new.document_data->>'isCurrent' is distinct from 'true'
    and coalesce(old.document_data->>'contentSha256', '') = coalesce(new.document_data->>'contentSha256', '')
    and coalesce(old.document_data->>'webFileFingerprint', '') = coalesce(new.document_data->>'webFileFingerprint', '')
    and coalesce(old.document_data->>'indexedContentSha256', '') = coalesce(new.document_data->>'indexedContentSha256', '')
    and coalesce(old.document_data->>'projectId', '') = coalesce(new.document_data->>'projectId', '')
    and coalesce(old.document_data->>'projectName', '') = coalesce(new.document_data->>'projectName', '')
    and coalesce(old.document_data->>'drawingRevision', '') = coalesce(new.document_data->>'drawingRevision', '')
    and coalesce(old.document_data->>'drawingStatus', '') = coalesce(new.document_data->>'drawingStatus', '')
    and coalesce(old.document_data->>'storagePath', '') = coalesce(new.document_data->>'storagePath', '') then
    return new;
  end if;

  -- Hosted receipt/page-graph hydration changes only derived evidence fields.
  -- Compare the effective inputs that can legitimately select or requeue a
  -- hosted job so those server-authored updates cannot rewrite source authority.
  if tg_op = 'UPDATE'
    and public.ecos_reference_document_enqueue_identity(old.document_data)
      = public.ecos_reference_document_enqueue_identity(new.document_data) then
    return new;
  end if;

  perform public.ecos_enqueue_hosted_reference(new.id::text, new.owner_id, new.owner_id);
  return new;
end;
$$;

revoke all on function public.ecos_enqueue_hosted_index_from_reference_document()
  from public, anon, authenticated;

create or replace function public.ecos_guard_hosted_managed_source_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_mutable_managed_job boolean;
begin
  -- Once an exact job has a durable managed object, ordinary re-enqueue and
  -- derived reference hydration may not downgrade it to origin metadata. A
  -- reconnect/supabase/google job may still move forward to managed_upload.
  clean_mutable_managed_job :=
    old.state in ('queued', 'reconnect_source')
    and old.completed_page_count = 0
    and old.assured_page_count = 0
    and old.unresolved_region_count = 0
    and old.committed_evidence_version is null
    and old.ready_at is null
    and old.claimed_by is null
    and old.claim_token is null
    and old.lease_expires_at is null
    and old.heartbeat_at is null
    and not exists (
      select 1 from public.ecos_hosted_index_pages page where page.job_id = old.id
    )
    and not exists (
      select 1 from public.ecos_hosted_shadow_chunks chunk where chunk.job_id = old.id
    )
    and not exists (
      select 1 from public.ecos_hosted_shadow_materialization_queue queue where queue.job_id = old.id
    )
    and not exists (
      select 1 from public.ecos_hosted_visual_exceptions exception where exception.job_id = old.id
    )
    and not exists (
      select 1 from public.ecos_hosted_index_usage usage_record where usage_record.job_id = old.id
    )
    and not exists (
      select 1 from public.ecos_drawing_analysis_requests request where request.hosted_job_id = old.id
    );

  if old.source_provider = 'managed_upload'
      and nullif(btrim(old.source_locator->>'gcsBucket'), '') is not null
      and nullif(btrim(old.source_locator->>'gcsObject'), '') is not null
      and old.organization_id is not distinct from new.organization_id
      and old.project_id is not distinct from new.project_id
      and old.document_id is not distinct from new.document_id
      and old.source_owner_id is not distinct from new.source_owner_id
      and old.source_sha256 is not distinct from new.source_sha256
      and old.source_revision is not distinct from new.source_revision
      and old.mode is not distinct from new.mode
      and (
        not clean_mutable_managed_job
        or new.source_provider is distinct from 'managed_upload'
        or nullif(btrim(new.source_locator->>'gcsBucket'), '') is null
        or nullif(btrim(new.source_locator->>'gcsObject'), '') is null
      ) then
    new.source_provider := old.source_provider;
    new.source_locator := old.source_locator;
  end if;
  return new;
end;
$$;

revoke all on function public.ecos_guard_hosted_managed_source_authority()
  from public, anon, authenticated, service_role;

drop trigger if exists ecos_hosted_managed_source_authority_guard
  on public.ecos_hosted_index_jobs;
create trigger ecos_hosted_managed_source_authority_guard
before update of source_provider, source_locator
on public.ecos_hosted_index_jobs
for each row execute function public.ecos_guard_hosted_managed_source_authority();

do $$
declare
  trigger_enabled "char";
begin
  select trigger_record.tgenabled
  into trigger_enabled
  from pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.ecos_hosted_index_jobs'::regclass
    and trigger_record.tgname = 'ecos_hosted_managed_source_authority_guard'
    and not trigger_record.tgisinternal;
  if trigger_enabled is distinct from 'O' then
    raise exception 'ecos_hosted_managed_source_authority_guard_not_enabled';
  end if;
end;
$$;

commit;
