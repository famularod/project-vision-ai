# Project Truth History Migration Runbook

Date: July 26, 2026

Target Supabase project: `xdytqlpsqsseoeuxgzre`

Migration:
`20260718044000_dave_project_truth_history_fingerprints.sql`

## Why this migration is required

Project Truth snapshots are append-only revisions. The current production
constraint allows each semantic fingerprint only once per owner and project.
That incorrectly rejects a valid history in which a project changes from state
A to state B and later returns to state A.

The repository already deduplicates against only the current head. The database
must therefore allow a historical fingerprint to appear in more than one
revision.

## Verified current state

- The July 26 linked production dry run no longer selects this migration or the
  atomic-deletion array-type correction. Their migration versions are recorded
  in the linked database.
- The same dry run selects only
  `20260726040000_vitruvius_storage_cleanup_lifecycle.sql`.
- The Project Truth repository behavior test passes, including current-head
  deduplication, bounded conflict retries, and A-to-B-to-A history.
- Static validation passes all 24 ordered migrations.
- The migration removes only the three-column unique constraint whose ordered
  columns are `owner_id`, `project_id`, and `source_fingerprint`.
- Revision uniqueness and primary-key uniqueness remain unchanged.
- Row-level security, append-only triggers, grants, and ownership policies are
  not modified.

## Pre-deployment checks

1. Create a current database backup or confirm the provider's point-in-time
   recovery window.
2. Confirm that this migration remains present in both local and remote
   inventories and is not selected by a linked dry run.
3. Confirm that no unexpected unique index, rather than the expected unique
   constraint, independently enforces the same three columns.
4. Record current duplicate counts:

```sql
select
  owner_id,
  project_id,
  source_fingerprint,
  count(*) as revision_count
from public.dave_project_truth_snapshots
group by owner_id, project_id, source_fingerprint
having count(*) > 1;
```

The expected result before deployment is zero rows.

## Deployment

No Project Truth history deployment is currently pending. Do not repair,
revert, or replay this migration merely because this runbook exists. Any
future inventory mismatch requires a fresh diagnosis and explicit approval.

## Post-deployment validation

1. Confirm the migration appears in both local and remote migration inventory.
2. Confirm the non-unique history lookup index exists.
3. Run the Project Truth repository behavior test.
4. In an isolated staging project, save state A, then B, then A again.
5. Confirm revisions 1, 2, and 3 remain readable and revision 3 is current.
6. Confirm that saving unchanged state A again does not create revision 4.
7. Re-run the live authorization matrix before release certification.

## Rollback

Do not automatically recreate the former unique constraint after the migration
has accepted data. First check whether repeated historical fingerprints exist:

```sql
select
  owner_id,
  project_id,
  source_fingerprint,
  count(*) as revision_count
from public.dave_project_truth_snapshots
group by owner_id, project_id, source_fingerprint
having count(*) > 1;
```

If this returns any rows, restoring the former constraint would either fail or
require deleting valid append-only history. Use point-in-time recovery if a
full rollback is required.

Only when the query returns zero rows may the former constraint be restored:

```sql
drop index if exists public.dave_project_truth_fingerprint_history_idx;

alter table public.dave_project_truth_snapshots
  add constraint dave_project_truth_snapshots_owner_project_fingerprint_key
  unique (owner_id, project_id, source_fingerprint);
```

Recreating that constraint intentionally restores the old limitation and is not
the preferred steady state.
