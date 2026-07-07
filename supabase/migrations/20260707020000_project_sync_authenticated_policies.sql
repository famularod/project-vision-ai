-- Signed-in mobile builds use the anon client with a Supabase Auth session,
-- so PostgREST requests run as the authenticated role. The legacy project
-- sync tables already had dev anon policies, but authenticated users were
-- denied by RLS. This mirrors the existing legacy dev access for signed-in
-- users without disabling RLS or changing public bucket/table exposure.

drop policy if exists projects_authenticated_read on public.projects;
create policy projects_authenticated_read
  on public.projects
  for select
  to authenticated
  using (true);

drop policy if exists projects_authenticated_write on public.projects;
create policy projects_authenticated_write
  on public.projects
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists project_updates_authenticated_read on public.project_updates;
create policy project_updates_authenticated_read
  on public.project_updates
  for select
  to authenticated
  using (true);

drop policy if exists project_updates_authenticated_write on public.project_updates;
create policy project_updates_authenticated_write
  on public.project_updates
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists project_areas_authenticated_read on public.project_areas;
create policy project_areas_authenticated_read
  on public.project_areas
  for select
  to authenticated
  using (true);

drop policy if exists project_areas_authenticated_write on public.project_areas;
create policy project_areas_authenticated_write
  on public.project_areas
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists reference_documents_authenticated_read on public.reference_documents;
create policy reference_documents_authenticated_read
  on public.reference_documents
  for select
  to authenticated
  using (true);

drop policy if exists reference_documents_authenticated_write on public.reference_documents;
create policy reference_documents_authenticated_write
  on public.reference_documents
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists schedule_items_authenticated_read on public.schedule_items;
create policy schedule_items_authenticated_read
  on public.schedule_items
  for select
  to authenticated
  using (true);

drop policy if exists schedule_items_authenticated_write on public.schedule_items;
create policy schedule_items_authenticated_write
  on public.schedule_items
  for all
  to authenticated
  using (true)
  with check (true);
