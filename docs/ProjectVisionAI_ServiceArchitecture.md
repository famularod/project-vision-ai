# Project Vision AI Service Architecture

## Objective

DAVE's intelligence should become easier to trust, test, and improve without flattening distinct reasoning responsibilities into one file. The target is a small set of stable application-facing domains with specialized internal services behind them.

## Target Domains

1. **Project truth and evidence** — projects, areas, updates, documents, capture memory, evidence quality, timeline, and current Reality.
2. **Schedule intelligence** — import, normalization, reconciliation, task state, milestones, and schedule-driven field priorities.
3. **Photo intelligence** — capture preparation, visual analysis, longitudinal comparison, continuity, correction, and qualified Reality evidence.
4. **Decision intelligence** — beliefs, alternatives, challenge, prediction, Executive Judgment, decisions, outcomes, and learning.
5. **Reporting and communication** — report contracts, construction narrative, audience formatting, review, approval, copy, email, and text handoff.
6. **Sync, identity, and persistence** — authentication, organization scope, queues, tombstones, storage, cloud recovery, and repositories.
7. **Runtime and experience** — one authoritative DAVE response, attention, mission, conversation, and UI-ready guidance.

UI screens should depend on these domain boundaries. Internal engines may remain specialized, but screens should not assemble competing intelligence from many services.

## First Boundary

`services/domains/reporting.ts` is the first stable application-facing facade. App, provider, report-selection hook, and report screens obtain their report contracts through this boundary. Internal intelligence services continue to use `PIEReporter` directly during migration.

## Dependency Audit

Run:

```bash
npm run test:service-architecture
```

The audit starts from the production mobile entry points and follows static imports. It reports services not reachable from the live application and prevents that count from growing.

Static reachability is evidence, not automatic permission to delete. Dynamic consumers, server-only paths, test harnesses, persistence foundations, and planned migrations must be examined first.

## Build 48 Classification

The initial audit found 131 flat service files: 113 were reachable from the mobile entry and 18 were not statically reachable.

Three tiny services had no production, test, documentation, or indirect consumers and duplicated behavior already owned elsewhere. They were removed:

- `EmailService.ts`
- `ExportService.ts`
- `NotificationService.ts`

The remaining non-live services fall into two groups.

### Deliberate infrastructure or validation foundations

Preserve until their production integration is explicitly decided:

- `PIEMultimodalEvidence.ts`
- `PIEPhotoProgressIntelligenceStorage.ts`
- `PIEPhotoVisionPipeline.ts`
- `PIERealityModelGuards.ts`
- `PIETraceability.ts`

These are exercised by architecture, photo-intelligence, persistence, or traceability validation even when the current mobile import graph does not reach them.

### Removed legacy feature islands

These services were connected only to components that were themselves outside the live mobile graph. The services, their orphan card/filter components, and stale navigation identifiers were removed together:

- `AIProjectCoach.ts`
- `ConstructionTimelineService.ts`
- `ContractorPerformanceService.ts`
- `CriticalPathService.ts`
- `DelayAnalysisService.ts`
- `MilestoneTrackingService.ts`
- `PortfolioDashboardService.ts`
- `ProjectAIAnalysisService.ts`
- `ProjectRiskService.ts`
- `WeeklyExecutiveReportService.ts`

After coordinated cleanup, the reachability ratchet is five. Those five files are the deliberate validation and persistence foundations listed above; no legacy product feature island remains in the non-live service list.

## Rules

- Do not add a new top-level intelligence engine when an existing domain owns the responsibility.
- Add application-facing capabilities through a domain facade.
- Keep Runtime as the single UI-facing intelligence response whenever practical.
- Require executable behavior tests for changed or extracted logic.
- Remove a service only after production reachability, indirect consumers, tests, docs, and persistence responsibilities are reviewed.
- Ratchet unreachable-service and `App.tsx` budgets downward; never raise them merely to accommodate new work.
