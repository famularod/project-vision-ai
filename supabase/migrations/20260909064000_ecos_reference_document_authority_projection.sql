begin;

-- Project only the immutable identity fields needed to decide whether a hosted
-- index job still represents the exact current source. This prevents every
-- question from detoasting and parsing the full customer document payload.
create table if not exists app_private.ecos_reference_document_authority (
  document_id text not null,
  owner_id uuid not null,
  project_id text,
  organization_id text,
  drawing_status text,
  is_current boolean not null default false,
  source_sha256 text,
  source_revision text,
  document_updated_at timestamptz not null,
  projected_at timestamptz not null default now(),
  primary key (document_id, owner_id)
);

alter table app_private.ecos_reference_document_authority enable row level security;
revoke all on table app_private.ecos_reference_document_authority
  from public, anon, authenticated, service_role;

create or replace function app_private.ecos_project_reference_document_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_data jsonb;
begin
  if tg_op = 'DELETE' then
    delete from app_private.ecos_reference_document_authority authority
    where authority.document_id = old.id
      and authority.owner_id = old.owner_id;
    return old;
  end if;

  if tg_op = 'UPDATE' and (old.id, old.owner_id) is distinct from (new.id, new.owner_id) then
    delete from app_private.ecos_reference_document_authority authority
    where authority.document_id = old.id
      and authority.owner_id = old.owner_id;
  end if;

  if new.owner_id is null then
    return new;
  end if;
  source_data := case
    when jsonb_typeof(new.document_data) = 'object' then new.document_data
    else '{}'::jsonb
  end;
  insert into app_private.ecos_reference_document_authority (
    document_id,
    owner_id,
    project_id,
    organization_id,
    drawing_status,
    is_current,
    source_sha256,
    source_revision,
    document_updated_at,
    projected_at
  ) values (
    new.id,
    new.owner_id,
    nullif(source_data->>'projectId', ''),
    nullif(source_data->>'organizationId', ''),
    nullif(source_data->>'drawingStatus', ''),
    coalesce(source_data->>'isCurrent' = 'true', false),
    lower(coalesce(
      nullif(source_data->>'contentSha256', ''),
      nullif(source_data->>'webFileFingerprint', ''),
      nullif(source_data->>'indexedContentSha256', '')
    )),
    coalesce(
      nullif(source_data->>'drawingRevision', ''),
      nullif(source_data->>'webVersionGroupId', '')
    ),
    coalesce(new.updated_at, new.created_at, now()),
    now()
  )
  on conflict (document_id, owner_id) do update set
    project_id = excluded.project_id,
    organization_id = excluded.organization_id,
    drawing_status = excluded.drawing_status,
    is_current = excluded.is_current,
    source_sha256 = excluded.source_sha256,
    source_revision = excluded.source_revision,
    document_updated_at = excluded.document_updated_at,
    projected_at = excluded.projected_at;
  return new;
end;
$$;

revoke all on function app_private.ecos_project_reference_document_authority()
  from public, anon, authenticated, service_role;

drop trigger if exists ecos_reference_document_authority_projection
  on public.reference_documents;
create trigger ecos_reference_document_authority_projection
after insert or update or delete on public.reference_documents
for each row execute function app_private.ecos_project_reference_document_authority();

insert into app_private.ecos_reference_document_authority (
  document_id,
  owner_id,
  project_id,
  organization_id,
  drawing_status,
  is_current,
  source_sha256,
  source_revision,
  document_updated_at,
  projected_at
)
select
  source.id,
  source.owner_id,
  nullif(source.document_data->>'projectId', ''),
  nullif(source.document_data->>'organizationId', ''),
  nullif(source.document_data->>'drawingStatus', ''),
  coalesce(source.document_data->>'isCurrent' = 'true', false),
  lower(coalesce(
    nullif(source.document_data->>'contentSha256', ''),
    nullif(source.document_data->>'webFileFingerprint', ''),
    nullif(source.document_data->>'indexedContentSha256', '')
  )),
  coalesce(
    nullif(source.document_data->>'drawingRevision', ''),
    nullif(source.document_data->>'webVersionGroupId', '')
  ),
  coalesce(source.updated_at, source.created_at, now()),
  now()
from public.reference_documents source
where source.owner_id is not null
on conflict (document_id, owner_id) do update set
  project_id = excluded.project_id,
  organization_id = excluded.organization_id,
  drawing_status = excluded.drawing_status,
  is_current = excluded.is_current,
  source_sha256 = excluded.source_sha256,
  source_revision = excluded.source_revision,
  document_updated_at = excluded.document_updated_at,
  projected_at = excluded.projected_at;

create or replace function public.ecos_hosted_job_matches_reference(
  p_job_id uuid,
  p_require_current boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ecos_hosted_index_jobs job
    join app_private.ecos_reference_document_authority source
      on source.document_id = job.document_id
     and source.owner_id = job.source_owner_id
    where job.id = p_job_id
      and source.drawing_status is distinct from 'Superseded'
      and (not coalesce(p_require_current, false) or source.is_current)
      and source.source_sha256 = job.source_sha256
      and source.project_id = job.project_id
      and exists (
        select 1
        from public.projects exact_project
        where exact_project.id::text = job.project_id
          and exact_project.owner_id = source.owner_id
          and coalesce(exact_project.archived, false) = false
      )
      and source.source_revision is not distinct from job.source_revision
      and (
        source.organization_id = job.organization_id
        or (
          source.organization_id is null
          and exists (
            select 1
            from public.organization_memberships membership
            where membership.organization_id = job.organization_id
              and membership.user_id = job.source_owner_id
              and membership.status = 'active'
          )
        )
      )
  );
$$;

revoke all on function public.ecos_hosted_job_matches_reference(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.ecos_hosted_job_matches_reference(uuid, boolean)
  to service_role;

commit;
