# WHOLE_APP_AUDIT — Vitruvius, 2026-09-17

Read-only audit of the saved source (including uncommitted and untracked work) in the main app, the durable backend, the protected source service, the unversioned owner indexer folder, and the private v11 and v12 Ask ECOS runtimes. Nothing was fixed, deployed, migrated, installed into a project, or sent to a cloud or AI provider. Companion files: SOURCE_INVENTORY, FEATURE_SCORECARD, FINDINGS, REPAIR_ROADMAP, TEST_EVIDENCE, AUDIT_COVERAGE.

**This is a partial review, not an exhaustive one.** Roughly a quarter of `App.tsx`, under half of the Ask ECOS handler, about 3% of the 21k-line extraction module and well under half of the 277 service files were read. AUDIT_COVERAGE lists exactly what was and was not covered and where a second pass should start.

## 1. Plain-language summary

Vitruvius has a serious, carefully built core and an unreliable top layer.

**What is solid.** Saving work on the phone is handled with real care: writes are verified, the offline queue is journaled and well tested, deletes use tombstones, field notes use revision checks, tokens are stored properly, the backup file is properly encrypted, the database has row-level security on every table, and the cloud services run with tight permissions. The release gate is honest: its last recorded result says "not certified", and it is right.

**What is not.**

1. **Data can be lost without warning.** Signing out, switching accounts, or an automatic sign-out after a token problem deletes every photo file that the now-empty workspace does not reference, including photos that were never uploaded. Work created while signed out is wiped at the next sign-in. A field note you change before its first cloud confirmation can get stuck forever as a "conflict" with no way to resolve it.
2. **Ask ECOS does not answer real drawing questions.** All ten advanced questions failed on an earlier private build; the first one failed again on r8 and r11. No real request has ever reached the claim-review step. Beyond the timing problem there are structural causes: keyword rules can replace a good model answer with a schedule summary; drawing pages that are not "fully covered" are dropped silently; text without a coordinate box can never support an answer; the "no evidence" refusal path is unreachable, so an unrelated field note can be summarised and marked verified; one project's sheet numbers, canopy wording and site vocabulary are hard-coded into the production answer logic; and the "independent evidence check" shown to the user is substring matching.
3. **Drawings often will not finish indexing.** One page fails the whole PDF. A cleanly read sheet number is marked "verified" by one module and rejected by the next for having the wrong kind of proof, which fails the document. Blank or photo pages burn all retries. A new uncommitted change makes ordinary "QTY" labels block pages. Sheet recognition is fitted to the two known project sets.
4. **Reports can be impossible to approve.** Any one of 14 review flags blocks approval and every share button, several flags are nearly always on, and nothing lets you acknowledge them. Separately, two tasks in one area whose names start with the same eight characters put the project in a "conflict" state that also blocks reports, with a message that wrongly says data is still loading. How often this bites on the real projects was not measured; a ten-minute check on the device will tell.
5. **The tests are green for the wrong reasons in the places that matter.** 1,897 Jest tests and 594 backend tests pass (reproduced in this audit). But no test calls the Ask ECOS handler end to end, the release evidence hashes a file that is not the code that answers, most non-Jest "tests" check that strings exist in source files, and no database-level test exists.
6. **Provenance is fragile.** There are three Ask ECOS implementations under one function name, three diverged copies of shared backend code, two migration folders that neither alone nor together rebuild the database, days of uncommitted work in two repositories, and the only copy of the deployed owner-indexer source sits in an unversioned temp-style folder.

No P0 security hole was found for a single-owner beta. Every statement about what is deployed is unverified, because this audit did not touch the cloud.

## 2. Beta-readiness assessment

### Owner-only beta: NOT ready as it stands. Reachable in weeks for everything except drawing Q&A.

Reasons: the silent data-loss paths (ID-01, ID-02, SYNC-01), the likelihood that documents fail to index (IDX-01 to IDX-03), the likelihood that reports cannot be approved (REP-01, PIE-01), a backup that does not restore project records (BAK-01), and a release gate bound to the wrong code (REL-01).

An owner beta becomes credible when: those items are fixed with their regression tests; a written device acceptance script passes on iPhone, iPad and desktop for a recorded build number; and Ask ECOS drawing Q&A is either passing the ten-question rubric or is clearly labelled experimental while schedule/task/note questions remain available. See "Smallest credible owner-beta completion plan" below.

### Customer / team beta: NOT ready, and not close.

The identity model is a single owner asserted in code; older organisation-wide search functions have no project scope; one project's data, vocabulary, email domain and endpoints are hard-coded in shipped client and server code; there is no staging environment and live scripts can mutate production with no guard; sheet recognition and answer logic are fitted to two projects; deployed policy state is unverified and not reproducible from source. Organisation columns in tables do not make the product multi-tenant.

## 3. Technical findings by theme (full detail in FINDINGS.md)

| Theme | Highest severity found | Most important |
|---|---|---|
| Identity, startup, local data | P0 | ID-01 photo deletion on owner change; ID-02; ID-03 |
| Projects, tasks, schedules, GPS | P1 | SYNC-03 non-idempotent project create; SCH-02 one "current" schedule for all projects |
| Field Notes | P1 | SYNC-01 stuck conflict |
| Photos | P1 | PHO-02 imported photos stamped "now" reverse AI before/after |
| Reports and PIE | P1 | REP-01, PIE-01 approval blocked; PIE-06 recompute + cloud writes per typing pause |
| Backup / DR | P1 | BAK-01 project records not in backup |
| Documents and indexing | P1 | IDX-01, IDX-02, IDX-03, IDX-04 |
| Ask ECOS and intelligence | P0 | ECO-01 aggregate; ECO-02, ECO-03, ECO-05, ECO-06, ECO-13 |
| Source service and operations | P1 | SRC-01 about 29 sequential round trips per page open; SRC-04 unversioned sole source; OPS-01 unguarded live scripts |
| Security and privacy | P1 (process); no P0 | SEC-01 schema not reproducible; deployed state unverified |
| Desktop/web | P1 | WEB-01, WEB-02 hidden rows under permanent tombstones |
| UX, accessibility, native, performance | P2 | UX-08, UX-09, NAT-11, PERF-16/17 |
| Testing, releases, architecture | P1 | REL-01, REL-04 |

Two P0 findings in total (ID-01 and the ECO-01 aggregate). FINDINGS.md lists every ID with its own severity; hypotheses are labelled there and would mostly become P1 if confirmed.

### The Ask ECOS picture in one paragraph

The timing work (v8 to v12) was necessary and has moved the failure forward: on r11 the image read finally completed. It also exposed that the budget cannot close by itself: one image read costs about 28 s, of which 12.5 s is opening one protected page through about 29 sequential network calls, inside a 30 s tool ceiling, a 45 s research allowance and a 75 s total. v12's forced tool-free draft is the right idea and its single failing test looks like a test-fixture expectation (the fake model turn omits the function_call item, so the transcript has 3 items instead of 4), not lost evidence. But even a perfectly timed run would then meet the structural issues above, none of which any current test would catch because no test runs the handler. Fixing order: handler-level harness, honest limitations, remove the overrides and hard-coding, cut source-service latency, then re-measure one unchanged question.

## 4. Top ten actions, ranked by user impact and risk

1. **Stop photo deletion on sign-out / owner change (ID-01, PHO-07).** Reproduce: queue a photo update offline on a test project, sign out, sign in. Close with: an integration test where file X survives `activateOwner(null)` -> mount -> `activateOwner('A')`, plus the same steps passing on a device.
2. **Version everything that exists only on this Mac (SRC-04, IDX-05).** Commit the owner-worker folder and the uncommitted app/runtime work as coherent units. Close with: every deployed image digest traceable to a commit.
3. **Let a drawing set finish indexing (IDX-01, IDX-02, IDX-03).** Reproduce: a PDF whose title block reads cleanly with no bookmarks; a 3-page PDF with a blank page 2; a schedule sheet with a QTY column. Close with: all three reach `ready` in worker tests, and appendix query 5 shows `sheet_provenance_invalid` at zero on a re-index.
4. **Make reports approvable (REP-01, PIE-01, PIE-03, PIE-04).** First the ten-minute device check on the real project. Close with: a report built from 30 realistic tasks with shared name prefixes, one Blocked area and a note containing "conflict" is approvable after acknowledging advisory flags, online and offline.
5. **Build the Ask ECOS handler-level test harness and re-bind the release evidence (REL-04, REL-01).** Close with: a test that calls `handleECOSAskProjectCandidateRequest` with fakes; editing one line of the candidate handler makes the evidence gate fail.
6. **Make Ask ECOS honest before making it smarter (ECO-02, ECO-03, ECO-05, ECO-09, ECO-10).** Reproduce in the harness: a task-named drawing question; a drawing question with zero document hits and one field note sharing a word; a named sheet whose mapping is unverified; an embedding failure. Close with: document-cited answer retained; "insufficient evidence" naming what was searched; a limitation instead of silence; lexical fallback instead of 502.
7. **Fix the stuck field-note conflict and signed-out data loss (SYNC-01, ID-02, confirm SYNC-02).** Close with: deferred-create + resolve + retry ends `synced` with cloud status resolved; signed-out work is either gated or recoverable.
8. **Cut protected-page open latency and align the deadlines (SRC-01, SRC-02, SRC-03), keep v12's finalization, then run ONE unchanged `advanced-01` on a private tag (ECO-13, ECO-14).** Close with: the stage timing events showing open, crop, provider, draft, review and proof all completing inside the budget for one real request.
9. **Backup that restores a project (BAK-01), and say what it omits.** Close with: a restore drill onto a wiped test device recovering project ids, data and covers.
10. **Guard the live scripts and verify deployed state (OPS-01, SEC-01, SEC-06).** Close with: every live script refuses an unlisted project ref; the appendix SQL and dashboard checks recorded once; one migration tree that applies cleanly to an empty database.

## 5. Smallest credible owner-beta completion plan

Scope: single owner, iOS/iPadOS and desktop web, drawing Q&A labelled experimental until it passes.

1. Phase 0 of the roadmap (measure and protect): 2 days, no code risk.
2. Isolated S/M repairs: ID-01, ID-02 (login gate), SYNC-01, IDX-01, IDX-03, GPS-01, SCH-01, ID-05. About 2 weeks.
3. Reports approvable: REP-01 + PIE-01. About 1 week.
4. Backup restores projects + explicit exclusions: BAK-01. About 3 days.
5. Tests and gate point at the answering code: REL-01 + REL-04. About 1.5 weeks, in parallel.
6. A written device acceptance script, run and recorded per build number on iPhone, iPad and desktop: sign-out photo survival, offline cold start after an hour, note resolve-before-ack, report approve and share, document upload reaches Ready, restore to a wiped test device.
7. Ask ECOS track (roadmap E3 to E5, E9, E10, then E11). Open-ended until one real request completes research, review and proof in budget; do not date it before that.

Rough total for 1 to 6: 5 to 7 working weeks for one experienced pair, assuming the Phase 0 numbers do not reveal a larger indexing problem.

## 6. Unanswered questions (each changes a severity or a plan)

1. Which code is deployed under the `ecos-ask-project` slug, and which Cloud Run revisions and package hashes are live for the agent runtime and the source service?
2. Are auth signups or anonymous sign-ins enabled? What is the JWT lifetime (drives ID-03 frequency)? What is each function's `verify_jwt`?
3. Were the 7 runtime-only migrations and the 4 untracked 0915 migrations applied, where, and in what order? Where is the `ecos_private` DDL?
4. What share of current pages/chunks are unverified, coverage-incomplete or region-less (appendix queries 5 and 6)? This sizes ECO-03, ECO-04, ECO-09 and IDX-04.
5. Can a report be approved today on the real 2375 project (REP-01/PIE-01)?
6. What timestamp format does live PostgREST return for `field_notes` (SYNC-02)? Do duplicate-named projects already exist (SYNC-03)?
7. Is signed-out use intended? If not, a login gate removes ID-02 and part of ID-01.
8. Is "one current schedule for all projects" intended (SCH-02)? Are reminders in beta scope (SCH-03)? Is Android a beta target?
9. Is `ECOS_VISUAL_MEASUREMENT_PROVIDER_URL` set in production and is any organisation planned to go `live` (IDX-03)? Is `ECOS_CLAIMED_SEMANTIC_BATCHES` enabled (IDX-11)? What is the real daily visual-region limit (IDX-09)?
10. How many stored page rasters exceed 8 MiB (SRC-05)? Is Cloud Run ingress/IAM restricted as the code assumes?
11. Does App Store metadata justify the `audio` background mode, and is `ios/` regenerated before each release (NAT-11)?
12. How large do `savedUpdates`, `scheduleItems`, the reality model and judgments get on a real device (Android row limits, JS-thread stringify cost)?
13. Should tombstones be irreversible? If yes, the desktop "restored" copy is wrong by design (WEB-01).
