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
const OUTPUT_PATH = text(process.env.ECOS_AGENT_PROGRESS_OUTPUT)
  ? path.resolve(ROOT, text(process.env.ECOS_AGENT_PROGRESS_OUTPUT))
  : path.join(
    ROOT,
    'validation',
    'output',
    'ecos-agent-private-progress-comparison.json',
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
  const fixtureBefore = await captureProgressFixture(admin, projects);
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
      if (!project) throw new Error('progress_project_missing');
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
      const evaluated = evaluateProgressCase(
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
        evaluated.evidenceIds.map(sha256).sort(),
      ));
      results.push({
        id: attempt.evaluationCase.id,
        activityClass: 'task-update-photo-and-completion-research',
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
        evidenceCount: evaluated.evidenceIds.length,
        evidenceFingerprint,
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

  const fixtureAfter = await captureProgressFixture(admin, projects);
  const fixtureStable = fixtureBefore.snapshotSha256 === fixtureAfter.snapshotSha256;
  const traceIds = results.map((item) => item.traceId).filter(Boolean);
  const dossierIds = results.map((item) => item.evidenceDossierId).filter(Boolean);
  const integrityFailures = [
    ...(results.length === attempts.length
      ? []
      : ['Not every progress attempt completed.']),
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
      : ['Task, update, photo, or field-note snapshot changed during the comparison.']),
    ...(runError ? [`Run stopped safely: ${runError}`] : []),
  ];
  const scores = MODELS.map((model) => scoreModel(
    model,
    results.filter((item) => item.model === model),
  )).sort(compareQualityFirstModelScores);
  const receipt = {
    schemaVersion: 'ecos-agent-private-progress-comparison/1.0',
    validationMode: 'shadow',
    questionTransport: 'private_cloud_run_agent_runtime',
    activityClass: 'task-update-photo-and-completion-research',
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

async function loadExactProjects(admin) {
  const { data, error } = await admin.from('projects')
    .select('id,name,owner_id,archived')
    .eq('archived', false)
    .in('name', PROJECT_NAMES);
  if (error) throw error;
  const rows = data || [];
  if (rows.length !== PROJECT_NAMES.length) {
    throw new Error('progress_projects_missing');
  }
  for (const name of PROJECT_NAMES) {
    if (rows.filter((row) => text(row.name) === name).length !== 1) {
      throw new Error(`progress_project_identity_ambiguous:${name}`);
    }
  }
  const ownerIds = [...new Set(rows.map((row) => text(row.owner_id)))];
  if (ownerIds.length !== 1 || !ownerIds[0]) {
    throw new Error('progress_owner_identity_ambiguous');
  }
  return {
    ownerId: ownerIds[0],
    byName: new Map(rows.map((row) => [
      text(row.name),
      { id: text(row.id), name: text(row.name) },
    ])),
  };
}

async function captureProgressFixture(admin, projects) {
  const rows = [];
  for (const projectName of PROJECT_NAMES) {
    const project = projects.byName.get(projectName);
    if (!project) throw new Error('progress_project_missing');
    const [scheduleResult, updateResult, noteResult] = await Promise.all([
      admin.from('schedule_items')
        .select('id,project_name,task_name,item_data,updated_at')
        .eq('project_name', projectName)
        .order('id', { ascending: true }),
      admin.from('project_updates')
        .select('id,project_name,update_data,created_at')
        .eq('project_name', projectName)
        .order('id', { ascending: true }),
      admin.from('field_notes')
        .select('id,project_id,project_name,location_name,original_text,action_kind,action_text,status,updated_at')
        .or(`project_id.eq.${project.id},project_name.eq.${projectName}`)
        .order('id', { ascending: true }),
    ]);
    for (const result of [scheduleResult, updateResult, noteResult]) {
      if (result.error) throw result.error;
    }
    rows.push(
      ...(scheduleResult.data || []).map((row) =>
        normalizeScheduleRow(row, projectName)
      ),
      ...(updateResult.data || []).map((row) =>
        normalizeUpdateRow(row, projectName)
      ),
      ...(noteResult.data || []).map((row) =>
        normalizeNoteRow(row, projectName)
      ),
    );
  }
  rows.sort((left, right) =>
    left.projectName.localeCompare(right.projectName) ||
    left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
  );
  return {
    capturedAt: new Date().toISOString(),
    rows,
    counts: countBy(rows, (row) => `${row.projectName}:${row.kind}`),
    snapshotSha256: sha256(stableStringify(rows)),
  };
}

function deriveCases(fixture) {
  const projectRows = (projectName, kind) => fixture.rows.filter((row) =>
    row.projectName === projectName && row.kind === kind
  );
  const uniqueSchedule = (projectName, taskName) => {
    const matches = projectRows(projectName, 'schedule').filter((row) =>
      canonical(row.taskName) === canonical(taskName)
    );
    if (matches.length !== 1) {
      throw new Error(`progress_schedule_task_not_unique:${taskName}`);
    }
    return matches[0];
  };
  const taskUpdates = (projectName, taskName) => projectRows(projectName, 'update')
    .filter((row) => canonical(row.taskName) === canonical(taskName))
    .sort(compareOccurredDescending);
  const panelsTask = uniqueSchedule(
    '2375 Compliance Project',
    'INSTALL PANELS & GIRTS',
  );
  const panelsLatest = taskUpdates(
    '2375 Compliance Project',
    panelsTask.taskName,
  )[0];
  if (!panelsLatest) throw new Error('progress_panels_update_missing');
  const waterTask = uniqueSchedule(
    '2375 Compliance Project',
    'Make water shutoff cover flush with cement',
  );
  const waterLatest = taskUpdates(
    '2375 Compliance Project',
    waterTask.taskName,
  )[0];
  if (!waterLatest) throw new Error('progress_water_update_missing');
  const southPhotoUpdates = projectRows('2321 Compliance Project', 'update')
    .filter((row) =>
      locationMatches('2321 South Lot', row.locationName) && row.photoCount > 0
    ).sort(compareOccurredAscending);
  if (
    southPhotoUpdates.length === 0 || southPhotoUpdates.length > 25
  ) throw new Error('progress_south_photo_set_unbounded');
  const northOpenIssues = projectRows('2375 Compliance Project', 'memory')
    .filter((row) =>
      locationMatches('2375 North Lot', row.locationName) &&
      canonical(row.status) === 'open'
    ).sort(compareOccurredDescending);
  if (northOpenIssues.length === 0 || northOpenIssues.length > 25) {
    throw new Error('progress_north_open_issue_set_unbounded');
  }
  const firstCompleted = projectRows('2375 Compliance Project', 'schedule')
    .filter((row) => canonical(row.status) === 'complete' || row.percentComplete === 100)
    .sort((left, right) =>
      canonical(left.taskName).localeCompare(canonical(right.taskName)) ||
      left.id.localeCompare(right.id)
    )[0];
  if (!firstCompleted) throw new Error('progress_completed_task_missing');
  return [
    {
      id: 'progress-01',
      projectName: '2375 Compliance Project',
      question:
        'What is the latest documented progress on INSTALL PANELS & GIRTS at Canopy A?',
      expectedRows: [panelsLatest, panelsTask],
      requiredValues: [
        panelsTask.taskName,
        panelsLatest.occurredAt,
        panelsLatest.locationName,
        panelsTask.status,
        `${panelsTask.percentComplete}%`,
      ],
      requiredAnyConcepts: [
        ['inspection acceptance', 'inspection accepted'],
        ['no inspection', 'not recorded', 'separate inspection'],
      ],
    },
    {
      id: 'progress-02',
      projectName: '2375 Compliance Project',
      question:
        'Where and when was the most recent update for the water-shutoff cover task?',
      expectedRows: [waterLatest],
      requiredValues: [
        waterTask.taskName,
        waterLatest.occurredAt,
        waterLatest.locationName,
      ],
      requiredAnyConcepts: [],
    },
    {
      id: 'progress-03',
      projectName: '2321 Compliance Project',
      question: 'What photo-backed work has been reported for the 2321 South Lot?',
      expectedRows: southPhotoUpdates,
      requiredValues: [
        '2321 South Lot',
        ...[...new Set(southPhotoUpdates.map((row) => row.taskName))],
        ...[...new Set(southPhotoUpdates.map((row) => row.occurredAt))],
      ],
      requiredAnyConcepts: [['photo', 'picture', 'image']],
      photoOnly: true,
    },
    {
      id: 'progress-04',
      projectName: '2375 Compliance Project',
      question: 'Which open field issues are recorded for the 2375 North Lot?',
      expectedRows: northOpenIssues,
      requiredValues: northOpenIssues.flatMap((row) => [
        row.locationName,
        row.observation,
      ]),
      requiredAnyConcepts: [['open', 'unresolved', 'outstanding']],
      openIssuesOnly: true,
    },
    {
      id: 'progress-05',
      projectName: '2375 Compliance Project',
      question: 'Does a completed task prove the work passed inspection?',
      expectedRows: [firstCompleted],
      requiredValues: [firstCompleted.taskName],
      requiredAnyConcepts: [
        ['no', 'does not', 'not proof'],
        ['inspection acceptance', 'inspection accepted', 'separate inspection'],
      ],
      completionBoundary: true,
    },
  ];
}

function evaluateProgressCase(evaluationCase, response, fixture, project) {
  const failures = [];
  const answerCorpus = canonical([
    text(response.answer),
    ...(Array.isArray(response.facts)
      ? response.facts.map((fact) => text(fact?.statement))
      : []),
    ...(Array.isArray(response.limitations)
      ? response.limitations.map(text)
      : []),
  ].join(' '));
  const evidence = (response.supportingEvidence || []).filter((item) =>
    ['schedule', 'update', 'memory'].includes(text(item?.sourceType)) &&
    text(item?.recordId)
  );
  const evidenceIds = [...new Set(evidence.map((item) => text(item.recordId)))];
  const projectFixtureRows = fixture.rows.filter((row) =>
    row.projectName === evaluationCase.projectName
  );
  const fixtureById = new Map(projectFixtureRows.map((row) => [row.id, row]));
  const expectedIds = new Set(evaluationCase.expectedRows.map((row) => row.id));
  if (text(response.schemaVersion) !== 'ecos-project-question/2.0') {
    failures.push('Response schema is not ecos-project-question/2.0.');
  }
  if (text(response.projectId) !== project.id || text(response.projectName) !== project.name) {
    failures.push('Response is not bound to the exact selected project.');
  }
  if (canonical(response.question) !== canonical(evaluationCase.question)) {
    failures.push('Response question does not match the submitted progress question.');
  }
  if (!uuid(response.diagnostics?.traceId) || !uuid(response.diagnostics?.evidenceDossierId)) {
    failures.push('Response is missing fresh trace or evidence dossier identity.');
  }
  if (!['verified', 'verified_with_limits'].includes(response.assurance?.status)) {
    failures.push(`Progress answer was not verified: ${text(response.assurance?.status)}.`);
  }
  if ((Number(response.assurance?.verifiedFactCount) || 0) < 1) {
    failures.push('ECOS Assurance did not verify a progress fact.');
  }
  for (const value of evaluationCase.requiredValues) {
    if (!answerContainsValue(answerCorpus, value)) {
      failures.push(`Answer omitted a frozen expected progress value: ${value}.`);
    }
  }
  for (const alternatives of evaluationCase.requiredAnyConcepts || []) {
    if (!alternatives.some((value) => answerCorpus.includes(canonical(value)))) {
      failures.push(
        `Answer omitted every accepted progress meaning: ${alternatives.join(' or ')}.`,
      );
    }
  }
  if (evidenceIds.length === 0) {
    failures.push('Answer has no task, update, or field-note evidence record.');
  }
  for (const expectedId of expectedIds) {
    if (!evidenceIds.includes(expectedId)) {
      failures.push('Answer did not cite every expected frozen progress record.');
      break;
    }
  }
  const projectIsolationPreserved = evidenceIds.every((id) => fixtureById.has(id));
  if (!projectIsolationPreserved) {
    failures.push('Answer cited a record outside the frozen selected-project snapshot.');
  }
  if (evaluationCase.photoOnly) {
    const nonPhotoUpdate = evidenceIds.some((id) => {
      const row = fixtureById.get(id);
      return row?.kind === 'update' && row.photoCount <= 0;
    });
    if (nonPhotoUpdate) failures.push('Photo-backed answer cited an update with no photo.');
  }
  if (evaluationCase.openIssuesOnly) {
    const nonOpenIssue = evidenceIds.some((id) => {
      const row = fixtureById.get(id);
      return row?.kind === 'memory' && canonical(row.status) !== 'open';
    });
    if (nonOpenIssue) failures.push('Open-issue answer cited a resolved field note.');
  }
  if (evaluationCase.completionBoundary) {
    if (!/\bno\b|does not|not proof/.test(answerCorpus)) {
      failures.push('Completion answer did not clearly deny automatic inspection acceptance.');
    }
    if (/\b(?:passed|accepted|approved)\b.{0,40}\b(?:inspection|sign off)\b/.test(answerCorpus) &&
        !/\b(?:not|no|does not)\b/.test(answerCorpus)) {
      failures.push('Completion answer treated task status as inspection acceptance.');
    }
  }
  return { failures, evidenceIds, projectIsolationPreserved };
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
  throw lastError || new Error('private_progress_request_failed');
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
    `private_progress_capacity_insufficient:${available}/${requiredSlots}:full_window_at_${fullWindowAt}`,
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
    throw new Error(`private_progress_active_questions:${count}`);
  }
}

async function createOwnerSession({ admin, anonKey, ownerId, supabaseUrl }) {
  const user = await admin.auth.admin.getUserById(ownerId);
  const email = text(user.data?.user?.email);
  if (user.error || !email) throw new Error('private_progress_owner_missing');
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = text(link.data?.properties?.hashed_token);
  if (link.error || !tokenHash) throw new Error('private_progress_link_failed');
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  const accessToken = text(verified.data?.session?.access_token);
  if (verified.error || !accessToken) {
    throw new Error('private_progress_session_failed');
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

function normalizeScheduleRow(row, projectName) {
  const data = record(row.item_data);
  return {
    kind: 'schedule',
    id: text(row.id),
    idSha256: sha256(text(row.id)),
    projectName,
    taskName: text(data.taskName) || text(row.task_name),
    locationName: text(data.locationName),
    status: text(data.status),
    percentComplete: finiteNumberOrNull(data.percentComplete),
    occurredAt: text(row.updated_at),
    photoCount: 0,
    observation: '',
  };
}

function normalizeUpdateRow(row, projectName) {
  const data = record(row.update_data);
  return {
    kind: 'update',
    id: text(row.id),
    idSha256: sha256(text(row.id)),
    projectName,
    taskName: text(data.scheduleTaskName),
    locationName: text(data.selectedAreaName),
    status: '',
    percentComplete: null,
    occurredAt: text(data.date) || text(row.created_at),
    photoCount: Array.isArray(data.photos) ? data.photos.length : 0,
    observation: text(data.notes) || text(data.pieSuggestedNote),
  };
}

function normalizeNoteRow(row, projectName) {
  return {
    kind: 'memory',
    id: text(row.id),
    idSha256: sha256(text(row.id)),
    projectName,
    taskName: '',
    locationName: text(row.location_name),
    status: text(row.status),
    percentComplete: null,
    occurredAt: text(row.updated_at),
    photoCount: 0,
    observation: text(row.original_text),
  };
}

function publicFixtureReceipt(fixture) {
  return {
    capturedAt: fixture.capturedAt,
    counts: fixture.counts,
    snapshotSha256: fixture.snapshotSha256,
    rowIdentitySha256: sha256(JSON.stringify(
      fixture.rows.map((row) => row.idSha256).sort(),
    )),
  };
}

function scoreModel(model, results) {
  const profile = MODEL_PROFILES.find((item) => item.model === model);
  if (!profile) throw new Error(`progress_model_profile_missing:${model}`);
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
  const citationRate = rate(results, (item) => item.evidenceCount > 0);
  const isolationRate = rate(results, (item) => item.projectIsolationPreserved);
  const repeatabilityRate = groupedRepeatability(results, (item) =>
    JSON.stringify([
      item.passed,
      item.answerSha256,
      item.evidenceFingerprint,
      item.assuranceStatus,
    ])
  );
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
    repeatabilityRate,
    meanLatencyMs: mean(results.map((item) => item.latencyMs)),
    p95LatencyMs,
    meanToolCalls: mean(results.map((item) => item.agent.toolCalls)),
    usage,
    estimatedCostUsd,
    eligibleForRecommendation: results.length > 0 && passRate === 1 &&
      citationRate === 1 && isolationRate === 1 && repeatabilityRate === 1 &&
      p95LatencyMs <= 60_000,
  };
}

function answerContainsValue(corpus, value) {
  const raw = text(value);
  if (!raw) return true;
  const normalized = canonical(raw);
  if (corpus.includes(normalized)) return true;
  const key = dateKey(raw);
  if (!key) return false;
  if (corpus.includes(canonical(key))) return true;
  const [year, month, day] = key.split('-').map(Number);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' })
    .format(new Date(Date.UTC(year, month - 1, day)));
  return corpus.includes(canonical(`${month}/${day}/${year}`)) ||
    corpus.includes(canonical(`${monthName} ${day} ${year}`));
}

function locationMatches(query, candidate) {
  const strip = (value) => canonical(value).replace(/^\d{3,6}\s+/, '').trim();
  return strip(query) === strip(candidate);
}

function compareOccurredDescending(left, right) {
  return -compareDates(left.occurredAt, right.occurredAt) ||
    left.id.localeCompare(right.id);
}

function compareOccurredAscending(left, right) {
  return compareDates(left.occurredAt, right.occurredAt) ||
    left.id.localeCompare(right.id);
}

function compareDates(left, right) {
  const leftTime = Date.parse(text(left));
  const rightTime = Date.parse(text(right));
  return (Number.isFinite(leftTime) ? leftTime : 0) -
    (Number.isFinite(rightTime) ? rightTime : 0);
}

function dateKey(value) {
  const raw = text(value);
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw)?.[1];
  if (iso) return iso;
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
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
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
  return values.length === 0
    ? 0
    : values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

function mean(values) {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
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
