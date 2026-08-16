# ECOS Shadow Acceptance and Publication Operators

Status: operator contract implemented; no live execution is authorized by this document.

These operators close the evidence gap between exact hosted evidence 1.3 job
readiness and deliberate customer publication. They do not replace the live
2375 and 2321 acceptance gates that must run after promotion.

## Safety boundary

Freeze and commit the candidate before using either operator. Both entrypoints
refuse a dirty working tree. Keep Cloud Scheduler `PAUSED`, keep every Cloud Run
execution terminal, and never place a service-role key, access token, or worker
token in a command history or evidence file.

The local receipts use stable-JSON SHA-256 seals and mode `0600`. Before an
approval, also record the SHA-256 of the complete receipt file. A receipt seal
detects changes to its JSON contents; the separately approved file checksum
binds the exact reviewed bytes.

No package command is required. Invoke the checked-in scripts directly.

## Three consecutive protected-shadow cycles

`scripts/ecos-ask-shadow-three-cycle-operator.js` runs or consumes exactly
three ordered pairs of results:

- 2375: exact project `72e941d8-8114-4082-a976-ae5b2b5daba9`, 15/15;
- 2321: exact project `607c7eed-5dea-4a5a-8b52-0f165c71c4b5`, 19/19; and
- production host `xdytqlpsqsseoeuxgzre.supabase.co` in protected `shadow`
  mode.

Every pair is archived rather than overwritten. After each pair, the operator
re-reads the exact current reference documents, one authoritative ready shadow
job per document, and every assured page. The source checksums, revisions,
page counts, verified page-graph receipts, job identities, evidence version,
and page receipts must remain identical through all three cycles. Runs may not
overlap or appear out of order.

### Run the suites

Load the normal short-lived owner token and the independent worker token, along
with the service-role values needed only for read-only identity sealing:

```sh
ECOS_SHADOW_LEDGER_MODE=run \
ECOS_SHADOW_LEDGER_EXPECTED_URL='https://xdytqlpsqsseoeuxgzre.supabase.co' \
ECOS_SHADOW_LEDGER_ORGANIZATION_ID='exact-organization-id' \
ECOS_SHADOW_LEDGER_EXPECTED_JOB_COUNT=23 \
SUPABASE_URL='https://xdytqlpsqsseoeuxgzre.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='protected-service-role-key' \
EXPO_PUBLIC_SUPABASE_URL='https://xdytqlpsqsseoeuxgzre.supabase.co' \
EXPO_PUBLIC_SUPABASE_ANON_KEY='production-anon-key' \
ECOS_LIVE_ACCESS_TOKEN='short-lived-owner-token' \
ECOS_SERVICE_WORKER_TOKEN='protected-worker-token' \
node scripts/ecos-ask-shadow-three-cycle-operator.js
```

The operator writes one new
`validation/output/ecos-ask-shadow-three-cycle-<run>/` directory. Do not reuse
an existing directory.

### Consume six existing results

The alternative consume mode requires an exact JSON array of three ordered
objects. Each object must have only the keys `2375` and `2321`; every path must
name a regular non-symlink file inside this repository.

```sh
ECOS_SHADOW_LEDGER_MODE=consume \
ECOS_SHADOW_LEDGER_RECEIPTS_JSON='[
  {"2375":"validation/input/cycle-1-2375.json","2321":"validation/input/cycle-1-2321.json"},
  {"2375":"validation/input/cycle-2-2375.json","2321":"validation/input/cycle-2-2321.json"},
  {"2375":"validation/input/cycle-3-2375.json","2321":"validation/input/cycle-3-2321.json"}
]' \
ECOS_SHADOW_LEDGER_EXPECTED_URL='https://xdytqlpsqsseoeuxgzre.supabase.co' \
ECOS_SHADOW_LEDGER_ORGANIZATION_ID='exact-organization-id' \
ECOS_SHADOW_LEDGER_EXPECTED_JOB_COUNT=23 \
SUPABASE_URL='https://xdytqlpsqsseoeuxgzre.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='protected-service-role-key' \
node scripts/ecos-ask-shadow-three-cycle-operator.js
```

Only a sealed ledger with `status: "pass"`, exactly three chained cycles, and
all six archived receipts is eligible for publication review.

## Read-only publication preflight

`scripts/ecos-hosted-publication-operator.js` changes only one exact row in
`ecos_hosted_index_configuration`. Its preflight performs bounded reads of:

- the approved three-cycle ledger and all six archived receipts;
- current acceptance contract hashes;
- the exact target configuration and a seal of every non-target configuration;
- the complete target-organization job manifest;
- the exact current documents, shadow jobs, and assured pages; and
- Cloud Scheduler and Cloud Run execution state.

The target must begin `shadow` and disabled. The scheduler must be `PAUSED`, all
Cloud Run executions must be terminal, and no database job may be actively
processing or retain a claim. Preflight writes a local receipt but performs no
Supabase, Scheduler, or Cloud Run mutation.

Set the common protected environment, the exact ledger path, and the checksum
of the complete ledger file. Set `ECOS_PUBLICATION_UPDATED_BY` to the canonical
operator user UUID recorded on the configuration transition.

```sh
ECOS_PUBLICATION_ACTION=promote \
ECOS_PUBLICATION_ALLOW_MUTATION=single-organization-shadow-to-live \
ECOS_PUBLICATION_PREFLIGHT_ONLY=true \
ECOS_PUBLICATION_EXPECTED_URL='https://xdytqlpsqsseoeuxgzre.supabase.co' \
ECOS_PUBLICATION_ORGANIZATION_ID='exact-organization-id' \
ECOS_PUBLICATION_UPDATED_BY='operator-user-uuid' \
ECOS_PUBLICATION_EXPECTED_JOB_COUNT=23 \
ECOS_PUBLICATION_LEDGER_PATH='validation/output/ecos-ask-shadow-three-cycle-<run>/ledger.json' \
ECOS_PUBLICATION_LEDGER_SHA256='<sha256-of-complete-ledger-file>' \
ECOS_GCP_PROJECT='exact-gcp-project' \
ECOS_GCP_REGION='us-west1' \
ECOS_GCP_JOB='exact-cloud-run-job' \
ECOS_GCP_SCHEDULER='exact-paused-scheduler' \
SUPABASE_URL='https://xdytqlpsqsseoeuxgzre.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='protected-service-role-key' \
node scripts/ecos-hosted-publication-operator.js
```

Review a sealed `preflight_pass` receipt with
`cleanup.readOnly: true` and `mutationStarted: false`. A failed preflight is
also read-only.

## Deliberate promotion

After approval, rerun the exact same frozen inputs without
`ECOS_PUBLICATION_PREFLIGHT_ONLY`. The operator performs a compare-and-set from
the complete reviewed target configuration to `publication_mode: "live"` and
`enabled: true`. Concurrency and visual-cost controls are preserved. It then
rechecks the scheduler, execution inventory, every non-target configuration,
the complete job manifest, and the current job/document/page identity.

If a post-update check, interrupt, or ambiguous response fails, the operator
attempts an exact compare-and-set rollback of only that organization to
`shadow` and disabled before sealing the failed receipt. Never treat a failed
receipt as publication, even when automatic rollback succeeded.

After a passed promotion, run the normal authenticated live 2375 and 2321
acceptance suites and their release evidence gates. Promotion alone is not live
acceptance.

## Separately callable rollback

Rollback requires both the original three-cycle ledger and the exact passed
promotion receipt. Record the SHA-256 of each complete file, then first run a
read-only rollback preflight:

```sh
ECOS_PUBLICATION_ACTION=rollback \
ECOS_PUBLICATION_ALLOW_MUTATION=single-organization-live-to-shadow \
ECOS_PUBLICATION_PREFLIGHT_ONLY=true \
ECOS_PUBLICATION_EXPECTED_URL='https://xdytqlpsqsseoeuxgzre.supabase.co' \
ECOS_PUBLICATION_ORGANIZATION_ID='exact-organization-id' \
ECOS_PUBLICATION_UPDATED_BY='operator-user-uuid' \
ECOS_PUBLICATION_EXPECTED_JOB_COUNT=23 \
ECOS_PUBLICATION_LEDGER_PATH='validation/output/ecos-ask-shadow-three-cycle-<run>/ledger.json' \
ECOS_PUBLICATION_LEDGER_SHA256='<sha256-of-complete-ledger-file>' \
ECOS_PUBLICATION_PROMOTION_RECEIPT_PATH='validation/output/ecos-hosted-publication-promote-<id>-<run>.json' \
ECOS_PUBLICATION_PROMOTION_RECEIPT_SHA256='<sha256-of-complete-promotion-file>' \
ECOS_GCP_PROJECT='exact-gcp-project' \
ECOS_GCP_REGION='us-west1' \
ECOS_GCP_JOB='exact-cloud-run-job' \
ECOS_GCP_SCHEDULER='exact-paused-scheduler' \
SUPABASE_URL='https://xdytqlpsqsseoeuxgzre.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='protected-service-role-key' \
node scripts/ecos-hosted-publication-operator.js
```

The current live configuration must exactly equal the approved promotion
receipt. After reviewing the rollback preflight, rerun without the preflight
flag. A passed rollback receipt proves only that the one target organization
returned to `shadow` and disabled while all other sealed boundaries remained
unchanged.

## Focused offline contracts

These tests use only local fixtures and do not contact Supabase or Google
Cloud:

```sh
node scripts/ecos-ask-shadow-three-cycle-operator-test.js
node scripts/ecos-hosted-publication-operator-test.js
```
