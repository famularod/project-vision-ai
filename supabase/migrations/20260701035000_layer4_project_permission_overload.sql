-- Compatibility overload for project-scoped policy call sites.
--
-- The applied membership model is organization-scoped and defines:
--   public.pie_layer4_has_permission(org_id text, permission_name text)
--
-- Later policies may pass project_id as a boundary argument. Keep those policies
-- fail-closed on missing project identity and delegate permission evaluation to
-- the authoritative organization membership function until a durable project
-- membership table exists.

create or replace function public.pie_layer4_has_permission(
  org_id text,
  project_id text,
  permission_name text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    org_id is not null
    and project_id is not null
    and length(project_id) > 0
    and public.pie_layer4_has_permission(org_id, permission_name);
$$;

comment on function public.pie_layer4_has_permission(text, text, text) is
  'Project-argument overload for PIE policies. Requires non-empty project identity and delegates current authorization to organization membership until durable project memberships exist.';
