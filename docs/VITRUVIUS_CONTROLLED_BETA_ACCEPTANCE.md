# Vitruvius Controlled Beta Acceptance

Status: evidence framework implemented; controlled beta evidence not yet complete  
Scope: essential readiness items 5-7  
Last updated: 2026-08-08

## Decision boundary

This document defines the evidence required before inviting outside project
managers into a controlled Vitruvius beta. It does not authorize a build,
deployment, App Store submission, live ECOS publication, or unrestricted public
sale.

A passing automated suite proves source and evidence-file contracts. It does not
prove that somebody used a physical device. Physical-device, accessibility,
recovery, and pilot results count only when the named release candidate was
actually exercised and durable evidence is attached.

## 1. Physical device, web, offline, and accessibility acceptance

Use one exact release candidate on an iPhone, an iPad, and the production-like
web runtime. Record the version, build, source revision, device/browser, and OS
for every platform. The installed version and build must match the release
candidate; a simulator result cannot be recorded as physical-device evidence.

Exercise these journeys on all three surfaces where the capability is exposed:

1. sign in and recover the same session after navigation or restart;
2. synchronize to zero pending or retry items and verify the same records and
   values on iPhone, iPad, and web/desktop;
3. create and edit a task, including percent and status consistency;
4. complete guided voice or text capture, including Skip;
5. capture a field note and verify desktop receipt/editing;
6. add a document, leave the page, and resume background preparation;
7. ask ECOS a supported question and open its exact current-document proof; and
8. review a report without an unapproved write.

Cloud synchronization is a hard release blocker. A release candidate cannot
pass while any supported device reports pending, retry, or attention items; if
the same task, document, field update, GPS area, percent complete, status, or
other shared record differs between devices; or if the app says Connected while
synchronization is not healthy. Acceptance requires at least three consecutive
clean synchronization cycles, including closing and reopening each client.

Offline and recovery acceptance must prove:

- create while offline, reconnect, and synchronize once;
- background/foreground resume without resetting work;
- retry does not create duplicate records;
- a real conflict is visible instead of silently overwriting either side; and
- pending work survives an app restart;
- every queue reaches zero pending or retry items after recovery;
- iPhone, iPad, and web/desktop converge on the same records and values;
- three consecutive sync/reopen cycles remain clean;
- one offline edit reconnects and commits exactly once;
- no duplicate, lost, resurrected, or stale record appears; and
- Connection status reports healthy only when cloud synchronization is healthy.

Accessibility review must include VoiceOver, Dynamic Type, reduced motion,
contrast, focus order, and touch targets on iPhone and iPad. Web review must
include keyboard-only navigation, a screen reader, 200% zoom, reduced motion,
contrast, and focus order. Test the largest supported text size on the Ask ECOS
answer/proof sheet, task editor, field-note capture, document status, and error
recovery surfaces. A clipped primary action, hidden project/task identity, or
unreachable proof is release-blocking.

Record the results in a copy of
`validation/beta/device-accessibility-evidence-template.json`. Screenshots,
screen recordings, device logs, and defect records belong in a build-specific
folder under `validation/beta/evidence/`; do not put credentials, customer
document text, access tokens, or personal information in the evidence.
Candidate metadata and actual behavior have separate evidence fields. Automated
source tests may be recorded, but they cannot satisfy a physical-device or
interactive-web behavior evidence field.

## 2. Support, operations, and recovery acceptance

The existing repository has useful foundations:

- protected operations health checks for stuck AI work, cleanup, retention,
  and deletion markers;
- checkpointed hosted-indexer recovery and a fail-closed shadow/live boundary;
- encrypted complete backup and restore;
- offline queue, retry, and deletion non-resurrection contracts; and
- customer-safe status language separated from protected diagnostics.

Those foundations do not establish a support operation. Before controlled beta,
assign an incident commander plus support, security, and privacy owners. Publish
a working support address and a help reference. Define who receives alerts for
queue age, failure rate, latency, capacity, and cost.

Complete and retain evidence for these recovery drills:

1. visual/provider outage fails closed and does not invent an answer;
2. hosted work resumes from a page checkpoint;
3. encrypted backup restores on disposable data;
4. a disposable project survives export and restore;
5. deleted records do not return after reconnect/restart;
6. a second tenant cannot access status, source, page, proof, export, or delete;
7. the application can roll back without publishing unverified ECOS evidence;
8. support can resolve a customer-safe incident reference without exposing
   provider, token, tenant, or document detail.

Record results in a copy of
`validation/beta/operations-recovery-evidence-template.json`. Critical and high
risks must be resolved, closed, or explicitly accepted by the authorized product
owner before the gate can pass.

### Incident levels

- **Critical:** suspected cross-tenant access, credential exposure, destructive
  data loss/corruption, unsupported factual answer presented as verified, or a
  broad authentication outage. Stop affected processing, preserve evidence,
  notify the incident commander and security owner, and do not promote a build.
- **High:** a core field workflow is unavailable, the processing queue is
  materially stuck, exact proof cannot open, backup/restore fails, or a deletion
  can return. Contain the feature, notify support, and block beta expansion.
- **Moderate:** bounded degradation with a safe workaround and no evidence or
  tenant-integrity risk. Record a defect, owner, target release, and customer
  communication if needed.
- **Low:** cosmetic or instructional problem that does not hide an action,
  status, limitation, or proof.

Never ask a customer to supply a provider key, provider account, or separate
processing credit as an incident workaround.

## 3. Outside-user pilot

The pilot requires five to ten working project managers who did not help build
Vitruvius. Use pseudonymous participant IDs. Obtain consent for product testing
and recording, but do not store names, email addresses, project documents, or
credentials in repository evidence.

Do not send an invitation until the pilot preflight passes. For the exact pilot
release candidate, ECOS must either:

- remain shadow-only or visibly disabled on every customer surface, with
  evidence that an invited user cannot invoke it; or
- have passed the current protected real-question acceptance, exact-proof,
  negative-control, multi-project live acceptance, and release-candidate checks,
  with durable evidence linked in the pilot file.

Run the preflight before inviting anyone:

```sh
npm run beta:pilot-preflight -- \
  --plan validation/beta/evidence/build-161/pilot.json
```

The preflight also requires explicit product-owner authorization for outside-user
invitations. A stale acceptance result from another build does not qualify.

Give the participant only the normal Vitruvius entry point and this goal:

> Sign in, create a project, add project documents, leave and return while they
> prepare, determine whether the project is Ready for ECOS or Needs Review, ask
> one supported project question, and open the exact proof.

If Ask ECOS is disabled for the pilot, omit the last two actions and record them
as `not_applicable_disabled`; do not expose an unaccepted answer path merely to
complete the pilot script.

Do not verbally guide first-project setup. If the participant asks for help,
record a support intervention and the exact point of confusion; do not coach
them past it and then mark the step unassisted. Background indexing time is
excluded from the ten-minute setup target, but the participant must understand
that they may safely leave and how readiness will be communicated.

Pilot acceptance requires:

- 5-10 eligible participants;
- at least 90% complete onboarding without a support intervention;
- at least 90% complete setup within ten minutes, excluding background work;
- zero requests for customer provider/API credentials;
- zero provider-account or processing-credit confusion;
- every abandonment, reconnect failure, unclear status, and proof-navigation
  failure linked to a defect; and
- no unresolved critical or high defect.

Record results in a copy of
`validation/beta/outside-user-pilot-evidence-template.json`. `overallStatus`
may become `pass` only after the complete pilot, not after an internal rehearsal.

## Machine-checkable gate

First verify the repository contract:

```sh
npm run test:beta-readiness
```

Then copy the three templates into a build-specific evidence folder, replace
every pending/null value with actual results, and run:

```sh
npm run beta:gate -- \
  --device validation/beta/evidence/build-161/device.json \
  --operations validation/beta/evidence/build-161/operations.json \
  --pilot validation/beta/evidence/build-161/pilot.json
```

The gate fails when evidence is missing, a platform does not match the release
candidate, synchronization has not reached and retained zero pending work on all
three clients, cross-device records differ, an accessibility or recovery
scenario is pending, ownership or operating decisions are missing, pilot
thresholds are missed, evidence files do not exist, or a blocking defect remains
open.

## Decisions and external actions still required

The repository cannot safely choose or fabricate these values:

1. recovery-time objective and recovery-point objective;
2. incident-notification target and customer-notification authority;
3. support hours, support address, escalation route, and named role owners;
4. pilot capacity and which invited PMs are eligible;
5. approved retention policy and provider-outage policy;
6. help-center and service-status procedures;
7. participant consent language and incentive, if any; and
8. which exact signed release candidate begins the pilot.

Adjacent lifecycle review found an encrypted complete backup/export and restore,
project/document deletion foundations, and browser/native sign-out. It did not
find a complete in-app account-deletion workflow, a user-facing Google Drive
disconnect/revocation workflow, or published privacy/terms/support destinations.
Those changes affect authentication, destructive cloud deletion, legal policy,
and external services and must not be invented or deployed as part of this
acceptance-only work.
