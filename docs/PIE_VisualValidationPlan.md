# PIE Visual Validation Plan

## Gates

Visual analysis must pass these gates before it can support Reality:

1. Evidence record exists and belongs to the requested organization/project.
2. Private storage object exists under the same organization/project path.
3. Caller has organization access under current Layer 4 authorization.
4. Photo MIME type and dimensions are usable.
5. Provider returns strict structured JSON.
6. Observations and inferences are separated.
7. Limitations are present.
8. Unsafe claims are rejected.
9. JARVIS accepts the result or classifies it for human review.
10. Qualified Reality evidence is created only from accepted observations.

## Rejection Cases

JARVIS blocks or escalates analysis that claims:

- hidden work is complete
- exact progress percentage without measurable scope
- code compliance
- inspection passed
- causation
- responsibility
- work performed by a named party without corroboration
- inferred change from non-comparable photos

## Validation Dataset

The local dataset is `validation/multimodal/photo-vision-scenarios.json`.

It includes:

- visible progress with limitations
- hidden condition rejected
- non-comparable comparison rejected
- project boundary mismatch
- user correction preserved
- mouse_added_to_table baseline failure case

## Regression Tests

Local commands:

```sh
npm run test:photo-vision-authority
npm run test:photo-comparison
npm run test:visual-jarvis
```

These tests validate architecture markers, storage and policy markers, the secure backend boundary, unsafe-claim rejection, deterministic checks, comparison limitations, user correction history, and idempotent cache behavior.

## Live Validation Still Required

After migrations and function deployment:

1. Apply `20260702030000_multimodal_evidence_foundation.sql`.
2. Deploy `pie-photo-vision`.
3. Configure provider secrets on Supabase, not in the mobile bundle.
4. Upload a real image to the private evidence bucket.
5. Invoke the Edge Function with an authenticated member user.
6. Verify analysis rows, JARVIS rows, and photo asset hydration.
7. Verify anonymous and cross-organization access is denied.
8. Verify project mismatch parent-child writes fail.

## Physical Device Validation

Device validation must confirm:

- original photo upload no longer depends on temporary device URI after upload
- offline queue retries evidence and analysis requests idempotently
- captured metadata is persisted with content hash and storage refs
- analysis states hydrate as queued, processing, succeeded, degraded, failed, or blocked
- user corrections remain visible and do not erase original analysis

## Baseline Failure Case 001

Case: `mouse_added_to_table`.

Build 21 physical-device result: failed.

Acceptance requirement: the production raw-pixel pipeline must compare the original before/after desk photographs and report that a black computer mouse appears in the newer photo, in the lower-right portion of the table, while preserving the distinction between visible scene change and project progress.

Expected user-facing text:

`A black computer mouse appears in the newer photo. The viewpoint also changed slightly. This is a visible scene change, but it does not establish project progress.`

Required behavior:

- Preserve both original images in `validation/multimodal/fixtures/mouse_added_to_table`.
- Calculate exact SHA-256 hashes for both originals.
- Calculate perceptual hashes through the production vision pipeline or approved CV pipeline.
- Assess viewpoint and scene similarity.
- Run raw-pixel semantic comparison.
- Detect the newly visible mouse.
- Persist the comparison result.
- Prevent JARVIS from treating the mouse as project progress.

Current status: original image files are present and local deterministic raw-pixel fixture execution is proven. Production provider-backed physical-device pipeline pass is still pending.

## Production Provider Validation

Provider-backed validation must run the `mouse_added_to_table` pair through the deployed `pie-photo-vision` Edge Function in `photo_pair` mode. The result must come from the configured multimodal provider, not the local lower-right dark-object detector.

Required provider-backed output:

- `sameSceneProbability` supports the same general scene
- `comparabilityClassification` is `probable`
- `objectAdditions` includes `black computer mouse`
- object location is lower-right portion of the table
- `conclusion` is `unable_to_determine`
- limitations mention the viewpoint/framing change
- JARVIS accepts visible scene change but blocks project progress wording

If `PIE_OPENAI_API_KEY` and the deployed function are unavailable, local tests must report `EXTERNAL_EXECUTION_REQUIRED` for provider-backed acceptance instead of claiming completion.
