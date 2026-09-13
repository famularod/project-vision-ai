#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const protocol = read('services/ECOSQuestionProtocol.ts');
const client = read('services/ECOSProjectQuestion.ts');
const app = read('App.tsx');
const bottomTabs = read('components/app-bottom-tabs.tsx');
const navigationRail = read('components/app-navigation-rail.tsx');
const edge = read('supabase/functions/ecos-ask-project/index.ts');
const observability = read('supabase/functions/_shared/ecos-question-observability.ts');
const semanticRetrieval = read('supabase/functions/_shared/ecos-semantic-retrieval.ts');
const evidenceSelection = read('supabase/functions/_shared/ecos-evidence-selection.ts');
const foundation = read('supabase/migrations/20260909020954_ecos_unified_question_foundation.sql');
const hybrid = read('supabase/migrations/20260909021914_ecos_hybrid_retrieval.sql');
const semanticReset = read('supabase/migrations/20260909024703_ecos_semantic_reindex_reset_cleanup.sql');
const semanticUsage = read('supabase/migrations/20260909035500_ecos_semantic_index_usage_event.sql');
const shadowPublicationIsolation = read('supabase/migrations/20260909041500_ecos_shadow_ready_publication_isolation.sql');
const assuranceIdentityBackfill = read('supabase/migrations/20260909044500_ecos_hosted_assurance_identity_backfill.sql');
const semanticBackfill = read('supabase/migrations/20260909050000_ecos_ready_shadow_semantic_backfill.sql');
const semanticBackfillCleanup = read('supabase/migrations/20260909051500_ecos_semantic_backfill_staging_cleanup.sql');
const semanticBackfillPromotion = read('supabase/migrations/20260909053000_ecos_semantic_backfill_batched_promotion.sql');
const semanticReconciliation = read('supabase/migrations/20260909054500_ecos_shadow_semantic_materialization_reconcile.sql');
const hybridV21 = read('supabase/migrations/20260909061500_ecos_hybrid_retrieval_v21.sql');
const hybridV21OperatorResolution = read(
  'supabase/migrations/20260909062500_ecos_hybrid_retrieval_v21_operator_resolution.sql',
);
const referenceAuthorityProjection = read(
  'supabase/migrations/20260909064000_ecos_reference_document_authority_projection.sql',
);
const semanticHnswContract = read(
  'supabase/migrations/20260909065000_ecos_semantic_hnsw_execution_contract.sql',
);
const shadowPageDossierContext = read(
  'supabase/migrations/20260909070000_ecos_shadow_page_dossier_context.sql',
);
const shadowBatchedLexicalRetrieval = read(
  'supabase/migrations/20260909071500_ecos_shadow_batched_lexical_retrieval.sql',
);
const shadowReferenceInventory = read(
  'supabase/migrations/20260909072000_ecos_shadow_reference_inventory.sql',
);
const shadowLexicalBatchTimeoutBound = read(
  'supabase/migrations/20260909072500_ecos_shadow_lexical_batch_timeout_bound.sql',
);
const shadowLexicalBatchRemoval = read(
  'supabase/migrations/20260909073000_ecos_remove_shadow_lexical_batch.sql',
);
const shadowQuestionDocumentInventory = read(
  'supabase/migrations/20260909074000_ecos_shadow_question_document_inventory.sql',
);
const shadowEvidenceManifest = read(
  'supabase/migrations/20260909075000_ecos_shadow_evidence_manifest.sql',
);
const shadowEvidenceManifestMembershipFix = read(
  'supabase/migrations/20260909075100_ecos_shadow_evidence_manifest_membership_fix.sql',
);
const shadowExactPagePairs = read(
  'supabase/migrations/20260909080000_ecos_shadow_exact_page_pairs.sql',
);
const shadowPageIdentityPairs = read(
  'supabase/migrations/20260909081000_ecos_shadow_page_identity_pairs.sql',
);
const shadowCompactPageContext = read(
  'supabase/migrations/20260909203000_ecos_shadow_compact_page_context.sql',
);
const shadowBoundedPageEvidence = read(
  'supabase/migrations/20260909211500_ecos_shadow_bounded_page_evidence.sql',
);
const shadowAnswerRegionPriority = read(
  'supabase/migrations/20260910160921_ecos_shadow_answer_region_priority.sql',
);
const shadowExactSheetIdentity = read(
  'supabase/migrations/20260910043000_ecos_shadow_exact_sheet_identity.sql',
);
const shadowPageIdentityTermCandidates = read(
  'supabase/migrations/20260910085301_ecos_shadow_page_identity_term_candidates.sql',
);
const worker = read('workers/ecos-indexer/ecos_indexer/worker.py');
const semanticBackfillOperator = read('workers/ecos-indexer/ecos_indexer/semantic_backfill.py');
const liveRunner = read('scripts/ecos-ask-live-acceptance.js');
const liveContract = read('scripts/ecos-ask-live-acceptance-lib.js');
const privateEndUserValidator = read('scripts/ecos-v2-private-end-user-validation.js');

assert.match(protocol, /ecos-project-question\/2\.0/);
assert.match(client, /buildECOSProjectQuestionRequest/);
assert.match(client, /parseECOSQuestionDiagnostics/);
assert.equal((client.match(/functions\.invoke\(/g) || []).length, 1,
  'The app must have one Ask ECOS invocation boundary.');
assert.match(app, /onAskECOS=\{ecosProjectQuestion\.open\}/);
for (const navigation of [bottomTabs, navigationRail]) {
  assert.match(navigation, /primaryAssistantLabel = showAskECOS \? 'Ask ECOS' : 'Project actions'/);
  assert.match(navigation, /openPrimaryAssistant = showAskECOS \? \(onAskECOS \|\| onTalk\) : onTalk/);
}

for (const table of [
  'ecos_project_evidence_snapshots',
  'ecos_question_evidence_dossiers',
  'ecos_question_diagnostic_traces',
]) {
  assert.match(foundation, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(foundation, new RegExp(`alter table public\\.${table} force row level security`));
}
assert.doesNotMatch(foundation, /question_text|answer_text|source_excerpt|prompt_text/i,
  'Private receipts must not persist raw question, answer, prompt, or source text.');
for (const channel of [
  'schedule_items',
  'project_updates',
  'field_notes',
  'reference_documents',
  'ecos_hosted_index_jobs',
]) {
  assert.match(foundation, new RegExp(`public\\.${channel}`));
}
assert.match(edge, /capture_evidence_manifest/);
assert.match(edge, /verify_retried_evidence_manifest/);
assert.match(edge, /project_evidence_changed_during_question/);
assert.match(edge, /consistency: ["']stable_read["']/);
assert.match(edge, /selectECOSEvidenceSources/,
  'The runtime must use the shared deterministic proof-selection boundary.');
assert.match(evidenceSelection, /deterministicCandidates/);
assert.match(evidenceSelection, /fact:\$\{normalizedStatement\}/,
  'Deterministic proof must be grouped by exact fact rather than collapsed by page.');
assert.match(evidenceSelection, /source\.documentRegion \? 20 : 0/,
  'Bounded proof must outrank broad page text when both support the same fact.');
assert.match(edge, /projectECOSDeterministicEvidenceText/,
  'Bounded structured evidence must be projected into explicit proof text before composition.');
assert.match(edge, /buildECOSCrossDisciplineLightingFallback/,
  'Cross-discipline lighting answers must preserve both civil and electrical authority.');

assert.match(hybrid, /create extension if not exists vector with schema extensions/);
assert.match(hybrid, /ecos_hosted_chunk_embeddings/);
assert.match(hybrid, /embedding extensions\.vector\(1536\)/);
assert.match(hybrid, /ecos_search_hosted_semantic_chunks/);
assert.match(hybrid, /ecos_search_hosted_shadow_semantic_chunks/);
assert.match(hybrid, /ecos_replace_hosted_shadow_chunk_embeddings/);
assert.match(hybrid, /exact_job_count = 1/);
assert.match(hybrid, /vitruvius_has_project_permission/);
for (const identityField of [
  'job_id uuid',
  'organization_id text',
  'project_id text',
  'source_sha256 text',
  'evidence_version text',
]) {
  assert.match(hybrid, new RegExp(identityField));
}
assert.doesNotMatch(hybrid, /create or replace function public\.ecos_search_hosted_document_chunks\(/,
  'The semantic migration must preserve the deployed lexical authority contract.');
assert.doesNotMatch(hybrid, /create or replace function public\.ecos_search_hosted_shadow_chunks\(/,
  'The semantic migration must preserve the deployed protected lexical authority contract.');
assert(hybrid.includes("coalesce(supplied.value->>'pageNumber', '') !~ '^[1-9][0-9]{0,3}$'"));
assert.match(hybrid, /from public, anon, authenticated/);
assert.match(semanticReset, /delete from public\.ecos_hosted_chunk_embeddings/);
assert.match(semanticReset, /embedding\.source_sha256 = selected_job\.source_sha256/);
assert.match(semanticReset, /An active worker lease is still processing this job/);
assert.match(semanticReset, /to service_role/);
assert.match(semanticUsage, /'semantic_index_ready'/);
assert.match(semanticUsage, /p_event_type not in \('page_assured', 'semantic_index_ready', 'document_ready'\)/);
assert.match(semanticUsage, /job\.claim_token = p_claim_token/);
assert.match(semanticUsage, /from public, anon, authenticated/);
assert.match(semanticUsage, /to service_role/);
assert.equal(
  (shadowPublicationIsolation.match(/new\.mode = 'live'/g) || []).length,
  2,
  'Both verified-commit trigger entry points must be live-only.',
);
assert.match(shadowPublicationIsolation, /after insert[\s\S]*new\.mode = 'live'/);
assert.match(shadowPublicationIsolation, /after update of[\s\S]*new\.mode = 'live'/);
assert.doesNotMatch(shadowPublicationIsolation, /new\.mode = 'shadow'/);
for (const identityBinding of [
  "'sourceSha256', job.source_sha256",
  "'projectId', job.project_id",
  "'pageNumber', page.page_number",
  "page.final_page_data->>'sourceSha256' = job.source_sha256",
  "page.final_page_data->>'projectId' = job.project_id",
  "page.final_page_data->>'pageNumber' = page.page_number::text",
]) {
  assert.match(assuranceIdentityBackfill, new RegExp(identityBinding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(assuranceIdentityBackfill, /job\.mode = 'shadow'/);
assert.match(assuranceIdentityBackfill, /job\.state = 'ready'/);
assert.match(assuranceIdentityBackfill, /page\.assurance_result->>'accepted' = 'true'/);
for (const semanticBackfillContract of [
  'ecos_begin_ready_shadow_semantic_backfill',
  'ecos_stage_ready_shadow_semantic_backfill_batch',
  'ecos_commit_ready_shadow_semantic_backfill',
  'ecos_cancel_ready_shadow_semantic_backfill',
]) {
  assert.match(semanticBackfill, new RegExp(semanticBackfillContract));
}
assert.match(semanticBackfill, /job\.state <> 'ready'/);
assert.match(semanticBackfill, /job\.mode <> 'shadow'/);
assert.match(semanticBackfill, /ecos_hosted_job_matches_reference/);
assert.match(semanticBackfill, /Partial batches are never visible to retrieval/);
assert.match(semanticBackfill, /from public, anon, authenticated/);
assert.match(semanticBackfill, /to service_role/);
assert.match(semanticBackfillOperator, /staged_semantic_backfill_identities/);
assert.match(semanticBackfillOperator, /chunkInventorySha256/);
assert.doesNotMatch(semanticBackfillOperator, /"chunkText"|"embedding": embedding/,
  'The semantic backfill receipt must never persist source text or vectors.');
assert.match(semanticBackfillCleanup, /new\.state = 'committed'/);
assert.match(semanticBackfillCleanup, /delete from public\.ecos_hosted_semantic_backfill_embeddings/);
assert.match(semanticBackfillPromotion, /ecos_materialize_ready_shadow_semantic_backfill_batch/);
assert.match(semanticBackfillPromotion, /selected_job\.state not in \('ready', 'assuring'\)/);
assert.match(semanticBackfillPromotion, /set state = 'assuring'/);
assert.match(semanticBackfillPromotion, /limit p_batch_size/);
assert.match(semanticBackfillPromotion, /set state = 'ready'/);
assert.match(semanticBackfillPromotion, /backfill_run_id/);
assert.match(semanticReconciliation, /ecos_reconcile_queued_shadow_semantic_page/);
assert.match(semanticReconciliation, /pending\.operation <> 'refresh'/);
assert.match(semanticReconciliation, /before_inventory/);
assert.match(semanticReconciliation, /after_inventory is distinct from before_inventory/);
assert.match(semanticReconciliation, /missing an exact semantic embedding/);
assert.match(semanticReconciliation, /to service_role/);
assert.match(semanticBackfillOperator, /reconcile_queued_shadow_semantic_page/);
assert.match(edge, /createECOSQuestionEmbedding/);
assert.match(edge, /createECOSQuestionEmbeddings/);
assert.match(edge, /fuseECOSSemanticSearchResults/);
assert.match(edge, /ecos_search_hosted_semantic_chunks/);
assert.match(edge, /if \(shadowClient\) throw error/);
assert.match(edge, /semantic_document_search/);
assert.match(edge, /semantic_document_matches/);
assert.match(observability, /ecos-evidence-retrieval\/2\.3/);
assert.match(semanticRetrieval, /semantic_multi_query/);
assert.match(semanticRetrieval, /semanticVariantHitCount/);
assert.match(hybridV21, /ecos_search_hosted_semantic_chunks_v21/);
assert.match(hybridV21, /ecos_search_hosted_shadow_semantic_chunks_v21/);
assert.match(hybridV21OperatorResolution, /set search_path = pg_catalog, extensions/);
assert.doesNotMatch(hybridV21OperatorResolution, /\bpublic\s*,\s*extensions\b/);
assert.match(referenceAuthorityProjection, /app_private\.ecos_reference_document_authority/);
assert.match(referenceAuthorityProjection, /after insert or update or delete on public\.reference_documents/);
assert.match(referenceAuthorityProjection, /source\.source_sha256 = job\.source_sha256/);
assert.match(referenceAuthorityProjection, /source\.source_revision is not distinct from job\.source_revision/);
assert.doesNotMatch(referenceAuthorityProjection, /grant execute[\s\S]*to authenticated/);
assert.match(shadowExactSheetIdentity, /ecos_find_hosted_shadow_pages_by_sheet_v25/);
assert.match(shadowExactSheetIdentity, /sheetMappingStatus[^\n]*verified/);
assert.match(shadowExactSheetIdentity, /ecos_hosted_job_matches_reference\(job\.id, true\)/);
assert.match(shadowExactSheetIdentity, /revoke all[\s\S]*from public, anon, authenticated/);
assert.match(shadowExactSheetIdentity, /grant execute[\s\S]*to service_role/);
assert.match(edge, /ecos_find_hosted_shadow_pages_by_sheet_v25/);
assert.match(
  shadowPageIdentityTermCandidates,
  /ecos_find_hosted_shadow_page_candidates_v26/,
);
assert.match(
  shadowPageIdentityTermCandidates,
  /ecos_hosted_job_matches_reference\(job\.id, true\)/,
);
assert.match(
  shadowPageIdentityTermCandidates,
  /page\.assurance_result->>'accepted' = 'true'/,
);
assert.match(
  shadowPageIdentityTermCandidates,
  /sheetMappingStatus', ''\) = 'verified'/,
);
assert.match(
  shadowPageIdentityTermCandidates,
  /lower\(coalesce\(page\.final_page_data->>'text', ''\)\)/,
);
assert.match(
  shadowPageIdentityTermCandidates,
  /cardinality\(p_query_terms\) not between 1 and 100/,
);
assert.match(
  shadowPageIdentityTermCandidates,
  /revoke all[\s\S]*from public, anon, authenticated/,
);
assert.match(
  shadowPageIdentityTermCandidates,
  /grant execute[\s\S]*to service_role/,
);
assert.match(edge, /ecos_find_hosted_shadow_page_candidates_v26/);
assert.match(evidenceSelection, /ecosEvidenceCoversExplicitSheetReferences/);
assert.match(semanticHnswContract, /ecos_search_hosted_semantic_chunks_v22/);
assert.match(semanticHnswContract, /ecos_search_hosted_shadow_semantic_chunks_v22/);
assert.match(semanticHnswContract, /set_config\('enable_sort', 'off', true\)/);
assert.match(semanticHnswContract, /set_config\('hnsw\.ef_search', '200', true\)/);
assert.match(semanticHnswContract, /from public\.ecos_search_hosted_semantic_chunks_v21/);
assert.match(semanticHnswContract, /from public\.ecos_search_hosted_shadow_semantic_chunks_v21/);
assert.match(edge, /ecos_search_hosted_semantic_chunks_v22/);
assert.match(edge, /ecos_search_hosted_shadow_semantic_chunks_v22/);
assert.match(edge, /ecos_search_hosted_shadow_chunks/);
assert.match(shadowPageDossierContext, /public\.ecos_hosted_job_matches_reference\(job\.id, true\)/);
assert.match(shadowPageDossierContext, /page\.assurance_result->>'accepted' = 'true'/);
assert.match(shadowPageDossierContext, /page\.unresolved_region_count = 0/);
assert.match(shadowPageDossierContext, /from public, anon, authenticated/);
assert.match(shadowBatchedLexicalRetrieval, /cardinality\(p_search_queries\) not between 1 and 20/);
assert.match(shadowBatchedLexicalRetrieval, /cross join lateral public\.ecos_search_hosted_shadow_chunks/);
assert.match(shadowBatchedLexicalRetrieval, /row_number\(\) over/);
assert.match(shadowBatchedLexicalRetrieval, /from public, anon, authenticated/);
assert.match(shadowReferenceInventory, /ecos_list_hosted_shadow_reference_documents_v21/);
assert.match(shadowReferenceInventory, /public\.ecos_hosted_job_matches_reference\(job\.id, true\)/);
assert.doesNotMatch(shadowReferenceInventory, /document_data/);
assert.match(shadowReferenceInventory, /from public, anon, authenticated/);
assert.match(edge, /ecos_list_hosted_shadow_question_documents_v22/);
assert.match(edge, /mapInBoundedBatches\(\s*questionEmbeddings,\s*2,/);
assert.match(edge, /mapInBoundedBatches\(\s*queries,\s*4,/);
assert.match(edge, /ecosQuestionLexicalQueries\(question\)\.slice\(0, 12\)/);
assert.match(edge, /ecosQuestionDocumentAffinity/);
assert.match(edge, /selectECOSEvidenceSources/);
assert.match(edge, /const MAX_DOCUMENT_SOURCES = 36/);
assert.match(edge, /documentPageSelectionRank/);
assert.match(evidenceSelection, /deterministicSelectionScore\(question, right\)/);
assert.match(edge, /runtimeDeploymentIdentity/);
assert.match(edge, /Deno\.env\.get\(["']DENO_DEPLOYMENT_ID["']\)/);
assert.match(
  edge,
  /item\.id === ["']fact-installed-design-fallback["'][\s\S]*item\.id === ["']fact-drawing-quantity-fallback["']/,
  'A deterministic drawing fallback must keep the drawing-vs-installed limitation even when model facts cite field records.',
);
assert.match(
  edge,
  /ecosQuestionRetrievalVariants\(question\)\.slice\(\s*0,\s*4,/,
);
assert.match(
  edge,
  /semanticSearchPromise[\s\S]*lexicalSearchPromise[\s\S]*Promise\.all/,
);
assert.match(edge, /safeQuestionDiagnosticErrorCode/);
assert.match(edge, /ecos_project_shadow_evidence_manifest_v22/);
assert.match(shadowEvidenceManifest, /authority\.source_sha256/);
assert.match(
  shadowEvidenceManifest,
  /public\.ecos_hosted_job_matches_reference\(job\.id, true\)/,
);
assert.doesNotMatch(shadowEvidenceManifest, /document_data/);
assert.match(shadowEvidenceManifest, /from public, anon, authenticated/);
assert.match(shadowEvidenceManifestMembershipFix, /job\.source_owner_id = p_owner_id/);
assert.doesNotMatch(
  shadowEvidenceManifestMembershipFix,
  /pie_layer4_has_active_membership/,
);
assert.doesNotMatch(shadowEvidenceManifestMembershipFix, /document_data/);
assert.match(edge, /ecos_load_hosted_shadow_bounded_page_evidence_pairs_v27/);
assert.match(
  shadowAnswerRegionPriority,
  /deterministic_structured_table_relationship['"]? then 130/,
);
assert.match(shadowAnswerRegionPriority, /enlarged\[\[:space:\]\]/);
assert.match(shadowAnswerRegionPriority, /cfm\|cubic/);
assert.match(
  shadowAnswerRegionPriority,
  /from public, anon, authenticated/,
);
assert.match(privateEndUserValidator, /assertPrivateQuestionCapacity\(\{/);
assert.match(
  privateEndUserValidator,
  /\.eq\('operation_type', 'project_question'\)/,
);
assert.match(privateEndUserValidator, /availableSlots >= requiredSlots/);
assert.match(edge, /ecos_load_hosted_shadow_page_identity_pairs_v22/);
assert.doesNotMatch(edge, /ecos_load_hosted_shadow_page_context_v21/);
assert.match(edge, /publishedHostedEvidenceIsAuthorized/);
assert.match(edge, /\.eq\(["']source_owner_id["'], ownerId\)/);
assert.match(edge, /\.eq\(["']project_id["'], projectId\)/);
assert.match(edge, /\.eq\(["']publication_mode["'], ["']live["']\)/);
assert.match(edge, /\.eq\(["']user_id["'], ownerId\)/);
assert.match(edge, /const shadowClient = serviceClient/);
assert.match(shadowExactPagePairs, /with ordinality document/);
assert.match(shadowExactPagePairs, /with ordinality page/);
assert.match(shadowExactPagePairs, /using \(position\)/);
assert.match(
  shadowExactPagePairs,
  /public\.ecos_hosted_job_matches_reference\(job\.id, true\)/,
);
assert.match(shadowExactPagePairs, /from public, anon, authenticated/);
assert.match(shadowPageIdentityPairs, /with ordinality document/);
assert.match(shadowPageIdentityPairs, /with ordinality page/);
assert.match(shadowPageIdentityPairs, /using \(position\)/);
assert.match(
  shadowPageIdentityPairs,
  /public\.ecos_hosted_job_matches_reference\(job\.id, true\)/,
);
assert.doesNotMatch(shadowPageIdentityPairs, /final_page_data jsonb/);
assert.match(shadowPageIdentityPairs, /from public, anon, authenticated/);
assert.match(shadowCompactPageContext, /with ordinality document/);
assert.match(shadowCompactPageContext, /with ordinality page/);
assert.match(shadowCompactPageContext, /using \(position\)/);
assert.match(
  shadowCompactPageContext,
  /public\.ecos_hosted_job_matches_reference\(job\.id, true\)/,
);
assert.match(shadowCompactPageContext, /page\.final_page_data->'regions'/);
assert.doesNotMatch(shadowCompactPageContext, /'visualCoverage'/);
assert.match(shadowCompactPageContext, /from public, anon, authenticated/);
assert.match(shadowBoundedPageEvidence, /with ordinality document/);
assert.match(shadowBoundedPageEvidence, /with ordinality page/);
assert.match(shadowBoundedPageEvidence, /using \(position\)/);
assert.match(
  shadowBoundedPageEvidence,
  /public\.ecos_hosted_job_matches_reference\(job\.id, true\)/,
);
assert.match(shadowBoundedPageEvidence, /p_query_terms text\[\]/);
assert.match(shadowBoundedPageEvidence, /limit bounded_region_limit/);
assert.match(shadowBoundedPageEvidence, /deterministic_structured_table_relationship/);
assert.match(shadowBoundedPageEvidence, /from public, anon, authenticated/);
assert.doesNotMatch(shadowBoundedPageEvidence, /'visualCoverage'/);
assert.match(
  shadowQuestionDocumentInventory,
  /public\.ecos_hosted_job_matches_reference\(job\.id, true\)/,
);
assert.doesNotMatch(shadowQuestionDocumentInventory, /document_data/);
assert.match(
  shadowQuestionDocumentInventory,
  /from public, anon, authenticated/,
);
assert.match(shadowLexicalBatchTimeoutBound, /cardinality\(p_search_queries\) not between 1 and 5/);
assert.match(shadowLexicalBatchTimeoutBound, /cross join lateral public\.ecos_search_hosted_shadow_chunks/);
assert.match(shadowLexicalBatchRemoval, /drop function if exists public\.ecos_search_hosted_shadow_chunks_v23/);
assert.match(hybridV21, /nearest_live as materialized/);
assert.match(hybridV21, /nearest_shadow as materialized/);
assert.match(hybridV21, /nearest as materialized/);
assert.match(hybridV21, /from public, anon, authenticated/);
assert.match(worker, /semantic\.build_rows/);
assert(
  worker.indexOf('semantic.build_rows') < worker.indexOf('ecos_commit_hosted_shadow_preparation_job'),
  'The exact semantic index must finish before a shadow job can become ready.',
);

assert.equal((edge.match(/api\.openai\.com\/v1\/responses/g) || []).length, 1,
  'Answer composition must have exactly one generative provider boundary.');
assert.match(edge, /evidenceDossier:/);
assert.match(edge, /dossierSha256/);
assert.match(edge, /assureAnswer\(/);
assert.match(edge, /ECOS Assurance matched every factual statement/);

assert.match(liveRunner, /clientRequestId/);
assert.match(liveRunner, /ECOS_LIVE_CLIENT_SURFACE/);
assert.doesNotMatch(liveRunner, /clientSurface: 'acceptance'/);
assert.match(liveRunner, /supabase_functions_invoke/);
assert.match(liveRunner, /transport_equivalent_cli/);
assert.match(liveRunner, /customer_transport_diagnostic/);
assert.doesNotMatch(liveRunner, /appInvocationBoundary: 'services\/ECOSProjectQuestion\.askECOSProjectQuestion'/);
assert.match(liveContract, /diagnostics\?\.persisted !== true/);
assert.match(liveContract, /ecos-project-question\/2\.0/);

console.log('Ask ECOS unified reliability contract PASS: steps 1-7 foundations are wired.');
