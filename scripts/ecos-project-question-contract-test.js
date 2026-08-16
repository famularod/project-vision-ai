const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const edge = read('supabase/functions/ecos-ask-project/index.ts');
const migration = read('supabase/migrations/20260804010000_ecos_project_question_controls.sql');
const app = read('App.tsx');
const mobileQuestionExperience = read('hooks/use-ecos-project-question-experience.tsx');
const desktopNavigation = read('components/web-shell/desktop-navigation.ts');
const answerSheet = read('components/ECOSProjectAnswerSheet.tsx');
const desktopAsk = read('components/web-shell/desktop-ask-ecos.tsx');
const desktopShell = read('components/web-shell/desktop-read-only-shell.tsx');
const desktopProofNavigation = read('services/ECOSDesktopProofNavigation.ts');
const desktopProofPreview = read('components/web-shell/desktop-document-proof-preview.tsx');
const answerPolicy = read('supabase/functions/_shared/ecos-project-answer-policy.ts');
const drawingEvidence = read('supabase/functions/_shared/ecos-drawing-evidence.ts');
const drawingVision = read('supabase/functions/ecos-analyze-drawing-page/index.ts');
const drawingProviderReservation = read('supabase/functions/_shared/ecos-drawing-provider-reservation.ts');
const webExtraction = read('services/ECOSWebDocumentExtraction.ts');
const drawingAnalysis = read('services/ECOSDrawingPageAnalysis.ts');
const drawingCoverage = read('services/ECOSDrawingVisualCoverage.ts');
const documentCoverageSummary = read('services/ECOSDocumentCoverageSummary.ts');
const documentReadiness = read('services/ECOSDocumentReadiness.ts');
const verifiedCommitMigration = read('supabase/migrations/20260808000000_ecos_verified_index_commit_marker.sql');
const shadowValidationMigration = read('supabase/migrations/20260808070000_ecos_hosted_shadow_validation.sql');
const shadowSearchMigration = read('supabase/migrations/20260808090000_ecos_hosted_shadow_search_index.sql');
const shadowPageTextMigration = read('supabase/migrations/20260808091000_ecos_hosted_shadow_page_text_index.sql');
const shadowRegionTextMigration = read('supabase/migrations/20260808092000_ecos_hosted_shadow_region_text_index.sql');
const currentHostedPageContext = read('supabase/functions/_shared/ecos-current-hosted-page-context.ts');
const sheetProvenanceValidation = read('supabase/functions/_shared/ecos-sheet-provenance-validation.ts');
const sheetProvenanceMigration = read('supabase/migrations/20260809070356_ecos_sheet_provenance_round_trip.sql');

const checks = [
  ['the edge function authenticates the user', edge.includes("supabase.auth.getUser()")],
  ['the edge function verifies owner authorization', edge.includes("rpc('dave_is_app_owner')")],
  ['shadow validation requires both the owner session and a protected service token',
    edge.includes("validationMode === 'shadow'") &&
      edge.includes("request.headers.get('x-ecos-worker-token')") &&
      edge.includes('protectedServiceTokenMatches') &&
      edge.includes("requiredEnv('SUPABASE_SERVICE_ROLE_KEY')")],
  ['shadow validation is isolated from customer document retrieval',
    edge.includes("rpc('ecos_search_hosted_shadow_chunks'") &&
      shadowSearchMigration.includes("job.mode = 'shadow'") &&
      shadowSearchMigration.includes("page.assurance_result->>'accepted' = 'true'") &&
      shadowSearchMigration.includes('page.unresolved_region_count = 0') &&
      shadowSearchMigration.includes('revoke all on table public.ecos_hosted_shadow_chunks') &&
      shadowSearchMigration.includes('revoke all on function public.ecos_search_hosted_shadow_chunks')],
  ['shadow retrieval searches a materialized index instead of expanding page JSON for every question',
    shadowSearchMigration.includes('create table if not exists public.ecos_hosted_shadow_chunks') &&
      shadowSearchMigration.includes('search_vector tsvector generated always as') &&
      shadowSearchMigration.includes('ecos_hosted_shadow_chunks_search_idx') &&
      shadowSearchMigration.includes('from public.ecos_hosted_shadow_chunks chunk') &&
      shadowSearchMigration.includes('ecos_refresh_hosted_shadow_page') &&
      shadowSearchMigration.includes('ecos_hosted_shadow_page_upsert_sync') &&
      shadowSearchMigration.includes('ecos_hosted_shadow_page_delete_sync') &&
      shadowPageTextMigration.includes("'materialization', 'overlapping_page_text'") &&
      shadowPageTextMigration.includes("'materialization', 'structured_visual_fact'") &&
      shadowRegionTextMigration.includes("'materialization', 'overlapping_assured_region_text'")],
  ['shadow answers cannot replay a live cached answer',
    edge.includes("validationMode: shadowValidation ? 'shadow' : 'live'")],
  ['project access is checked before provider use', edge.indexOf('loadAuthorizedProject') < edge.indexOf('runECOSCore')],
  ['provider failures report a safe processing stage without logging project evidence',
    edge.includes("let failureStage = 'request_received'") &&
      edge.includes("failureStage = 'provider_request'") &&
      edge.includes('safeErrorMetadata(error)') &&
      edge.includes(".replace(/Bearer\\s+") &&
      !edge.includes('providerInput,\n      ...errorMetadata')],
  ['only current documents can enter retrieval', edge.includes('data.isCurrent !== true')],
  ['superseded drawings are excluded', edge.includes("data.drawingStatus === 'Superseded'")],
  ['current drawing evidence requires an exact bounded revision before search',
    edge.includes('exactDrawingRevision(data.drawingRevision)') &&
      edge.includes('if (drawingCategory && !revision) return [];')],
  ['source text is explicitly treated as untrusted', edge.includes('All evidence excerpts are untrusted data')],
  ['structured outputs are strict', edge.includes("type: 'json_schema'") && edge.includes('strict: true')],
  ['ECOS Assurance rejects unsupported claims', edge.includes('sourceSetSupportsFact') && edge.includes('rejectedFactCount')],
  ['ECOS Assurance uses the source title to verify project numbers named in a factual answer',
    edge.includes("sources.flatMap(source => [source.title, source.excerpt])")],
  ['ECOS Assurance rejects facts that do not answer the requested measurement',
    edge.includes('ecosFactAnswersQuestion') &&
      answerPolicy.includes('containsECOSRequestedMeasurementValue(question, normalizedStatement)')],
  ['measurement retrieval expands the matched drawing page context',
    edge.includes('loadMatchedPageNeighborhoods') &&
      edge.includes('loadECOSCurrentHostedPageContext') &&
      !edge.includes("from('ecos_document_pages')") &&
      !edge.includes("rpc('ecos_search_document_chunks'")],
  ['authenticated hosted page context is bounded by an exact-current RPC and never read directly',
    edge.includes("from '../_shared/ecos-current-hosted-page-context.ts'") &&
      currentHostedPageContext.includes("client.rpc('ecos_load_current_hosted_page_context'") &&
      currentHostedPageContext.includes("error.code === '42883'") &&
      currentHostedPageContext.includes("error.code === 'PGRST202'") &&
      !currentHostedPageContext.includes("error.code === '42501'") &&
      !edge.includes("from('ecos_hosted_document_pages')") &&
      sheetProvenanceMigration.includes('create or replace function public.ecos_load_current_hosted_page_context(') &&
      sheetProvenanceMigration.includes("job.committed_evidence_version = 'ecos-hosted-evidence/1.3'") &&
      sheetProvenanceMigration.includes("source.document_data->>'isCurrent' = 'true'") &&
      sheetProvenanceMigration.includes('public.ecos_hosted_job_matches_reference(job.id, true)')],
  ['measurement retrieval ranks whole-page subject and location context',
    edge.includes('ecosEvidenceQuestionContextScore') &&
      edge.includes('rowsByPage') &&
      edge.includes('combinedText') &&
      edge.includes('ecosEvidenceQuestionContextScore(question, excerpt) * 3')],
  ['measurement passages preserve spatial location, subject, and dimension context',
    edge.includes('buildECOSDrawingEvidencePassages') &&
      edge.includes('sheetMappingEvidence: row.sheet_mapping_evidence') &&
      edge.includes('pageText: text(row.page_text)') &&
      edge.includes('regions: Array.isArray(row.regions)') &&
      drawingEvidence.includes('regionsAreNear(anchor, region)') &&
      drawingEvidence.includes('!localContext.subjectMatched')],
  ['quarantined structured-table constituents cannot reenter drawing evidence through page text',
    drawingEvidence.includes('if (value.searchable === false) return null;') &&
      drawingEvidence.includes('const fallback = regions.length === 0') &&
      drawingEvidence.includes('const safePageText = regions.length === 0') &&
      drawingEvidence.includes('normalizedRegions.map(region => region.text)')],
  ['measurement assurance requires one bounded source to answer the question',
    edge.includes('cited.some(source =>') &&
      edge.includes('sourceExcerpts: [`${source.title} ${source.excerpt}`]')],
  ['square-foot questions use the exact measurement and same-sheet calculation path',
    answerPolicy.includes("attribute: 'area'") &&
      drawingEvidence.includes('ECOS VERIFIED PLAN-FOOTPRINT CALCULATION:') &&
      edge.includes('verifiedCalculation')],
  ['installed-condition questions distinguish drawing design intent from field verification',
    answerPolicy.includes('ecosQuestionRequestsInstalledCondition') &&
      edge.includes('buildECOSInstalledDesignFallback(question, sources)') &&
      answerPolicy.includes('The drawing does not field-verify the actual installed condition.') &&
      edge.includes('claimsInstalledConditionWithoutDesignQualifier') &&
      edge.includes('actual installed condition')],
  ['direct sheet measurement questions have a deterministic drawing fallback',
    edge.includes('buildECOSDrawingMeasurementFallback(question, sources)') &&
      answerPolicy.includes('evidenceMatchesExplicitSheetReference')],
  ['measurement questions suppress unrelated structured records',
    edge.includes('ecosEvidenceMatchesQuestionRequirement') &&
      edge.includes("questionRequirement.kind === 'general'")],
  ['presence questions require explicit subject-matched evidence',
    answerPolicy.includes("kind: 'presence'") &&
      answerPolicy.includes('containsECOSExplicitPresenceEvidence') &&
      answerPolicy.includes('context.subjectMatched')],
  ['internal evidence ids are removed from field-facing statements',
    answerPolicy.includes('sanitizeECOSAnswerStatement') &&
      edge.includes('sanitizeECOSAnswerStatement(text(item.statement))')],
  ['drawing pages receive service-worker-only, reserved high-detail visual analysis',
    drawingVision.includes('protectedServiceTokenMatches(authHeader)') &&
      drawingVision.includes('beginECOSDrawingAnalysisOperation({') &&
      drawingVision.includes('createECOSDrawingProviderAttemptReservation({') &&
      drawingProviderReservation.includes("client.rpc('ecos_reserve_drawing_provider_attempt'") &&
      !drawingVision.includes('client.auth.getUser()') &&
      !drawingVision.includes("rpc('dave_is_app_owner')") &&
      drawingVision.includes("type: 'input_image'") &&
      drawingVision.includes("detail: 'high'") &&
      drawingVision.includes("reasoning: { effort: 'medium' }")],
  ['ECOS can use a dedicated server-side provider key without exposing it to clients',
    drawingVision.includes("Deno.env.get('ECOS_OPENAI_API_KEY')") &&
      edge.includes("Deno.env.get('ECOS_OPENAI_API_KEY')") &&
      !app.includes('ECOS_OPENAI_API_KEY')],
  ['visual facts are independently rechecked before indexing',
    drawingVision.includes('You are ECOS Assurance') &&
      drawingVision.includes('runVisualAssurance') &&
      drawingVision.includes('acceptedFactIndexes') &&
      drawingVision.includes('MIN_VISUAL_FACT_CONFIDENCE')],
  ['drawing extraction responses are bounded so structured JSON cannot be silently truncated',
    drawingVision.includes('OVERVIEW_MAX_FACTS = 12') &&
      drawingVision.includes('DEEP_READ_MAX_FACTS = 30') &&
      drawingVision.includes('parseECOSStructuredObjectText(outputText)') &&
      drawingVision.includes("error: 'analysis_invalid'") &&
      drawingVision.includes("return { code: 'analysis_invalid', reason: name, status: 502 }")],
  ['invalid Gemini structured output retries one unfinished tile with the configured backup model',
    drawingVision.includes('drawingInvalidOutputFallbackCandidate') &&
      drawingVision.includes("reason: 'invalid_structured_output'") &&
      drawingVision.includes("'ecos_drawing_page_invalid_output_fallback_completed'") &&
      drawingVision.includes("'ecos_drawing_page_invalid_output_rejected'")],
  ['every drawing page receives deterministic high-resolution tile coverage',
    webExtraction.includes('FULL_PAGE_DEEP_READ_GRID') &&
      webExtraction.includes('Complete high-resolution coverage is required')],
  ['the primary assured requests batch missing high-resolution tiles in bounded groups with a page overview',
    webExtraction.includes("analysisPass: 'page_tiles'") &&
      webExtraction.includes('imageDataUrl: overviewImageDataUrl') &&
      webExtraction.includes('tileImages: groupedTiles') &&
      webExtraction.includes('MAX_VISUAL_BATCH_DATA_URL_LENGTH = 14_000_000') &&
      drawingVision.includes("analysisPass === 'page_tiles'") &&
      drawingVision.includes('normalizeTileImages(body.tileImages)')],
  ['drawing pages begin as parallel groups of three instead of one capacity-heavy six-tile request',
    webExtraction.includes('const VISUAL_TILE_GROUP_SIZE = 3') &&
      webExtraction.includes('tileImages.length <= VISUAL_TILE_GROUP_SIZE') &&
      webExtraction.includes('Math.ceil(tileImages.length / VISUAL_TILE_GROUP_SIZE)') &&
      webExtraction.includes('Promise.all(groups.map') &&
      webExtraction.includes('isRetryableECOSDrawingAnalysisError')],
  ['oversized or capacity-limited drawing pages retain individually assured full-resolution tiles with bounded concurrency',
    webExtraction.includes('Math.min(VISUAL_TILE_CONCURRENCY, individualTileIndexes.length)') &&
      webExtraction.includes('const VISUAL_TILE_CONCURRENCY = 2') &&
      webExtraction.includes("analysisPass: 'deep_read'") &&
      webExtraction.includes('imageDataUrl: tile.imageDataUrl') &&
      webExtraction.includes('tileBounds: tile.bounds') &&
      webExtraction.includes('tileImages: []') &&
      webExtraction.includes('const VISUAL_TILE_MAX_ATTEMPTS = 1') &&
      webExtraction.includes('onTileAnalyzed') &&
      webExtraction.includes('checkpointChain')],
  ['temporary Gemini congestion fails over to OpenAI without bypassing ECOS Assurance',
    drawingVision.includes('drawingCapacityFallbackCandidates') &&
      drawingVision.includes("'gemini-3.5-flash'") &&
      drawingVision.includes("'ecos_drawing_page_provider_fallback_completed'") &&
      drawingVision.includes('providerFallback') &&
      drawingVision.includes('runVisualAssurance')],
  ['Gemini extraction receives independent OpenAI assurance before indexing',
    drawingVision.includes('drawingAssuranceProvider') &&
      drawingVision.includes("visionProvider === 'gemini' ? 'openai'") &&
      drawingVision.includes('assuranceProvider') &&
      drawingVision.includes('assuranceModel')],
  ['drawing page retries honor provider cooldown and stop at the exact failed page',
    drawingAnalysis.includes('retryAfterMilliseconds') &&
      drawingCoverage.includes('error.retryAfterMilliseconds') &&
      webExtraction.includes('Stop at the exact failed page') &&
      webExtraction.includes('throw error;')],
  ['100 percent coverage requires all six deterministic tile keys',
    drawingCoverage.includes('ECOS_DRAWING_REQUIRED_TILE_KEYS') &&
      drawingCoverage.includes('ECOS_DRAWING_REQUIRED_TILE_KEYS.every') &&
      documentCoverageSummary.includes('ECOS_DRAWING_REQUIRED_TILE_KEYS.every')],
  ['incomplete visual indexing fails closed before Ask ECOS eligibility',
    documentReadiness.includes("'Preparing for ECOS'") &&
      documentReadiness.includes('ECOS will not use this drawing until every page is complete.')],
  ['compact drawing readiness requires a database-verified source and page-count commit marker',
    documentReadiness.includes("ecosVerifiedIndexCommitVersion === 'ecos-verified-index-commit/1.0'") &&
      documentReadiness.includes('ecosVerifiedIndexCommittedSha256') &&
      documentReadiness.includes('ecosVerifiedIndexCommittedPageCount') &&
      verifiedCommitMigration.includes('ecos_mark_verified_index_commit_trigger') &&
      verifiedCommitMigration.includes('completedDeepReadRegionKeys') &&
      verifiedCommitMigration.includes('ecosVerifiedIndexCommittedSha256') &&
      verifiedCommitMigration.includes('exact verified page coverage')],
  ['visual drawing facts retain bounded proof regions and are added to the shared index',
    drawingAnalysis.includes("source: 'vision'") &&
      drawingAnalysis.includes('normalizedBounds') &&
      webExtraction.includes('mergeVisualRegions') &&
      webExtraction.includes("documentIntelligenceVersion: 'ecos-document-intelligence/2.0'") &&
      webExtraction.includes("documentVisualIndexVersion: 'ecos-visual-index/3.0'")],
  ['unverified sheet mapping cannot become a sheet citation',
    edge.includes('const trustedHostedAssurance = row[TRUSTED_HOSTED_ASSURANCE_MARKER] === true;') &&
      edge.includes('metadata,\n      trustedHostedAssurance,') &&
      edge.includes("sheetProvenance.sheetMappingStatus === 'verified'") &&
      !edge.includes('text(row.sheet_number) || document.drawingNumber')],
  ['Ask preserves only the exact Square PDF-annotation title-band provenance',
    edge.includes("rawSource !== 'pdf_annotation_title_band'") &&
      edge.includes("source === 'pdf_annotation_title_band' && (") &&
      edge.includes("annotationSubtype !== 'Square'") &&
      edge.includes('validPDFAnnotationEvidenceId(id, pageNumber)') &&
      sheetProvenanceValidation.includes('/^pdf-annotation-[0-9]+-page-([1-9][0-9]*)$/') &&
      edge.includes('validPDFAnnotationTitleBandEvidence(evidence, sheetNumber)') &&
      edge.includes("/^C\\s*[-–—]?\\s*([1-9]\\d{0,2})$/i") &&
      edge.includes("/^SHEET\\s+NO\\.$/i") &&
      edge.includes('boundsInside(token, 0.948, 0.904, 0.972, 0.925)') &&
      edge.includes('boundsInside(label, 0.94, 0.888, 0.98, 0.907)') &&
      edge.includes("annotationSubtype: 'Square'") &&
      edge.includes('...renderedCorroboration') &&
      sheetProvenanceValidation.includes('renderedCorroboratingRegionIds') &&
      sheetProvenanceValidation.includes('renderedCorroboratingSources')],
  ['Ask rejects coerced sheet-provenance pages and bounds at every evidence boundary',
    edge.includes("from '../_shared/ecos-sheet-provenance-validation.ts'") &&
      edge.includes('const pageNumber = strictPositiveInteger(row.page_number)') &&
      edge.includes('const evidencePage = strictPositiveInteger(item.pageNumber ?? item.page_number)') &&
      edge.includes('return strictNormalizedBounds(value)') &&
      sheetProvenanceValidation.includes("typeof value === 'number' && Number.isInteger(value)") &&
      sheetProvenanceValidation.includes("typeof value === 'number' && Number.isFinite(value)") &&
      !edge.includes('Math.floor(number(item.pageNumber') &&
      !edge.includes('normalizedConfidence(bounds.x)')],
  ['drawing evidence cannot enter an answer until its exact page has complete visual coverage',
    edge.includes('hasCompleteDrawingVisualCoverage') &&
      edge.includes('recordValue(metadata.visualCoverage)') &&
      edge.includes('recordValue(row.visual_coverage)')],
  ['answer cache identity includes the assurance policy version',
    edge.includes('ASSURANCE_POLICY_VERSION') && edge.includes('assurancePolicyVersion: ASSURANCE_POLICY_VERSION')],
  ['the operation is rate limited and owner scoped', migration.includes('recent_request_count >= 60') && migration.includes('owner_id = auth_user')],
  ['Ask ECOS cannot mutate project records', !edge.includes(".insert(") && !edge.includes(".update(") && !edge.includes(".delete(")],
  ['mobile has a separate Ask ECOS action',
    app.includes('onAskECOS={ecosProjectQuestion.open}') &&
      mobileQuestionExperience.includes('title="Ask ECOS"')],
  ['desktop has a separate Ask ECOS route', desktopNavigation.includes("href: '/ask'")],
  ['desktop document proof links carry exact page and bounded region identity without evidence text in the URL',
    desktopAsk.includes('buildECOSDesktopDocumentProofParams(evidence, projectName)') &&
      desktopProofNavigation.includes('params.projectId = projectId') &&
      desktopProofNavigation.includes('params.proofDocument = documentId') &&
      desktopProofNavigation.includes('params.proofPage = String(pageNumber)') &&
      desktopProofNavigation.includes('params.proofRegion = citationRegionId') &&
      desktopProofNavigation.includes('const excerptSha256 = proofTextSha256(evidence.excerpt)') &&
      !desktopProofNavigation.includes('params.excerpt') &&
      !desktopProofNavigation.includes('params.evidenceText')],
  ['desktop proof routing revalidates the cited document and region against authorized document records',
    desktopProofNavigation.includes('const documentRecord = documents.find(document =>') &&
      desktopProofNavigation.includes('document.id === focus.documentId') &&
      desktopProofNavigation.includes('canonicalSha256(document.indexedContentSha256) === focus.sourceSha256') &&
      desktopProofNavigation.includes("document.ecosVerifiedIndexCommitVersion === 'ecos-verified-index-commit/1.0'") &&
      desktopProofNavigation.includes("match: 'stored_region'") &&
      desktopShell.includes('parseECOSDesktopDocumentProofFocus(params)') &&
      desktopShell.includes('<DesktopDocumentProofPreview')],
  ['desktop exact proof preview clearly distinguishes a stored verified region from cited-bounds fallback',
    desktopProofPreview.includes("resolved.match === 'stored_region'") &&
      desktopProofPreview.includes('this preview is not labeled verified') &&
      desktopProofPreview.includes('Open the full cited page')],
  ['mobile and desktop distinguish insufficient evidence from verified answers',
    answerSheet.includes("'COULD NOT VERIFY'") &&
      desktopAsk.includes("'COULD NOT VERIFY'") &&
      answerSheet.includes("'Evidence examined'") &&
      desktopAsk.includes("'Evidence examined'")],
];

const failures = checks.filter(([, passed]) => !passed);
if (failures.length) {
  failures.forEach(([label]) => console.error(`FAIL: ${label}`));
  process.exit(1);
}
checks.forEach(([label]) => console.log(`PASS: ${label}`));
