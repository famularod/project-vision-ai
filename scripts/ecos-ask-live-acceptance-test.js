#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  authoritativeReferenceDocumentId,
  documentMatchesProject,
  loadDocumentReadiness,
  resolveProject,
  shadowJobMatchesDocument,
  shadowPageMatchesJob,
} = require('./ecos-ask-live-acceptance');
const {
  CONTRACT_DIRECTORIES,
  CONTRACT_FILES,
  LIVE_RESULT_SCHEMA_VERSION,
  REQUIRED_VISUAL_TILE_BOUNDS,
  VISUAL_COVERAGE_SCHEMA_VERSION,
  VISUAL_EVIDENCE_VERSION,
  acceptanceContractFiles,
  acceptanceContractHash,
  evaluateAcceptanceCase,
  loadAcceptanceDefinition,
  normalizeAssuredShadowPageRow,
  pageRowHasCompleteVisualCoverage,
  validateAcceptanceDefinition,
  validateLiveAcceptanceResult,
} = require('./ecos-ask-live-acceptance-lib');

const SOURCE_SHA = 'a'.repeat(64);

assert.equal(authoritativeReferenceDocumentId({
  id: 'drawing-durable-a',
  document_data: { id: 'drawing-durable-a' },
}), 'drawing-durable-a');
assert.equal(authoritativeReferenceDocumentId({
  id: 'drawing-durable-a',
  document_data: {},
}), 'drawing-durable-a');
assert.equal(authoritativeReferenceDocumentId({
  id: 'drawing-durable-a',
  document_data: { id: 'drawing-forged-b' },
}), null);
assert.equal(authoritativeReferenceDocumentId({
  document_data: { id: 'drawing-forged-b' },
}), null);
assert.equal(authoritativeReferenceDocumentId({
  id: 'drawing-durable-a',
  document_data: { id: 42 },
}), null, 'A supplied malformed embedded id must not be treated as omitted.');
assert.equal(authoritativeReferenceDocumentId({
  id: 'drawing-durable-a',
  document_data: { id: ' drawing-durable-a ' },
}), null, 'A supplied noncanonical embedded id must fail closed.');

assert(CONTRACT_FILES.includes('scripts/ecos-ask-live-acceptance.js'));
assert(CONTRACT_FILES.includes('scripts/ecos-ask-2321-live-acceptance.js'));
assert(CONTRACT_FILES.includes('scripts/ecos-ask-2321-live-evidence-gate.js'));
assert(CONTRACT_FILES.includes('scripts/ecos-ask-live-acceptance-lib.js'));
assert(CONTRACT_FILES.includes('scripts/ecos-ask-live-evidence-gate.js'));
assert(CONTRACT_FILES.includes('deno.lock'));
assert(CONTRACT_FILES.includes('package.json'));
assert(CONTRACT_FILES.includes('scripts/jarvis-release-gate.js'));
assert(CONTRACT_DIRECTORIES.some(directory => directory.path === 'supabase/migrations'));
assert(CONTRACT_DIRECTORIES.some(directory => directory.path === 'workers/ecos-indexer/ecos_indexer'));
const acceptanceFiles = acceptanceContractFiles();
for (const requiredFile of [
  'supabase/migrations/20260809193726_ecos_project_evidence_exact_project_binding.sql',
  'supabase/migrations/20260809195802_ecos_pdf_annotation_rendered_corroboration.sql',
  'supabase/migrations/20260809201435_ecos_drawing_provider_attempt_reservations.sql',
  'supabase/migrations/20260809222329_ecos_reference_document_authority_keys_guard.sql',
  'workers/ecos-indexer/ecos_indexer/assurance.py',
  'workers/ecos-indexer/ecos_indexer/document_structure.py',
  'workers/ecos-indexer/ecos_indexer/extraction.py',
  'workers/ecos-indexer/ecos_indexer/sheet_mapping.py',
  'workers/ecos-indexer/ecos_indexer/structured_table_pipeline.py',
  'workers/ecos-indexer/ecos_indexer/structured_tables.py',
  'workers/ecos-indexer/ecos_indexer/visual.py',
  'workers/ecos-indexer/ecos_indexer/worker.py',
]) assert(acceptanceFiles.includes(requiredFile), `Acceptance contract must include ${requiredFile}.`);
assert.deepEqual(acceptanceFiles, [...acceptanceFiles].sort());
assert.equal(new Set(acceptanceFiles).size, acceptanceFiles.length);
const fixed2321GateSource = fs.readFileSync(
  path.join(__dirname, 'ecos-ask-2321-live-evidence-gate.js'),
  'utf8',
);
assert.doesNotMatch(
  fixed2321GateSource,
  /process\.env\.ECOS_LIVE_ACCEPTANCE_(?:DEFINITION|RESULT)/,
  'The 2321 release gate must ignore hostile ambient definition/result overrides.',
);
assert.match(fixed2321GateSource, /ask-ecos-2321-real-world-cases\.json/);
assert.match(fixed2321GateSource, /ecos-ask-2321-live-acceptance\.json/);

const EXACT_PROJECT_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const OLD_PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
assert.equal(documentMatchesProject({
  projectId: EXACT_PROJECT_ID,
  projectName: 'Shared Project',
}, { id: EXACT_PROJECT_ID, name: 'Shared Project' }), true);
assert.equal(documentMatchesProject({
  projectId: OLD_PROJECT_ID,
  projectName: 'Shared Project',
  projectNames: ['Shared Project'],
}, { id: EXACT_PROJECT_ID, name: 'Shared Project' }), false);

const exactShadowDocument = {
  id: 'drawing-durable-a',
  organizationId: 'org-a',
  projectId: EXACT_PROJECT_ID,
  sourceOwnerId: SOURCE_OWNER_ID,
  currentSourceSha256: SOURCE_SHA,
  revision: 'Rev B',
};
const exactShadowJob = {
  id: 'job-current-b',
  organization_id: 'org-a',
  project_id: EXACT_PROJECT_ID,
  document_id: 'drawing-durable-a',
  source_owner_id: SOURCE_OWNER_ID,
  source_sha256: SOURCE_SHA,
  source_revision: 'Rev B',
  mode: 'shadow',
  state: 'ready',
  committed_evidence_version: 'ecos-hosted-evidence/1.3',
};
assert.equal(shadowJobMatchesDocument(exactShadowJob, exactShadowDocument), true);
assert.equal(shadowJobMatchesDocument({
  ...exactShadowJob,
  id: 'job-old-a',
  project_id: OLD_PROJECT_ID,
  source_revision: 'Rev A',
}, exactShadowDocument), false);
assert.equal(shadowJobMatchesDocument({
  ...exactShadowJob,
  id: 'job-foreign-org',
  organization_id: 'org-b',
}, exactShadowDocument), false);
const exactShadowPage = {
  job_id: exactShadowJob.id,
  organization_id: exactShadowJob.organization_id,
  project_id: exactShadowJob.project_id,
  document_id: exactShadowDocument.id,
  source_sha256: SOURCE_SHA,
  page_number: 1,
  state: 'assured',
  final_page_data: { sourceSha256: SOURCE_SHA },
  assurance_result: { accepted: true, evidenceVersion: 'ecos-hosted-evidence/1.3' },
  unresolved_region_count: 0,
};
assert.equal(shadowPageMatchesJob(exactShadowPage, exactShadowJob, exactShadowDocument), true);
assert.equal(shadowPageMatchesJob({
  ...exactShadowPage,
  project_id: OLD_PROJECT_ID,
}, exactShadowJob, exactShadowDocument), false);

function visualCoverageFixture(pageNumber = 6, sourceSha256 = SOURCE_SHA) {
  const proofs = Object.entries(REQUIRED_VISUAL_TILE_BOUNDS).map(([tileKey, bounds], index) => {
    const regionId = `visual-tile-${tileKey}-word-${index}`;
    return {
      tileKey,
      bounds: { ...bounds },
      state: 'completed',
      pageNumber,
      sourceSha256,
      evidenceVersion: VISUAL_EVIDENCE_VERSION,
      renderMethod: 'pymupdf_rgb_png',
      analysisMethod: 'tesseract_coordinate_ocr_psm11',
      renderDpi: 200,
      renderPixelWidth: 2400,
      renderPixelHeight: 1800,
      renderSha256: '1'.repeat(64),
      analysisInputSha256: '2'.repeat(64),
      analysisSha256: '3'.repeat(64),
      analysisRegionCount: 1,
      analysisRegionIds: [regionId],
      searchableRegionCount: 1,
      searchableRegionIds: [regionId],
    };
  });
  return {
    schemaVersion: VISUAL_COVERAGE_SCHEMA_VERSION,
    evidenceVersion: VISUAL_EVIDENCE_VERSION,
    sourceSha256,
    pageNumber,
    overviewAnalyzed: true,
    coverageComplete: true,
    requestedDeepReadRegionCount: proofs.length,
    completedDeepReadRegionCount: proofs.length,
    completedDeepReadRegionKeys: proofs.map(proof => proof.tileKey),
    completedDeepReadRegionProofs: proofs,
    failureCodes: [],
  };
}

const definition = loadAcceptanceDefinition();
assert.equal(definition.productionHost, 'xdytqlpsqsseoeuxgzre.supabase.co');
assert.equal(definition.requiredIndexMode, 'live');
assert.equal(validateAcceptanceDefinition(definition).length, 0);
assert.equal(definition.projectId, EXACT_PROJECT_ID);
assert(definition.cases.length >= 10, 'The production benchmark must contain at least 10 cases.');
assert.equal(definition.requiredPassRate, 1, 'The production benchmark must require 100%.');
assert(
  definition.cases.some(testCase => testCase.minimumDistinctDocuments >= 2),
  'The benchmark must include a multi-document evidence question.',
);
assert(
  definition.cases.some(testCase => testCase.minimumDistinctSheets >= 2),
  'The benchmark must include a multi-sheet evidence question.',
);
assert(
  definition.cases.some(testCase => testCase.requiredLimitationPatterns?.length > 0),
  'The benchmark must test drawing-versus-installed-condition limits.',
);
const canopyFootprintCase = definition.cases.find(testCase => testCase.id === 'canopy-a-plan-footprint');
assert.equal(canopyFootprintCase.minimumDistinctSheets, 0);
assert.equal(canopyFootprintCase.minimumDistinctPages, 1);
assert.deepEqual(canopyFootprintCase.expectedEvidence[0].pageNumberPatterns, ['^4$']);
assert.deepEqual(canopyFootprintCase.expectedEvidence[0].sheetNumberPatterns, []);

const testCase = definition.cases.find(item => item.id === 'north-lot-pcc-design-thickness');
const pageRows = [{
  document_id: 'civil-document',
  project_id: EXACT_PROJECT_ID,
  page_number: 6,
  sheet_number: 'C6',
  sheet_mapping_status: 'verified',
  source_sha256: SOURCE_SHA,
  source_revision: '1',
  evidence_version: VISUAL_EVIDENCE_VERSION,
  regions: [{
    id: 'note-1',
    label: 'Construction note 1',
    text: 'CONSTRUCT 6.0" THICK PCC PAVING',
    x: 0.61,
    y: 0.13,
    width: 0.16,
    height: 0.04,
    source: 'vision',
  }],
  visual_coverage: visualCoverageFixture(),
}];
const response = {
  schemaVersion: 'ecos-project-question/1.0',
  projectId: EXACT_PROJECT_ID,
  projectName: definition.projectName,
  question: testCase.question,
  answer: 'The current civil drawing specifies 6.0 inches of PCC paving at the North Lot.',
  confidence: 'high',
  facts: [{
    id: 'fact-1',
    statement: 'The design specifies 6.0 inches of PCC paving.',
    classification: 'fact',
    sourceIds: ['document:civil-document:6:note-1'],
  }],
  limitations: [],
  conflicts: [],
  suggestedQuestions: [],
  supportingEvidence: [{
    sourceType: 'document',
    recordId: 'civil-document',
    summary: 'Civil North Lot construction note',
    excerpt: 'CONSTRUCT 6.0" THICK PCC PAVING',
    documentCitation: {
      documentId: 'civil-document',
      projectId: EXACT_PROJECT_ID,
      sourceSha256: SOURCE_SHA,
      evidenceVersion: VISUAL_EVIDENCE_VERSION,
      documentName: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
      revision: '1',
      pageNumber: 6,
      sheetNumber: 'C6',
      regionId: 'note-1',
      label: 'Civil, Sheet C6',
    },
    documentRegion: {
      id: 'note-1',
      label: 'Construction note 1',
      text: 'CONSTRUCT 6.0" THICK PCC PAVING',
      areaNames: ['North Lot'],
      x: 0.61,
      y: 0.13,
      width: 0.16,
      height: 0.04,
      confidence: 0.98,
      source: 'vision',
    },
  }],
  assurance: {
    status: 'verified',
    checkedSourceCount: 1,
    verifiedFactCount: 1,
    rejectedFactCount: 0,
    message: 'Verified.',
  },
  generatedAt: '2026-08-06T12:00:00.000Z',
  model: 'production-model',
};

const passing = evaluateAcceptanceCase(testCase, response, {
  projectId: EXACT_PROJECT_ID,
  projectName: definition.projectName,
  currentDocuments: [{
    id: 'civil-document',
    name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
    projectId: EXACT_PROJECT_ID,
    currentSourceSha256: SOURCE_SHA,
    revision: '1',
  }],
  pageRows,
});
assert.equal(passing.passed, true, passing.failures.join('\n'));

for (const [label, mutatedResponse] of [
  ['response project id', { ...response, projectId: OLD_PROJECT_ID }],
  ['citation project id', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      documentCitation: { ...response.supportingEvidence[0].documentCitation, projectId: OLD_PROJECT_ID },
    }],
  }],
  ['citation source checksum', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      documentCitation: { ...response.supportingEvidence[0].documentCitation, sourceSha256: 'b'.repeat(64) },
    }],
  }],
  ['citation revision', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      documentCitation: { ...response.supportingEvidence[0].documentCitation, revision: '0' },
    }],
  }],
  ['citation evidence version', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      documentCitation: { ...response.supportingEvidence[0].documentCitation, evidenceVersion: 'legacy' },
    }],
  }],
  ['citation page', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      documentCitation: { ...response.supportingEvidence[0].documentCitation, pageNumber: 999 },
    }],
  }],
  ['citation sheet label', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      documentCitation: { ...response.supportingEvidence[0].documentCitation, sheetNumber: 'C7' },
    }],
  }],
  ['citation document name', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      documentCitation: { ...response.supportingEvidence[0].documentCitation, documentName: 'Forged Civil Drawing' },
    }],
  }],
  ['citation region id', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      documentRegion: { ...response.supportingEvidence[0].documentRegion, id: 'forged-note' },
    }],
  }],
  ['citation region bounds', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      documentRegion: { ...response.supportingEvidence[0].documentRegion, x: 0.1 },
    }],
  }],
  ['citation region text', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      excerpt: 'PROVIDE A 12 INCH SLAB',
      documentRegion: {
        ...response.supportingEvidence[0].documentRegion,
        text: 'PROVIDE A 12 INCH SLAB',
      },
    }],
  }],
  ['citation critical value substitution', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      excerpt: 'CONSTRUCT 4.0" THICK PCC PAVING',
      documentRegion: {
        ...response.supportingEvidence[0].documentRegion,
        text: 'CONSTRUCT 4.0" THICK PCC PAVING',
      },
    }],
  }],
  ['citation region source', {
    ...response,
    supportingEvidence: [{
      ...response.supportingEvidence[0],
      documentRegion: { ...response.supportingEvidence[0].documentRegion, source: 'ocr' },
    }],
  }],
  ['response question punctuation', { ...response, question: `${testCase.question}!` }],
  ['response question case', { ...response, question: testCase.question.toUpperCase() }],
]) {
  const result = evaluateAcceptanceCase(testCase, mutatedResponse, {
    projectId: EXACT_PROJECT_ID,
    projectName: definition.projectName,
    currentDocuments: [{
      id: 'civil-document',
      name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
      projectId: EXACT_PROJECT_ID,
      currentSourceSha256: SOURCE_SHA,
      revision: '1',
    }],
    pageRows,
  });
  assert.equal(result.passed, false, `${label} must invalidate the acceptance receipt.`);
}

const pageContextPrefix = 'DRAWING PAGE CONTEXT: Sheet C6, current revision. ';
const prefixedRegionResponse = {
  ...response,
  supportingEvidence: [{
    ...response.supportingEvidence[0],
    excerpt: `${pageContextPrefix}${response.supportingEvidence[0].excerpt}`,
    documentRegion: {
      ...response.supportingEvidence[0].documentRegion,
      text: `${pageContextPrefix}${response.supportingEvidence[0].documentRegion.text}`,
    },
  }],
};
const prefixedRegionResult = evaluateAcceptanceCase(testCase, prefixedRegionResponse, {
  projectId: EXACT_PROJECT_ID,
  projectName: definition.projectName,
  currentDocuments: [{
    id: 'civil-document',
    name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
    projectId: EXACT_PROJECT_ID,
    currentSourceSha256: SOURCE_SHA,
    revision: '1',
  }],
  pageRows,
});
assert.equal(prefixedRegionResult.passed, true, prefixedRegionResult.failures.join('\n'));

const syntheticPageRows = [{
  ...pageRows[0],
  regions: [
    pageRows[0].regions[0],
    {
      id: 'north-lot-label',
      label: 'North Lot detail',
      text: 'NORTH LOT DETAIL',
      x: 0.78,
      y: 0.13,
      width: 0.1,
      height: 0.04,
      source: 'ocr',
    },
  ],
}];
const syntheticRegionResponse = {
  ...response,
  supportingEvidence: [{
    ...response.supportingEvidence[0],
    excerpt: 'DRAWING PAGE CONTEXT CONSTRUCT 6.0" THICK PCC PAVING NORTH LOT DETAIL',
    documentCitation: {
      ...response.supportingEvidence[0].documentCitation,
      regionId: 'cell-0-0-0',
    },
    documentRegion: {
      ...response.supportingEvidence[0].documentRegion,
      id: 'cell-0-0-0',
      text: 'CONSTRUCT 6.0" THICK PCC PAVING NORTH LOT DETAIL',
      x: 0.61,
      y: 0.13,
      width: 0.27,
      height: 0.04,
      source: 'vision',
      rawSource: 'mixed',
      sourceRegionIds: ['note-1', 'north-lot-label'],
    },
  }],
};
const syntheticRegionContext = {
  projectId: EXACT_PROJECT_ID,
  projectName: definition.projectName,
  currentDocuments: [{
    id: 'civil-document',
    name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
    projectId: EXACT_PROJECT_ID,
    currentSourceSha256: SOURCE_SHA,
    revision: '1',
  }],
  pageRows: syntheticPageRows,
};
const syntheticRegionResult = evaluateAcceptanceCase(
  testCase,
  syntheticRegionResponse,
  syntheticRegionContext,
);
assert.equal(syntheticRegionResult.passed, true, syntheticRegionResult.failures.join('\n'));
const forgedSyntheticSupport = evaluateAcceptanceCase(testCase, {
  ...syntheticRegionResponse,
  supportingEvidence: [{
    ...syntheticRegionResponse.supportingEvidence[0],
    documentRegion: {
      ...syntheticRegionResponse.supportingEvidence[0].documentRegion,
      sourceRegionIds: ['note-1', 'forged-region'],
    },
  }],
}, syntheticRegionContext);
assert.equal(forgedSyntheticSupport.passed, false);
assert(forgedSyntheticSupport.failures.some(item => item.includes('synthetic-region')));

const ambiguousSyntheticCell = evaluateAcceptanceCase(
  testCase,
  syntheticRegionResponse,
  {
    ...syntheticRegionContext,
    pageRows: [{
      ...syntheticPageRows[0],
      regions: [
        ...syntheticPageRows[0].regions,
        { ...syntheticPageRows[0].regions[0], id: 'cell-0-0-0' },
        { ...syntheticPageRows[0].regions[1], id: 'cell-0-0-0' },
      ],
    }],
  },
);
assert.equal(ambiguousSyntheticCell.passed, false);
assert(ambiguousSyntheticCell.failures.some(item => item.includes('ambiguous authoritative region')));

const unknownAuthoritativeSource = evaluateAcceptanceCase(testCase, response, {
  projectId: EXACT_PROJECT_ID,
  projectName: definition.projectName,
  currentDocuments: [{
    id: 'civil-document',
    name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
    projectId: EXACT_PROJECT_ID,
    currentSourceSha256: SOURCE_SHA,
    revision: '1',
  }],
  pageRows: [{
    ...pageRows[0],
    regions: [{ ...pageRows[0].regions[0], source: 'manual' }],
  }],
});
assert.equal(unknownAuthoritativeSource.passed, false);
assert(unknownAuthoritativeSource.failures.some(item => item.includes('region source')));

const countersOnlyShadowRow = normalizeAssuredShadowPageRow({
  document_id: 'civil-document',
  page_number: 6,
  state: 'assured',
  unresolved_region_count: 0,
  assurance_result: { accepted: true },
  final_page_data: {
    pageNumber: 6,
    sourceSha256: SOURCE_SHA,
    sheetNumber: 'C6',
    sheetMappingStatus: 'verified',
    regions: Array.from({ length: 6 }, (_, index) => ({ id: `fact-${index}` })),
  },
})[0];
assert.deepEqual(countersOnlyShadowRow.visual_coverage, {});
assert.equal(
  pageRowHasCompleteVisualCoverage(countersOnlyShadowRow),
  false,
  'Assured region counts must not be converted into visual coverage.',
);

const provenShadowRow = normalizeAssuredShadowPageRow({
  document_id: 'civil-document',
  page_number: 6,
  state: 'assured',
  unresolved_region_count: 0,
  assurance_result: { accepted: true },
  final_page_data: {
    pageNumber: 6,
    sourceSha256: SOURCE_SHA,
    sheetNumber: 'C6',
    sheetMappingStatus: 'verified',
    visualCoverage: visualCoverageFixture(),
  },
})[0];
assert.equal(pageRowHasCompleteVisualCoverage(provenShadowRow), true);

const incompleteCoverage = evaluateAcceptanceCase(testCase, response, {
  projectId: EXACT_PROJECT_ID,
  projectName: definition.projectName,
  currentDocuments: [{
    id: 'civil-document',
    name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
    projectId: EXACT_PROJECT_ID,
    currentSourceSha256: SOURCE_SHA,
    revision: '1',
  }],
  pageRows: [{ ...pageRows[0], visual_coverage: { ...pageRows[0].visual_coverage, coverageComplete: false } }],
});
assert.equal(incompleteCoverage.passed, false);
assert(incompleteCoverage.failures.some(item => item.includes('high-resolution')));

const leakedIdentifier = evaluateAcceptanceCase(testCase, {
  ...response,
  answer: `${response.answer} [update:mrcu2abk-63b55h5l]`,
}, {
  projectId: EXACT_PROJECT_ID,
  projectName: definition.projectName,
  currentDocuments: [{
    id: 'civil-document',
    name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
    projectId: EXACT_PROJECT_ID,
    currentSourceSha256: SOURCE_SHA,
    revision: '1',
  }],
  pageRows,
});
assert.equal(leakedIdentifier.passed, false);
assert(leakedIdentifier.failures.some(item => item.includes('internal record id')));

const now = new Date('2026-08-06T13:00:00.000Z');
const resultValidationDefinition = {
  ...definition,
  minimumPassingCases: 1,
  cases: [testCase],
};
const validLiveResult = {
  schemaVersion: LIVE_RESULT_SCHEMA_VERSION,
  definitionSchemaVersion: resultValidationDefinition.schemaVersion,
  acceptanceContractSha256: acceptanceContractHash(),
  completedAt: '2026-08-06T12:30:00.000Z',
  productionHost: resultValidationDefinition.productionHost,
  indexMode: 'live',
  projectId: EXACT_PROJECT_ID,
  projectName: resultValidationDefinition.projectName,
  documentReadiness: {
    passed: true,
    checkedDocuments: [{
      id: 'civil-document',
      name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
      projectId: EXACT_PROJECT_ID,
      revision: '1',
      sourceSha256: SOURCE_SHA,
      evidenceVersion: VISUAL_EVIDENCE_VERSION,
      sourcePageCount: 6,
      indexedPageCount: 6,
      indexMode: 'live',
    }],
  },
  summary: { total: 1, passed: 1, failed: 0, passRate: 1 },
  cases: [{
    id: testCase.id,
    question: testCase.question,
    passed: true,
    failures: [],
    citations: passing.citations,
  }],
};
assert.deepEqual(validateLiveAcceptanceResult(validLiveResult, resultValidationDefinition, now), []);
const staleFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  completedAt: '2026-08-04T12:30:00.000Z',
}, resultValidationDefinition, now);
assert(staleFailures.some(item => item.includes('older than')));
const wrongProjectResultFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  projectId: OLD_PROJECT_ID,
}, resultValidationDefinition, now);
assert(wrongProjectResultFailures.some(item => item.includes('immutable project id')));
const shadowResultFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  indexMode: 'shadow',
}, resultValidationDefinition, now);
assert(shadowResultFailures.some(item => item.includes('live index mode')));
const foreignHostFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  productionHost: 'foreign-project.supabase.co',
}, resultValidationDefinition, now);
assert(foreignHostFailures.some(item => item.includes('wrong production host')));
const wrongStoredQuestionFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  cases: [{ ...validLiveResult.cases[0], question: `${testCase.question}!` }],
}, resultValidationDefinition, now);
assert(wrongStoredQuestionFailures.some(item => item.includes('question text')));
const duplicateDocumentFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  documentReadiness: {
    ...validLiveResult.documentReadiness,
    checkedDocuments: [
      ...validLiveResult.documentReadiness.checkedDocuments,
      { ...validLiveResult.documentReadiness.checkedDocuments[0] },
    ],
  },
}, resultValidationDefinition, now);
assert(duplicateDocumentFailures.some(item => item.includes('duplicate')));
const staleCitationFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  cases: [{
    ...validLiveResult.cases[0],
    citations: [{ ...validLiveResult.cases[0].citations[0], revision: 'stale revision' }],
  }],
}, resultValidationDefinition, now);
assert(staleCitationFailures.some(item => item.includes('not bound')));
const emptyCaseCitationsFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  cases: [{ ...validLiveResult.cases[0], citations: [] }],
}, resultValidationDefinition, now);
assert(emptyCaseCitationsFailures.some(item => item.includes('required citations')));
const duplicateCaseCitationsFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  cases: [{
    ...validLiveResult.cases[0],
    citations: [
      validLiveResult.cases[0].citations[0],
      { ...validLiveResult.cases[0].citations[0] },
    ],
  }],
}, resultValidationDefinition, now);
assert(duplicateCaseCitationsFailures.some(item => item.includes('duplicate citation')));
const dishonestSummaryFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  summary: { total: 15, passed: 15, failed: 0, passRate: 1 },
}, resultValidationDefinition, now);
assert(dishonestSummaryFailures.some(item => item.includes('summary')));

async function verifyHostedReadinessNeverReadsLegacyPages() {
  const projectFilters = [];
  const projectLookupClient = returnedProject => ({
    from(table) {
      assert.equal(table, 'projects');
      const chain = {
        select: () => chain,
        eq: (column, value) => {
          projectFilters.push([column, value]);
          return chain;
        },
        limit: async () => ({ data: [returnedProject], error: null }),
      };
      return chain;
    },
  });
  await assert.rejects(
    resolveProject(
      projectLookupClient({ id: OLD_PROJECT_ID, name: definition.projectName }),
      EXACT_PROJECT_ID,
      definition.projectName,
    ),
    /different immutable id/,
  );
  const exactProject = await resolveProject(
    projectLookupClient({ id: EXACT_PROJECT_ID, name: definition.projectName }),
    EXACT_PROJECT_ID,
    definition.projectName,
  );
  assert.deepEqual(exactProject, { id: EXACT_PROJECT_ID, name: definition.projectName });
  assert(projectFilters.some(([column, value]) => column === 'id' && value === EXACT_PROJECT_ID));

  const referenceDocument = {
    id: 'civil-document',
    owner_id: SOURCE_OWNER_ID,
    name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
    category: 'Drawing',
    document_data: {
      id: 'civil-document',
      name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
      category: 'Drawing',
      projectId: EXACT_PROJECT_ID,
      organizationId: 'org-a',
      isCurrent: true,
      drawingStatus: 'For Construction',
      drawingRevision: '1',
      sourcePageCount: 1,
      contentSha256: SOURCE_SHA,
    },
  };
  const status = {
    document_id: 'civil-document',
    project_id: EXACT_PROJECT_ID,
    state: 'ready',
    customer_status: 'Ready for ECOS',
    source_page_count: 1,
    committed_evidence_version: VISUAL_EVIDENCE_VERSION,
  };
  const exactPage = {
    document_id: 'civil-document',
    page_number: 1,
    sheet_number: 'C6',
    sheet_mapping_status: 'verified',
    visual_coverage: {},
    assurance_result: { accepted: true, evidenceVersion: VISUAL_EVIDENCE_VERSION },
  };
  const definitionFixture = {
    cases: [{
      expectedEvidence: [{
        documentNamePattern: '2375.*CIVIL',
        sheetNumberPatterns: ['^C6$'],
        pageNumberPatterns: ['^1$'],
        requireHighResolutionCoverage: false,
      }],
    }],
  };

  async function load(hostedPages) {
    const fromCalls = [];
    const client = {
      from(table) {
        fromCalls.push(table);
        const chain = {
          select: () => chain,
          limit: async () => ({
            data: table === 'reference_documents'
              ? [referenceDocument]
              : [{
                document_id: 'civil-document',
                page_number: 1,
                sheet_number: 'C6',
                sheet_mapping_status: 'verified',
                source_sha256: SOURCE_SHA,
                visual_coverage: visualCoverageFixture(1),
              }],
            error: null,
          }),
        };
        return chain;
      },
      rpc(name) {
        if (name === 'ecos_hosted_index_status_v2') return Promise.resolve({ data: [status], error: null });
        if (name === 'ecos_load_current_hosted_page_context') {
          return Promise.resolve({ data: hostedPages, error: null });
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
    };
    const readiness = await loadDocumentReadiness({
      client,
      project: { id: EXACT_PROJECT_ID, name: definition.projectName },
      definition: definitionFixture,
    });
    return { readiness, fromCalls };
  }

  const exact = await load([exactPage]);
  assert.equal(exact.readiness.passed, true, exact.readiness.failures.join('\n'));
  assert.deepEqual(exact.fromCalls, ['reference_documents']);

  const legacyOnly = await load([]);
  assert.equal(legacyOnly.readiness.passed, false);
  assert.deepEqual(legacyOnly.fromCalls, ['reference_documents']);
  assert(legacyOnly.readiness.failures.some(failure => failure.includes('exact hosted pages')));
}

verifyHostedReadinessNeverReadsLegacyPages()
  .then(() => {
    console.log(`Ask ECOS live acceptance contracts PASS (${definition.cases.length} real-world cases; 100% required).`);
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
