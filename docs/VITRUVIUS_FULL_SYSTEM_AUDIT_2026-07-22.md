# Vitruvius Full-System Audit — 2026-07-22

**Audit target:** Vitruvius mobile, tablet, and web application
**Working branch:** `codex/build91-core-corrections`
**Release candidate:** planned Vitruvius 1.0.91 / Build 91
**Assessment:** **Not flawless and not production-ready.** The current branch is materially safer and better tested than Build 90, but approval-bound backend and database work plus real three-client validation remain before production release.

## Executive summary

Two consecutive unchanged final release runs passed all 13 V.I.C. layers,
including the production web export. In each run, the strict Jest layer passed
**136 suites and 946 tests**. Whole-repository coverage was **61.11%
statements, 46.36% branches, 66.33% functions, and 64.24% lines**. The focused
deletion/retry set passed **37 of 37 tests**, and the corrected offline-deletion
release check passed 25 consecutive stress runs. The current dependency audit
reports **0 critical, 0 high, and 16 moderate vulnerabilities**; resolving the
moderate set requires a major Expo dependency upgrade rather than a safe
patch-level change.

The correction batch fixes important local failure paths: stale refresh responses can no longer replace newer device truth, failed web mutations are rolled back or fail closed, remote schedule percentages are preserved instead of reducing every non-complete activity to zero, stale queued records cannot outrank deletion markers, and project/area/update scoping is more exact.

Those results do not prove the complete deployed system. The most serious unresolved issue is the external schedule-extraction service. The client sends a Supabase bearer token, but the deployed service’s authorization boundary is not aligned with that token and an unauthenticated probe reached application processing instead of being rejected with `401`. The backend review also found unsafe logging/error behavior, no verified explicit provider-retention setting, and no proven per-user rate/size controls. That service is external to this repository and requires an explicitly approved backend change and deployment.

The live database migration/RLS state, clean-account bootstrap, cross-account
local-data isolation, atomic cloud deletion, retention cleanup, AI
quotas/transactions, complete encrypted backup, Android production signing,
and physical iPhone/iPad/web behavior remain incomplete or unverified. The
signed Build 91 artifact passed source, signature, identity, bundle, and
provisioning checks and is suitable as a controlled field-test candidate. It is
not a production release. Build 91 is installed on both provisioned devices.
The iPhone installation, launch, and installed version are verified; the iPad
still requires an unlocked-device launch check.

## Audit scope

The review followed the reachable runtime from `App.tsx`, `entry.ts`, and `entry.web.ts`; it did not treat unused or orphaned source files as proof of app behavior.

Reviewed areas:

- application startup, hydration, refresh generations, offline queues, and cross-device synchronization;
- project, task, area, field-update, document, schedule, and deletion identity;
- current/prior schedule authority and remote schedule extraction;
- report/task accounting, PM completion authority, and deleted-evidence isolation;
- web authentication, freshness, optimistic mutation rollback, pagination, and responsive layout;
- photo-intelligence request/response boundaries and provider failure handling;
- local storage, export/restore, storage objects, RLS migrations, and deletion retention;
- V.I.C. release automation, escaped-defect coverage, CI contracts, and production web export;
- native release metadata, Android policy/signing gates, and physical-device readiness.

Primary evidence is in:

- `App.tsx`
- `services/SyncService.ts`
- `services/DAVEOperationalRefresh.ts`
- `services/DAVEProjectUpdateScope.ts`
- `services/DAVEProjectAreaScope.ts`
- `services/ProjectDeletionTransaction.ts`
- `services/ProjectUpdateDeletionJournal.ts`
- `services/DAVEWebSupabaseClient.ts`
- `components/web-shell/desktop-auth-provider.tsx`
- `services/PIEScheduleRemoteExtraction.ts`
- `services/ScheduleProgressInvariant.ts`
- `services/AppBackupManifest.ts`
- `services/BackupRestoreRuntime.ts`
- `services/OwnerScopedLocalStore.ts`
- `supabase/migrations/`
- `supabase/functions/`
- `scripts/jarvis-release-gate.js`
- `scripts/jarvis-jest-gate.js`
- `validation/jarvis/escaped-defects.json`
- `docs/VITRUVIUS_BUILD_91_FIELD_TEST_PLAN_2026-07-22.md`

## Review cycles

### Cycle 1 — correction implementation and first complete gate

- Applied the current correction batch without discarding unrelated branch work.
- Ran focused tests while changes were being integrated.
- Ran the complete `qa:release` path.
- Result: **PASS**, 13 automated layers, production web export complete, 136 suites and 938 tests passed.
- Coverage: 60.88% statements, 46.22% branches, 66.15% functions, 64.01% lines.
- Result meaning: automated source/build gate passed; physical-device release certification was not established.

### Cycle 2 — independent full-system reanalysis

- Re-reviewed synchronization, deletion, task/project ownership, schedule extraction, web mutation safety, storage/security, migrations, V.I.C., dependency health, and release prerequisites.
- Added new fixes for refresh races, web rollback consistency, remote schedule progress parsing, stale queued-record resurrection, and deletion-journal recovery.
- Identified the approval-bound and manual deficiencies listed below.
- Confirmed two physical Apple devices are paired and reachable. This proves availability for installation, not that Build 91 is installed or validated.

### Cycle 3 — post-fix repeated release gates

- The first attempted repeated gate exposed a nondeterministic offline-deletion
  test. The production queue durably enqueued the delete and intentionally
  requested upload in the background, while the test required that request to
  start within a fixed 50 ms. Pre-fix stress reproduced 2 failures in 70 runs.
- The test now waits for the observable delete attempt with a bounded timeout,
  and a regression proves a failed cloud delete remains a durable delete for
  retry. No production sync semantics were changed.
- Post-fix focused evidence: 25 of 25 stress runs and 37 of 37 queue/deletion
  tests passed.
- First final unchanged `qa:release` result: **PASS WITH WARNINGS**
- First final run: **136 suites / 946 tests passed**
- First final coverage: **61.11% statements / 46.36% branches / 66.33%
  functions / 64.24% lines**
- Second consecutive unchanged `qa:release` result: **PASS WITH WARNINGS**
- Second final run: **136 suites / 946 tests passed**, with the same coverage
  and a successful production web export.
- New actionable defects found in the two final cycles: **0**
- Warning in both runs: Android production still uses debug signing. This does
  not block the iOS-only Build 91 test candidate, but it blocks Android release
  certification.

### Cycle 4 — signed artifact and three-client validation

Automated PASS does not complete this cycle.

- Build 91 signed iOS artifact: **PASS**
- Artifact identity, embedded bundle, V icon, development signature, and
  two-device provisioning: **PASS**
- iPhone installation and launch: **PASS** — Vitruvius 1.0.91 / Build 91
- iPad installation: **PASS**
- iPad launch: **BLOCKED — device was locked**
- Production web export from the same runtime source state: **PASS**
- Field validation: use `docs/VITRUVIUS_BUILD_91_FIELD_TEST_PLAN_2026-07-22.md`.

## Correction inventory

The working correction set contains 37 tracked corrections and several supporting hardening changes. This audit does not convert that count into 37 closed defects merely because code exists. Closure requires the evidence shown in the rightmost column.

| Correction area | Implemented behavior | Evidence/state |
|---|---|---|
| Project/update ownership | Exact parent schedule ID, explicit project name, and uniquely owned legacy area determine update ownership; ambiguous shared-area matches fail closed | `services/DAVEProjectUpdateScope.ts`, `services/DAVEProjectAreaScope.ts`, focused scope tests |
| Project deletion | Project tasks, areas, documents, parent-linked updates, queue rows, and tombstones are included in local cascade planning | `services/ProjectDeletionTransaction.ts`, `tests/services/project-deletion-transaction.test.ts`; cloud atomicity remains open |
| Deleted-record resurrection | Operational uploads preflight local/cloud deletion markers; stale queued areas, tasks, and documents are superseded rather than re-uploaded | `services/SyncService.ts`, `tests/services/sync-tombstone-upload-gate.test.ts` |
| Update deletion recovery | Cloud delete success is journaled before local confirmation so a retry completes the transaction without repeating the cloud delete | `services/ProjectUpdateDeletionJournal.ts`, `tests/services/project-update-deletion-journal.test.ts` |
| Offline retry | Retry controller recognizes superseded deletion-conflicting work and preserves unrelated queue entries | `services/PendingChangesRetryController.ts`, `tests/services/offline-queue-recovery.test.ts` |
| Native refresh race | Refresh generations reject late/stale asynchronous results; automatic refresh retries preserve the last verified state | `services/DAVEOperationalRefresh.ts`, operational-refresh tests |
| Web refresh continuity | Background refresh failures keep the verified workspace visible and mark it reconnecting/stale instead of returning to sign-in | `components/web-shell/desktop-auth-provider.tsx`, `services/DAVEWebFreshness.ts` |
| Web mutation rollback | Task/document mutations use expected cloud timestamps and explicit compensation; rollback failure is surfaced instead of silently diverging | `services/DAVEWebSupabaseClient.ts`, web task/document tests |
| Schedule progress import | Remote `percentComplete` accepts numeric and percent-string values and is reconciled with status instead of assigning zero to every non-complete task | `services/PIEScheduleRemoteExtraction.ts`, `services/ScheduleProgressInvariant.ts`, remote-extraction tests |
| Current project truth | Task/report inputs exclude deleted or ambiguous records and use exact project scope | `services/DAVEProjectTruth.ts`, `services/DAVEReportIntelligence.ts`, accounting and report suites |
| Document/media recovery contracts | Trusted cloud bytes can be checked and restored for project/reference documents | `services/ExpoProjectDocumentByteRestore.ts`, `services/ExpoReferenceDocumentByteRestore.ts`; complete backup remains open |
| V.I.C. release gate | Fresh coverage output, serious Jest-warning failures, escaped-defect registry, static contracts, and production web export are release layers | `scripts/jarvis-jest-gate.js`, `scripts/jarvis-release-gate.js`, `validation/jarvis/escaped-defects.json` |
| Responsive web shell | Project filters, navigation, account/title layout, and touch targets adapt to compact tablet/phone-equivalent browser widths | `components/web-shell/desktop-read-only-shell.tsx`, web navigation/design tests; physical and zoom testing remains manual |

## Verified automated results

| Check | Result |
|---|---|
| First complete `qa:release` run | PASS |
| V.I.C. layers | 13 passed, including production web export |
| Final repeated Jest suites/tests | 136 suites / 946 tests passed in each run |
| Final repeated coverage | 61.11% statements / 46.36% branches / 66.33% functions / 64.24% lines |
| Focused tombstone, deletion-journal, and offline-retry set | 37 / 37 tests passed |
| Dependency severity | 0 critical / 0 high / 16 moderate |
| Paired-device availability | Two Apple devices reachable, provisioned, and installed; iPhone launch/version verified, iPad launch retry requires an unlocked device |

## Unresolved deficiencies — approval-bound

These changes affect a deployed backend, database schema/RLS, authentication/session behavior, retention policy, external provider, or release credential. They must not be silently deployed from this audit.

| Severity | Deficiency | Required correction and proof |
|---|---|---|
| **P0 Critical** | **External schedule extractor is publicly reachable or authorization-misaligned.** The mobile client sends the signed-in Supabase bearer token in `services/PIEScheduleRemoteExtraction.ts`, but the deployed endpoint did not reject an unauthenticated request at its security boundary. | Make the backend validate the exact Supabase issuer, audience, signature, expiry, and authorized user/project before parsing any bytes. Return `401/403` before application work. Add authenticated/expired/wrong-project/anonymous integration tests and deploy only after approval. |
| **P0 Critical** | **Schedule extractor can expose project data through logs and errors.** Backend review found full schedule/request logging and raw provider/internal errors or stack details. | Remove content logging; retain only minimal request IDs, bounded timing, outcome code, and redacted diagnostics. Map provider failures to stable client-safe codes. Verify production logs with a real schedule. |
| **P0 Critical** | **Extractor provider retention and abuse controls are not proved.** An explicit `store: false` equivalent, per-user rate quota, request-size/page limits, concurrency limit, timeout budget, and replay/idempotency control are not verified in the deployed backend. | Add and test those controls, document the data flow/retention, deploy with approval, then validate a real multi-project schedule. The local response parser correction does not close this backend issue. |
| **P1 High** | **Required database migration/RLS parity is not verified live.** Local static validation cannot prove that every migration in `supabase/migrations/`, including `20260718044000_dave_project_truth_history_fingerprints.sql`, exists in the target database or that policies behave as reviewed. | Inventory local versus remote migration versions, back up the database, apply approved migrations in staging, run clean bootstrap and live RLS matrices, then apply production changes with a rollback plan. |
| **P1 High** | **Cross-account local storage isolation is not wired into the live app.** `services/OwnerScopedLocalStore.ts` provides a fail-closed primitive, but global app storage remains broadly hydrated across sign-out/account-switch paths. | Approve the auth/session transition design, migrate every durable domain to verified-owner keys, quarantine ambiguous legacy data, and test sign-out, account switch, reinstall, and interrupted migration on devices. |
| **P1 High** | **Cloud project deletion is not one atomic database operation.** Local cascade planning is stronger, but child deletes, object cleanup, tombstones, and parent deletion can still cross multiple cloud operations. | Add an owner-authorized transactional RPC/outbox that validates the full project boundary, writes deletion markers, deletes or queues all children/objects, and returns one checked result. Inject failures at every step and prove rollback/recovery. |
| **P1 High** | **Deletion retention is incomplete.** Project/update removal may intentionally leave audit evidence, analyses, or storage objects, but the exact retention/purge policy and owner-visible outcome are not fully enforced. | Approve a retention policy, add object-reference/outbox cleanup, prove orphan sweeping, and disclose what remains, for how long, and who can purge it. |
| **P1 High** | **AI operations lack fully verified production quotas and transaction boundaries.** Static contracts do not prove per-user/project quotas, provider retry budgets, atomic multi-row persistence, or rollback on partial analysis failure for every deployed function. | Add server-enforced quotas, idempotency, bounded retry/timeout behavior, transactional RPCs where several records form one result, and staging failure injection for `supabase/functions/` workflows. |
| **P1 High** | **Project/project-update cloud tombstone coverage is incomplete.** Operational tombstones protect tasks, areas, and documents, but parent projects and project updates still depend on separate deletion mechanisms. | Add schema-backed, owner-scoped tombstones and reconcile them in every client before uploads. This requires migration/RLS approval and cross-device resurrection tests. |
| **P1 High** | **Android production signing is not certified.** `scripts/android-production-signing-gate.js` warns for an iOS-only candidate but cannot prove an Android production key, private credential availability, or final artifact signature. | Provide approved production signing credentials through the release system, ensure the release build never uses debug signing, and verify the final APK/AAB certificate. Do not distribute Android artifacts until this passes. |

## Unresolved deficiencies — safe local work

These items can be advanced in source without changing the live backend, but they still require focused design and validation rather than a rushed release edit.

| Severity | Deficiency | Next correction |
|---|---|---|
| **P1 High** | **The user data export is metadata-only and not a complete recovery artifact.** The live UI accurately states that photo/document bytes are omitted. `services/AppBackupManifest.ts` defines checksums, encrypted sections, assets, and complete-domain validation, but that version-2 format is not the live export/restore path. | Wire a reviewed complete backup flow with authenticated encryption, secure key handling, every durable domain, media bytes, checksums, interrupted-restore recovery, and loss/corruption tests. Keep the current honest wording until complete recovery is proven. |
| **P1 High** | **V.I.C. still has broad untested runtime surface.** Coverage improved to 61.11/46.36/66.33/64.24, and many high-risk behaviors are covered by mocks or source contracts rather than executable integration tests. | Ratchet floors only after stable repeat runs; add tests for auth transitions, storage pressure, mixed-version sync, report reconciliation, stale schedule authority, provider failures, and every escaped field defect. |
| **P2 Medium** | **The 16 moderate dependency findings require a major Expo upgrade.** A forced upgrade during Build 91 would expand release risk. | Create a dedicated Expo-upgrade branch, follow the Expo upgrade guide, regenerate native projects, re-run the complete gate, and perform camera/location/file/auth/device regression tests before merging. |
| **P2 Medium** | **Complete clean-install and corruption-recovery coverage is incomplete.** Unit recovery contracts exist, but every local domain has not been exercised under full storage, truncated writes, reinstall, OS eviction, and mixed legacy/current data. | Add deterministic fault injection and a device recovery matrix; require recovery state to be visible and never report cloud truth when the last read failed. |
| **P2 Medium** | **Performance budgets are not enforced on physical hardware.** Automated checks cannot prove touch response, frame pacing, large-list behavior, cold launch, or memory under the current real dataset. | Capture device timings and traces, define thresholds, and add a repeatable performance evidence manifest to V.I.C. |

## Unresolved deficiencies — manual/live verification

| Severity | Verification gap | Required evidence |
|---|---|---|
| **P1 High** | Live iPhone/iPad/web synchronization has not been re-certified on the final source state | Complete every source/destination row in Sections 2–4 of `docs/VITRUVIUS_BUILD_91_FIELD_TEST_PLAN_2026-07-22.md` without restarting peer clients |
| **P1 High** | Multi-project schedule upload/extraction/current-version flow has not been proved against the corrected deployed service | Upload a disposable two-project schedule, verify automatic extraction, percentages, assignments, one shared document, current/prior authority, and durable deletion |
| **P1 High** | Live RLS and clean bootstrap are not proved | Test fresh authorized and unauthorized accounts against every table/bucket/RPC after approved migrations |
| **P1 High** | Real photo comparison behavior is not proved | Re-run the known Canopy C different-angle pair through the deployed provider and preserve the exact provider failure if analysis cannot complete |
| **P2 Medium** | Responsive layout and accessibility are not certified | Test iPhone, iPad, 320/375/390/768/desktop widths, 200% browser zoom, larger text, VoiceOver, keyboard focus, and destructive-action announcements |
| **P2 Medium** | Backup/restore and retention are not field-proved | Exercise an export/import on disposable data, verify the disclosed media limitation, and confirm deleted records cannot return |
| **P2 Medium** | Device responsiveness is not measured | Record cold launch and repeated navigation/touch latency with real project data; investigate any regular response over two seconds |

## Build 91 artifact and installation evidence

> **Finalization section — complete only from the exact source state that passed the repeated release gates.**

| Evidence | Result |
|---|---|
| Product metadata updated to 1.0.91 / Build 91 | **PASS** |
| Source revision / commit | `5bbf1e3dd86cc85cd2ace47e7f3c1a415242b47e` plus the reviewed, uncommitted Build 91 correction set |
| Signed Release artifact path | `/Users/davidfamularo/Library/Developer/Xcode/DerivedData/ProjectPhotoUpdateTool-acuxhmquverhbydqrftlklbrmeem/Build/Products/Release-iphoneos/ProjectPhotoUpdateTool.app` |
| Bundle identifier | `com.davidfamularo.projectphotoupdate` |
| Artifact `CFBundleShortVersionString` | `1.0.91` |
| Artifact `CFBundleVersion` | `91` |
| V icon / Vitruvius display-name verification | **PASS** — 120×120 opaque icon visually inspected; display name is `Vitruvius` |
| Code-signing and provisioning | **PASS** — strict verification passed; Apple Development team `5SKMD7H83C`; both device UDIDs are provisioned through July 19, 2027 |
| Embedded release bundle | **PASS** — 6,244,602-byte `main.jsbundle`; SHA-256 `f41f9e9c07131bc3f58dd75bca11b58cdc340f9d91e45d733029b5eea1705368`; Expo Updates disabled |
| iPhone device identifier and install result | `1F7F93EF-D0A1-57D0-9A18-B6C513D796F0` — **PASS** |
| iPhone launch result | **PASS** — device reports `Vitruvius` version `1.0.91`, bundle version `91` |
| iPad device identifier and install result | `736781BA-E60A-578C-82EB-54B6341C3EF2` — **PASS** |
| iPad launch result | **BLOCKED while locked; retry required** |
| Final web export source revision | Runtime source at the revision/state above; two consecutive production exports passed |

## Production-readiness decision

Vitruvius has made a significant quality improvement, and the first complete automated release gate is green. It is **not production-ready** because the P0 schedule-extractor boundary, live database/RLS parity, deletion/retention transactions, cross-account local storage, complete backup, and final physical-device evidence are unresolved.

The correct next decision is:

1. finish the repeated no-new-defect release runs;
2. create and install the exact signed Build 91 test artifact;
3. execute the field plan on iPhone, iPad, and web;
4. obtain explicit approval before changing or deploying the extractor backend, database schema/RLS, auth/session storage boundary, retention behavior, or production signing credentials;
5. repeat the complete release gate and affected live tests after every approved deployment.

No report or automated score should describe Vitruvius as flawless. Readiness must remain tied to the precise code, deployed services, database state, signed artifacts, and live evidence that were actually verified.
