# ECOS Hosted Indexer Architecture

Status: steps 1-7 implemented in the repository for shadow validation; not
deployed or authorized for customer production  
Owner: ECOS Core and ECOS Assurance  
Last updated: 2026-08-08

## Non-negotiable customer boundary

> Customers should never need their own Gemini, OpenAI, Google Cloud, or
> Supabase account—and they should never enter an API key or purchase separate
> processing credits.

Vitruvius owns every provider account, credential, processing service, capacity
limit, retry policy, and provider bill used to deliver ECOS. Customer devices
are clients of the Vitruvius service. They are never required to act as ECOS
processing servers, remain powered on for indexing, or store developer secrets.

## Recommended production path

Build one Vitruvius-managed hosted indexing service with a deterministic-first
pipeline:

1. Accept a Vitruvius document upload or a customer-authorized file reference.
2. Calculate a source checksum and enqueue work only when content changes.
3. Extract native PDF text, vector geometry, page dimensions, and embedded
   metadata without an AI request.
4. Run coordinate-aware OCR only where native extraction is incomplete.
5. Map title blocks, sheet numbers, revisions, disciplines, details, and
   cross-references using deterministic rules with confidence and conflicts.
6. Run local template and vector-symbol analysis for repeatable drawing
   symbols and geometry.
7. Request a bounded visual interpretation only for unresolved regions. The
   visual provider is an internal implementation detail and may be changed or
   disabled without requiring a customer configuration change.
8. Have ECOS Assurance validate project identity, current revision, exact
   values and units, calculations, coordinates, conflicts, and proof.
9. Publish the compact evidence index only after the verified commit succeeds.
10. Notify the customer that the document is **Ready for ECOS**, **Needs
    Review**, **Reconnect Files**, or **Temporarily Unavailable**.

## Repository implementation delivered on 2026-08-08

The first seven approved production-path steps now have an additive,
provider-neutral implementation:

1. `ecos_hosted_index_jobs` provides the durable organization/project/document
   queue, leases, retries, checkpoints, support references, and customer-safe
   states.
2. The hosted worker verifies the immutable source checksum and extracts native
   PDF text, positions, dimensions, and vector geometry before using OCR.
3. Coordinate-aware OCR runs only when native page text is insufficient.
4. Deterministic sheet mapping and vector analysis record confidence and leave
   conflicting identities unverified.
5. Only unresolved bounded regions can reach the internal visual-exception
   adapter; the provider and credentials remain replaceable Vitruvius details.
6. ECOS Assurance independently validates source identity, page identity,
   proof coordinates, unresolved regions, and searchable evidence before the
   worker can commit.
7. Web, iPhone, and iPad enqueue work and consume safe status and committed
   evidence. Google Drive selections receive a protected processing copy so a
   browser or customer computer does not need to remain open.

The migration defaults every organization to `shadow`. Shadow jobs checkpoint
and pass Assurance but do not replace the current searchable index. Promotion
to `live` is an explicit operations decision after the gates in this document.
See `docs/ECOS_HOSTED_INDEXER_RUNBOOK.md`.

The default production runtime should be a cross-platform container so the
service can scale independently of a customer's Mac. The proven Apple Vision
benchmark remains useful as a quality baseline, but it is not the public
runtime contract. Before selecting the OCR runtime, ECOS Assurance must compare
the container candidate against the same drawings, coordinates, positive
questions, and negative controls.

## Runtime flow

```text
Vitruvius web / iPhone / iPad
            |
            | authenticated enqueue and status requests
            v
Vitruvius API and tenant authorization
            |
            | durable organization/project job
            v
Hosted ECOS Indexer
  - source fetch and checksum
  - native PDF extraction
  - coordinate-aware OCR
  - deterministic sheet and vector analysis
  - bounded visual exceptions
            |
            v
ECOS Assurance commit
            |
            v
Tenant-scoped evidence index and proof coordinates
            |
            v
Ask ECOS read-only answer with exact proof
```

## Required job model

The public job model must be organization- and project-scoped. It must not use
a caller-supplied owner identifier as its authorization decision.

Required states:

- `queued`
- `fetching_source`
- `extracting`
- `mapping`
- `assuring`
- `ready`
- `needs_review`
- `reconnect_source`
- `temporarily_unavailable`
- `failed_internal`
- `cancelled`

Every job requires:

- organization, project, and document identity;
- immutable source checksum and page count;
- current revision marker;
- claimed-at and lease-expiration timestamps;
- retry count and internal failure category;
- completed-page checkpoints;
- created-by and requested-by audit identity; and
- committed evidence version.

Only a protected worker identity may claim jobs, save technical diagnostics, or
commit a verified index. Customer sessions may enqueue authorized documents,
read customer-safe progress, cancel their own pending work, and request review.

## File-source behavior

### Uploaded files

Vitruvius validates file type and size, scans the file, stores it in a
tenant-scoped location, and queues it automatically. Deleting the project
document removes the source and derived evidence according to the published
retention policy.

### Google Drive

The customer signs in to Google and selects files. Vitruvius owns the OAuth
application and file-picker configuration. If background refresh is offered,
Vitruvius securely holds only the narrowly scoped authorization needed for the
selected files and provides an in-app disconnect control. An expired or revoked
authorization becomes **Reconnect Files**, never an instruction to create a
Google Cloud project or supply a developer key.

### Files and iCloud Drive

The customer selects a file through the operating-system picker. Vitruvius
uploads a managed copy for background processing unless a future connector can
provide durable, narrowly scoped server access. This choice must be explained
before upload and governed by the retention policy.

## Customer-safe versus internal information

Customer-visible:

- document and project names;
- safe progress and completion state;
- review questions;
- current revision and readiness;
- evidence-backed answer, limitation, and proof; and
- a support reference when service intervention is required.

Protected internal diagnostics:

- provider and model names;
- credentials and account identifiers;
- rate, quota, token, and credit information;
- raw OCR/model responses;
- stack traces and HTTP codes;
- retry timing and worker leases; and
- cost and capacity telemetry.

## Security requirements before deployment

1. Replace owner-only authorization with organizations, memberships, project
   roles, and server-derived tenant identity.
2. Separate customer enqueue/read permissions from worker claim/write/commit
   permissions.
3. Encrypt source-connector refresh tokens and prevent them from reaching app
   bundles, browsers, logs, or analytics.
4. Verify cross-tenant denial for every table, storage object, queue operation,
   evidence query, proof crop, export, and delete path.
5. Add malware, decompression-bomb, malformed-PDF, and resource-limit defenses.
6. Record auditable document access and evidence-generation events without
   recording unnecessary document content in diagnostics.
7. Implement customer deletion, retention expiry, backup, and restoration.
8. Complete an independent security review before unrestricted public access.

## Reliability and cost gates

The hosted candidate must pass the same factual standard regardless of its OCR
or visual provider:

- 100% supported-answer correctness;
- 100% correct refusal for unsupported answers;
- exact current-document proof for every factual answer;
- three consecutive clean production acceptance cycles;
- initial and incremental indexing time targets;
- queue recovery after process, network, and provider interruption; and
- measured cost per vector page, scanned page, visual exception, stored
  document, and Ask ECOS question.

A candidate that is cheap but misses evidence is rejected. A candidate that is
accurate but requires customer accounts, keys, credits, or always-on hardware
is also rejected.

## Current prototype gaps to replace

The current prototype is not the public hosted design because:

- the queue is directly manipulated by the signed-in client;
- authorization is restricted to the single app owner;
- the commit path requires that same owner session;
- Drive access is held in the browser and can expire before background work
  finishes; and
- verified commit currently requires a fixed six-tile visual pass on every
  page, even when native PDF, OCR, or deterministic vector evidence already
  proves the fact.

These gaps must be migrated without weakening fail-closed answer behavior.
Existing prototype tables and functions should remain compatible until the new
worker has passed shadow-mode comparison and recovery testing.

## Implementation sequence

1. Benchmark a container-capable extraction stack against the current Apple
   Vision baseline and real acceptance questions.
2. Approve the worker host, processing region, file-retention boundary, and
   expected unit costs.
3. Approve the organization, membership, project-role, job-lease, and worker
   authorization schema.
4. Implement the queue and worker in shadow mode with no production-index
   replacement.
5. Add managed upload processing and server-side selected-file Drive refresh.
6. Compare hosted evidence to the approved benchmark, including negative
   controls and cross-sheet answers.
7. Enable ECOS Assurance commits for a controlled external pilot.
8. Add customer notifications, reconnect, review, cancel, deletion, and
   support flows.
9. Measure reliability, latency, capacity, and unit economics during the pilot.
10. Authorize paid early access only after the security, reliability, privacy,
    support, and economics gates pass.

## Decisions still requiring product-owner approval before a public pilot

Repository implementation does not decide or authorize:

1. hosted worker vendor and processing region;
2. managed upload retention period and maximum document size;
3. whether Vitruvius stores Drive refresh authorization for automatic updates;
4. organization roles and who may add, index, ask about, export, and delete
   documents;
5. pilot limits for projects, pages, seats, and visual exceptions; and
6. subscription pricing and the treatment of usage above a plan allowance.
