# Beta repair checkpoint — not a release certification

## Source authority

This app checkout descends from `806783fa8631b3c7e0200e9376bad5fd996e64ec`,
including the sealed Build 191 history. It owns the mobile/web source and
`workers/ecos-indexer`. The separately versioned ECOS runtime checkout owns
the deployed agent handler; app-local historical backend copies are not
authorization to deploy those older copies over the agent runtime.

## Changes

- Preserve the unfinished native configuration/artifact gate and document
  readiness repairs; pin compatible CI Node and action revisions.
- Correct vector coordinates on rotated sheets before matching OCR regions.
- Reject corrupted embedded-font text rather than mark it trusted at 0.99.
- Preserve bounded rotated-dimension OCR improvements from the prior worker
  repair. Measurements are not supplied from the expected test answers.
- Add exact-source regressions for corrupted text in three real drawings.

## Validation in this work cycle

- App check and 252 Jest suites / 1,790 tests passed.
- Release-contract suite passed, including 285 Python tests run with seven
  explicitly skipped opt-in real-document tests. Skips are not passes.
- Real-source regression initially failed because the default iCloud
  architectural PDF differed from its pinned SHA. The exact matching PDF
  already existed in Downloads. A private fixture directory links that exact
  file and the other SHA-checked sources; no expected hash was weakened and
  no source PDF was edited.
- Full automated release gate remains NOT CERTIFIED: its run preceded the
  fixture correction and recorded a dirty candidate and absent live evidence.

## Remaining release blockers

1. The general plan/ruler OCR experiment did not confidently recover the
   required B/C dimensions. It is outside shipping source. Numeric extraction
   still needs real-source answer/proof validation; refusal alone is not success.
2. New agent and worker artifacts are not deployed or device-verified.
3. Visible desktop, iPhone and iPad question, follow-up, project-switch,
   protected-proof and original-document opening tests are not complete.
4. Current live tenant isolation/revocation/recovery must be demonstrated with
   ordinary authorized test accounts, not inferred from service-role tests.

Preserve the safe customer baseline until these gates clear. Do not convert
local unit results into beta acceptance or reuse another candidate's evidence.
