# Deletion Retention, Monitoring, and Rollback Runbook

Date: July 26, 2026

Target Supabase project: `xdytqlpsqsseoeuxgzre`

Relevant migrations:

- `20260726020000_vitruvius_atomic_deletion.sql`
- `20260726030000_fix_atomic_deletion_array_types.sql`

## Retention policy

Deletion markers in `public.dave_sync_tombstones` are permanent. They are the
cross-device source of truth that prevents an offline or stale device from
restoring deleted projects, field updates, schedule items, areas, or documents.
Do not purge or time-limit these rows.

Deletion receipts in `public.dave_deletion_audit` contain metadata only. Each
receipt becomes eligible for owner-authorized purge one year after deletion.
Eligibility does not trigger automatic deletion. The owner must deliberately
invoke `public.dave_purge_expired_deletion_audit()`.

## Shared-document boundary

Project deletion removes a reference document only when the deleted project is
its sole explicit project scope. A document associated with multiple projects
remains in the shared record and only the deleted project association is
removed.

Object-storage files require the same ownership and sharing decision. Never
delete a stored file merely because one project association was removed.

## Monitoring checks

Run these read-only checks with an administrative database connection. Do not
use application credentials to bypass row-level security.

### Deletion receipts eligible for owner review

```sql
select owner_id, entity_type, count(*) as eligible_receipts
from public.dave_deletion_audit
where purge_after <= now()
group by owner_id, entity_type
order by owner_id, entity_type;
```

### Tombstone inventory

```sql
select owner_id, entity_type, count(*) as marker_count,
       min(deleted_at) as oldest_marker,
       max(deleted_at) as newest_marker
from public.dave_sync_tombstones
group by owner_id, entity_type
order by owner_id, entity_type;
```

An increasing count is expected. A decreasing count is a production incident
because deleted records could return on another device.

### AI operation failures and stuck work

```sql
select owner_id, operation_type, status, count(*) as operation_count
from public.dave_ai_operation_requests
where started_at >= now() - interval '24 hours'
group by owner_id, operation_type, status
order by owner_id, operation_type, status;
```

```sql
select id, owner_id, operation_type, started_at, attempts
from public.dave_ai_operation_requests
where status = 'processing'
  and started_at < now() - interval '15 minutes'
order by started_at;
```

### Device pending-change failures

Vitruvius keeps its pending-change queue on the originating device. Review the
Settings sync diagnostics on each test device for:

- a nonzero waiting-to-sync count that does not fall after retry;
- `Sync failed - Retry`;
- the recorded failed operation and cloud target;
- conflict-review messages.

Do not erase device data to clear a failed queue. Export recovery data first,
preserve the diagnostics, and correct the underlying cloud or authorization
failure.

## Alert thresholds

- Any reduction in permanent tombstone count: critical.
- Any owner reading or changing another owner's record: critical.
- A processing AI operation older than 15 minutes: investigate.
- Repeated AI failures for one operation type in 24 hours: investigate.
- A device queue that remains pending after two successful connectivity checks:
  investigate before reinstalling the app.
- Any deleted item reappearing after restart or cross-device refresh: stop the
  release.

## Rollback

1. Do not roll back by deleting tombstones.
2. Do not restore deleted records automatically from a stale device.
3. Preserve the deletion receipt, affected IDs, owner ID, and device sync
   diagnostics.
4. If a newly deployed deletion function is defective, replace the function
   with the prior reviewed definition while leaving tombstones intact.
5. Restore business records only from a verified backup after the owner
   identifies the exact records to recover.
6. Recreate all required tombstones in the same recovery transaction before
   allowing other devices to sync.

## Array-type correction

Linked database linting identified an untyped empty-array initializer in the
already-deployed project-deletion function. Migration `20260726030000` replaces
the function with the same owner checks, transaction boundaries, document
sharing behavior, audit receipt, and tombstone behavior while explicitly using
`array[]::text[]`.

The correction is validated locally and selected by a linked dry run. It has
not been applied to production and requires explicit approval.

## Release boundary

Never verify deletion by removing a real production project. Use isolated test
records owned by the signed-in test account, confirm all child counts and
tombstones, then remove only the test records created for that verification.
