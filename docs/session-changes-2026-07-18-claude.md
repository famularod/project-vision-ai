# Session Change Log — 2026-07-18 (Claude / Cowork session)

**Branch:** `codex/dave-audit-stabilization-2026-07-18`
**Session commit range:** `8cf410cb` → `5eb2ffcb` (33 commits)
**Verification at session end:** TypeScript clean · Jest 50 suites / 430 tests passing · live device test passed (app stable on physical iPhone after 6 field-diagnosed fixes)
**Note:** Commits after `5eb2ffcb` (from `f37be67b` onward, including Build 57 and touch-responsiveness work) are from a separate session and are NOT covered here.

---

## 1. Landed pre-existing work in progress

**`8cf410cb`** — Committed 37 files of uncommitted stabilization work found in the working tree (verified typecheck + tests first). Covers audit findings P1-19 (PlainDate/Instant timezone safety), P1-20 (schedule import provenance), P1-47 (conflict-safe reality history resend), P1-48 (cloud pagination), P1-11/P1-26 (shared photo-analysis contract).
New services: `ProjectDateTime.ts`, `ScheduleImportProvenance.ts`, `SupabaseCollectionPagination.ts`, `PIERealityHistoryIntegrity.ts`, `supabase/functions/_shared/pie-photo-analysis-contract.ts`.

## 2. Audit findings fixed (code + behavioral tests)

| Finding | Fix | Commit | Key files |
|---|---|---|---|
| **P0-14** Auth token security | SecureStore-backed auth adapter with chunking past the ~2KB limit, torn-write detection, one-time migration of legacy AsyncStorage sessions; `android.allowBackup=false`; probe tests the real adapter. 8 tests. | `301a365b` | `services/SupabaseAuthStorage.ts` (new), `services/SupabaseService.ts`, `app.json` |
| **P1-57** Silent un-archiving | Background schedule mutations can no longer reopen archived projects; reopening requires the explicit user-approved import path. 4 tests. | `0be2ef58` | `services/PIEScheduleImportBatch.ts`, `App.tsx` |
| **P1-27** Silent empty cloud reads | Per-collection `collectionErrors` on every download; `downloadStatus: complete\|partial`; lastSync stamped only on complete downloads; App applier skips failed collections; legacy migration aborts cloud deletions on incomplete downloads. 5 tests. | `95e3507a` | `services/SyncService.ts`, `App.tsx` |
| **P1-40** False "sent" reports | Mail/SMS composer results mapped to completed/canceled/unknown; only real completion marks a report communicated; state resets when report identity (project selection) changes. 3 tests. | `1998faa1` | `services/ReportCommunication.ts` (new), `screens/ReportsScreen.tsx`, `App.tsx` |
| **P1-41** Restore resurrecting projects | Backup restore rebuilds the canonical `projectRecords` repository (not just the names array); dropped records cannot return on relaunch. 3 tests. | `d5dce13f` | `services/ProjectIdentity.ts`, `App.tsx` |
| **P1-28** Tombstone journal durability | Corrupt deletion-history bytes quarantined (first payload preserved for forensics) instead of becoming `[]`; unacknowledged uploads counted and surfaced as visible sync errors. 5 tests. | `ef85a314` | `services/DAVESyncTombstones.ts`, `services/SyncService.ts` |
| **P1-37** Corrected decisions ignored | `currentDecisionSnapshot()` resolves `versions[currentVersion]` for validation, Layer-4 automation, and UI; the original snapshot is audit-only; identity links match current OR original. 4 tests. | `e5b7fe7c` | `services/PIEDecisionLedger.ts`, `services/PIELayer4Automation.ts`, `screens/ReportsScreen.tsx` |
| **P1-38** Cloud judgments never superseded | Supersession derived from the append-only history (first later judgment with a different recommendation); stale cloud judgments can no longer read as active. 4 tests. | `7c2ad3c0` | `services/PIEExecutiveJudgmentRepository.ts` |
| **P1-50** Ask/Talk races | Questions ignored until history hydrates (no more overwriting saved history); history capped at 100 entries; write failures visible; typed-capture Continue non-reentrant. 2 tests. | `0791d89d` | `services/DAVEAskConversation.ts`, `components/DAVEAskExperience.tsx`, `components/DAVETypedCaptureSheet.tsx` |
| **P1-23** (partial) Stuck uploads | Documents still marked `uploading` at startup recover to retryable `failed` (an upload can't survive relaunch). 2 tests. | `a2f16ffa` | `services/ProjectDocumentLifecycle.ts` (new), `App.tsx` |
| **P1-43** Cancel during memory save | Cancel (button, close icon, system back) inert while a capture save commits; state labeled accurately. | `bb66f90c` | `components/DAVECaptureConfirmationSheet.tsx` |
| **P1-56** Wrong project context | Opening a sent/queued update binds the workspace to that update's project — Back/Talk target the right project. | `e972b006` | `App.tsx` |
| **P1-58** Stale cover photos | Cover hydration applies only via version compare-and-swap; a cover selected/removed mid-download can't be overwritten. | `82296b4e` | `App.tsx` |
| **P1-13** Beliefs fed unrelated evidence | Evidence attaches to a belief only with subject overlap (all 10 sources); removed the two OR-clauses that made relevance optional; prior beliefs drive lifecycle (history carry-forward, explicit retirement); retired beliefs excluded from readiness/confidence. 9 tests. | `faedf096` | `services/PIEBeliefEngine.ts` |
| **P1-51** Judgment trace pollution | Assertions and trace evidence flow only through the judgment's chosen supporting objects. 2 tests. | `12eb36ca` | `services/PIEExecutiveJudgmentRepository.ts`, `services/PIETraceability.ts` |
| **P1-03** One strong item = "strong" | Readiness reflects the whole evidence base: majority-insufficient blocks; average drives the level (audit's 1-strong+9-insufficient reproduction now reads insufficient). 6 tests. | `35cbc121` | `services/PIEEvidenceQuality.ts` |
| **P1-14** ECOS unsafe ranking | Unknown confidence normalizes to low; safety hard-gate disqualifies hazard-dismissing options (score 0, blocked); deterministic content-based scoring — "Ignore confirmed hazard" can never outrank "Stop and inspect". 6 tests. | `be427b3d` | `services/ECOSCognitiveFramework.ts` |
| **P1-02** Fabricated freshness/confirmation | Runtime evidence carries real captured timestamps from underlying sources (photo capture, schedule import, GPS/note/issue/safety); analysis run time never used; notes confirmed only with an actual user note; derived issue/safety summaries never auto-confirmed. 5 tests. | `cfa4b546` | `services/PIECoreIntelligence.ts` |
| **P1-42, P1-09** | Verified already fixed by prior commits (`bf67e3ee`, capture-timestamp work) — no new code; ledger updated. | — | — |

## 3. Device crash debugging — six field-diagnosed fixes

First physical-device run of the stabilization branch. All six bugs passed every static gate and 400+ tests; only live testing caught them.

| # | Bug | Fix | Commit |
|---|---|---|---|
| 1 | **Startup hydration oscillation** — a cloud phase failing inside a hydration effect filed its error under the local hydration key; the next local pass cleared it; `startupHydrationReady` flipped forever, re-running every ready-gated effect (Maximum-update-depth errors + Supabase call flood) until iOS killed the app. | Readiness latches one-way after first full hydration; cloud phases in the saved-updates and projects effects isolated so their failures are sync concerns, never local hydration failures. | `6cb61485` |
| 2 | **Log flood + auth-event churn** — `getSupabaseClient` logged on every access (native-bridge cost); identity refresh could spin on auth-event bursts. | Log-once per context; identity refresh gains in-flight guard + 2s minimum interval. | `e532eb15` |
| 3 | **Boot crash (my own bug)** — the log-once Set was declared below the module-load client creation; temporal dead zone crashed app boot ("App entry not found"). | Set declared with top-of-file constants; declaration order asserted in the commit check. | `d342d1e2` |
| 4 | **30-second re-stamping storm** — while signed out, every queued-update pass re-stamped all queued updates with fresh timestamps: full saved-updates disk write + authority input change per pass. | Stamping is idempotent; unchanged updates are skipped; a no-op pass writes nothing. | `c9e4a0ca` |
| 5 | **Every-launch photo re-upload** — the legacy-migration effect fell through to a full `synchronizeLocalData` (base64-encoding and uploading every photo of every update) whenever the cloud project listing failed, at every app start. Matches the crash report: 84% CPU for 107s. | Per audit P1-21: unverifiable inventory skips the migration; the heavy path runs only when verified legacy cloud projects exist. | `a13f421a` |
| 6 | **ROOT CAUSE — follow-through fixpoint violation** — `planDAVEFollowThrough` re-stamped `lastSeenAt` on every call; the App effect persists plan output and feeds it back as input, so every pass differed by milliseconds: infinite setState + full JSON disk write per cycle. Introduced 07-13 — the exact date the device's `diskwrites_resource` kills began. Located via the loop diagnostic naming App.tsx:18878, confirmed by the `cpu_resource` crash report. | `lastSeenAt` moves only on creation and genuine reactivation; replanning over its own output is provably identical. 2 fixpoint regression tests. | `5eb2ffcb` |

Diagnostics built along the way: temporary loop diagnostic in `index.ts` printing React's component stack to Metro (`3dc70465`; since removed by the follow-on session) and a core-pipeline scale harness proving the DAVE brain runs in ~1.2s at real data scale (`aeff3685`, kept as a regression test).

## 4. Documentation / process

- **Ledger reconciliation** (`57a285e5`): 23 stale "Confirmed" rows moved to "Partial" after verifying each prior commit's file footprint against its finding (P0-02/03/06/09/10/11, P1-06/07/08/10/15/17/18/44/45/46/52/53, P2-02/05/16/18/19). Flagged the unapplied Truth-history SQL migration in `e095fab0` (needs your sign-off + `supabase db push` before it's live).
- **Ledger progress updates** (`fd608a6e`, `8175fbbf`, `4aeac086`, `ede5b5ee`, `f85242a8`): commit-referenced status for every finding fixed this session.
- **P2-14 completed**: `.claude/settings.local.json` added to `.gitignore` (was untracked but not ignored).
- **Ledger standing at session end:** 1 Resolved · 2 Snapshot-resolved · 60 Partial (code landed, device/staging proof pending) · 27 Confirmed open.

## 5. Dependencies added

- `expo-secure-store@~15.0.8` (+ config plugin in `app.json`) — required for P0-14. This is a native module: any install needs a full native rebuild, not a JS-only update.

## 6. Known open items (handed to next session)

1. Idempotency-key regression caught by `test:behavior` ("Initial send must create one stable idempotency key from the draft id").
2. Typing-lag performance: draft keystrokes re-serialize the full authority input; fix is per-collection sub-signatures. (The follow-on session's "keep touch interactions responsive" commit may address this — verify.)
3. Ledger records for the six device findings above.
4. 10 services not statically reachable from the app entry (service-architecture gate failure) — built but un-wired remediation code, including the UUID migration and photo-analysis coordinator.
5. Unapplied SQL migration from `e095fab0` (requires sign-off).
6. `qa:release` full pass + the working agreement's normal PR flow for this branch.
