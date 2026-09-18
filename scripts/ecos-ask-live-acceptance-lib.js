#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const defaultDefinitionPath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'ask-ecos-real-world-cases.json',
);
const defaultResultPath = path.join(
  repoRoot,
  'validation',
  'output',
  'ecos-ask-live-acceptance.json',
);
const definitionPath = configuredRepositoryPath(
  'ECOS_LIVE_ACCEPTANCE_DEFINITION',
  defaultDefinitionPath,
);
const resultPath = configuredRepositoryPath(
  'ECOS_LIVE_ACCEPTANCE_RESULT',
  defaultResultPath,
);
const LIVE_RESULT_SCHEMA_VERSION = 'ecos-ask-live-acceptance-result/1.0';
const VISUAL_COVERAGE_SCHEMA_VERSION = 'ecos-visual-coverage/1.0';
const VISUAL_EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const REQUIRED_VISUAL_TILE_BOUNDS = Object.freeze({
  '0:0:333:500': Object.freeze({ x: 0, y: 0, width: 1 / 3, height: 0.5 }),
  '333:0:333:500': Object.freeze({ x: 1 / 3, y: 0, width: 1 / 3, height: 0.5 }),
  '667:0:333:500': Object.freeze({ x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 }),
  '0:500:333:500': Object.freeze({ x: 0, y: 0.5, width: 1 / 3, height: 0.5 }),
  '333:500:333:500': Object.freeze({ x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 }),
  '667:500:333:500': Object.freeze({ x: 2 / 3, y: 0.5, width: 1 / 3, height: 0.5 }),
});
const REQUIRED_VISUAL_TILE_KEYS = Object.freeze(Object.keys(REQUIRED_VISUAL_TILE_BOUNDS));
const CONTRACT_FILES = Object.freeze([
  'validation/ecos/ask-ecos-real-world-cases.json',
  'services/ECOSProjectQuestion.ts',
  'supabase/functions/ecos-ask-project/index.ts',
  'supabase/functions/_shared/ecos-project-answer-policy.ts',
  'supabase/functions/_shared/ecos-drawing-evidence.ts',
  'supabase/migrations/20260804000000_ecos_document_search_index.sql',
  'supabase/migrations/20260804010000_ecos_project_question_controls.sql',
  'supabase/migrations/20260806000000_ecos_document_intelligence_v2.sql',
  'supabase/migrations/20260808010000_ecos_hosted_indexer.sql',
  'supabase/migrations/20260808060000_ecos_hosted_indexer_bounded_concurrency.sql',
  'supabase/migrations/20260808070000_ecos_hosted_shadow_validation.sql',
  'supabase/migrations/20260808090000_ecos_hosted_shadow_search_index.sql',
  'supabase/migrations/20260808091000_ecos_hosted_shadow_page_text_index.sql',
  'supabase/migrations/20260808092000_ecos_hosted_shadow_region_text_index.sql',
  'workers/ecos-indexer/ecos_indexer/gateway.py',
  'workers/ecos-indexer/ecos_indexer/assurance.py',
  'workers/ecos-indexer/ecos_indexer/worker.py',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadAcceptanceDefinition(filePath = definitionPath) {
  const definition = readJson(filePath);
  const problems = validateAcceptanceDefinition(definition);
  if (problems.length > 0) {
    throw new Error(`Ask ECOS acceptance definition is invalid:\n- ${problems.join('\n- ')}`);
  }
  return definition;
}

function validateAcceptanceDefinition(definition) {
  const problems = [];
  if (definition?.schemaVersion !== 'ecos-ask-live-acceptance/1.0') {
    problems.push('schemaVersion must be ecos-ask-live-acceptance/1.0.');
  }
  if (!text(definition?.projectName)) problems.push('projectName is required.');
  if (!Number.isInteger(definition?.minimumPassingCases) || definition.minimumPassingCases < 10) {
    problems.push('minimumPassingCases must be an integer of at least 10.');
  }
  if (definition?.requiredPassRate !== 1) problems.push('requiredPassRate must be 1 (100%).');
  if (!Array.isArray(definition?.cases) || definition.cases.length < 10) {
    problems.push('At least 10 real-world cases are required.');
    return problems;
  }
  const ids = new Set();
  definition.cases.forEach((testCase, index) => {
    const label = `case ${index + 1}`;
    const id = text(testCase?.id);
    if (!id) problems.push(`${label} requires an id.`);
    if (ids.has(id)) problems.push(`${label} repeats id ${id}.`);
    ids.add(id);
    if (text(testCase?.question).length < 10) problems.push(`${label} requires a field-ready question.`);
    if (text(testCase?.expectedAnswer).length < 10) problems.push(`${label} requires a verified expected answer.`);
    if (!nonEmptyTextArray(testCase?.requiredAnswerPatterns)) {
      problems.push(`${label} requires answer assertions.`);
    }
    if (!Array.isArray(testCase?.expectedEvidence) || testCase.expectedEvidence.length === 0) {
      problems.push(`${label} requires exact drawing evidence expectations.`);
    }
    if (!Number.isInteger(testCase?.minimumDocumentCitations) || testCase.minimumDocumentCitations < 1) {
      problems.push(`${label} requires at least one document citation.`);
    }
    if (!Number.isInteger(testCase?.minimumDistinctDocuments) || testCase.minimumDistinctDocuments < 1) {
      problems.push(`${label} requires a minimumDistinctDocuments value.`);
    }
    if (!Number.isInteger(testCase?.minimumDistinctSheets) || testCase.minimumDistinctSheets < 0) {
      problems.push(`${label} requires a non-negative minimumDistinctSheets value.`);
    }
    if (testCase?.minimumDistinctPages != null && (
      !Number.isInteger(testCase.minimumDistinctPages) || testCase.minimumDistinctPages < 0
    )) {
      problems.push(`${label} minimumDistinctPages must be non-negative when provided.`);
    }
    if ((testCase.minimumDistinctSheets || 0) + (testCase.minimumDistinctPages || 0) < 1) {
      problems.push(`${label} must require at least one exact sheet or PDF page citation.`);
    }
    [
      ...(testCase.requiredAnswerPatterns || []),
      ...(testCase.forbiddenAnswerPatterns || []),
      ...(testCase.requiredLimitationPatterns || []),
      ...(testCase.expectedEvidence || []).flatMap(group => [
        group.documentNamePattern,
        ...(group.sheetNumberPatterns || []),
        ...(group.pageNumberPatterns || []),
        ...(group.excerptPatterns || []),
      ]),
    ].filter(Boolean).forEach(pattern => {
      try {
        regex(pattern);
      } catch (error) {
        problems.push(`${label} has invalid pattern ${JSON.stringify(pattern)}: ${error.message}`);
      }
    });
    for (const pattern of testCase.requiredAnswerPatterns || []) {
      try {
        if (!regex(pattern).test(text(testCase.expectedAnswer))) {
          problems.push(`${label} expectedAnswer does not satisfy required pattern ${JSON.stringify(pattern)}.`);
        }
      } catch {
        // The invalid-regex problem is reported above.
      }
    }
    for (const pattern of testCase.forbiddenAnswerPatterns || []) {
      try {
        if (regex(pattern).test(text(testCase.expectedAnswer))) {
          problems.push(`${label} expectedAnswer violates forbidden pattern ${JSON.stringify(pattern)}.`);
        }
      } catch {
        // The invalid-regex problem is reported above.
      }
    }
  });
  if (definition.minimumPassingCases > definition.cases.length) {
    problems.push('minimumPassingCases cannot exceed the number of cases.');
  }
  return problems;
}

function evaluateAcceptanceCase(testCase, response, context = {}) {
  const failures = [];
  const answerCorpus = [
    text(response?.answer),
    ...(Array.isArray(response?.facts) ? response.facts.map(fact => text(fact?.statement)) : []),
  ].filter(Boolean).join('\n');
  const limitationsCorpus = Array.isArray(response?.limitations)
    ? response.limitations.map(text).filter(Boolean).join('\n')
    : '';
  const evidence = Array.isArray(response?.supportingEvidence)
    ? response.supportingEvidence.filter(item => item?.sourceType === 'document')
    : [];

  if (text(response?.schemaVersion) !== 'ecos-project-question/2.0') {
    failures.push('Response schema is not ecos-project-question/2.0.');
  }
  if (text(response?.diagnostics?.schemaVersion) !== 'ecos-question-trace/1.0') {
    failures.push('Response is missing the unified diagnostic trace contract.');
  }
  if (!uuid(response?.diagnostics?.traceId) || !uuid(response?.diagnostics?.clientRequestId)) {
    failures.push('Response diagnostic trace identities are invalid.');
  }
  if (!uuid(response?.diagnostics?.evidenceSnapshotId) || !uuid(response?.diagnostics?.evidenceDossierId)) {
    failures.push('Response is missing its sealed evidence snapshot or dossier identity.');
  }
  if (response?.diagnostics?.persisted !== true) {
    failures.push('Response diagnostic trace was not persisted.');
  }
  if (normalize(response?.projectName) !== normalize(context.projectName)) {
    failures.push(`Response project ${JSON.stringify(response?.projectName)} does not match ${context.projectName}.`);
  }
  if (normalize(response?.question) !== normalize(testCase.question)) {
    failures.push('Response question does not match the submitted question.');
  }
  for (const pattern of testCase.requiredAnswerPatterns || []) {
    if (!regex(pattern).test(answerCorpus)) failures.push(`Answer is missing required fact /${pattern}/i.`);
  }
  for (const pattern of testCase.forbiddenAnswerPatterns || []) {
    if (regex(pattern).test(answerCorpus)) failures.push(`Answer contains forbidden claim /${pattern}/i.`);
  }
  for (const pattern of testCase.requiredLimitationPatterns || []) {
    if (!regex(pattern).test(limitationsCorpus)) failures.push(`Limitations are missing /${pattern}/i.`);
  }
  if (!(testCase.allowedAssuranceStatuses || []).includes(response?.assurance?.status)) {
    failures.push(`Assurance status ${JSON.stringify(response?.assurance?.status)} is not allowed.`);
  }
  if (!Number.isInteger(response?.assurance?.verifiedFactCount) || response.assurance.verifiedFactCount < 1) {
    failures.push('ECOS Assurance did not verify any factual statement.');
  }
  const uncitedFacts = (response?.facts || []).filter(fact =>
    fact?.classification === 'fact' && (!Array.isArray(fact?.sourceIds) || fact.sourceIds.length === 0)
  );
  if (uncitedFacts.length > 0) failures.push(`${uncitedFacts.length} factual statement(s) have no source ids.`);
  if (/\b(?:update|schedule|document|memory|project):[a-z0-9][a-z0-9:-]*\b/i.test(answerCorpus)) {
    failures.push('User-facing answer exposes an internal record id.');
  }

  if (evidence.length < testCase.minimumDocumentCitations) {
    failures.push(`Expected ${testCase.minimumDocumentCitations} document citations; received ${evidence.length}.`);
  }
  const distinctDocuments = new Set(evidence.map(item => text(item?.documentCitation?.documentId)).filter(Boolean));
  const distinctSheets = new Set(evidence.map(item => text(item?.documentCitation?.sheetNumber)).filter(Boolean));
  const distinctPages = new Set(evidence.map(item => {
    const citation = item?.documentCitation;
    const pageNumber = positiveInteger(citation?.pageNumber);
    return text(citation?.documentId) && pageNumber
      ? `${text(citation.documentId)}:${pageNumber}`
      : '';
  }).filter(Boolean));
  if (distinctDocuments.size < testCase.minimumDistinctDocuments) {
    failures.push(`Expected ${testCase.minimumDistinctDocuments} distinct document(s); received ${distinctDocuments.size}.`);
  }
  if (distinctSheets.size < testCase.minimumDistinctSheets) {
    failures.push(`Expected ${testCase.minimumDistinctSheets} distinct verified sheet(s); received ${distinctSheets.size}.`);
  }
  const minimumDistinctPages = Number.isInteger(testCase.minimumDistinctPages)
    ? testCase.minimumDistinctPages
    : 0;
  if (distinctPages.size < minimumDistinctPages) {
    failures.push(`Expected ${minimumDistinctPages} distinct exact PDF page(s); received ${distinctPages.size}.`);
  }

  const matchedEvidence = [];
  for (const group of testCase.expectedEvidence || []) {
    const matching = evidence.filter(item => evidenceMatchesGroup(item, group));
    if (matching.length === 0) {
      failures.push(`No citation matched document /${group.documentNamePattern}/i and expected sheet.`);
      continue;
    }
    matchedEvidence.push(...matching);
    const excerptCorpus = matching.map(item => `${text(item?.excerpt)} ${text(item?.documentRegion?.text)}`).join('\n');
    for (const pattern of group.excerptPatterns || []) {
      if (!regex(pattern).test(excerptCorpus)) {
        failures.push(`Proof from /${group.documentNamePattern}/i is missing /${pattern}/i.`);
      }
    }
    if (group.requireBoundedRegion && !matching.some(item => validBoundedRegion(item?.documentRegion))) {
      failures.push(`Proof from /${group.documentNamePattern}/i has no valid bounded drawing region.`);
    }
    if (group.requireHighResolutionCoverage && !matching.some(item =>
      citationHasHighResolutionCoverage(item?.documentCitation, context.pageRows)
    )) {
      failures.push(`Proof from /${group.documentNamePattern}/i is not backed by complete high-resolution coverage.`);
    }
  }

  const dimensionGrades = acceptanceDimensionGrades(failures);
  return Object.freeze({
    id: testCase.id,
    question: testCase.question,
    passed: failures.length === 0,
    failures: Object.freeze(failures),
    answer: text(response?.answer),
    assuranceStatus: text(response?.assurance?.status),
    confidence: text(response?.confidence),
    model: text(response?.model),
    generatedAt: text(response?.generatedAt),
    citations: Object.freeze(uniqueCitations(matchedEvidence.length > 0 ? matchedEvidence : evidence)),
    dimensionGrades,
  });
}

function acceptanceDimensionGrades(failures) {
  const dimensions = ['delivery', 'answer', 'citation', 'proof', 'safety'];
  const grouped = Object.fromEntries(dimensions.map(dimension => [dimension, []]));
  for (const failure of failures) grouped[acceptanceFailureDimension(failure)].push(failure);
  return Object.freeze(Object.fromEntries(dimensions.map(dimension => [
    dimension,
    Object.freeze({
      passed: grouped[dimension].length === 0,
      failures: Object.freeze(grouped[dimension]),
    }),
  ])));
}

function acceptanceFailureDimension(failure) {
  if (/schema|diagnostic|trace identit|project .*does not match|question does not match/i.test(failure)) return 'delivery';
  if (/forbidden claim|uncited|internal record id|limitations are missing/i.test(failure)) return 'safety';
  if (/bounded drawing region|high-resolution|proof from/i.test(failure)) return 'proof';
  if (/document citation|distinct document|distinct verified sheet|distinct exact pdf page|no citation matched/i.test(failure)) return 'citation';
  return 'answer';
}

function evidenceMatchesGroup(item, group) {
  const citation = item?.documentCitation || {};
  if (!regex(group.documentNamePattern).test(text(citation.documentName))) return false;
  const sheetPatterns = group.sheetNumberPatterns || [];
  const pagePatterns = group.pageNumberPatterns || [];
  const sheetMatches = sheetPatterns.length === 0 || sheetPatterns.some(pattern =>
    regex(pattern).test(text(citation.sheetNumber))
  );
  const pageMatches = pagePatterns.length === 0 || pagePatterns.some(pattern =>
    regex(pattern).test(String(positiveInteger(citation.pageNumber) || ''))
  );
  return sheetMatches && pageMatches;
}

function uniqueCitations(evidence) {
  const seen = new Set();
  return evidence.flatMap(item => {
    const citation = item?.documentCitation || {};
    const value = {
      documentId: text(citation.documentId),
      documentName: text(citation.documentName),
      revision: text(citation.revision) || null,
      pageNumber: positiveInteger(citation.pageNumber) || null,
      sheetNumber: text(citation.sheetNumber) || null,
      regionId: text(citation.regionId) || null,
    };
    const key = JSON.stringify(value);
    if (!value.documentId || seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}

function citationHasHighResolutionCoverage(citation, pageRows) {
  const rows = Array.isArray(pageRows) ? pageRows : [];
  const documentId = text(citation?.documentId);
  const pageNumber = positiveInteger(citation?.pageNumber);
  const row = rows.find(item => text(item?.document_id) === documentId && positiveInteger(item?.page_number) === pageNumber);
  return pageRowHasCompleteVisualCoverage(row);
}

function pageRowHasCompleteVisualCoverage(row) {
  return hasCompleteVisualCoverage(row?.visual_coverage, {
    pageNumber: positiveInteger(row?.page_number),
    sourceSha256: canonicalSha256(row?.source_sha256),
    evidenceVersion: VISUAL_EVIDENCE_VERSION,
  });
}

function normalizeAssuredShadowPageRow(rawPage) {
  const page = record(rawPage);
  const finalPage = record(page.final_page_data);
  const assurance = record(page.assurance_result);
  if (
    text(page.state) !== 'assured' ||
    assurance.accepted !== true ||
    nonNegativeInteger(page.unresolved_region_count) !== 0
  ) return [];
  const visualCoverage = record(finalPage.visualCoverage);
  return [{
    document_id: text(page.document_id),
    page_number: positiveInteger(page.page_number),
    sheet_number: text(finalPage.sheetMappingStatus) === 'verified' ? text(finalPage.sheetNumber) : '',
    sheet_mapping_status: text(finalPage.sheetMappingStatus) || 'unverified',
    source_sha256: canonicalSha256(finalPage.sourceSha256),
    index_schema_version: text(visualCoverage.evidenceVersion),
    // Region counts are evidence-item counts, not visual page coverage. Only
    // exact page-bound tile proofs produced by the visual pass may satisfy the
    // readiness and citation gates.
    visual_coverage: visualCoverage,
  }];
}

function hasCompleteVisualCoverage(value, expectedBinding = {}) {
  const coverage = record(value);
  const expectedPageNumber = positiveInteger(expectedBinding.pageNumber);
  const expectedSourceSha256 = canonicalSha256(expectedBinding.sourceSha256);
  const expectedEvidenceVersion = text(expectedBinding.evidenceVersion);
  const requested = nonNegativeInteger(coverage.requestedDeepReadRegionCount);
  const completed = nonNegativeInteger(coverage.completedDeepReadRegionCount);
  const keys = Array.isArray(coverage.completedDeepReadRegionKeys)
    ? coverage.completedDeepReadRegionKeys.map(text)
    : [];
  const proofs = Array.isArray(coverage.completedDeepReadRegionProofs)
    ? coverage.completedDeepReadRegionProofs
    : [];
  const proofKeys = proofs.map(proof => text(proof?.tileKey));
  const allAnalysisRegionIds = proofs.flatMap(proof => Array.isArray(proof?.analysisRegionIds)
    ? proof.analysisRegionIds.map(text)
    : []);
  const failureCodes = Array.isArray(coverage.failureCodes)
    ? coverage.failureCodes.map(text).filter(Boolean)
    : null;
  if (!expectedPageNumber || !expectedSourceSha256 || !expectedEvidenceVersion) return false;
  if (keys.length !== REQUIRED_VISUAL_TILE_KEYS.length || new Set(keys).size !== keys.length) return false;
  if (proofs.length !== REQUIRED_VISUAL_TILE_KEYS.length || new Set(proofKeys).size !== proofKeys.length) return false;
  if (!sameVisualTileKeySet(keys) || !sameVisualTileKeySet(proofKeys)) return false;
  if (new Set(allAnalysisRegionIds).size !== allAnalysisRegionIds.length) return false;
  if (!proofs.every(proof => validVisualTileProof(proof, {
    pageNumber: expectedPageNumber,
    sourceSha256: expectedSourceSha256,
    evidenceVersion: expectedEvidenceVersion,
  }))) return false;
  return coverage.schemaVersion === VISUAL_COVERAGE_SCHEMA_VERSION &&
    positiveInteger(coverage.pageNumber) === expectedPageNumber &&
    canonicalSha256(coverage.sourceSha256) === expectedSourceSha256 &&
    text(coverage.evidenceVersion) === expectedEvidenceVersion &&
    coverage.overviewAnalyzed === true &&
    coverage.coverageComplete === true &&
    requested === REQUIRED_VISUAL_TILE_KEYS.length &&
    completed === REQUIRED_VISUAL_TILE_KEYS.length &&
    failureCodes !== null && failureCodes.length === 0;
}

function validVisualTileProof(value, expectedBinding) {
  const proof = record(value);
  const tileKey = text(proof.tileKey);
  const expectedBounds = REQUIRED_VISUAL_TILE_BOUNDS[tileKey];
  const analysisRegionIds = Array.isArray(proof.analysisRegionIds)
    ? proof.analysisRegionIds.map(text)
    : null;
  const searchableRegionIds = Array.isArray(proof.searchableRegionIds)
    ? proof.searchableRegionIds.map(text)
    : null;
  const analysisRegionCount = nonNegativeInteger(proof.analysisRegionCount);
  const searchableRegionCount = nonNegativeInteger(proof.searchableRegionCount);
  const renderDpi = positiveInteger(proof.renderDpi);
  const renderPixelWidth = positiveInteger(proof.renderPixelWidth);
  const renderPixelHeight = positiveInteger(proof.renderPixelHeight);
  const analysisIds = new Set(analysisRegionIds || []);
  return Boolean(expectedBounds) &&
    proof.state === 'completed' &&
    positiveInteger(proof.pageNumber) === expectedBinding.pageNumber &&
    canonicalSha256(proof.sourceSha256) === expectedBinding.sourceSha256 &&
    text(proof.evidenceVersion) === expectedBinding.evidenceVersion &&
    visualBoundsMatch(proof.bounds, expectedBounds) &&
    text(proof.renderMethod) === 'pymupdf_rgb_png' &&
    text(proof.analysisMethod) === 'tesseract_coordinate_ocr_psm11' &&
    Boolean(canonicalSha256(proof.renderSha256)) &&
    Boolean(canonicalSha256(proof.analysisInputSha256)) &&
    Boolean(canonicalSha256(proof.analysisSha256)) &&
    renderDpi >= 150 && renderDpi <= 300 &&
    renderPixelWidth >= 1 && renderPixelWidth <= 10_000 &&
    renderPixelHeight >= 1 && renderPixelHeight <= 10_000 &&
    analysisRegionIds !== null &&
    analysisRegionIds.length === analysisRegionCount &&
    new Set(analysisRegionIds).size === analysisRegionCount &&
    analysisRegionIds.every(regionId => regionId.startsWith(`visual-tile-${tileKey}-`)) &&
    searchableRegionIds !== null &&
    searchableRegionIds.length === searchableRegionCount &&
    new Set(searchableRegionIds).size === searchableRegionCount &&
    searchableRegionCount <= analysisRegionCount &&
    searchableRegionIds.every(regionId => analysisIds.has(regionId));
}

function sameVisualTileKeySet(keys) {
  const values = new Set(keys);
  return REQUIRED_VISUAL_TILE_KEYS.every(key => values.has(key));
}

function visualBoundsMatch(value, expected) {
  const bounds = record(value);
  return ['x', 'y', 'width', 'height'].every(key => {
    const actual = Number(bounds[key]);
    return Number.isFinite(actual) && Math.abs(actual - expected[key]) <= 1e-9;
  });
}

function validBoundedRegion(region) {
  const x = Number(region?.x);
  const y = Number(region?.y);
  const width = Number(region?.width);
  const height = Number(region?.height);
  return [x, y, width, height].every(Number.isFinite) &&
    x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x + width <= 1.0001 && y + height <= 1.0001 &&
    Boolean(text(region?.id));
}

// The code that answers a customer question lives in the runtime repository
// (Cloud Run agent runtime behind the customer gateway), not in this app repo,
// whose ecos-ask-project function is superseded. Release evidence is bound to
// the answering code, so a change there invalidates a stale live run.
const RUNTIME_CONTRACT_FILES = Object.freeze([
  'supabase/functions/ecos-ask-project/index.ts',
  'supabase/functions/ecos-agent-customer-gateway/index.ts',
  'supabase/functions/ecos-ask-project-candidate/index.ts',
  'workers/ecos-agent-query-runtime/main.ts',
]);
const RUNTIME_SHARED_DIR = 'supabase/functions/_shared';

function runtimeRepoRoot() {
  const configured = text(process.env.ECOS_RUNTIME_REPO);
  const resolved = configured ? path.resolve(repoRoot, configured) : path.resolve(repoRoot, '..', 'runtime');
  if (!fs.existsSync(path.join(resolved, RUNTIME_CONTRACT_FILES[1]))) {
    throw new Error(
      `The Ask ECOS runtime repository was not found at ${resolved}. ` +
      'Set ECOS_RUNTIME_REPO to the runtime checkout; release evidence must bind to the answering code.',
    );
  }
  return resolved;
}

function runtimeContractFiles(root = runtimeRepoRoot()) {
  const shared = fs.readdirSync(path.join(root, RUNTIME_SHARED_DIR))
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
    .map(name => `${RUNTIME_SHARED_DIR}/${name}`);
  return [...RUNTIME_CONTRACT_FILES, ...shared];
}

/** The package fingerprint the customer gateway pins for the deployed runtime. */
function deployedRuntimePackageSha256(root = runtimeRepoRoot()) {
  const shim = fs.readFileSync(path.join(root, RUNTIME_CONTRACT_FILES[0]), 'utf8');
  const match = /expectedPackageSha256:\s*["']([a-f0-9]{64})["']/i.exec(shim);
  if (!match) throw new Error('The runtime ecos-ask-project shim does not pin an expectedPackageSha256.');
  return match[1];
}

function acceptanceContractHash(selectedDefinitionPath = definitionPath) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of CONTRACT_FILES) {
    const absolutePath = path.join(repoRoot, relativePath);
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(absolutePath));
    hash.update('\0');
  }
  const runtimeRoot = runtimeRepoRoot();
  for (const relativePath of runtimeContractFiles(runtimeRoot)) {
    hash.update(`runtime:${relativePath}`);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(runtimeRoot, relativePath)));
    hash.update('\0');
  }
  const absoluteDefinitionPath = path.resolve(selectedDefinitionPath);
  if (absoluteDefinitionPath !== defaultDefinitionPath) {
    hash.update('selected-acceptance-definition');
    hash.update('\0');
    hash.update(path.relative(repoRoot, absoluteDefinitionPath));
    hash.update('\0');
    hash.update(fs.readFileSync(absoluteDefinitionPath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function validateLiveAcceptanceResult(result, definition, now = new Date()) {
  const failures = [];
  if (result?.schemaVersion !== LIVE_RESULT_SCHEMA_VERSION) failures.push('Live result schema is invalid.');
  if (result?.definitionSchemaVersion !== definition.schemaVersion) failures.push('Definition schema changed after the live run.');
  if (normalize(result?.projectName) !== normalize(definition.projectName)) failures.push('Live result is for the wrong project.');
  if (result?.acceptanceContractSha256 !== acceptanceContractHash()) failures.push('Ask ECOS code or acceptance cases changed after the live run.');
  if (result?.runtimePackageSha256 !== deployedRuntimePackageSha256()) {
    failures.push('The deployed Ask ECOS runtime package changed after the live run.');
  }
  const completedAt = Date.parse(result?.completedAt || '');
  const maximumAgeMs = Number(definition.evidenceMaximumAgeHours) * 60 * 60 * 1000;
  if (!Number.isFinite(completedAt)) failures.push('Live result has no valid completion time.');
  else if (now.getTime() - completedAt > maximumAgeMs || completedAt > now.getTime() + 60_000) {
    failures.push(`Live result is older than ${definition.evidenceMaximumAgeHours} hours or is future-dated.`);
  }
  const cases = Array.isArray(result?.cases) ? result.cases : [];
  if (cases.length !== definition.cases.length) failures.push('Live result does not contain every approved case.');
  const expectedIds = definition.cases.map(item => item.id).sort();
  const resultIds = cases.map(item => item?.id).filter(Boolean).sort();
  if (JSON.stringify(resultIds) !== JSON.stringify(expectedIds)) failures.push('Live result case ids do not match the approved benchmark.');
  const passed = cases.filter(item => item?.passed === true).length;
  if (passed < definition.minimumPassingCases) failures.push(`Only ${passed} cases passed; at least ${definition.minimumPassingCases} are required.`);
  if (cases.length === 0 || passed / cases.length !== definition.requiredPassRate) failures.push('Ask ECOS did not achieve the required 100% pass rate.');
  if (result?.summary?.failed !== 0 || result?.summary?.passRate !== 1) failures.push('Live result summary is not 100% passing.');
  if (result?.documentReadiness?.passed !== true) failures.push('Required current drawing pages were not fully ready.');
  const boundary = record(result?.executionBoundary);
  if (result?.indexMode !== 'live') failures.push('Release evidence must come from live published evidence.');
  if (boundary.mode !== 'customer_path') failures.push('Release evidence did not use the customer path.');
  if (boundary.functionSlug !== 'ecos-ask-project') failures.push('Release evidence used the wrong function.');
  if (boundary.requestTransport !== 'supabase_functions_invoke') {
    failures.push('Release evidence did not use the app Supabase Functions transport.');
  }
  if (boundary.invocationMode !== 'app_ui') {
    failures.push('Release evidence was not submitted through the real application UI.');
  }
  if (boundary.authentication !== 'signed_in_user') failures.push('Release evidence did not use signed-in user authentication.');
  if (boundary.publicationMode !== 'live' || boundary.validationMode !== null) {
    failures.push('Release evidence used a non-customer publication or validation mode.');
  }
  if (boundary.serviceWorkerTokenUsed !== false) failures.push('Release evidence used a service-worker token.');
  if (!['web', 'iphone', 'ipad'].includes(boundary.clientSurface)) {
    failures.push('Release evidence did not identify a real supported customer surface.');
  }
  if (boundary.appInvocationBoundary !== 'services/ECOSProjectQuestion.askECOSProjectQuestion') {
    failures.push('Release evidence did not use the app Ask ECOS invocation boundary.');
  }
  return failures;
}

function regex(pattern) {
  return new RegExp(pattern, 'ims');
}

function normalize(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nonEmptyTextArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item => text(item));
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function uuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function canonicalSha256(value) {
  const candidate = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(candidate) ? candidate : '';
}

function configuredRepositoryPath(environmentName, fallbackPath) {
  const configured = text(process.env[environmentName]);
  if (!configured) return fallbackPath;
  const resolved = path.resolve(repoRoot, configured);
  const relative = path.relative(repoRoot, resolved);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) return resolved;
  throw new Error(`${environmentName} must point to a file inside the repository.`);
}

module.exports = {
  CONTRACT_FILES,
  RUNTIME_CONTRACT_FILES,
  deployedRuntimePackageSha256,
  runtimeContractFiles,
  runtimeRepoRoot,
  LIVE_RESULT_SCHEMA_VERSION,
  REQUIRED_VISUAL_TILE_BOUNDS,
  REQUIRED_VISUAL_TILE_KEYS,
  VISUAL_COVERAGE_SCHEMA_VERSION,
  VISUAL_EVIDENCE_VERSION,
  acceptanceContractHash,
  acceptanceDimensionGrades,
  acceptanceFailureDimension,
  definitionPath,
  evaluateAcceptanceCase,
  hasCompleteVisualCoverage,
  loadAcceptanceDefinition,
  normalizeAssuredShadowPageRow,
  repoRoot,
  resultPath,
  pageRowHasCompleteVisualCoverage,
  validateAcceptanceDefinition,
  validateLiveAcceptanceResult,
  validBoundedRegion,
};
