-- Additive, fail-closed project membership foundation for the controlled beta.
-- This migration does not replace the existing owner-scoped policies on live
-- project tables. Those policies must be migrated table-by-table only after
-- multi-account RLS acceptance passes against isolated test organizations.

create extension if not exists pgcrypto;

create table if not exists public.vitruvius_project_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id text not null check (length(trim(project_id)) between 1 and 500),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('active', 'invited', 'suspended', 'removed')),
  role text not null check (role in ('viewer', 'contributor', 'project_manager', 'project_admin')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, user_id)
);

create index if not exists vitruvius_project_memberships_user_status_idx
  on public.vitruvius_project_memberships (user_id, status, organization_id, project_id);

create index if not exists vitruvius_project_memberships_project_role_idx
  on public.vitruvius_project_memberships (organization_id, project_id, status, role);

alter table public.vitruvius_project_memberships enable row level security;

create or replace function public.vitruvius_project_role_has_permission(
  role_name text,
  permission_name text
)
returns boolean
language sql
immutable
as $$
  select case role_name
    when 'project_admin' then permission_name in (
      'view_project', 'ask_ecos', 'create_field_note', 'upload_photos',
      'update_tasks', 'manage_documents', 'approve_ecos_proposals',
      'export_project', 'manage_project_members', 'archive_project', 'delete_project'
    )
    when 'project_manager' then permission_name in (
      'view_project', 'ask_ecos', 'create_field_note', 'upload_photos',
      'update_tasks', 'manage_documents', 'approve_ecos_proposals', 'export_project'
    )
    when 'contributor' then permission_name in (
      'view_project', 'ask_ecos', 'create_field_note', 'upload_photos', 'update_tasks'
    )
    when 'viewer' then permission_name in ('view_project', 'ask_ecos')
    else false
  end;
$$;

create or replace function public.vitruvius_is_active_organization_admin(
  target_organization_id text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.organization_memberships membership
      where membership.user_id = auth.uid()
        and membership.organization_id = target_organization_id
        and membership.status = 'active'
        and membership.role = 'organization_admin'
  );
$$;

create or replace function public.vitruvius_has_project_permission(
  target_organization_id text,
  target_project_id text,
  permission_name text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select auth.uid() is not null and (
    public.vitruvius_is_active_organization_admin(target_organization_id)
    or exists (
      select 1
        from public.vitruvius_project_memberships membership
        where membership.user_id = auth.uid()
          and membership.organization_id = target_organization_id
          and membership.project_id = target_project_id
          and membership.status = 'active'
          and public.vitruvius_project_role_has_permission(membership.role, permission_name)
    )
  );
$$;

revoke all on function public.vitruvius_is_active_organization_admin(text) from public;
revoke all on function public.vitruvius_has_project_permission(text, text, text) from public;
grant execute on function public.vitruvius_is_active_organization_admin(text) to authenticated, service_role;
grant execute on function public.vitruvius_has_project_permission(text, text, text) to authenticated, service_role;

grant select, insert, update, delete on public.vitruvius_project_memberships to authenticated;

drop policy if exists vitruvius_project_memberships_read on public.vitruvius_project_memberships;
create policy vitruvius_project_memberships_read
on public.vitruvius_project_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.vitruvius_is_active_organization_admin(organization_id)
);

drop policy if exists vitruvius_project_memberships_admin_insert on public.vitruvius_project_memberships;
create policy vitruvius_project_memberships_admin_insert
on public.vitruvius_project_memberships
for insert
to authenticated
with check (
  public.vitruvius_is_active_organization_admin(organization_id)
  and created_by = auth.uid()
);

drop policy if exists vitruvius_project_memberships_admin_update on public.vitruvius_project_memberships;
create policy vitruvius_project_memberships_admin_update
on public.vitruvius_project_memberships
for update
to authenticated
using (public.vitruvius_is_active_organization_admin(organization_id))
with check (public.vitruvius_is_active_organization_admin(organization_id));

drop policy if exists vitruvius_project_memberships_admin_delete on public.vitruvius_project_memberships;
create policy vitruvius_project_memberships_admin_delete
on public.vitruvius_project_memberships
for delete
to authenticated
using (public.vitruvius_is_active_organization_admin(organization_id));

comment on table public.vitruvius_project_memberships is
  'Fail-closed project role foundation for controlled Vitruvius beta testing. It does not itself replace owner-scoped project-table RLS.';
