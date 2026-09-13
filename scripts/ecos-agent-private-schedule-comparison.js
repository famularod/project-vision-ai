#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
  compareQualityFirstModelScores,
} = require('./ecos-agent-model-selection');
const {
  mintCloudRunIdToken,
} = require('./ecos-agent-google-wif-token');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = text(process.env.ECOS_AGENT_SCHEDULE_OUTPUT)
  ? path.resolve(ROOT, text(process.env.ECOS_AGENT_SCHEDULE_OUTPUT))
  : path.join(ROOT, 'validation', 'output', 'ecos-agent-private-schedule-comparison.json');
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
const PROJECT_NAME = '2321 Compliance Project';
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
  const project = await loadExactProject(admin);
  const fixtureBefore = await captureScheduleFixture(admin, project);
  const cases = deriveCases(fixtureBefore);
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
    ownerId: project.ownerId,
    requiredSlots: attempts.length,
  });
  await assertNoActiveQuestions({ admin, ownerId: project.ownerId });
  const session = await createOwnerSession({
    admin,
    anonKey,
    ownerId: project.ownerId,
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
      const evaluated = evaluateScheduleCase(
        attempt.evaluationCase,
        response,
        fixtureBefore,
        project,
      );
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
        ...(text(agentDiagnostics.errorCode)
          ? [`Agent model failure: ${text(agentDiagnostics.errorCode)}.`]
          : []),
      ];
      const evidenceFingerprint = sha256(JSON.stringify(
        evaluated.scheduleEvidenceIds.map(sha256).sort(),
      ));
      results.push({
        id: attempt.evaluationCase.id,
        activityClass: 'schedule-status-and-dependencies',
        model: attempt.model,
        repetition: attempt.repetition,
        questionSha256: sha256(attempt.evaluationCase.question),
        answerSha256: sha256(canonical(text(response.answer))),
        passed: failures.length === 0,
        failures,
        latencyMs,
        assuranceStatus: text(response.assurance?.status),
        verifiedFactCount: Number(response.assurance?.verifiedFactCount) || 0,
        scheduleEvidenceCount: evaluated.scheduleEvidenceIds.length,
        scheduleEvidenceFingerprint: evidenceFingerprint,
        projectIsolationPreserved: evaluated.projectIsolationPreserved,
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

  const fixtureAfter = await captureScheduleFixture(admin, project);
  const fixtureStable = fixtureBefore.snapshotSha256 === fixtureAfter.snapshotSha256;
  const traceIds = results.map((item) => item.traceId).filter(Boolean);
  const dossierIds = results.map((item) => item.evidenceDossierId).filter(Boolean);
  const integrityFailures = [
    ...(results.length === attempts.length ? [] : ['Not every schedule attempt completed.']),
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
    ...(revocationVerified ? [] : ['Temporary owner session revocation was not verified.']),
    ...(fixtureStable ? [] : ['Schedule snapshot changed during the comparison.']),
    ...(runError ? [`Run stopped safely: ${runError}`] : []),
  ];
  const scores = MODELS.map((model) => scoreModel(
    model,
    results.filter((item) => item.model === model),
  )).sort(compareQualityFirstModelScores);
  const receipt = {
    schemaVersion: 'ecos-agent-private-schedule-comparison/1.0',
    validationMode: 'shadow',
    questionTransport: 'private_cloud_run_agent_runtime',
    activityClass: 'schedule-status-and-dependencies',
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

async function loadExactProject(admin) {
  const { data, error } = await admin.from('projects')
    .select('id,name,owner_id,archived')
    .eq('archived', false)
    .eq('name', PROJECT_NAME);
  if (error) throw error;
  if ((data || []).length !== 1) throw new Error('schedule_project_identity_ambiguous');
  return {
    id: text(data[0].id),
    name: text(data[0].name),
    ownerId: text(data[0].owner_id),
  };
}

async function captureScheduleFixture(admin, project) {
  const { data, error } = await admin.from('schedule_items')
    .select('id,project_name,task_name,item_data,updated_at')
    .eq('project_name', project.name)
    .order('id', { ascending: true });
  if (error) throw error;
  const rows = (data || []).map(normalizeScheduleRow);
  return {
    capturedAt: new Date().toISOString(),
    projectIdSha256: sha256(project.id),
    rowCount: rows.length,
    statusCounts: countBy(rows, (row) => row.status || 'Unknown'),
    dependencyRecordCount: rows.filter((row) => row.dependencies.length > 0).length,
    rows,
    snapshotSha256: sha256(stableStringify(rows)),
  };
}

function deriveCases(fixture) {
  const uniqueTask = (name) => {
    const matches = fixture.rows.filter((row) => canonical(row.taskName) === canonical(name));
    if (matches.length !== 1) throw new Error(`schedule_fixture_task_not_unique:${name}`);
    return matches[0];
  };
  const footings = uniqueTask('FORM & PLACE FOOTINGS');
  const manDoors = uniqueTask('DEMO EXISTING MAN DOORS & PREP FOR NEW CONDITION');
  const inProgress = fixture.rows.filter((row) =>
    canonical(row.status) === 'in progress' ||
    (row.percentComplete > 0 && row.percentComplete < 100)
  ).sort((left, right) => left.taskName.localeCompare(right.taskName));
  if (inProgress.length === 0 || inProgress.length > 50) {
    throw new Error('schedule_fixture_in_progress_set_unbounded');
  }
  const snapshotDate = pacificDate(fixture.capturedAt);
  const upcomingSouthLot = fixture.rows.filter((row) =>
    canonical(row.locationName) === canonical('2321 South Lot') &&
    canonical(row.status) !== 'complete' &&
    dateKey(row.startDate) >= snapshotDate
  ).sort((left, right) =>
    dateKey(left.startDate).localeCompare(dateKey(right.startDate)) ||
    left.taskName.localeCompare(right.taskName)
  );
  if (upcomingSouthLot.length === 0) throw new Error('schedule_fixture_next_work_missing');
  const nextStart = dateKey(upcomingSouthLot[0].startDate);
  const nextRows = upcomingSouthLot.filter((row) => dateKey(row.startDate) === nextStart);
  return [
    {
      id: 'schedule-01',
      question: 'When is FORM & PLACE FOOTINGS scheduled and where is the work?',
      expectedRows: [footings],
      requiredValues: [
        footings.taskName,
        footings.locationName,
        footings.startDate,
        footings.finishDate,
      ],
      requiredConcepts: ['start', 'finish'],
    },
    {
      id: 'schedule-02',
      question: 'What is the current status of DEMO EXISTING MAN DOORS & PREP FOR NEW CONDITION?',
      expectedRows: [manDoors],
      requiredValues: [
        manDoors.taskName,
        manDoors.locationName,
        manDoors.status,
        manDoors.startDate,
        manDoors.finishDate,
      ],
      requiredConcepts: [],
      requiredAnyConcepts: [[
        `${manDoors.percentComplete}%`,
        `${manDoors.percentComplete} percent`,
      ]],
    },
    {
      id: 'schedule-03',
      question: 'Which 2321 activities are in progress right now?',
      expectedRows: inProgress,
      requiredValues: inProgress.map((row) => row.taskName),
      requiredConcepts: ['in progress'],
    },
    {
      id: 'schedule-04',
      question: 'What work is scheduled next at the 2321 South Lot?',
      expectedRows: nextRows,
      requiredValues: [
        ...nextRows.map((row) => row.taskName),
        nextRows[0].startDate,
        '2321 South Lot',
      ],
      requiredAnyValues: [[fixture.capturedAt.slice(0, 10), snapshotDate]],
      requiredConcepts: ['next'],
    },
    {
      id: 'schedule-05',
      question: 'What needs to finish before FORM & PLACE FOOTINGS can start?',
      expectedRows: [footings],
      requiredValues: [footings.taskName],
      requiredConcepts: [],
      requiredAnyConcepts: [['no depend', 'not recorded']],
      forbidUnsupportedDependency: true,
    },
  ];
}

function evaluateScheduleCase(evaluationCase, response, fixture, project) {
  const failures = [];
  const answerCorpus = canonical([
    text(response.answer),
    ...(Array.isArray(response.facts)
      ? response.facts.map((fact) => text(fact?.statement))
      : []),
    ...(Array.isArray(response.limitations) ? response.limitations.map(text) : []),
  ].join(' '));
  const scheduleEvidence = (response.supportingEvidence || []).filter((item) =>
    item?.sourceType === 'schedule' && text(item.recordId)
  );
  const scheduleEvidenceIds = [...new Set(scheduleEvidence.map((item) => text(item.recordId)))];
  const fixtureIds = new Set(fixture.rows.map((row) => row.id));
  const expectedIds = new Set(evaluationCase.expectedRows.map((row) => row.id));
  if (text(response.schemaVersion) !== 'ecos-project-question/2.0') {
    failures.push('Response schema is not ecos-project-question/2.0.');
  }
  if (text(response.projectId) !== project.id || text(response.projectName) !== project.name) {
    failures.push('Response is not bound to the exact selected project.');
  }
  if (canonical(response.question) !== canonical(evaluationCase.question)) {
    failures.push('Response question does not match the submitted schedule question.');
  }
  if (!uuid(response.diagnostics?.traceId) || !uuid(response.diagnostics?.evidenceDossierId)) {
    failures.push('Response is missing fresh trace or evidence dossier identity.');
  }
  if (!['verified', 'verified_with_limits'].includes(response.assurance?.status)) {
    failures.push(`Schedule answer was not verified: ${text(response.assurance?.status)}.`);
  }
  if ((Number(response.assurance?.verifiedFactCount) || 0) < 1) {
    failures.push('ECOS Assurance did not verify a schedule fact.');
  }
  for (const value of evaluationCase.requiredValues) {
    if (!answerContainsValue(answerCorpus, value)) {
      failures.push(`Answer omitted a frozen expected schedule value: ${value}.`);
    }
  }
  for (const concept of evaluationCase.requiredConcepts) {
    if (!answerCorpus.includes(canonical(concept))) {
      failures.push(`Answer omitted required schedule meaning: ${concept}.`);
    }
  }
  for (const alternatives of evaluationCase.requiredAnyValues || []) {
    if (!alternatives.some((value) => answerContainsValue(answerCorpus, value))) {
      failures.push(
        `Answer omitted every accepted frozen schedule value: ${alternatives.join(' or ')}.`,
      );
    }
  }
  for (const alternatives of evaluationCase.requiredAnyConcepts || []) {
    if (!alternatives.some((value) => answerCorpus.includes(canonical(value)))) {
      failures.push(
        `Answer omitted every accepted schedule meaning: ${alternatives.join(' or ')}.`,
      );
    }
  }
  if (scheduleEvidenceIds.length === 0) {
    failures.push('Answer has no schedule evidence record.');
  }
  for (const expectedId of expectedIds) {
    if (!scheduleEvidenceIds.includes(expectedId)) {
      failures.push('Answer did not cite every expected frozen schedule record.');
      break;
    }
  }
  const projectIsolationPreserved = scheduleEvidenceIds.every((id) => fixtureIds.has(id));
  if (!projectIsolationPreserved) {
    failures.push('Answer cited a schedule record outside the frozen selected-project snapshot.');
  }
  if (evaluationCase.forbidUnsupportedDependency) {
    const predecessorClaims = answerCorpus.match(/\b(?:after|depends on|predecessor|must finish)\b/g) || [];
    const makesUnsupportedClaim = predecessorClaims.length > 0 &&
      !answerCorpus.includes('no depend') && !answerCorpus.includes('not recorded');
    if (makesUnsupportedClaim) failures.push('Answer invented an unrecorded schedule dependency.');
  }
  return { failures, scheduleEvidenceIds, projectIsolationPreserved };
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
      ) {
        return body;
      }
      const retryable = response.status === 409 || response.status === 429 || response.status >= 500;
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
  throw lastError || new Error('private_schedule_request_failed');
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
  const available = Math.max(0, PRIVATE_QUESTION_HOURLY_LIMIT - (data || []).length);
  if (available < requiredSlots) {
    throw new Error(`private_schedule_capacity_insufficient:${available}/${requiredSlots}`);
  }
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
  if ((count || 0) !== 0) throw new Error(`private_schedule_active_questions:${count}`);
}

async function createOwnerSession({ admin, anonKey, ownerId, supabaseUrl }) {
  const user = await admin.auth.admin.getUserById(ownerId);
  const email = text(user.data?.user?.email);
  if (user.error || !email) throw new Error('private_schedule_owner_missing');
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = text(link.data?.properties?.hashed_token);
  if (link.error || !tokenHash) throw new Error('private_schedule_link_failed');
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  const accessToken = text(verified.data?.session?.access_token);
  if (verified.error || !accessToken) throw new Error('private_schedule_session_failed');
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

function normalizeScheduleRow(row) {
  const data = record(row.item_data);
  return {
    id: text(row.id),
    idSha256: sha256(text(row.id)),
    taskName: text(data.taskName) || text(row.task_name),
    locationName: text(data.locationName),
    status: text(data.status),
    percentComplete: finiteNumberOrNull(data.percentComplete),
    startDate: text(data.startDate),
    finishDate: text(data.finishDate),
    wbsCode: text(data.wbsCode) || text(data.sourceWbsCode),
    dependencies: normalizeDependencies(data.dependencies),
    updatedAt: text(row.updated_at),
  };
}

function normalizeDependencies(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map((item) => canonical(
    typeof item === 'string' || typeof item === 'number'
      ? String(item)
      : stableStringify(record(item)),
  )).filter(Boolean).sort();
}

function publicFixtureReceipt(fixture) {
  return {
    capturedAt: fixture.capturedAt,
    projectIdSha256: fixture.projectIdSha256,
    rowCount: fixture.rowCount,
    statusCounts: fixture.statusCounts,
    dependencyRecordCount: fixture.dependencyRecordCount,
    snapshotSha256: fixture.snapshotSha256,
    rowIdentitySha256: sha256(JSON.stringify(fixture.rows.map((row) => row.idSha256).sort())),
  };
}

function scoreModel(model, results) {
  const profile = MODEL_PROFILES.find((item) => item.model === model);
  if (!profile) throw new Error(`schedule_model_profile_missing:${model}`);
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
  const citationRate = rate(results, (item) => item.scheduleEvidenceCount > 0);
  const isolationRate = rate(results, (item) => item.projectIsolationPreserved);
  const repeatabilityRate = groupedRepeatability(results, (item) =>
    JSON.stringify([
      item.passed,
      item.answerSha256,
      item.scheduleEvidenceFingerprint,
      item.assuranceStatus,
    ])
  );
  return {
    model,
    attempts: results.length,
    passRate,
    citationRate,
    isolationRate,
    repeatabilityRate,
    meanLatencyMs: mean(results.map((item) => item.latencyMs)),
    p95LatencyMs: percentile(results.map((item) => item.latencyMs).sort((a, b) => a - b), 0.95),
    meanToolCalls: mean(results.map((item) => item.agent.toolCalls)),
    usage,
    estimatedCostUsd,
    eligibleForRecommendation: results.length > 0 && passRate === 1 &&
      citationRate === 1 && isolationRate === 1 && repeatabilityRate === 1 &&
      percentile(results.map((item) => item.latencyMs).sort((a, b) => a - b), 0.95) <= 60_000,
  };
}

function answerContainsValue(corpus, value) {
  const raw = text(value);
  if (!raw) return true;
  const normalized = canonical(raw);
  if (corpus.includes(normalized)) return true;
  const key = dateKey(raw);
  if (!key) return false;
  const [year, month, day] = key.split('-').map(Number);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' })
    .format(new Date(Date.UTC(year, month - 1, day)));
  return corpus.includes(canonical(`${month}/${day}/${year}`)) ||
    corpus.includes(canonical(`${monthName} ${day} ${year}`));
}

function pacificDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function dateKey(value) {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!match) return '';
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
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
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function countBy(values, keyFor) {
  const counts = new Map();
  for (const value of values) {
    const key = keyFor(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts].sort());
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

function canonical(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
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

function percentile(values, fraction) {
  return values.length === 0 ? 0 : values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(values, predicate) {
  return values.length === 0 ? 1 : values.filter(predicate).length / values.length;
}

function uuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(text(value));
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function required(name) {
  const value = text(process.env[name]);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
