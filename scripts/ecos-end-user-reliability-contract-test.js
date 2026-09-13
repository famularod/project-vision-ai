#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildEndUserAttempts,
  loadEndUserReliabilityMatrix,
  validateEndUserReliabilityMatrix,
  validateEndUserReliabilityResult,
} = require('./ecos-end-user-reliability-lib');

const matrix = loadEndUserReliabilityMatrix();
assert.deepEqual(validateEndUserReliabilityMatrix(matrix), []);
const attempts = buildEndUserAttempts(matrix);
assert.equal(attempts.length, 90, 'Ten families x three variants x three repeats are required.');
assert(attempts.some(item => item.question === 'What is the thickness of the new cement on the north lot?'));
assert(attempts.some(item => item.question === 'How many square feet is Canopy A?'));

const root = path.resolve(__dirname, '..');
const protectedPageService = fs.readFileSync(
  path.join(root, 'services/ECOSProtectedDocumentPage.ts'),
  'utf8',
);
const mobileProofHook = fs.readFileSync(
  path.join(root, 'hooks/use-ecos-document-evidence.ts'),
  'utf8',
);
const desktopProofPreview = fs.readFileSync(
  path.join(root, 'components/web-shell/desktop-document-proof-preview.tsx'),
  'utf8',
);
const customerPathProofTest = fs.readFileSync(
  path.join(root, 'tests/services/ecos-answer-proof-customer-path.test.ts'),
  'utf8',
);
const proofMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260913194700_ecos_reapply_atomic_contract_for_owner_runtime.sql'),
  'utf8',
);
assert(protectedPageService.includes("functions/v1/ecos-source-preview"));
assert(protectedPageService.includes("state !== 'current_exact_page_image'"));
assert(protectedPageService.includes('digest(bytes) !== locator.raster_sha256'));
assert(mobileProofHook.includes('proof.protectedPage'));
assert(desktopProofPreview.includes('renderECOSWebProtectedPageProofPreview'));
assert(customerPathProofTest.includes('currentCivilDrawing.storagePath).toBeUndefined()'));
assert(customerPathProofTest.includes('loadProtectedPage).toHaveBeenCalledTimes(1)'));
assert(proofMigration.includes('source_view_citation jsonb'));
assert(proofMigration.includes('ecos-owner-raster-source-locator/2.2'));
assert(!proofMigration.includes('owner_execution_current_source'));

const validResult = {
  schemaVersion: 'ecos-customer-path-qualification/1.0',
  executionBoundary: {
    ...matrix.releaseDecisionPath,
    serviceWorkerTokenUsed: false,
    appInvocationBoundary: 'services/ECOSProjectQuestion.askECOSProjectQuestion',
  },
  canonicalResults: Array.from({ length: 34 }, (_, index) => ({
    id: `canonical-${index + 1}`,
    passed: true,
    dimensionGrades: Object.fromEntries(matrix.requiredGradeDimensions.map(dimension => [
      dimension,
      { passed: true, failures: [] },
    ])),
  })),
  attempts: attempts.map((attempt, index) => ({
    ...attempt,
    passed: true,
    traceId: `trace-${String(index).padStart(3, '0')}`,
    clientRequestId: `request-${String(index).padStart(3, '0')}`,
    diagnosticsPersisted: true,
    citationsOpenable: true,
    latencyMs: 1000 + index,
    dimensionGrades: Object.fromEntries(matrix.requiredGradeDimensions.map(dimension => [
      dimension,
      { passed: true, failures: [] },
    ])),
  })),
  stages: [
    { id: 'canonical_first_pass', passed: true, completedBeforeRepeats: true },
    { id: 'language_first_pass', passed: true, completedBeforeRepeats: true },
  ],
  surfaceChecks: matrix.requiredClientSurfaces.map(surface => ({
    surface,
    passed: true,
    usedUnifiedQuestionPath: true,
    questionSubmittedThroughUI: true,
    requestTraceSurfaceMatches: true,
    citationOpened: true,
    proofRpcInvoked: true,
    protectedRasterOpened: true,
    originalSourceOpened: true,
  })),
};
assert.deepEqual(validateEndUserReliabilityResult(matrix, validResult), []);

const repeatedTrace = structuredClone(validResult);
repeatedTrace.attempts[1].traceId = repeatedTrace.attempts[0].traceId;
assert(validateEndUserReliabilityResult(matrix, repeatedTrace).some(item => item.includes('unique diagnostic')));

const failedCitation = structuredClone(validResult);
failedCitation.surfaceChecks.find(item => item.surface === 'iphone').citationOpened = false;
assert(validateEndUserReliabilityResult(matrix, failedCitation).some(item => item.includes('iphone')));

const shallowProof = structuredClone(validResult);
shallowProof.surfaceChecks.find(item => item.surface === 'web').protectedRasterOpened = false;
assert(validateEndUserReliabilityResult(matrix, shallowProof).some(item => item.includes('web')));

const unopenedOriginal = structuredClone(validResult);
unopenedOriginal.surfaceChecks.find(item => item.surface === 'ipad').originalSourceOpened = false;
assert(validateEndUserReliabilityResult(matrix, unopenedOriginal).some(item => item.includes('ipad')));

const shadowResult = structuredClone(validResult);
shadowResult.executionBoundary.validationMode = 'shadow';
assert(validateEndUserReliabilityResult(matrix, shadowResult).some(item => item.includes('shadow')));

const fakeSurface = structuredClone(validResult);
fakeSurface.surfaceChecks[0].questionSubmittedThroughUI = false;
assert(validateEndUserReliabilityResult(matrix, fakeSurface).some(item => item.includes('web')));

const failedDimension = structuredClone(validResult);
failedDimension.attempts[0].dimensionGrades.proof.passed = false;
assert(validateEndUserReliabilityResult(matrix, failedDimension).some(item => item.includes('proof grade')));

const slowResult = structuredClone(validResult);
slowResult.attempts.slice(-6).forEach(item => { item.latencyMs = 60001; });
assert(validateEndUserReliabilityResult(matrix, slowResult).some(item => item.includes('P95 latency')));

console.log('Ask ECOS customer-path qualification contract PASS: 34 canonical cases, staged language repeats, five independent grades, and real web/iPhone/iPad UI evidence are mandatory.');
