# AUDIT_COVERAGE — what was and was not reviewed

This audit is **not exhaustive**. The first-party source is roughly 340,000 lines in `app/` alone plus three backend trees. Coverage below is stated honestly per module. "Reviewed" means read in full; "Partial" means targeted ranges were read after searching; "Grepped" means pattern searches or script-based parsing only; "Not reviewed" means untouched.

Method: one lead auditor plus twelve delegated read-only auditors, each confined to grep/sed/cat-style reads on the owner's machine. The lead re-read the cited lines for the findings marked `[L]` in FINDINGS.md and ran every test listed in TEST_EVIDENCE.md. Delegated findings (`[A]`) were spot-checked (14 checks, 0 failures) but not all re-read.

## 1. `R/app` (main application)

| Module | Level | Notes |
|---|---|---|
| `index.ts`, `entry.ts`, `entry.web.ts`, `app/_layout.tsx`, `app/index.tsx`, `app/settings.tsx`, `app/+not-found.tsx`, `app/ecos-acceptance.tsx` | Reviewed | other 9 route wrappers (5 lines each) assumed identical, not opened |
| `App.tsx` (20,932 lines) | Partial, about 25% | ranges around storage/cleanup, persistence, refresh, save/delete, projects, areas/GPS, photos, backup/restore, schedule currentness, PIE input, Talk/evidence, shared buttons; structural counts for the rest |
| `services/OwnerStorageSandbox.ts`, `OwnerWorkspaceAuthDecision.ts`, `SupabaseAuthStorage(.web).ts`, `FieldNoteRepository.ts`, `FieldNoteMobileSync.ts`, `PendingChangesRetryController.ts`, `SyncUploadBatchPolicy.ts`, `projectService.ts`, `CompleteBackupArchive.ts`, `BackupRestoreRuntime.ts`, `BackupExportPolicy.ts`, `ProjectCoverPhotoService.ts`, `ResumableStorageUpload.ts`, `DAVEStorageCleanup.ts`, `ReportApprovalPolicy.ts`, `ReportCommunication.ts`, `PIEReportScope.ts`, `ECOSDocumentUploadIntake.ts`, `ECOSDocumentOnboarding.ts`, `ECOSDocumentReadiness.ts`, `ECOSMobileDrawingOnboarding.ts`, `ProjectDocumentClassification.ts`, `ECOSDocumentReindexPlan.ts`, `ECOSAuthorizedProofRegistry`, `ECOSDocumentProofAuthority`, `ECOSWebDocumentProofPreview`, `ExpoReferenceDocumentByteRestore`, `PIELiveAuthority*` (provider, state machine, signature), `PIEAuthorityMutationCoordinator.ts`, `PIERealityModelRepository.ts` | Reviewed | |
| `services/SyncService.ts` (5,192) | Partial, about 30% | queue, enqueue, upload loop, identity prep, photo upload; NOT `synchronizeLocalData` (2843-3325) |
| `services/SupabaseService.ts` (3,405) | Partial | auth/session, projects, schedule upsert head, PIE save grep |
| `services/DAVEWebSupabaseClient.ts` (about 1,700) | Partial, about 60% | all mutations, signed URLs, realtime, cleanup; NOT index-job writes, ask/analysis paths, OAuth bridge |
| `services/PIERuntime.ts` (5,220), `PIEAttentionEngine`, `PIEPatternEngine`, `PIEEvidenceFusion`, `DAVEDailyBrief`, `DAVEReportIntelligence`, `DAVEProjectTruthRepository`, `DAVECaptureMemory*` | Grepped | internals not read |
| `services/PIERealityModel.ts`, `PIERealityModelOrchestrator.ts`, `PIECoreIntelligence.ts`, `PIEReporter.ts`, `PIEScheduleReconciliation.ts`, `PIEScheduleIntelligence.ts`, `VitruviusScheduleEngine.ts`, `VitruviusLookahead.ts`, `DAVEProjectTruth.ts`, `ECOSProtectedDocumentPage.ts`, `ECOSProjectQuestion.ts`, `ECOSQuestionProtocol.ts`, `ECOSHostedIndexer.ts`, `ECOSDocumentCloudIndex.ts`, `AuthoritativeDocumentSystem.ts`, `DAVEWebOperations.ts`, `PIEPhotoVisionMobileWorkflow.ts`, `ReportAuthorityScope.ts`, `ReportWordMedia.native.ts`, `StartupRecovery.ts`, `PhotoAnalysisIdentity.ts`, `ProjectIdentity.ts` | Partial | targeted ranges |
| PIE Belief / Memory / Learning / Deliberation / Scientific / Predictive / Mission / KnowledgeGraph engines; DecisionLedger + sync; Layer4Automation; `LocationIntelligenceService.ts`; `DAVESyncTombstones.ts`; `ProjectDeletionTransaction/Runtime`; `updateService.ts`; `ProjectDateTime.ts`; startup hydration hooks; `AutomaticSyncState.ts`; schedule import batch/remote extraction; `AppBackupManifest.ts`; `DAVEReportSnapshot*`; `ReportWordDocument.ts`; `ReportWordMedia.web.ts`; `PhotoAnalysisCoordinator/Target/Assessment/Deduplication/PairPreparation`; `FieldUpdateLifecycle/LocalPersistence`; `ResumableWebStorageUpload.ts`; `ECOSDocumentIndexJobs.ts`; `ECOSDesktopProofNavigation.ts` beyond 155-212; roughly 150 other service files | **Not reviewed** | the import-graph script touched every file, but nobody read them |
| `components/` (69 files) | Partial | `field-notes-workspace.tsx`, `native-field-notes-experience.tsx`, `document-upload-details-sheet.tsx`, `desktop-auth-provider.tsx` (about 45%), `desktop-read-only-shell.tsx` (about 10% of 7,258 lines), `desktop-document-proof-preview.tsx`, `desktop-schedule-page.tsx` (316-410), `live-authority-status-banner.tsx`, connection status, navigation, palette; accessibility counts by regex over all. `ScheduleImportFlow.tsx`, `mobile-schedule-planning.tsx`, answer sheets, most others: Not reviewed |
| `screens/AdminScreen.tsx`, `ReportsScreen.tsx` | Partial | |
| `hooks/` | Partial | 4 of 11 read |
| `providers/PIELiveAuthorityProvider.tsx` | Reviewed | |
| `types/`, `utils/`, `theme/` | Partial | `theme/colors.ts` reviewed; others grepped |
| `plugins/` | Partial | Android security policy reviewed; `withDaveIosAppIcon.js` not |
| `modules/dave-text-recognition/` | Partial, about 45% of Swift; TS + config reviewed | |
| `ios/` | Partial | `Info.plist`, entitlements, `Podfile.properties.json`, pbxproj grep; `AppDelegate.swift`, `PrivacyInfo.xcprivacy` not reviewed |
| `android/` | Listed | icons only on disk; no manifest to review |
| `app.json`, `app.config.js`, `eas.json`, `package.json`, `package-lock.json` (parsed), `jest.config.js`, `product-metadata.json`, `AGENTS.md`, `.gitignore` | Reviewed | long composite npm scripts were truncated at 400 chars in output |
| `CLAUDE.md`, `README.md` | Partial | |
| `docs/` (96 entries) | Not reviewed | |
| `scripts/` (166 files) | Classified by script; 6 read in part | release gate, Jest gate, live-evidence gate, acceptance lib (partial), core-flow test, `jarvis-qa.js` head |
| `tests/` (268 files) | All executed (TEST_EVIDENCE T6); 11 read by hand; rest classified by regex | |
| `e2e/` | Listed | YAML bodies not read |
| `validation/` | Listed | cases not read |
| `.github/workflows/` | Reviewed | |
| `supabase/functions/pie-photo-vision` | Partial | auth, signing, body limits |
| `supabase/functions/ecos-ask-project` (3,965) | Grepped + 2 ranges | |
| `supabase/functions/ecos-analyze-drawing-page(-preview)` | Partial | auth, provider, count/note/label reads reviewed |
| `supabase/functions/ecos-embedding-provider`, `dave-transcribe-memory` | Reviewed / Partial | |
| `supabase/migrations/` (103) | All parsed by script (tables, RLS, FORCE, definer functions, search_path, grants, `using (true)`, EXECUTE, storage); about 15 read in part; the four untracked 0915 files reviewed in full | bodies of most SECURITY DEFINER functions NOT read (only 21 authenticated-granted ones keyword-checked) |
| `workers/ecos-indexer/` | Partial | reviewed: `gateway.py`, `assurance.py`, `sheet_mapping.py`, `embeddings.py`, `security.py`, `page_refresh.py`, count/note/label modules, Dockerfile; partial: `worker.py`, `visual.py`, `document_structure.py`, `visual_coverage.py`; **`extraction.py` (about 21k lines) only about 3% read**; `structured_tables*.py`, `plan_dimensions.py`, `semantic_backfill.py` grepped; tests: titles only |

## 2. `R/runtime` (durable backend)

| Module | Level |
|---|---|
| `ecos-ask-project/index.ts` (shim), `workers/ecos-agent-query-runtime/{main.ts, Dockerfile, cloudbuild, startup-smoke}`, `.gcloudignore`, CI workflow, `retrieval-contract.test.ts` | Reviewed |
| `ecos-ask-project-candidate/index.ts` (6,439) | Partial, about 45% |
| `ecos-agent-customer-gateway/index.ts` | Partial, about 75% |
| `_shared`: provider failover, drawing crops, visual reader, claim review, visual answer review, protected drawing image, stage error, review readiness, answer proof authority (partial), schedule/progress/synthesis answers, conversation context, question language, answer policy (2 ranges), project tools (partial), telemetry | Reviewed or Partial |
| `_shared`: semantic retrieval, research ranking, drawing evidence, measurements, evidence selection, shadow page selection, read-only agent beyond the timing/finalization parts, model bridges beyond auth | Grepped |
| `scripts/` | Partial: end-user validation script; others grepped for URL/credential handling |
| `validation/` | Counted only (17 `projectName` fields); `docs/`, `tests/`: Not reviewed |
| `supabase/migrations/` (12) | Parsed; `20260912155045` partial |
| All tests | Executed (T4, T5) |

## 3. `R/owner-source-runtime`

Reviewed: both `main.ts`, edge `index.ts`, Dockerfile, cloudbuild, ignore files, gateway, runtime, resolver, diagnostics, private gateway identity, `PROOF_TIMING_REPAIR.md`. Partial: handler, document source view, raster images, authorizer, loaders. Grepped: Google ID token flow, RPC transport, test titles. **Not reviewed: about 70 other `_shared` modules (the owner question/model path, `ecos-v2-source-answer`), SQL RPC bodies, tests not executed.**

## 4. `R/owner-worker-large-cMcFDn`

Partial: `owner_page_raster_gateway.py`, `owner_page_processing.py`; diffed by name against `app/workers/ecos-indexer`. The remaining `owner_*` modules: Not reviewed.

## 5. Private experiments

| Root | Level |
|---|---|
| `vitruvius-private-v11/runtime` | The timing/reservation/runtime-factory code is fully known (authored and reviewed earlier in this session); full suite executed (T1); canary report and diff to v12 read. Handler logic shared with the durable runtime was audited there, with line checks that ECO-02/05/10/11 are present in v11. `private-canary-stage-events.json` not opened. |
| `vitruvius-private-v12/runtime` | Full diff against v11 read; failing test reproduced and diagnosed (T2, T3). `deploy_private.py` not run, not reviewed beyond v9/v11 equivalents. |
| v10 / v9 / v8 / v5 folders, `project-photo-update-tool` | Not audited (historical) |

## 6. Not reviewed at all

`R/research` (except the 12 question receipts read earlier at the owner's request), `R/private-fixtures`, `R/outputs`, `R/validation/runtime-cloudbuild-source.tgz`, `R/owner-worker-test-venv`, `R/supabase/.temp` contents, all `.env*`, signing material, `node_modules`, `dist`, Pods. The two Downloads-level handoff documents named in the guide were outside the granted folders; the Engineering Standards handoff was not reviewed.

## 7. Continuation checkpoint (where a second pass should start)

In priority order, because these are the largest unread areas sitting on top of confirmed defects:

1. `app/services/SyncService.ts:2843-3325` (`synchronizeLocalData`) and `DAVESyncTombstones.ts`, together with a database-level test of tombstone + upsert interleaving (SYNC-05, WEB-01).
2. `app/workers/ecos-indexer/ecos_indexer/extraction.py` beyond the 3% read, specifically the hard-coded label heuristics near `:154-159` and `:3036-3108`, and `structured_table*` (IDX-04 scope).
3. The remaining 55% of `runtime/.../ecos-ask-project-candidate/index.ts`, plus `ecos-semantic-retrieval.ts`, `ecos-research-ranking.ts`, `ecos-evidence-selection.ts`, `ecos-shadow-page-selection.ts` (retrieval quality was only traced at the edges).
4. Bodies of the SECURITY DEFINER RPCs granted to `authenticated` (owner checks inside), and the shadow materialisation / claimed-batch embedding RPCs.
5. `app/services/PIERuntime.ts` and the unread PIE engines, to decide what can be switched off for beta (PIE-06).
6. The owner question/model path in `owner-source-runtime/_shared` and the unread `owner_*` Python modules.
7. `components/web-shell/desktop-read-only-shell.tsx` remaining 90% and the mobile answer-sheet components.
8. Everything that needs a device, a database or the cloud: see TEST_EVIDENCE section 2 and the FINDINGS appendix.
