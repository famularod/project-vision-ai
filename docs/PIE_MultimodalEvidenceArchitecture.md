# PIE Multimodal Evidence Architecture

## Purpose

PIE treats every input as evidence with lineage, authority, limitations, and project boundaries. Evidence can support Reality, Executive Judgment, reporting, attention, and user guidance, but evidence analysis never becomes truth by itself.

## Evidence Types

The shared evidence model supports:

- photo
- drawing
- schedule
- contract
- inspection_report
- email
- meeting_note
- cost_report
- equipment_reading
- oee_feed
- field_measurement

## Core Record

`PIEEvidenceRecord` stores organization ID, project ID, evidence ID, evidence type, source, source system, captured/effective/received time, author, storage refs, content hash, MIME type, version, authority, processing state, analyzer metadata, lineage, supersession, associations, and related evidence.

The canonical TypeScript implementation is `services/PIEMultimodalEvidence.ts`.

The Supabase persistence foundation is `supabase/migrations/20260702030000_multimodal_evidence_foundation.sql`.

## Structured Analysis Contract

Every analyzer must produce structured output:

- observations
- inferences
- extracted entities
- dates
- commitments
- owners
- measurements
- risks
- conflicts
- missing information
- confidence
- limitations
- authority
- corroboration requirement

Observations describe what the evidence directly supports. Inferences are separate and must remain qualified. Analysis with no limitations is rejected.

## Storage

The evidence bucket is `pie-project-evidence` and is private. Paths are organization/project scoped:

`{organizationId}/{projectId}/photo/{evidenceId}/{variant}.{extension}`

Variants are:

- original
- analysis_derivative
- thumbnail

Mobile code must not depend on temporary device URIs after upload. Persistent records use storage refs and content hashes.

## Authorization

The current authorization provides organization membership authorization plus project identity checks and parent-child project consistency. It does not yet provide true per-project user authorization because the current data model does not expose a durable project membership table.

Policies use the existing `public.pie_layer4_has_permission(org_id, project_id, permission_name)` function. That function currently validates non-empty project identity and delegates user authorization to organization membership.

## Processing

Processing states are:

- not_started
- queued
- processing
- succeeded
- degraded
- failed
- blocked

Retries are idempotent when content hash, analyzer version, and policy version have not changed.

## Correction

User corrections create correction records. They do not erase the original analysis. Corrected output can supersede an analysis while preserving lineage.

## Reality Integration

Photo analysis can produce qualified Reality evidence only after visual JARVIS validation passes. The bridge intentionally emits qualified photo observations and does not replace authoritative Reality when analysis fails.
