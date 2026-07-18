# DAVE Program Analysis — Follow-up, 2026-07-17 (evening)

Re-analysis after the "Complete DAVE architecture hardening plan" commit (d1e2b410). Compares against this morning's report (`docs/analysis-2026-07-17.md`).

## Verification results (all pass)

Production secret guard passed. TypeScript: 0 errors. Jest: 10 suites, 20 tests, all passing. Architecture gate, service-dependency audit, JARVIS contracts, reporter contracts, Layer-4 gates (decision ledger, trust boundary, automation, RLS static), and schedule-reconciliation contract all pass. Note: `npx expo install --check` and the DAVE stages 1–8 gate were not run here (network-dependent); run full `npm run qa:release` on your Mac before merging.

## Scorecard against this morning's report

Resolved since this morning:

The branch is now pushed to GitHub (`origin/codex/dave-worldclass-stages-1-8`). The dead-code pass happened and went further than recommended: unreachable files dropped from 66 (~16,000 lines) to 6 small files (~370 lines), and those 6 are deliberately kept because QA scripts still reference them. `HomeDashboard`, `ProjectAssistantScreen`, `ProjectOverviewScreen`, `ScheduleScreen`, `PIEMultimodalEvidence`, and the whole dead card family are gone — 18,166 lines deleted total. `package copy.json` was removed. `AGENTS.md` was corrected to Expo SDK 54. `CLAUDE.md` was updated (line count, Jest suite counts, the expired comparability-check note is formally closed). The `dave-transcribe-memory` edge function now enforces the app-owner check via `dave_is_app_owner` RPC, with a matching auth test script. SyncService gained targeted tests on exactly the risky exported functions (user-safe error messages, missing-photo marking, stable cloud paths, expired recovered URLs), plus AsyncStorage hydration-safety tests. Type duplication shrank: of the four duplicate local types, only `ProjectUpdate` remains defined inside App.tsx; the others now come from `types/index.ts`.

Still open, in priority order:

**1. Merge state.** The branch is pushed but sits 43 commits ahead of `origin/v0.8-architecture-refactor`. If a PR isn't open yet, open one (`gh pr create` on your Mac — the sandbox has no GitHub access). The longer this branch lives unmerged, the riskier the eventual merge.

**2. Deploy verification.** Still can't confirm from the repo that the four 2026-07-16 migrations are applied and `dave-transcribe-memory` is deployed to live Supabase. One-time check on your Mac: `supabase migration list`, and the Edge Functions page in the Supabase dashboard. If the app is already working on your phone against these features, that's live confirmation too.

**3. App.tsx is 23,379 lines** — down only 132. Expected; this is the long-term workstream. The no-growth ratchet now in CLAUDE.md is the right mechanism. Keep extracting one behavior per PR.

**4. Last duplicate type.** `ProjectUpdate` is still defined locally in App.tsx (line ~298) parallel to `types/index.ts`. Finishing this unification is a mechanical, typecheck-guarded slice.

**5. PIE layer size** (advisory, unchanged): ~40 `PIE*` services with `PIERuntime` at 5,219 lines. Freeze recommendation stands: no new engines; verify screen-visible value when touching one.

## Bottom line

The hardening commit addressed 7 of the 9 findings from this morning, and the codebase is in the best verified state it has been: every automated gate available in the sandbox passes, dead code is essentially gone, and the security/test gaps I flagged are closed. What remains is process (PR + deploy verification + device test) and the two long-running structural items (App.tsx shrinkage, final type unification).
