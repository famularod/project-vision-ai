# Vitruvius Build 138 Iterative Audit

Date: August 1, 2026

This is the running defect log for the Build 138 review. Findings are recorded before correction and closed only after focused verification and the complete release gate.

## Review Cycle 1

### V138-001 — Mobile task dates wrap into a misleading second row

- Severity: Medium
- Affected area: Mobile task cards in `App.tsx`
- Root cause: Start and finish dates were rendered as separate text fragments without a compact mobile contract.
- Impact: A short task card could grow unexpectedly and visually separate a finish date from its label.
- Reproduction: Open a mobile task card that has both start and finish dates.
- Correction: Render one compact, single-line date summary with an explicit minimum font scale.
- Verification: Component contract test, TypeScript/static checks, release gate, and physical iPhone/iPad launch.
- Status: Corrected in Build 137; retained in this audit as a regression target.

### V138-002 — Unreachable legacy screens remain in the live app shell

- Severity: Low
- Affected area: `App.tsx`
- Root cause: Superseded screens and presentation helpers were left behind after navigation and workflow redesigns.
- Impact: More than 2,000 lines could not execute but increased review surface, bundle parsing work, and the chance of auditing obsolete behavior instead of the production path.
- Reproduction: Search each listed top-level declaration and confirm the declaration is its only lexical occurrence.
- Correction: Remove only top-level declarations with zero references, then rerun reachability, architecture, type, behavior, web, and release checks.
- Verification: Zero-reference scan, architecture ratchet, strict unit gate, web foundation tests, and complete release gate.
- Status: Corrected and verified by the reachability scan, architecture ratchet, TypeScript checks, service-architecture gate, web-foundation tests, and audit contracts.

### V138-003 — Strict test run emits React Native InteractionManager deprecation warnings

- Severity: Low
- Affected area: Provider lifecycle tests and the React Native compatibility boundary.
- Root cause: The strict test environment touches React Native's deprecated `InteractionManager` export.
- Impact: Tests pass today, but warning noise can hide future actionable warnings and signals a future framework-compatibility migration.
- Reproduction: Run the strict unit gate and inspect console warnings.
- Correction: Keep production behavior unchanged during this release; isolate or replace the deprecated boundary in a focused follow-up after confirming the supported Expo SDK 57 alternative.
- Verification: Warning remains explicitly documented as residual risk rather than silently ignored.
- Status: Open low-severity follow-up; not release blocking.

### V138-004 — Project-cover QA contract depended on an unreachable screen

- Severity: Medium
- Affected area: `scripts/project-cover-photo-test.js`
- Root cause: The contract used a removed legacy component as the end of its Overview source range and required a third resolver call supplied only by an unreachable Projects screen.
- Impact: The test could report stronger production coverage than it actually inspected and failed when dead code was correctly removed.
- Reproduction: Remove the unreachable legacy screens and run `npm run test:project-cover-photo`.
- Correction: Bound the check to the current reachable Overview implementation and require canonical resolution in the two live surfaces: Overview and Project Workspace.
- Verification: Focused project-cover contract, audit contracts, static contracts, and complete release gate.
- Status: Corrected and verified by the focused project-cover contract, audit-contract suite, and TypeScript checks.

### V138-005 — App-shell architecture ratchet allowed dead code to return

- Severity: Low
- Affected area: `scripts/app-shell-architecture-test.js`
- Root cause: The app-shell limit remained more than 2,000 lines above the reachable implementation and the test did not detect unused top-level function declarations.
- Impact: Large unreachable UI blocks could return without failing the architecture gate, increasing maintenance and audit risk.
- Reproduction: Add an unreferenced top-level function to `App.tsx`; the prior architecture test still passed.
- Correction: Tighten the line budget to the current reachable shell and add a TypeScript AST check that rejects unreferenced top-level functions.
- Verification: Focused architecture gate, TypeScript checks, and complete release gate.
- Status: Corrected and verified by the focused architecture gate and TypeScript checks; included in the complete release-cycle regression targets.

### V138-006 — Field-readiness QA contract rejected the optimized authority signature

- Severity: Medium
- Affected area: `scripts/dave-field-test-readiness-test.js`
- Root cause: The static QA contract required the pre-optimization source text even though the live signature still included confirmed memories and project documents through canonical cached serialization.
- Impact: The release audit reported two authority-input failures that did not exist in the reachable production path, preventing a trustworthy release result.
- Reproduction: Run `npm run test:field-readiness` against the optimized `PIELiveAuthoritySignature` implementation.
- Correction: Assert the current canonical signature expressions for both evidence collections while retaining the provider-import requirement.
- Verification: Focused field-readiness contract, offline idempotency suite, TypeScript checks, and complete release gate.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

### V138-007 — Brand QA contract required a retired photo-workflow label

- Severity: Medium
- Affected area: `scripts/dave-brand-consolidation-test.js`
- Root cause: The release contract still required the retired `Photo Review` label after the reachable workflow was consolidated around `Photo Analysis`, `Analysis status`, and `Photo status`.
- Impact: A valid release failed its interface gate, and the contract no longer proved the labels users actually encounter.
- Reproduction: Run `npm run test:brand` against the reachable Build 138 app shell.
- Correction: Replace the obsolete assertion with the current three-label photo-analysis contract while retaining the checks that reject visible legacy DAVE and PIE branding.
- Verification: Focused brand test, complete interface-contract suite, TypeScript checks, and two complete release gates.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

### V138-008 — Overview QA contract asserted removed presentation helpers

- Severity: Medium
- Affected area: `scripts/ui-simplification-test.js`
- Root cause: The interface contract still searched for the removed `OverviewHeroCard` and `OverviewBentoCard` helpers even though the reachable `HomeScreen` now renders the portfolio and current-focus cards directly.
- Impact: The interface suite failed after safe dead-code removal and no longer demonstrated coverage of the Overview users actually run.
- Reproduction: Run `npm run test:ui` against the reachable Build 138 app shell.
- Correction: Anchor the assertions on `HomeScreen`'s live `overviewHealthCard` and `overviewPriorityCard` surfaces.
- Verification: Complete interface-contract suite, TypeScript checks, and two complete release gates.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

### V138-009 — Phase 2 QA contract required removed navigation and empty-state surfaces

- Severity: Medium
- Affected area: `scripts/phase2-project-screens-test.js`
- Root cause: The interface contract still required the retired `ProjectSelectorSheet`, project-search controls, and superseded project-management labels after Overview project navigation was consolidated into the reachable active-project cards and current empty state.
- Impact: The complete interface suite failed after dead-code removal and tested an obsolete component instead of the project cards users actually select.
- Reproduction: Run `npm run test:ui` against the reachable Build 138 app shell.
- Correction: Require the live `overviewProjectCard`, current project-management action, and current empty-state surfaces while retaining the explicit assertion that each project card opens Project Workspace.
- Verification: Complete interface-contract suite, TypeScript checks, and two complete release gates.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

### V138-010 — Phase 3 QA contract referenced retired capture controls

- Severity: Medium
- Affected area: `scripts/phase3-field-update-flow-test.js`
- Root cause: The contract still required the former `Continue to Review` copy and quick-context chip rendering after the live capture workflow was simplified to a single `Continue` action with a contextual next-step card.
- Impact: The interface suite failed despite the reachable capture-to-review workflow remaining intact.
- Reproduction: Run `npm run test:ui` against the reachable Build 138 app shell.
- Correction: Assert the current `Next Suggested Action` guidance and `Continue` action while preserving checks for capture, documents, area selection, review, photo analysis, and idempotent saving.
- Verification: Complete interface-contract suite, TypeScript checks, and two complete release gates.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

### V138-011 — Phase 6 QA contract required a removed document metadata helper

- Severity: Medium
- Affected area: `scripts/phase6-documents-foundation-test.js`
- Root cause: The document-foundation contract still required the removed `buildProjectDocumentMetadataBrief` helper instead of the reachable document header and upload-classification sheet.
- Impact: The interface suite failed after dead-code removal and did not explicitly prove that the two document surfaces users now operate remain wired into the runtime.
- Reproduction: Run `npm run test:ui` against the reachable Build 138 app shell.
- Correction: Replace the obsolete helper marker with assertions for `ProjectDocumentsHeader` and `DocumentUploadDetailsSheet`, while preserving the existing classification, persistence, retry, file-size, multi-project, and safety checks.
- Verification: Focused Phase 6 contract, complete interface-contract suite, TypeScript checks, and two complete release gates.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

### V138-012 — Project-sheet QA contract required a retired project selector

- Severity: Medium
- Affected area: `scripts/project-sheet-scrolling-test.js`
- Root cause: The scrolling contract still required the removed `ProjectSelectorSheet`, its former `Choose Project` chip list, and retired ambiguous-GPS copy after project selection moved to the reachable `SelectProjectScreen` flat list.
- Impact: The interface suite failed after dead-code removal and did not separately prove that the current project list remains scrollable and selectable.
- Reproduction: Run `npm run test:ui` against the reachable Build 138 app shell.
- Correction: Verify the current area, recipient, update-filter, and document-detail action sheets against the shared scrollable sheet; verify project selection against the current `SelectProjectScreen` flat list; and preserve the GPS ambiguity fallback into that complete list.
- Verification: Focused project-sheet contract, complete interface-contract suite, TypeScript checks, and two complete release gates.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

### V138-013 — Photo-auth QA contract required a retired sign-in component

- Severity: Medium
- Affected area: `scripts/pie-auth-session-test.js`
- Root cause: The auth-session contract still required the removed `PhotoIntelligenceSignInModal` name and retired instructional wording even though photo-analysis auth recovery now uses the shared `SignInModal`.
- Impact: The complete interface suite failed without checking the current reachable path from an analysis result to the secure sign-in sheet and verified retry.
- Reproduction: Run `npm run test:ui` against the reachable Build 138 app shell.
- Correction: Verify the current `pieResultRequiresSupabaseSignIn` branch, visible `Sign in to enable photo intelligence` action, shared sign-in sheet, and post-sign-in submit path.
- Verification: Focused photo-auth contract, complete interface-contract suite, TypeScript checks, and two complete release gates.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

### V138-014 — Development-auth QA contract checked the wrong runtime file

- Severity: Medium
- Affected area: `scripts/pie-auth-session-test.js`
- Root cause: The contract expected development sign-up copy to remain in `App.tsx` after the sign-in UI moved into the shared `screens/AdminScreen.tsx` modal.
- Impact: The interface suite failed even though development sign-up remains disabled by default, uses anonymous Supabase auth, and never exposes a service-role key to the client.
- Reproduction: Run the photo-auth session contract against the current shared sign-in sheet.
- Correction: Check Build 138's `ENABLE_DEV_AUTH_SIGNUP` wiring in `App.tsx` and the gated development action in the shared modal.
- Verification: Focused photo-auth contract, complete interface-contract suite, TypeScript checks, and two complete release gates.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

### V138-015 — Baseline-photo QA contract required retired explanatory copy

- Severity: Medium
- Affected area: `scripts/pie-ui-follow-up-test.js`
- Root cause: The photo-intelligence contract required a removed long-form baseline sentence after the PM-facing update detail was simplified to `Baseline saved for future comparison.`
- Impact: The interface suite failed despite baseline-only photo evidence being classified before failures and shown as useful future-comparison information.
- Reproduction: Run the PIE follow-up contract against the Build 138 update-detail surface.
- Correction: Keep the behavior checks and assert the current concise baseline explanation.
- Verification: Focused PIE follow-up contract, complete interface-contract suite, TypeScript checks, and two complete release gates.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

### V138-016 — Retired Overview selector left dead GPS UI plumbing

- Severity: Low
- Affected area: `App.tsx`, `scripts/pie-ui-follow-up-test.js`
- Root cause: Overview's former project-selector UI was removed, but its state, callback props, and UI-copy assertions remained while the actual GPS behavior moved to new-update targeting.
- Impact: The interface suite tested an unreachable selector, and the live shell carried state that could never be changed by a user.
- Reproduction: Run the PIE follow-up contract and inspect `HomeScreen`'s received props against its rendered body.
- Correction: Remove the unreachable selector plumbing while preserving clear GPS matches as a new-update default and ambiguous matches as an explicit project-choice fallback.
- Verification: Focused PIE follow-up contract, TypeScript checks, and two complete release gates.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

### V138-017 — PIE follow-up QA used removed Overview and attention-helper boundaries

- Severity: Medium
- Affected area: `scripts/pie-ui-follow-up-test.js`
- Root cause: The contract sliced source around the retired `Phase2ProjectCard` and `projectThumbnailUri` helpers instead of the reachable `HomeScreen`, operational-status builder, and stable attention-item boundary.
- Impact: The interface suite failed after safe dead-code removal and no longer proved that current attention records drive the health shown on reachable Overview project cards.
- Reproduction: Run the PIE follow-up contract against the reachable Build 138 app shell.
- Correction: Anchor the project-card assertions on `HomeScreen` and its operational-status inputs, and bound attention assertions at the current stable-ID helper.
- Verification: Focused PIE follow-up contract, complete interface-contract suite, TypeScript checks, and two complete release gates.
- Status: Corrected and verified by focused checks and two consecutive complete release cycles.

## Review Cycle 2

### Checks completed

- Production secret and release-metadata checks
- Expo dependency and TypeScript checks
- Strict behavior and regression suite: 186 suites and 1,281 tests
- Complete interface, report-truth, sync, photo-intelligence, safety, authority, web-export, architecture, and device-flow contracts
- Dependency audit: zero known package vulnerabilities
- iOS native release-generation contract

### Results

- Complete release gate: Passed with the expected Android signing warning only.
- New actionable defects: None.
- Regressions: None.

## Review Cycle 3

The complete release gate was repeated independently after Cycle 2 without code changes.

### Results

- Complete release gate: Passed with the same expected Android signing warning only.
- New actionable defects: None.
- Regressions: None.
- Two consecutive clean post-fix review cycles achieved.

## Build and Device Verification

- Signed iOS Release build: Passed.
- Build artifact: `/tmp/vitruvius-build-138/Build/Products/Release-iphoneos/Vitruvius.app`.
- Embedded metadata: version `1.0.138`, build `138`, bundle identifier `com.davidfamularo.projectphotoupdate`.
- Signing identity: Apple Development `famularod@yahoo.com (BL8PZYM5H5)`; team `5SKMD7H83C`.
- iPhone installation: Passed. The device reports version `1.0.138` / build `138`, and the installed application launched successfully.
- iPad installation: Passed. The device reports version `1.0.138` / build `138`. Automated launch verification was denied because the iPad was locked; opening the installed app after unlock remains the only outstanding package-level check.

## Residual Risks

- React Native's test environment still emits a low-severity `InteractionManager` deprecation warning.
- Android production signing is intentionally not certified by this iOS test release.
- Camera, GPS, native sign-in, offline recovery, live backend/provider availability, touch latency, cross-device propagation, and visual layout still require physical workflow validation.
- iPad Build 138 launch remains to be observed after the device is unlocked; installation and embedded version metadata are already verified.

## Completion Standard

- All automated checks and builds pass.
- No unresolved critical, high, or medium findings remain.
- No regression remains.
- Two consecutive complete post-fix review cycles find no new actionable defects.
- Physical installs are verified separately from human workflow validation.
