# SOURCE_INVENTORY — Vitruvius whole-app audit

Audit date: 2026-09-17 (UTC evening). Auditor: Claude (Cowork), read-only.
Guide followed: `vitruvius-beta-readiness-2026-09-13/Vitruvius_Whole_App_Claude_Audit_2026-09-17.md`.
Reports were written outside every source root (delivered in the chat session only). Nothing was written into any source folder by this audit.

Root used below: `R = /Users/davidfamularo/Downloads/vitruvius-beta-readiness-2026-09-13`.

## 1. Repositories and source roots

| # | Role | Path | Git | Branch | HEAD | Dirty state on disk |
|---|---|---|---|---|---|---|
| 1 | Main mobile + desktop/web + shared app | `R/app` | yes | `fix/beta-evidence-authority` | `67ecd892ad374aaf8938f24ebf42dcc9ff84229c` | 14 modified, 20 untracked (34 total) |
| 2 | Durable backend checkout | `R/runtime` | yes | `fix/beta-evidence-authority` | `f7fdf691bf7ff9eff095841e8ee12b47c89ed994` | 33 modified, 35 untracked (68 total) |
| 3 | Protected drawing/source service | `R/owner-source-runtime` | yes | `fix/proof-source-authority-v22` | `18f22e377c82e75dd333fb755a7b5b14ea5b7727` | clean (0) |
| 4 | Owner indexer + page-raster preparer (Python) | `R/owner-worker-large-cMcFDn` | **NO GIT** | n/a | n/a | sole copy of 40 files incl. all `owner_*` modules, `Dockerfile.owner-preview`, its own cloudbuild. See finding SRC-04. |
| 5 | Root-level Supabase leftovers | `R/supabase` | no | n/a | n/a | only `.temp/linked-project.json` and `.temp/cli-latest`. Contents NOT opened. Not source. Note: links the Supabase CLI at workspace root. |
| 6 | Last deployed private Ask ECOS experiment | `/Users/davidfamularo/Downloads/vitruvius-private-v11/runtime` | no | n/a | n/a | byte-identical to the `claude-v11-proposal/full-replacement-files` for every file that proposal contains (verified with `diff -rq`). |
| 7 | Unfinished local draft | `/Users/davidfamularo/Downloads/vitruvius-private-v12/runtime` | no | n/a | n/a | differs from v11 in exactly 2 files + 1 new test (section 5). NOT deployed, NOT accepted. |
| 8 | Historical proposals | `.../vitruvius-private-timing-v9.dEshDm/claude-v10-proposal`, `claude-v11-proposal` | no | n/a | n/a | provenance only. |
| 9 | Older history | `vitruvius-private-local-v8.GR3rfY`, `vitruvius-private-v5.OFsy8E`, `vitruvius-private-v10`, `project-photo-update-tool` | mixed | n/a | n/a | not audited; `project-photo-update-tool` was NOT substituted for the working source. |

Git state was read with `GIT_OPTIONAL_LOCKS=0 git status --porcelain` and `rev-parse` only. No branch change, clean, reset, add or commit. The three `.git/index` files still carry their original modification times (Sep 14). Disclosure: the `app/.git` directory timestamp read 22:19 UTC during my first listing, within a minute of my first `git status`; I cannot rule out that git touched the directory entry. No tracked file, ref or index changed.

### Saved but uncommitted work in `R/app` (audited from disk)

Modified: `App.tsx`, `components/document-upload-details-sheet.tsx`, `components/web-shell/desktop-read-only-shell.tsx`, `deno.lock`, `services/ECOSDocumentOnboarding.ts`, `services/ECOSDocumentReadiness.ts`, `services/ECOSMobileDrawingOnboarding.ts`, `services/ProjectDocumentClassification.ts`, `supabase/functions/ecos-analyze-drawing-page-preview/index.ts` (+ its test), two Jest tests, `workers/ecos-indexer/ecos_indexer/extraction.py`, `visual.py`.

Untracked: `services/ECOSDocumentUploadIntake.ts`; `count-read.ts`, `independent-label-read.ts`, `note-read.ts` (+ tests) under the preview function; four migrations `20260915120640`, `...122613`, `...124600`, `...124742`; `tests/services/ecos-document-upload-intake.test.ts`; worker modules `count_transcription.py`, `labeled_counts.py`, `note_transcription.py`, `page_refresh.py` (+ 4 tests).

Important: tracked modified files import the untracked files (finding IDX-05). A partial commit breaks the worker, the edge function and the app bundle.

### Saved but uncommitted work in `R/runtime`

33 modified files (most of `_shared/ecos-*.ts`, the candidate handler, gateway, both model bridges, the worker Dockerfile) and 35 untracked (all drawing-image, crop, visual reader/review, provider failover, research ranking modules, the `ecos-agent-drawing-deepseek-preview` function, 5 migrations, `scripts/ecos-proof-coverage-plan.ts`). The Git HEAD of this repo therefore does not contain any of the image-research feature.

## 2. Snapshot identity (binds this audit to what was on disk)

Hash = SHA-256 over the sorted per-file SHA-256 list of first-party text sources (`ts, tsx, js, cjs, mjs, py, sql, swift, json, yaml, yml, toml, Dockerfile*, *.lock, md`), excluding `node_modules`, `dist`, `.git`, `Pods`, `ios/build`, `.expo`, `__pycache__`, `site-packages`, and `app/docs`.

| Root | Snapshot hash | Files (all types, same exclusions) |
|---|---|---|
| `R/app` | `b5ef0e8aa9cda809527c04f702d2ccd0053cfa2cff24dccc672e664d25e0b753` | 1451 |
| `R/runtime` | `6c9e190de9776ab41a2db4f1bc974564b31e414f8cb93b6a60d2d09d2676b3de` | 170 |
| `R/owner-source-runtime` | `2a4f9480dd37643cf5d33c4fc752a5101ab70a28fe55fa5cf148ccc46a29eefa` | 98 |
| `R/owner-worker-large-cMcFDn` | `da3e0a132c9e779eab9d97e559363de0a1b55f8c1b30a2cd76abecf245f0b570` | 83 |
| `vitruvius-private-v11/runtime` | `950d007709235738c48dfa724b897b276b3f9a2428a75a959520d7a9e7fbd05f` | 130 |
| `vitruvius-private-v12/runtime` | `ef6aff4e5c6241d3af262588ff2147df5f685cfbe683a8450524707d54c05219` | 131 |

Lockfiles (first 16 hex of SHA-256): `app/package-lock.json 9f2ba1402d9e8854`, `app/deno.lock ba1d43176280bdbb` (modified, uncommitted), `runtime/deno.lock 086e508fa2d4eed2` (modified, uncommitted), `app/ios/Podfile.lock 2df2e57465280d00`.

## 3. Size of first-party source in `R/app`

| Area | Files | Lines |
|---|---|---|
| `App.tsx` | 1 | 20,932 |
| `services/` | 277 | 122,873 |
| `components/` | 69 | 31,384 |
| `screens/` | 2 | 5,956 |
| `scripts/` | 166 | 44,677 |
| `tests/` | 268 | 43,936 |
| `workers/` (Python indexer) | 51 | 20,826 |
| `supabase/functions/` | 44 | 17,854 |
| `supabase/migrations/` | 103 | 24,166 |
| `hooks, providers, types, utils, theme, plugins, modules, validation, app/ routes` | 45 | ~6,900 |

`prompts/` and `e2e/` contain no code files (e2e holds 8 Maestro YAML flows).

## 4. Platform entrypoints and reachability

- Native: `package.json main = index.ts` -> `entry.ts` -> `NativeRoot` (owner storage sandbox + pending-changes retry boundary, remount key `app-${ownerId||'signed-out'}-${generation}`, `entry.ts:156-158`) -> `App.tsx`.
- Web/desktop: platform resolution -> `entry.web.ts` -> `expo-router/entry` -> `app/_layout.tsx` + 11 route files, all thin wrappers around `components/web-shell/desktop-read-only-shell.tsx` (7,258 lines).
- Import-graph approximation from the real entrypoints: 388 of 399 source files reachable. Unreachable: `services/ProjectIdentityMigration.ts` (1,309 lines), `components/PIEPanel.tsx`, `components/DAVEAskExperience.tsx`, `services/DAVEFollowThroughPlanner.ts`, `utils/contacts.ts`, `utils/locations.ts`, `hooks/use-progressive-list-count.ts`, `lib/supabase.ts` (~2.6k lines). `screens/` IS reachable; `CLAUDE.md` claims otherwise (stale).
- Edge functions in `R/app/supabase/functions`: `dave-transcribe-memory`, `ecos-analyze-drawing-page`, `ecos-analyze-drawing-page-preview`, `ecos-ask-project` (3,965-line monolith), `ecos-embedding-provider`, `pie-photo-vision`.
- Edge/worker in `R/runtime`: `ecos-ask-project` (6-line shim into `ecos-agent-customer-gateway`), `ecos-ask-project-candidate` (6,439 lines, served on Cloud Run by `workers/ecos-agent-query-runtime/main.ts`), two model bridges, `ecos-agent-drawing-deepseek-preview` (untracked).
- Protected source service: `owner-source-runtime/supabase/functions/ecos-source-preview` (edge gateway) -> Cloud Run `workers/ecos-owner-query-runtime/main.ts`.
- Workers: `app/workers/ecos-indexer` (hosted indexer) and the unversioned owner indexer in root #4.
- CI: `app/.github/workflows/{mobile-ci, mobile-e2e, production-operations-health}.yml`; `runtime/.github/workflows/runtime-validation.yml`; none for `owner-source-runtime`.

## 5. Duplicate implementations and drift

- THREE Ask ECOS implementations exist under one function name: `app/supabase/functions/ecos-ask-project/index.ts` (3,965 lines), `runtime/.../ecos-ask-project-candidate/index.ts` (6,439), v11 candidate (6,643). The client calls `functions.invoke('ecos-ask-project')`; in the runtime tree that slug is the gateway shim to Cloud Run. Which one is deployed under the slug is UNVERIFIED from source (READINESS.md says gateway 486/487).
- `_shared` folders: app has 26 files, runtime 89, owner-source-runtime 90. Between app and runtime, 15 function files differ including 7 shared sources (`ecos-drawing-evidence.ts`, `ecos-evidence-selection.ts`, `ecos-project-answer-policy.ts`, `ecos-question-language.ts` among them); 68 exist only in runtime. Between owner-source-runtime and the others: 8 identical, 5 drifted (two by ~10k changed lines), 77 unique.
- Migrations: `app/supabase/migrations` has 103 files; `runtime/supabase/migrations` has 12, of which 7 exist only there (including `20260912155045_ecos_agent_usage_telemetry_and_limits.sql`, which adds the spend caps). Neither tree creates `ecos_private` or the legacy base tables. See SEC-01.
- Indexer: `app/workers/ecos-indexer` vs root #4: 40 files only in #4, 13 differ.
- v11 -> v12: `_shared/ecos-drawing-stage-error.ts` (adds `finalizationReserveMs = min(8000, research/3)`), `_shared/ecos-read-only-agent.ts` (time-aware forced finalization), new `_shared/ecos-finalization-reserve.test.ts`.

## 6. Local source vs installed vs deployed (what is and is not established)

| Thing | Established from source? | Status |
|---|---|---|
| Local app version metadata | yes | `1.0.200`, iOS build 200, Android versionCode 200, consistent across `app.json`, `package.json`, `product-metadata.json`, `Info.plist`, pbxproj |
| Installed mobile build on the owner's devices | no | UNVERIFIED. READINESS.md narrative discusses builds 191 to 196. |
| Deployed desktop/web build | no | UNVERIFIED. `dist/` files are dated one minute before the bump to 200, consistent with "desktop 199", not proven. No commit SHA is embedded in either artifact (REL-06). |
| Base backend revision serving customers | no | Handoff says 100% `ecos-agent-query-preview-r72a5f22`. Not rechecked; this audit made no cloud calls. |
| Private tags r8, r11 | no | From owner documents only. v11 canary report states zero base traffic. |
| Deployed database policies, functions, buckets, `verify_jwt` | no | UNVERIFIED. Source migrations do not prove deployed state (SEC-01, SEC-06). Read-only SQL to verify is in FINDINGS.md appendix. |
| Which migrations are applied, incl. the 4 untracked 0915 ones | no | UNVERIFIED. |

## 7. Stale documentation found (evidence, not authority)

| Claim | Where | On disk |
|---|---|---|
| `App.tsx` is 23,511 lines | `app/CLAUDE.md:39` | 20,932 |
| `screens/`, `components/`, `hooks/` mostly disconnected | `app/CLAUDE.md:40-44` | 388 of 399 files reachable |
| Gate includes "10 Jest suites (20 tests)" | `app/CLAUDE.md:115-116` | 264 suites, 1,897 tests (run in this audit) |
| `expo ^57.0.8` | `app/AGENTS.md:3` | `~57.0.22` in package.json; single copies of expo 57.0.22 / RN 0.86.3 / React 19.2.3 in the lockfile |
| Open the app in Expo Go | `app/README.md:27` | impossible with the custom native module + dev client |
| Build metadata is 191 | `R/READINESS.md:14` | 200 |
| `runtime/` repo | README, CLAUDE | never mentioned, although it answers Ask ECOS |

## 8. Exclusions and inaccessible areas

- Not opened by rule: `R/research` (688 entries; only the 12 `drawing-question-*` receipts were read earlier in this session, at the owner's request), `R/private-fixtures`, `R/outputs`, all `.env*` except `.env.example`, signing material, `supabase/.temp` contents.
- Excluded from first-party coverage: `node_modules`, `dist`, `ios/Pods`, build output, caches, `owner-worker-test-venv` (a regenerable local virtualenv), `R/validation/runtime-cloudbuild-source.tgz` (not unpacked or diffed).
- Referenced by the guide but NOT accessible (outside granted folders): `/Users/davidfamularo/Downloads/Vitruvius_AI_Repair_Handoff_2026-09-17.md` (its text was pasted into chat earlier, so its content was available) and `Vitruvius_Engineering_Standards_Handoff_2026-09-13.md` (NOT reviewed).
- No cloud, network, provider, device or database access was used. Every statement about deployed state comes from owner documents and is marked unverified.
