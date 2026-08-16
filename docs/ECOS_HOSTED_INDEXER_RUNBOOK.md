# ECOS Hosted Indexer Runbook

Status: controlled shadow deployment active; customer publication remains disabled  
Public production status: not authorized  
Last updated: 2026-08-11

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
`scripts/configure-ecos-hosted-indexer-secrets.sh`. The script writes new secret
versions without printing their values and captures the returned numeric
versions in an operator-only manifest:

```sh
umask 077
ECOS_HOSTED_SECRET_VERSION_OUTPUT=validation/output/ecos-hosted-secret-versions.env \
  scripts/configure-ecos-hosted-indexer-secrets.sh
set -a
. validation/output/ecos-hosted-secret-versions.env
set +a
scripts/deploy-ecos-hosted-indexer.sh
```

The manifest always provides exact versions for `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` plus an explicit
`ECOS_VISUAL_PROVIDER_ENABLED=true|false` decision. When visual processing is
enabled, it also provides exact versions for the visual URL and worker token.
Do not edit these values to `latest`, another alias, zero, or a version from a
different configuration run.

The deploy script requires each selected numeric version, confirms that every
version is `ENABLED`, and completely replaces the Cloud Run secret map with
`--set-secrets NAME=secret:version`. It then reads back the job and requires the
same exact secret map and immutable image digest before continuing. Existing
image/digest validation remains mandatory, and Scheduler must remain `PAUSED`
through deployment and readback. The script builds through Google Cloud Build,
deploys the private Cloud Run Job, and creates or updates the one-minute
scheduler without resuming it. Set `ECOS_EXECUTE_AFTER_DEPLOY=true` only when
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

### Exact-target checkpoint resume

Use `npm run run:ecos-hosted-v13-resume` for a controlled evidence-1.3 shadow
job that is queued, temporarily unavailable, or checkpointed behind an expired
lease. The operator requires explicit job, document, source SHA-256, page,
container image/digest, organization configuration, slice, task, total-time,
wait, and cancellation bounds. It also requires the exact Cloud Run service
account; one-task, one-parallelism, one-retry configuration; baseline runtime
environment; immutable numeric secret versions; and operator commit, committed
tree, dirty-state fingerprint, and script SHA-256. It refuses a mutable image,
an enabled baseline, another enabled organization, a running Cloud Run
execution, a non-shadow job, or a Scheduler state other than `PAUSED`.

Generate the candidate identity only after freezing every local file that will
be present during the run:

```sh
node -e "console.log(JSON.stringify(require('./scripts/ecos-hosted-v13-resume-operator').currentOperatorIdentity(), null, 2))"
```

Copy those five values exactly into
`ECOS_V13_RESUME_REPOSITORY_COMMIT`, `ECOS_V13_RESUME_REPOSITORY_TREE`,
`ECOS_V13_RESUME_WORKTREE_DIRTY`,
`ECOS_V13_RESUME_WORKTREE_STATUS_SHA256`, and
`ECOS_V13_RESUME_OPERATOR_SHA256`. The working-tree digest covers the tracked
binary patch and every non-ignored untracked file's path, mode, size, and
bytes. Any later source change requires a new preflight and approval.

Set `ECOS_V13_RESUME_SERVICE_ACCOUNT` to the exact runtime identity. Set
`ECOS_V13_RESUME_RUNTIME_ENV_JSON` to the complete ordinary job environment
as a JSON object, including the ordinary `ECOS_MAX_JOBS_PER_RUN=8` and
`ECOS_MAX_RUN_SECONDS=3300` batch limits. Exclude the three exact-target
overrides owned by the operator (`ECOS_TARGET_JOB_ID`,
`ECOS_TARGET_SOURCE_SHA256`, and `ECOS_WORKER_ID`). The operator replaces the
two ordinary batch limits with one job and the approved slice duration on the
immutable execution, then verifies those exact overrides. Set
`ECOS_V13_RESUME_SECRET_BINDINGS_JSON` to the complete secret
environment map using immutable numeric versions, for example
`{"SUPABASE_URL":"ecos-supabase-url:3","SUPABASE_SERVICE_ROLE_KEY":"ecos-supabase-service-role-key:7"}`.
The optional visual URL and token bindings must be present together. Never use
`latest` or another moving secret alias.

First set `ECOS_V13_RESUME_PREFLIGHT_ONLY=true` and run the command. Review the
sealed `validation/output/ecos-hosted-v13-resume-<job>-<run>.json` receipt, then
unset that variable and run the same exact inputs to execute. Use
`ECOS_V13_RESUME_REFERENCE_AUTHORITY_MODE=fresh` for an untouched/reset job and
`exact` only when the reference document already carries the exact hosted
page-graph receipt for that source and page count.

Preflight is externally read-only: it makes no Supabase update, Scheduler
pause, Cloud Run execute/cancel, or other provider mutation. It does make
bounded reads and downloads the managed source into a local temporary file to
verify its bytes, then writes the local sealed receipt. A preflight failure is
also externally read-only. Confirm the receipt has `status: preflight_pass`,
`cleanup.readOnly: true`, and `cleanup.mutationStarted: false` before approving
the mutation run.

Each slice enables only the exact organization in `shadow`, sets concurrency to
one, invokes one exact job/checksum Cloud Run execution, and restores the
disabled baseline before waiting or continuing. It rechecks the non-target job
manifest, target-only execution logs and checkpoints, live evidence snapshot,
daily visual-region cap, pinned image/digest, and full job provenance after
every slice. Immediately before enabling and immediately before spawning Cloud
Run, it rechecks signals and confirms the remaining total-time budget still
covers the complete task timeout plus the entire configured cleanup budget.
That cleanup budget is explicit and additive: 120 seconds for slice
configuration restore, 120 seconds for post-run verification, 120 seconds for
completion verification, 180 seconds for final configuration/Scheduler
containment, `ECOS_V13_RESUME_CANCEL_TIMEOUT_SECONDS` for synchronous
cancellation, and 60 seconds for final verification and receipt sealing. At the
maximum 600-second cancellation bound, one mutation requires at least 1,200
cleanup seconds beyond the task timeout. Cloud reads, managed-source copying,
execution, and cancellation have bounded local timeouts; a signal terminates
active non-cleanup Cloud commands.

Execution receipts must identify the one new execution and reproduce the exact
pinned image, service account, task count, parallelism, retry limit, immutable
secret bindings, baseline environment, and exact target/run overrides. Logging
collection is bounded and fails closed if it reaches the entry limit; exactly
one `ecos_hosted_index_batch_finished` event is required. `SIGINT` and
`SIGTERM` stop the active command, confirm or restore Scheduler `PAUSED`,
synchronously cancel every new execution of the exact job, and poll until each
is terminal before sealing. A non-terminal
cancellation, cleanup failure, provenance drift, post-slice image drift, log
truncation, or duplicate/missing batch receipt makes the sealed result fail.
The receipt records every cleanup sub-deadline, total cleanup budget, elapsed
and remaining milliseconds, and whether any deadline was exhausted. A timeout
aborts bounded Supabase reads/writes or terminates the bounded Cloud command;
deadline exhaustion always seals `failed`, never `pass` or `interrupted`.
Never proceed to the next job unless the prior receipt is `pass` with an empty
cleanup error list.

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
