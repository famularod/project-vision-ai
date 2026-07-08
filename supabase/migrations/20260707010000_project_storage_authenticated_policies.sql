-- Build 25 sync fix: the mobile app uploads field-update photos through the
-- anon Supabase client after the user signs in, which means Storage requests
-- run as the authenticated role. The original project storage bucket migration
-- created project-photos and project-documents for anon only, so signed-in
-- Release builds could hit Storage RLS before the update row sync completed.

insert into storage.buckets (id, name, public)
values
  ('project-photos', 'project-photos', false),
  ('project-documents', 'project-documents', false)
on conflict (id) do update set public = false;

drop policy if exists project_photos_authenticated_select on storage.objects;
create policy project_photos_authenticated_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'project-photos');

drop policy if exists project_photos_authenticated_insert on storage.objects;
create policy project_photos_authenticated_insert
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'project-photos');

drop policy if exists project_photos_authenticated_update on storage.objects;
create policy project_photos_authenticated_update
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'project-photos')
  with check (bucket_id = 'project-photos');

drop policy if exists project_documents_authenticated_select on storage.objects;
create policy project_documents_authenticated_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'project-documents');

drop policy if exists project_documents_authenticated_insert on storage.objects;
create policy project_documents_authenticated_insert
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'project-documents');

drop policy if exists project_documents_authenticated_update on storage.objects;
create policy project_documents_authenticated_update
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'project-documents')
  with check (bucket_id = 'project-documents');
