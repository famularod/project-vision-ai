#!/usr/bin/env node

const assert = require('node:assert/strict');
const {
  LIVE_RESULT_SCHEMA_VERSION,
  REQUIRED_VISUAL_TILE_BOUNDS,
  VISUAL_COVERAGE_SCHEMA_VERSION,
  VISUAL_EVIDENCE_VERSION,
  acceptanceContractHash,
  deployedRuntimePackageSha256,
  evaluateAcceptanceCase,
  loadAcceptanceDefinition,
  normalizeAssuredShadowPageRow,
  pageRowHasCompleteVisualCoverage,
  validateAcceptanceDefinition,
  validateLiveAcceptanceResult,
} = require('./ecos-ask-live-acceptance-lib');
const {
  loadDocumentReadiness,
  safeErrorMessage,
} = require('./ecos-ask-live-acceptance');

const SOURCE_SHA = 'a'.repeat(64);

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

const definition = loadAcceptanceDefinition();
assert.equal(validateAcceptanceDefinition(definition).length, 0);
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
  page_number: 6,
  sheet_number: 'C6',
  sheet_mapping_status: 'verified',
  source_sha256: SOURCE_SHA,
  visual_coverage: visualCoverageFixture(),
}];
const response = {
  schemaVersion: 'ecos-project-question/2.0',
  projectId: 'project-2375',
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
  diagnostics: diagnosticsFixture(),
};

const passing = evaluateAcceptanceCase(testCase, response, {
  projectName: definition.projectName,
  pageRows,
});
assert.equal(passing.passed, true, passing.failures.join('\n'));

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
  projectName: definition.projectName,
  pageRows: [{ ...pageRows[0], visual_coverage: { ...pageRows[0].visual_coverage, coverageComplete: false } }],
});
assert.equal(incompleteCoverage.passed, false);
assert(incompleteCoverage.failures.some(item => item.includes('high-resolution')));

const leakedIdentifier = evaluateAcceptanceCase(testCase, {
  ...response,
  answer: `${response.answer} [update:mrcu2abk-63b55h5l]`,
}, {
  projectName: definition.projectName,
  pageRows,
});
assert.equal(leakedIdentifier.passed, false);
assert(leakedIdentifier.failures.some(item => item.includes('internal record id')));

const now = new Date('2026-08-06T13:00:00.000Z');
const validLiveResult = {
  schemaVersion: LIVE_RESULT_SCHEMA_VERSION,
  definitionSchemaVersion: definition.schemaVersion,
  acceptanceContractSha256: acceptanceContractHash(),
  runtimePackageSha256: deployedRuntimePackageSha256(),
  completedAt: '2026-08-06T12:30:00.000Z',
  projectName: definition.projectName,
  indexMode: 'live',
  executionBoundary: {
    mode: 'customer_path',
    functionSlug: 'ecos-ask-project',
    requestTransport: 'supabase_functions_invoke',
    invocationMode: 'app_ui',
    authentication: 'signed_in_user',
    publicationMode: 'live',
    validationMode: null,
    serviceWorkerTokenUsed: false,
    clientSurface: 'web',
    appInvocationBoundary: 'services/ECOSProjectQuestion.askECOSProjectQuestion',
  },
  documentReadiness: { passed: true },
  summary: { total: definition.cases.length, passed: definition.cases.length, failed: 0, passRate: 1 },
  cases: definition.cases.map(item => ({ id: item.id, passed: true })),
};
assert.deepEqual(validateLiveAcceptanceResult(validLiveResult, definition, now), []);
const staleFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  completedAt: '2026-08-04T12:30:00.000Z',
}, definition, now);
assert(staleFailures.some(item => item.includes('older than')));

const syntheticAcceptanceFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  executionBoundary: { ...validLiveResult.executionBoundary, clientSurface: 'acceptance' },
}, definition, now);
assert(syntheticAcceptanceFailures.some(item => item.includes('real supported customer surface')));

const transportEquivalentCliFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  executionBoundary: {
    ...validLiveResult.executionBoundary,
    mode: 'customer_transport_diagnostic',
    invocationMode: 'transport_equivalent_cli',
    appInvocationBoundary: null,
  },
}, definition, now);
assert(transportEquivalentCliFailures.some(item => item.includes('real application UI')));

const shadowReleaseFailures = validateLiveAcceptanceResult({
  ...validLiveResult,
  indexMode: 'shadow',
  executionBoundary: {
    ...validLiveResult.executionBoundary,
    mode: 'diagnostic_shadow',
    publicationMode: 'shadow',
    validationMode: 'shadow',
    serviceWorkerTokenUsed: true,
  },
}, definition, now);
assert(shadowReleaseFailures.some(item => item.includes('live published evidence')));

assert.equal(
  safeErrorMessage({
    message: 'permission denied for table reference_documents',
    code: '42501',
    details: 'RLS rejected the request',
    hint: null,
  }),
  'message: permission denied for table reference_documents; code: 42501; details: RLS rejected the request',
);
assert.equal(
  safeErrorMessage({ message: 'Bearer secret-token-value was rejected' }),
  'message: Bearer <redacted> was rejected',
);

void (async () => {
  const rpcCalls = [];
  const readinessClient = {
    rpc: async name => {
      rpcCalls.push(name);
      return {
        data: [{
          id: 'document-1',
          name: 'Current drawing',
          category: 'drawing',
          updated_at: '2026-08-21T00:00:00.000Z',
          document_data: {
            id: 'document-1',
            name: 'Current drawing',
            category: 'drawing',
            isCurrent: true,
            projectId: 'project-1',
          },
        }],
        error: null,
      };
    },
    from: () => {
      throw new Error('The readiness gate must not scan raw reference document payloads.');
    },
  };
  const readiness = await loadDocumentReadiness({
    client: readinessClient,
    project: { id: 'project-1', name: 'Project 1' },
    definition: { cases: [] },
  });
  assert.deepEqual(rpcCalls, ['dave_list_reference_document_metadata']);
  assert.equal(readiness.passed, true);

  const query = data => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject),
    };
    return chain;
  };
  const hostedDocumentClient = {
    rpc: async () => ({
      data: [{
        id: 'document-1',
        name: 'Current drawing',
        category: 'drawing',
        document_data: {
          id: 'document-1',
          name: 'Current drawing',
          category: 'drawing',
          isCurrent: true,
          projectId: 'project-1',
          sourcePageCount: 1,
          extractionStatus: 'complete',
          documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
          contentSha256: SOURCE_SHA,
          indexedContentSha256: SOURCE_SHA,
        },
      }],
      error: null,
    }),
    from: () => {
      throw new Error('Hosted live readiness must not read the obsolete live page index.');
    },
  };
  const hostedOperatorClient = {
    rpc: async name => {
      if (name === 'ecos_load_hosted_shadow_page_identity_pairs_v22') {
        return {
          data: [{
            job_id: 'job-1',
            document_id: 'document-1',
            page_number: 1,
            source_sha256: SOURCE_SHA,
            evidence_version: 'ecos-hosted-evidence/1.3',
            sheet_number: 'C1',
            sheet_mapping_status: 'verified',
            assurance_result: { accepted: true },
          }],
          error: null,
        };
      }
      if (name === 'ecos_load_hosted_shadow_page_context_v21') {
        return {
          data: [{
            job_id: 'job-1',
            document_id: 'document-1',
            page_number: 1,
            source_sha256: SOURCE_SHA,
            evidence_version: 'ecos-hosted-evidence/1.3',
            final_page_data: {
              pageNumber: 1,
              sourceSha256: SOURCE_SHA,
              sheetNumber: 'C1',
              sheetMappingStatus: 'verified',
              visualCoverage: visualCoverageFixture(1),
            },
            assurance_result: { accepted: true },
          }],
          error: null,
        };
      }
      throw new Error(`Unexpected hosted readiness RPC: ${name}`);
    },
    from: table => {
      if (table === 'ecos_hosted_index_jobs') {
        return query([{
          id: 'job-1',
          document_id: 'document-1',
          source_sha256: SOURCE_SHA,
          source_page_count: 1,
          completed_page_count: 1,
          assured_page_count: 1,
          unresolved_region_count: 0,
          state: 'ready',
          mode: 'shadow',
          updated_at: '2026-09-09T00:00:00.000Z',
        }]);
      }
      throw new Error(`Unexpected hosted readiness table: ${table}`);
    },
  };
  const hostedReadiness = await loadDocumentReadiness({
    client: hostedDocumentClient,
    shadowClient: hostedOperatorClient,
    shadowValidation: false,
    hostedReadiness: true,
    project: { id: 'project-1', name: 'Project 1' },
    definition: {
      cases: [{
        expectedEvidence: [{
          documentNamePattern: 'Current drawing',
          sheetNumberPatterns: ['^C1$'],
          pageNumberPatterns: ['^1$'],
          requireHighResolutionCoverage: true,
        }],
      }],
    },
  });
  assert.equal(hostedReadiness.passed, true, hostedReadiness.failures.join('\n'));
  assert.equal(hostedReadiness.checkedPages, 1);
  assert.equal(hostedReadiness.checkedDocuments[0].indexMode, 'hosted-live');

  // REL-01 closure: a one-line change to the answering runtime (not this
  // repository) must invalidate a previously recorded live run.
  {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { runtimeContractFiles, runtimeRepoRoot } = require('./ecos-ask-live-acceptance-lib');
    const source = runtimeRepoRoot();
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-runtime-copy-'));
    for (const relativePath of runtimeContractFiles(source)) {
      fs.mkdirSync(path.dirname(path.join(copy, relativePath)), { recursive: true });
      fs.copyFileSync(path.join(source, relativePath), path.join(copy, relativePath));
    }
    const before = acceptanceContractHash();
    const previousEnv = process.env.ECOS_RUNTIME_REPO;
    process.env.ECOS_RUNTIME_REPO = copy;
    try {
      assert.equal(acceptanceContractHash(), before, 'An identical runtime copy must hash the same');
      const candidate = path.join(copy, 'supabase/functions/ecos-ask-project-candidate/index.ts');
      fs.appendFileSync(candidate, '\n// one-line change\n');
      assert.notEqual(acceptanceContractHash(), before, 'A runtime change must change the contract hash');
      const stale = validateLiveAcceptanceResult(validLiveResult, definition, now);
      assert(stale.some(item => item.includes('changed after the live run')), 'Stale evidence must be rejected');
    } finally {
      if (previousEnv === undefined) delete process.env.ECOS_RUNTIME_REPO; else process.env.ECOS_RUNTIME_REPO = previousEnv;
      fs.rmSync(copy, { recursive: true, force: true });
    }
  }

  console.log(`Ask ECOS live acceptance contracts PASS (${definition.cases.length} real-world cases; 100% required).`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
