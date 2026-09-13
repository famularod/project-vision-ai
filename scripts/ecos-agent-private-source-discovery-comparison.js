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
const OUTPUT_PATH = text(process.env.ECOS_AGENT_SOURCE_DISCOVERY_OUTPUT)
  ? path.resolve(ROOT, text(process.env.ECOS_AGENT_SOURCE_DISCOVERY_OUTPUT))
  : path.join(
    ROOT,
    'validation',
    'output',
    'ecos-agent-private-source-discovery-comparison.json',
  );
const RUNTIME_URL = required('ECOS_AGENT_COMPARISON_URL').replace(/\/+$/, '');
const GATEWAY_TOKEN = required('ECOS_AGENT_COMPARISON_GATEWAY_TOKEN');
let serverlessAuthorization = text(
  process.env.ECOS_AGENT_SERVERLESS_AUTHORIZATION,
);
const WIF_PROVIDER_RESOURCE = text(process.env.ECOS_AGENT_WIF_PROVIDER_RESOURCE);
const WIF_SERVICE_ACCOUNT = text(process.env.ECOS_AGENT_WIF_SERVICE_ACCOUNT);
const SERVERLESS_AUDIENCE = text(process.env.ECOS_AGENT_SERVERLESS_AUDIENCE);
const QUESTION_DELAY_MS = boundedInteger(
  process.env.ECOS_PRIVATE_QUESTION_DELAY_MS,
  10_000,
  60_000,
  10_000,
);
const REPETITIONS = boundedInteger(
  process.env.ECOS_AGENT_COMPARISON_REPETITIONS,
  1,
  3,
  2,
);
const PRIVATE_QUESTION_HOURLY_LIMIT = 60;
const REQUEST_TIMEOUT_MS = 125_000;
const MAXIMUM_REQUEST_ATTEMPTS = 3;
const STALE_OPERATION_RETRY_MS = 125_000;
const PROJECT_NAMES = Object.freeze([
  '2321 Compliance Project',
  '2375 Compliance Project',
]);
const MODEL_EVALUATION_FAILURE_CODES = new Set([
  'agent_model_turn_limit_reached',
  'agent_provider_output_invalid',
  'agent_research_required',
  'agent_tool_call_limit_reached',
  'agent_output_schema_invalid',
  'agent_output_json_invalid',
]);
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
const MODELS = selectedModels();

async function main() {
  const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = required('SUPABASE_ANON_KEY');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const serviceWorkerToken = required('ECOS_SERVICE_WORKER_TOKEN');
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const projects = await loadExactProjects(admin);
  const fixtureBefore = await captureDocumentFixture(admin, projects);
  const cases = loadSourceDiscoveryCases();
  const attempts = [];
  for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
    for (const evaluationCase of cases) {
      for (const model of MODELS) {
        attempts.push({ evaluationCase, model, repetition });
      }
    }
  }
  await assertPrivateQuestionCapacity({
    admin,
    ownerId: projects.ownerId,
    requiredSlots: attempts.length,
  });
  await assertNoActiveQuestions({ admin, ownerId: projects.ownerId });
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
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const project = projects.byName.get(attempt.evaluationCase.projectName);
      if (!project) throw new Error('source_discovery_project_missing');
      const started = Date.now();
      const response = await askCandidate({
        anonKey,
        accessToken: session.accessToken,
        serviceWorkerToken,
        project,
        question: attempt.evaluationCase.question,
        model: attempt.model,
      });
      const latencyMs = Date.now() - started;
      const pageRows = await loadCitationPageRows(admin, response);
      const evaluated = evaluateSourceDiscoveryCase({
        evaluationCase: attempt.evaluationCase,
        response,
        project,
        fixture: fixtureBefore,
        pageRows,
      });
      const diagnostics = record(response.diagnostics);
      const agentDiagnostics = record(response.agentEvaluationDiagnostics);
      const failures = [
        ...evaluated.failures,
        ...(response.validationMode === 'shadow'
          ? []
          : ['Response did not identify protected shadow validation mode.']),
        ...(latencyMs <= 60_000
          ? []
          : [`Latency ${latencyMs} ms exceeded the 60-second beta ceiling.`]),
        ...(attempt.evaluationCase.missingViewedDocumentIdentity ||
          positiveInteger(agentDiagnostics.successfulResearchCalls) > 0
          ? []
          : ['The agent completed no successful evidence-producing research call.']),
        ...(text(agentDiagnostics.errorCode)
          ? [`Agent model failure: ${text(agentDiagnostics.errorCode)}.`]
          : []),
      ];
      results.push({
        id: attempt.evaluationCase.id,
        activityClass: 'document-classification-and-source-discovery',
        model: attempt.model,
        repetition: attempt.repetition,
        projectNameSha256: sha256(attempt.evaluationCase.projectName),
        questionSha256: sha256(attempt.evaluationCase.question),
        answerSha256: sha256(canonical(text(response.answer))),
        passed: failures.length === 0,
        failures,
        latencyMs,
        assuranceStatus: text(response.assurance?.status),
        verifiedFactCount: Number(response.assurance?.verifiedFactCount) || 0,
        citationRequirementSatisfied: evaluated.citationRequirementSatisfied,
        documentEvidenceCount: evaluated.documentEvidenceIds.length,
        documentEvidenceFingerprint: sha256(JSON.stringify(
          evaluated.documentEvidenceIds.map(sha256).sort(),
        )),
        proofFingerprint: citationProofFingerprint(response),
        exactRegionFingerprint: citationRegionFingerprint(response),
        projectIsolationPreserved: evaluated.projectIsolationPreserved,
        safeRefusal: evaluated.safeRefusal,
        traceId: text(diagnostics.traceId),
        evidenceSnapshotId: text(diagnostics.evidenceSnapshotId),
        evidenceDossierId: text(diagnostics.evidenceDossierId),
        persisted: diagnostics.persisted === true,
        replayed: diagnostics.replayed === true,
        agent: {
          modelTurns: positiveInteger(agentDiagnostics.modelTurns),
          toolCalls: positiveInteger(agentDiagnostics.toolCalls),
          successfulResearchCalls: positiveInteger(
            agentDiagnostics.successfulResearchCalls,
          ),
          usage: normalizedUsage(agentDiagnostics.usage),
          traceSha256: sha256(JSON.stringify(agentDiagnostics.toolTrace || [])),
        },
      });
      console.log(
        `[${index + 1}/${attempts.length}] ${failures.length === 0 ? 'PASS' : 'FAIL'} ` +
          `${attempt.model} ${attempt.evaluationCase.id} repeat-${attempt.repetition} ${latencyMs}ms`,
      );
      failures.forEach((failure) => console.log(`- ${failure}`));
      if (index < attempts.length - 1) await wait(QUESTION_DELAY_MS);
    }
  } catch (error) {
    runError = safeError(error);
  } finally {
    revocationVerified = await revokeOwnerSession({ admin, session });
  }

  const fixtureAfter = await captureDocumentFixture(admin, projects);
  const fixtureStable = fixtureBefore.snapshotSha256 === fixtureAfter.snapshotSha256;
  const traceIds = results.map((item) => item.traceId).filter(Boolean);
  const dossierIds = results.map((item) => item.evidenceDossierId).filter(Boolean);
  const integrityFailures = [
    ...(results.length === attempts.length
      ? []
      : ['Not every source-discovery attempt completed.']),
    ...(new Set(traceIds).size === attempts.length
      ? []
      : ['Trace identities were not unique and complete.']),
    ...(new Set(dossierIds).size === attempts.length
      ? []
      : ['Dossier identities were not unique and complete.']),
    ...(results.every((item) => item.persisted)
      ? []
      : ['One or more private traces were not persisted.']),
    ...(results.every((item) => item.replayed === false)
      ? []
      : ['One or more attempts replayed an earlier answer.']),
    ...(revocationVerified
      ? []
      : ['Temporary owner session revocation was not verified.']),
    ...(fixtureStable
      ? []
      : ['Current-document inventory changed during the comparison.']),
    ...(runError ? [`Run stopped safely: ${runError}`] : []),
  ];
  const scores = MODELS.map((model) => scoreModel(
    model,
    results.filter((item) => item.model === model),
  )).sort(compareQualityFirstModelScores);
  const receipt = {
    schemaVersion: 'ecos-agent-private-source-discovery-comparison/1.0',
    validationMode: 'shadow',
    questionTransport: 'private_cloud_run_agent_runtime',
    activityClass: 'document-classification-and-source-discovery',
    startedAt,
    completedAt: new Date().toISOString(),
    repetitions: REPETITIONS,
    models: MODELS,
    caseIds: cases.map((item) => item.id),
    fixture: publicFixtureReceipt(fixtureBefore),
    summary: {
      total: attempts.length,
      passed: results.filter((item) => item.passed).length,
      failed: attempts.length - results.filter((item) => item.passed).length,
      uniqueTraceCount: new Set(traceIds).size,
      uniqueDossierCount: new Set(dossierIds).size,
      fixtureStable,
      sessionRevocationVerified: revocationVerified,
      integrityFailures,
      scores,
      preliminaryRecommendedModel:
        scores.find((item) => item.eligibleForRecommendation)?.model || null,
    },
    results,
  };
  atomicWrite(OUTPUT_PATH, receipt);
  console.log(JSON.stringify({
    output: path.relative(ROOT, OUTPUT_PATH),
    receiptSha256: sha256(fs.readFileSync(OUTPUT_PATH)),
    summary: receipt.summary,
  }, null, 2));
  if (receipt.summary.failed > 0 || integrityFailures.length > 0) {
    process.exitCode = 1;
  }
}

function loadSourceDiscoveryCases() {
  const suite2375 = readJson(path.join(
    ROOT,
    'validation',
    'ecos',
    'ask-ecos-real-world-cases.json',
  ));
  const suite2321 = readJson(path.join(
    ROOT,
    'validation',
    'ecos',
    'ask-ecos-2321-real-world-cases.json',
  ));
  const byId = new Map([
    ...(suite2375.cases || []),
    ...(suite2321.cases || []),
  ].map((testCase) => [testCase.id, testCase]));
  const fromCanonical = (id, canonicalId, projectName, question) => {
    const canonicalCase = byId.get(canonicalId);
    if (!canonicalCase) throw new Error(`source_discovery_case_missing:${canonicalId}`);
    return { id, projectName, question, canonicalCase };
  };
  const lightingSources = fromCanonical(
    'source-01',
    'cross-discipline-area-lighting',
    '2375 Compliance Project',
    'Which current drawings should the field team use for the 2375 north-lot lighting work?',
  );
  lightingSources.canonicalCase = {
    ...lightingSources.canonicalCase,
    requiredAnswerPatterns: (
      lightingSources.canonicalCase.requiredAnswerPatterns || []
    ).filter((pattern) => pattern !== '\\byes\\b'),
  };
  return [
    lightingSources,
    fromCanonical(
      'source-02',
      'infiltration-chamber-detail-location',
      '2375 Compliance Project',
      'Where are the underground infiltration chamber details?',
    ),
    fromCanonical(
      'source-03',
      '2321-cross-sheet-hazmat-plan-set',
      '2321 Compliance Project',
      'Which current architectural sheets make up the 2321 hazardous-material canopy plan set?',
    ),
    fromCanonical(
      'source-04',
      'electrical-sheet-e-2-1-purpose',
      '2375 Compliance Project',
      'What is electrical Sheet E-2.1 for?',
    ),
    {
      id: 'source-05',
      projectName: '2375 Compliance Project',
      question: 'Is there a newer current revision than the drawing I am viewing?',
      missingViewedDocumentIdentity: true,
    },
  ];
}

function evaluateSourceDiscoveryCase({
  evaluationCase,
  response,
  project,
  fixture,
  pageRows,
}) {
  const documentEvidence = (response.supportingEvidence || []).filter((item) =>
    item?.sourceType === 'document' && text(item?.documentCitation?.documentId)
  );
  const documentEvidenceIds = [...new Set(documentEvidence.map((item) =>
    text(item.documentCitation.documentId)
  ))];
  const projectDocumentIds = new Set(
    fixture.rows
      .filter((row) => row.projectName === evaluationCase.projectName)
      .map((row) => row.documentId),
  );
  const projectIsolationPreserved = documentEvidenceIds.every((id) =>
    projectDocumentIds.has(id)
  );
  if (!evaluationCase.missingViewedDocumentIdentity) {
    const canonicalCase = {
      ...evaluationCase.canonicalCase,
      id: evaluationCase.id,
      question: evaluationCase.question,
    };
    const evaluated = evaluateAcceptanceCase(canonicalCase, response, {
      projectName: project.name,
      pageRows,
    });
    const failures = [
      ...evaluated.failures,
      ...(text(response.projectId) === project.id
        ? []
        : ['Response is not bound to the exact selected project id.']),
      ...(projectIsolationPreserved
        ? []
        : ['Answer cited a document outside the frozen selected-project inventory.']),
    ];
    return {
      failures,
      documentEvidenceIds,
      projectIsolationPreserved,
      citationRequirementSatisfied: evaluated.citations.length > 0,
      safeRefusal: false,
    };
  }

  const failures = [];
  const answerCorpus = canonical([
    text(response.answer),
    ...(Array.isArray(response.limitations) ? response.limitations.map(text) : []),
  ].join(' '));
  if (text(response.schemaVersion) !== 'ecos-project-question/2.0') {
    failures.push('Response schema is not ecos-project-question/2.0.');
  }
  if (text(response.projectId) !== project.id || text(response.projectName) !== project.name) {
    failures.push('Response is not bound to the exact selected project.');
  }
  if (canonical(response.question) !== canonical(evaluationCase.question)) {
    failures.push('Response question does not match the submitted source-discovery question.');
  }
  if (!uuid(response.diagnostics?.traceId) || !uuid(response.diagnostics?.evidenceDossierId)) {
    failures.push('Response is missing fresh trace or evidence dossier identity.');
  }
  if (response.assurance?.status !== 'insufficient_evidence') {
    failures.push('Missing viewed-document identity did not fail closed as insufficient evidence.');
  }
  if ((Number(response.assurance?.verifiedFactCount) || 0) !== 0) {
    failures.push('Revision-comparison refusal included an asserted factual result.');
  }
  if (!/(?:cannot|can t|unable|need|missing|not provided|not identified|not enough)/.test(answerCorpus)) {
    failures.push('Revision-comparison refusal did not explain that comparison cannot proceed.');
  }
  if (!/(?:document|drawing|sheet|revision)/.test(answerCorpus)) {
    failures.push('Revision-comparison refusal did not identify the missing source identity.');
  }
  if (!/(?:viewing|viewed|open|identity|name|number|identify)/.test(answerCorpus)) {
    failures.push('Revision-comparison refusal did not request the viewed drawing identity.');
  }
  const factualClaims = (response.facts || []).filter((fact) =>
    fact?.classification === 'fact'
  );
  if (factualClaims.length > 0) {
    failures.push('Revision-comparison refusal contained unsupported factual claims.');
  }
  if (!projectIsolationPreserved) {
    failures.push('Revision-comparison refusal cited a document outside the selected project.');
  }
  return {
    failures,
    documentEvidenceIds,
    projectIsolationPreserved,
    citationRequirementSatisfied: true,
    safeRefusal: failures.length === 0,
  };
}

async function loadExactProjects(admin) {
  const { data, error } = await admin.from('projects')
    .select('id,name,owner_id,archived')
    .eq('archived', false)
    .in('name', PROJECT_NAMES);
  if (error) throw error;
  const rows = (data || []).filter((row) => PROJECT_NAMES.includes(text(row.name)));
  if (rows.length !== PROJECT_NAMES.length) {
    throw new Error('source_discovery_exact_projects_missing');
  }
  if (PROJECT_NAMES.some((name) =>
    rows.filter((row) => text(row.name) === name).length !== 1
  )) throw new Error('source_discovery_project_identity_ambiguous');
  const ownerIds = [...new Set(rows.map((row) => text(row.owner_id)).filter(Boolean))];
  if (ownerIds.length !== 1) {
    throw new Error('source_discovery_owner_identity_ambiguous');
  }
  return {
    ownerId: ownerIds[0],
    byName: new Map(rows.map((row) => [text(row.name), {
      id: text(row.id),
      name: text(row.name),
    }])),
  };
}

async function captureDocumentFixture(admin, projects) {
  const rows = [];
  for (const projectName of PROJECT_NAMES) {
    const project = projects.byName.get(projectName);
    if (!project) throw new Error('source_discovery_fixture_project_missing');
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
        throw new Error('source_discovery_fixture_document_identity_invalid');
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
  if (rows.length === 0) throw new Error('source_discovery_fixture_empty');
  return {
    capturedAt: new Date().toISOString(),
    rows,
    snapshotSha256: sha256(stableStringify(rows)),
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

async function loadCitationPageRows(admin, response) {
  const citations = (response.supportingEvidence || [])
    .map((item) => record(item.documentCitation))
    .filter((item) => text(item.documentId) && positiveInteger(item.pageNumber));
  const documentIds = [...new Set(citations.map((item) => text(item.documentId)))];
  const pageNumbers = [...new Set(citations.map((item) =>
    positiveInteger(item.pageNumber)
  ))];
  if (documentIds.length === 0 || pageNumbers.length === 0) return [];
  const result = await admin.rpc('ecos_load_hosted_shadow_page_context_v21', {
    p_document_ids: documentIds,
    p_page_numbers: pageNumbers,
    p_result_limit: 100,
  });
  if (result.error) throw result.error;
  return (result.data || []).flatMap((page) => normalizeAssuredShadowPageRow({
    ...page,
    state: 'assured',
    unresolved_region_count: 0,
  }));
}

async function askCandidate(input) {
  let lastError = null;
  const clientRequestId = crypto.randomUUID();
  const evaluationAttemptId = crypto.randomUUID();
  for (let attempt = 1; attempt <= MAXIMUM_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${RUNTIME_URL}/question`, {
        method: 'POST',
        headers: {
          apikey: input.anonKey,
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
          'x-ecos-worker-token': input.serviceWorkerToken,
          'x-ecos-agent-gateway-token': GATEWAY_TOKEN,
          ...(serverlessAuthorization
            ? { 'x-serverless-authorization': `Bearer ${serverlessAuthorization}` }
            : {}),
        },
        body: JSON.stringify({
          schemaVersion: 'ecos-project-question/2.0',
          clientRequestId,
          clientSurface: 'web',
          projectId: input.project.id,
          projectName: input.project.name,
          question: input.question,
          validationMode: 'shadow',
          evaluationModel: input.model,
          evaluationAttemptId,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      const code = text(body?.error) || `http_${response.status}`;
      const agentFailureCode = text(body?.agentEvaluationDiagnostics?.errorCode);
      if (
        response.status === 502 && code === 'answer_invalid' &&
        MODEL_EVALUATION_FAILURE_CODES.has(agentFailureCode)
      ) return body;
      const retryable = response.status === 409 || response.status === 429 ||
        response.status >= 500;
      if (!retryable || attempt === MAXIMUM_REQUEST_ATTEMPTS) {
        throw new Error(`Candidate returned ${response.status} (${code}).`);
      }
      const retryDelayMs = code === 'question_in_progress'
        ? STALE_OPERATION_RETRY_MS
        : Math.min(60, Math.max(2, Number(body?.retryAfterSeconds) || 5)) * 1_000;
      await wait(retryDelayMs);
    } catch (error) {
      lastError = error;
      if (attempt === MAXIMUM_REQUEST_ATTEMPTS) throw error;
      await wait(attempt * 2_000);
    }
  }
  throw lastError || new Error('private_source_discovery_request_failed');
}

async function assertPrivateQuestionCapacity({ admin, ownerId, requiredSlots }) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.from('dave_ai_operation_requests')
    .select('started_at')
    .eq('owner_id', ownerId)
    .eq('operation_type', 'project_question')
    .gt('started_at', since)
    .order('started_at', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  const available = Math.max(0, PRIVATE_QUESTION_HOURLY_LIMIT - rows.length);
  if (available >= requiredSlots) return;
  const clearance = rows[requiredSlots - available - 1]?.started_at;
  const fullWindowAt = clearance
    ? new Date(Date.parse(clearance) + 60 * 60 * 1000 + 2_000).toISOString()
    : 'unknown';
  throw new Error(
    `private_source_discovery_capacity_insufficient:${available}/${requiredSlots}:full_window_at_${fullWindowAt}`,
  );
}

async function assertNoActiveQuestions({ admin, ownerId }) {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { count, error } = await admin.from('dave_ai_operation_requests')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('operation_type', 'project_question')
    .eq('status', 'processing')
    .gt('started_at', cutoff);
  if (error) throw error;
  if ((count || 0) !== 0) {
    throw new Error(`private_source_discovery_active_questions:${count}`);
  }
}

async function createOwnerSession({ admin, anonKey, ownerId, supabaseUrl }) {
  const user = await admin.auth.admin.getUserById(ownerId);
  const email = text(user.data?.user?.email);
  if (user.error || !email) throw new Error('private_source_discovery_owner_missing');
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = text(link.data?.properties?.hashed_token);
  if (link.error || !tokenHash) throw new Error('private_source_discovery_link_failed');
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  const accessToken = text(verified.data?.session?.access_token);
  if (verified.error || !accessToken) {
    throw new Error('private_source_discovery_session_failed');
  }
  return { accessToken, client };
}

async function ensureServerlessAuthorization(ownerAccessToken) {
  if (serverlessAuthorization) return;
  const configuration = [
    WIF_PROVIDER_RESOURCE,
    WIF_SERVICE_ACCOUNT,
    SERVERLESS_AUDIENCE,
  ];
  if (configuration.every(Boolean)) {
    serverlessAuthorization = await mintCloudRunIdToken({
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
  const revoked = await admin.auth.admin.signOut(session.accessToken, 'local');
  if (revoked.error) return false;
  const verification = await session.client.auth.getUser(session.accessToken);
  return Boolean(verification.error || !verification.data?.user);
}

function scoreModel(model, results) {
  const profile = MODEL_PROFILES.find((item) => item.model === model);
  if (!profile) throw new Error(`source_discovery_model_profile_missing:${model}`);
  const usage = results.reduce((total, item) => ({
    inputTokens: total.inputTokens + item.agent.usage.inputTokens,
    cachedInputTokens: total.cachedInputTokens + item.agent.usage.cachedInputTokens,
    outputTokens: total.outputTokens + item.agent.usage.outputTokens,
    reasoningTokens: total.reasoningTokens + item.agent.usage.reasoningTokens,
    totalTokens: total.totalTokens + item.agent.usage.totalTokens,
  }), normalizedUsage({}));
  const cachedInputTokens = Math.min(usage.inputTokens, usage.cachedInputTokens);
  const uncachedInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  const estimatedCostUsd =
    (uncachedInputTokens * profile.inputUsdPerMillionTokens +
      cachedInputTokens * profile.cachedInputUsdPerMillionTokens +
      usage.outputTokens * profile.outputUsdPerMillionTokens) / 1_000_000;
  const passRate = rate(results, (item) => item.passed);
  const citationRate = rate(results, (item) => item.citationRequirementSatisfied);
  const isolationRate = rate(results, (item) => item.projectIsolationPreserved);
  const refusalCases = results.filter((item) => item.id === 'source-05');
  const safeRefusalRate = rate(refusalCases, (item) => item.safeRefusal);
  const repeatabilityRate = groupedRepeatability(results, (item) =>
    JSON.stringify([
      item.passed,
      item.answerSha256,
      item.proofFingerprint,
      item.exactRegionFingerprint,
      item.assuranceStatus,
    ])
  );
  const repeatabilitySufficient = REPETITIONS >= 2;
  const p95LatencyMs = percentile(
    results.map((item) => item.latencyMs).sort((a, b) => a - b),
    0.95,
  );
  return {
    model,
    attempts: results.length,
    passRate,
    citationRate,
    isolationRate,
    safeRefusalRate,
    repeatabilityRate,
    repeatabilitySufficient,
    meanLatencyMs: mean(results.map((item) => item.latencyMs)),
    p95LatencyMs,
    meanToolCalls: mean(results.map((item) => item.agent.toolCalls)),
    usage,
    estimatedCostUsd,
    eligibleForRecommendation: results.length > 0 && passRate === 1 &&
      citationRate === 1 && isolationRate === 1 && safeRefusalRate === 1 &&
      repeatabilityRate === 1 && repeatabilitySufficient &&
      p95LatencyMs <= 60_000,
  };
}

function citationProofFingerprint(response) {
  const identities = (response.supportingEvidence || []).map((item) => {
    const citation = record(item.documentCitation);
    return [
      text(citation.documentId),
      positiveInteger(citation.pageNumber),
      text(citation.sheetNumber),
    ];
  }).filter((identity) => identity[0] && identity[1]).sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );
  const unique = [...new Map(
    identities.map((identity) => [JSON.stringify(identity), identity]),
  ).values()];
  return unique.length > 0 ? sha256(JSON.stringify(unique)) : null;
}

function citationRegionFingerprint(response) {
  const identities = (response.supportingEvidence || []).map((item) => {
    const citation = record(item.documentCitation);
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

function groupedRepeatability(items, signatureFor) {
  const groups = new Map();
  for (const item of items) {
    const group = groups.get(item.id) || [];
    group.push(item);
    groups.set(item.id, group);
  }
  return mean([...groups.values()].map((group) => {
    const counts = new Map();
    for (const item of group) {
      const signature = signatureFor(item);
      counts.set(signature, (counts.get(signature) || 0) + 1);
    }
    return Math.max(...counts.values()) / group.length;
  }));
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function rate(items, predicate) {
  return items.length === 0
    ? 0
    : items.filter(predicate).length / items.length;
}

function mean(values) {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * percentileValue) - 1),
  );
  return values[index];
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function selectedModels() {
  const configured = text(process.env.ECOS_AGENT_COMPARISON_MODELS)
    .split(',')
    .map(text)
    .filter(Boolean);
  const allowed = MODEL_PROFILES.map((profile) => profile.model);
  if (configured.length === 0) return Object.freeze(allowed);
  if (new Set(configured).size !== configured.length) {
    throw new Error('agent_comparison_duplicate_model');
  }
  if (configured.some((model) => !allowed.includes(model))) {
    throw new Error('agent_comparison_model_not_allowed');
  }
  return Object.freeze(configured);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function uuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(text(value));
}

function canonicalSha256(value) {
  const candidate = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(candidate) ? candidate : '';
}

function canonical(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function required(name) {
  const value = text(process.env[name]);
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
