-- Create the Storage buckets the app has always expected but that were
-- never provisioned: project-photos (field update photos) and
-- project-documents (reference documents like schedules/permits). Every
-- upload to either has been failing with "Bucket not found" since these
-- never existed. The app authenticates purely with the anon/publishable
-- key (no user login), so policies here mirror that - open to the anon
-- role, scoped to these two buckets only, matching how the existing
-- projects/project_updates tables are already reachable by anon.

insert into storage.buckets (id, name, public)
values
  ('project-photos', 'project-photos', false),
  ('project-documents', 'project-documents', false)
on conflict (id) do update set public = false;

drop policy if exists project_photos_anon_select on storage.objects;
create policy project_photos_anon_select
  on storage.objects
  for select
  to anon
  using (bucket_id = 'project-photos');

drop policy if exists project_photos_anon_insert on storage.objects;
create policy project_photos_anon_insert
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'project-photos');

drop policy if exists project_photos_anon_update on storage.objects;
create policy project_photos_anon_update
  on storage.objects
  for update
  to anon
  using (bucket_id = 'project-photos')
  with check (bucket_id = 'project-photos');

drop policy if exists project_documents_anon_select on storage.objects;
create policy project_documents_anon_select
  on storage.objects
  for select
  to anon
  using (bucket_id = 'project-documents');

drop policy if exists project_documents_anon_insert on storage.objects;
create policy project_documents_anon_insert
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'project-documents');

drop policy if exists project_documents_anon_update on storage.objects;
create policy project_documents_anon_update
  on storage.objects
  for update
  to anon
  using (bucket_id = 'project-documents')
  with check (bucket_id = 'project-documents');
