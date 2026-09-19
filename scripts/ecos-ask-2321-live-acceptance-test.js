#!/usr/bin/env node

const assert = require('node:assert/strict');
const path = require('node:path');
const {
  REQUIRED_VISUAL_TILE_BOUNDS,
  VISUAL_COVERAGE_SCHEMA_VERSION,
  VISUAL_EVIDENCE_VERSION,
  acceptanceContractHash,
  definitionPath: defaultDefinitionPath,
  evaluateAcceptanceCase,
  loadAcceptanceDefinition,
  repoRoot,
  validateAcceptanceDefinition,
} = require('./ecos-ask-live-acceptance-lib');

const SOURCE_SHA = 'b'.repeat(64);

function visualCoverageFixture(pageNumber = 13, sourceSha256 = SOURCE_SHA) {
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

function diagnosticsFixture() {
  return {
    schemaVersion: 'ecos-question-trace/1.0',
    traceId: '11111111-1111-4111-8111-111111111111',
    clientRequestId: '22222222-2222-4222-8222-222222222222',
    clientSurface: 'web',
    evidenceSnapshotId: '33333333-3333-4333-8333-333333333333',
    evidenceDossierId: '44444444-4444-4444-8444-444444444444',
    replayed: false,
    persisted: true,
  };
}

const definitionPath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'ask-ecos-2321-real-world-cases.json',
);
const definition = loadAcceptanceDefinition(definitionPath);

assert.equal(validateAcceptanceDefinition(definition).length, 0);
assert.equal(definition.projectName, '2321 Compliance Project');
assert.equal(definition.cases.length, 19, 'The independent 2321 benchmark must keep all 19 approved cases.');
assert.equal(definition.minimumPassingCases, definition.cases.length);
assert.equal(definition.requiredPassRate, 1, 'The 2321 benchmark must require 100%.');

const questionCorpus = definition.cases.map(testCase => [
  testCase.question,
  testCase.expectedAnswer,
  ...(testCase.expectedEvidence || []).map(group => group.documentNamePattern),
].join(' ')).join('\n');
assert(!/2375/i.test(questionCorpus), 'The 2321 benchmark must not reuse 2375 facts or document selectors.');

const evidenceGroups = definition.cases.flatMap(testCase => testCase.expectedEvidence || []);
for (const group of evidenceGroups) {
  assert(/2321/.test(group.documentNamePattern), `Evidence selector is not 2321-specific: ${group.documentNamePattern}`);
  assert.equal(group.requireBoundedRegion, true, 'Every drawing fact must have a bounded proof region.');
  assert.equal(group.requireHighResolutionCoverage, true, 'Every drawing fact must require complete visual coverage.');
  assert(
    (group.sheetNumberPatterns || []).length > 0 || (group.pageNumberPatterns || []).length > 0,
    'Every evidence group must identify an exact sheet or PDF page.',
  );
}

const documentCorpus = evidenceGroups.map(group => group.documentNamePattern).join('\n');
for (const discipline of ['ARCHITECTURAL', 'STRUCTURAL', 'MECHANICAL', 'PLUMBING', 'ELECTRICAL', 'LANDSCAPE']) {
  assert(documentCorpus.includes(discipline), `The independent benchmark is missing ${discipline} evidence.`);
}
assert(
  definition.cases.filter(testCase => testCase.minimumDistinctDocuments >= 2).length >= 1,
  'The 2321 benchmark must include a cross-discipline, multi-document question.',
);
assert(
  definition.cases.filter(testCase => testCase.minimumDistinctSheets >= 2).length >= 2,
  'The 2321 benchmark must include at least two cross-sheet questions.',
);
assert(
  definition.cases.filter(testCase => (testCase.requiredLimitationPatterns || []).length > 0).length >= 3,
  'The 2321 benchmark must include at least three supported-refusal negative controls.',
);
assert.equal(new Set(definition.cases.map(testCase => testCase.question)).size, definition.cases.length);
assert.notEqual(
  acceptanceContractHash(definitionPath),
  acceptanceContractHash(defaultDefinitionPath),
  'The 2321 evidence hash must be independent from the 2375 benchmark hash.',
);

const treeCase = definition.cases.find(item => item.id === '2321-tree-requirement-and-provision');
const naturalTreeAnswer =
  'Landscape Sheet L-1, Rev 1 lists 71 required parking-lot trees and 78 provided parking-lot trees.';
for (const pattern of treeCase.requiredAnswerPatterns) {
  assert(
    new RegExp(pattern, 'ims').test(naturalTreeAnswer),
    `Natural field wording must satisfy the tree contract: ${pattern}`,
  );
}
assert(
  treeCase.requiredAnswerPatterns.some(pattern =>
    !new RegExp(pattern, 'ims').test('Landscape Sheet L-1 lists 70 required trees and 79 provided trees.')
  ),
  'The relaxed word order must not accept incorrect tree counts.',
);

const testCase = definition.cases.find(item => item.id === '2321-site-photometric-statistics');
const pageRows = [{
  document_id: 'electrical-2321',
  page_number: 13,
  sheet_number: 'E-2.7',
  sheet_mapping_status: 'verified',
  source_sha256: SOURCE_SHA,
  visual_coverage: visualCoverageFixture(),
}];
const response = {
  schemaVersion: 'ecos-project-question/2.0',
  projectId: 'project-2321',
  projectName: definition.projectName,
  question: testCase.question,
  answer: 'Electrical Sheet E-2.7 lists an average of 2.6 fc, a maximum of 21.1 fc, and a minimum of 0.0 fc for ALL site points.',
  confidence: 'high',
  facts: [{
    id: 'fact-1',
    statement: 'The site photometrics statistics are 2.6 fc average, 21.1 fc maximum, and 0.0 fc minimum.',
    classification: 'fact',
    sourceIds: ['document:electrical-2321:13:photometrics-table'],
  }],
  limitations: [],
  conflicts: [],
  suggestedQuestions: [],
  supportingEvidence: [{
    sourceType: 'document',
    recordId: 'electrical-2321',
    summary: '2321 site photometrics summary',
    excerpt: 'SITE PHOTOMETRICS PLAN — ALL — 2.6 fc average — 21.1 fc maximum — 0.0 fc minimum',
    documentCitation: {
      documentId: 'electrical-2321',
      documentName: '06 - PLZ CORP - 2321 THIRD STREET - ELECTRICAL',
      revision: '1',
      pageNumber: 13,
      sheetNumber: 'E-2.7',
      regionId: 'photometrics-table',
      label: 'Electrical, Sheet E-2.7',
    },
    documentRegion: {
      id: 'photometrics-table',
      label: 'Site photometrics statistics',
      text: 'SITE PHOTOMETRICS PLAN ALL 2.6 fc 21.1 fc 0.0 fc',
      areaNames: ['2321 Site'],
      x: 0.82,
      y: 0.86,
      width: 0.15,
      height: 0.08,
      confidence: 0.99,
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
  generatedAt: '2026-08-08T12:00:00.000Z',
  model: 'protected-shadow-model',
  diagnostics: diagnosticsFixture(),
};

const passing = evaluateAcceptanceCase(testCase, response, {
  projectName: definition.projectName,
  pageRows,
});
assert.equal(passing.passed, true, passing.failures.join('\n'));

const wrongProject = evaluateAcceptanceCase(testCase, {
  ...response,
  projectName: '2375 Compliance Project',
}, {
  projectName: definition.projectName,
  pageRows,
});
assert.equal(wrongProject.passed, false);
assert(wrongProject.failures.some(failure => failure.includes('does not match')));

function evaluateWithCoverage(visualCoverage, overrides = {}) {
  return evaluateAcceptanceCase(testCase, response, {
    projectName: definition.projectName,
    pageRows: [{ ...pageRows[0], ...overrides, visual_coverage: visualCoverage }],
  });
}

function assertCoverageRejected(result, label) {
  assert.equal(result.passed, false, `${label} unexpectedly passed.`);
  assert(
    result.failures.some(failure => failure.includes('high-resolution')),
    `${label} did not report the missing high-resolution proof.`,
  );
}

assertCoverageRejected(evaluateWithCoverage({
  overviewAnalyzed: true,
  coverageComplete: true,
  requestedDeepReadRegionCount: 6,
  completedDeepReadRegionCount: 6,
}), 'fabricated six-of-six counters');

const missingTile = visualCoverageFixture();
missingTile.completedDeepReadRegionKeys.pop();
missingTile.completedDeepReadRegionProofs.pop();
assertCoverageRejected(evaluateWithCoverage(missingTile), 'missing tile');

const duplicateTile = visualCoverageFixture();
duplicateTile.completedDeepReadRegionProofs[5] = {
  ...duplicateTile.completedDeepReadRegionProofs[0],
  bounds: { ...duplicateTile.completedDeepReadRegionProofs[0].bounds },
};
assertCoverageRejected(evaluateWithCoverage(duplicateTile), 'duplicate tile proof');

const mismatchedPage = visualCoverageFixture();
mismatchedPage.completedDeepReadRegionProofs[2].pageNumber = 12;
assertCoverageRejected(evaluateWithCoverage(mismatchedPage), 'tile proof from another page');

const mismatchedSource = visualCoverageFixture();
mismatchedSource.completedDeepReadRegionProofs[2].sourceSha256 = 'c'.repeat(64);
assertCoverageRejected(evaluateWithCoverage(mismatchedSource), 'tile proof from another source');

const staleEvidence = visualCoverageFixture();
staleEvidence.evidenceVersion = 'ecos-hosted-evidence/1.2';
staleEvidence.completedDeepReadRegionProofs.forEach(proof => {
  proof.evidenceVersion = 'ecos-hosted-evidence/1.2';
});
assertCoverageRejected(evaluateWithCoverage(staleEvidence), 'stale evidence version');

const mismatchedBounds = visualCoverageFixture();
mismatchedBounds.completedDeepReadRegionProofs[2].bounds.x = 0.5;
assertCoverageRejected(evaluateWithCoverage(mismatchedBounds), 'mismatched tile bounds');

const missingHash = visualCoverageFixture();
delete missingHash.completedDeepReadRegionProofs[2].renderSha256;
assertCoverageRejected(evaluateWithCoverage(missingHash), 'missing render fingerprint');

const missingMethod = visualCoverageFixture();
delete missingMethod.completedDeepReadRegionProofs[2].analysisMethod;
assertCoverageRejected(evaluateWithCoverage(missingMethod), 'missing analysis method');

const invalidDimensions = visualCoverageFixture();
invalidDimensions.completedDeepReadRegionProofs[2].renderPixelWidth = 0;
assertCoverageRejected(evaluateWithCoverage(invalidDimensions), 'invalid render dimensions');

const duplicateAnalysisId = visualCoverageFixture();
duplicateAnalysisId.completedDeepReadRegionProofs[2].analysisRegionCount = 2;
duplicateAnalysisId.completedDeepReadRegionProofs[2].analysisRegionIds = [
  duplicateAnalysisId.completedDeepReadRegionProofs[2].analysisRegionIds[0],
  duplicateAnalysisId.completedDeepReadRegionProofs[2].analysisRegionIds[0],
];
assertCoverageRejected(evaluateWithCoverage(duplicateAnalysisId), 'duplicate analysis region id');

const searchableNotSubset = visualCoverageFixture();
searchableNotSubset.completedDeepReadRegionProofs[2].searchableRegionIds = [
  `visual-tile-${searchableNotSubset.completedDeepReadRegionProofs[2].tileKey}-not-analyzed`,
];
assertCoverageRejected(evaluateWithCoverage(searchableNotSubset), 'searchable region not analyzed');

const recordedFailure = visualCoverageFixture();
recordedFailure.failureCodes = ['analysis_incomplete'];
assertCoverageRejected(evaluateWithCoverage(recordedFailure), 'coverage with a recorded failure');

console.log('Ask ECOS 2321 acceptance contracts PASS (19 independent cases; 100% required).');
