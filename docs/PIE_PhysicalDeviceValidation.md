# PIE Physical Device Validation

Checkpoint: 1
Date: 2026-07-02
Status: READY FOR PHYSICAL DEVICE TEST

This report prepares physical-device validation for the current production app,
production Supabase database, and PIE intelligence pipeline. It does not add a
new product mode or bypass normal production behavior. Physical validation must
use the installed production iOS build, normal authentication, production RLS,
normal Supabase reads and writes, and the standard PIE runtime path.

## Result Buckets

- Automated verification: executable local checks, static QA, live RLS tests, or
  build checks that can run without a physical phone.
- Simulator verification: iOS simulator checks only.
- Physical-device verification: evidence observed on a real iPhone.
- Not tested: no evidence recorded yet.
- Failure found: a defect or unsupported behavior was observed.
- Corrected and retested: a defect was fixed and the same validation was rerun.

Do not move any row to Physical-device verification without a dated observation,
device, build number, tester, and evidence notes.

## Build 20 Source Audit

Automated verification:

- Build number: 20.
- EAS build ID: e5b4e376-3116-4cf4-9527-f538c26bac01.
- EAS build profile: production.
- EAS distribution: STORE.
- EAS status: FINISHED.
- App version: 1.0.0.
- SDK reported by EAS: 54.0.0.
- Build source commit: 69a55bbf7490eb9c51c4f577173aadb7561bf34d.
- Build source commit message: Realign UI around PIE workflow.
- Build completed: 2026-07-02T19:51:46.199Z.

Automated verification result:

- Build 20 predates current uncommitted app-bundle changes.
- Later changes are not limited to tests, migrations, docs, or package scripts.
- Later changes affect installed app behavior in `App.tsx`, app config,
  components, screens, providers, services, and runtime data flow.
- A new production iOS build is required before physical-device validation of
  the current repository state.

## Production Database Status

Automated verification:

- PIE migrations were reported synchronized locally and remotely before this
  checkpoint.
- Live authenticated RLS tests were reported passed before this checkpoint.
- Organization isolation was reported verified.
- Parent-child project consistency was reported verified.
- Executive Judgments are immutable.
- Layer 4 history is append-only.
- Duplicate synchronization is idempotent.

Remaining authorization limitation:

- Current authorization is organization-wide with parent-child project
  consistency. True per-project user authorization is intentionally deferred.

## Required Build Decision

New build required: yes.

Reason:

- Build 20 source is commit `69a55bbf7490eb9c51c4f577173aadb7561bf34d`.
- The working tree contains app-bundle changes after that source state.
- Physical-device validation must test the current app bundle, not Build 20.

Required command:

```bash
npx eas-cli build --platform ios --profile production --non-interactive
```

Completed build:

- Build number: 21.
- EAS build ID: 5f027e6f-2edc-46f6-96c2-a43aa7b29f26.
- EAS status: FINISHED.
- Build profile: production.
- Distribution: STORE.
- Completed: 2026-07-02T21:25:03.195Z.
- Artifact: https://expo.dev/artifacts/eas/AirxXgqjKIyYCbDuwtbemMqKzwfjt99IKmoWjZVOWEQ.ipa
- Fingerprint: eba0d873a64633ab4ffe22f0c863ce690e9e7bdb.

Build 21 was not submitted to TestFlight as part of this checkpoint.

## Physical-Device Validation Mode

Use normal production behavior:

- Install the production iOS build.
- Sign in through normal production authentication.
- Use a real production organization membership.
- Use a real test project intentionally created for device validation.
- Do not use service-role credentials in the app.
- Do not use local mocks, RLS bypasses, debug-only paths, or database writes from
  external scripts to prove app behavior.
- Keep validation-tenant records and retained RLS-test records out of normal app
  queries by confirming they are not visible to the test user.

## App Startup

Physical-device verification: not tested.

Checklist:

- Cold launch.
- Warm launch.
- Launch after force close.
- Launch after device restart.
- Launch while offline.
- Launch with weak network.
- Recovery when the network returns.
- Prior trusted judgment remains visible during temporary failure.

Record for each run:

- Device model and iOS version.
- Build number.
- Startup type.
- Network condition.
- Time to first usable Home screen.
- Whether prior trusted judgment stayed visible.
- Any degraded-state copy shown.

## Authentication And Project Loading

Physical-device verification: not tested.

Checklist:

- Production authentication.
- Organization membership.
- Project list hydration.
- Project selection.
- Correct project reopening after restart.
- No validation-tenant records visible.
- No retained RLS-test records visible.

Evidence to record:

- Signed-in user.
- Organization ID or name.
- Project IDs visible.
- Selected project before restart.
- Selected project after restart.
- Screenshots or notes confirming no validation data appears.

## Evidence Capture

Physical-device verification: not tested.

Checklist:

- Take a new photo.
- Select an existing photo.
- Add a written note.
- Add a document where supported.
- Add voice evidence where enabled.
- Verify inferred project, date, and area.
- Correct an incorrect inference.
- Save while online.
- Save while offline and synchronize later.
- Prevent duplicate evidence during retry.

Evidence to record:

- Evidence ID.
- Capture type.
- Project inference.
- Area inference.
- Date/time.
- Correction made.
- Sync status.
- Duplicate prevention result.

## PIE Processing

Physical-device verification: not tested.

Required evidence flow:

Evidence -> Perception -> Reality Model -> Executive Judgment -> Attention and
Experience -> Reporter -> Layer 4 eligibility.

For each test record:

- Evidence ID.
- Reality Model version.
- Assertions created.
- Conflicts created.
- Uncertainty created.
- Executive Judgment ID.
- JARVIS result.
- Attention result.
- Synchronization status.

## Reality And Judgment Persistence

Physical-device verification: not tested.

Checklist:

- Save evidence.
- Close the app.
- Reopen the app.
- Verify Reality hydration.
- Verify the current Executive Judgment.
- Verify prior model versions remain available.
- Verify no temporary rebuilt model replaces authoritative Reality.
- Verify no duplicate judgment is created without a material change.

## Photo Sequence Behavior

Physical-device verification: not tested.

Using at least three photographs of the same area:

- Establish a sequence.
- Verify comparability classification.
- Verify progress or unchanged-condition output.
- Verify repeat-photo guidance.
- Verify the app does not claim raw-image computer vision.
- Verify photo results persist after restart.
- Verify project and organization boundaries.

## Review And Correction

Physical-device verification: not tested.

Checklist:

- Review an exception.
- Correct an assertion.
- Reject an incorrect inference.
- Provide missing evidence.
- Approve an authorized judgment.
- Verify correction creates history rather than silently overwriting truth.

## Share

Physical-device verification: not tested.

Checklist:

- Generate a project update.
- Verify Reporter preserves the persisted Executive Judgment.
- Verify recommendation, confidence, owner, risk, and next action remain
  unchanged.
- Verify only intended project evidence is included.
- Verify no validation data or other-project information appears.

## Failure Containment

Physical-device verification: not tested.

Force or simulate failure of:

- Network.
- Supabase hydration.
- Photo intelligence.
- Simulation.
- JARVIS.
- Reporter.

Expected behavior:

- App remains open.
- Prior trusted intelligence remains available.
- App shows a simple degraded state.
- Failed output is not presented as current.
- Recovery does not create duplicate records.

## Performance Measurements

Physical-device verification: not tested.

Do not fill these with estimates. Record actual values from the physical device.

| Measurement | Value | Device | Build | Method | Status |
| --- | --- | --- | --- | --- | --- |
| Cold startup | Not measured | TBD | TBD | TBD | Not tested |
| Warm startup | Not measured | TBD | TBD | TBD | Not tested |
| Home render | Not measured | TBD | TBD | TBD | Not tested |
| Project hydration | Not measured | TBD | TBD | TBD | Not tested |
| Evidence save | Not measured | TBD | TBD | TBD | Not tested |
| Evidence synchronization | Not measured | TBD | TBD | TBD | Not tested |
| Reality refresh | Not measured | TBD | TBD | TBD | Not tested |
| PIE analysis | Not measured | TBD | TBD | TBD | Not tested |
| JARVIS validation | Not measured | TBD | TBD | TBD | Not tested |
| Report generation | Not measured | TBD | TBD | TBD | Not tested |
| Photo-sequence processing | Not measured | TBD | TBD | TBD | Not tested |

## Battery, Storage, And Usability

Physical-device verification: not tested.

Checklist:

- Excessive battery use.
- Growing local storage.
- Large photo handling.
- Keyboard behavior.
- Safe-area behavior.
- Touch targets.
- VoiceOver labels.
- Text scaling.
- One-handed use.
- Modal dismissal.
- Visible loading and error states.

## Automated Verification

Latest local checkpoint results:

- `npm run check`: PASS.
- `npm run jarvis:qa`: PASS, 245 PASS / 0 WARN / 0 FAIL.
- `npm run test:master-validation`: PASS.
- `npm run test:rls-live`: EXTERNAL EXECUTION REQUIRED in this shell because
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` were not
  set. Prior live authenticated RLS run was reported passed before this
  checkpoint.
- Startup tests: PASS.
  - `npm run test:startup`
  - `npm run test:startup-upgrade`
  - `npm run test:startup-recovery`
- Provider and core-flow tests: PASS.
  - `npm run test:live-provider`
  - `npm run test:e2e-core-flow`
  - `npm run test:layer3`
- Photo tests: PASS.
  - `npm run test:photo-rls-policy`
  - `npm run test:photo-sequences`
  - `npm run test:photo-comparison`
  - `npm run test:photo-progress`
  - `npm run test:visual-jarvis`
  - `npm run test:repeat-photo-guidance`
  - `npm run test:photo-progress-ui`
- UI tests: PASS.
  - `npm run test:ui`
  - `npm run test:minimal-ui-complete`
  - `npm run test:accessibility`
- `npx expo-doctor`: PASS, 18/18 checks passed.
- iOS Release simulator build: PASS.

## Simulator Verification

Simulator verification: iOS Release simulator build passed for this checkpoint.

Required command:

```bash
xcodebuild -workspace ios/ProjectPhotoUpdateTool.xcworkspace -scheme ProjectPhotoUpdateTool -configuration Release -destination 'platform=iOS Simulator,name=iPhone 17' build
```

## Defects Found

- Build 20 does not contain current app-bundle changes.

## Defects Corrected

- Build 21 was created to cover app-bundle changes that Build 20 did not
  contain. No product logic was changed in this checkpoint.

## Remaining External Actions

- Run the live RLS test with secure Supabase credentials if they are available
  locally.
- Install Build 21 on a physical iPhone.
- Complete every physical-device checklist item and record actual evidence.
- Record actual performance values from the physical device.

## Checkpoint Status

READY FOR PHYSICAL DEVICE TEST
