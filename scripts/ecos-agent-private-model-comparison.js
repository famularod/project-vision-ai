#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
  evaluateAcceptanceCase,
  normalizeAssuredShadowPageRow,
} = require('./ecos-ask-live-acceptance-lib');
const {
  compareQualityFirstModelScores,
} = require('./ecos-agent-model-selection');
const {
  mintCloudRunIdToken,
} = require('./ecos-agent-google-wif-token');

const ROOT = path.resolve(__dirname, '..');
const MATRIX_PATH = path.join(
  ROOT,
  'validation',
  'ecos',
  'ask-ecos-end-user-reliability-matrix.json',
);
const MISSING_EVIDENCE_CASES_PATH = path.join(
  ROOT,
  'validation',
  'ecos',
  'ask-ecos-missing-evidence-cases.json',
);
const OUTPUT_PATH = text(process.env.ECOS_AGENT_COMPARISON_OUTPUT)
  ? path.resolve(ROOT, text(process.env.ECOS_AGENT_COMPARISON_OUTPUT))
  : path.join(
    ROOT,
    'validation',
    'output',
    'ecos-agent-private-model-comparison.json',
  );
const FUNCTION_SLUG = 'ecos-ask-project-candidate';
const AGENT_RUNTIME_URL = text(process.env.ECOS_AGENT_COMPARISON_URL).replace(/\/+$/, '');
const AGENT_RUNTIME_GATEWAY_TOKEN = text(
  process.env.ECOS_AGENT_COMPARISON_GATEWAY_TOKEN,
);
let agentRuntimeServerlessAuthorization = text(
  process.env.ECOS_AGENT_SERVERLESS_AUTHORIZATION,
);
const WIF_PROVIDER_RESOURCE = text(process.env.ECOS_AGENT_WIF_PROVIDER_RESOURCE);
const WIF_SERVICE_ACCOUNT = text(process.env.ECOS_AGENT_WIF_SERVICE_ACCOUNT);
const SERVERLESS_AUDIENCE = text(process.env.ECOS_AGENT_SERVERLESS_AUDIENCE);
const EMBEDDING_PROVIDER_URL = text(
  process.env.ECOS_AGENT_EMBEDDING_PROVIDER_URL,
).replace(/\/+$/, '');
const EXPECTED_RUNTIME_PACKAGE_SHA256 = canonicalSha256(
  process.env.ECOS_AGENT_EXPECTED_PACKAGE_SHA256,
);
const QUESTION_DELAY_MS = boundedInteger(
  process.env.ECOS_PRIVATE_QUESTION_DELAY_MS,
  10_000,
  60_000,
  10_000,
);
const REQUEST_TIMEOUT_MS = 125_000;
const MAXIMUM_REQUEST_ATTEMPTS = 3;
const STALE_OPERATION_RETRY_MS = 125_000;
const PRIVATE_QUESTION_HOURLY_LIMIT = 60;
const MODEL_EVALUATION_FAILURE_CODES = new Set([
  'agent_model_turn_limit_reached',
  'agent_provider_output_invalid',
  'agent_research_required',
  'agent_tool_call_limit_reached',
  'agent_output_schema_invalid',
  'agent_output_json_invalid',
]);
const REPETITIONS = boundedInteger(
  process.env.ECOS_AGENT_COMPARISON_REPETITIONS,
  1,
  3,
  2,
);
const MODEL_PROFILES = Object.freeze([
  Object.freeze({
    model: 'gpt-5.6-luna',
    inputUsdPerMillionTokens: 0.2,
    cachedInputUsdPerMillionTokens: 0.02,
    outputUsdPerMillionTokens: 1.2,
  }),
  Object.freeze({
    model: 'gpt-5.6-terra',
    inputUsdPerMillionTokens: 2,
    cachedInputUsdPerMillionTokens: 0.2,
    outputUsdPerMillionTokens: 12,
  }),
  Object.freeze({
    model: 'gpt-5.6-sol',
    inputUsdPerMillionTokens: 4,
    cachedInputUsdPerMillionTokens: 0.4,
    outputUsdPerMillionTokens: 20,
  }),
  Object.freeze({
    model: 'deepseek-v4-flash',
    inputUsdPerMillionTokens: 0.14,
    cachedInputUsdPerMillionTokens: 0.0028,
    outputUsdPerMillionTokens: 0.28,
  }),
]);
const SELECTED_MODEL_PROFILES = selectedModelProfiles();
const VARIANT_MODE = selectedVariantMode();
const SELECTED_ACTIVITY_CLASSES = selectedActivityClasses();
const COMPARISON_PRESET = selectedComparisonPreset();
const EXACT_DRAWING_FAMILY_IDS = Object.freeze([
  '2375-concrete-thickness-natural-language',
  '2375-canopy-a-area',
  '2375-canopy-lighting',
  '2321-canopy-slab-thickness',
  '2321-exhaust-fan-airflow',
]);
const NATURAL_LANGUAGE_CASE_VARIANTS = Object.freeze([
  Object.freeze({
    familyId: '2375-concrete-thickness-natural-language',
    variantIndex: 0,
  }),
  Object.freeze({
    familyId: '2375-concrete-thickness-noisy-input',
    variantIndex: 0,
  }),
  Object.freeze({ familyId: '2375-canopy-a-area', variantIndex: 4 }),
  Object.freeze({ familyId: '2321-exhaust-fan-airflow', variantIndex: 4 }),
  Object.freeze({
    familyId: '2321-installed-tree-negative-control',
    variantIndex: 4,
  }),
]);
const DEFAULT_FAMILY_IDS = Object.freeze([
  '2375-concrete-thickness-natural-language',
  '2375-concrete-thickness-noisy-input',
  '2375-installed-versus-design-limit',
  '2375-canopy-a-area',
  '2321-exhaust-fan-airflow',
  '2321-installed-tree-negative-control',
]);

async function main() {
  const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = required('SUPABASE_ANON_KEY');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const serviceWorkerToken = required('ECOS_SERVICE_WORKER_TOKEN');
  if (AGENT_RUNTIME_URL && !AGENT_RUNTIME_GATEWAY_TOKEN) {
    throw new Error('private_agent_runtime_gateway_token_missing');
  }
  if (AGENT_RUNTIME_URL && !EXPECTED_RUNTIME_PACKAGE_SHA256) {
    throw new Error('private_agent_runtime_expected_package_missing');
  }
  if (AGENT_RUNTIME_URL && !EMBEDDING_PROVIDER_URL) {
    throw new Error('private_embedding_provider_url_missing');
  }
  const questionUrl = AGENT_RUNTIME_URL
    ? `${AGENT_RUNTIME_URL}/question`
    : `${supabaseUrl}/functions/v1/${FUNCTION_SLUG}`;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (EMBEDDING_PROVIDER_URL) {
    await assertPrivateEmbeddingProviderReady({
      url: EMBEDDING_PROVIDER_URL,
      serviceRoleKey,
      serviceWorkerToken,
    });
  }
  const cases = loadCases();
  const attempts = [];
  for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
    for (const evaluationCase of cases) {
      for (const profile of SELECTED_MODEL_PROFILES) {
        attempts.push({ ...evaluationCase, model: profile.model, repetition });
      }
    }
  }
  const projects = await loadExactProjects(admin, attempts);
  await assertPrivateQuestionCapacity({
    admin,
    ownerId: projects.ownerId,
    requiredSlots: attempts.length,
  });
  await assertNoActiveQuestions({ admin, ownerId: projects.ownerId });
  let runtimeBefore = null;
  const fixtureBefore = await captureDocumentFixture(admin, projects);
  const session = await createOwnerSession({
    admin,
    anonKey,
    ownerId: projects.ownerId,
    supabaseUrl,
  });
  const startedAt = new Date().toISOString();
  const results = [];
  let revocationVerified = false;
  let runError = null;

  try {
    await ensureServerlessAuthorization(session.accessToken);
    runtimeBefore = await readRuntimeIdentity();
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const project = projects.byName.get(attempt.projectName);
      if (!project) throw new Error('private_validation_project_missing');
      const requestStartedAt = Date.now();
      const response = await askCandidate({
        supabaseUrl,
        anonKey,
        accessToken: session.accessToken,
        serviceWorkerToken,
        project,
        question: attempt.question,
        model: attempt.model,
        questionUrl,
        agentRuntimeGatewayToken: AGENT_RUNTIME_GATEWAY_TOKEN,
        agentRuntimeServerlessAuthorization:
          agentRuntimeServerlessAuthorization,
      });
      const latencyMs = Date.now() - requestStartedAt;
      const pageRows = await loadCitationPageRows(admin, response);
      const evaluated = evaluateAcceptanceCase(
        { ...attempt.canonicalCase, id: attempt.id, question: attempt.question },
        response,
        { projectName: project.name, pageRows },
      );
      const projectIsolationPreserved = drawingProjectIsolationPreserved({
        response,
        project,
        projectName: attempt.projectName,
        fixture: fixtureBefore,
      });
      const diagnostics = record(response.diagnostics);
      const agentDiagnostics = record(response.agentEvaluationDiagnostics);
      const failures = [
        ...evaluated.failures,
        ...(text(response.projectId) === project.id
          ? []
          : ['Response is not bound to the exact selected project id.']),
        ...(projectIsolationPreserved
          ? []
          : ['Answer cited a document outside the frozen selected-project inventory.']),
        ...(text(agentDiagnostics.errorCode)
          ? [`Agent model failure: ${text(agentDiagnostics.errorCode)}.`]
          : []),
        ...(response.validationMode === 'shadow'
          ? []
          : ['Response did not identify protected shadow validation mode.']),
        ...(latencyMs <= 60_000
          ? []
          : [`Latency ${latencyMs} ms exceeded the 60-second beta ceiling.`]),
      ];
      const passed = failures.length === 0;
      const usage = normalizedUsage(agentDiagnostics.usage);
      const proofFingerprint = citationProofFingerprint(response);
      const proofRegionFingerprint = citationRegionFingerprint(response);
      results.push({
        id: attempt.id,
        familyId: attempt.familyId,
        activityClass: attempt.activityClass,
        model: attempt.model,
        repetition: attempt.repetition,
        projectName: attempt.projectName,
        questionSha256: sha256(attempt.question),
        answerSha256: sha256(text(response.answer)),
        passed,
        failures,
        latencyMs,
        assuranceStatus: text(response.assurance?.status),
        verifiedFactCount: Number(response.assurance?.verifiedFactCount) || 0,
        citationCount: evaluated.citations.length,
        citationsOpenable: evaluated.citations.length > 0 &&
          evaluated.dimensionGrades.citation.passed &&
          evaluated.dimensionGrades.proof.passed,
        projectIsolationPreserved,
        proofFingerprint,
        proofRegionFingerprint,
        agent: {
          modelTurns: positiveInteger(agentDiagnostics.modelTurns),
          toolCalls: positiveInteger(agentDiagnostics.toolCalls),
          successfulResearchCalls: positiveInteger(
            agentDiagnostics.successfulResearchCalls,
          ),
          elapsedMs: Math.max(0, Number(agentDiagnostics.elapsedMs) || 0),
          usage,
          traceSha256: sha256(JSON.stringify(agentDiagnostics.toolTrace || [])),
        },
        traceId: text(diagnostics.traceId),
        clientRequestId: text(diagnostics.clientRequestId),
        evidenceSnapshotId: text(diagnostics.evidenceSnapshotId),
        evidenceDossierId: text(diagnostics.evidenceDossierId),
        evidenceSnapshotSha256: text(diagnostics.evidenceSnapshotSha256),
        evidenceDossierSha256: text(diagnostics.evidenceDossierSha256),
        persisted: diagnostics.persisted === true,
        replayed: diagnostics.replayed === true,
      });
      console.log(
        `[${index + 1}/${attempts.length}] ${passed ? 'PASS' : 'FAIL'} ` +
          `${attempt.model} ${attempt.familyId} repeat-${attempt.repetition} ${latencyMs}ms`,
      );
      failures.forEach((failure) => console.log(`- ${failure}`));
      if (index < attempts.length - 1) await wait(QUESTION_DELAY_MS);
    }
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
  } finally {
    revocationVerified = await revokeOwnerSession({ admin, session });
  }

  let fixtureAfter = null;
  let fixtureReadFailure = null;
  try {
    fixtureAfter = await retryPrivateCleanupRead(
      () => captureDocumentFixture(admin, projects),
    );
  } catch (error) {
    fixtureReadFailure = safeError(error);
  }
  const fixtureStable = Boolean(
    fixtureAfter && fixtureBefore.snapshotSha256 === fixtureAfter.snapshotSha256,
  );
  let runtimeAfter = null;
  let runtimeIdentityFailure = null;
  try {
    runtimeAfter = await readRuntimeIdentity();
  } catch (error) {
    runtimeIdentityFailure = safeError(error);
  }
  const runtimeStable = !AGENT_RUNTIME_URL || Boolean(
    runtimeBefore && runtimeAfter &&
      stableStringify(runtimeBefore) === stableStringify(runtimeAfter),
  );
  const traceIds = results.map((item) => item.traceId).filter(Boolean);
  const dossierIds = results.map((item) => item.evidenceDossierId).filter(Boolean);
  const latencies = results.map((item) => item.latencyMs).sort((a, b) => a - b);
  const integrityFailures = [
    ...(results.length === attempts.length ? [] : ['Not every matrix question completed.']),
    ...(new Set(traceIds).size === attempts.length ? [] : ['Trace identities were not unique and complete.']),
    ...(new Set(dossierIds).size === attempts.length ? [] : ['Dossier identities were not unique and complete.']),
    ...(results.every((item) => item.persisted) ? [] : ['One or more private traces were not persisted.']),
    ...(results.every((item) => item.replayed === false)
      ? []
      : ['One or more attempts replayed an earlier answer.']),
    ...(revocationVerified ? [] : ['Temporary owner session revocation was not verified.']),
    ...(fixtureStable
      ? []
      : ['Current-document inventory changed during the comparison.']),
    ...(fixtureReadFailure
      ? [`Post-run document fixture read failed: ${fixtureReadFailure}`]
      : []),
    ...(runtimeStable
      ? []
      : ['Private runtime identity changed during the comparison.']),
    ...(runtimeIdentityFailure
      ? [`Private runtime readback failed: ${runtimeIdentityFailure}`]
      : []),
    ...(runError ? [`Run stopped safely: ${runError}`] : []),
  ];
  const passedCount = results.filter((item) => item.passed).length;
  const scores = SELECTED_MODEL_PROFILES.map((profile) =>
    scoreModel(profile, results.filter((item) => item.model === profile.model))
  ).sort(compareQualityFirstModelScores);
  const activityScores = [...new Set(results.map((item) => item.activityClass))]
    .sort()
    .map((activityClass) => ({
      activityClass,
      scores: SELECTED_MODEL_PROFILES.map((profile) =>
        scoreModel(
          profile,
          results.filter((item) =>
            item.model === profile.model &&
            item.activityClass === activityClass
          ),
        )
      ).sort(compareQualityFirstModelScores),
    }));
  const receipt = {
    schemaVersion: 'ecos-agent-private-model-comparison/1.0',
    validationMode: 'shadow',
    functionSlug: FUNCTION_SLUG,
    questionTransport: AGENT_RUNTIME_URL
      ? 'private_cloud_run_agent_runtime'
      : 'supabase_edge_candidate',
    retrievalContract: 'ecos-evidence-retrieval/2.3',
    matrixSha256: sha256(fs.readFileSync(MATRIX_PATH)),
    startedAt,
    completedAt: new Date().toISOString(),
    questionDelayMs: QUESTION_DELAY_MS,
    repetitions: REPETITIONS,
    preset: COMPARISON_PRESET || null,
    variantMode: VARIANT_MODE,
    activityClasses: [...new Set(cases.map((item) => item.activityClass))]
      .sort(),
    models: SELECTED_MODEL_PROFILES.map((profile) => profile.model),
    caseIds: cases.map((item) => item.id),
    runtime: runtimeBefore,
    fixture: publicFixtureReceipt(fixtureBefore),
    summary: {
      total: attempts.length,
      passed: passedCount,
      failed: attempts.length - passedCount,
      p95LatencyMs: percentile(latencies, 0.95),
      maximumLatencyMs: latencies.at(-1) || 0,
      uniqueTraceCount: new Set(traceIds).size,
      uniqueDossierCount: new Set(dossierIds).size,
      fixtureStable,
      runtimeStable,
      integrityFailures,
      sessionRevocationVerified: revocationVerified,
      scores,
      activityScores,
      preliminaryRecommendedModel:
        scores.find((score) => score.eligibleForRecommendation)?.model || null,
    },
    results,
  };
  atomicWrite(OUTPUT_PATH, receipt);
  const receiptSha256 = sha256(fs.readFileSync(OUTPUT_PATH));
  console.log(JSON.stringify({
    output: path.relative(ROOT, OUTPUT_PATH),
    receiptSha256,
    summary: receipt.summary,
  }, null, 2));
  if (passedCount !== attempts.length || integrityFailures.length > 0) {
    process.exitCode = 1;
  }
}

async function assertPrivateEmbeddingProviderReady({
  url,
  serviceRoleKey,
  serviceWorkerToken,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'x-ecos-worker-token': serviceWorkerToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: ['private model qualification readiness probe'],
        dimensions: 1536,
        encoding_format: 'float',
      }),
    });
    const payload = await response.json().catch(() => null);
    const rows = record(payload).data;
    const embedding = Array.isArray(rows) && rows.length === 1
      ? record(rows[0]).embedding
      : null;
    if (
      !response.ok || !Array.isArray(embedding) || embedding.length !== 1536 ||
      embedding.some((value) => !Number.isFinite(Number(value)))
    ) {
      throw new Error(
        `private_embedding_provider_preflight_failed:${response.status}`,
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('private_embedding_provider_preflight_failed:')
    ) {
      throw error;
    }
    throw new Error(
      error instanceof Error && error.name === 'AbortError'
        ? 'private_embedding_provider_preflight_timed_out'
        : 'private_embedding_provider_preflight_failed:transport',
    );
  } finally {
    clearTimeout(timeout);
  }
}

function selectedModelProfiles() {
  const configured = text(process.env.ECOS_AGENT_COMPARISON_MODELS)
    .split(',')
    .map(text)
    .filter(Boolean);
  if (configured.length === 0) return MODEL_PROFILES;
  if (new Set(configured).size !== configured.length) {
    throw new Error('agent_comparison_duplicate_model');
  }
  const byName = new Map(MODEL_PROFILES.map((profile) => [profile.model, profile]));
  const selected = configured.map((model) => byName.get(model));
  if (selected.some((profile) => !profile)) {
    throw new Error('agent_comparison_model_not_allowed');
  }
  return Object.freeze(selected);
}

function selectedVariantMode() {
  const configured = text(process.env.ECOS_AGENT_COMPARISON_VARIANT_MODE) ||
    'first';
  if (!['first', 'all'].includes(configured)) {
    throw new Error('agent_comparison_variant_mode_invalid');
  }
  return configured;
}

function selectedActivityClasses() {
  return new Set(
    text(process.env.ECOS_AGENT_COMPARISON_ACTIVITY_CLASSES)
      .split(',')
      .map(text)
      .filter(Boolean),
  );
}

function selectedComparisonPreset() {
  const preset = text(process.env.ECOS_AGENT_COMPARISON_PRESET);
  if (!preset) return '';
  if (![
    'exact-drawing-and-specification-lookup',
    'natural-language-and-field-wording',
    'missing-evidence-and-incomplete-search',
  ].includes(preset)) {
    throw new Error('agent_comparison_preset_invalid');
  }
  return preset;
}

async function assertPrivateQuestionCapacity({ admin, ownerId, requiredSlots }) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('dave_ai_operation_requests')
    .select('started_at')
    .eq('owner_id', ownerId)
    .eq('operation_type', 'project_question')
    .gt('started_at', since)
    .order('started_at', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  const availableSlots = Math.max(
    0,
    PRIVATE_QUESTION_HOURLY_LIMIT - rows.length,
  );
  if (availableSlots >= requiredSlots) return;
  const slotsThatMustClear = requiredSlots - availableSlots;
  const clearanceRow = rows[slotsThatMustClear - 1];
  const clearanceTime = Date.parse(clearanceRow?.started_at || '') +
    60 * 60 * 1000 + 2_000;
  const fullWindowAt = Number.isFinite(clearanceTime)
    ? new Date(clearanceTime).toISOString()
    : 'unknown';
  throw new Error(
    `private_validation_capacity_insufficient:${availableSlots}/${requiredSlots}:full_window_at_${fullWindowAt}`,
  );
}

async function assertNoActiveQuestions({ admin, ownerId }) {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from('dave_ai_operation_requests')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('operation_type', 'project_question')
    .eq('status', 'processing')
    .gt('started_at', cutoff);
  if (error) throw error;
  if ((count || 0) !== 0) {
    throw new Error(`private_validation_active_questions:${count}`);
  }
}

function loadCases() {
  const matrix = readJson(MATRIX_PATH);
  const configuredFamilyIds = text(process.env.ECOS_AGENT_COMPARISON_FAMILIES)
    .split(',')
    .map(text)
    .filter(Boolean);
  if (COMPARISON_PRESET && configuredFamilyIds.length > 0) {
    throw new Error('agent_comparison_preset_families_conflict');
  }
  const familyIds = COMPARISON_PRESET ===
      'exact-drawing-and-specification-lookup'
    ? [...EXACT_DRAWING_FAMILY_IDS]
    : COMPARISON_PRESET === 'natural-language-and-field-wording'
    ? NATURAL_LANGUAGE_CASE_VARIANTS.map(({ familyId }) => familyId)
    : configuredFamilyIds.length > 0
    ? configuredFamilyIds
    : [...DEFAULT_FAMILY_IDS];
  if (new Set(familyIds).size !== familyIds.length) {
    throw new Error('agent_comparison_duplicate_family');
  }
  const canonicalCases = new Map();
  for (const relativePath of matrix.canonicalSuites || []) {
    const suite = readJson(path.join(ROOT, relativePath));
    for (const testCase of suite.cases || []) {
      canonicalCases.set(`${suite.projectName}::${testCase.id}`, testCase);
    }
  }
  if (COMPARISON_PRESET === 'missing-evidence-and-incomplete-search') {
    const definition = readJson(MISSING_EVIDENCE_CASES_PATH);
    if (
      definition.schemaVersion !== 'ecos-agent-missing-evidence-cases/1.0' ||
      text(definition.activityClass) !== 'missing_evidence_and_safe_refusal' ||
      !Array.isArray(definition.cases) ||
      definition.cases.length !== 5
    ) {
      throw new Error('agent_comparison_missing_evidence_definition_invalid');
    }
    return definition.cases.map((testCase) => {
      const projectName = text(testCase.projectName);
      const canonicalCaseId = text(testCase.canonicalCaseId);
      const canonicalCase = canonicalCases.get(
        `${projectName}::${canonicalCaseId}`,
      );
      if (!canonicalCase) {
        throw new Error(
          `agent_comparison_missing_evidence_canonical_case_missing:${canonicalCaseId}`,
        );
      }
      const id = text(testCase.id);
      const question = text(testCase.question);
      if (!id || !question) {
        throw new Error('agent_comparison_missing_evidence_case_invalid');
      }
      return {
        id,
        familyId: id,
        activityClass: 'missing_evidence_and_safe_refusal',
        projectName,
        question,
        canonicalCase,
      };
    });
  }
  const families = new Map(
    (matrix.families || []).map((family) => [text(family.id), family]),
  );
  const selectedCases = familyIds.flatMap((familyId) => {
    const family = families.get(familyId);
    if (!family) throw new Error(`agent_comparison_family_missing:${familyId}`);
    const activityClass = text(family.activityClass);
    if (!activityClass) {
      throw new Error(`agent_comparison_activity_class_missing:${familyId}`);
    }
    if (
      SELECTED_ACTIVITY_CLASSES.size > 0 &&
      !SELECTED_ACTIVITY_CLASSES.has(activityClass)
    ) return [];
    const canonicalCase = canonicalCases.get(
      `${family.projectName}::${family.canonicalCaseId}`,
    );
    if (!canonicalCase) throw new Error('private_validation_canonical_case_missing');
    const variants = (family.variants || []).map(text).filter(Boolean);
    if (variants.length === 0) {
      throw new Error(`agent_comparison_variant_missing:${familyId}`);
    }
    const configuredCaseVariant = COMPARISON_PRESET ===
        'natural-language-and-field-wording'
      ? NATURAL_LANGUAGE_CASE_VARIANTS.find((item) =>
        item.familyId === familyId
      )
      : null;
    const selectedVariants = configuredCaseVariant
      ? [{
        question: variants[configuredCaseVariant.variantIndex],
        variantIndex: configuredCaseVariant.variantIndex,
      }]
      : (VARIANT_MODE === 'all' ? variants : variants.slice(0, 1)).map(
        (question, variantIndex) => ({ question, variantIndex }),
      );
    if (selectedVariants.some(({ question }) => !question)) {
      throw new Error(`agent_comparison_preset_variant_missing:${familyId}`);
    }
    return selectedVariants.map(({ question, variantIndex }) => ({
      id: `${family.id}-variant-${variantIndex + 1}`,
      familyId: text(family.id),
      activityClass,
      projectName: family.projectName,
      question,
      canonicalCase,
    }));
  });
  if (selectedCases.length === 0) {
    throw new Error('agent_comparison_activity_filter_empty');
  }
  return selectedCases;
}

async function loadExactProjects(admin, attempts) {
  const names = [...new Set(attempts.map((attempt) => attempt.projectName))];
  const { data, error } = await admin
    .from('projects')
    .select('id,name,owner_id')
    .eq('archived', false)
    .in('name', names);
  if (error) throw error;
  const rows = (data || []).filter((row) => names.includes(text(row.name)));
  if (rows.length !== names.length) throw new Error('private_validation_exact_projects_missing');
  if (names.some((name) => rows.filter((row) => text(row.name) === name).length !== 1)) {
    throw new Error('private_validation_project_identity_ambiguous');
  }
  const ownerIds = [...new Set(rows.map((row) => text(row.owner_id)).filter(Boolean))];
  if (ownerIds.length !== 1) throw new Error('private_validation_owner_identity_ambiguous');
  return {
    ownerId: ownerIds[0],
    names,
    byName: new Map(rows.map((row) => [text(row.name), { id: text(row.id), name: text(row.name) }])),
  };
}

async function captureDocumentFixture(admin, projects) {
  const rows = [];
  for (const projectName of projects.names) {
    const project = projects.byName.get(projectName);
    if (!project) throw new Error('private_validation_fixture_project_missing');
    const result = await admin.rpc(
      'ecos_list_hosted_shadow_question_documents_v22',
      { p_project_id: project.id, p_result_limit: 200 },
    );
    if (result.error) throw result.error;
    for (const raw of result.data || []) {
      const row = record(raw);
      const documentId = text(row.document_id);
      const sourceSha256 = canonicalSha256(row.source_sha256);
      if (!documentId || text(row.project_id) !== project.id || !sourceSha256) {
        throw new Error('private_validation_fixture_document_identity_invalid');
      }
      rows.push({
        projectName,
        projectIdSha256: sha256(project.id),
        documentId,
        documentIdSha256: sha256(documentId),
        documentName: text(row.document_name),
        category: text(row.category),
        revision: text(row.source_revision) || null,
        updatedAt: text(row.document_updated_at) || null,
        sourceSha256,
      });
    }
  }
  rows.sort((left, right) =>
    left.projectName.localeCompare(right.projectName) ||
    left.documentId.localeCompare(right.documentId)
  );
  if (rows.length === 0) throw new Error('private_validation_fixture_empty');
  return {
    capturedAt: new Date().toISOString(),
    rows,
    snapshotSha256: sha256(stableStringify(rows)),
  };
}

async function readRuntimeIdentity() {
  if (!AGENT_RUNTIME_URL) return null;
  const response = await fetch(`${AGENT_RUNTIME_URL}/status`, {
    method: 'GET',
    headers: agentRuntimeServerlessAuthorization
      ? {
        'x-serverless-authorization':
          `Bearer ${agentRuntimeServerlessAuthorization}`,
      }
      : {},
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  const packageSha256 = canonicalSha256(body?.packagedSourceSha256);
  const headerSha256 = canonicalSha256(
    response.headers.get('x-ecos-agent-packaged-source-sha256'),
  );
  if (
    !response.ok || body?.service !== 'ecos-agent-query-preview' ||
    body?.protocol !== 'ecos-agent-query-preview/1.0' ||
    body?.enabled !== true || body?.customerTraffic !== false ||
    packageSha256 !== EXPECTED_RUNTIME_PACKAGE_SHA256 ||
    headerSha256 !== EXPECTED_RUNTIME_PACKAGE_SHA256
  ) throw new Error('private_agent_runtime_identity_invalid');
  return {
    service: body.service,
    protocol: body.protocol,
    enabled: body.enabled,
    customerTraffic: body.customerTraffic,
    packagedSourceSha256: packageSha256,
  };
}

function publicFixtureReceipt(fixture) {
  return {
    capturedAt: fixture.capturedAt,
    counts: countBy(fixture.rows, (row) => row.projectName),
    snapshotSha256: fixture.snapshotSha256,
    documentIdentitySha256: sha256(JSON.stringify(
      fixture.rows.map((row) => row.documentIdSha256).sort(),
    )),
  };
}

function drawingProjectIsolationPreserved({
  response,
  project,
  projectName,
  fixture,
}) {
  if (
    text(response.projectId) !== project.id ||
    text(response.projectName) !== project.name
  ) return false;
  const allowedDocumentIds = new Set(
    fixture.rows
      .filter((row) => row.projectName === projectName)
      .map((row) => row.documentId),
  );
  const citedDocumentIds = (response.supportingEvidence || []).flatMap((item) => {
    const citation = record(item?.documentCitation);
    const documentId = text(citation.documentId);
    return item?.sourceType === 'document' && documentId ? [documentId] : [];
  });
  return citedDocumentIds.every((documentId) =>
    allowedDocumentIds.has(documentId)
  );
}

async function createOwnerSession({ admin, anonKey, ownerId, supabaseUrl }) {
  const user = await admin.auth.admin.getUserById(ownerId);
  const email = text(user.data?.user?.email);
  if (user.error || !email) throw new Error('private_validation_owner_user_missing');
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = text(link.data?.properties?.hashed_token);
  if (link.error || !tokenHash) throw new Error('private_validation_owner_link_failed');
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  const accessToken = text(verified.data?.session?.access_token);
  if (verified.error || !accessToken) throw new Error('private_validation_owner_session_failed');
  return { accessToken, client };
}

async function ensureServerlessAuthorization(ownerAccessToken) {
  if (!AGENT_RUNTIME_URL || agentRuntimeServerlessAuthorization) return;
  const configuration = [
    WIF_PROVIDER_RESOURCE,
    WIF_SERVICE_ACCOUNT,
    SERVERLESS_AUDIENCE,
  ];
  if (configuration.every(Boolean)) {
    agentRuntimeServerlessAuthorization = await mintCloudRunIdToken({
      subjectToken: ownerAccessToken,
      providerResource: WIF_PROVIDER_RESOURCE,
      serviceAccountEmail: WIF_SERVICE_ACCOUNT,
      serviceAudience: SERVERLESS_AUDIENCE,
    });
    return;
  }
  if (configuration.some(Boolean)) {
    throw new Error('private_serverless_wif_configuration_incomplete');
  }
}

async function revokeOwnerSession({ admin, session }) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const before = await session.client.auth.getUser(session.accessToken);
    if (authSessionRejected(before.error) || (!before.error && !before.data?.user)) {
      return true;
    }
    if (before.error) {
      await wait(cleanupRetryDelayMs(attempt));
      continue;
    }
    const revoked = await admin.auth.admin.signOut(session.accessToken, 'local');
    if (revoked.error) {
      await wait(cleanupRetryDelayMs(attempt));
      continue;
    }
    const after = await session.client.auth.getUser(session.accessToken);
    if (authSessionRejected(after.error) || (!after.error && !after.data?.user)) {
      return true;
    }
    if (attempt < 6) await wait(cleanupRetryDelayMs(attempt));
  }
  return false;
}

async function retryPrivateCleanupRead(operation) {
  let lastError = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 6) await wait(cleanupRetryDelayMs(attempt));
    }
  }
  throw lastError || new Error('private_cleanup_read_failed');
}

function cleanupRetryDelayMs(attempt) {
  return Math.min(10_000, 1_000 * (2 ** Math.max(0, attempt - 1)));
}

function authSessionRejected(error) {
  if (!error) return false;
  const status = Number(error.status);
  const message = text(error.message).toLowerCase();
  return status === 401 || status === 403 ||
    /(?:invalid|expired|revoked|missing)\s+(?:jwt|token|session)/.test(message) ||
    /session\s+(?:not\s+found|missing|revoked|expired)/.test(message);
}

async function askCandidate({
  supabaseUrl,
  anonKey,
  accessToken,
  serviceWorkerToken,
  project,
  question,
  model,
  questionUrl,
  agentRuntimeGatewayToken,
  agentRuntimeServerlessAuthorization,
}) {
  const clientRequestId = crypto.randomUUID();
  const evaluationAttemptId = crypto.randomUUID();
  let lastError = null;
  for (let attempt = 1; attempt <= MAXIMUM_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(
        questionUrl,
        {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'x-ecos-worker-token': serviceWorkerToken,
            ...(agentRuntimeGatewayToken
              ? { 'x-ecos-agent-gateway-token': agentRuntimeGatewayToken }
              : {}),
            ...(agentRuntimeServerlessAuthorization
              ? {
                'x-serverless-authorization':
                  `Bearer ${agentRuntimeServerlessAuthorization}`,
              }
              : {}),
          },
          body: JSON.stringify({
            schemaVersion: 'ecos-project-question/2.0',
            clientRequestId,
            clientSurface: 'web',
            projectId: project.id,
            projectName: project.name,
            question,
            validationMode: 'shadow',
            evaluationModel: model,
            evaluationAttemptId,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      const body = await response.json().catch(() => null);
      if (
        AGENT_RUNTIME_URL &&
        canonicalSha256(
            response.headers.get('x-ecos-agent-packaged-source-sha256'),
          ) !== EXPECTED_RUNTIME_PACKAGE_SHA256
      ) throw new Error('private_agent_runtime_response_identity_mismatch');
      if (response.ok) return body;
      const code = text(body?.error) || `http_${response.status}`;
      const agentFailureCode = text(body?.agentEvaluationDiagnostics?.errorCode);
      if (
        response.status === 502 && code === 'answer_invalid' &&
        MODEL_EVALUATION_FAILURE_CODES.has(agentFailureCode)
      ) {
        return body;
      }
      const retryable = response.status === 409 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAXIMUM_REQUEST_ATTEMPTS) {
        throw new Error(`Candidate returned ${response.status} (${code}).`);
      }
      const retryDelayMs = code === 'question_in_progress'
        ? STALE_OPERATION_RETRY_MS
        : Math.min(
          60,
          Math.max(2, Number(body?.retryAfterSeconds) || 5),
        ) * 1_000;
      await wait(retryDelayMs);
    } catch (error) {
      lastError = error;
      if (attempt === MAXIMUM_REQUEST_ATTEMPTS) throw error;
      await wait(attempt * 2_000);
    }
  }
  throw lastError || new Error('private_validation_request_failed');
}

async function loadCitationPageRows(admin, response) {
  const citations = (response.supportingEvidence || [])
    .map((item) => record(item.documentCitation))
    .filter((item) => text(item.documentId) && positiveInteger(item.pageNumber));
  const documentIds = [...new Set(citations.map((item) => text(item.documentId)))];
  const pageNumbers = [...new Set(citations.map((item) => positiveInteger(item.pageNumber)))];
  if (documentIds.length === 0 || pageNumbers.length === 0) return [];
  const result = await admin.rpc('ecos_load_hosted_shadow_page_context_v21', {
    p_document_ids: documentIds,
    p_page_numbers: pageNumbers,
    p_result_limit: 100,
  });
  if (result.error) throw result.error;
  return (result.data || []).flatMap((page) =>
    normalizeAssuredShadowPageRow({
      ...page,
      state: 'assured',
      unresolved_region_count: 0,
    })
  );
}

function normalizedUsage(value) {
  const usage = record(value);
  return {
    inputTokens: Math.max(0, Number(usage.inputTokens) || 0),
    cachedInputTokens: Math.max(0, Number(usage.cachedInputTokens) || 0),
    outputTokens: Math.max(0, Number(usage.outputTokens) || 0),
    reasoningTokens: Math.max(0, Number(usage.reasoningTokens) || 0),
    totalTokens: Math.max(0, Number(usage.totalTokens) || 0),
  };
}

function citationProofFingerprint(response) {
  const identities = (response.supportingEvidence || []).map((item) => {
    const evidence = record(item);
    const citation = record(evidence.documentCitation);
    return [
      text(citation.documentId),
      positiveInteger(citation.pageNumber),
      text(citation.sheetNumber),
    ];
  }).filter((identity) => identity[0] && identity[1]).sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );
  const uniqueIdentities = [...new Map(
    identities.map((identity) => [JSON.stringify(identity), identity]),
  ).values()];
  return uniqueIdentities.length > 0
    ? sha256(JSON.stringify(uniqueIdentities))
    : null;
}

function citationRegionFingerprint(response) {
  const identities = (response.supportingEvidence || []).map((item) => {
    const evidence = record(item);
    const citation = record(evidence.documentCitation);
    return [
      text(citation.documentId),
      positiveInteger(citation.pageNumber),
      text(citation.sheetNumber),
      text(citation.regionId),
    ];
  }).filter((identity) => identity[0] && identity[1]).sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );
  return identities.length > 0 ? sha256(JSON.stringify(identities)) : null;
}

function scoreModel(profile, observations) {
  const safeRefusalCases = observations.filter((item) =>
    item.activityClass === 'missing_evidence_and_safe_refusal'
  );
  const usage = observations.reduce((total, item) => ({
    inputTokens: total.inputTokens + item.agent.usage.inputTokens,
    cachedInputTokens:
      total.cachedInputTokens + item.agent.usage.cachedInputTokens,
    outputTokens: total.outputTokens + item.agent.usage.outputTokens,
    reasoningTokens: total.reasoningTokens + item.agent.usage.reasoningTokens,
    totalTokens: total.totalTokens + item.agent.usage.totalTokens,
  }), normalizedUsage({}));
  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - Math.min(usage.inputTokens, usage.cachedInputTokens),
  );
  const estimatedCostUsd =
    (uncachedInputTokens * profile.inputUsdPerMillionTokens +
      Math.min(usage.inputTokens, usage.cachedInputTokens) *
        profile.cachedInputUsdPerMillionTokens +
      usage.outputTokens * profile.outputUsdPerMillionTokens) / 1_000_000;
  const passRate = rate(observations, (item) => item.passed);
  const citationOpenabilityRate = rate(
    observations,
    (item) => item.citationsOpenable,
  );
  const safeRefusalPassRate = safeRefusalCases.length === 0
    ? 1
    : rate(
      safeRefusalCases,
      (item) => item.passed && item.assuranceStatus === 'verified_with_limits',
    );
  const projectIsolationRate = rate(
    observations,
    (item) => item.projectIsolationPreserved,
  );
  const repeatabilityRate = outcomeRepeatability(observations);
  const proofRepeatabilityRate = fingerprintRepeatability(
    observations,
    'proofFingerprint',
  );
  const answerRepeatabilityRate = fingerprintRepeatability(
    observations,
    'answerSha256',
  );
  const exactRegionRepeatabilityRate = fingerprintRepeatability(
    observations,
    'proofRegionFingerprint',
  );
  const assuranceStatusRepeatabilityRate = fieldRepeatability(
    observations,
    'assuranceStatus',
  );
  return {
    model: profile.model,
    attempts: observations.length,
    passRate,
    citationOpenabilityRate,
    safeRefusalCaseCount: safeRefusalCases.length,
    safeRefusalPassRate,
    projectIsolationRate,
    repeatabilityRate,
    answerRepeatabilityRate,
    proofRepeatabilityRate,
    exactRegionRepeatabilityRate,
    assuranceStatusRepeatabilityRate,
    meanLatencyMs: mean(observations.map((item) => item.latencyMs)),
    p95LatencyMs: percentile(
      observations.map((item) => item.latencyMs).sort((a, b) => a - b),
      0.95,
    ),
    meanToolCalls: mean(observations.map((item) => item.agent.toolCalls)),
    usage,
    estimatedCostUsd,
    eligibleForRecommendation: observations.length > 0 &&
      passRate === 1 &&
      citationOpenabilityRate === 1 &&
      safeRefusalPassRate === 1 &&
      projectIsolationRate === 1 &&
      repeatabilityRate === 1 &&
      answerRepeatabilityRate === 1 &&
      proofRepeatabilityRate === 1 &&
      exactRegionRepeatabilityRate === 1 &&
      assuranceStatusRepeatabilityRate === 1 &&
      percentile(
          observations.map((item) => item.latencyMs).sort((a, b) => a - b),
          0.95,
        ) <= 60_000,
  };
}

function outcomeRepeatability(observations) {
  const byCase = new Map();
  for (const observation of observations) {
    const group = byCase.get(observation.id) || [];
    group.push(observation);
    byCase.set(observation.id, group);
  }
  return mean([...byCase.values()].map((group) => {
    const signatures = group.map((item) => JSON.stringify([
      item.passed,
      item.assuranceStatus,
      item.proofFingerprint,
    ]));
    const counts = new Map();
    for (const signature of signatures) {
      counts.set(signature, (counts.get(signature) || 0) + 1);
    }
    return Math.max(...counts.values()) / group.length;
  }));
}

function fingerprintRepeatability(observations, fingerprintField) {
  return groupedFieldRepeatability(
    observations,
    (item) => JSON.stringify([item.passed, item[fingerprintField]]),
  );
}

function fieldRepeatability(observations, field) {
  return groupedFieldRepeatability(
    observations,
    (item) => JSON.stringify([item.passed, item[field]]),
  );
}

function groupedFieldRepeatability(observations, signatureFor) {
  const byCase = new Map();
  for (const observation of observations) {
    const group = byCase.get(observation.id) || [];
    group.push(observation);
    byCase.set(observation.id, group);
  }
  return mean([...byCase.values()].map((group) => {
    const counts = new Map();
    for (const item of group) {
      const signature = signatureFor(item);
      counts.set(signature, (counts.get(signature) || 0) + 1);
    }
    return Math.max(...counts.values()) / group.length;
  }));
}

function rate(items, predicate) {
  return items.length === 0
    ? 1
    : items.filter(predicate).length / items.length;
}

function mean(values) {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalSha256(value) {
  const candidate = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(candidate) ? candidate : '';
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function countBy(values, keyFor) {
  const counts = new Map();
  for (const value of values) {
    const key = keyFor(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts].sort());
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function required(name) {
  const value = text(process.env[name]);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});

function safeError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  const value = record(error);
  const details = [value.code, value.message, value.details, value.hint]
    .map(text)
    .filter(Boolean)
    .join(' | ');
  return details || String(error);
}
