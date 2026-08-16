# ECOS Hosted Indexer

This cross-platform container is the Vitruvius-operated production candidate.
Customer devices enqueue documents and read safe status; they never run this
worker or receive its credentials.

The pipeline is deterministic first:

1. verify the managed PDF against its immutable SHA-256;
2. extract native PDF text and coordinates;
3. OCR only pages that lack usable native text;
4. map sheets and inspect vectors with deterministic rules;
5. send only unresolved bounded regions to the internal visual exception API;
6. require ECOS Assurance to accept every page; and
7. publish only when the organization is explicitly switched from `shadow` to
   `live` after acceptance.

Required worker secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional Vitruvius-owned visual service configuration:

- `ECOS_VISUAL_PROVIDER_URL`
- `ECOS_VISUAL_PROVIDER_TOKEN` (the protected runtime binding for the
  Vitruvius-owned `ECOS_SERVICE_WORKER_TOKEN`; never customer supplied)

Optional resource limit:

- `ECOS_MAX_SOURCE_BYTES` (defaults to 250 MB)
- `ECOS_MAX_SOURCE_PAGES` (defaults to 500 pages)
- `ECOS_MAX_OCR_TILES_PER_PAGE` (defaults to 128 tiles)
- `ECOS_PAGE_TIMEOUT_SECONDS` (defaults to 600 seconds)
- `ECOS_MALWARE_SCAN_TIMEOUT_SECONDS` (defaults to 300 seconds)
- `ECOS_VISUAL_ESTIMATED_COST_MICROUSD` (defaults to 500 micro-USD)

The production image contains ClamAV and defaults to
`ECOS_REQUIRE_MALWARE_SCAN=true`. A positive malware result or invalid source
rejects the source. A missing, failed, or timed-out scanner remains fail closed
and retries within the bounded job policy; the PDF parser runs only after a
clean scan.

## Selected managed runtime

- Host: Google Cloud Run Job owned by Vitruvius
- Region: `us-west1`, adjacent to the linked Supabase `us-west-1` project
- Schedule: Cloud Scheduler requests one batch execution every minute
- Initial task capacity: one task, 2 vCPU, 4 GiB, maximum eight documents or
  55 minutes per execution
- Secret custody: Google Secret Manager; no secret is built into the image
- Publication: shadow only until the complete acceptance gate passes

These values belong in the hosted service secret manager, never in Expo public
environment variables or a customer-facing screen.
