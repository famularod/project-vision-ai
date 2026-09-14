# Step 6 recovery gap — 2026-09-14

Status: not a complete backup/restore pass. Owner-only beta remains the scope.

## Confirmed gap

The native export assembled by `App.tsx` includes saved updates, projects,
archived projects, contacts, project areas, reference/project documents, schedule
items, confirmed Core memories and the active draft. It embeds available photo
and document bytes in an encrypted archive. **Field Notes are absent.**

`FieldNoteRepository.ts` stores Field Notes separately under owner-scoped keys.
Neither `preflightAppBackup` nor the target registry in `BackupRestoreRuntime.ts`
includes this domain. Its absence cannot be detected by the encrypted manifest:
`CompleteBackupArchive.ts` registers only one opaque `application_state` domain.
The encryption tests verified supplied data, not coverage of every persistent
app domain. The previous language test actually required the inaccurate
"complete backup" claim. This is an evaluation defect as well as a recovery gap.

The current export is an in-memory JSON archive limited to 128 MiB. A hypothetical
107,000,000-byte PDF requires at least 142,666,668 encoded bytes, before metadata,
so it cannot fit. This arithmetic is not a fresh size measurement of a customer
file. Increasing the limit without a streaming design would increase memory risk.

## Bounded local containment

- Rename visible actions/results to limited device backup, disclose excluded
  Field Notes and full-account/cloud recovery, and preserve legacy archive format.
- Do not report a share as saved merely because the Share Sheet closed.
- Reserve cumulative encoded file sizes before reading file bodies; reject
  missing/invalid metadata, size changes, duplicate identities and oversized
  archives. Keep final UTF-8 byte checking because metadata estimates do not
  include JSON overhead. This is not a proven peak-memory bound or streaming fix.
- Do not change existing Field Note rows, restore targets, cloud permissions,
  owner sessions or customer data. Tests cover preservation of both owner-scoped
  Field Note keys through ordinary and interrupted legacy restore.

These changes do **not** add Field Notes to backups. No real-device restore or
export is certified. The installed Build 194 remains unchanged by local edits.

Validation: full local Jest run passed 257 suites / 1,831 tests, including 17 new
capacity/disclosure/preservation cases. The data-export language check and
`npm run check` passed. The first check correctly refused to run without the
required public cloud configuration; the configured rerun passed without changing
or exposing credentials. The full release/live acceptance gate was not rerun for
this local-only containment. No export or restore was attempted on customer data.

## Required complete-recovery implementation

1. Inventory all durable app domains against real repositories; classify
   original records, attachments, pending writes, tombstones, derived caches and
   secrets. A device archive is not a database/service-configuration backup.
2. Define a versioned per-domain manifest with explicit coverage/omissions.
   Never silently interpret a missing domain as an empty collection.
3. Bind the archive and restore to a stable authenticated owner. Preserve
   unsynced notes, revisions, conflicts and deletion state. Do not turn stale
   restored cloud rows into authoritative writes or resurrect deleted records.
4. Add a read-only restore preview and disposable destination. Validate every
   record/asset before mutation; include the owner-bound domains in a durable
   recovery transaction coordinated with note edits and sync.
5. Replace the all-in-memory media archive with bounded streaming/chunks, or
   provide a separately verified managed backup for large source files. Verify
   hashes, retention/access and offline recovery, not just download links.
6. Exercise export, decrypt, preview, interrupted restore and re-export in
   disposable storage, then on a disposable physical-device dataset. Compare
   exact IDs/content/attachments and demonstrate no duplicate cloud writes.

Do not perform destructive restoration over the owner's actual data to satisfy
this checklist. Do not mark Step 6 or all seven steps complete on crypto/unit
tests alone. Owner-only Ask ECOS testing can remain distinct from this unresolved
full recovery capability.
