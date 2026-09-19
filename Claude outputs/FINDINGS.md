# FINDINGS — Vitruvius whole-app audit (2026-09-17)

Read-only static audit plus offline test runs in scratch copies. No cloud, device, database or provider access.

## How to read this

- Paths are relative to `R = vitruvius-beta-readiness-2026-09-13` unless they start with `v11/` or `v12/`.
- **Severity.** P0 = silent data loss, security breach, or a core promise that does not work. P1 = serious reliability/integrity defect a beta user will hit. P2 = real defect with a workaround or limited blast radius. P3 = polish/hygiene.
- **Evidence level.** `[L]` = the lead auditor re-read the cited lines. `[A]` = traced by a delegated auditor and not independently re-read line by line. `[H]` = hypothesis, not confirmed. Treat `[A]` items as strong leads that the fixer must re-confirm; several were spot-checked and none of the spot checks failed.
- **Effort.** S = up to 1 day, M = 2 to 5 days, L = 1 to 3 weeks. Assumes one engineer (or AI pair) who knows the code, includes the regression test, excludes device acceptance and App Review.
- Platforms: iOS/iPadOS = "mobile"; Android is configured but has no OCR module and no evidence of a beta target; "desktop" = the web export.

---

## A. Startup, identity, accounts, local data

### ID-01 — Sign-out or account switch deletes unsynced photos `[L]` P0, confidence high
- Where: `app/App.tsx:3040-3073` (`cleanupStoredPhotoDirectory` deletes every file in the shared `documentDirectory/project-photos/` not referenced by the CURRENT draft + saved updates); called once per mount at `app/App.tsx:6316-6324`; folder is not owner-scoped (`app/App.tsx:898-901`).
- Reachable: `entry.ts:156-158` remounts `App` with a new key on every owner change, resetting the `photoCleanupRan` ref. On `SIGNED_OUT` the sandbox moves the owner's keys out of canonical storage (`services/OwnerStorageSandbox.ts:167-174`), the new mount loads `savedUpdates = []`, and the cleanup deletes every photo file.
- Impact: queued, not-yet-uploaded photos are permanently destroyed. Supabase emits `SIGNED_OUT` by itself when a refresh token is revoked/invalid, so no user action is required. Platforms: mobile.
- Repro: capture an update with photos offline, sign out in Admin, sign in again. Photos show "not available".
- Fix: owner-scope the photo folder or make cleanup consider every owner namespace and the sync queue; never run cleanup when owner is null or within N days of an owner transition; quarantine instead of delete. Related: REL/PHO-07 (quarantined records).
- Regression test: fake FileSystem; owner A has queued update with file X; `activateOwner(null)`, mount App, `activateOwner('A')`; assert X exists. No current test references this function.
- Effort: M. Depends on: nothing.

### ID-02 — Work created while signed out is destroyed at the next sign-in `[L]` P1, confidence high
- Where: `services/OwnerStorageSandbox.ts:92-109` (legacy assignment only when `legacyAssignedOwnerId === null`; afterwards `sourceOwnerId = null` so the source snapshot is empty) and `:167-174` (`multiRemove` of every canonical key). The code comment states the intent ("never silently assigned"), but the effect is deletion, not hiding, and the journal holds nothing to recover.
- Reachable: the native app has no login gate; sign-in is lazy (`App.tsx:9836-9870`, `AdminScreen`). A signed-out user can create projects and updates normally.
- Fix: snapshot the anonymous workspace into a reserved namespace and offer a merge on sign-in, OR add a login gate (smallest change; also removes part of ID-01).
- Regression test: extend `tests/services/owner-storage-sandbox.test.ts`: activate A, activate null, write key, activate A, assert key recoverable.
- Effort: S (gate) or M (merge).

### ID-03 — Offline startup blocked after the access token expires `[A][H on library behaviour]` P1, confidence medium
- Where: `services/SupabaseService.ts:597-614` waits 1.5 s for auth hydration, returns `ok:false` on timeout/error; `entry.ts` `NativeRoot` throws on `!ok` and shows "Workspace protection needs attention"; `App` never mounts.
- Impact: opening the app on a no-signal site more than about an hour after last use may block all local data. Existing "offline" test mocks `getCurrentSessionUser` to ok (`tests/components/native-field-notes-startup.test.tsx:22-26,59`), so it skips this path.
- Fix: fall back to `metadata.activeOwnerId` when the network is unavailable; treat only explicit `SIGNED_OUT` as identity change.
- Verify first: airplane mode, wait past token expiry, cold start. Effort: M.

### ID-04 — Missing Supabase config bricks the local-first app `[A]` P2 — `SupabaseService.ts:2998` + NativeRoot error screen. Fix: treat `configured:false` as signed-out. Effort S.

### ID-05 — Proof endpoint hard-coded to one Supabase project; user JWT sent to it `[L]` P2
- Where: `app/services/ECOSProtectedDocumentPage.ts:8-9`; every other call derives from `EXPO_PUBLIC_SUPABASE_URL`. A staging build would send its JWT to production and show a misleading sign-in error. Fix: derive from configured URL (+ allow-list). Test: endpoint host equals configured host. Effort S.

### ID-06 — Local data is plaintext and survives logout; report snapshots are not owner-scoped `[A]` P2
- `@vitruvius/report-snapshots/v1:*` falls outside `isOwnerSensitiveCanonicalStorageKey` (`OwnerStorageSandbox.ts:153-160`). No "remove this account's data from device" action. iOS relies on default file protection. Effort S-M.

### ID-07 `[H]` — In-flight sync could cross owners: queue items carry no owner id and the upload pass is module-level (`services/SyncService.ts`). Needs a runtime test: slow upload, switch owner, assert abort. P1 if confirmed.

Working well `[A]`: tokens in SecureStore only, chunked, fail-closed (`SupabaseAuthStorage.ts`); web tokens in tab-scoped `sessionStorage`; journaled owner transitions with recovery, exercised by real-code tests; remount on owner change; only 5 `console.*` calls, none log tokens/PII; no key literals in source; production secret guard runs on config evaluation; dev sign-up double-gated.

---

## B. Projects, tasks, schedules, areas, GPS

### SYNC-03 — Project creation is not idempotent; projects are addressed by name `[A]` P1, confidence medium-high
- Where: `services/SupabaseService.ts:1138-1142` plain `insert`, no client id; random queue id (`SyncService.ts:4339`); no unique constraint on projects found in migrations. Update/delete/`dave_delete_project_atomically` address by name.
- Trace: insert commits, response lost, retry inserts a second row with the same name. Later edits hit an undefined duplicate.
- Fix: client-generated UUID + upsert; unique index `(owner_id, lower(name))`; treat 23505 with a matching row as success. Test: cloud resolves but client sees error; after retry exactly one row. Effort M (+L if duplicates already exist; check with `select lower(name), count(*) from projects group by 1 having count(*)>1`).

### ARCH-05 / PHO-05 — Project identity is a slug of the name `[A]` P2 — `App.tsx:14384-14392`; cover path `project-covers/project-<slug>/cover.jpg` uploaded with `upsert:true` (`SyncService.ts:3975-3980`). "Main St" and "Main St." overwrite each other; rename orphans the cover and photo-analysis identity. Fix: use `ProjectRecord.id` everywhere. Effort M.

### SCH-01 — Lookahead treats "today" as the UTC day `[A]` P2, confidence high
- `services/VitruviusLookahead.ts:54,203` and the same `toISOString().slice(0,10)` in `VitruviusScheduleAnalytics.ts:292`, `VitruviusScheduleChangeScenario.ts:349`, `DAVETaskAreaSummary.ts:139-140`. At 6 pm Pacific, tasks due today show overdue; the task list (timezone-aware) disagrees with the lookahead. Tests pin "today" to noon UTC. Fix: derive the day from `ProjectDateTime`. Test: 01:30Z, `America/Los_Angeles`. Effort S.

### SCH-02 — Only one schedule document can be "current" across ALL projects `[A]` P1 for multi-project use
- `services/PIEScheduleReconciliation.ts:155-159` (`.slice(0,1)`), `:280-290`, `App.tsx:11394-11396`; items from a non-active import batch are dropped (`:224-231`). Making project B's schedule current removes project A's imported tasks from the Schedule screen, PIE, reports and Talk. No test covers it. The owner runs three building projects, so this is directly relevant. Fix: scope "current" per project. Effort M.

### SYNC-05 — Cross-device task edits can lose a write `[A][H]` P2
- Mobile reads all schedule items, merges, then blind whole-row `upsert` with device-clock `updated_at` (`SyncService.ts:3840-3905`, `SupabaseService.ts:1594-1606`). Desktop uses an atomic `updated_at` guard. A desktop edit or delete landing between mobile read and write is overwritten; a deleted task is re-created under a live tombstone and becomes a hidden row (see WEB-01). Fix: DB trigger rejecting tombstoned ids + compare-and-set RPC + server `now()`. Effort M.

### SYNC-08 — New-project tasks fail their first two upload passes `[A]` P3 (`SyncService.ts:3665`). Upload project creates first. Effort S.

### SCH-03 — Reminders do not exist `[A]` P2 if in beta scope. No notifications/background-fetch/NetInfo dependency; reconnect is detected only via realtime, foreground or the 5 s to 15 min retry timer. No background sync.

### GPS-01 — GPS accuracy (metres) is added to distances in feet `[L]` P2, confidence high
- `app/App.tsx:2474-2479` (`distanceFeet + accuracy <= radiusFeet`) and `:2517-2522` (`max(75, accuracy*2)`); `accuracy` is `coords.accuracy` in metres. Uncertainty is understated 3.28x, so the wrong area can be suggested as a clear winner. Mitigation present: area is suggested, not auto-assigned. Fix: convert, reject fixes worse than about 100 ft, add timeout. Effort S.

### GPS-02 — GPS re-acquired on every data change `[A]` P2 — effect deps `[activeProjects, projectAreas, savedUpdates, scheduleItems]` at `App.tsx:6750-6807`; battery + first-launch prompt without context. Effort S.

### ARCH-06 — Customer-specific and developer artefacts ship in the client `[A]` P2 (P1 before any second customer)
- `App.tsx:954-969, 1036-1037, 1127-1213` (named projects/areas/coordinates seeded for any user with no local store, `:5846, 5985`), new areas created with those coordinates (`:9215-9216`), a customer email-domain branch in `sendEmail` (`:9352-9355, 10030-10034`), a production alert telling the user to run `npx expo run:ios` (`:9297-9299`), `services/PIEReporter.ts:479-481`, `services/CrossDeviceVisibility.ts:2-7`. Fix: empty defaults, null coordinates, remove branches. Effort S-M.

Working well `[A]`: offline queue (journaled transactions, single-flight passes, reconciliation of work enqueued mid-pass, quarantine of corrupt queues, deletes outrank writes) with about 60 real-logic tests against an in-memory store; retry controller 5 s to 15 min wired per owner; durable field-update save with idempotency key and verified read-back before the "saved" alert; tombstone-first task deletes that fail closed; timezone-aware task list; CSV schedule parser (8 unmocked tests); schedule engine with cycle detection and preview-before-apply; schedule-to-field reconciliation is advisory only (15 behavioural tests).

---

## C. Field Notes

### SYNC-01 — A note edited before its first cloud acknowledgement sticks forever as a conflict `[L]` P1, confidence high
- Where: `services/FieldNoteMobileSync.ts:49-59` (`syncOne` returns the older in-flight promise), `:64-82` (revision 0 means create; 23505 becomes `conflict`), `:160-168` (`local.revision === 0` -> `markFieldNoteConflict`), `:89-95` (`retryPending` only retries `pending`). The only conflict UI is a badge (`components/field-notes-workspace.tsx:773, 866`).
- Trace: save note (rev 0, create in flight or response lost) -> tap Resolve -> local still rev 0 -> next retry creates -> duplicate key, content differs -> conflict -> never retried, no resolve action. The resolve/archive never reaches desktop.
- Fix: when local rev 0 and the cloud row has the same id and createdAt, rebase (adopt cloud revision, keep local fields, stay pending, update). Add keep-mine / keep-cloud UI. Test: deferred create, change status, release, `retryPending`, expect `synced` + cloud status resolved. Effort M.

### SYNC-02 `[H]` — A lost create response may always be misread as a conflict because local timestamps end in `Z` and PostgREST returns `+00:00`; `sameFieldNoteContent` stringifies raw values (`FieldNoteCloudGateway.ts`, `FieldNoteRepository.ts:445`). The test builds its "cloud" row from the local string. P1 if confirmed. Fix: normalise with `new Date(x).toISOString()`. One live row settles it. Effort S.

### SYNC-06 — Double tap on Save can create two notes `[A]` P3 (`field-notes-workspace.tsx:230-237`, state guard not ref). SYNC-07 — status change blocks UI on the network `[A]` P3 (`:288`). Both S.

Working well `[A]`: every local write is read back and verified under a lock; local-first save with immediate confirmation; revision compare-and-swap on cloud updates; realtime reconnect; owner switch never reuses the previous owner's inbox or draft (real sandbox + repository test).

---

## D. Photos and field updates

### PHO-02 — Library photos are stamped "now" with the device's current GPS; AI baseline ordering uses that time `[A]` P1, confidence high
- `App.tsx:9519-9524` (picker without `exif:true`), `:3074-3099` (no `capturedAt`), `:9670-9686` (draft GPS + `locationCapturedAt || now`), `services/PhotoAnalysisIdentity.ts:150-160`, `PIEPhotoVisionMobileWorkflow.ts:1165`. A month-old photo imported today becomes the newest; before/after comparisons run backwards; reports cite the wrong time and place (`App.tsx:12933`). Fix: read EXIF DateTimeOriginal, immutable `capturedAt`, mark GPS unknown for imports. Effort M.

### PHO-07 — Startup cleanup deletes files belonging to quarantined (salvaged) records `[A]` P2 — `App.tsx:6316-6324` + `StartupRecovery.ts:233-253`. Same root as ID-01; fix together.

### PHO-06 — Saving a cover photo rewrites the whole `project_data` from a stale snapshot `[A]` P2 — `App.tsx:8781-8784`, `projectService.ts:56`, `SupabaseService.ts:1166`. Remote cover never deleted on removal; fixed path + `cacheControl 86400` can serve a stale cover. Fix: JSONB merge RPC, versioned cover path. Effort M.

### PHO-10 — Resumable upload captures the access token once `[A]` P3 (`ResumableStorageUpload.ts:130-133`); slow uploads 401 until the next pass. No per-photo progress; no post-upload size/hash check. Effort S.

### PHO-H1 `[H]` — HEIC passes validation and is sent to the vision provider by signed URL with no server conversion (`pie-photo-vision/index.ts:1342`, `pie-vision-provider.ts:160`). PHO-H2 `[H]` — removing one photo from an update leaves its cloud object.

Working well `[A]`: photo-vision edge function (JWT -> owner check -> 64 KB bounded body -> server-derived ids -> canonical path -> rate-limited idempotent operation ledger -> `store:false`); baseline selection rules are sound given correct time; upload failure classification never drops a record when cloud availability is uncertain; tus above 6 MiB with content-hash fingerprint; server-side cleanup intents with receipts.

---

## E. Reports and the PIE "authority" layer

### REP-01 — Any review flag blocks approval and ALL sharing, with no acknowledge path `[L]` P1, confidence high on code
- `services/ReportApprovalPolicy.ts:21-45` fails closed on any entry of `reviewFlags`; `services/PIEReporter.ts:1322-1337` unions 14 sources; several are near-permanent heuristics (pattern confidence is "low" whenever there are no matches, `PIEPatternEngine.ts:671-709` -> flag at `PIEReporter.ts:1720`; any recommended evidence `:1584`; any unknown `:1893`; any Blocked/At Risk area `:1101-1126`). `screens/ReportsScreen.tsx:645-720` only lists "Fix before approval". Tests feed `reviewFlags: []` by hand; no test builds a report from realistic data and asserts it is approvable.
- Impact: the projects that most need a report (something blocked) cannot share one. Fix: split blocking vs advisory; per-flag "reviewed" acknowledgement bound to a source fingerprint. Effort M.

### PIE-01 — Ordinary data puts the reality model in `conflict_blocked`, which denies report generation, with no resolution UI and a false message `[L]` P1, confidence high on code, frequency unverified
- `services/PIERealityModel.ts:1616-1631`: two objects of the same type and area are "duplicate candidates" when one name contains the FIRST 8 normalised characters of the other ("install drywall l1" / "install drywall l2"); every schedule activity is an object. `:1532` feeds them into `buildModelConflictRecords` -> `evidenceConflicts` (`:860-888`); `services/PIERealityModelOrchestrator.ts:231-233` -> `conflict_blocked`; provider policy -> `reportGenerationAllowed:false` `[A]`. `PIERealityModel.ts:1466` `[A]` also flags any text matching `/contradict|conflict|disputed/i` ("resolved conflict with plumber"). Reports screen says "data is still loading" `[A]` (`ReportsScreen.tsx:371-372`).
- **Ten-minute device check that decides REP-01/PIE-01 severity:** open Reports on the real 2375 project and try to approve. If approval is unavailable, treat both as P0 for the Reports feature.
- Fix: duplicates and keyword hits become advisory flags; block only on cross-source contradictions; add dismiss/resolve; correct the message. Test: 30 realistic tasks with shared prefixes + a note containing "conflict" -> `reportGenerationAllowed === true`. Effort M.

### PIE-03 — Signed-in user who goes offline loses authority; reports blocked in the field `[A]` P1 — `cloudAvailable` derives from identity not reachability (`App.tsx:13527-13530`); cloud save failures throw (`PIERealityModelRepository.ts:85-92`, `PIEExecutiveJudgmentRepository.ts:128-135`) -> `unavailable`/`persistence_failed`. Fix: treat as `queued_for_cloud`. Effort M.

### PIE-04 — `authoritative_local` is never produced and the acknowledgement resets on every edit `[A]` P1 — orchestrator lines 143-232; provider `:546-549, 582-584, 716-725`. Effort S.

### PIE-06 — PIE runs on the JS thread and writes to the cloud on every typing pause `[A]` P1 (performance + cost)
- Typing calls `setDraft` (`App.tsx:13681`); `draft` is in `liveAuthorityInput` (`:13540`); `buildDAVEProjectTruth` reruns in render per keystroke (provider `:557-568`); after 500 ms idle a full runtime + reality sync runs and, because the unsaved draft is evidence (`PIEEvidenceFusion.ts:385-386`), bumps the model version -> cloud upsert + 7 detail tables + judgment row + truth snapshot. Much of the computed output (`attention`, `experience`, `predictiveReality`, `situationIntelligence`) is never rendered; `components/PIEPanel.tsx` has no importer. Fix: exclude the unsaved draft from authority, compute truth from the debounced snapshot, throttle persistence, stop computing unrendered outputs for beta. Effort M.

### PIE-07 — Conclusions go stale with no "as of" `[A]` P2 — no refresh on foreground/day rollover (provider `:511-527`); home shows `briefing.nextActions[0]` with no timestamp (`App.tsx:14527-14534`). Effort S.

### REP-08 — Previous-period snapshot is overwritten at Approve, not at Send `[A]` P2 (`ReportsScreen.tsx:513-520`); approval is component state, not a record. REP-09 — Word export returns "completed" without knowing the outcome and embeds original photo bytes incl. possible EXIF GPS `[A]` P2/P3 (`App.tsx:10316-10333`, `ReportWordMedia.native.ts:150-166`). No PDF export exists.

Working well `[A]`: report text is deterministic (no LLM in `PIEReporter`, `DAVEReportIntelligence`, `ReportWordDocument`); AI photo findings enter reports only through an explicit gate; fail-closed project scoping; communication gated on approval with honest mail/SMS outcomes; provider state machine guards stale results.

---

## F. Backup, restore, disaster recovery

### BAK-01 — Backup omits project records; restore rebuilds projects as name-only `[A, payload lines L]` P1
- `App.tsx:10540-10553` exports `projects` as names; `services/ProjectIdentity.ts:125-134` returns `{name}` for unknown projects. Decision ledger, reality model, report snapshots, walk sessions, sync queue and Field Notes are not in the payload; the UI only discloses Field Notes. A restore to a new phone loses project UUIDs, project data and cover metadata. Fix: export full `projectRecords` + covers, version the payload, list exclusions. Effort M.

### BAK-02 — Backup is all-or-nothing, in memory, under a 128 MB cap `[A]` P1 for practical use — `BackupExportPolicy.ts:7,26`; one unrecoverable photo aborts everything (`App.tsx:10405-10420`). Roughly 40 to 60 photos plus drawing PDFs exceed the cap. Fix: streamed per-asset container, per-project scope, explicit missing-asset manifest. Effort L.

### BAK-03 — No cloud/account/scheduled backup exists; the orchestration layer in `App.tsx` (`exportBackup`, `materializeCompleteBackupState`) has no test. P2.

Working well `[A]`: AES-256-GCM per section with AAD, PBKDF2 210k, manifest + per-asset SHA-256 (4 real-crypto tests); journaled restore commit with immutable deletion barriers and recovery before startup read (11 real-logic tests).

---

## G. Documents, drawings, indexing

### IDX-01 — A sheet number the mapper marks "verified" makes assurance reject the page and fail the WHOLE document `[L]` P1 (P0 for onboarding new drawing sets), confidence high
- `app/workers/ecos-indexer/ecos_indexer/sheet_mapping.py:242-250` returns `status:"verified", source:"coordinate_text", evidence:[]`; `assurance.py:106-111` + `:215-223` accept `verified` only from `pdf_bookmark | native_title_band | pdf_annotation_title_band` with non-empty evidence, else `sheet_provenance_invalid`; `worker.py:264-265` `[A]` raises a permanent error -> `needs_review`. Perverse result: a clean title block fails the PDF, a poor one (unverified) is accepted. `tests/test_sheet_mapping.py:12-24` asserts `verified` for exactly this shape; no test pipes `map_sheet` into `assure_page`.
- Fix: downgrade a `coordinate_text` winner to `unverified` (keep candidate), or add a validated provenance class in assurance and the SQL payload. Test: C6 fixture through both functions, expect accepted. Effort S.

### IDX-02 — Regions that can never resolve burn all 8 retries and fail the document `[A]` P1 — `extraction.py:3381-3398` emits `page-overview`, `low-text-page`, `title-block`; `visual.py:27-32` marks them not fact-resolvable; `worker.py:427-447, 253-262`. A blank separator or photo sheet blocks the other pages from ever publishing. Fix: blank/low-text pages become assured-empty; exhausted exceptions become page limitations. Test: 3-page PDF with blank page 2 reaches `ready`. Effort M.

### IDX-03 — Printed count labels now add a blocking visual exception on ordinary pages `[L line, A chain]` P1 — `extraction.py:453` `unresolved.extend(count_read_exceptions(count_targets))` is unconditional (uncommitted change); any `QTY/QUANTITY/COUNT/OCC LOAD` label creates one; the preview function rejects non-shadow jobs (`ecos-analyze-drawing-page-preview/index.ts:237`, `count-read.ts:12`) so under live publication it cannot resolve. Schedule and legend sheets commonly carry QTY columns. Fix: env-gate like notes, or make non-blocking. Effort S.

### IDX-04 — Sheet identity is tuned to two benchmark projects `[A]` P1 for usefulness — `document_structure.py:16-20, 48-78` (bookmark grammar `<key> - <sheet>`, title bands only `WPA/WPB/WPC-n`, `L-n`, civil `Cn` in fixed boxes); `assurance.py:301-308` hard `False` for other prefixes. Outside those layouts expect near 0% structural identity: sheets end `unverified` (Ask ECOS then rejects any answer that names a sheet, ECO-09) or the document fails (IDX-01). Fix: general title-block provenance. Effort L.

### IDX-05 — Tracked modified files import untracked files `[A]` P1 release hygiene — see SOURCE_INVENTORY. Commit as one unit; add import smoke (`python -c "import ecos_indexer.worker"`, `deno check`). Effort S.

### IDX-06 — Terminal `failed_internal` is shown as "will resume automatically" `[A]` P2 — `20260808010000_ecos_hosted_indexer.sql`, status map in `20260809130657...`, copy in `services/ECOSDocumentOnboarding.ts:48`; no client caller of `ecos_requeue_hosted_index_job` found. IDX-07 — job whose lease expires at max retries sits in "preparing" forever `[A]` P2 (no sweeper). IDX-08 — scanner timeout is a permanent rejection `[A]` P2 (`security.py:56`). IDX-09 — daily visual-region limit 100/org with backoff shorter than a day guarantees failure on scan-heavy sets `[A][H on rates]` P1. IDX-10 — gateway never retries and deterministic failures are retried 8 times `[A]` P2 (`gateway.py:33-44`, `embeddings.py:97-143`). IDX-11 — default embedding write is one 80 to 100 MB request with no lease extension `[A]` P2 (`gateway.py:448-454`). IDX-12 — isolated page refresh requires `enabled=false` while reservation returns false when not enabled; no SQL tests, no runbook `[A]` P2. IDX-13 — evidence version `ecos-hosted-evidence/1.3` hard-coded in every search RPC and in proof binding; a worker bump hides all content `[A]` P3.

### DOC-07 — Desktop reads the whole file before any size check `[A]` P3 (`desktop-read-only-shell.tsx:3670`). DOC-08 — "Superseded" selectable at upload but invalid afterwards `[A]` P3. DOC-09 — revision-family key differs web vs mobile `[A]` P3.

### SRCH-01 — Lexical search ANDs every word incl. stop-words; OR-similarity clause forces a full scan `[A]` P2 — `20260809065350...` (`websearch_to_tsquery('simple', q)` on the raw question). Natural questions rarely match full text. SRCH-02 `[H]` — HNSW with a job filter and no iterative scan loses recall as the corpus grows.

Working well `[A]`: readiness states fail closed; reviewed form is used at save time; drawings never indexed in the browser; worker verifies source hash, caps downloads/pages/dimensions/tiles, per-page checkpoints and lease extension, idempotent usage keys, fail-closed without a scanner; claim uses advisory lock + `skip locked` + claim tokens so a reclaimed worker cannot write; live commit is one transaction so readers never see a mix; superseded revisions are hidden at read time; preview function locked to service token with constant-time compare.

---

## H. Ask ECOS and intelligence

### ECO-01 — Ask ECOS does not answer real drawing questions `[L, from receipts and canary report]` P0 for the product objective
- Evidence: 10 of 10 advanced questions failed on r4; `advanced-01` failed on r8 (both image reads cut at 15 s) and on r11 (image read completed in 28.1 s: open 12.5 s, crops 4.3 s, provider 11.2 s; research hit its 45 s allowance with no draft; HTTP 502 after 58.5 s; claim review never ran). No real request has ever reached claim review. 594 unit tests pass on v11.
- This is an aggregate. The contributing defects are ECO-02 to ECO-12, SRC-01 to SRC-03, IDX-01 to IDX-04 and REL-01. Closing evidence: the ten-question set run unchanged through the customer path with a manually built answer rubric, then on desktop, iPad and iPhone.

### ECO-02 — Keyword-triggered deterministic answers REPLACE a successful model answer `[L]` P1, confidence high
- `runtime/.../ecos-ask-project-candidate/index.ts:3948-3962` builds schedule/progress/synthesis projections from the raw question on every live request; `:4199-4202` `proposed = conversation || acceptance || conflict || synthesis || progress || schedule || modelProposed`. Triggers: `_shared/ecos-agent-schedule-answer.ts:60-75, 283-295` (question contains a task name of 8+ characters plus any of when/where/schedule/start/finish/date/status/complete...), `ecos-agent-synthesis-answer.ts:779-812` `[A]` (risk/concern + current/now/project), `ecos-agent-progress-answer.ts:268-293` `[A]`.
- Trace: "Where do the drawings show the <task-named element> detail?" returns "X is scheduled to start...". This is a concrete mechanism behind "asked about drawings, got a schedule/field summary". Present unchanged in v11 `[A]`.
- Fix: use projections only when the model failed or cited no document AND an intent classifier agrees. Test: handler-level, fake gateway returns a document-cited answer, question has task name + "where"; assert the final answer cites the document. Effort M.

### ECO-03 — Drawing passages are silently dropped unless visual coverage is complete; no limitation reaches user or model `[A]` P1 (P0 if the SQL measurement shows most pages affected) — `index.ts:2673-2677, 3160, 3597-3610`; whole documents dropped without `contentSha256/hostedEvidenceVersion/drawingRevision/projectId` (`:1985-1988`). Counts go only to the trace. Fix: emit "N pages of <doc> not yet readable" into limitations. Effort M. Measure with appendix query 5/6.

### ECO-04 — Text without a coordinate region can never support an answer; only evidence version 1.3 accepted `[L]` P1 — `runtime/.../_shared/ecos-answer-proof-authority.ts:238-251` (`!regionId` or version mismatch -> null). Specs, notes and page-level text lead to "could not verify". Fix: page-level proof as a lower assurance tier. Effort M.

### ECO-05 — The "no evidence" refusal is dead code; general questions have no relevance gate `[L for never-empty sources, A for the rest]` P1 — `index.ts:2037-2040` `sources=[projectSource,...]` is never empty so the empty branch (`:896`) cannot run; `ecosFactAnswersQuestion` returns true for "general" (`ecos-project-answer-policy.ts:318`); match needs token coverage > 0 (`ecos-agent-project-tools.ts:198`). Drawing question + zero document hits + one field note sharing a token = a "verified" note summary. Fix: if the question expects a document and no document source survives, return the insufficient answer naming what was searched. Effort M.

### ECO-06 — Project-specific content is hard-coded in production answer paths `[A]` P1 — literal sheet numbers/titles for one project's canopy (`ecos-agent-synthesis-answer.ts:196-232`), canopy-lighting canned sentence that wipes model facts (`ecos-project-answer-policy.ts:1424-1473`, `index.ts:4945-4956`), project-specific pre-search strings (`index.ts:3585-3595, 4443-4466`), site vocabulary rewrites such as "back"/"behind" -> "north lot" and "canopy" -> "anchor rod plan" (`ecos-question-language.ts:140-142, 195-200, 290-293`). "canopy" appears 63 times in the handler. On any other project these corrupt retrieval. Fixtures themselves are correctly gated (`index.ts:651-669`). Fix: move to eval fixtures; make vocabulary per-project alias data. Test: same questions on a synthetic second project, assert no canned strings/rewrites. Effort L.

### ECO-07 — "Assurance" is lexical substring matching, presented to the user as an independent check `[A]` P1 — `index.ts:5351-5385`: supported if every number appears and >= 25% of non-stopword tokens are SUBSTRINGS of the evidence; no negation check ("not required" passes against "required"); non-`fact` classifications skip it; the visual reviewer uses the same provider as the reader. What IS verified: document identity, hash, current revision, region bounds, sheet label. Fix: whole-word + polarity + higher threshold, or a second-model entailment check, or reword the client claim (`ECOSProjectQuestion.ts ~255`). Effort M.

### ECO-08 — Follow-ups are rewritten into boilerplate that then drives retrieval and assurance `[A]` P1 — `ecos-agent-conversation-context.ts:239-243, 307-313`; `index.ts:731-735, 1265`. Only the prior question is carried, never the prior answer, so "what sheet is that on?" cannot resolve. Effort M.

### ECO-09 — Naming a sheet fails whenever sheet mapping is unverified `[A]` P1 — `index.ts:4684-4701, 6100-6152`; combined with IDX-04 this is the common case for ordinary sets. Fix: limitation + match through page-identity text. Effort S/M.

### ECO-10 — Semantic-search failure becomes a 502; the lexical fallback is unreachable for users `[L]` P2 — `index.ts:2509` `if (shadowClient) throw error`; live path always passes a shadow client `[A]`. Fix: degrade to lexical with a limitation. Effort S.

### ECO-11 — `open_project_source` is expected but the tool is named `open_project_evidence` `[L]` P3 (`index.ts:4381` vs `ecos-agent-project-tools.ts:505`); that recovery can never run. Also `[A]`: embeddings + about 10 RPCs run before the rate-limit begin (spend while limited); wrong answers replayed from cache until evidence/deployment changes.

### ECO-12 — Image-assisted answers are discarded by default `[A]` P1 when the image flag is on without the private-evaluation flag — `index.ts:3936-3943`; test `index.test.ts:25-33` encodes it as correct. Either do not offer the tool or drop visual facts and continue with a limitation.

### ECO-13 — Time budget cannot fit the measured path; v12 makes the image window thinner `[L]` P1
- Measured on r11: one image read = 28.1 s against a 30 s tool ceiling, inside a 45 s research allowance, inside 75 s total with a 30 s review reserve. v12 (`v12/runtime/.../ecos-drawing-stage-error.ts`, `ecos-read-only-agent.ts`) reserves up to 8 s for a tool-free draft, so research effectively ends at 37 s and tool time is measured against that earlier deadline. With search (about 1.4 s), page read, and two model turns (about 3 s each) before the image call, the image tool gets about 29 s or less: below its measured need.
- Conclusion: shuffling budgets cannot close this. The 12.5 s protected open (about 29 sequential round trips, SRC-01) and 4.3 s crop are the lever. v12's idea (force a tool-free draft when time is short) is sound and should be kept, but it is not sufficient.

### ECO-14 — v12 failing test: diagnosis `[L]` (not fixed, per scope)
- Reproduced offline: 597 passed / 1 failed. Instrumented copy shows the run itself behaves as intended: status `completed`, 2 model calls, second call `toolChoice:"none"`, 0 tools, 2 successful research calls. The failing assertion is `request.inputItems.length >= 4`; actual is 3. The test's fake tool-call turn has `outputItems: []`, so the agent appends only the tool output (a real provider turn includes the function_call item, giving 4). Most likely a test-fixture expectation, not lost evidence. Confidence medium-high. Closing step: give the fake turn a realistic `outputItems` function_call and assert the tool OUTPUT is present by content, not by count.

### ECO-15 — After a genuine text failover, image requests are refused for the rest of the question `[L]` P2 (`_shared/ecos-provider-failover.ts`), so one real primary outage fails the skeptical review closed. Owner policy decision.

### ECO-16 — Voice question is sent with no chance to review the transcript `[A]` P2 — `hooks/use-ecos-project-question-experience.tsx:108`; language hard-coded `en`. Sheet IDs and units go straight into retrieval. Effort S.

### ECO-17 — Talk answer sheet is discarded when a citation is opened `[A]` P2 — `App.tsx:13161-13169` `setTalkAnswer(null)`; the ECOS question path was fixed (`use-ecos-project-question-experience.tsx:134`) but this second path was not. Effort S.

Working well `[A]`: gateway verifies user + package hash + model identity; handler re-checks owner and project; evidence manifest drift check before/after research; client rejects mismatched project/question/request ids; region bounds overwritten with authoritative bounds; superseded citations rejected; DB-enforced hourly/concurrent/daily/monthly limits with a per-question reservation; bounded turns/tools/time/tokens; voice has retry, sanitised errors, "type instead", keeps the recording. Lane/review reservations are enforced before every provider attempt in v11 (594 tests, reproduced).

---

## I. Protected source service and backend operations

### SRC-01 — Opening one protected page takes about 29 sequential network round trips `[A]` P1 — `runtime/.../ecos-protected-drawing-image.ts:103-190` -> edge `ecos-source-preview` -> Google STS + IAM token (never cached by design) -> Cloud Run `/source` -> 4 serial authorize calls, inventory + re-read, index sweep x3, observations RPC, raster head, download + SHA + CRC + full PNG decode, head re-read, 4 serial authorize calls again, proof RPC before and after. Owner's own note records 15 to 36 s. Safe reductions: parallelise the 3 authorize sub-calls (or one RPC); drop index re-sweep no. 2; epoch-hash RPC instead of full sweeps; `Promise.all` for head re-read + final index; cache the Google ID token keyed by caller-JWT hash; cache the verified PNG by `raster_sha256`. Never cache authorization or raster heads. Effort M.

### SRC-02 — Caller timeout (30 s) is shorter than the service's observed latency (26 to 36 s) `[L for the 30 s line]` P1 — `ecos-protected-drawing-image.ts:108`; worker budget 120 s, gateway 125 s. Aborted attempts still count against `MAX_ATTEMPTS=4` and hold a worker slot. Fix after SRC-01: one deadline contract. Effort M.

### SRC-03 — Edge gateway admits one request per isolate while the worker is built for three `[A]` P1 — `ecos-owner-source-view-gateway.ts:116,171-172`; second request gets 429 which Ask treats as fatal with no backoff. No gateway test exists. Effort S.

### SRC-04 — The only source of the owner indexer / page-raster preparer is an unversioned temp-style folder `[A, listing L]` P1 — `R/owner-worker-large-cMcFDn` (no `.git`, own cloudbuild). 40 files exist nowhere else. Deleting it as "stray" loses deployed source. Fix: commit it; record image digest vs commit. Effort S.

### SRC-05 — Writer accepts rasters up to 32 MiB at 250 dpi; reader hard-fails above 8 MiB `[A]` P1 (data impact `[H]`) — `owner_page_raster_gateway.py:31,160`, `owner_page_processing.py:174` vs `ecos-owner-raster-images.ts:26,46,235,515`. Large dense sheets become permanently `unavailable` with no signal at indexing time. Effort S/M.

### SRC-06 — Edge gateway pinned to a tagged diagnostic revision URL and a fixed package hash in source `[A]` P2. SRC-07 — no CI and no tests for the network edge of owner-source-runtime `[A]` P2. SRC-08 — every failure is `source_view_unavailable`; "page not prepared" is HTTP 200 `unavailable`; no request-id correlation `[A]` P2.

### OPS-01 — Live validation scripts mint real owner sessions with the service role and have no project allow-list `[A]` P1 — `runtime/scripts/ecos-v2-private-end-user-validation.js:39-42, 252-268`, `ecos-agent-private-model-comparison.js:143-146`, `ecos-v2-private-retrieval-validation.ts:42-44` and siblings; `SUPABASE_URL` used verbatim. App-side: `test:rls-live` (creates auth users, 38 mutating calls), `test:live-provider-mouse`, `dev:create-project-member`, `test:ecos-hosted-indexer:live-security`, `dev:storage-smoke-test` mutate production with no guard. Fix: required project-ref allow-list + explicit production flag + a dedicated validation user. Effort S.

Working well `[A]`: Deno runs with `--deny-write/run/ffi/sys`, exact `--allow-net`, `--cached-only --frozen`, non-root, digest-pinned images; cloudbuild smoke runs with no network, read-only, cap-drop ALL, verifies the manifest before publishing; authorization before and after every read with scope equality; PNG fully verified; write-once raster keys; logs carry no messages/URLs/ids.

---

## J. Security and privacy (deployed state UNVERIFIED throughout)

### SEC-01 — Neither migration tree reproduces the schema `[A]` P1 (process/verification) — runtime has 7 migrations the app tree lacks, including the spend caps (`20260912155045`, redefining `ecos_begin_project_question` from app `20260804010000`); app has about 33 the runtime lacks; neither creates `ecos_private` or the legacy base tables; final body of `ecos_load_project_question_records_v1` depends only on timestamp order across 4 apply + 3 restore migrations. A rebuild from the app tree silently loses cost caps. Fix: one tree, schema-only baseline, CI that applies to an empty DB and diffs against production metadata. Effort M.

### SEC-02 — Some tables and one bucket accept ANY authenticated user `[A]` P2 if signups are open — `20260709000000_simplify_pie_evidence_single_user_rls.sql:34-40, 109-137` (`organization_id = auth.uid()::text`, no `dave_is_app_owner()`). No read of owner data; consumes storage/rows. Fix: disable signups; add owner predicate. Effort S.

### SEC-03 — Superseded org-wide search RPCs remain granted to `authenticated` with no project scope `[A]` P3 today, P1 blocker for teams — `20260809065350...:1302-1433`.

### SEC-04 — `ecos-analyze-drawing-page` has no server-side spend ledger `[A]` P2 — `index.ts:84-92`; caller-selectable provider via `comparisonMode`. SEC-05 — one static `ECOS_SERVICE_WORKER_TOKEN` shared by 6+ components; alone sufficient on that function `[A]` P2. SEC-06 — no `config.toml`; `verify_jwt` per function not on disk `[A]` P2. SEC-07 — storage deletion and audit purge are client-driven; no server drainer/cron `[A]` P3. SEC-08 — provider/Postgres error text logged up to 240 chars `[A]` P3. SEC-09 — older SECURITY DEFINER functions use `search_path=public`, no explicit revoke from PUBLIC `[A]` P3. SEC-10 — evaluation fixture path ships inside the production candidate function behind the worker token `[A]` P3.

### PRIV-01 — Remote deletion does not remove the cached drawing from the phone `[A]` P2 — `App.tsx:14041-14052`; restored files under `Paths.document/restored-reference-documents/<id>/`. PRIV-02 — OCR excerpt JPEGs in tmp are never deleted by `use-ecos-document-evidence.ts:114` `[A]` P3.

Working well `[A]`: RLS enabled on all 57 app tables (27 forced); early `USING (true)` and anon storage policies are dropped later and not reintroduced; all 118 SECURITY DEFINER functions set `search_path`; worker RPCs service-role only; edge functions verify user then owner before service-role reads; signed URLs 600 s with canonical path rebuild; CORS exact-match and fails closed; no committed secrets found by pattern scan; prompts mark documents untrusted at 10+ sites.

**Customer/team readiness: not ready.** Identity is a singleton owner (`organizationId === ownerId` asserted in the source service), project refs and origins hard-coded, no per-tenant storage prefix policy on `project-photos`/`project-documents`, membership tables exist but are not the enforced boundary on legacy tables, no environment separation (REL-07).

---

## K. Desktop/web

### WEB-01 — "Restore missing tasks" inserts rows that stay tombstoned and hidden; tombstones are permanent `[A]` P1 — `desktop-auth-provider.tsx:706-722` -> `DAVEWebSupabaseClient.ts:587-608` plain insert without `scheduleItemWasDeleted`; tombstone grants exclude delete (`20260716030000_dave_sync_tombstones.sql:24`). UI says "N restored"; nothing appears; second attempt throws on the primary key. Fix: server function clearing tombstones + insert in one transaction, or restore under new ids. Effort M.

### WEB-02 — Retrying a failed schedule-document upload reuses a tombstoned document id -> hidden document with visible tasks `[A]` P1 — `DAVEWebSupabaseClient.ts:796-825, 1486-1549`, `DAVEWebOperations.ts:198`. Fix: regenerate ids after compensation or one server function. Effort S-M.

### WEB-03 — The "read-only" shell is a full write client `[A]` P2 — context exposes create/update/delete task, upload/delete/link document, set current schedule, save report, restore, index-job writes (`desktop-auth-provider.tsx:84-126`); 404 page still says "approved read-only pilot". Risk: testers under-test desktop. Effort S (rename + test plan).

### WEB-04 — Web sign-out can fail silently, leaving the token and workspace visible `[A][H on library]` P2 (`desktop-read-only-shell.tsx:5988`). WEB-05 — no error boundary on web; one malformed row blanks the page `[A]` P2 (`app/_layout.tsx`). WEB-06 — drafts lost on navigation/reload with no warning `[A]` P2. WEB-07 — sign-in errors conflated ("check your password" when offline); error gate has no retry; no password reset `[A]` P3. WEB-08 — proof "open full page" uses a 10-minute signed URL created at render, never re-signed; `#page=N` only works in built-in PDF viewers `[A]` P2. WEB-09 — proof effect keyed on object identity re-verifies and re-downloads up to 8 MB on every snapshot refresh `[A][H]` P2. WEB-10 — pdfjs documents never destroyed; whole PDFs (Drive up to 250 MB) loaded into memory `[A]` P2.

Working well `[A]`: every route gated on `phase === 'ready'`; honest Connected/Reconnecting/Stale badge; failed refresh keeps last snapshot; task update uses an atomic `updated_at` guard; field notes use integer revision CAS and keep the user's text on conflict; make-current is one server RPC with expected timestamp and a trigger blocking other writers; upload compensation removes the storage object when the row insert fails.

---

## L. Usability, accessibility, native config, performance

- UX-08 `[A]` P2 — In `App.tsx`, 45 of 80 touchables have neither label nor role; 0 of 12 text inputs labelled; shared `PrimaryButton`/`SecondaryButton` have no `accessibilityRole` (`App.tsx:20758-20802`). Cheapest wide win: fix those two components. Effort S then M.
- UX-09 `[A]` P2 — Contrast tokens fail WCAG AA: `tertiaryText #9A9AA0` on white 2.80, white on `success` 2.22, white on `warning` 2.20, `danger` 3.55, white on `primary #007AFF` 4.02 (`theme/colors.ts`). Field app used in glare. Effort S.
- UX-07 `[A]` P2 — Web keyboard/focus: no key handlers, no Escape, no focus management, one `outlineStyle:'none'`. Effort M.
- NAT-11 `[A]` P2 (App Review) — `ios/Vitruvius/Info.plist` drifts from `app.json`: `UIBackgroundModes [audio]` while background recording is disabled; generic Always-location, FaceID, Motion strings not declared in `app.json`; dev-client keys + `expo-dev-client` as a production dependency. `ios/` is gitignored and local signed builds are the release authority, so this file is what ships. Fix: clean prebuild + diff; CI allowlist of plist keys. Effort S-M.
- NAT-13 `[A]` P3 — OCR native module is iOS-only; OCR errors swallowed without a limitation entry (`DaveTextRecognitionModule.swift:88`); one autoreleasepool around a 100-page loop `[H]`.
- PERF-16 `[A]` P2 — `AppShell` is one component of about 9,300 lines (`App.tsx:5160-14445`): 73 `useState`, 31 `useEffect`, 0 `useCallback`, 0 `React.memo`, 141 `Alert.alert`. Any setter re-renders the tree. Extract by domain incrementally. Effort L.
- PERF-17 `[A]` P2 — Deep equality by `JSON.stringify` over whole collections on every refresh (`App.tsx:6392-6635, 12493, 12546`); reference documents may carry extracted text up to 500k chars; `savedUpdates` persisted as one AsyncStorage value. Compare by id + revision. Effort M.
- PERF-18 `[A]` P3 — thumbnails render raw URIs via RN `Image`, no resize hint, no `expo-image`.

Working well `[A]`: core lists virtualised; startup error boundary on native; AppState flush on background; honest web freshness messaging; careful destructive-action confirmations; single versions of React/RN/Expo in the lockfile; no root install scripts; ATS strict; Android `allowBackup=false`.

---

## M. Testing, releases, architecture

### REL-01 — Release evidence binds to the wrong Ask ECOS code `[L]` P1, confidence high on source; live state unverified
- `app/scripts/ecos-ask-live-acceptance-lib.js:40-57` `CONTRACT_FILES` hashes `supabase/functions/ecos-ask-project/index.ts` + two `_shared` policy files from the APP repo. In the runtime repo that path is a 6-line shim (`runtime/supabase/functions/ecos-ask-project/index.ts:1-6`) to Cloud Run. The list contains none of `ecos-ask-project-candidate/index.ts`, `ecos-agent-customer-gateway/index.ts`, `workers/ecos-agent-query-runtime/main.ts` or the runtime `_shared` files. So "code changed after the live run" does not cover the code that answers. Fix: move `CONTRACT_FILES` to the answering runtime; record deployed function version + package SHA in the evidence and compare to the gateway's `expectedPackageSha256`. Closure: edit one line of the candidate handler and see the gate fail. Effort M.

### REL-02 — The app's 3,965-line Ask ECOS function has no executed test `[A]` P1 — single `Deno.serve` closure, no exported handler (`app/supabase/functions/ecos-ask-project/index.ts:230`); referenced only through `readFileSync` string checks; app repo never runs `deno test`; its 10+ Deno test files are dead weight. Fix: export handler + Deno layer in gate/CI, or delete if superseded. Effort M.

### REL-03 — Most non-Jest "tests" assert source text `[A]` P1 — of 165 scripts, 97 import no product code; "Core workflow simulation" (`scripts/e2e-core-flow-test.js:1-95`) is `app.includes(...)` on `App.tsx` and runs in 145 ms; `scripts/jarvis-qa.js` (8,627 lines) swallows read errors to `''`. Relabel truthfully, report static vs executed separately, replace Ask UI/core-flow text checks with component tests. Effort M.

### REL-04 — No test joins client -> gateway -> runtime -> response schema; zero tests call `handleECOSAskProjectCandidateRequest`, `runECOSAgentCore` or `gatherEvidence` `[A]` P1. `retrieval-contract.test.ts` asserts substrings of `index.ts`. Needed: a handler-level harness (fake Supabase, fake gateway, fake embedder) and a held-out question set on a second project. Effort M-L.

### REL-05 — CI's final step cannot pass and differs from the local gate `[A]` P1 — `qa:release` needs a fresh `validation/output/ecos-ask-live-acceptance.json` (absent) and a clean tree; `npm audit --audit-level=low` is a flake source; Jest runs three times; Maestro flows run only on schedule/manual, never ask ECOS a question, and hard-code a project name; owner-source-runtime has no CI. Split "offline gate (must be green)" from "release certification". Effort S-M.

### REL-06 — No commit SHA in the binary or web export; manifest on disk is for another commit; rollback is prose `[A]` P1. Effort M.

### REL-07 — No environment separation `[A]` P1 — `eas.json` preview and production both `environment: production`; one Supabase host in source; live scripts act on whatever URL is set (see OPS-01). Effort M-L.

### ARCH-10 — Boundaries `[A]` P2 — `App.tsx` 20,932 lines; `PIERuntime.ts` 5,220; `SyncService.ts` 5,192; `SupabaseService.ts` 3,405 with fan-in 17; flat `services/` (71 PIE, 64 DAVE, 32 ECOS, 103 other); 31 duplicated exported type names; two `parseFlexibleDate` with different behaviour; no shared client/server Ask ECOS contract package. Positive: zero import cycles, about 2.6k dead lines only. Incremental sequence in REPAIR_ROADMAP; no rewrite recommended.

### DOC-STALE — see SOURCE_INVENTORY section 7. P2.

Good `[A]`: the release gate is fail-closed and honest (last manifest says `automatedGate: fail, not_certified`); live-evidence validator enforces customer path, signed-in user, no worker token, freshness; coverage floors on fresh coverage; no `.skip`/`.only`; mobile CI pins actions and needs no secrets; runtime CI runs real Deno behaviour tests.

---

## Appendix — read-only checks the owner can run (no secrets needed in output)

Database (SQL editor, read-only):
1. Tables without RLS: `select n.nspname, c.relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid=relnamespace where relkind='r' and nspname in ('public','ecos_private','app_private');`
2. Permissive policies: `select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies where qual='true' or with_check='true' or roles::text ~ 'anon|public';`
3. SECURITY DEFINER exposure: `select p.oid::regprocedure, proconfig, proacl from pg_proc p join pg_namespace n on n.oid=pronamespace where prosecdef and nspname in ('public','ecos_private','app_private');` (null `proacl` = PUBLIC default)
4. Applied migrations vs both trees: `select version, name from supabase_migrations.schema_migrations order by 1;`
5. Page mapping and assurance: `select final_page_data->>'sheetMappingStatus' s, final_page_data->>'sheetMappingSource' src, state, count(*) from ecos_hosted_index_pages group by 1,2,3 order by 4 desc;` and `select code, count(*) from ecos_hosted_index_pages, jsonb_array_elements_text(coalesce(assurance_result->'failureCodes','[]'::jsonb)) code group by 1 order by 2 desc;`
6. Chunk usability for Ask ECOS: `select count(*) total, count(*) filter (where metadata->>'sheetMappingStatus' is distinct from 'verified') unverified, count(*) filter (where metadata->'assurance'->>'accepted' is distinct from 'true') not_accepted, count(*) filter (where coalesce(region_id,'')='') regionless from ecos_hosted_shadow_chunks;` (repeat for `ecos_hosted_document_chunks`)
7. Job outcomes and stuck jobs: `select mode, state, failure_category, count(*), max(retry_count) from ecos_hosted_index_jobs group by 1,2,3 order by 4 desc;`
8. Duplicate projects: `select lower(name), count(*) from projects group by 1 having count(*)>1;`
9. Rasters the reader will refuse: count stored page rasters above 8 MiB.
Dashboard: signups enabled? anonymous sign-ins? JWT expiry? per-function `verify_jwt`? Cloud Run ingress/IAM? which revision and package hash are live for the source service and the agent runtime?
Traces: for the failed real questions, the stored trace columns (`outcome`, `errorCode`, `sourceCounts.rejected_matched_page_contexts`, `ecos_deterministic_*_applied` events) separate ECO-02/03/04/05 without any rerun.
