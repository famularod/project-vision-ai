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
  'deno.lock',
  'package.json',
  'scripts/ecos-ask-2321-live-acceptance.js',
  'scripts/ecos-ask-2321-live-evidence-gate.js',
  'scripts/ecos-ask-live-acceptance.js',
  'scripts/ecos-ask-live-acceptance-lib.js',
  'scripts/ecos-ask-live-evidence-gate.js',
  'scripts/jarvis-release-gate.js',
  'validation/ecos/ask-ecos-real-world-cases.json',
  'services/ECOSProjectQuestion.ts',
  'workers/ecos-indexer/.dockerignore',
  'workers/ecos-indexer/Dockerfile',
  'workers/ecos-indexer/clamav-databases.sha256',
  'workers/ecos-indexer/entrypoint.sh',
  'workers/ecos-indexer/requirements.txt',
]);
const CONTRACT_DIRECTORIES = Object.freeze([
  Object.freeze({ path: 'supabase/functions/ecos-ask-project', extensions: Object.freeze(['.ts']) }),
  Object.freeze({ path: 'supabase/functions/_shared', extensions: Object.freeze(['.ts']) }),
  Object.freeze({ path: 'supabase/migrations', extensions: Object.freeze(['.sql']) }),
  Object.freeze({ path: 'workers/ecos-indexer/ecos_indexer', extensions: Object.freeze(['.py']) }),
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
  if (!canonicalUuid(definition?.projectId)) problems.push('projectId must be the exact canonical live project UUID.');
  if (!text(definition?.projectName)) problems.push('projectName is required.');
  if (!canonicalProductionHost(definition?.productionHost)) {
    problems.push('productionHost must be the exact lowercase Supabase production host.');
  }
  if (definition?.requiredIndexMode !== 'live') {
    problems.push('requiredIndexMode must be live for release evidence.');
  }
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
  const expectedProjectId = canonicalUuid(context.projectId);
  const currentDocuments = currentDocumentBindingMap(context.currentDocuments);
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

  if (text(response?.schemaVersion) !== 'ecos-project-question/1.0') {
    failures.push('Response schema is not ecos-project-question/1.0.');
  }
  if (!expectedProjectId || canonicalUuid(response?.projectId) !== expectedProjectId) {
    failures.push('Response project id does not match the selected immutable project.');
  }
  if (normalize(response?.projectName) !== normalize(context.projectName)) {
    failures.push(`Response project ${JSON.stringify(response?.projectName)} does not match ${context.projectName}.`);
  }
  if (text(response?.question) !== text(testCase.question)) {
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

  for (const item of evidence) {
    const citation = record(item?.documentCitation);
    const documentId = exactBoundedText(citation.documentId, 500);
    const document = documentId ? currentDocuments.get(documentId) : null;
    if (!document) {
      failures.push(`Citation ${JSON.stringify(documentId || citation.documentId)} is not an exact current document.`);
      continue;
    }
    if (exactBoundedText(item?.recordId, 500) !== document.id) {
      failures.push(`Citation ${document.id} does not match its durable record id.`);
    }
    if (exactBoundedText(citation.documentName, 500) !== document.name) {
      failures.push(`Citation ${document.id} does not match its authoritative document name.`);
    }
    if (canonicalUuid(citation.projectId) !== expectedProjectId || document.projectId !== expectedProjectId) {
      failures.push(`Citation ${document.id} is bound to the wrong immutable project.`);
    }
    if (canonicalSha256(citation.sourceSha256) !== document.currentSourceSha256) {
      failures.push(`Citation ${document.id} is bound to a stale source checksum.`);
    }
    if (exactBoundedText(citation.revision, 160) !== document.revision) {
      failures.push(`Citation ${document.id} is bound to a stale drawing revision.`);
    }
    if (text(citation.evidenceVersion) !== VISUAL_EVIDENCE_VERSION) {
      failures.push(`Citation ${document.id} does not use ${VISUAL_EVIDENCE_VERSION}.`);
    }
    if (!positiveInteger(citation.pageNumber)) {
      failures.push(`Citation ${document.id} has no exact positive page number.`);
      continue;
    }
    const exactPage = findExactCitationPageRow(
      citation,
      context.pageRows,
      currentDocuments,
      expectedProjectId,
    );
    if (!exactPage) {
      failures.push(`Citation ${document.id} is not bound to an exact authoritative page receipt.`);
      continue;
    }
    const authoritativeSheet = text(exactPage.sheet_mapping_status) === 'verified'
      ? exactBoundedText(exactPage.sheet_number, 160) || ''
      : '';
    if ((exactBoundedText(citation.sheetNumber, 160) || '') !== authoritativeSheet) {
      failures.push(`Citation ${document.id} relabels its authoritative sheet identity.`);
    }
    const citedRegionId = exactBoundedText(citation.regionId, 500);
    const responseRegion = record(item?.documentRegion);
    const hasResponseRegion = Object.keys(responseRegion).length > 0;
    if (citedRegionId || hasResponseRegion) {
      if (!citedRegionId || exactBoundedText(responseRegion.id, 500) !== citedRegionId) {
        failures.push(`Citation ${document.id} has a mismatched bounded region id.`);
        continue;
      }
      const authoritativeRegions = Array.isArray(exactPage.regions) ? exactPage.regions : [];
      const matchingRegions = authoritativeRegions
        .map(record)
        .filter(region => exactBoundedText(region.id, 500) === citedRegionId);
      let proofRegions = matchingRegions;
      let authoritativeBounds = matchingRegions.length === 1 ? matchingRegions[0] : null;
      let authoritativeRegionText = matchingRegions.length === 1
        ? primaryRegionText(matchingRegions[0])
        : '';
      let authoritativeSource = matchingRegions.length === 1
        ? normalizedRegionSource(matchingRegions[0].rawSource || matchingRegions[0].source)
        : '';
      if (matchingRegions.length > 1) {
        failures.push(`Citation ${document.id} has an ambiguous authoritative region receipt.`);
        continue;
      }
      if (matchingRegions.length === 0) {
        const sourceRegionIds = exactUniqueTextArray(responseRegion.sourceRegionIds, 20, 500);
        if (!/^cell-\d+-\d+-\d+$/.test(citedRegionId) || sourceRegionIds.length === 0) {
          failures.push(`Citation ${document.id} has no unique authoritative region receipt.`);
          continue;
        }
        proofRegions = sourceRegionIds.flatMap(sourceRegionId => {
          const matches = authoritativeRegions
            .map(record)
            .filter(region => exactBoundedText(region.id, 500) === sourceRegionId);
          return matches.length === 1 ? matches : [];
        });
        if (proofRegions.length !== sourceRegionIds.length) {
          failures.push(`Citation ${document.id} has an incomplete synthetic-region receipt.`);
          continue;
        }
        authoritativeBounds = unionRegionBounds(proofRegions);
        authoritativeRegionText = proofRegions.map(primaryRegionText).filter(Boolean).join(' ').slice(0, 4_000);
        const rawSources = proofRegions.map(region =>
          exactBoundedText(region.rawSource || region.source, 160)
        );
        const normalizedSources = rawSources.map(normalizedRegionSource);
        if (rawSources.some(source => !source) || normalizedSources.some(source => !source)) {
          failures.push(`Citation ${document.id} has an unsupported synthetic-region source.`);
          continue;
        }
        const groupedRawSource = new Set(rawSources).size === 1 ? rawSources[0] : 'mixed';
        if (exactBoundedText(responseRegion.rawSource, 160) !== groupedRawSource) {
          failures.push(`Citation ${document.id} does not match its synthetic-region raw source.`);
          continue;
        }
        authoritativeSource = groupedRawSource === 'mixed'
          ? 'vision'
          : normalizedSources[0];
      }
      if (
        !validNormalizedBounds(responseRegion) ||
        !validNormalizedBounds(authoritativeBounds) ||
        !regionBoundsMatch(responseRegion, authoritativeBounds)
      ) {
        failures.push(`Citation ${document.id} does not match its authoritative region bounds.`);
        continue;
      }
      if (
        !substantialProofTextMatch(item?.excerpt, authoritativeRegionText) ||
        !substantialProofTextMatch(responseRegion.text, authoritativeRegionText)
      ) {
        failures.push(`Citation ${document.id} does not match its authoritative region text.`);
        continue;
      }
      if (!authoritativeSource || normalizedRegionSource(responseRegion.source) !== authoritativeSource) {
        failures.push(`Citation ${document.id} does not match its authoritative region source.`);
      }
    }
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
      citationHasHighResolutionCoverage(
        item?.documentCitation,
        context.pageRows,
        currentDocuments,
        expectedProjectId,
      )
    )) {
      failures.push(`Proof from /${group.documentNamePattern}/i is not backed by complete high-resolution coverage.`);
    }
  }

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
  });
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
    const value = normalizedCitationReceipt(citation);
    const key = JSON.stringify(value);
    if (!value.documentId || seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}

function normalizedCitationReceipt(citation) {
  return {
    documentId: text(citation?.documentId),
    projectId: canonicalUuid(citation?.projectId),
    sourceSha256: canonicalSha256(citation?.sourceSha256),
    evidenceVersion: text(citation?.evidenceVersion) || null,
    documentName: text(citation?.documentName),
    revision: text(citation?.revision) || null,
    pageNumber: positiveInteger(citation?.pageNumber) || null,
    sheetNumber: text(citation?.sheetNumber) || null,
    regionId: text(citation?.regionId) || null,
  };
}

function citationHasHighResolutionCoverage(
  citation,
  pageRows,
  currentDocuments = new Map(),
  expectedProjectId = null,
) {
  return pageRowHasCompleteVisualCoverage(findExactCitationPageRow(
    citation,
    pageRows,
    currentDocuments,
    expectedProjectId,
  ));
}

function findExactCitationPageRow(citation, pageRows, currentDocuments, expectedProjectId) {
  const rows = Array.isArray(pageRows) ? pageRows : [];
  const documentId = exactBoundedText(citation?.documentId, 500);
  const pageNumber = positiveInteger(citation?.pageNumber);
  const document = documentId ? currentDocuments.get(documentId) : null;
  if (
    !document ||
    !expectedProjectId ||
    canonicalUuid(citation?.projectId) !== expectedProjectId ||
    canonicalSha256(citation?.sourceSha256) !== document.currentSourceSha256 ||
    exactBoundedText(citation?.revision, 160) !== document.revision ||
    text(citation?.evidenceVersion) !== VISUAL_EVIDENCE_VERSION
  ) return null;
  return rows.find(item =>
    text(item?.document_id) === documentId &&
    canonicalUuid(item?.project_id) === expectedProjectId &&
    positiveInteger(item?.page_number) === pageNumber &&
    canonicalSha256(item?.source_sha256) === document.currentSourceSha256 &&
    exactBoundedText(item?.source_revision, 160) === document.revision &&
    text(item?.evidence_version) === VISUAL_EVIDENCE_VERSION
  ) || null;
}

function currentDocumentBindingMap(values) {
  const documents = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const document = record(value);
    const id = exactBoundedText(document.id, 500);
    const projectId = canonicalUuid(document.projectId);
    const currentSourceSha256 = canonicalSha256(document.currentSourceSha256);
    const revision = exactBoundedText(document.revision, 160);
    const name = exactBoundedText(document.name, 500);
    if (!id || !projectId || !currentSourceSha256 || !revision || !name || documents.has(id)) continue;
    documents.set(id, Object.freeze({ id, name, projectId, currentSourceSha256, revision }));
  }
  return documents;
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
    regions: Array.isArray(finalPage.regions) ? finalPage.regions.map(record) : [],
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
  return validNormalizedBounds(region) && Boolean(text(region?.id));
}

function validNormalizedBounds(region) {
  const x = Number(region?.x);
  const y = Number(region?.y);
  const width = Number(region?.width);
  const height = Number(region?.height);
  return [x, y, width, height].every(Number.isFinite) &&
    x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x + width <= 1.0001 && y + height <= 1.0001;
}

function regionBoundsMatch(leftValue, rightValue) {
  const left = record(leftValue);
  const right = record(rightValue);
  return ['x', 'y', 'width', 'height'].every(key =>
    Number.isFinite(Number(left[key])) &&
    Number.isFinite(Number(right[key])) &&
    Math.abs(Number(left[key]) - Number(right[key])) <= 1e-6
  );
}

function unionRegionBounds(regions) {
  if (!Array.isArray(regions) || regions.length === 0 || regions.some(region => !validBoundedRegion(region))) {
    return null;
  }
  const left = Math.min(...regions.map(region => Number(region.x)));
  const top = Math.min(...regions.map(region => Number(region.y)));
  const right = Math.max(...regions.map(region => Number(region.x) + Number(region.width)));
  const bottom = Math.max(...regions.map(region => Number(region.y) + Number(region.height)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function primaryRegionText(regionValue) {
  const region = record(regionValue);
  return text(region.text || region.evidenceText || region.label);
}

function exactUniqueTextArray(value, maximumItems, maximumLength) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumItems) return [];
  const items = value.map(item => exactBoundedText(item, maximumLength));
  if (items.some(item => !item) || new Set(items).size !== items.length) return [];
  return items;
}

function substantialProofTextMatch(candidateValue, authoritativeValue) {
  const candidate = canonicalProofText(candidateValue);
  const authoritative = canonicalProofText(authoritativeValue);
  if (!candidate || !authoritative) return false;
  const candidateTokens = candidate.split(' ').filter(Boolean);
  const authoritativeTokens = authoritative.split(' ').filter(Boolean);
  if (authoritativeTokens.length < 2 || authoritative.length < 6) return false;
  let candidateIndex = 0;
  for (const authoritativeToken of authoritativeTokens) {
    while (
      candidateIndex < candidateTokens.length &&
      candidateTokens[candidateIndex] !== authoritativeToken
    ) candidateIndex += 1;
    if (candidateIndex >= candidateTokens.length) return false;
    candidateIndex += 1;
  }
  return true;
}

function canonicalProofText(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9.%/"'-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedRegionSource(value) {
  const source = text(value).toLowerCase();
  if (source === 'embedded_text') return 'embedded_text';
  if (new Set([
    'ocr',
    'fixed_visual_tile_coordinate_ocr',
    'rotated_coordinate_ocr',
    'dense_text_coordinate_ocr',
    'title_block_ocr',
  ]).has(source) || [
    'sheet_identity_ocr_',
    'dimension_coordinate_ocr_',
    'structured_table_coordinate_ocr_',
  ].some(prefix => source.startsWith(prefix))) return 'ocr';
  if (new Set([
    'vision',
    'coordinate_text',
    'native_title_band',
    'pdf_annotation_title_band',
    'deterministic_structured_table_row',
    'deterministic_structured_table_relationship',
    'complete_coordinate_bound_structured_table_relationship',
    'deterministic_label_block',
  ]).has(source)) return 'vision';
  return '';
}

function acceptanceContractHash(selectedDefinitionPath = definitionPath) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of acceptanceContractFiles()) {
    const absolutePath = path.join(repoRoot, relativePath);
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(absolutePath));
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

function acceptanceContractFiles() {
  const files = new Set(CONTRACT_FILES);
  for (const directory of CONTRACT_DIRECTORIES) {
    collectContractFiles(directory.path, new Set(directory.extensions), files);
  }
  return Object.freeze([...files].sort());
}

function collectContractFiles(relativeDirectory, allowedExtensions, files) {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory);
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      collectContractFiles(relativePath, allowedExtensions, files);
      continue;
    }
    if (
      entry.isFile() &&
      allowedExtensions.has(path.extname(entry.name)) &&
      !entry.name.endsWith('.test.ts')
    ) files.add(relativePath);
  }
}

function validateLiveAcceptanceResult(
  result,
  definition,
  now = new Date(),
  selectedDefinitionPath = definitionPath,
) {
  const failures = [];
  if (result?.schemaVersion !== LIVE_RESULT_SCHEMA_VERSION) failures.push('Live result schema is invalid.');
  if (result?.definitionSchemaVersion !== definition.schemaVersion) failures.push('Definition schema changed after the live run.');
  if (!canonicalUuid(definition?.projectId) || result?.projectId !== definition.projectId) {
    failures.push('Live result is for the wrong immutable project id.');
  }
  if (
    !canonicalProductionHost(definition?.productionHost) ||
    result?.productionHost !== definition.productionHost
  ) failures.push('Live result is for the wrong production host.');
  if (definition?.requiredIndexMode !== 'live' || result?.indexMode !== definition.requiredIndexMode) {
    failures.push('Live result did not use the required customer-visible live index mode.');
  }
  if (normalize(result?.projectName) !== normalize(definition.projectName)) failures.push('Live result is for the wrong project.');
  if (result?.acceptanceContractSha256 !== acceptanceContractHash(selectedDefinitionPath)) failures.push('Ask ECOS code or acceptance cases changed after the live run.');
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
  const expectedCases = new Map(definition.cases.map(item => [item.id, item]));
  if (cases.some(item => {
    const expected = expectedCases.get(item?.id);
    return !expected || text(item?.question) !== text(expected.question);
  })) failures.push('Live result question text does not exactly match the approved benchmark.');
  for (const item of cases) {
    const expected = expectedCases.get(item?.id);
    if (!expected) continue;
    failures.push(...savedCaseReceiptFailures(item, expected).map(failure =>
      `Case ${expected.id}: ${failure}`
    ));
  }
  const passed = cases.filter(item => item?.passed === true).length;
  if (passed < definition.minimumPassingCases) failures.push(`Only ${passed} cases passed; at least ${definition.minimumPassingCases} are required.`);
  if (cases.length === 0 || passed / cases.length !== definition.requiredPassRate) failures.push('Ask ECOS did not achieve the required 100% pass rate.');
  if (
    result?.summary?.total !== cases.length ||
    result?.summary?.passed !== passed ||
    result?.summary?.failed !== cases.length - passed ||
    result?.summary?.passRate !== (cases.length > 0 ? passed / cases.length : 0)
  ) failures.push('Live result summary does not exactly match its case receipts.');
  if (result?.documentReadiness?.passed !== true) failures.push('Required current drawing pages were not fully ready.');
  const checkedDocuments = Array.isArray(result?.documentReadiness?.checkedDocuments)
    ? result.documentReadiness.checkedDocuments
    : [];
  if (checkedDocuments.length === 0) failures.push('Live result has no exact current document readiness receipts.');
  const checkedDocumentIds = checkedDocuments.map(document => exactBoundedText(document?.id, 500));
  if (
    checkedDocumentIds.some(id => !id) ||
    new Set(checkedDocumentIds).size !== checkedDocumentIds.length
  ) failures.push('Live result contains duplicate or malformed current document receipts.');
  if (checkedDocuments.some(document =>
    document?.projectId !== definition.projectId ||
    !exactBoundedText(document?.id, 500) ||
    !exactBoundedText(document?.name, 500) ||
    !exactBoundedText(document?.revision, 160) ||
    !canonicalSha256(document?.sourceSha256) ||
    text(document?.evidenceVersion) !== VISUAL_EVIDENCE_VERSION ||
    positiveInteger(document?.sourcePageCount) === 0 ||
    positiveInteger(document?.indexedPageCount) !== positiveInteger(document?.sourcePageCount) ||
    document?.indexMode !== definition.requiredIndexMode
  )) failures.push('Live result contains a malformed or cross-project document readiness receipt.');
  const checkedDocumentsById = new Map(checkedDocuments.map(document => [document?.id, document]));
  const resultCitations = cases.flatMap(item => Array.isArray(item?.citations) ? item.citations : []);
  if (resultCitations.length === 0) failures.push('Live result has no exact document citations.');
  if (resultCitations.some(citation =>
    citation?.projectId !== definition.projectId ||
    !exactBoundedText(citation?.documentId, 500) ||
    !exactBoundedText(citation?.documentName, 500) ||
    !exactBoundedText(citation?.revision, 160) ||
    !positiveInteger(citation?.pageNumber) ||
    !canonicalSha256(citation?.sourceSha256) ||
    text(citation?.evidenceVersion) !== VISUAL_EVIDENCE_VERSION
  )) failures.push('Live result contains a malformed or cross-project citation receipt.');
  if (resultCitations.some(citation => {
    const document = checkedDocumentsById.get(citation?.documentId);
    return !document ||
      citation?.projectId !== document.projectId ||
      citation?.documentName !== document.name ||
      citation?.revision !== document.revision ||
      citation?.sourceSha256 !== document.sourceSha256 ||
      citation?.evidenceVersion !== document.evidenceVersion ||
      positiveInteger(citation?.pageNumber) > positiveInteger(document.sourcePageCount);
  })) failures.push('Live result citation is not bound to one exact current document receipt.');
  return failures;
}

function savedCaseReceiptFailures(item, expected) {
  const failures = [];
  if (item?.passed !== true) failures.push('did not pass.');
  if (!Array.isArray(item?.failures) || item.failures.length !== 0) {
    failures.push('contains a nonempty or malformed failure list.');
  }
  if (text(item?.question) !== text(expected.question)) failures.push('question does not match.');
  const citations = Array.isArray(item?.citations) ? item.citations : [];
  const citationKeys = citations.map(citation => JSON.stringify(normalizedCitationReceipt(citation)));
  if (new Set(citationKeys).size !== citationKeys.length) {
    failures.push('contains duplicate citation receipts.');
  }
  if (citations.length < expected.minimumDocumentCitations) {
    failures.push(`has ${citations.length} of ${expected.minimumDocumentCitations} required citations.`);
  }
  const distinctDocuments = new Set(citations.map(citation => text(citation?.documentId)).filter(Boolean));
  const distinctSheets = new Set(citations.map(citation => text(citation?.sheetNumber)).filter(Boolean));
  const distinctPages = new Set(citations.map(citation => {
    const documentId = text(citation?.documentId);
    const pageNumber = positiveInteger(citation?.pageNumber);
    return documentId && pageNumber ? `${documentId}:${pageNumber}` : '';
  }).filter(Boolean));
  if (distinctDocuments.size < expected.minimumDistinctDocuments) {
    failures.push('does not retain the required distinct document citations.');
  }
  if (distinctSheets.size < expected.minimumDistinctSheets) {
    failures.push('does not retain the required distinct sheet citations.');
  }
  if (distinctPages.size < (Number.isInteger(expected.minimumDistinctPages) ? expected.minimumDistinctPages : 0)) {
    failures.push('does not retain the required distinct page citations.');
  }
  const groups = Array.isArray(expected.expectedEvidence) ? expected.expectedEvidence : [];
  for (const group of groups) {
    const matching = citations.filter(citation => evidenceMatchesGroup({ documentCitation: citation }, group));
    if (matching.length === 0) {
      failures.push(`has no saved citation for /${group.documentNamePattern}/i and the expected sheet/page.`);
      continue;
    }
    if (group.requireBoundedRegion && !matching.some(citation => exactBoundedText(citation?.regionId, 500))) {
      failures.push(`has no bounded saved citation for /${group.documentNamePattern}/i.`);
    }
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

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function canonicalSha256(value) {
  const candidate = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(candidate) ? candidate : '';
}

function canonicalUuid(value) {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : null;
}

function canonicalProductionHost(value) {
  if (typeof value !== 'string' || value !== value.trim() || value !== value.toLowerCase()) return null;
  return /^[a-z0-9][a-z0-9-]{1,62}\.supabase\.co$/.test(value) ? value : null;
}

function exactBoundedText(value, maximumLength) {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  return value && value.length <= maximumLength && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
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
  CONTRACT_DIRECTORIES,
  CONTRACT_FILES,
  LIVE_RESULT_SCHEMA_VERSION,
  REQUIRED_VISUAL_TILE_BOUNDS,
  REQUIRED_VISUAL_TILE_KEYS,
  VISUAL_COVERAGE_SCHEMA_VERSION,
  VISUAL_EVIDENCE_VERSION,
  acceptanceContractFiles,
  acceptanceContractHash,
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
