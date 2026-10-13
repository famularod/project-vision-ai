-- Owner answer Q44 (6 Oct 2026): "Archive" for a compliance document means
-- hidden on every device, kept in the cloud. Nothing is deleted.
--
-- Two new columns on the shared-document table, added in one statement.
--
-- The first, archived_at, holds the mark: the date and time the document was
-- archived, or nothing when it is not archived. The app sets it when a
-- compliance document is archived and empties it on Restore. Every device
-- asks which of the owner's documents carry it and leaves those out of its
-- lists; until this column exists each device archives on itself only, as
-- before.
--
-- The second, archive_version, is a whole-number counter for a later app
-- build (the third review's recommendation, 7 Oct 2026). The mark by itself
-- gives "archived" a version (its time) and "not archived" none, so an
-- Archive sent twice can land over a newer Restore made on another device.
-- A build that adds one to the counter at every Archive and every Restore,
-- and writes only "where the counter is still what this device last knew",
-- has a version for both. THE APP DOES NOT READ OR WRITE THIS COLUMN YET, and
-- works the same with it and without it: it asks the table for id and
-- archived_at only, and writes archived_at alone. The column is added now,
-- empty, because the owner pastes this change himself: one paste, not two.
-- Empty means "never archived or restored by a build that counts".
--
-- Why columns of their own and not fields inside document_data: every write
-- an app build makes to a shared document names its columns (id, name,
-- category, document_data, updated_at, owner_id), and a build that does not
-- know the mark rebuilds document_data from its own fixed list of fields. A
-- field in there would be dropped by the first such write, un-archiving the
-- document for everyone. A column those writes never name is left as it is.
-- For the same reason no build that does not know the counter can set it,
-- and neither column has a default or a "not null": a write that names
-- neither is never refused on their account, and a row it creates has both
-- empty.
--
-- Nothing else is needed for them. The table's access rules are per row (the
-- owner's own rows) and the app's rights are on the whole table
-- (20260716000000_project_sync_single_user_ownership_rls.sql), so both
-- columns are covered by both. The triggers that act on a changed document
-- fire on "update of document_data" only (20260808010000, 20260809065350), so
-- setting the mark (or, later, the counter) starts no document preparation
-- and is not weighed by the current-drawing guard. No trigger, function or
-- policy is added or changed.
--
-- No existing row is changed: both columns are added empty.

begin;

alter table public.reference_documents
  add column if not exists archived_at timestamptz,
  add column if not exists archive_version integer;

comment on column public.reference_documents.archived_at is
  'Owner answer Q44: when this shared document was archived (hidden on every device, kept in the cloud). Empty = not archived. Set and emptied by the app; no other write names this column.';

comment on column public.reference_documents.archive_version is
  'Owner answer Q44: a counter kept beside archived_at for a later app build, which is meant to add one to it at every Archive and every Restore of this shared document, so that an older tap from one device cannot land over a newer tap from another unnoticed. Added empty. At the time it was added the app did not use it yet. Empty = never archived or restored by a build that counts.';

commit;
