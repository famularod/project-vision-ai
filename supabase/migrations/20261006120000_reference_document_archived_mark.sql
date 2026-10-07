-- Owner answer Q44 (6 Oct 2026): "Archive" for a compliance document means
-- hidden on every device, kept in the cloud. Nothing is deleted.
--
-- One new column on the shared-document table holds the mark: the date and
-- time the document was archived, or nothing when it is not archived. The app
-- sets it when a compliance document is archived and empties it on Restore.
-- Every device asks which of the owner's documents carry it and leaves those
-- out of its lists; until this column exists each device archives on itself
-- only, as before.
--
-- Why a column of its own and not a field inside document_data: every write
-- an app build makes to a shared document names its columns (id, name,
-- category, document_data, updated_at, owner_id), and a build that does not
-- know the mark rebuilds document_data from its own fixed list of fields. A
-- field in there would be dropped by the first such write, un-archiving the
-- document for everyone. A column those writes never name is left as it is.
--
-- Nothing else is needed for it. The table's access rules are per row (the
-- owner's own rows) and the app's rights are on the whole table
-- (20260716000000_project_sync_single_user_ownership_rls.sql), so the column
-- is covered by both. The triggers that act on a changed document fire on
-- "update of document_data" only (20260808010000, 20260809065350), so setting
-- the mark starts no document preparation and is not weighed by the
-- current-drawing guard. No trigger, function or policy is added or changed.
--
-- No existing row is changed: the column is added empty.

begin;

alter table public.reference_documents
  add column if not exists archived_at timestamptz;

comment on column public.reference_documents.archived_at is
  'Owner answer Q44: when this shared document was archived (hidden on every device, kept in the cloud). Empty = not archived. Set and emptied by the app; no other write names this column.';

commit;
