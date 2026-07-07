# PIE True Photo Intelligence

## Definition

PIE may call a result true photo intelligence only when raw image pixels are analyzed by an approved image-capable model or approved computer-vision pipeline through the secure backend.

Caption, category, GPS, schedule, action-status, area, and metadata analysis is useful photo-adjacent intelligence, but it is not raw visual intelligence.

## Current App State

The existing in-app photo progress layer is deterministic. It sequences photos and compares project context using captions, metadata, areas, GPS, dates, action status, schedule links, and Reality Model references. It does not send raw pixels to a vision model from the mobile app.

This checkpoint adds:

- shared multimodal evidence types
- private evidence storage schema
- photo asset metadata schema
- structured visual-analysis contract
- server-side vision Edge Function scaffold
- deterministic visual eligibility checks
- JARVIS visual guardrails
- correction and idempotency helpers
- validation dataset and local regression tests
- provider-neutral production vision pipeline boundary
- single-photo and paired-photo structured schemas
- request, comparison, provider, latency, usage, and JARVIS persistence contracts

## Backend Boundary

Raw pixels are analyzed only by `supabase/functions/pie-photo-vision/index.ts`.

The function:

- authenticates the caller
- verifies organization/project access
- verifies the evidence row belongs to the requested organization and project
- downloads the private image server-side
- calls the configured provider only when server env vars are present
- validates structured JSON
- persists provider/model/prompt/policy/usage metadata
- stores degraded or failed state instead of pretending success

Provider secrets must never appear in the mobile bundle.

Photo findings are visual observations only and must keep hidden work, compliance, inspection, causation, responsibility, and exact progress claims out of authoritative project Reality unless corroborating evidence exists.

## Photo Authority

A photo can support only visible conditions. It cannot prove:

- hidden work
- code compliance
- inspection result
- causation
- responsibility
- exact percent complete without measurable scope
- work quality outside visible evidence

Photo findings are stored as `visual_observation_only` authority.

## Comparison

Photo comparison requires deterministic checks plus semantic analysis. If photos are not comparable, PIE must not infer change.

Comparison output records:

- earlier evidence ID
- later evidence ID
- comparability classification
- observations
- inferred changes
- deterministic checks
- confidence
- limitations
- human-review requirement

## Failure Behavior

If provider configuration is missing, timeout occurs, malformed JSON is returned, image access fails, or JARVIS rejects the result, the analysis state is degraded, failed, or blocked. Failed analysis cannot overwrite authoritative Reality.

## Required Acceptance Case

Baseline failure case 001, `mouse_added_to_table`, is a required acceptance case for True Photo Intelligence.

The system must detect that a black computer mouse appears in the newer desk/laptop photo, classify the pair as the same general scene with probable comparability, identify a material visible object-added change, and still conclude that project progress is unable to determine.

Required user-facing output:

`A black computer mouse appears in the newer photo. The viewpoint also changed slightly. This is a visible scene change, but it does not establish project progress.`

This capability is not complete until the real original image pair passes through the deployed production vision pipeline from a physical device.

Local deterministic raw-pixel analysis may prove fixture execution, but it does not satisfy this acceptance case. The provider-backed pipeline must independently identify the black computer mouse from raw pixels and keep project progress `unable_to_determine`.

## Production Vision Pipeline

The production boundary is `supabase/functions/pie-photo-vision/index.ts` plus the provider-neutral interface in `supabase/functions/_shared/pie-vision-provider.ts`.

Supported modes:

- `single_photo`
- `photo_pair`

The backend must:

- authenticate the caller
- verify organization membership and project identity under the current authorization model
- verify every evidence row belongs to the requested organization and project
- download images server-side from private storage
- call the configured provider with timeout and bounded retries
- validate structured output before persistence
- persist request, normalized findings, provider metadata, usage, latency, failure reason, and JARVIS result
- return degraded or failed state instead of fake success

The mobile app consumes `services/PIEPhotoVisionPipeline.ts` for pending, complete, degraded, review, retry, correction, hydration, and qualified Reality handoff states.

## Required Live Services

To make raw-pixel photo intelligence live, deploy the Edge Function and configure:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PIE_VISION_PROVIDER`
- provider-specific key such as `PIE_OPENAI_API_KEY`
- provider-specific model such as `PIE_OPENAI_VISION_MODEL`
