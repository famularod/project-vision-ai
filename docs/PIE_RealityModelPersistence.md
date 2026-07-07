# PIE Reality Model Persistence

## Purpose

Layer 2 Reality Modeling is PIE's authoritative living representation of project reality.

The durable model is organization-scoped and project-scoped. It is not a global app cache and it is not rebuilt from scratch as normal production behavior.

## Required Flow

```text
Qualified Evidence
  -> Evidence-to-Reality Synchronization
  -> Authoritative Reality Model
  -> Situation Intelligence
  -> Predictive Reality
  -> Executive Judgment
  -> Reporter / Attention / Experience
  -> Layer 4 Outcome History
```

## Persisted Model

Each model records:

- organization ID
- project ID
- model version
- model status
- created time
- last synchronized time
- source evidence cutoff time
- model confidence
- readiness
- expected future state
- Reality Objects
- relationships
- dependencies
- active risks
- active uncertainties
- evidence conflicts
- change history

## Reality Objects

Reality Objects represent real project entities such as project, building, area, room, equipment, asset, issue, risk, action item, milestone, decision, vendor, permit, inspection, document, stakeholder, and constraint.

Photos and updates are evidence for objects. They should not become a new Reality Object every run.

Each object keeps:

- stable object ID
- organization ID
- project ID
- type
- name and description
- current, prior, and expected state
- owner
- location or area
- source evidence references
- assertions
- relationships
- dependencies
- goals
- readiness
- risk
- uncertainty
- confidence
- next best action
- last observed and changed times
- history

## Knowledge Classification

Important assertions are classified as:

- fact
- assumption
- inference
- prediction

Rules:

- Facts require evidence.
- Assumptions stay labeled and reviewable.
- Inferences require an explanation.
- Predictions preserve assumptions and timeframe.
- Promotion from assumption or inference to fact must create history.

## Conflicts And Uncertainty

Conflicting evidence must be preserved as first-class conflict records. PIE must not collapse both sides into one status value.

Uncertainty records identify missing evidence, stale evidence, weak evidence, ambiguous identity, unknown owner, unknown completion status, unknown dependency, uncertain schedule, uncertain cost, uncertain risk, and uncertain outcome.

## Storage

Local storage uses organization/project-scoped keys through `PIERealityModelStorage`.

Repository access is centralized through `PIERealityModelRepository`.

Synchronization is centralized through `PIERealityModelSynchronization`.

Reporter, UI components, and Layer 4 do not directly update Reality Objects.

## Database

The Supabase schema defines:

- `pie_reality_models`
- `pie_reality_objects`
- `pie_reality_assertions`
- `pie_reality_relationships`
- `pie_reality_object_history`
- `pie_reality_model_snapshots`
- `pie_reality_conflicts`
- `pie_reality_uncertainties`

Every table carries organization and project boundaries. History and snapshots are append-only. RLS uses the existing active organization membership permission helpers.

## Current Boundary

Reporter and Layer 4 still have deprecated raw/report compatibility paths. New intelligence work should use the authoritative Reality Model or structured Layer 3 Executive Judgment.
