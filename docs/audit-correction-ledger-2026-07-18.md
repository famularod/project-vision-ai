# DAVE Audit Correction Ledger

**Created:** July 18, 2026  
**Source audit:** `DAVE_Converged_Code_Audit_Report_2026-07-17.md`  
**Baseline checkpoint:** `78bb69608433d7ee0915b334f4c89e4464d1764c` (`78bb6960`) — `Checkpoint Build 56 audit stabilization baseline`  
**Action plan:** `DAVE_Audit_Correction_Action_Plan_2026-07-18.md`

This ledger tracks every finding in the converged audit. A row may move to **Closed** only after the required proof is attached and the action plan's definition of done is satisfied. A passing static/source-contract check is not sufficient when executable, staging, migration, or physical-device evidence is required.

## Legend

- **Confirmed:** The finding remains observable in the current live source or configuration.
- **Partial:** Some related behavior has improved, but the finding's closure criteria are not satisfied.
- **Snapshot-resolved:** The audited snapshot condition is no longer present in the current Git index or working tree; the stated caveat must still be verified before final closure.
- **Open:** Correction and/or required verification remains outstanding.
- **Marked Resolved:** Current evidence supports resolution, subject to the listed clean-clone or artifact caveat.
- **Closed:** The required correction and verification evidence are recorded.
- **Owner role:** Responsibility hat from the action plan; one person may hold more than one role.

## P0 — Release blockers

| ID | Current status | Workstream / action ID | Owner role | Required proof | State |
|---|---|---|---|---|---|
| P0-01 | Resolved | A0.1 | Technical Lead + Security | Checkpoint `78bb6960`, secret-scan report, source manifest, and clean checkout reproducing the audited inventory without credentials | Closed |
| P0-02 | Confirmed | A1.1 | Technical Lead + Data/Supabase + Mobile | Verified UUID migration and rollback; rename, punctuation, non-ASCII, duplicate-name, area-collision, and Project A/B isolation tests | Open |
| P0-03 | Confirmed | A1.2 | Data/Supabase + Security | Staging query/schema contract test using singular `role`; owner and non-owner authorization matrix; visible fail-closed mismatch state | Open |
| P0-04 | Partial | A1.4 | Intelligence + Mobile | Fake-timer and UI tests for loading, stale, scope/signature change, transient retry, repeated failure, recovery, and revoked permission | Open |
| P0-05 | Partial | A1.3 | Intelligence + QA/Release | One typed parser corpus covering positive, negative, incomplete, future, conditional, uncertain, safety, and blocker language across every authority consumer | Open |
| P0-06 | Confirmed | A4.1 | Mobile + Intelligence | Project switch, new draft, delete/replace, changed bytes, out-of-order completion, retry, background, and stale GPS tests proving exact generation targeting | Open |
| P0-07 | Partial | A4.2 | Intelligence + Mobile | Executable all-photo assessment matrix proving Clear only for successful explicit clear results and never for pending, failed, baseline, incomparable, or generic observations | Open |
| P0-08 | Confirmed | A4.3 | Data/Supabase + Security | Staging tests for non-owner, fabricated project, cross-project evidence, guessed path, request-ID collision, replay, partial write, quota, and provider retention | Open |
| P0-09 | Confirmed | A2.3, A2.4 | Mobile + Security | Owned-file manifest tests for traversal, encoded separators, absolute URI, sibling prefix, missing manifest, legitimate restore, and ownership-verified delete | Open |
| P0-10 | Confirmed | A2.1 | Mobile | Failure-injection tests for disk full, storage exception, double tap, edit/cancel during save, and process kill proving UI success follows verified durable commit | Open |
| P0-11 | Confirmed | A2.2 | Mobile + QA/Release | Per-domain hydration tests proving transient/corrupt reads cause zero fallback writes and block save, sync, restore, authority, and export until recovery | Open |
| P0-12 | Partial | A3.1, A3.2, A3.3 | Data/Supabase + Mobile + Product/PM | Two-device revision, simultaneous edit, offline edit, delete/edit, reinstall, pagination, partial read, future clock, idempotency, and exact conflict-choice tests | Open |

## P1 — Correctness, security, and data integrity

| ID | Current status | Workstream / action ID | Owner role | Required proof | State |
|---|---|---|---|---|---|
| P1-01 | Confirmed | A1.5 | Intelligence + Data/Supabase | Reality transition tests for blocked, resolved, reopened, complete, retired, stale evidence, and tombstoned evidence with history preserved separately | Open |
| P1-02 | Confirmed | A1.5 | Intelligence + Data/Supabase | Atomic evidence records retain true captured time, actor, source, confirmation event, and version; quality score tests reject fabricated freshness/support | Open |
| P1-03 | Confirmed | A1.5 | Intelligence + QA/Release | Coverage/readiness tests including one strong plus nine insufficient items and blocking insufficiency/conflict thresholds per claim | Open |
| P1-04 | Confirmed | A1.4 | Intelligence + Mobile | Cloud-read failure is labeled degraded local-only, freshness/source metadata persists, and high-impact authority remains blocked until acknowledged fresh cloud state | Open |
| P1-05 | Confirmed | A1.2, A5.1 | Intelligence + Data/Supabase | Immutable proposal exists before human gate; no plan, audit, decision, or external action mutates until an authorized transition is confirmed and persisted | Open |
| P1-06 | Confirmed | A1.4 | Intelligence + Mobile | Canonical complete versioned signature tests cover all schedule, contact, area, sync, and uncapped entity changes and force correct refresh | Open |
| P1-07 | Confirmed | A4.1, A4.4 | Mobile + Intelligence | Evidence, cache, and analyzer-run identity includes content SHA plus analyzer, prompt, and policy version; changed bytes cannot reuse a stale result | Open |
| P1-08 | Confirmed | A4.4 | Intelligence + Data/Supabase | Duplicate-byte tests resolve the existing evidence or explicit lineage without analysis failure; `duplicate_of_evidence_id` and version behavior verified | Open |
| P1-09 | Confirmed | A4.1, A4.4 | Mobile + Intelligence | Prior-photo ordering uses immutable per-photo `capturedAt`; analysis/import/send timestamps remain distinct; timezone and equal-time cases pass | Open |
| P1-10 | Confirmed | A4.4 | Mobile + Intelligence | Memory/profile test with large candidate set proves metadata-first selection, one winning pair prepared, and byte/dimension limits before base64 | Open |
| P1-11 | Partial — shared analysis contract landed (8cf410cb); boundary payload matrix pending | A4.4 | Intelligence + Data/Supabase | Shared schema/prompt/validator contract tests accept and reject identical boundary payloads, including empty and populated limitations | Open |
| P1-12 | Confirmed | A1.5, A5.4 | Intelligence | Verified outcome events and prior memory flow through production Core, or all production learning claims are removed; executable lifecycle test attached | Open |
| P1-13 | Confirmed | A1.5, A5.4 | Intelligence | Subject/entity/evidence-link tests prove unrelated evidence cannot strengthen or challenge a belief and previous belief lifecycle supports update/retire/supersede | Open |
| P1-14 | Confirmed | A1.5, A5.4 | Intelligence | Deterministic safety-gated option scoring disqualifies unsafe choices and selects the strongest eligible action across all options | Open |
| P1-15 | Confirmed | A1.3, A1.5 | Intelligence + QA/Release | Stable blocker ID/type and explicit close-event tests cover negation, same-area unrelated issues, safety, reopen, and resolution | Open |
| P1-16 | Confirmed | A5.3 | Mobile + Intelligence + Product/PM | Real dependency edges and UI behavior pass, or dependency claims and surfaces are removed with product approval | Open |
| P1-17 | Confirmed | A5.3 | Mobile + Intelligence | RFC-compatible CSV tests cover quoted commas, CRLF, slash dates, multiline cells, BOM, and malformed-row reporting | Open |
| P1-18 | Confirmed | A1.3, A5.3 | Intelligence + QA/Release | Exact status normalization and status/percent invariant tests reject Incomplete, Not complete, and Not done as Complete | Open |
| P1-19 | Partial — branded PlainDate/Instant + timezone-safe comparisons landed (8cf410cb); DST/device matrix pending | A5.3 | Mobile + Intelligence | PlainDate versus Instant tests cover project timezone, due-today end-of-day, DST, and zones west/east of UTC | Open |
| P1-20 | Partial — import-batch provenance landed (8cf410cb); batch-scoped delete verification pending | A1.1, A5.3 | Mobile + Data/Supabase | Immutable import-batch/source-document tests prove same-named uploads remain independent and deletion affects only the selected batch | Open |
| P1-21 | Confirmed | A1.1, A2.3 | Technical Lead + Data/Supabase + Mobile | Migration requires successful inventory, counts, checksums, backup, idempotent marker, restart safety, and zero deletion after ambiguous reads | Open |
| P1-22 | Partial | A2.3, A2.4 | Mobile + Data/Supabase | Reference and project-document backup/recovery round-trip real bytes with manifest/hash/size; missing local bytes download and verify from cloud | Open |
| P1-23 | Confirmed | A2.3, A2.4 | Mobile | Selected documents are copied to owned persistence before record creation; stale uploading becomes retryable; verified cloud download restores missing local bytes | Open |
| P1-24 | Confirmed | A2.3 | Mobile + Data/Supabase + Security | Versioned complete backup manifest round-trips every durable domain, checksums/counts, encrypted sensitive sections, restore modes, and tombstone semantics | Open |
| P1-25 | Confirmed | A3.2, A4.4 | Data/Supabase + Security | Owner-authorized draft cleanup and retention tests remove or retain raw evidence, asset, analysis, and storage objects according to disclosed policy | Open |
| P1-26 | Partial — vision edge checks upsert results (8cf410cb); transactional RPC + staging injection pending | A4.3 | Data/Supabase + Security | One transactional RPC returns checked success; injected failure rolls back or marks the full analysis failed with no partial-success response | Open |
| P1-27 | Partial — per-collection read errors, gated apply, conditional lastSync, unit-tested (95e3507a); staging failure-injection pending | A3.1 | Data/Supabase + Mobile | Per-collection read failure remains explicit, prior data is preserved, `[]` is never applied as failed authority, and sync reports partial/failed | Open |
| P1-28 | Partial — corrupt-journal quarantine + upload-failure counting, unit-tested (ef85a314); cloud acknowledgment verification pending | A3.2 | Data/Supabase + Mobile | Tombstone upload failure remains pending and retryable; corrupt bytes are quarantined with checksum, export, and verified cloud acknowledgment | Open |
| P1-29 | Confirmed | A1.1, A2.5 | Security + Mobile | Owner-namespaced stores and auth-transition lock pass sign-out, account switch, retained/cleared consent, and cross-account upload/visibility tests | Open |
| P1-30 | Partial — SecureStore adapter, chunking, legacy migration, allowBackup=false landed (301a365b); device sign-out/reinstall tests pending | A2.5, A6.2 | Security + Mobile | SecureStore-backed auth, OS-backup exclusions, least-privilege artifact review, and sign-out/reinstall/account-switch device tests | Open |
| P1-31 | Confirmed | A1.2, A4.3 | Data/Supabase + Security | Direct privileged mutations are denied; action-specific RPCs validate transitions and derive actor/time; staging authorization/audit matrix passes | Open |
| P1-32 | Confirmed | A1.1, A1.2 | Data/Supabase + Security | Composite owner/project parent keys and child foreign keys reject cross-project grafts and cascades in migration and staging tests | Open |
| P1-33 | Confirmed | A1.1, A1.2 | Data/Supabase + Security | Production owner UUID is supplied and verified out of band before migration; ambiguity aborts without trusting client-writable candidates | Open |
| P1-34 | Confirmed | A2.4, A3.2, A4.4 | Data/Supabase + Security | Object-reference table, transactional delete/outbox, explicit retention, and orphan sweeper pass metadata/object failure and recovery tests | Open |
| P1-35 | Confirmed | A5.1 | Intelligence + Mobile | Decision History renders behind verified policy and approve/reject/defer/cancel/correct/validate callbacks persist real transitions | Open |
| P1-36 | Confirmed | A5.1 | Data/Supabase + Intelligence | Decision Ledger commits locally, queues cloud sync, exposes retry/state, and survives offline, restart, duplicate replay, and cloud failure | Open |
| P1-37 | Confirmed | A5.1 | Intelligence | All transition, automation, validation, and UI consumers resolve `versions[currentVersion]`; original snapshot remains audit-only | Open |
| P1-38 | Confirmed | A5.1 | Intelligence + Data/Supabase | Append-only supersession event or `supersedes_id` persists locally/cloud without rewriting old rows and resolves the current judgment correctly | Open |
| P1-39 | Confirmed | A5.2 | Intelligence + Mobile | Blocking review flags prevent approval and are rechecked at copy/email/text time; confidence, evidence, and owner warnings cannot be filtered away | Open |
| P1-40 | Partial — composer outcomes gate communicated flag, reset on report identity change, unit-tested (1998faa1); device composer matrix pending | A5.2 | Mobile | Composer-result tests distinguish opened, canceled, and sent-unknown and reset communication state whenever report identity/project changes | Open |
| P1-41 | Partial — restore rebuilds canonical projectRecords, unit-tested (d5dce13f); restart device test pending | A2.2, A2.3 | Mobile | Restore writes the canonical ProjectRecord repository atomically; restart reproduces the restored projects and not the previous records | Open |
| P1-42 | Confirmed | A2.1 | Mobile | Save re-entry is serialized, draft generation is snapshotted, and only the exact committed generation is cleared while later edits survive | Open |
| P1-43 | Confirmed | A2.1 | Mobile | Memory save either disables cancel while committing or invalidates via generation token; cancel/save race tests prove accurate UI and persistence | Open |
| P1-44 | Confirmed | A1.5, A5.4 | Intelligence + Data/Supabase | Semantic fingerprints exclude volatile nested timestamps and preserve meaningful revision history under repeated equivalent recomputation | Open |
| P1-45 | Confirmed | A1.5, A5.4 | Intelligence + Data/Supabase | A-to-B-to-A history persists or links the historical snapshot; deduplication compares against head and retries satisfy constraints | Open |
| P1-46 | Confirmed | A5.1, A5.4 | Intelligence | Sensitivity analysis perturbs explicit inputs, rescoring all eligible options, excluding disqualified choices, and computing robustness from margins | Open |
| P1-47 | Partial — conflict-safe history resend landed (8cf410cb); staging duplicate tests pending | A3.1 | Data/Supabase + Mobile | Reality history resend uses conflict-safe insertion with immutable-content verification; one duplicate cannot roll back or mask mismatched rows | Open |
| P1-48 | Partial — cursor pagination to exhaustion landed (8cf410cb); over-row-cap staging test pending | A3.1 | Data/Supabase | Stable pagination reaches exhaustion, validates counts where practical, and independently paginates embedded children beyond row caps | Open |
| P1-49 | Confirmed | A3.1 | Data/Supabase | Migration reconciles duplicate idempotency groups, enforces owner-scoped uniqueness, and runtime upserts on the exact constraint | Open |
| P1-50 | Confirmed | A2.1, A2.2, A5.5 | Mobile | Input is gated until hydration, submissions serialize, history is bounded/pageable, writes are journaled, and quota/failure is visible | Open |
| P1-51 | Confirmed | A1.5, A5.1, A5.4 | Intelligence | Executive Judgment selects assertions only through chosen supporting objects/claims and rejects unrelated or contradictory trace paths | Open |
| P1-52 | Confirmed | A1.5, A5.4 | Intelligence | Follow-through history retains inactive/resolved records, firstSeen, cadence, and deterministic reactivation after temporary disappearance | Open |
| P1-53 | Confirmed | A1.3, A1.5, A5.4 | Intelligence + QA/Release | Mission criteria evaluate typed evidence only; description words cannot satisfy a criterion in zero-evidence adversarial tests | Open |
| P1-54 | Partial | A1.3, A1.5, A5.4 | Intelligence + QA/Release | High priority alone creates no blocked state or graph edge; explicit Waiting, blocker, dependency, or overdue evidence drives recovery missions | Open |
| P1-55 | Confirmed | A5.6, A6.2 | Mobile + QA/Release | Android system Back follows explicit route history across nested screens and never exits/backgrounds unexpectedly; lifecycle cleanup verified | Open |
| P1-56 | Confirmed | A1.1, A5.2 | Mobile + Intelligence | Opening any update binds or derives its project context; Back, Talk, reports, and actions remain on the same project in A/B tests | Open |
| P1-57 | Partial — reopen now requires explicit user transition, unit-tested (0be2ef58); device regression pending | A1.1, A2.2, A5.6 | Mobile | Schedule mutations create missing parents without changing archive state; only explicit user transition can reopen an archived project | Open |
| P1-58 | Confirmed | A2.2, A5.6 | Mobile | Cover hydration uses immutable version/generation compare-and-swap; delayed old bytes cannot overwrite a new or removed cover | Open |

## P2 — Build, test, privacy, platform, and maintainability

| ID | Current status | Workstream / action ID | Owner role | Required proof | State |
|---|---|---|---|---|---|
| P2-01 | Snapshot-resolved | A0.2, A6.1 | QA/Release + Technical Lead | `.env.example` is tracked and Build 56 `qa:release` passes from a clean clone with no untracked fixture or ignored native dependency | Closed |
| P2-02 | Confirmed | A6.1 | QA/Release | Current Overview, Tasks, Talk, and Reports Maestro flows execute on iOS and Android in CI and cover real camera/file/update journeys | Open |
| P2-03 | Partial | A6.2 | Mobile + QA/Release + Security | Choose generated or committed native policy; signed Android artifact matches current build, release keystore, least permissions, and backup policy | Open |
| P2-04 | Partial | A6.2 | Mobile + QA/Release + Security | Actual signed iOS source/artifact, entitlements, privacy strings, capabilities, and build settings are reproducible and reviewed; ignored-native caveat resolved | Open |
| P2-05 | Confirmed | A6.1 | QA/Release + Technical Lead | Default test runs type checks plus Jest; clean CI performs install, checks, unit/behavior tests, exports, secret scan, and migration validation | Open |
| P2-06 | Partial | A6.1 | QA/Release + Technical Lead | Fresh clean-clone coverage report includes live App, screens, providers, authority, parser, persistence, sync, file, and photo paths with approved thresholds | Open |
| P2-07 | Confirmed | A6.1 | QA/Release + Technical Lead | Static contracts are labeled separately and executable adversarial tests prove each release-critical invariant can fail and recover behaviorally | Open |
| P2-08 | Confirmed | A6.2 | Mobile + QA/Release | VoiceOver, TalkBack, large text, contrast, focus order, reduced motion, and real-device performance profile pass with explicit control roles/labels | Open |
| P2-09 | Confirmed | A6.3 | Product/PM + Technical Lead | Web is either removed from supported scripts/docs or dependencies, export, runtime, and CI are added and passing | Open |
| P2-10 | Confirmed | A6.2 | Mobile + QA/Release | Android OCR is implemented and device-tested or screenshot import is hidden/labeled by platform capability and signed build | Open |
| P2-11 | Confirmed | A6.3 | Technical Lead | Live domains are extracted after behavioral stabilization; unreachable code removed; import boundaries and complexity rules replace moving line ceilings | Open |
| P2-12 | Partial | A6.3 | Product/PM + Technical Lead | One product name/version source generates app config, About, artifact metadata, README, and current test guides with no obsolete flow claims | Open |
| P2-13 | Confirmed | A6.3 | Product/PM + Technical Lead | Legal owner/license decision is documented and the template license is replaced or explicitly approved | Open |
| P2-14 | Snapshot-resolved | A6.3 | Technical Lead + Security | `.claude/settings.local.json` is not tracked and the clean clone confirms local settings stay ignored; ignored native artifacts remain tracked separately in their dedicated platform rows | Closed |
| P2-15 | Partial | A6.4 | Security/Privacy + Mobile | Clean production dependency audit records current advisories, remediates direct/runtime risk within Expo compatibility, and documents accepted residuals | Open |
| P2-16 | Confirmed | A6.4 | Mobile + QA/Release | React and testing-library peer graph is compatible without an unsafe override and full Jest/React Native tests pass | Open |
| P2-17 | Confirmed | A6.4 | Security/Privacy + Data/Supabase | Arbitrary endpoint is removed or owned proxy enforces auth, allowlist, consent, audit, retention, timeout, and size limits in staging tests | Open |
| P2-18 | Confirmed | A4.3, A6.4 | Security/Privacy + Data/Supabase | Provider retention option is explicit and tested; privacy/data-flow documentation matches deployed edge behavior | Open |
| P2-19 | Confirmed | A6.4 | Security/Privacy + Mobile | Corrupt queue bytes are quarantined unchanged, valid empty queue initializes separately, and recovery/export plus retry tests pass | Open |
| P2-20 | Confirmed | A6.2 | Mobile + QA/Release + Product/PM | Theme policy is explicit, system UI support is compatible if selected, and font/asset optimization passes both-platform visual/device regression | Open |

## Ledger checkpoint

- **Expected finding count:** 90
- **Expected identifier coverage:** all sequential audit identifiers in the 12-item release-blocker range, 58-item high-priority range, and 20-item release-engineering range
- **Closed at baseline:** P0-01, P2-01, and P2-14
- **All other findings:** Open until their required proof is attached and reviewed
