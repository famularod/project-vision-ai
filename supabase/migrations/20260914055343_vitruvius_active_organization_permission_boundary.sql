-- Revocation applies to the caller's organization AND project membership.
-- This does not enable team access to owner-scoped project tables or routing.
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
    or (
      exists (
        select 1
        from public.organization_memberships organization_membership
        where organization_membership.user_id = auth.uid()
          and organization_membership.organization_id = target_organization_id
          and organization_membership.status = 'active'
      )
      and exists (
        select 1
        from public.vitruvius_project_memberships membership
        where membership.user_id = auth.uid()
          and membership.organization_id = target_organization_id
          and membership.project_id = target_project_id
          and membership.status = 'active'
          and public.vitruvius_project_role_has_permission(membership.role, permission_name)
      )
    )
  );
$$;

-- CREATE OR REPLACE preserves the existing EXECUTE ACL; anonymous callers
-- remain denied by the required non-null auth.uid(), not a new grant change.
