# REPAIR_ROADMAP — prioritised (2026-09-17)

This is a plan, not authorisation. Nothing here was implemented. IDs refer to FINDINGS.md. Effort: S up to 1 day, M 2 to 5 days, L 1 to 3 weeks (one engineer or AI pair who knows the code; includes the regression test; excludes device acceptance).

"Isolated" = can be done and tested without touching the cloud or other repairs. "Needs approval" = changes cloud state, schema, policy, spend, or customer-visible behaviour.

## Phase 0 — before any code: measure and protect (1 to 2 days, no code risk)

| Step | Why | Approval |
|---|---|---|
| 0.1 Commit or otherwise version `R/owner-worker-large-cMcFDn` (SRC-04) and the uncommitted work in `app` and `runtime` as coherent units (IDX-05). Do not split tracked files from the untracked files they import. | The only copy of deployed indexer source and two days of saved work are one deletion away from loss. | Owner OK to commit; no deploy |
| 0.2 Run the read-only SQL and dashboard checks in the FINDINGS appendix (1 to 9 + dashboard list). | Converts the largest unknowns (deployed policies, how many pages are unverified / coverage-incomplete / region-less, stuck jobs, duplicate projects, oversized rasters) into numbers. Decides whether ECO-03, IDX-01, SRC-05 are P0. | Read-only |
| 0.3 Read the stored traces of the failed real questions (`outcome`, `errorCode`, rejected page counts, `ecos_deterministic_*_applied`). | Attributes past failures to ECO-02/03/04/05 without spending on reruns. | Read-only |
| 0.4 Ten-minute device check: try to approve and share a report for the real 2375 project; sign out and back in with a queued photo on a TEST project. | Confirms or downgrades REP-01/PIE-01 and ID-01 on the real build. | Use a throwaway project for the sign-out test |
| 0.5 Record which function version, Cloud Run revision and package hash are live for `ecos-ask-project`, the agent runtime and the source service. | REL-01, SRC-06. | Read-only |

## Phase 1 — owner-beta blockers (data loss and "core promise does not work")

| Order | Repair | IDs | Effort | Isolated? | Approval |
|---|---|---|---|---|---|
| 1 | Stop photo deletion on owner change / quarantine; owner-scope or reference-count the photo folder | ID-01, PHO-07 | M | Yes | No |
| 2 | Login gate (smallest) or anonymous-workspace merge | ID-02 | S / M | Yes | Product decision |
| 3 | Offline start falls back to last verified owner | ID-03 | M | Yes (needs device check) | No |
| 4 | Field-note rev-0 rebase + conflict action; timestamp normalisation | SYNC-01, SYNC-02 | M + S | Yes | No |
| 5 | Reports: split blocking vs advisory flags with acknowledgement; duplicates/keywords stop blocking authority; honest message; offline = queued not blocked; stable acknowledgement | REP-01, PIE-01, PIE-03, PIE-04 | M + M | Yes | No |
| 6 | Indexer: `coordinate_text` no longer fails the document; blank/low-text pages assured-empty; count-label exceptions gated or non-blocking; terminal failure shown as "Needs review" with retry; sweeper for expired max-retry jobs | IDX-01, IDX-02, IDX-03, IDX-06, IDX-07 | S + M + S + S + S | Worker code isolated; redeploy of the worker needs approval | Yes for deploy |
| 7 | Backup includes full project records and covers; UI lists every exclusion | BAK-01 | M | Yes | No |
| 8 | Project create idempotent (client UUID + upsert); unique index | SYNC-03 | M | Code isolated; index is a migration | Yes for migration; first run appendix query 8 |
| 9 | Schedule "current" per project | SCH-02 | M | Yes | No |

Ask ECOS is handled in its own track below because it should not hold the rest of the owner beta hostage.

## Phase 1E — Ask ECOS track (run in parallel; do not claim done from unit tests)

Order matters: make failures visible and honest first, then fix correctness, then latency, then re-measure.

| Order | Repair | IDs | Effort | Notes |
|---|---|---|---|---|
| E1 | Handler-level test harness (fake Supabase, fake gateway, fake embedder) that calls `handleECOSAskProjectCandidateRequest` end to end | REL-04 | M | Every later repair gets a test here. This is the single highest-leverage test investment in the codebase. |
| E2 | Re-bind release evidence to the answering runtime and record deployed version + package hash | REL-01 | M | Closure: edit one line of the candidate handler, gate must fail. |
| E3 | Deterministic projections only when the model failed or cited no document; remove the dead-tool name | ECO-02, ECO-11 | M | Isolated. |
| E4 | Honest limitations: dropped pages, unverified sheets, zero document hits -> insufficient answer naming what was searched; semantic failure degrades to lexical | ECO-03, ECO-05, ECO-09, ECO-10 | M | Isolated. Changes user-visible text. |
| E5 | Page-level proof tier for region-less text | ECO-04 | M | Needs a policy decision on assurance wording. |
| E6 | Move project-specific answer logic and vocabulary out of the runtime into eval fixtures / per-project alias data | ECO-06 | L | Guard with a second synthetic project in E1. |
| E7 | Follow-ups: natural rewritten question + carry prior answer subjects/sources | ECO-08 | M | |
| E8 | Assurance: whole-word, polarity, threshold; or reword the client claim | ECO-07 | M | Decide wording now (S) even if the check comes later. |
| E9 | Source-service latency: parallel authorize, drop re-sweep no. 2, epoch-hash check, token cache keyed by caller JWT hash, verified-PNG cache by raster hash; one deadline contract; gateway admits 3 with Retry-After | SRC-01, SRC-02, SRC-03 | M | Needs approval: redeploy of the source service. Never cache authorization or raster heads. |
| E10 | Keep v12's time-aware finalization; fix its test fixture (ECO-14); then re-measure one unchanged `advanced-01` on a private tag | ECO-13, ECO-14 | S + canary | Needs approval: private build, one metered request. |
| E11 | Build the manual answer rubric for the ten questions; run all ten unchanged; then desktop, iPad, iPhone, voice and text | ECO-01 | M | Needs approval: metered, owner devices. |

Beta positioning until E11 passes: ship Ask ECOS for schedule/task/field-note questions only, or label drawing Q&A "experimental" in the UI, and correct the "independent evidence check" wording.

## Phase 2 — reliability and security

| Repair | IDs | Effort | Approval |
|---|---|---|---|
| DB trigger rejecting writes to tombstoned ids; compare-and-set RPC for mobile task upserts; server `now()` | SYNC-05, WEB-01, WEB-02 | M | Migration |
| Restore-missing-tasks via one server function or new ids; regenerate ids after compensated upload | WEB-01, WEB-02 | M, S-M | Migration for the function |
| Project-ref allow-list + explicit production flag + dedicated validation user in every live script | OPS-01, REL-07 (first step) | S | No |
| One migration tree + schema baseline + empty-DB apply in CI; commit `config.toml` with per-function `verify_jwt` | SEC-01, SEC-06 | M | No deploy needed |
| Spend ledger on `ecos-analyze-drawing-page`; per-audience worker tokens + rotation runbook | SEC-04, SEC-05 | S-M, M | Secrets change |
| Disable signups (if open) and add owner predicate to the three permissive policies; revoke superseded search RPCs | SEC-02, SEC-03 | S | Migration |
| Writer enforces the reader's 8 MiB raster cap (DPI step-down or recorded refusal) | SRC-05 | S/M | Worker redeploy |
| Library photo EXIF capture time; GPS unknown for imports | PHO-02 | M | No |
| Cover photo via JSONB merge RPC + versioned path; project identity = UUID everywhere | PHO-06, ARCH-05 | M + M | Migration for RPC |
| Backup as streamed per-asset container with per-project scope | BAK-02 | L | No |
| Indexer gateway retries, permanent classification of deterministic errors, batched embedding writes with lease extension, quota-deferred state | IDX-09, IDX-10, IDX-11 | S + S + M | Worker redeploy + migration |
| Remove cached drawings on tombstone merge; delete OCR temp files; server-side storage drainer | PRIV-01, PRIV-02, SEC-07 | M | Scheduled function |
| Derive proof endpoint from config; "remove this account's data" action; owner-scope report snapshots | ID-05, ID-06 | S, S-M | No |
| GPS unit fix + capture once per foreground | GPS-01, GPS-02 | S + S | No |
| UTC "today" in lookahead and siblings | SCH-01 | S | No |

## Phase 3 — usability and performance

| Repair | IDs | Effort |
|---|---|---|
| Roles/labels on `PrimaryButton`/`SecondaryButton`, then label inputs | UX-08 | S then M |
| Contrast tokens + a token-contrast unit test | UX-09 | S |
| Web error boundary; dirty-draft guard; sign-out always clears local view; distinct sign-in error copy + retry; rename "read-only" shell and fix 404 copy | WEB-03 to WEB-07 | S each, M for drafts |
| Re-sign proof URL at click; key proof effect on authority key + `cloudUpdatedAt`; destroy pdfjs docs; write page PNG to cache file on mobile | WEB-08, WEB-09, WEB-10 | S, S, M |
| Editable transcript before sending a voice question; Talk sheet hides instead of nulling | ECO-16, ECO-17 | S, S |
| Exclude unsaved draft from PIE authority; compute truth from debounced snapshot; throttle persistence; stop computing unrendered outputs; "as of" + refresh on foreground/day change | PIE-06, PIE-07 | M, S |
| Replace whole-collection `JSON.stringify` equality with id + revision | PERF-17 | M |
| Clean prebuild and plist allowlist check; exclude dev client from Release | NAT-11 | S-M |

## Phase 4 — architecture and product expansion (after owner beta is stable)

Incremental, evidence-based, no rewrite:

1. One source of truth per backend function: vendor `_shared` as a package or add a drift check that fails CI; delete or export+test the app's 3,965-line Ask function (REL-02).
2. Relabel static "tests" truthfully; split CI into an offline gate that must be green and a release certification that needs evidence (REL-03, REL-05); add CI to owner-source-runtime (SRC-07).
3. Stamp the git SHA into `product-metadata.json`, show it in Settings and the web footer; store the manifest per build; script capture/restore of function versions (REL-06).
4. Staging Supabase project and EAS `preview` environment (REL-07).
5. Move `App.tsx:954-1213` project constants and the legacy migration into a data module, then delete (ARCH-06).
6. Extract `AppShell` state by domain (draft, sync, documents, schedule) into hooks/context, one domain per PR, with render-count assertions (PERF-16).
7. Group `services/` into `pie/ dave/ ecos/ sync/` with index files, one prefix per PR; collapse duplicated `PIEExecutive*` types; delete the about 2.6k unreachable lines and lower the unreachable ratchet to 0 (ARCH-10).
8. General title-block sheet identity (IDX-04) and per-project vocabulary (ECO-06) are prerequisites for any second customer.

## Features to integrate rather than build

- Reminders/notifications (SCH-03): use `expo-notifications` local scheduling; do not build a scheduler.
- Connectivity: `@react-native-community/netinfo` for reconnect detection instead of inferring from realtime.
- Images: `expo-image` for thumbnails, caching and downsampling (PERF-18).
- PDF export: generate from the existing Word/HTML content with `expo-print`; do not write a PDF layout engine.
- Entailment/verification of answers: a second-model check through the existing provider gateway rather than more regex (ECO-07).
- Database tests: pgTAP or a disposable Supabase local stack for RLS, tombstone and lifecycle RPCs instead of SQL-text assertions.
- Customer/team tenancy (phase 4+): build on the existing membership tables and `vitruvius_has_project_permission`; do not add a parallel model.

## Smallest credible owner-beta completion plan

Scope the beta honestly: single owner, iOS/iPadOS + desktop web, drawing Q&A labelled experimental.

1. Phase 0 in full (2 days, no code).
2. ID-01, ID-02 (login gate), SYNC-01, IDX-01, IDX-03, GPS-01, SCH-01, ID-05: all S or M, all isolated. About 2 weeks.
3. REP-01 + PIE-01 so a report can be approved and shared. About 1 week.
4. BAK-01 and an explicit list of what backup does not contain. About 3 days.
5. REL-01 + REL-04 so the gate and the tests point at the code that answers. About 1.5 weeks, parallel with 2 to 4.
6. A written device acceptance script (sign-out photo survival, offline cold start, field note resolve-before-ack, report approve + share, document upload reaches Ready, restore to a wiped test device), run on iPhone, iPad and desktop and recorded per build number.
7. Ask ECOS track E3 to E5 + E9 + E10, then E11. Drawing Q&A leaves "experimental" only when the ten questions pass against a manual rubric on all three surfaces.

Rough total for items 1 to 6: 5 to 7 working weeks for one experienced pair, assuming Phase 0 numbers do not reveal a larger indexing problem. Item 7 is open-ended until a real request completes research, review and proof inside the budget; do not put a date on it before the first successful private canary.
