const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20260808102000_ecos_hosted_evidence_v13_reset.sql');
const exactPageResetMigration = read(
  'supabase/migrations/20260815093500_ecos_exact_shadow_page_reindex_reset.sql',
);
const reservationMigration = read('supabase/migrations/20260808103000_ecos_hosted_visual_reservation_version.sql');
const visualContractMigration = read('supabase/migrations/20260809014604_ecos_hosted_visual_exception_contract_v2.sql');
const version = read('workers/ecos-indexer/ecos_indexer/__init__.py');
const gateway = read('workers/ecos-indexer/ecos_indexer/gateway.py');
const worker = read('workers/ecos-indexer/ecos_indexer/worker.py');

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

expect(
  version.includes('EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"'),
  'Worker evidence version must be 1.3',
);
expect(
  migration.includes('job.mode = \'shadow\'') &&
    migration.includes('job.source_sha256 = lower(trim(p_expected_source_sha256))'),
  'Reset must remain shadow-only and exact-checksum-bound',
);

const pageDelete = migration.indexOf('delete from public.ecos_hosted_index_pages');
const chunkDelete = migration.indexOf('delete from public.ecos_hosted_shadow_chunks');
const queueDelete = migration.indexOf('delete from public.ecos_hosted_shadow_materialization_queue');
const resetJob = migration.indexOf("set state = 'queued'");
const queueLock = migration.indexOf('perform queued.page_number');
const activeLeaseGuard = migration.indexOf("raise exception 'An active worker lease is still processing this job'");
expect(queueLock > activeLeaseGuard, 'Reset must lock materialization rows after rejecting an active worker lease');
expect(
  migration.slice(queueLock, pageDelete).includes('for update'),
  'Reset must serialize with an active materializer before deleting any old evidence',
);
expect(pageDelete >= 0, 'Reset must delete all prior page checkpoints');
expect(pageDelete > queueLock, 'Reset may delete checkpoints only after materialization is serialized');
expect(chunkDelete > pageDelete, 'Reset must delete old shadow chunks after checkpoint triggers run');
expect(queueDelete > chunkDelete, 'Reset must clear page-delete queue entries after deleting chunks');
expect(resetJob > queueDelete, 'Job may be requeued only after all old evidence is removed');
for (const marker of [
  'completed_page_count = 0',
  'assured_page_count = 0',
  'unresolved_region_count = 0',
  'committed_evidence_version = null',
  "'targetEvidenceVersion', 'ecos-hosted-evidence/1.3'",
]) {
  expect(migration.includes(marker), `Reset invariant is missing: ${marker}`);
}
for (const forbidden of [
  'delete from public.reference_documents',
  'update public.reference_documents',
  'ecos_hosted_document_pages',
  'ecos_hosted_document_chunks',
  "job.mode = 'live'",
]) {
  expect(!migration.includes(forbidden), `Reset crossed a protected boundary: ${forbidden}`);
}
expect(
  migration.includes("auth.role() <> 'service_role'") &&
    migration.includes('grant execute on function public.ecos_reset_hosted_shadow_job_for_reindex') &&
    migration.includes('to service_role'),
  'Reset must remain service-role-only',
);

expect(
  exactPageResetMigration.includes("job.mode = 'shadow'") &&
    exactPageResetMigration.includes(
      'job.source_sha256 = lower(trim(p_expected_source_sha256))',
    ) &&
    exactPageResetMigration.includes('page.page_number = p_page_number'),
  'Exact-page reset must remain shadow, checksum, and page bound',
);
expect(
  exactPageResetMigration.includes('selected_job.ready_at is not null') &&
    exactPageResetMigration.includes(
      'selected_job.committed_evidence_version is not null',
    ) &&
    exactPageResetMigration.includes(
      "raise exception 'An active worker lease is still processing this job'",
    ),
  'Exact-page reset must reject committed evidence and active workers',
);
const exactPageQueueLock = exactPageResetMigration.indexOf(
  'perform queued.page_number',
);
const exactPageDelete = exactPageResetMigration.indexOf(
  'delete from public.ecos_hosted_index_pages',
);
const exactPageChunkDelete = exactPageResetMigration.indexOf(
  'delete from public.ecos_hosted_shadow_chunks',
);
const exactPageQueueDelete = exactPageResetMigration.indexOf(
  'delete from public.ecos_hosted_shadow_materialization_queue',
);
const exactPageJobReset = exactPageResetMigration.indexOf("set state = 'queued'");
expect(
  exactPageQueueLock >= 0 &&
    exactPageResetMigration.slice(exactPageQueueLock, exactPageDelete).includes('for update'),
  'Exact-page reset must serialize with its materialization row',
);
expect(
  exactPageDelete > exactPageQueueLock &&
    exactPageChunkDelete > exactPageDelete &&
    exactPageQueueDelete > exactPageChunkDelete &&
    exactPageJobReset > exactPageQueueDelete,
  'Exact-page reset deletion and requeue order is unsafe',
);
for (const marker of [
  'exception.page_number = p_page_number',
  'page.page_number = p_page_number',
  'chunk.page_number = p_page_number',
  'queued.page_number = p_page_number',
  "'resetPageNumber', p_page_number",
  "auth.role() <> 'service_role'",
  'grant execute on function public.ecos_reset_hosted_shadow_page_for_reindex',
]) {
  expect(
    exactPageResetMigration.includes(marker),
    `Exact-page reset invariant is missing: ${marker}`,
  );
}
for (const forbidden of [
  'delete from public.reference_documents',
  'ecos_hosted_document_pages',
  'ecos_hosted_document_chunks',
  "job.mode = 'live'",
]) {
  expect(
    !exactPageResetMigration.includes(forbidden),
    `Exact-page reset crossed a protected boundary: ${forbidden}`,
  );
}

expect(
  reservationMigration.includes('ecos_reserve_hosted_visual_region_versioned') &&
    reservationMigration.includes("normalized_version !~ '^ecos-hosted-evidence/[0-9]+\\.[0-9]+$'") &&
    reservationMigration.includes("'visual:' || normalized_version || ':'") &&
    reservationMigration.includes("p_claim_token::text || ':' || p_page_number::text"),
  'Visual reservations must use a validated evidence-version namespace',
);
expect(
  reservationMigration.includes("'providerAttempt', 'worker_claim'") &&
    reservationMigration.includes('where job.id = p_job_id and job.claim_token = p_claim_token'),
  'Every provider retry claim must receive its own cost reservation',
);
expect(
  reservationMigration.includes("usage.event_type = 'visual_region_reserved'") &&
    !reservationMigration.includes("usage.details->>'evidenceVersion' = normalized_version"),
  'Daily organization visual cap must continue counting every evidence version',
);
expect(
  !reservationMigration.includes('delete from public.ecos_hosted_index_usage') &&
    reservationMigration.includes("auth.role() <> 'service_role'") &&
    reservationMigration.includes('to service_role'),
  'Versioned reservation must preserve audit history and remain service-role-only',
);
expect(
  gateway.includes('ecos_reserve_hosted_visual_region_v2') &&
    gateway.includes('"p_evidence_version": evidence_version') &&
    gateway.includes('"p_exception_fingerprint": exception_fingerprint') &&
    worker.includes('evidence_version=EVIDENCE_VERSION') &&
    worker.includes('exception_fingerprint=exception_fingerprint') &&
    visualContractMigration.includes('job.lease_expires_at >= now()') &&
    visualContractMigration.includes('ecos_reserve_hosted_visual_region_versioned('),
  'Worker must bind reservations to an exact live-lease evidence contract',
);

console.log('ECOS hosted evidence 1.3 reset contract: PASS');
