# ECOS Hosted Indexer Runbook

Status: controlled shadow deployment active; customer publication remains disabled  
Public production status: not authorized  
Last updated: 2026-08-08

## Customer promise

Customers sign in to Vitruvius and add project documents. They never create a
provider account, enter an API key, buy processing credits, or keep a Mac or
browser running while ECOS prepares documents.

## Runtime pieces

- Vitruvius web, iPhone, and iPad enqueue authorized documents and read only
  customer-safe progress.
- Supabase stores tenant-scoped jobs, page checkpoints, visual exceptions, and
  verified evidence.
- The container in `workers/ecos-indexer` runs under a protected Vitruvius
  service identity.
- A visual provider is optional and may receive only bounded unresolved page
  regions. It is never called for pages resolved by deterministic extraction.
- Ask ECOS prefers the new Assurance-approved evidence and temporarily falls
  back to the existing index during shadow validation.

## Controlled deployment order

1. Use the selected Google Cloud Run Job in `us-west1`, adjacent to the linked
   Supabase `us-west-1` project. The job has no public administrative endpoint.
2. Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the host's secret
   manager. Never use an `EXPO_PUBLIC_` name for either value.
3. Optionally configure a Vitruvius-owned bounded visual service with
   `ECOS_VISUAL_PROVIDER_URL` and one randomly generated
   `ECOS_SERVICE_WORKER_TOKEN`. Store that same token in the Edge Function and
   bind it to the worker runtime as `ECOS_VISUAL_PROVIDER_TOKEN`. This is
   Vitruvius infrastructure—not a customer setting or provider API key.
4. Apply `20260808010000_ecos_hosted_indexer.sql` to the controlled environment.
   Confirm every organization remains in `shadow` publication mode.
5. Build and deploy the `workers/ecos-indexer/Dockerfile` container with one
   task, 2 vCPU, 4 GiB, an eight-document batch limit, and a 55-minute batch
   deadline. Cloud Scheduler starts one batch each minute. Add parallel tasks
   only after queue and cost telemetry is live.
6. Upload one known vector PDF, one scanned PDF, and one mixed PDF through the
   normal customer experience. Close the browser and verify the jobs continue.
7. Verify retries resume completed-page checkpoints after stopping and
   restarting the worker.
8. Run the accepted real-question set and negative controls against shadow
   evidence. No answer may be published from a rejected or unresolved page.
9. Run authenticated cross-tenant attempts for status, source, page, chunk,
   proof, cancel, export, and deletion paths. Every attempt must be denied.
10. Record latency and unit cost separately for native pages, OCR pages, visual
    exceptions, stored PDFs, and Ask ECOS questions.

## Managed deployment commands

The operator—not a customer—loads protected values into the shell and runs
`scripts/configure-ecos-hosted-indexer-secrets.sh`. The script writes secret
versions without printing their values. `scripts/deploy-ecos-hosted-indexer.sh`
then builds through Google Cloud Build, deploys the private Cloud Run Job, and
creates the one-minute scheduler. Set `ECOS_EXECUTE_AFTER_DEPLOY=true` only when
the controlled shadow queue is ready to run.

## Protected shadow acceptance

Shadow validation uses two independent credentials:

- the normal short-lived access token for the project owner; and
- the Vitruvius-owned `ECOS_SERVICE_WORKER_TOKEN` held by the operator.

The deployed Ask ECOS function accepts `validationMode: "shadow"` only when
both credentials are valid. It then reads only the current-checksum hosted job,
Assurance-approved pages, and evidence with zero unresolved regions. Live
customer requests cannot select this evidence path, the worker token cannot
replace a customer login, and live and shadow answer caches use different
fingerprints.

Run the protected real-world suite with short-lived values loaded only into the
process environment:

```sh
ECOS_LIVE_SHADOW_VALIDATION=true \
ECOS_LIVE_ACCESS_TOKEN='short-lived-owner-token' \
ECOS_SERVICE_WORKER_TOKEN='operator-secret' \
npm run test:ecos-ask:live
```

Do not publish the shadow evidence after a single successful run. The complete
15-case benchmark must pass three consecutive clean cycles before the Step 9
physical-device and web expectations review begins.

## Shadow-to-live gate

Do not change an organization to `live` until all of these are recorded:

- the same source checksum and page count were processed;
- all pages passed ECOS Assurance;
- supported answers and unsupported refusals were both 100% correct;
- every supported answer opened current-document proof;
- interruption recovery passed;
- cross-tenant security passed;
- retention, deletion, malware, malformed-PDF, and resource-limit controls
  passed; and
- three consecutive clean acceptance cycles passed.

Promotion is a deliberate database operations change to the organization's
`ecos_hosted_index_configuration.publication_mode`. It is not exposed in a
customer screen.

## Recovery behavior

- `Waiting` or `Preparing`: leave the job queued; the worker will claim it.
- `Reconnect Files`: the managed source is missing or unreadable. The customer
  selects the file again; no provider configuration is requested.
- `Temporarily Unavailable`: support uses the job's safe support reference to
  inspect protected diagnostics. Customers never see provider or quota detail.
- `Needs Review`: do not publish the disputed page as evidence. Present only
  the bounded identity or factual conflict that requires review.
- Worker restart: assured pages remain checkpointed and only unfinished pages
  are processed.
- Worker algorithm upgrade: an operator may call the service-only
  `ecos_reset_hosted_shadow_job_for_reindex` function with the exact job ID,
  current source checksum, and audit reason. It clears only that shadow job's
  checkpoints; no customer session can invoke it and live evidence is not
  modified.

## Rollback

Keep every organization in `shadow`, or return the affected organization to
`shadow`, stop the hosted workers, and continue using the existing verified
index. Do not delete the existing prototype tables during the controlled pilot.
The hosted migration is additive so rollback does not require rewriting current
document records.

## Remaining public-release work

The hosted path must not be described as production-ready until there is a
selected host, live secret custody, malware and malformed-file defenses,
retention/deletion automation, operations telemetry, incident response,
independent security review, outside-user pilot, and the complete reliability
acceptance required by `docs/VITRUVIUS_PUBLIC_RELEASE_READINESS.md`.
