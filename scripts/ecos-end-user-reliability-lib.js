const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const defaultMatrixPath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'ask-ecos-end-user-reliability-matrix.json',
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadEndUserReliabilityMatrix(filePath = defaultMatrixPath) {
  const matrix = readJson(filePath);
  const problems = validateEndUserReliabilityMatrix(matrix);
  if (problems.length > 0) {
    throw new Error(`Ask ECOS end-user reliability matrix is invalid:\n- ${problems.join('\n- ')}`);
  }
  return matrix;
}

function validateEndUserReliabilityMatrix(matrix) {
  const problems = [];
  if (matrix?.schemaVersion !== 'ecos-end-user-reliability-matrix/2.0') {
    problems.push('schemaVersion must be ecos-end-user-reliability-matrix/2.0.');
  }
  if (matrix?.requiredPassRate !== 1) problems.push('requiredPassRate must be 1.');
  if (matrix?.repeatCount !== 3) problems.push('repeatCount must be 3.');
  if (matrix?.requireUniqueTracePerAttempt !== true) problems.push('Every attempt must require a unique trace.');
  if (matrix?.requirePersistedDiagnostics !== true) problems.push('Every attempt must require persisted diagnostics.');
  if (matrix?.requireOpenableCitations !== true) problems.push('Every citation must be opened through the app.');
  if (!Number.isFinite(matrix?.maximumP95LatencyMs) || matrix.maximumP95LatencyMs > 60000) {
    problems.push('maximumP95LatencyMs must be no greater than 60000.');
  }
  if (JSON.stringify(matrix?.requiredClientSurfaces) !== JSON.stringify(['web', 'iphone', 'ipad'])) {
    problems.push('The exact required surfaces are web, iphone, and ipad.');
  }
  const releasePath = matrix?.releaseDecisionPath || {};
  if (releasePath.mode !== 'customer_path_only') problems.push('Only the customer path may make the release decision.');
  if (releasePath.functionSlug !== 'ecos-ask-project') problems.push('The customer path must call ecos-ask-project.');
  if (releasePath.requestTransport !== 'supabase_functions_invoke') {
    problems.push('The customer path must use the same Supabase Functions transport as the app.');
  }
  if (releasePath.invocationMode !== 'app_ui' ||
    releasePath.appInvocationBoundary !== 'services/ECOSProjectQuestion.askECOSProjectQuestion') {
    problems.push('Release evidence must be submitted through the real Ask ECOS application UI boundary.');
  }
  if (releasePath.authentication !== 'signed_in_user') problems.push('The customer path must use a signed-in user session.');
  if (releasePath.publicationMode !== 'live' || releasePath.validationMode !== null) {
    problems.push('Release evidence must use live publication without shadow validation mode.');
  }
  if (releasePath.serviceWorkerTokenAllowed !== false) problems.push('Customer-path requests must not use a service-worker token.');
  if (releasePath.privateDiagnosticResultsCanRelease !== false) {
    problems.push('Private diagnostic results must not be release-authoritative.');
  }
  const stages = matrix?.stagedExecution || {};
  if (stages.canonicalFirstPassCaseCount !== 34) problems.push('The first customer pass must contain all 34 canonical cases.');
  if (stages.repairBeforeRepeatOnFailure !== true) problems.push('Failures must be grouped and repaired before a repeat.');
  if (stages.languageFirstPassAttemptCount !== 30) problems.push('The language first pass must contain all 30 user-wording attempts.');
  if (stages.repeatOnlyAfterPerfectFirstPass !== true || stages.repeatCycleCountAfterFirstPass !== 2) {
    problems.push('Two repeat cycles may run only after a perfect first pass.');
  }
  if (JSON.stringify(matrix?.requiredGradeDimensions) !== JSON.stringify([
    'delivery', 'answer', 'citation', 'proof', 'safety',
  ])) {
    problems.push('Delivery, answer, citation, proof, and safety must be graded independently.');
  }
  if (!Array.isArray(matrix?.canonicalSuites) || matrix.canonicalSuites.length !== 2) {
    problems.push('Both sealed project suites are required.');
  }

  const canonicalCases = new Map();
  for (const relativePath of matrix?.canonicalSuites || []) {
    const absolutePath = path.resolve(repoRoot, relativePath);
    if (!absolutePath.startsWith(`${repoRoot}${path.sep}`) || !fs.existsSync(absolutePath)) {
      problems.push(`Canonical suite is unavailable: ${relativePath}.`);
      continue;
    }
    const suite = readJson(absolutePath);
    for (const testCase of suite.cases || []) {
      canonicalCases.set(`${suite.projectName}::${testCase.id}`, testCase);
    }
  }

  const families = Array.isArray(matrix?.families) ? matrix.families : [];
  if (families.length < 10) problems.push('At least 10 end-user language families are required.');
  const familyIds = new Set();
  const variants = new Set();
  const tags = new Set();
  for (const family of families) {
    if (!text(family?.id) || familyIds.has(family.id)) problems.push(`Family id is missing or repeated: ${family?.id || '<missing>'}.`);
    familyIds.add(family?.id);
    const key = `${text(family?.projectName)}::${text(family?.canonicalCaseId)}`;
    if (!canonicalCases.has(key)) problems.push(`Family ${family?.id} has no exact canonical case ${key}.`);
    const familyVariants = Array.isArray(family?.variants) ? family.variants.map(text).filter(Boolean) : [];
    if (familyVariants.length < 3 || new Set(familyVariants.map(normalize)).size !== familyVariants.length) {
      problems.push(`Family ${family?.id} requires at least three unique variants.`);
    }
    for (const variant of familyVariants) {
      const key = normalize(variant);
      if (variants.has(key)) problems.push(`Question variant is repeated: ${variant}.`);
      variants.add(key);
      if (variant.length < 8 || variant.length > 1000) problems.push(`Question variant length is invalid: ${variant}.`);
    }
    for (const tag of family?.tags || []) tags.add(text(tag));
  }
  for (const requiredTag of ['user_reported', 'typo', 'synonym', 'safe_refusal', 'cross_document', 'trade_vocabulary']) {
    if (!tags.has(requiredTag)) problems.push(`The matrix is missing ${requiredTag} coverage.`);
  }
  return problems;
}

function buildEndUserAttempts(matrix) {
  const attempts = [];
  for (const family of matrix.families) {
    for (const question of family.variants) {
      for (let repeat = 1; repeat <= matrix.repeatCount; repeat += 1) {
        attempts.push(Object.freeze({
          id: `${family.id}:${sha256(question).slice(0, 12)}:${repeat}`,
          stage: repeat === 1 ? 'language_first_pass' : `language_repeat_${repeat}`,
          familyId: family.id,
          projectName: family.projectName,
          canonicalCaseId: family.canonicalCaseId,
          question,
          repeat,
        }));
      }
    }
  }
  return Object.freeze(attempts);
}

function validateEndUserReliabilityResult(matrix, result) {
  const failures = [];
  const boundary = result?.executionBoundary || {};
  const expectedBoundary = matrix.releaseDecisionPath;
  if (result?.schemaVersion !== 'ecos-customer-path-qualification/1.0') {
    failures.push('Qualification result schema is invalid.');
  }
  for (const key of [
    'mode', 'functionSlug', 'requestTransport', 'invocationMode', 'appInvocationBoundary',
    'authentication', 'publicationMode',
  ]) {
    if (boundary[key] !== expectedBoundary[key]) failures.push(`Customer execution boundary ${key} is invalid.`);
  }
  if (boundary.validationMode !== null) failures.push('Customer qualification must not use shadow validation mode.');
  if (boundary.serviceWorkerTokenUsed !== false) failures.push('Customer qualification must not use a service-worker token.');

  const canonicalResults = Array.isArray(result?.canonicalResults) ? result.canonicalResults : [];
  if (canonicalResults.length !== matrix.stagedExecution.canonicalFirstPassCaseCount) {
    failures.push('The complete 34-question canonical customer-path pass is missing.');
  }
  if (canonicalResults.some(item => item?.passed !== true)) {
    failures.push('Every canonical customer-path case must pass before language repeats.');
  }
  const attempts = Array.isArray(result?.attempts) ? result.attempts : [];
  const expected = buildEndUserAttempts(matrix);
  const expectedIds = new Set(expected.map(item => item.id));
  const actualIds = new Set(attempts.map(item => text(item?.id)));
  for (const id of expectedIds) if (!actualIds.has(id)) failures.push(`Missing required attempt ${id}.`);
  for (const id of actualIds) if (!expectedIds.has(id)) failures.push(`Unexpected attempt ${id}.`);
  if (attempts.some(item => item?.passed !== true)) failures.push('Every user-language attempt must pass.');

  const traceIds = attempts.map(item => text(item?.traceId)).filter(Boolean);
  const requestIds = attempts.map(item => text(item?.clientRequestId)).filter(Boolean);
  if (traceIds.length !== attempts.length || new Set(traceIds).size !== attempts.length) {
    failures.push('Every attempt must have one unique diagnostic trace id.');
  }
  if (requestIds.length !== attempts.length || new Set(requestIds).size !== attempts.length) {
    failures.push('Every attempt must have one unique client request id.');
  }
  if (attempts.some(item => item?.diagnosticsPersisted !== true)) {
    failures.push('Every attempt must persist its private diagnostics.');
  }
  if (attempts.some(item => item?.citationsOpenable !== true)) {
    failures.push('Every verified answer citation must open through the app.');
  }
  for (const attempt of [...canonicalResults, ...attempts]) {
    const grades = attempt?.dimensionGrades || {};
    for (const dimension of matrix.requiredGradeDimensions) {
      if (grades[dimension]?.passed !== true) {
        failures.push(`${text(attempt?.id) || 'Unknown attempt'} did not pass the ${dimension} grade.`);
      }
    }
  }

  const stages = Array.isArray(result?.stages) ? result.stages : [];
  const canonicalStage = stages.find(item => item?.id === 'canonical_first_pass');
  const languageStage = stages.find(item => item?.id === 'language_first_pass');
  if (!canonicalStage || canonicalStage.passed !== true || canonicalStage.completedBeforeRepeats !== true) {
    failures.push('The canonical first pass did not complete perfectly before repeats.');
  }
  if (!languageStage || languageStage.passed !== true || languageStage.completedBeforeRepeats !== true) {
    failures.push('The language first pass did not complete perfectly before repeats.');
  }

  const surfaceChecks = Array.isArray(result?.surfaceChecks) ? result.surfaceChecks : [];
  for (const surface of matrix.requiredClientSurfaces) {
    const row = surfaceChecks.find(item => item?.surface === surface);
    if (!row || row.passed !== true || row.usedUnifiedQuestionPath !== true ||
      row.questionSubmittedThroughUI !== true || row.requestTraceSurfaceMatches !== true ||
      row.citationOpened !== true) {
      failures.push(`${surface} did not pass the unified-path and citation-opening check.`);
    }
  }
  const latencies = attempts.map(item => Number(item?.latencyMs)).filter(Number.isFinite).sort((a, b) => a - b);
  if (latencies.length !== attempts.length) {
    failures.push('Every attempt must record end-to-end latency.');
  } else if (percentile(latencies, 0.95) > matrix.maximumP95LatencyMs) {
    failures.push(`P95 latency exceeded ${matrix.maximumP95LatencyMs} ms.`);
  }
  return failures;
}

function percentile(values, ratio) {
  if (values.length === 0) return Infinity;
  return values[Math.max(0, Math.ceil(values.length * ratio) - 1)];
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalize(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = {
  buildEndUserAttempts,
  defaultMatrixPath,
  loadEndUserReliabilityMatrix,
  validateEndUserReliabilityMatrix,
  validateEndUserReliabilityResult,
};
