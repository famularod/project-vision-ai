# PIE Reality Model

## Purpose

Layer 2 is Reality Modeling.

The Reality Model is PIE's single current representation of project reality. Layer 1 perception outputs, evidence quality, missing evidence, evidence timeline, schedules, photos, notes, GPS, issues, safety observations, decisions, documents, and reports update the Reality Model.

Judgment, prediction, reporting, attention, and experience should read from the Reality Model.

## Reality Object Registry

The Reality Model maintains an object registry. Each reality object includes:

- stable id
- type
- name
- project
- area or location when available
- current state
- current status
- evidence links
- knowledge links
- history
- last updated
- confidence/readiness placeholder
- next action placeholder
- object intelligence

## Object Types

- project
- building
- area
- work_package
- schedule_activity
- milestone
- inspection
- contractor
- issue
- risk
- decision
- document
- photo
- safety_observation
- report
- owner_action

## Object Statuses

- unknown
- not_started
- in_progress
- ready
- needs_verification
- blocked
- at_risk
- contradicted
- complete
- retired

## Object Intelligence

Each Reality Object should know:

- goalsSupported
- relationships
- dependencies
- confidence
- readiness
- riskLevel
- momentum
- nextBestAction
- uncertainty
- ownerNeeded

Object intelligence is produced by:

- buildRealityObjectIntelligence
- identifyObjectGoals
- identifyObjectRelationships
- identifyObjectDependencies
- calculateObjectConfidence
- calculateObjectReadiness
- calculateObjectRiskLevel
- calculateObjectMomentum
- buildObjectNextBestAction
- summarizeObjectIntelligence

## Relationship Types

- belongs_to
- supports
- blocks
- depends_on
- confirms
- contradicts
- affects
- assigned_to
- scheduled_before
- scheduled_after
- evidence_for
- risk_to
- decision_for
- inspection_for
- report_references

## Readiness Language

Object readiness must use user-facing language:

- Ready
- Needs Verification
- Uncertain
- Blocked

Confidence should consider evidence quality, evidence freshness, missing evidence, contradictions, user corrections, schedule status, belief readiness, and recent timeline activity. Raw confidence alone is not enough.

## Goal Examples

Fire Wall supports rough inspection, certificate of occupancy, and project closeout.

Schedule activity supports milestone, contractor sequencing, and report readiness.

Photo supports evidence quality, belief verification, and report support.

## Dependency Example

Electrical delay blocks inspection readiness, affects drywall, affects final closeout, and increases schedule risk.

## Evidence-To-Reality Sync

New evidence should:

- create new objects when needed
- update existing objects when matched
- add history events
- attach evidence links
- attach knowledge links
- mark stale or uncertain objects
- avoid duplicate objects where possible

## Core Output

`PIECoreIntelligence` exposes:

- realityModel
- realityModelSummary
- realityObjects
- realitySummary
- objectsNeedingVerification
- objectsAtRisk
- objectsBlocked
- objectsRecentlyUpdated
- objectIntelligence
- objectsReady
- objectsUncertain
- objectsWithHighRisk
- objectNextActions
- objectNextBestActions
- objectRelationshipSummary

## Reality Model Summary

The Reality Model summary must provide enough current-state detail for higher layers to avoid rebuilding context from raw evidence:

- totalObjects
- recentlyUpdatedObjects
- objectsReady
- objectsBlocked
- objectsAtRisk
- objectsNeedingVerification
- strongestCurrentRealityStatement
- weakestCurrentRealityAssumption
- recommendedEvidenceToImproveModel
- confidence

## Layer 2 Test Questions

Layer 2 must be able to answer:

- What is the current project reality?
- What changed recently?
- Which objects matter now?
- What is ready?
- What is blocked?
- What is uncertain?
- What supports the current goal?
- What is likely to happen next?
- What evidence would improve the model?

## Product Rule

PIE should not reason directly from scattered evidence when a current reality object exists. Evidence updates the Reality Model. Judgment and Wisdom read from the Reality Model.

Reporter, Attention, Experience, Prediction, and Executive Reasoning should not rebuild raw context when the Reality Model is available.
