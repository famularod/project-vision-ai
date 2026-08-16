# Vitruvius Beta Access and Customer Data Controls

Status: implementation foundation for a controlled beta. This document does not authorize team mode or public sale.

## Customer boundary

- Customers use a Vitruvius account. They do not create provider accounts, enter API keys, or buy separate AI processing credits.
- The current owner-supported beta remains the only authorized live access mode until multi-account isolation passes independent acceptance.
- Unknown, invited, suspended, removed, cross-organization, and cross-project memberships fail closed.

## Project roles

| Role | Intended capabilities |
|---|---|
| Viewer | View assigned projects and ask read-only ECOS questions |
| Contributor | Viewer capabilities plus field notes, photos, and task updates |
| Project manager | Contributor capabilities plus documents, ECOS proposal review, and project export |
| Project administrator | Project manager capabilities plus project membership, archive, and deletion controls |

The executable application contract is in `services/VitruviusBetaAuthorization.ts`. The additive database foundation is in `supabase/migrations/20260808100000_vitruvius_project_membership_beta_foundation.sql`.

The migration intentionally does **not** replace existing owner-scoped policies. Team access may be enabled only after every project table is migrated and tested as one coherent authorization boundary.

## Team-mode activation gate

All of the following are required before a second customer account receives project access:

1. Apply the membership foundation to an isolated non-production environment.
2. Add organization and project boundary enforcement to projects, tasks, updates, field notes, photos, documents, reports, ECOS evidence, and storage paths.
3. Prove two-organization and two-project denial tests for reads, writes, realtime events, signed URLs, background jobs, and deletion cleanup.
4. Add an administrator invitation and role-management screen with an audit receipt for every membership change.
5. Prove suspended and removed users lose active sessions, realtime access, signed artifacts, and background-job access.
6. Complete an independent security review before production deployment.

Until those gates pass, Vitruvius must provision beta accounts manually and keep one authorized owner per workspace.

## Customer data controls

Implemented or already present in the controlled workspace:

- Downloadable project-record export with explicit disclosure that media files are not included.
- Protected project/document deletion paths and storage cleanup tracking.
- A visible Google Drive disconnect control. It clears the in-memory browser credential and requests Google revocation without deleting the customer's Drive file or the already-created Vitruvius record.

Still required before an outside public beta:

- A complete portable export that includes, or securely packages, customer-owned media and documents.
- A verified self-service account-deletion workflow that removes authentication identity and customer data according to a published retention policy.
- A recoverable grace period, deletion audit receipt, and documented legal-hold exception handling.
- A customer-visible list of connected sources, processors, retention periods, and deletion status.
- Tested password recovery and session revocation for non-owner customer accounts.

No interface may claim an account is deleted until backend deletion, storage cleanup, authorization removal, and audit verification have all completed.
