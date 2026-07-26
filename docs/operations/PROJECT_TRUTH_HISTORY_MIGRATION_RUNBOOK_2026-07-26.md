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

- The linked production migration inventory shows this migration and the
  atomic-deletion array-type correction as the only local migrations not
  present in production.
- A linked dry run selects exactly those two reviewed migrations.
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
2. Confirm that the migration inventory still shows only
   `20260718044000` and `20260726030000` as pending.
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

This is a production schema change and requires explicit user approval before
running:

```sh
npx supabase db push --linked
```

The command must report only:

`20260718044000_dave_project_truth_history_fingerprints.sql`

`20260726030000_fix_atomic_deletion_array_types.sql`

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
