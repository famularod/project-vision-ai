# Beta organization revocation boundary

Outcome: fixed at the shared database permission predicate; broader multi-user beta readiness remains incomplete.

The actual hosted `vitruvius_has_project_permission` accepted an active project membership even after its caller's organization membership was suspended. The TypeScript authorization contract already denied that state. Hosted document-status and retrieval functions use the database helper; additional guards in some retrieval functions limit exposure, so this is not evidence that every retrieval path disclosed content. The current status API requires explicit document IDs, not an unbounded null request.

The additive migration requires a matching active organization membership on the project-member branch. It preserves active organization administrators, existing project roles, exact scope, function signature, EXECUTE privileges, and owner-only table/routing policies. No memberships or customer payloads were permanently changed.

## Verification

- Before: actual authenticated database role returned `true` for active membership and incorrectly `true` after organization suspension. Entire fixture transaction rolled back.
- After: same authenticated-role reproduction returned active `true`, suspended `false`. The exact-document status API returned zero rows for the suspended caller. Its active baseline also had zero eligible rows, so that status check is a negative control, not a positive content-retrieval acceptance test.
- `validation/ecos/beta-organization-permission-regression.sql`: real database cases passed before deployment in a rolled-back candidate transaction, then against the deployed function. Covers invited/suspended/removed/missing organization and project membership, wrong user/org/project, missing caller, role limits, and active-admin behavior without a project membership.
- An initial fixture incorrectly assumed anon lacked EXECUTE. Actual hosted ACL grants it; the test now checks missing identity denies while preserving the existing ACL. No auth grant was added or removed.
- Whole organization-membership and project-membership table hashes before/after match exactly, including timestamps. Function ACL unchanged.
- Independent pre-patch investigation and one fresh post-patch review found no concrete surviving bypass/regression in this repair.
- `npm run test:migrations:static`: pass. Focused beta authorization Jest suite: 8/8 pass. Database advisors collected before/after; no new findings.

## Remaining work

This is not an invitation system and does not enable multi-user Ask ECOS. The live customer gateway and project/document RLS remain owner-only. Actual approved tester identities/project scopes, backend team integration, real-account revocation/recovery, and visible three-device acceptance remain outstanding. Build 192 web/native artifacts are pinned to `dd11411`; this database-only patch does not change their JavaScript/native bytes.

Security handling follows [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security). The fix-finding skill required independent boundary and candidate reviews plus executable allow/deny controls; those checks shaped the bounded patch.
