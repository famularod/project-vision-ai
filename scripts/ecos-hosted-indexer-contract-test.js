const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const requireText = (source, expected, label) => {
  if (!source.includes(expected)) throw new Error(`${label}: missing ${expected}`);
};
const forbidText = (source, forbidden, label) => {
  if (source.includes(forbidden)) throw new Error(`${label}: forbidden ${forbidden}`);
};

const migration = read('supabase/migrations/20260808010000_ecos_hosted_indexer.sql');
const operationsMigration = read('supabase/migrations/20260808020000_ecos_hosted_indexer_operations.sql');
const recoveryMigration = read('supabase/migrations/20260808040000_ecos_hosted_indexer_recovery.sql');
const operatorReindexMigration = read('supabase/migrations/20260808080000_ecos_hosted_indexer_operator_reindex.sql');
const staleLeaseRecoveryMigration = read('supabase/migrations/20260808050000_ecos_hosted_indexer_stale_lease_recovery.sql');
const boundedConcurrencyMigration = read('supabase/migrations/20260808060000_ecos_hosted_indexer_bounded_concurrency.sql');
const shadowValidationMigration = read('supabase/migrations/20260808070000_ecos_hosted_shadow_validation.sql');
const shadowSearchMigration = read('supabase/migrations/20260808090000_ecos_hosted_shadow_search_index.sql');
const shadowPageTextMigration = read('supabase/migrations/20260808091000_ecos_hosted_shadow_page_text_index.sql');
const shadowRegionTextMigration = read('supabase/migrations/20260808092000_ecos_hosted_shadow_region_text_index.sql');
const noncurrentPreparationMigration = read(
  'supabase/migrations/20260809065350_ecos_noncurrent_shadow_preparation.sql',
);
const sheetProvenanceMigration = read(
  'supabase/migrations/20260809070356_ecos_sheet_provenance_round_trip.sql',
);
const structuredTableSearchMigration = read(
  'supabase/migrations/20260809120133_ecos_structured_table_search_provenance.sql',
);
const worker = read('workers/ecos-indexer/ecos_indexer/worker.py');
const extraction = read('workers/ecos-indexer/ecos_indexer/extraction.py');
const security = read('workers/ecos-indexer/ecos_indexer/security.py');
const visual = read('workers/ecos-indexer/ecos_indexer/visual.py');
const drawingAnalysis = read('supabase/functions/ecos-analyze-drawing-page/index.ts');
const client = read('services/ECOSHostedIndexer.ts');
const cloudIndex = read('services/ECOSDocumentCloudIndex.ts');
const ask = read('supabase/functions/ecos-ask-project/index.ts');
const currentHostedPageContext = read('supabase/functions/_shared/ecos-current-hosted-page-context.ts');
const driveGateway = read('services/DAVEWebSupabaseClient.ts');
const desktopDocumentWorkspace = read('components/web-shell/desktop-read-only-shell.tsx');
const deployScript = read('scripts/deploy-ecos-hosted-indexer.sh');
const secretScript = read('scripts/configure-ecos-hosted-indexer-secrets.sh');
const canaryOperator = read('scripts/ecos-hosted-v13-single-canary.js');
const customerCopy = [
  read('App.tsx'),
  read('components/web-shell/desktop-read-only-shell.tsx'),
  client,
].join('\n');

for (const table of [
  'ecos_hosted_index_jobs',
  'ecos_hosted_index_pages',
  'ecos_hosted_visual_exceptions',
  'ecos_hosted_document_pages',
  'ecos_hosted_document_chunks',
]) requireText(migration, `public.${table}`, 'hosted migration');

requireText(migration, "publication_mode text not null default 'shadow'", 'shadow deployment default');
requireText(migration, 'pie_layer4_has_active_membership', 'tenant membership enforcement');
requireText(migration, 'ecos_reference_document_hosted_enqueue', 'database-side automatic enqueue');
requireText(migration, 'ecos_reference_document_hosted_cleanup', 'derived evidence deletion cleanup');
requireText(migration, 'to service_role', 'protected worker grants');
requireText(migration, 'revoke all on function public.ecos_claim_hosted_index_job', 'worker claim isolation');
requireText(migration, 'revoke all on function public.ecos_commit_hosted_index_job', 'verified commit isolation');
requireText(migration, "page.assurance_result->>'accepted' = 'true'", 'Assurance fail-closed commit');
requireText(migration, 'The source document changed before the verified commit', 'current source verification');
requireText(migration, 'Only the current non-superseded document may publish evidence', 'current revision verification');
requireText(migration, 'ecos_search_hosted_document_chunks', 'hosted evidence search');

requireText(operationsMigration, 'ecos_record_hosted_source_scan', 'protected source scan audit');
requireText(operationsMigration, 'ecos_require_clean_source_scan', 'fail-closed source gate');
requireText(operationsMigration, 'ecos_extend_hosted_index_lease', 'long page lease renewal');
requireText(operationsMigration, 'ecos_reserve_hosted_visual_region', 'bounded visual budget');
requireText(operationsMigration, 'daily_visual_region_limit', 'organization visual cost limit');
requireText(operationsMigration, 'operations_retention_days', 'operations retention policy');
requireText(operationsMigration, 'ecos_cleanup_hosted_index_operations', 'operations cleanup');
requireText(operationsMigration, 'ecos_hosted_index_operations_health', 'protected health telemetry');
requireText(operationsMigration, 'to service_role', 'operations service-only execution');
requireText(recoveryMigration, 'ecos_requeue_hosted_index_job', 'checkpoint-preserving operator recovery');
requireText(operatorReindexMigration, 'ecos_reset_hosted_shadow_job_for_reindex', 'checksum-bound shadow reindex reset');
requireText(operatorReindexMigration, "auth.role() <> 'service_role'", 'service-only shadow reindex reset');
requireText(operatorReindexMigration, "job.mode = 'shadow'", 'shadow-only reindex reset');
requireText(recoveryMigration, 'failure_category = null', 'stale failure state reset');
requireText(recoveryMigration, "job.mode = 'shadow'", 'recovery remains shadow-only');
requireText(recoveryMigration, 'to service_role', 'recovery service-only execution');
requireText(staleLeaseRecoveryMigration, "interval '5 minutes'", 'bounded stale lease recovery');
requireText(staleLeaseRecoveryMigration, 'coalesce(job.heartbeat_at, job.updated_at)', 'stale worker heartbeat guard');
requireText(staleLeaseRecoveryMigration, 'to service_role', 'stale recovery service-only execution');
requireText(boundedConcurrencyMigration, 'max_concurrent_jobs', 'organization bounded concurrency');
requireText(boundedConcurrencyMigration, 'between 1 and 8', 'bounded concurrency constraint');
requireText(boundedConcurrencyMigration, "active_job.organization_id = job.organization_id", 'organization-scoped active job count');
requireText(boundedConcurrencyMigration, 'pg_advisory_xact_lock', 'atomic bounded claim selection');
requireText(boundedConcurrencyMigration, 'for update of job skip locked', 'concurrent claim row isolation');
requireText(boundedConcurrencyMigration, 'to service_role', 'bounded claim service-only execution');
requireText(shadowValidationMigration, 'ecos_search_hosted_shadow_chunks', 'shadow validation search boundary');
requireText(shadowValidationMigration, "job.mode = 'shadow'", 'shadow validation cannot read live jobs');
requireText(shadowValidationMigration, "job.state = 'ready'", 'shadow validation reads completed jobs only');
requireText(shadowValidationMigration, "page.assurance_result->>'accepted' = 'true'", 'shadow validation Assurance gate');
requireText(shadowValidationMigration, 'page.unresolved_region_count = 0', 'shadow validation unresolved evidence gate');
requireText(shadowValidationMigration, 'to service_role', 'shadow validation service-only execution');
requireText(shadowSearchMigration, 'public.ecos_hosted_shadow_chunks', 'materialized shadow retrieval index');
requireText(shadowSearchMigration, 'search_vector tsvector generated always as', 'indexed shadow lexical search');
requireText(shadowSearchMigration, 'ecos_refresh_hosted_shadow_page', 'bounded page shadow refresh');
requireText(shadowSearchMigration, 'ecos_hosted_shadow_page_upsert_sync', 'page checkpoint shadow refresh trigger');
requireText(shadowSearchMigration, 'ecos_hosted_shadow_page_delete_sync', 'deleted page shadow cleanup trigger');
forbidText(
  shadowSearchMigration,
  "select public.ecos_refresh_hosted_shadow_chunks(job.id)\nfrom public.ecos_hosted_index_jobs job",
  'migration must not perform an unbounded all-job shadow backfill',
);
requireText(shadowSearchMigration, "page.assurance_result->>'accepted' = 'true'", 'materialized shadow Assurance gate');
requireText(shadowSearchMigration, 'page.unresolved_region_count = 0', 'materialized shadow unresolved evidence gate');
requireText(shadowSearchMigration, 'revoke all on table public.ecos_hosted_shadow_chunks', 'shadow search table isolation');
requireText(shadowSearchMigration, 'to service_role', 'materialized shadow search service-only execution');
requireText(shadowPageTextMigration, 'generate_series(', 'bounded overlapping page-text chunks');
requireText(shadowPageTextMigration, "'materialization', 'overlapping_page_text'", 'complete page-text materialization');
requireText(shadowPageTextMigration, "'materialization', 'structured_visual_fact'", 'coordinate visual-fact materialization');
requireText(shadowPageTextMigration, "page.assurance_result->>'accepted' = 'true'", 'page-text Assurance gate');
requireText(shadowPageTextMigration, 'page.unresolved_region_count = 0', 'page-text unresolved evidence gate');
requireText(shadowPageTextMigration, 'to service_role', 'page-text refresh service-only execution');
requireText(shadowRegionTextMigration, 'ecos_append_hosted_shadow_region_text', 'bounded assured-region text append');
requireText(shadowRegionTextMigration, "'materialization', 'overlapping_assured_region_text'", 'complete OCR and visual region search text');
requireText(shadowRegionTextMigration, "page.assurance_result->>'accepted' = 'true'", 'region-text Assurance gate');
requireText(shadowRegionTextMigration, 'page.unresolved_region_count = 0', 'region-text unresolved evidence gate');
requireText(shadowRegionTextMigration, 'ecos_sync_hosted_shadow_page_chunks', 'automatic page checkpoint region-text refresh');
requireText(shadowRegionTextMigration, 'to service_role', 'region-text refresh service-only execution');

requireText(
  noncurrentPreparationMigration,
  "when source_data->>'isCurrent' = 'true' then configured_mode\n    else 'shadow'",
  'non-current upload must use private shadow preparation',
);
requireText(
  noncurrentPreparationMigration,
  "source_data->>'drawingStatus' = 'Superseded'",
  'superseded preparation rejection',
);
requireText(
  noncurrentPreparationMigration,
  'public.ecos_hosted_job_matches_reference(job.id, true)',
  'exact current source guard',
);
requireText(
  noncurrentPreparationMigration,
  "job.source_revision is not distinct from selected_revision",
  'exact revision guard',
);
requireText(
  noncurrentPreparationMigration,
  'job.project_id = selected_project',
  'exact project guard',
);
requireText(
  noncurrentPreparationMigration,
  "then 'Prepared'",
  'prepared non-current customer status',
);
requireText(
  noncurrentPreparationMigration,
  'ecos_commit_hosted_shadow_preparation_job',
  'private preparation commit boundary',
);
requireText(
  noncurrentPreparationMigration,
  "configuration.publication_mode = 'live'",
  'explicit live activation gate',
);
requireText(
  noncurrentPreparationMigration,
  'revoke all on function public.ecos_search_hosted_shadow_chunks',
  'shadow retrieval isolation',
);
requireText(
  noncurrentPreparationMigration,
  'ecos_activate_current_reference_document',
  'atomic current revision activation',
);
requireText(
  noncurrentPreparationMigration,
  "raise exception 'ecos_target_not_prepared'",
  'activation must fail closed before exact drawing preparation',
);
requireText(
  noncurrentPreparationMigration,
  'p_expected_updated_at timestamptz',
  'activation optimistic concurrency guard',
);
requireText(
  noncurrentPreparationMigration,
  'pg_advisory_xact_lock(hashtextextended(current_user::text, 0))',
  'concurrent current-revision activation serialization',
);
requireText(
  noncurrentPreparationMigration,
  'ecos_reference_document_atomic_current_guard',
  'direct current-flag writes must be rejected',
);
requireText(
  noncurrentPreparationMigration,
  "current_setting('app.ecos_current_activation', true)",
  'atomic activation transaction marker',
);
requireText(
  noncurrentPreparationMigration,
  "raise exception 'ecos_atomic_current_activation_required'",
  'legacy full-record current mutation rejection',
);
requireText(
  noncurrentPreparationMigration,
  'public.ecos_reference_document_family(',
  'server-owned revision family guard',
);
requireText(
  noncurrentPreparationMigration,
  'public.ecos_reference_document_project_scope(',
  'current revision project-scope identity guard',
);
requireText(
  noncurrentPreparationMigration,
  'current_family_identity_changed',
  'current revision family edits require atomic activation',
);
requireText(
  noncurrentPreparationMigration,
  'drawing_activation_involved',
  'drawing-only direct activation guard preserves schedule imports',
);
requireText(
  noncurrentPreparationMigration,
  "job.committed_evidence_version = 'ecos-hosted-evidence/1.3'",
  'activation requires committed Assurance evidence',
);
requireText(
  desktopDocumentWorkspace,
  "replacement?.webVersionGroupId || replacement?.drawingNumber?.trim() || replacement?.id || null",
  'replacement drawings retain the canonical revision family',
);
requireText(
  noncurrentPreparationMigration,
  'revoke select on table public.ecos_hosted_document_pages from authenticated',
  'direct stale hosted page reads are closed',
);
requireText(
  noncurrentPreparationMigration,
  'revoke select on table public.ecos_hosted_document_chunks from authenticated',
  'direct stale hosted chunk reads are closed',
);
requireText(
  noncurrentPreparationMigration,
  'to service_role',
  'new privileged boundaries remain service-only',
);
requireText(
  sheetProvenanceMigration,
  'ecos_load_current_hosted_page_context',
  'bounded authenticated hosted page-context boundary',
);
requireText(
  sheetProvenanceMigration,
  "job.committed_evidence_version = 'ecos-hosted-evidence/1.3'",
  'hosted page context exact evidence version',
);
requireText(
  sheetProvenanceMigration,
  "source.document_data->>'isCurrent' = 'true'",
  'hosted page context current revision guard',
);
requireText(
  sheetProvenanceMigration,
  'public.ecos_hosted_job_matches_reference(job.id, true)',
  'hosted page context exact source guard',
);

for (const materialization of [
  'overlapping_page_text',
  'overlapping_assured_region_text',
  'structured_visual_fact',
  'hosted_region',
  'hosted_page_fallback',
]) requireText(
  structuredTableSearchMigration,
  `'${materialization}'`,
  'structured-table materialization contract',
);
requireText(
  structuredTableSearchMigration,
  "region.value->'searchable' = 'true'::jsonb",
  'raw structured-table constituents excluded at source',
);
requireText(
  structuredTableSearchMigration,
  'ecos_hosted_chunk_structured_table_search_gate',
  'live hosted chunk fail-closed trigger',
);
requireText(
  structuredTableSearchMigration,
  'ecos_shadow_chunk_structured_table_search_gate',
  'shadow hosted chunk fail-closed trigger',
);
requireText(
  structuredTableSearchMigration,
  "nullif(trim(page.final_page_data->>'text'), '') as search_text",
  'page chunks derive only from worker-filtered page text',
);
requireText(
  structuredTableSearchMigration,
  "'constituentEvidence', region.value->'constituentEvidence'",
  'complete structured relationship constituent provenance',
);
requireText(
  structuredTableSearchMigration,
  "'structuredRelationshipId', region.value->'structuredRelationshipId'",
  'complete structured relationship identity provenance',
);

const sqlFunctionBody = name => {
  const marker = `create or replace function public.${name}`;
  const start = structuredTableSearchMigration.lastIndexOf(marker);
  if (start < 0) throw new Error(`structured-table function missing: ${name}`);
  const bodyStart = structuredTableSearchMigration.indexOf('as $$', start);
  const bodyEnd = structuredTableSearchMigration.indexOf('$$;', bodyStart + 5);
  if (bodyStart < 0 || bodyEnd < 0) throw new Error(`structured-table function body malformed: ${name}`);
  return structuredTableSearchMigration.slice(bodyStart + 5, bodyEnd);
};
for (const gateName of [
  'ecos_gate_structured_table_shadow_search',
  'ecos_gate_structured_table_hosted_search',
]) {
  const body = sqlFunctionBody(gateName);
  forbidText(body, 'jsonb_array_elements', `${gateName} must remain O(1) in page region count`);
  forbidText(body, 'string_agg', `${gateName} must not rebuild all page regions per chunk`);
}

const adversarialRegions = [
  { id: 'complete-f1', searchable: true, source: 'deterministic_structured_table_relationship' },
  { id: 'raw-f1', searchable: false, source: 'fixed_visual_tile_coordinate_ocr' },
  { id: 'raw-incomplete-f2', searchable: false, source: 'fixed_visual_tile_coordinate_ocr' },
  { id: 'raw-missing-marker', source: 'fixed_visual_tile_coordinate_ocr' },
  { id: 'raw-null-marker', searchable: null, source: 'fixed_visual_tile_coordinate_ocr' },
  { id: 'raw-string-marker', searchable: 'true', source: 'fixed_visual_tile_coordinate_ocr' },
  { id: 'raw-object-marker', searchable: { value: true }, source: 'fixed_visual_tile_coordinate_ocr' },
];
const sourceMaterializedIds = adversarialRegions
  .filter(region => region.searchable === true)
  .map(region => region.id);
if (JSON.stringify(sourceMaterializedIds) !== JSON.stringify(['complete-f1'])) {
  throw new Error('structured-table adversarial source materialization leaked a raw sibling');
}
for (const required of [
  "region.value->'searchable' = 'true'::jsonb",
  "'structuredSearchContract', 'complete-relationship-only-v1'",
  "new.metadata->'searchable' is distinct from 'true'::jsonb",
]) {
  requireText(
    structuredTableSearchMigration,
    required,
    `structured-table explicit search contract: ${required}`,
  );
}
forbidText(
  structuredTableSearchMigration,
  "coalesce(region.value->'searchable', 'true'::jsonb)",
  'missing region search marker must never default to true',
);
forbidText(
  structuredTableSearchMigration,
  "region.value->'searchable' is distinct from 'false'::jsonb",
  'source materialization must require exact true rather than non-false',
);
requireText(
  ask,
  'return !isECOSDrawingCategory(category);',
  'legacy drawing chunks excluded from Ask fallback',
);

requireText(worker, 'hashlib.sha256', 'immutable source verification');
requireText(worker, 'completed_pages', 'page checkpoint resume');
requireText(worker, 'page_processing_deadline', 'bounded page execution');
requireText(worker, 'extend_lease', 'lease heartbeat');
requireText(read('workers/ecos-indexer/ecos_indexer/gateway.py'), 'ECOS_MAX_SOURCE_BYTES', 'bounded source download');
requireText(security, 'clamscan', 'malware scanning');
requireText(security, 'malware_scanner_unavailable', 'production scanner fail closed');
requireText(worker, 'assure_page', 'independent Assurance gate');
requireText(worker, 'ecos_commit_hosted_index_job', 'verified publication');
requireText(worker, 'ecos_commit_hosted_shadow_preparation_job', 'verified private preparation');
requireText(worker, 'ecos_hosted_index_job_started', 'structured job start telemetry');
requireText(worker, 'ecos_hosted_index_page_assured', 'structured page telemetry');
requireText(worker, 'ecos_hosted_index_job_failed', 'structured failure telemetry');
requireText(extraction, 'native_text_regions', 'native PDF extraction first');
requireText(extraction, 'ocr_text_regions', 'coordinate OCR fallback');
requireText(extraction, 'significant_raster_region', 'mixed PDF OCR coverage');
requireText(extraction, 'deterministic_geometry', 'deterministic geometry');
requireText(extraction, 'map_sheet', 'deterministic sheet mapping');
requireText(visual, 'ECOS_VISUAL_PROVIDER_URL', 'bounded internal visual provider');
requireText(visual, 'crop_page', 'bounded visual crop');
requireText(visual, 'visual_tile_bounds', 'high-resolution bounded visual tiling');
requireText(visual, 'ecos-drawing-page-analysis/2.0', 'Assurance-backed visual provider contract');
requireText(drawingAnalysis, 'protectedServiceTokenMatches', 'service worker authorization');
requireText(drawingAnalysis, "Deno.env.get('ECOS_SERVICE_WORKER_TOKEN')", 'dedicated service worker authorization secret');
forbidText(
  drawingAnalysis.slice(drawingAnalysis.indexOf('function protectedServiceTokenMatches'), drawingAnalysis.indexOf('function responseSchema')),
  'SUPABASE_SERVICE_ROLE_KEY',
  'service worker authorization must not depend on the Edge runtime service key',
);

requireText(client, 'ecos_enqueue_hosted_index', 'client enqueue boundary');
requireText(client, 'ecos_hosted_index_status', 'customer-safe status boundary');
requireText(client, 'ecos_activate_current_reference_document', 'atomic activation client boundary');
requireText(cloudIndex, 'ecos_search_hosted_document_chunks', 'hosted evidence preferred');
requireText(ask, 'ecos_search_hosted_document_chunks', 'Ask ECOS hosted evidence');
requireText(ask, 'loadECOSCurrentHostedPageContext', 'Ask ECOS bounded hosted page context');
requireText(
  currentHostedPageContext,
  "client.rpc('ecos_load_current_hosted_page_context'",
  'authenticated hosted page-context RPC use',
);
forbidText(ask, "from('ecos_hosted_document_pages')", 'authenticated raw hosted-page read');
forbidText(currentHostedPageContext, "error.code === '42501'", 'permission-error fallback');
requireText(ask, 'legacyDocumentEvidenceIsEligible', 'legacy fallback exact-evidence guard');
requireText(ask, '.filter((document) => document.legacyEligible)', 'legacy fallback eligible-document filter');
requireText(ask, "hostedAssurance.accepted !== true", 'Ask ECOS Assurance enforcement');
requireText(driveGateway, "storage.from('project-documents')", 'managed Drive processing copy');
requireText(driveGateway, 'enqueueECOSHostedIndex', 'automatic indexing after document save');
requireText(deployScript, 'ecos-service-worker-token:latest', 'dedicated hosted worker token binding');
requireText(secretScript, 'ECOS_SERVICE_WORKER_TOKEN', 'dedicated hosted worker token configuration');
requireText(secretScript, 'npx supabase secrets set', 'Edge worker token synchronization');

forbidText(canaryOperator, 'HOLD_DURATION_MS', 'legacy canary hold duration');
forbidText(canaryOperator, 'holdAttempted', 'legacy ambiguous hold cleanup');
forbidText(canaryOperator, 'restoreOtherJobs', 'legacy non-target restoration');
forbidText(canaryOperator, '.update({ next_attempt_at:', 'legacy non-target due-time mutation');
requireText(
  canaryOperator,
  "configurations.every(row => row.organization_id === organizationId || row.enabled === false)",
  'global enabled-configuration isolation',
);
requireText(canaryOperator, "assert(jobManifest.every(row => row.mode === 'shadow')", 'all-mode canary manifest guard');
forbidText(canaryOperator, 'jobManifest.every(isResetClean)', 'non-target reset-state assumption');
requireText(canaryOperator, 'assert(isResetClean(target)', 'target-only reset-state guard');
requireText(
  canaryOperator,
  ".from('ecos_hosted_index_jobs')\n    .select('*')\n    .eq('organization_id', organizationId)",
  'complete non-target row snapshot',
);
requireText(canaryOperator, 'isExactTargetClaimEligible(claimTarget, enabledConfig, claimManifest, Date.now())', 'exact-target claim precondition');
requireText(canaryOperator, "required('ECOS_V13_CANARY_EXPECTED_PAGE_COUNT')", 'required canary page count');
requireText(canaryOperator, 'Array.from({ length: expectedPageCount }', 'parameterized canary page identities');
requireText(canaryOperator, "required('ECOS_V13_CANARY_VISUAL_LIMIT')", 'required canary visual cap');
requireText(
  canaryOperator,
  'canaryVisualLimit <= Number(baselineConfig.daily_visual_region_limit)',
  'canary visual cap baseline bound',
);
requireText(canaryOperator, 'daily_visual_region_limit: canaryVisualLimit', 'bounded canary visual cap application');
forbidText(canaryOperator, 'daily_visual_region_limit: 0', 'zero-visual canary assumption');
requireText(canaryOperator, '`ECOS_TARGET_JOB_ID=${targetJobId}`', 'exact target job execution override');
requireText(canaryOperator, '`ECOS_TARGET_SOURCE_SHA256=${targetSourceSha}`', 'exact target source execution override');
requireText(canaryOperator, "value.name === 'ECOS_TARGET_JOB_ID'", 'described exact target job verification');
requireText(canaryOperator, "value.name === 'ECOS_TARGET_SOURCE_SHA256'", 'described exact target source verification');
requireText(canaryOperator, 'audit.cleanup.disabled = await disableConfiguration()', 'unconditional emergency disable');
requireText(canaryOperator, "restorationSkipped = 'Configuration disable could not be confirmed", 'fail-closed restoration order');
requireText(canaryOperator, "baselineJobManifest,\n        'Cleanup'", 'failure-path non-target immutability');
requireText(canaryOperator, 'assertSuccessfulExecution(describeExecution(executionName))', 'described execution success gate');
requireText(canaryOperator, 'readExecutionLogs(executionName)', 'execution-scoped one-job telemetry gate');
requireText(canaryOperator, "condition.type === 'Completed'", 'terminal execution condition recognition');
requireText(canaryOperator, '!executionIsTerminal(execution)', 'active execution filter');
requireText(canaryOperator, 'liveSnapshotAfter.sha256 === audit.preflight.liveSnapshotBefore.sha256', 'live evidence immutability hash');
requireText(canaryOperator, 'currentSha256 === baselineSha256', 'non-target manifest immutability');

for (const secret of ['SUPABASE_SERVICE_ROLE_KEY', 'ECOS_VISUAL_PROVIDER_TOKEN', 'ECOS_SERVICE_WORKER_TOKEN']) {
  forbidText(customerCopy, secret, 'customer application boundary');
}

console.log('ECOS hosted indexer contract: PASS');
