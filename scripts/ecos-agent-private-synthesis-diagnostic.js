#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
  mintCloudRunIdToken,
} = require('./ecos-agent-google-wif-token');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = text(process.env.ECOS_AGENT_SYNTHESIS_OUTPUT)
  ? path.resolve(ROOT, text(process.env.ECOS_AGENT_SYNTHESIS_OUTPUT))
  : path.join(
    ROOT,
    'validation',
    'output',
    'ecos-agent-private-synthesis-diagnostic.json',
  );
const RUNTIME_URL = required('ECOS_AGENT_COMPARISON_URL').replace(/\/+$/, '');
const GATEWAY_TOKEN = required('ECOS_AGENT_COMPARISON_GATEWAY_TOKEN');
let serverlessAuthorization = text(
  process.env.ECOS_AGENT_SERVERLESS_AUTHORIZATION,
);
const WIF_PROVIDER_RESOURCE = text(process.env.ECOS_AGENT_WIF_PROVIDER_RESOURCE);
const WIF_SERVICE_ACCOUNT = text(process.env.ECOS_AGENT_WIF_SERVICE_ACCOUNT);
const SERVERLESS_AUDIENCE = text(process.env.ECOS_AGENT_SERVERLESS_AUDIENCE);
const EXPECTED_PACKAGE_SHA256 = required('ECOS_AGENT_EXPECTED_PACKAGE_SHA256');
const QUESTION_DELAY_MS = boundedInteger(
  process.env.ECOS_PRIVATE_QUESTION_DELAY_MS,
  10_000,
  60_000,
  10_000,
);
const REPETITIONS = boundedInteger(
  process.env.ECOS_AGENT_SYNTHESIS_REPETITIONS,
  1,
  3,
  1,
);
const CASE_SET = text(process.env.ECOS_AGENT_SYNTHESIS_CASE_SET) || 'baseline';
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
const ALL_MODELS = Object.freeze([
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'deepseek-v4-flash',
]);
const MODEL_PRICING = Object.freeze({
  'gpt-5.6-luna': Object.freeze({ input: 0.2, cachedInput: 0.02, output: 1.2 }),
  'gpt-5.6-terra': Object.freeze({ input: 2, cachedInput: 0.2, output: 12 }),
  'gpt-5.6-sol': Object.freeze({ input: 4, cachedInput: 0.4, output: 20 }),
  'deepseek-v4-flash': Object.freeze({
    input: 0.14,
    cachedInput: 0.0028,
    output: 0.28,
  }),
});
const MODELS = selectedModels();
const BASELINE_CASES = Object.freeze([
  Object.freeze({
    id: 'synthesis-01-signoff-readiness',
    question: 'What still needs to be completed before this project can be signed off?',
  }),
  Object.freeze({
    id: 'synthesis-02-current-risks',
    question: 'What are the highest documented project risks right now?',
  }),
  Object.freeze({
    id: 'synthesis-03-two-week-focus',
    question: 'What should the superintendent focus on during the next two weeks?',
  }),
  Object.freeze({
    id: 'synthesis-04-hazmat-canopy',
    question: 'Summarize the current 2321 hazardous-material canopy requirements and progress.',
  }),
  Object.freeze({
    id: 'synthesis-05-overdue-without-update',
    question: 'Which overdue work has no recent field update?',
  }),
]);
const BROAD_RESEARCH_CASES = Object.freeze([
  Object.freeze({
    id: 'broad-research-01-signoff-brief',
    semanticOracleId: 'synthesis-01-signoff-readiness',
    question:
      'Give me a 2321 sign-off readiness brief. Separate incomplete and overdue schedule work, open field issues, and any actual inspection acceptance; then tell me the next evidence-backed actions.',
    requiredToolNames: Object.freeze([
      'inspect_project_evidence_inventory',
      'list_project_schedule_activities',
      'list_project_progress_records',
    ]),
    requiredEvidenceTypes: Object.freeze(['project', 'memory']),
  }),
  Object.freeze({
    id: 'broad-research-02-risk-brief',
    semanticOracleId: 'synthesis-02-current-risks',
    question:
      'Prepare a current 2321 risk briefing using the schedule, field records, and available project evidence. Rank only risks the evidence supports and clearly label your recommendations.',
    requiredToolNames: Object.freeze([
      'inspect_project_evidence_inventory',
      'list_project_schedule_activities',
      'list_project_progress_records',
    ]),
    requiredEvidenceTypes: Object.freeze(['project', 'memory']),
  }),
  Object.freeze({
    id: 'broad-research-03-two-week-plan',
    semanticOracleId: 'synthesis-03-two-week-focus',
    question:
      "Create the superintendent's 2321 two-week plan from the current schedule and open field records. Identify the work starting in the next two weeks, unresolved safety issues, and what the records cannot prove.",
    requiredToolNames: Object.freeze([
      'inspect_project_evidence_inventory',
      'list_project_schedule_activities',
      'list_project_progress_records',
    ]),
    requiredEvidenceTypes: Object.freeze(['project', 'schedule', 'memory']),
  }),
  Object.freeze({
    id: 'broad-research-04-hazmat-canopy-brief',
    semanticOracleId: 'synthesis-04-hazmat-canopy',
    question:
      'Give me an evidence-backed 2321 hazardous-material canopy briefing covering the governing drawing requirements, schedule status, field progress or photos, and inspection acceptance.',
    requiredToolNames: Object.freeze([
      'inspect_project_evidence_inventory',
      'search_project_evidence',
      'list_project_schedule_activities',
      'list_project_progress_records',
      'open_project_evidence',
    ]),
    requiredEvidenceTypes: Object.freeze(['project', 'document', 'schedule']),
  }),
  Object.freeze({
    id: 'broad-research-05-overdue-update-audit',
    semanticOracleId: 'synthesis-05-overdue-without-update',
    question:
      'Audit overdue 2321 work against recent field updates. Which activities have no task-and-location-matched update, where are they, and what must be checked before concluding the field work is incomplete?',
    requiredToolNames: Object.freeze([
      'inspect_project_evidence_inventory',
      'list_project_schedule_activities',
      'list_project_progress_records',
    ]),
    requiredEvidenceTypes: Object.freeze(['project']),
  }),
]);
const CASES = selectedCases();

async function main() {
  const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = required('SUPABASE_ANON_KEY');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const serviceWorkerToken = required('ECOS_SERVICE_WORKER_TOKEN');
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const project = await loadExactProject(admin);
  let runtime = null;
  const semanticOracle = await captureSynthesisOracle(admin, project);
  const snapshotBefore = await captureProjectState(admin, project);
  const attempts = [];
  for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
    for (const evaluationCase of CASES) {
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
    runtime = await readRuntimeIdentity({
      anonKey,
      serviceWorkerToken,
    });
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
      const diagnostics = record(response?.diagnostics);
      const agentDiagnostics = record(response?.agentEvaluationDiagnostics);
      const structuralFailures = evaluateStructure({
        response,
        project,
        question: attempt.evaluationCase.question,
        latencyMs,
      });
      const semanticFailures = evaluateSemantics({
        response,
        project,
        evaluationCase: attempt.evaluationCase,
        oracle: semanticOracle,
      });
      const researchBreadthFailures = evaluateResearchBreadth({
        response,
        evaluationCase: attempt.evaluationCase,
      });
      const failures = [
        ...structuralFailures,
        ...semanticFailures,
        ...researchBreadthFailures,
      ];
      const answerFingerprint = sha256(canonical(JSON.stringify({
        answer: text(response?.answer),
        facts: Array.isArray(response?.facts)
          ? response.facts.map((item) => ({
            statement: text(item?.statement),
            classification: text(item?.classification),
          }))
          : [],
        limitations: Array.isArray(response?.limitations)
          ? response.limitations.map(text)
          : [],
        conflicts: Array.isArray(response?.conflicts)
          ? response.conflicts.map(text)
          : [],
      })));
      const proofFingerprint = sha256(JSON.stringify(
        (Array.isArray(response?.supportingEvidence)
          ? response.supportingEvidence
          : []).map((item) => ({
            sourceType: text(item?.sourceType),
            recordId: text(item?.recordId),
            sheetNumber: text(item?.documentCitation?.sheetNumber),
            pageNumber: Number(item?.documentCitation?.pageNumber) || null,
            regionId: text(item?.documentRegion?.regionId),
          })).sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right))
          ),
      ));
      results.push({
        id: attempt.evaluationCase.id,
        activityClass: 'cross-document-synthesis-and-recommendations',
        model: attempt.model,
        repetition: attempt.repetition,
        projectNameSha256: sha256(project.name),
        questionSha256: sha256(attempt.evaluationCase.question),
        answerFingerprint,
        proofFingerprint,
        latencyMs,
        passed: failures.length === 0,
        structuralPass: structuralFailures.length === 0,
        structuralFailures,
        semanticPass: semanticFailures.length === 0,
        semanticFailures,
        researchBreadthPass: researchBreadthFailures.length === 0,
        researchBreadthFailures,
        traceId: text(diagnostics.traceId),
        evidenceSnapshotId: text(diagnostics.evidenceSnapshotId),
        evidenceDossierId: text(diagnostics.evidenceDossierId),
        persisted: diagnostics.persisted === true,
        replayed: diagnostics.replayed === true,
        response,
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
        `[${index + 1}/${attempts.length}] ${failures.length === 0 ? 'PASS' : 'FAIL'} ${attempt.model} ` +
          `${attempt.evaluationCase.id} repeat-${attempt.repetition} ${latencyMs}ms ` +
          `structural=${structuralFailures.length === 0 ? 'pass' : 'fail'} ` +
          `semantic=${semanticFailures.length === 0 ? 'pass' : 'fail'} ` +
          `research=${researchBreadthFailures.length === 0 ? 'pass' : 'fail'}`,
      );
      failures.forEach((failure) => console.log(`- ${failure}`));
      if (index < attempts.length - 1) await wait(QUESTION_DELAY_MS);
    }
  } catch (error) {
    runError = safeError(error);
  } finally {
    revocationVerified = await revokeOwnerSession({ admin, session });
  }

  const snapshotAfter = await captureProjectState(admin, project);
  const projectStateStable = snapshotBefore.snapshotSha256 ===
    snapshotAfter.snapshotSha256;
  const traceIds = results.map((item) => item.traceId).filter(Boolean);
  const dossierIds = results.map((item) => item.evidenceDossierId).filter(Boolean);
  const repeatability = evaluateRepeatability(results);
  const scores = MODELS.map((model) => scoreModel(model, results));
  const integrityFailures = [
    ...(results.length === attempts.length
      ? []
      : ['Not every cross-document synthesis attempt completed.']),
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
    ...(projectStateStable
      ? []
      : ['Selected-project task, update, note, or document state changed.']),
    ...(repeatability.failures),
    ...(runError ? [`Run stopped safely: ${runError}`] : []),
  ];
  const receipt = {
    schemaVersion: 'ecos-agent-private-synthesis-diagnostic/1.0',
    validationMode: 'shadow',
    questionTransport: 'private_cloud_run_agent_runtime',
    activityClass: 'cross-document-synthesis-and-recommendations',
    caseSet: CASE_SET,
    diagnosticOnly: true,
    startedAt,
    completedAt: new Date().toISOString(),
    models: MODELS,
    repetitions: REPETITIONS,
    caseIds: CASES.map((item) => item.id),
    runtime: {
      revision: text(runtime?.revision),
      packageSha256: text(runtime?.packagedSourceSha256),
    },
    projectState: {
      beforeSha256: snapshotBefore.snapshotSha256,
      afterSha256: snapshotAfter.snapshotSha256,
      stable: projectStateStable,
      counts: snapshotBefore.counts,
    },
    semanticOracle: publicSemanticOracle(semanticOracle),
    summary: {
      total: attempts.length,
      completed: results.length,
      passed: results.filter((item) => item.passed).length,
      failed: attempts.length - results.filter((item) => item.passed).length,
      structuralPassed: results.filter((item) => item.structuralPass).length,
      structuralFailed: results.filter((item) => !item.structuralPass).length,
      semanticPassed: results.filter((item) => item.semanticPass).length,
      semanticFailed: attempts.length - results.filter((item) => item.semanticPass).length,
      researchBreadthPassed: results.filter((item) => item.researchBreadthPass).length,
      researchBreadthFailed: attempts.length -
        results.filter((item) => item.researchBreadthPass).length,
      answerRepeatabilityRate: repeatability.answerRate,
      proofRepeatabilityRate: repeatability.proofRate,
      assuranceStatusRepeatabilityRate: repeatability.assuranceRate,
      scores,
      uniqueTraceCount: new Set(traceIds).size,
      uniqueDossierCount: new Set(dossierIds).size,
      sessionRevocationVerified: revocationVerified,
      projectStateStable,
      integrityFailures,
      semanticQualificationDeferred: false,
    },
    results,
  };
  atomicWrite(OUTPUT_PATH, receipt);
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    receiptSha256: sha256(fs.readFileSync(OUTPUT_PATH)),
    summary: receipt.summary,
  }, null, 2));
  if (receipt.summary.failed > 0 || integrityFailures.length > 0) {
    process.exitCode = 1;
  }
}

function evaluateStructure({ response, project, question, latencyMs }) {
  const failures = [];
  if (!response || typeof response !== 'object') {
    return ['Candidate returned no structured response.'];
  }
  if (text(response.schemaVersion) !== 'ecos-project-question/2.0') {
    failures.push('Response schema is not ecos-project-question/2.0.');
  }
  if (text(response.projectId) !== project.id || text(response.projectName) !== project.name) {
    failures.push('Response is not bound to the exact selected project.');
  }
  if (canonical(response.question) !== canonical(question)) {
    failures.push('Response question does not match the submitted end-user wording.');
  }
  if (response.validationMode !== 'shadow') {
    failures.push('Response did not identify protected shadow validation mode.');
  }
  if (!uuid(response.diagnostics?.traceId) || !uuid(response.diagnostics?.evidenceDossierId)) {
    failures.push('Response is missing fresh trace or evidence dossier identity.');
  }
  if (latencyMs > 60_000) {
    failures.push(`Latency ${latencyMs} ms exceeded the 60-second beta ceiling.`);
  }
  const errorCode = text(response.agentEvaluationDiagnostics?.errorCode);
  if (errorCode) failures.push(`Agent model failure: ${errorCode}.`);
  return failures;
}

function evaluateSemantics({ response, project, evaluationCase, oracle }) {
  const failures = [];
  const corpus = canonical([
    text(response?.answer),
    ...(Array.isArray(response?.facts)
      ? response.facts.map((item) => text(item?.statement))
      : []),
    ...(Array.isArray(response?.limitations)
      ? response.limitations.map(text)
      : []),
  ].join(' '));
  const evidence = Array.isArray(response?.supportingEvidence)
    ? response.supportingEvidence
    : [];
  const evidenceIds = new Set(evidence.map((item) => text(item?.recordId)).filter(Boolean));
  const requireValue = (value, label = value) => {
    if (!answerContainsValue(corpus, value)) {
      failures.push(`Answer omitted expected ${label}: ${value}.`);
    }
  };
  const requireAny = (values, label) => {
    if (!values.some((value) => corpus.includes(canonical(value)))) {
      failures.push(`Answer omitted ${label}: ${values.join(' or ')}.`);
    }
  };
  const requireEvidenceIds = (ids, label) => {
    const missing = ids.filter((id) => !evidenceIds.has(id));
    if (missing.length > 0) {
      failures.push(`${label} omitted ${missing.length} expected supporting record(s).`);
    }
  };
  if (!['verified', 'verified_with_limits'].includes(text(response?.assurance?.status))) {
    failures.push(`Answer was not verified: ${text(response?.assurance?.status)}.`);
  }
  if ((Number(response?.assurance?.verifiedFactCount) || 0) < 1) {
    failures.push('ECOS Assurance did not verify a factual statement.');
  }

  const semanticOracleId = text(evaluationCase.semanticOracleId) ||
    evaluationCase.id;
  if (semanticOracleId === 'synthesis-01-signoff-readiness') {
    requireValue(String(oracle.openCount), 'incomplete-activity count');
    requireValue(String(oracle.scheduleCount), 'total schedule count');
    requireValue(String(oracle.overdueCount), 'overdue count');
    requireValue(String(oracle.openIssues.length), 'open-issue count');
    oracle.openIssues.forEach((issue) => requireValue(issue.observation, 'open issue'));
    requireAny(['inspection acceptance', 'project sign off'], 'acceptance boundary');
    requireAny(['recommended action', 'before treating the project as signed off'], 'next action');
    requireEvidenceIds(
      [project.id, ...oracle.openIssues.map((issue) => issue.id)],
      'Sign-off answer',
    );
  } else if (semanticOracleId === 'synthesis-02-current-risks') {
    requireValue(String(oracle.overdueCount), 'overdue count');
    oracle.openIssues.forEach((issue) => requireValue(issue.observation, 'open issue'));
    requireAny(['formal probability impact ranking', 'formal risk severity'], 'risk-ranking limitation');
    requireAny(['recommended action', 'operational recommendations'], 'recommendation label');
    if (oracle.safetyIssues[0]) {
      requireValue(oracle.safetyIssues[0].observation, 'open safety issue');
    }
    requireEvidenceIds(
      [project.id, ...oracle.openIssues.map((issue) => issue.id)],
      'Risk answer',
    );
  } else if (semanticOracleId === 'synthesis-03-two-week-focus') {
    requireValue(String(oracle.upcoming.length), 'two-week activity count');
    requireValue(oracle.snapshotDate, 'two-week start date');
    requireValue(oracle.throughDate, 'two-week end date');
    oracle.upcoming.forEach((activity) => {
      requireValue(activity.taskName, 'two-week activity');
      requireValue(activity.startDate, 'two-week start');
    });
    requireAny(['recommended action', 'resolve or control'], 'superintendent priority');
    requireEvidenceIds(
      [project.id, ...oracle.upcoming.map((activity) => activity.id)],
      'Two-week answer',
    );
  } else if (semanticOracleId === 'synthesis-04-hazmat-canopy') {
    if (
      !corpus.includes(canonical('weather protected canopy hazardous material plan')) &&
      !(
        corpus.includes(canonical('a 1 5a')) &&
        corpus.includes(canonical('hazardous material'))
      )
    ) {
      failures.push('Answer omitted canopy-plan identity.');
    }
    requireAny(['a 1 5a'], 'canopy-plan sheet');
    requireAny(['containment area 1'], 'first containment assignment');
    requireAny(['containment area 2'], 'second containment assignment');
    requireAny(
      ['california fire code chapter 50', 'concrete containment curb', 'spill'],
      'substantive hazardous-material requirement',
    );
    requireAny([
      'no canopy matched field update',
      'no matching authorized progress record',
      'returned zero records matching',
      'no authorized task progress',
      'provides no field update',
    ], 'progress limitation');
    requireAny([
      'inspection acceptance',
      'inspection or acceptance',
      'acceptance record',
      'no separate authorized inspection',
    ], 'acceptance limitation');
    if (!evidence.some((item) =>
      text(item?.sourceType) === 'document' &&
      canonical(item?.documentCitation?.sheetNumber) === 'a 1 5a'
    )) {
      failures.push('Canopy answer did not cite the exact A-1.5A document sheet.');
    }
  } else if (semanticOracleId === 'synthesis-05-overdue-without-update') {
    requireValue(String(oracle.overdueWithoutRecent.length), 'no-recent-update count');
    requireValue(oracle.recentSince, 'recent-window start date');
    requireValue(oracle.snapshotDate, 'recent-window end date');
    oracle.locationCounts.forEach(([location, count]) => {
      if (!corpus.includes(canonical(`${location} ${count}`))) {
        failures.push(`Answer omitted overdue location count: ${location} ${count}.`);
      }
    });
    requireAny(['task and location matched', 'task name matching'], 'task-update join rule');
    requireAny(['recommended action', 'review the complete overdue set'], 'overdue next action');
    requireEvidenceIds([project.id], 'Overdue answer');
  }
  return failures;
}

function evaluateResearchBreadth({ response, evaluationCase }) {
  if (CASE_SET !== 'broad-research') return [];
  const failures = [];
  const diagnostics = record(response?.agentEvaluationDiagnostics);
  const trace = Array.isArray(diagnostics.toolTrace)
    ? diagnostics.toolTrace
    : [];
  const toolNames = trace.map((item) => text(item?.name)).filter(Boolean);
  const completedToolNames = new Set(
    trace
      .filter((item) => ['completed', 'cached'].includes(text(item?.status)))
      .map((item) => text(item?.name))
      .filter(Boolean),
  );
  const requiredToolNames = Array.isArray(evaluationCase.requiredToolNames)
    ? evaluationCase.requiredToolNames
    : [];
  for (const requiredTool of requiredToolNames) {
    if (!completedToolNames.has(requiredTool)) {
      failures.push(`Broad research did not complete required tool: ${requiredTool}.`);
    }
  }
  if (toolNames[0] !== 'inspect_project_evidence_inventory') {
    failures.push('Broad research did not inspect the project evidence inventory first.');
  }
  if ((Number(diagnostics.successfulResearchCalls) || 0) < 1) {
    failures.push('Broad research completed no successful evidence-bearing research calls.');
  }
  const evidence = Array.isArray(response?.supportingEvidence)
    ? response.supportingEvidence
    : [];
  const evidenceTypes = new Set(
    evidence.map((item) => text(item?.sourceType)).filter(Boolean),
  );
  const requiredEvidenceTypes = Array.isArray(
      evaluationCase.requiredEvidenceTypes,
    )
    ? evaluationCase.requiredEvidenceTypes
    : [];
  for (const requiredType of requiredEvidenceTypes) {
    if (!evidenceTypes.has(requiredType)) {
      failures.push(`Broad answer omitted required evidence type: ${requiredType}.`);
    }
  }
  for (const item of evidence) {
    if (text(item?.sourceType) !== 'document') continue;
    const citation = record(item?.documentCitation);
    if (
      !text(citation.documentId) ||
      !Number.isInteger(Number(citation.pageNumber)) ||
      Number(citation.pageNumber) < 1
    ) {
      failures.push('A document proof item lacked an openable document and page citation.');
      break;
    }
  }
  return failures;
}

function evaluateRepeatability(results) {
  const groups = new Map();
  for (const result of results) {
    const key = `${result.model}:${result.id}`;
    const values = groups.get(key) || [];
    values.push(result);
    groups.set(key, values);
  }
  let answerPassed = 0;
  let proofPassed = 0;
  let assurancePassed = 0;
  const failures = [];
  for (const [key, values] of groups.entries()) {
    const expected = REPETITIONS;
    const answerStable = values.length === expected &&
      new Set(values.map((item) => item.answerFingerprint)).size === 1;
    const proofStable = values.length === expected &&
      new Set(values.map((item) => item.proofFingerprint)).size === 1;
    const assuranceStable = values.length === expected &&
      new Set(values.map((item) => text(item.response?.assurance?.status))).size === 1;
    if (answerStable) answerPassed += 1;
    else failures.push(`Answer fingerprint was not repeatable for ${key}.`);
    if (proofStable) proofPassed += 1;
    else failures.push(`Proof fingerprint was not repeatable for ${key}.`);
    if (assuranceStable) assurancePassed += 1;
    else failures.push(`Assurance status was not repeatable for ${key}.`);
  }
  const count = groups.size || 1;
  return {
    answerRate: answerPassed / count,
    proofRate: proofPassed / count,
    assuranceRate: assurancePassed / count,
    failures: REPETITIONS > 1 ? failures : [],
  };
}

function scoreModel(model, results) {
  const observations = results.filter((item) => item.model === model);
  const usage = observations.reduce((total, item) => ({
    inputTokens: total.inputTokens + item.agent.usage.inputTokens,
    cachedInputTokens:
      total.cachedInputTokens + item.agent.usage.cachedInputTokens,
    outputTokens: total.outputTokens + item.agent.usage.outputTokens,
    reasoningTokens: total.reasoningTokens + item.agent.usage.reasoningTokens,
    totalTokens: total.totalTokens + item.agent.usage.totalTokens,
  }), normalizedUsage({}));
  const pricing = MODEL_PRICING[model];
  const cachedInputTokens = Math.min(
    usage.inputTokens,
    usage.cachedInputTokens,
  );
  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - cachedInputTokens,
  );
  const estimatedCostUsd = pricing
    ? (uncachedInputTokens * pricing.input +
      cachedInputTokens * pricing.cachedInput +
      usage.outputTokens * pricing.output) / 1_000_000
    : 0;
  return {
    model,
    attempts: observations.length,
    passRate: rate(observations, (item) => item.passed),
    researchBreadthRate: rate(
      observations,
      (item) => item.researchBreadthPass,
    ),
    meanLatencyMs: mean(observations.map((item) => item.latencyMs)),
    p95LatencyMs: percentile(
      observations.map((item) => item.latencyMs).sort((left, right) => left - right),
      0.95,
    ),
    meanToolCalls: mean(observations.map((item) => item.agent.toolCalls)),
    usage,
    estimatedCostUsd,
  };
}

function rate(values, predicate) {
  return values.length === 0
    ? 0
    : values.filter(predicate).length / values.length;
}

function mean(values) {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
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
  throw lastError || new Error('private_synthesis_request_failed');
}

async function readRuntimeIdentity({ anonKey, serviceWorkerToken }) {
  const response = await fetch(`${RUNTIME_URL}/status`, {
    headers: {
      apikey: anonKey,
      'x-ecos-worker-token': serviceWorkerToken,
      'x-ecos-agent-gateway-token': GATEWAY_TOKEN,
      ...(serverlessAuthorization
        ? { 'x-serverless-authorization': `Bearer ${serverlessAuthorization}` }
        : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  const packagedSourceSha256 = text(body?.packagedSourceSha256);
  const headerSha256 = text(
    response.headers.get('x-ecos-agent-packaged-source-sha256'),
  );
  if (
    !response.ok || body?.service !== 'ecos-agent-query-preview' ||
    body?.protocol !== 'ecos-agent-query-preview/1.0' ||
    body?.enabled !== true || body?.customerTraffic !== false ||
    packagedSourceSha256 !== EXPECTED_PACKAGE_SHA256 ||
    headerSha256 !== EXPECTED_PACKAGE_SHA256
  ) throw new Error(`private_synthesis_runtime_identity_invalid:${response.status}`);
  return {
    revision: text(body.revision),
    packagedSourceSha256,
  };
}

async function loadExactProject(admin) {
  const { data, error } = await admin.from('projects')
    .select('id,name,owner_id,archived')
    .eq('name', PROJECT_NAME)
    .eq('archived', false);
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error('private_synthesis_project_identity_ambiguous');
  }
  return {
    id: text(data[0].id),
    name: text(data[0].name),
    ownerId: text(data[0].owner_id),
  };
}

async function captureSynthesisOracle(admin, project) {
  const [scheduleResult, updateResult, noteResult] = await Promise.all([
    admin.from('schedule_items')
      .select('id,task_name,item_data,updated_at')
      .eq('project_name', project.name)
      .order('id', { ascending: true }),
    admin.from('project_updates')
      .select('id,update_data,created_at')
      .eq('project_name', project.name)
      .order('id', { ascending: true }),
    admin.from('field_notes')
      .select('id,project_id,project_name,location_name,original_text,action_kind,action_text,status,updated_at')
      .or(`project_id.eq.${project.id},project_name.eq.${project.name}`)
      .order('id', { ascending: true }),
  ]);
  for (const result of [scheduleResult, updateResult, noteResult]) {
    if (result.error) throw result.error;
  }
  const capturedAt = new Date().toISOString();
  const snapshotDate = losAngelesDate(capturedAt);
  const throughDate = addDateDays(snapshotDate, 14);
  const recentSince = addDateDays(snapshotDate, -14);
  const schedule = (scheduleResult.data || []).map((row) => {
    const data = record(row.item_data);
    return {
      id: text(row.id),
      taskName: text(data.taskName) || text(row.task_name),
      locationName: text(data.locationName),
      status: text(data.status),
      percentComplete: finiteNumberOrNull(data.percentComplete),
      startDate: dateKey(data.startDate),
      finishDate: dateKey(data.finishDate),
    };
  });
  const updates = (updateResult.data || []).map((row) => {
    const data = record(row.update_data);
    return {
      id: text(row.id),
      taskName: text(data.scheduleTaskName),
      locationName: text(data.selectedAreaName),
      occurredAt: dateKey(text(data.date) || text(row.created_at)),
    };
  });
  const openIssues = (noteResult.data || []).flatMap((row) =>
    canonical(row.status) === 'open'
      ? [{
        id: text(row.id),
        locationName: text(row.location_name),
        observation: text(row.original_text),
        actionKind: text(row.action_kind),
        actionText: text(row.action_text),
      }]
      : []
  );
  const completed = schedule.filter((row) =>
    canonical(row.status) === 'complete' || row.percentComplete === 100
  );
  const open = schedule.filter((row) => !completed.includes(row));
  const overdue = open.filter((row) =>
    row.finishDate && row.finishDate < snapshotDate
  );
  const recentUpdates = updates.filter((row) =>
    row.occurredAt && row.occurredAt >= recentSince &&
    row.occurredAt <= snapshotDate
  );
  const scheduleTaskCounts = countBy(schedule, (row) => canonical(row.taskName));
  const overdueWithoutRecent = overdue.filter((activity) =>
    !recentUpdates.some((update) =>
      oracleUpdateMatchesActivity({
        activity,
        update,
        sameNamedScheduleCount: scheduleTaskCounts[canonical(activity.taskName)] || 0,
      })
    )
  ).sort(compareOracleOverdue);
  const locationCounts = Object.entries(countBy(
    overdueWithoutRecent,
    (row) => row.locationName || 'not recorded',
  )).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const upcoming = open.filter((row) =>
    row.startDate && row.startDate >= snapshotDate && row.startDate <= throughDate
  ).sort((left, right) =>
    text(left.startDate).localeCompare(text(right.startDate)) ||
    left.taskName.localeCompare(right.taskName) || left.id.localeCompare(right.id)
  );
  const safetyIssues = openIssues.filter((issue) =>
    canonical(issue.actionKind).includes('safety')
  );
  return {
    capturedAt,
    snapshotDate,
    throughDate,
    recentSince,
    scheduleCount: schedule.length,
    completedCount: completed.length,
    openCount: open.length,
    overdueCount: overdue.length,
    overdueWithoutRecent,
    locationCounts,
    upcoming,
    openIssues,
    safetyIssues,
  };
}

function publicSemanticOracle(oracle) {
  return {
    capturedAt: oracle.capturedAt,
    snapshotDate: oracle.snapshotDate,
    throughDate: oracle.throughDate,
    recentSince: oracle.recentSince,
    scheduleCount: oracle.scheduleCount,
    completedCount: oracle.completedCount,
    openCount: oracle.openCount,
    overdueCount: oracle.overdueCount,
    overdueWithoutRecentCount: oracle.overdueWithoutRecent.length,
    locationCounts: oracle.locationCounts,
    upcomingCount: oracle.upcoming.length,
    openIssueCount: oracle.openIssues.length,
    safetyIssueCount: oracle.safetyIssues.length,
    expectedIdentitySha256: sha256(JSON.stringify([
      ...oracle.overdueWithoutRecent.map((row) => row.id),
      ...oracle.upcoming.map((row) => row.id),
      ...oracle.openIssues.map((row) => row.id),
    ].sort())),
  };
}

function oracleUpdateMatchesActivity({ activity, update, sameNamedScheduleCount }) {
  if (!canonical(activity.taskName) ||
      canonical(activity.taskName) !== canonical(update.taskName)) return false;
  if (sameNamedScheduleCount <= 1) return true;
  return Boolean(
    canonical(activity.locationName) && canonical(update.locationName) &&
    canonical(activity.locationName) === canonical(update.locationName),
  );
}

function compareOracleOverdue(left, right) {
  return (right.percentComplete || 0) - (left.percentComplete || 0) ||
    text(left.finishDate).localeCompare(text(right.finishDate)) ||
    left.taskName.localeCompare(right.taskName) || left.id.localeCompare(right.id);
}

async function captureProjectState(admin, project) {
  const queries = await Promise.all([
    admin.from('schedule_items').select('id,updated_at').eq('project_name', project.name),
    admin.from('project_updates').select('id,created_at').eq('project_name', project.name),
    admin.from('field_notes').select('id,updated_at')
      .or(`project_id.eq.${project.id},project_name.eq.${project.name}`),
    admin.from('reference_documents').select('id,updated_at'),
  ]);
  for (const query of queries) if (query.error) throw query.error;
  const rows = queries.map((query, index) => ({
    channel: ['schedule', 'update', 'memory', 'document'][index],
    rows: (query.data || []).map((row) => ({
      id: text(row.id),
      version: text(row.updated_at) || text(row.created_at),
    })).sort((left, right) => left.id.localeCompare(right.id)),
  }));
  return {
    snapshotSha256: sha256(stableStringify(rows)),
    counts: Object.fromEntries(rows.map((item) => [item.channel, item.rows.length])),
  };
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
    `private_synthesis_capacity_insufficient:${available}/${requiredSlots}:` +
      `full_window_at_${fullWindowAt}`,
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
    throw new Error(`private_synthesis_active_questions:${count}`);
  }
}

async function createOwnerSession({ admin, anonKey, ownerId, supabaseUrl }) {
  const user = await admin.auth.admin.getUserById(ownerId);
  const email = text(user.data?.user?.email);
  if (user.error || !email) throw new Error('private_synthesis_owner_missing');
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = text(link.data?.properties?.hashed_token);
  if (link.error || !tokenHash) throw new Error('private_synthesis_link_failed');
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  const accessToken = text(verified.data?.session?.access_token);
  if (verified.error || !accessToken) {
    throw new Error('private_synthesis_session_failed');
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

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
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

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = text(selector(value));
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function answerContainsValue(corpus, value) {
  const raw = text(value);
  if (!raw) return true;
  if (corpus.includes(canonical(raw))) return true;
  const key = dateKey(raw);
  if (!key) return false;
  if (corpus.includes(canonical(key))) return true;
  const [year, month, day] = key.split('-').map(Number);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' })
    .format(new Date(Date.UTC(year, month - 1, day)));
  return corpus.includes(canonical(`${month}/${day}/${year}`)) ||
    corpus.includes(canonical(`${monthName} ${day} ${year}`));
}

function dateKey(value) {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (slash) {
    return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : '';
}

function losAngelesDate(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDateDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonical(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}

function uuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(text(value));
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function selectedCases() {
  if (CASE_SET === 'baseline') return BASELINE_CASES;
  if (CASE_SET === 'broad-research') return BROAD_RESEARCH_CASES;
  throw new Error('private_synthesis_case_set_not_allowed');
}

function selectedModels() {
  const configured = text(process.env.ECOS_AGENT_COMPARISON_MODELS)
    .split(',')
    .map(text)
    .filter(Boolean);
  if (configured.length === 0) return ALL_MODELS;
  if (new Set(configured).size !== configured.length) {
    throw new Error('agent_comparison_duplicate_model');
  }
  if (configured.some((model) => !ALL_MODELS.includes(model))) {
    throw new Error('agent_comparison_model_not_allowed');
  }
  return Object.freeze(configured);
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function required(name) {
  const value = text(process.env[name]);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
