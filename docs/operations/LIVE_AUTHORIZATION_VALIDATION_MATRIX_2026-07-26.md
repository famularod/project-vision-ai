# Live Authorization Validation Matrix

Date: July 26, 2026

Target Supabase project: `xdytqlpsqsseoeuxgzre`

## Automated contract result

The following local authorization and production-hardening contracts pass:

- project sync owner isolation;
- session-change handling for live Project Truth authority;
- voice-memory owner authorization;
- semantic signature isolation;
- photo row-level-security policy regression;
- production hardening for AI controls, atomic deletion, owner isolation, and
  encrypted backup.

The remote migration inventory confirms that the single-owner ownership/RLS
migration is present in production.

## Live matrix still required

The repository includes `scripts/live-rls-test.js`, which creates two isolated
temporary users, organizations, and projects. It verifies:

- an authenticated owner may insert and read authorized records;
- anonymous reads and inserts are denied;
- user A cannot read or insert user B records and user B cannot read user A;
- cross-organization and cross-project parent-child grafts are denied;
- immutable Reality and Executive Judgment records cannot be changed or
  deleted;
- allowed mutable photo and decision records can be updated by their owner;
- decision synchronization is idempotent and creates one version.

The live test intentionally writes temporary records and then cleans them up.
It therefore must not be run against production casually.

## Required controlled execution

Before running the live matrix:

1. Confirm a fresh backup or point-in-time recovery window.
2. Supply the production URL, anonymous key, and service-role key through the
   process environment only. Never commit them.
3. Set a unique `SUPABASE_RLS_TEST_RUN_PREFIX`.
4. Confirm permission to create and remove temporary auth users and test rows.
5. Preserve the machine-readable result and cleanup summary.
6. Treat any cleanup failure as an operational incident until the exact
   temporary records are reconciled.

Command:

```sh
SUPABASE_URL=<url> \
SUPABASE_ANON_KEY=<anon-key> \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
SUPABASE_RLS_TEST_RUN_PREFIX=<unique-run-id> \
npm run test:rls-live
```

## Current certification boundary

The source and static authorization contracts are verified. Production account
isolation is not certified until this controlled two-user live matrix passes.
