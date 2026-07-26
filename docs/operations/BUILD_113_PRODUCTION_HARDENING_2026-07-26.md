# Build 113 Production Hardening Status

Date: July 26, 2026

Branch: `codex/build113-production-hardening`

Target: Vitruvius 1.0.113 / Build 113

Assessment: source hardening is implemented and locally verified. No database
migration, edge function, hosted web release, app-store submission, or
production credential change has been performed by this work.

## Final automated evidence

- Two consecutive unchanged `npm run qa:release` cycles completed with every
  automated layer passing.
- The strict behavior suite passed 153 test suites and 1,040 tests.
- V.I.C. reported 251 passing static contracts with zero warnings or failures.
- A fresh `npm audit --audit-level=low` reported zero known vulnerabilities.
- An isolated Build 113 checkout completed `npm ci`, clean iOS/Android native
  generation, metadata verification, and both platform exports.
- The only automated warning is the deliberate Android production-signing
  refusal while the generated release build still uses the debug signing key.

## Implemented in source

- Protected photos and documents now have a durable, owner-scoped deletion
  outbox. Failed object removal remains retryable instead of being silently
  forgotten.
- Schedule-item, area, and reference-document tombstones remove corresponding
  active rows while permanent tombstones continue to prevent resurrection.
- Protected storage policies are narrowed to the authenticated app owner.
- Mobile and web synchronization process cleanup work and preserve generic
  user-safe failure messages.
- Metadata-only deletion receipts are purged after the approved one-year
  retention window; permanent tombstones are never purged.
- A scheduled, read-only operations-health check detects stale/failed storage
  cleanup, expired receipts, stuck AI work, recent AI failures, and unexpected
  tombstone changes without printing owner IDs or object paths.
- The unused `@expo/ngrok` development dependency was removed. Safe transitive
  overrides pin `brace-expansion` 5.0.8 and `uuid` 11.1.1 under `xcode`.
  `npm audit` reports zero known vulnerabilities for the exact lock.
- CI regenerates both native projects from reviewed Expo configuration and
  exports iOS and Android. A clean temporary checkout completed dependency
  installation, native generation, metadata checks, and both exports.
- EAS uses local version metadata and does not auto-increment production
  builds. `product-metadata.json`, `app.json`, native metadata, and the reviewed
  artifact therefore remain one auditable Build 113 identity.
- V.I.C. reports dependency security, operations monitoring, and reproducible
  native generation as named release layers. Escaped-defect registry item
  `JRV-REG-025` protects the orphaned-file cleanup behavior.

## Approval-gated database work

The July 26 linked dry run selects exactly one pending migration:

1. `20260726040000_vitruvius_storage_cleanup_lifecycle.sql`

The Project Truth history migration and atomic-deletion type correction are
already present in the linked production migration inventory.

Migration `20260726040000` changes a table, triggers, row-level-security
policies, and storage policies. Show the exact SQL and obtain explicit approval
before applying it. After deployment, run the controlled two-user live
authorization matrix and isolated deletion/storage tests.

## External configuration still required

- Configure repository secrets `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` for the scheduled aggregate health workflow.
- Configure approved Android production signing credentials. Current clean
  generation correctly reports debug signing and refuses Android production
  certification.
- Reserve and deploy the production web origin, configure exact CORS
  allowlists, and deploy affected backend/edge functions only after explicit
  approval.
- Provide Apple distribution credentials/profiles when an App Store or
  TestFlight release is in scope.

## Honest certification boundary

Automated source, dependency, migration-static, clean-generation, and export
checks can prove reviewed code and build reproducibility. They cannot certify
live RLS behavior, real storage deletion, provider availability, production
signatures, physical-device responsiveness, or three-client synchronization.
Those remain separate deployment and field evidence gates.
