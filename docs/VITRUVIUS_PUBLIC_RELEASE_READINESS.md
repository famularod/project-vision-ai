# Vitruvius Public Release Readiness

Status: preparation authorized; unrestricted public sale not yet authorized  
Owner: Vitruvius product and ECOS Assurance  
Last updated: 2026-08-08

## Guiding customer rule

> Customers should never need their own Gemini, OpenAI, Google Cloud, or
> Supabase account—and they should never enter an API key or purchase separate
> processing credits.

Vitruvius owns, secures, operates, monitors, and pays for every provider needed
to deliver the purchased product. Provider selection and capacity are internal
implementation details. A customer buys Vitruvius, signs in to Vitruvius, and
connects project files; the customer does not assemble the Vitruvius service.

Google Drive and future document sources are deliberate exceptions only in the
sense that customers authorize access to their own files. Vitruvius still owns
the production integration. The customer selects files and grants narrow
permission; the customer does not create a Google Cloud project or provide a
developer credential.

## Required first-project experience

1. Install or open Vitruvius.
2. Create or sign in to a Vitruvius account.
3. Create a project with a name and optional address.
4. Select **Add Project Documents**.
5. Choose **Google Drive** or **Files / iCloud Drive**.
6. Select the project files. Vitruvius detects document type, discipline,
   revision, sheet identity, and current status where evidence is sufficient.
7. Review only uncertain items.
8. Leave the page if desired while Vitruvius prepares the documents.
9. Receive a **Ready for ECOS** notice.
10. Ask a sample question and open its exact proof.

The normal status vocabulary is:

- Waiting
- Preparing
- Ready for ECOS
- Needs Review
- Reconnect Files
- Temporarily Unavailable

Normal customer screens must not show provider names, model names, API keys,
provider quotas, processing-credit instructions, internal index versions,
stack traces, HTTP status codes, or retry algorithms.

## Commercialization workstreams

### R1. Product constitution and customer boundary

Status: implemented in the repository.

- The guiding rule is part of the canonical Product Constitution and Master
  Architecture.
- ECOS Assurance has a customer-setup contract test.
- Normal document-indexing copy is provider-neutral.

### R2. Hosted ECOS Indexer

Status: controlled Google Cloud deployment active in fail-closed shadow mode;
live tenant isolation passed, while benchmark acceptance and production
promotion remain blocked.

See `docs/ECOS_HOSTED_INDEXER_ARCHITECTURE.md` for the authoritative hosted
service boundary and implementation sequence.

- Run coordinate-aware OCR and deterministic PDF/vector extraction first.
- Use paid visual interpretation only for unresolved bounded regions.
- Process work in a durable organization/project-scoped queue.
- Checkpoint every completed page and retry only unfinished work.
- Keep source PDFs in the customer-selected source when practical.
- Store compact evidence, mappings, hashes, and proof coordinates in the
  Vitruvius data service.
- Ensure no worker can read or write another organization's project evidence.

The additive migrations, cross-platform worker, private Cloud Run Job, managed
processing-copy path, customer-safe status contract, Assurance-gated evidence
path, malware scan, bounded resource controls, retention cleanup, queue health,
and cost telemetry are deployed for the controlled 2375 shadow tenant. No
hosted evidence is customer-visible. The protected 15-question benchmark and
three consecutive clean cycles remain required before the Step 9 testing
expectations review or any promotion decision.

The hosted indexer—not a customer's Mac—is the required public runtime.
Vitruvius web, iPhone, and iPad remain clients of that service.

### R3. One-screen onboarding

Status: experience contract approved; implementation required.

- One primary action: **Add Project Documents**.
- Vitruvius-owned configuration failures never become customer setup tasks.
- Uncertain metadata is handled by review-by-exception.
- Indexing continues after navigation and survives restarts.
- Notifications report Ready, Needs Review, or Reconnect Files.

### R4. Multi-customer security and privacy

Status: initial live cross-tenant verification passed; formal threat model and
independent review remain required.

- Organization and project isolation.
- Least-privilege document-source authorization.
- Server-side credential and refresh-token custody.
- Encryption in transit and at rest.
- Audit history for document access and evidence creation.
- In-app account deletion, document deletion, Drive disconnect, and data export.
- Published privacy policy, terms, retention policy, and subprocessors.
- Live RLS and cross-tenant adversarial testing.

### R5. Subscription and usage model

Status: product and legal decision required before implementation.

- One Vitruvius subscription; no separate provider purchases.
- Understandable allowances: active projects, seats, stored documents, and new
  pages prepared per billing period.
- No surprise overages. A customer must approve any paid plan change.
- Usage warnings before a limit is reached.
- Entitlements synchronized across web, iPhone, and iPad.
- App Store purchase and subscription behavior reviewed against the current
  regional App Store rules before release.

### R6. Reliability acceptance

Status: prototype evidence exists; production gate not yet passed.

Cloud synchronization is a hard public-release blocker. Before promotion, the
same release candidate must prove on iPhone, iPad, and web/desktop that:

- every client reaches zero pending, retry, or attention items;
- tasks, documents, field updates, GPS areas, progress, status, and deletions
  converge to the same values;
- three consecutive sync cycles remain clean after each client is closed and
  reopened;
- an offline edit reconnects and commits exactly once;
- retries create no duplicate, lost, resurrected, or stale records; and
- Connected is never displayed when cloud synchronization is unhealthy.

Any failure of these checks blocks controlled beta expansion, paid early access,
and general sale even if the application can otherwise be opened and used.

- At least 100 real questions across at least five projects.
- Architectural, civil, structural, electrical, mechanical, plumbing, and
  specialty drawings.
- Vector, raster, and mixed PDFs.
- Multi-sheet and cross-discipline answers.
- Superseded revisions and conflicts.
- At least 30 plausible but unsupported negative controls.
- 100% correctness for every supported answer.
- 100% correct refusal for unsupported answers.
- Every answer opens valid current-document proof.
- Three consecutive clean production cycles.

The local 16-of-16 feasibility benchmark is valuable engineering evidence. It
does not satisfy this public-release gate by itself.

### R7. Outside-user pilot

Status: not started.

- Five to ten project managers who did not help build the product.
- No verbal setup assistance during their first-project attempt.
- First-project setup target: under ten minutes, excluding background work.
- No API/provider setup confusion.
- At least 90% complete onboarding without support intervention.
- Capture every abandonment, reconnect, unclear status, and proof-navigation
  failure as an actionable defect.

### R8. Operations and customer support

Status: controlled-runtime foundations implemented; public support operations
and alert routing remain required.

- Support email and customer help center.
- Protected internal job diagnostics and customer-safe incident references.
- Queue age, failure rate, latency, capacity, and cost alerts.
- Retry/recovery controls for support personnel.
- Backup and restoration validation.
- Incident response, customer notification, and service status procedures.
- Refund and billing-support procedures.

### R9. Store readiness

Status: preparation required after pilot entry criteria pass.

- Apple Developer and App Store Connect production records.
- Final screenshots, description, support URL, privacy URL, and age rating.
- Working reviewer demo account and current review notes.
- Production backend available throughout review.
- Manual initial release; controlled marketing and territory availability.
- Phased rollout for later version updates.
- Verified production build/version metadata and physical-device evidence.

## Actions outside the original eight-step path

These are additional requirements that need explicit review and ownership:

1. **Business and legal entity:** seller identity, tax, banking, contracts,
   terms, privacy, and trademark review.
2. **Unit economics:** measure indexing cost per vector page, scanned page,
   visual exception, stored document, and Ask ECOS question before setting
   prices.
3. **Abuse protection:** upload limits, malware/file validation, rate limits,
   denial-of-service controls, and prohibited-content handling.
4. **Document rights:** customer confirmation that they may upload and process
   project drawings and specifications.
5. **Accessibility:** VoiceOver, Dynamic Type, contrast, keyboard navigation,
   and reduced-motion acceptance on public workflows.
6. **Supportability:** an internal admin console that exposes technical detail
   without exposing it to customers.
7. **Disaster recovery:** documented recovery-time and recovery-point targets,
   restoration exercises, and provider-outage fallback behavior.
8. **Analytics and consent:** privacy-respecting onboarding, failure, latency,
   and abandonment measurements without collecting unnecessary document data.
9. **Security review:** independent penetration testing and dependency/source
   review before unrestricted public access.
10. **Public claims:** marketing must say ECOS provides evidence-backed project
    intelligence, not guarantee that every drawing question will receive an
    answer.

## Release decision states

- **Prototype:** internal developers and owner-operated projects.
- **Controlled pilot:** invited external users with active support.
- **Paid early access:** capped customers, usage, projects, and processing.
- **General sale:** only after security, reliability, onboarding, operations,
  economics, privacy, and store gates are all approved.

No automated test, local benchmark, or store build alone authorizes progression
to the next state. ECOS Assurance records the evidence, and the product owner
approves the transition.
