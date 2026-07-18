# DAVE Service-to-Outcome Map

## Purpose

DAVE earns its complexity only when it improves a project manager's observable result. The production import graph is the source of truth. Run `npm run test:service-architecture` after every architecture change.

## Production Domains

| Domain | PM outcome | Primary production boundary | User-visible surfaces |
| --- | --- | --- | --- |
| Project truth and evidence | One current, explainable project state from schedules, updates, documents, photos, and PM statements | `DAVEProjectTruth`, `PIEEvidenceFusion`, `PIERealityModel`, `DAVEProjectTruthRepository` | Overview, project workspace, Tasks, Reports |
| Schedule intelligence | Accurate activities, urgency, reconciliation, and PM-authoritative progress | `PIEScheduleIntelligence`, `PIEScheduleReconciliation`, `DAVECompletionVerification` | Tasks, Schedule management, project workspace |
| Photo intelligence | Safe visual findings, real prior-photo comparison, continuity guidance, and bounded change conclusions | `PIEPhotoVisionMobileWorkflow`, `PIEPhotoProgressIntelligence`, authenticated `pie-photo-vision` Edge Function | Capture, field updates, project detail |
| Decision intelligence | A reasoned recommendation with alternatives, challenge, uncertainty, and follow-through | `PIECoreIntelligence`, `PIEExecutiveJudgment`, `PIEDecisionSimulation`, `PIERecommendationChallenge` | Overview priority, Talk answers, action inbox |
| Reporting and communication | Concise, factual construction updates using only known project state | `services/domains/reporting.ts`, `PIEReporter`, `DAVEReportIntelligence` | Reports, email/copy preview |
| Sync, identity, and persistence | Local-first work that survives restarts and reaches the owner-scoped cloud without exposing technical errors | `SyncService`, `SupabaseService`, DAVE repositories, tombstones | Settings, retry status, all saved work |
| Runtime and experience | One consistent DAVE answer and next action across the app | `PIERuntime`, `PIELiveAuthorityProvider`, `PIEAttentionEngine`, `DAVEConversationRouter` | Overview, Talk, Tasks, Reports |

## Architecture Decisions

- `App.tsx` is a wiring shell under a no-growth ratchet. New behavior belongs in a domain, hook, provider, component, or service with behavior tests.
- UI code consumes stable application-facing boundaries rather than assembling competing conclusions.
- PM-entered status and percent complete are authoritative evidence. DAVE may explain conflicts but must not pretend the PM supplied no evidence.
- Photo claims remain visual observations unless corroborated. The mobile app does not maintain a second client-side vision engine.
- Reports communicate current known state; internal uncertainty and verification queues stay out of the written update unless they create a real PM action.
- A new “engine” requires a named PM outcome, a production consumer, and an executable behavior test.

## Reachability Disposition

Build 52 has 117 service files: 114 are reachable from the production mobile entry and three are intentionally retained foundations.

- `PIEPhotoProgressIntelligenceStorage.ts` — durable longitudinal-photo state; retain until it is connected to the live async intelligence boundary or its migration is retired.
- `PIERealityModelGuards.ts` — explicit Reality-first migration guard; retain while raw-evidence compatibility paths remain.
- `PIETraceability.ts` — recommendation-to-evidence trace contract exercised by live-authority validation; retain until the trace is returned from the application-facing reporting boundary.

The unreachable-service ratchet is three and may only move downward. `PIEMultimodalEvidence.ts` and `PIEPhotoVisionPipeline.ts` were removed because they duplicated the live Edge Function/mobile workflow and had no production consumer.

## Change Gate

For every service addition or consolidation:

1. Name the PM decision or task it improves.
2. Identify the production consumer and visible surface.
3. Reuse an existing domain boundary when possible.
4. Add executable behavior coverage.
5. Run `npm run qa:release` and the service reachability audit.
