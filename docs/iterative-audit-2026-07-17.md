# Iterative Software Audit — 2026-07-17

Scope: live Project Vision AI application on branch `codex/dave-worldclass-stages-1-8`, using `index.ts` -> `App.tsx` as the mobile runtime path. Existing untracked analysis documents were treated as leads only and were not modified.

## Defect log

### AUD-001 — JARVIS reported stale evidence paths

- Severity: Medium
- Status: Corrected in Cycle 1
- Affected component: `scripts/jarvis-qa.js`
- Root cause: The dead-code cleanup moved several live screens into `App.tsx` or renamed the bottom-tab component, but result evidence strings still cited deleted files. The checks evaluated live source slices, so they passed while displaying inaccurate evidence.
- Impact: A production-readiness report could mislead reviewers about which code was actually inspected and make future regressions harder to trace.
- Reproduction: Run `npm run jarvis:contracts` before the correction and inspect evidence for Capture, Today, sync diagnostics, and navigation results.
- Correction: Updated evidence to the current live files, removed an obsolete source read, and added an evidence-integrity check that fails JARVIS if any concrete cited file is missing.
- Verification: `npm run jarvis:contracts` passes with 251 PASS / 0 WARN / 0 FAIL, including the new evidence-integrity result.

### AUD-002 — Moderate dependency advisories in Expo/build tooling

- Severity: Medium
- Status: Externally blocked
- Affected component: Expo SDK 54 transitive dependencies (`postcss`, `uuid`, and related toolchain packages); `js-yaml` also appears in test/build dependency paths.
- Root cause: Patched versions are not available through the current SDK 54 dependency graph. npm's complete remediation proposes Expo SDK 57.
- Impact: The reported advisories affect build/configuration tooling paths. No evidence was found that the vulnerable APIs process attacker-controlled data in the shipped mobile runtime, but the supply-chain risk remains until the SDK is upgraded or Expo backports fixes.
- Reproduction: Run `npm audit --omit=dev --audit-level=moderate`.
- Recommended correction: Handle as a separately reviewed Expo SDK upgrade. Do not use `npm audit fix --force` on this branch because it would perform an unplanned breaking upgrade.
- Verification needed: Re-run dependency compatibility, the complete release gate, native builds, and real-device workflows after the approved SDK upgrade.

### AUD-003 — Core-flow authority test was stale and absent from the release gate

- Severity: Medium
- Status: Corrected in Cycle 1
- Affected components: `scripts/e2e-core-flow-test.js`, `package.json`
- Root cause: Report sharing moved from the monolithic build-update path into `screens/ReportsScreen.tsx`, but the core-flow contract still searched `App.tsx` for the deleted `authoritativeReportDraft` variable. The contract was also not included in `qa:release`, allowing the nominal gate to pass without running it.
- Impact: A stale authority-boundary test failed independently while the production gate remained green, weakening confidence that reviewed reports are the exact drafts passed to share actions.
- Reproduction: Run `npm run test:e2e-core-flow` before the correction.
- Correction: Pointed the Share consumer check at `ReportsScreen`, asserted that copy/email/text receive `effectiveReportDraft`, and added `test:e2e-core-flow` to `qa:release`.
- Tests required: Run the targeted core-flow contract and the complete release gate.

### AUD-004 — Photo-progress UI contract expected a retired dedicated card

- Severity: Medium
- Status: Corrected in Cycle 2
- Affected components: `scripts/photo-progress-intelligence-test.js`, `package.json`
- Root cause: The UI contract still required a dedicated Home progress-card marker after the minimal-UI redesign integrated useful visual-change signals into Home's single priority briefing. Only two of the six photo-intelligence modes were included indirectly in `qa:release`.
- Impact: The standalone photo UI contract failed while the release gate remained green, and the outdated assertion encouraged reintroducing redundant UI that conflicts with the one-dominant-action design.
- Reproduction: Run `npm run test:photo-progress-ui` before the correction.
- Correction: Assert the live concise priority-briefing path and add an aggregate `test:photo-intelligence` command covering sequences, comparison, progress, visual JARVIS, repeat guidance, and UI. Added that aggregate to `qa:release`.
- Tests required: Run the aggregate photo-intelligence contract and the complete release gate.

### AUD-005 — Attention authority contract expected the retired Home attention path

- Severity: Medium
- Status: Corrected in Cycle 2
- Affected component: `scripts/attention-authority-test.js`
- Root cause: Home was intentionally consolidated around provider-backed Project Truth briefing, but the standalone authority test still required Home to build/fallback directly through `PIEAttentionEngine`.
- Impact: The omitted contract failed despite Home using the newer authoritative briefing path, obscuring the real authority boundary and encouraging duplicate presentation logic.
- Reproduction: Run `npm run test:attention` before the correction.
- Correction: Verify Home consumes the provider-backed Project Truth next action and evidence coverage; retain the direct Attention authority assertion for Review, where it remains live.
- Tests required: Run `npm run test:attention` and the extended local contract pass.

### AUD-006 — Saved capture memories had no reachable detail/delete control

- Severity: Medium
- Status: Corrected in Cycle 2
- Affected components: `App.tsx`, `scripts/dave-capture-confirmation-ui-test.js`
- Root cause: The Project Workspace simplification retained hydrated memories, intelligence projection, the detail sheet, and the repository delete callback, but removed the only live control that selected a memory for the detail sheet.
- Impact: A PM could save confirmed project memory but could not reopen or delete it from the live workspace.
- Reproduction: Save a confirmed memory, return to Project Workspace, and attempt to open that saved memory; before the correction no control invoked `setSelectedCaptureMemory`.
- Correction: Added a project-scoped recent memory section to the live Project Workspace. Rows show a safe summary and confirmation time, open the existing detail sheet, and reuse the existing confirmed-memory deletion boundary.
- Tests required: Run the capture-confirmation UI contract, TypeScript, UI contracts, and the full release gate.

### AUD-007 — Reports ignored the provider's report-generation block

- Severity: High
- Status: Corrected in Cycle 2
- Affected components: `screens/ReportsScreen.tsx`, `scripts/experience-authority-test.js`
- Root cause: The shared provider computed `reportGenerationAllowed: false` for conflict, stale, failed-reasoning, and untrusted-authority states, but the live Reports screen did not consume that policy. Its Runtime recovery draft remained approvable and shareable.
- Impact: A PM could approve and communicate a report while the authoritative model explicitly required conflict resolution, refresh, more evidence, or trusted identity.
- Reproduction: Enter a provider state whose policy blocks report generation, open Reports, and approve/share the Runtime fallback draft.
- Correction: Reports now reads the provider policy, resets approval if authority becomes blocked, prevents approval/communication, and displays the provider's plain-language reason. Draft inspection and editing remain available.
- Tests required: Run the Experience authority contract, reporter/UI contracts, TypeScript, and the full release gate.

### AUD-008 — Layer 3 contract required communicating an unready recommendation

- Severity: Medium
- Status: Corrected in Cycle 2
- Affected component: `scripts/live-reality-authority-test.js`
- Root cause: The contract required every persisted primary recommendation to appear verbatim in a report, even when Executive Judgment readiness was `Needs Verification`.
- Impact: The test rejected the safer production behavior and would encourage leaking unready escalation guidance into a PM-facing report.
- Reproduction: Run `npm run test:layer3` with the existing blocked electrical scenario.
- Correction: Require recommendation traceability when readiness is `Ready`; otherwise require suppression of the recommendation and explicit review-required language.
- Tests required: Run Layer 3, Reporter, and the full release gate.

### AUD-009 — Live-provider contract targeted deleted screen wrappers and manual refresh calls

- Severity: Medium
- Status: Corrected in Cycle 2
- Affected component: `scripts/live-provider-test.js`
- Root cause: The contract treated several deleted screen wrappers as independent consumers and required manual notify/invalidate calls even though provider input and its evidence signature now drive refresh automatically.
- Impact: The standalone provider contract failed on the current architecture and did not actually prove that live evidence changes refresh authority.
- Reproduction: Run `npm run test:live-provider` before the correction.
- Correction: Verify real live consumers, complete evidence input, signature-driven refresh, Project Truth authority on Home/Workspace, and provider Runtime on Reports/PIEPanel.
- Tests required: Run the live-provider contract and full release gate.

### AUD-010 — Project Options rows lacked explicit accessibility semantics

- Severity: Medium
- Status: Corrected in Cycle 2
- Affected components: `App.tsx`, `scripts/project-cover-photo-test.js`
- Root cause: Cover-photo controls moved into the consolidated Project Options sheet, but the shared option row did not declare a button role or accessible label. The standalone test still expected the retired top-level `Set Project Cover` entry.
- Impact: Assistive technologies had weaker semantics for cover-photo and other project management actions, while the stale test could not validate the current workflow.
- Reproduction: Open Project Options with a screen reader and inspect any option row; before the correction it had no explicit role/label.
- Correction: Added shared button semantics using each row's visible label and updated the cover-photo contract to validate the current options-sheet placement.
- Tests required: Run project-cover, accessibility, UI, and the full release gate.

### AUD-011 — Report-intelligence contract required retired helper copy

- Severity: Low
- Status: Corrected in Cycle 2
- Affected component: `scripts/dave-report-intelligence-test.js`
- Root cause: The report UI clarified its progress helper from `Task average · not weighted` to `Unweighted average of tasks in each area`, but the standalone contract still required the old literal.
- Impact: The behavior remained correct, but the omitted test failed on equivalent clearer copy.
- Correction: Updated the assertion to the current explicit helper text.

### AUD-012 — Canonical timeline evidence lacked a local heading

- Severity: Low
- Status: Corrected in Cycle 2
- Affected components: `App.tsx`, `scripts/dave-project-timeline-test.js`
- Root cause: Timeline events were preserved under expanded supporting evidence, but the old `Project Timeline` section was removed without adding a local label to the remaining event bullets.
- Impact: Users could see recent canonical events but not immediately understand what the bullet list represented; the old contract failed on the retired section name.
- Correction: Added `Recent timeline evidence` above the bounded event list and updated the contract without reintroducing a separate Timeline screen.

### AUD-013 — High-value standalone contracts were outside the release gate

- Severity: Medium
- Status: Corrected in Cycle 2
- Affected component: `package.json`
- Root cause: Authority, workspace, decision-intelligence, master-validation, RLS-static, and voice-security contracts were individually registered but not reachable from `qa:release`. Several had decayed after architectural/UI changes.
- Impact: The nominal release gate could pass while meaningful standalone contracts failed, as demonstrated by AUD-003 through AUD-012.
- Correction: Added grouped aggregates and included `test:audit-contracts` in `qa:release`, alongside the core-flow and full photo-intelligence aggregates.
- Tests required: Two consecutive complete runs of the expanded `qa:release` without new findings.

## Review Cycle 1

### Checks completed

- Confirmed repository, current branch, dirty state, and live `index.ts` -> `App.tsx` entry path.
- Read repository guidance and the Expo SDK 54 version contract.
- Ran `npm run qa:release`, including secret guard, Expo dependency compatibility, TypeScript, architecture checks, Jest, DAVE stages 1–8, UI/reporter contracts, and JARVIS.
- Ran a dependency vulnerability audit and traced vulnerable dependency paths.
- Reviewed live-source reachability, sync/persistence markers, authentication/owner enforcement, server-side provider boundaries, raw-error exposure, and suspicious-code markers.
- Verified remote Supabase migration state and active Edge Functions without changing backend state.

### Issues found

- AUD-001 (Medium): stale JARVIS evidence paths.
- AUD-002 (Medium, externally blocked): Expo/build-tool dependency advisories.
- AUD-003 (Medium): stale core-flow authority test omitted from the release gate.

### Corrections made

- Corrected AUD-001 and added a regression guard for evidence integrity.
- Corrected AUD-003 and promoted the core-flow authority contract into the release gate.

### Validation results

- Initial `npm run qa:release`: PASS; JARVIS 250 PASS / 0 WARN / 0 FAIL.
- Corrected `npm run jarvis:contracts`: PASS; 251 PASS / 0 WARN / 0 FAIL.
- iOS production export: PASS; 910 modules bundled into a 5.49 MB Hermes bundle.
- Jest coverage collection: PASS, but measured aggregate coverage is only 1.7% statements / 1.08% branches / 1.7% functions / 1.81% lines. Many behavioral contracts run as separate Node scripts and are not represented in these figures.
- Initial standalone `npm run test:e2e-core-flow`: FAIL due to AUD-003; correction pending full regression validation.
- GitHub: draft PR #34 is open against `v0.8-architecture-refactor`.
- Remote state: all 20 local migrations are present remotely; `pie-photo-vision` and `dave-transcribe-memory` are ACTIVE.

### Remaining risks or blockers

- AUD-002 requires a separately approved SDK upgrade or upstream backport.
- Physical-device workflows, native permission denial/expiry, background transitions, and visual layout were not exercised by static/Node-based gates.
- Live authenticated RLS and provider calls require test credentials and can create remote test data; they remain outside this cycle unless the environment safely provides those prerequisites.

### Next cycle focus

- Full regression gate after the QA correction, production export, additional security/coverage checks, and review for similar stale or weak assertions.

## Review Cycle 2

### Checks completed

- Ran the release gate plus every registered standalone authority, workspace, photo-intelligence, decision-intelligence, master-validation, RLS-static, voice-security, accessibility, and UI contract.
- Traced failures back to the current live architecture before changing either production code or test expectations.
- Reviewed report authorization, saved-memory reachability, recommendation readiness, live-provider refresh behavior, Project Options accessibility, and timeline/report copy.

### Issues found

- AUD-004 through AUD-013: one High, seven Medium, and two Low issues.

### Corrections made

- Enforced report-generation authority through approval and communication paths.
- Made confirmed project memories reachable for review and deletion.
- Corrected stale or unsafe contracts to test current production behavior.
- Added accessibility semantics and a timeline-evidence heading.
- Expanded `qa:release` so the high-value standalone contract groups cannot silently decay outside the release gate.

### Validation results

- All directly affected contracts passed after correction.
- This cycle was not clean because the expanded inspection discovered AUD-004 through AUD-013.

### Remaining risks or blockers

- AUD-002 and the external/live-device limitations from Cycle 1 remained.

### Next cycle focus

- Run the expanded release gate end to end and repeat it without changes to establish two consecutive clean cycles.

## Review Cycle 3

### Checks completed

- Ran the expanded `npm run qa:release` from secret/dependency checks through TypeScript, architecture, unit/behavior/UI/reporter contracts, all audit-contract aggregates, and JARVIS.
- Re-ran a production iOS export.

### Issues found

- No new actionable defects.

### Corrections made

- None; this was a regression-only cycle.

### Validation results

- Expanded release gate: PASS.
- JARVIS: 251 PASS / 0 WARN / 0 FAIL.
- Production iOS export: PASS; 910 modules and a 5.49 MB Hermes bundle.

### Remaining risks or blockers

- AUD-002 and unexecuted live/physical-device scenarios remained.

### Next cycle focus

- Repeat the complete expanded release gate without code changes.

## Review Cycle 4

### Checks completed

- Repeated the complete expanded `npm run qa:release` without intervening code changes.
- Checked the patch for whitespace errors and confirmed pre-existing untracked analysis documents were not modified.

### Issues found

- No new actionable defects for the second consecutive complete cycle.

### Corrections made

- None.

### Validation results

- Expanded release gate: PASS (exit 0).
- Jest: 10 suites, 22 tests, all passed.
- Architecture reachability ratchet: PASS; 114 of 117 services reachable, with the same three intentionally tracked exceptions.
- JARVIS: 251 PASS / 0 WARN / 0 FAIL.
- `git diff --check`: PASS.

### Remaining risks or blockers

- AUD-002 remains externally blocked.
- Maestro is not installed, so native scripted end-to-end flows were unavailable.
- Test credentials were not available for live authenticated RLS/provider/storage smoke tests.
- Physical-device permissions, background/foreground transitions, screen-size behavior, and real-provider failure behavior were not exercised.
- Jest aggregate coverage remains low; separate Node contract suites provide substantial additional behavior coverage but are not reflected in the percentage.

## Final Production-Readiness Summary

- Review cycles: 4.
- Defects found: 13 total (1 High, 10 Medium, 2 Low).
- Corrected: 12.
- Externally blocked: 1 Medium dependency advisory group requiring an Expo SDK upgrade or upstream backport.
- Completion criterion: met for all locally available static, build, unit, behavioral, architecture, UI, security-contract, and audit gates; two consecutive complete cycles found no new actionable defects.
- Readiness decision: suitable for code review and controlled field testing, but not unconditional production/TestFlight sign-off until the dependency risk is accepted or resolved and the live authenticated plus physical-device passes are completed.
