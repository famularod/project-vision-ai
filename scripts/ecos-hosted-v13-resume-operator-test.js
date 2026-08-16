#!/usr/bin/env node

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {
  EVIDENCE_VERSION,
  cloudRunExecutionProvenance,
  cloudRunJobProvenance,
  createSignalController,
  parseConfiguration,
  runResumeOperator,
  sha256Json,
} = require('./ecos-hosted-v13-resume-operator');
const packageJson = require('../package.json');

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_JOB_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = 'web-document-exact-resume';
const SOURCE_SHA = 'a'.repeat(64);
const IMAGE_DIGEST = `sha256:${'b'.repeat(64)}`;
const IMAGE = `us-west1-docker.pkg.dev/example/workers/ecos@${IMAGE_DIGEST}`;
const STARTED_AT = Date.parse('2026-08-12T04:00:00.000Z');
const SERVICE_ACCOUNT = 'ecos-indexer@example-project.iam.gserviceaccount.com';
const RUNTIME_ENVIRONMENT = Object.freeze({
  ECOS_EVIDENCE_VERSION: EVIDENCE_VERSION,
  ECOS_MAX_JOBS_PER_RUN: '8',
  ECOS_MAX_RUN_SECONDS: '3300',
  ECOS_PUBLICATION_MODE: 'shadow',
});
const SECRET_BINDINGS = Object.freeze({
  SUPABASE_SERVICE_ROLE_KEY: 'ecos-supabase-service-role-key:7',
  SUPABASE_URL: 'ecos-supabase-url:3',
});
const OPERATOR_IDENTITY = Object.freeze({
  repositoryCommit: '1'.repeat(40),
  repositoryTree: '2'.repeat(40),
  workingTreeDirty: true,
  workingTreeStatusSha256: '3'.repeat(64),
  operatorScriptSha256: '4'.repeat(64),
});

const providerAttemptUsage = (nowMs, used = {}) => {
  const now = new Date(nowMs);
  const dayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    dayStart: new Date(dayStartMs).toISOString(),
    resetAt: new Date(dayStartMs + 86_400_000).toISOString(),
    sourceOwner: { used: Number(used.sourceOwner || 0), limit: 800 },
    project: { used: Number(used.project || 0), limit: 1200 },
    organization: { used: Number(used.organization || 0), limit: 1600 },
  };
};

const environment = overrides => ({
  ECOS_V13_RESUME_ALLOW_MUTATION: 'single-shadow-job-resume-only',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ECOS_V13_RESUME_EXPECTED_URL: 'https://example.supabase.co',
  ECOS_V13_RESUME_JOB_ID: JOB_ID,
  ECOS_V13_RESUME_DOCUMENT_ID: DOCUMENT_ID,
  ECOS_V13_RESUME_SOURCE_SHA256: SOURCE_SHA,
  ECOS_V13_RESUME_EXPECTED_PAGE_COUNT: '2',
  ECOS_V13_RESUME_ORGANIZATION_ID: 'organization-a',
  ECOS_V13_RESUME_EXPECTED_JOB_COUNT: '2',
  ECOS_V13_RESUME_EXPECTED_BASELINE_CONCURRENCY: '2',
  ECOS_V13_RESUME_EXPECTED_BASELINE_VISUAL_LIMIT: '100',
  ECOS_V13_RESUME_EXECUTION_VISUAL_LIMIT: '70',
  ECOS_V13_RESUME_MAX_SLICES: '3',
  ECOS_V13_RESUME_MAX_TOTAL_SECONDS: '7200',
  ECOS_V13_RESUME_MAX_WAIT_SECONDS: '600',
  ECOS_V13_RESUME_POLL_SECONDS: '1',
  ECOS_V13_RESUME_TASK_TIMEOUT_SECONDS: '3600',
  ECOS_V13_RESUME_MAX_RUN_SECONDS: '1500',
  ECOS_V13_RESUME_CANCEL_TIMEOUT_SECONDS: '60',
  ECOS_V13_RESUME_REFERENCE_AUTHORITY_MODE: 'fresh',
  ECOS_V13_RESUME_IMAGE: IMAGE,
  ECOS_V13_RESUME_IMAGE_DIGEST: IMAGE_DIGEST,
  ECOS_V13_RESUME_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
  ECOS_V13_RESUME_RUNTIME_ENV_JSON: JSON.stringify(RUNTIME_ENVIRONMENT),
  ECOS_V13_RESUME_SECRET_BINDINGS_JSON: JSON.stringify(SECRET_BINDINGS),
  ECOS_V13_RESUME_REPOSITORY_COMMIT: OPERATOR_IDENTITY.repositoryCommit,
  ECOS_V13_RESUME_REPOSITORY_TREE: OPERATOR_IDENTITY.repositoryTree,
  ECOS_V13_RESUME_WORKTREE_STATUS_SHA256: OPERATOR_IDENTITY.workingTreeStatusSha256,
  ECOS_V13_RESUME_OPERATOR_SHA256: OPERATOR_IDENTITY.operatorScriptSha256,
  ECOS_V13_RESUME_WORKTREE_DIRTY: String(OPERATOR_IDENTITY.workingTreeDirty),
  ECOS_GCP_PROJECT: 'example-project',
  ECOS_GCP_REGION: 'us-west1',
  ECOS_GCP_JOB: 'ecos-hosted-indexer',
  ECOS_GCP_SCHEDULER: 'ecos-hosted-indexer-every-minute',
  ...overrides,
});

const baseJob = () => ({
  id: JOB_ID,
  organization_id: 'organization-a',
  project_id: 'project-a',
  document_id: DOCUMENT_ID,
  source_provider: 'managed_upload',
  source_locator: { gcsBucket: 'bucket', gcsObject: 'object.pdf' },
  source_sha256: SOURCE_SHA,
  source_page_count: 2,
  mode: 'shadow',
  state: 'queued',
  target_evidence_version: EVIDENCE_VERSION,
  failure_diagnostics: { targetEvidenceVersion: EVIDENCE_VERSION },
  completed_page_count: 0,
  assured_page_count: 0,
  unresolved_region_count: 0,
  retry_count: 0,
  max_retry_count: 8,
  next_attempt_at: null,
  claimed_by: null,
  claim_token: null,
  lease_expires_at: null,
  heartbeat_at: null,
  committed_evidence_version: null,
  ready_at: null,
  created_at: '2026-08-12T00:00:00.000Z',
});

const otherJob = () => ({
  ...baseJob(),
  id: OTHER_JOB_ID,
  document_id: 'web-document-other',
  source_sha256: 'c'.repeat(64),
  source_page_count: 1,
  created_at: '2026-08-12T00:00:01.000Z',
});

const freshDocumentData = () => ({
  contentSha256: SOURCE_SHA,
  webFileFingerprint: SOURCE_SHA,
  indexedContentSha256: SOURCE_SHA,
  sourcePageCount: 2,
  isCurrent: true,
  name: 'Exact Resume Drawing',
  unrelatedAuthority: 'must-stay-stable',
});

const exactPage = pageNumber => ({
  pageNumber,
  assurance: { accepted: true, evidenceVersion: EVIDENCE_VERSION },
  visualCoverage: {
    pageNumber,
    sourceSha256: SOURCE_SHA,
    evidenceVersion: EVIDENCE_VERSION,
  },
});

const exactDocumentData = () => {
  const extractedPages = [exactPage(1), exactPage(2)];
  return {
    ...freshDocumentData(),
    extractedPages,
    ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
    ecosVerifiedIndexCommittedAt: '2026-08-12T04:10:00.000Z',
    ecosVerifiedIndexCommittedSha256: SOURCE_SHA,
    ecosVerifiedIndexCommittedPageCount: 2,
    ecosVerifiedIndexPageGraphSha256: sha256Json(extractedPages),
  };
};

const checkpointPage = pageNumber => ({
  page_number: pageNumber,
  source_sha256: SOURCE_SHA,
  state: 'assured',
  assurance_result: { accepted: true, evidenceVersion: EVIDENCE_VERSION },
  unresolved_region_count: 0,
});

const jobProvenance = config => ({
  resourceName: `namespaces/example-project/jobs/${config.cloudRunJob}`,
  generation: '17',
  image: config.expectedImage,
  serviceAccount: config.runtimeServiceAccount,
  taskCount: 1,
  parallelism: 1,
  maxRetries: 1,
  containerCount: 1,
  environment: config.runtimeEnvironment,
  secretBindings: config.secretBindings,
});

const executionReceipt = (config, number, workerId, overrides = {}) => {
  const name = `ecos-hosted-indexer-slice-${number}`;
  return {
    name,
    workerId,
    completed: true,
    succeededCount: 1,
    failedCount: 0,
    provenance: {
      resourceName: name,
      generation: '1',
      image: config.expectedImage,
      serviceAccount: config.runtimeServiceAccount,
      taskCount: 1,
      parallelism: 1,
      maxRetries: 1,
      containerCount: 1,
      environment: {
        ...config.runtimeEnvironment,
        ECOS_MAX_JOBS_PER_RUN: '1',
        ECOS_MAX_RUN_SECONDS: String(config.maxRunSeconds),
        ECOS_TARGET_JOB_ID: config.targetJobId,
        ECOS_TARGET_SOURCE_SHA256: config.targetSourceSha256,
        ECOS_WORKER_ID: workerId,
      },
      secretBindings: config.secretBindings,
    },
    startedJobIds: [config.targetJobId],
    readyJobIds: [],
    jobsProcessed: 1,
    batchFinishedCount: 1,
    logEntryCount: 12,
    logEntryLimit: 5000,
    logTruncated: false,
    errorLogCount: 0,
    stdoutSha256: 'd'.repeat(64),
    stderrSha256: 'e'.repeat(64),
    ...overrides,
  };
};

function createHarness(options = {}) {
  const config = parseConfiguration(environment(options.environment));
  let now = STARTED_AT;
  let configuration = {
    organization_id: config.organizationId,
    publication_mode: 'shadow',
    enabled: false,
    max_concurrent_jobs: 2,
    daily_visual_region_limit: 100,
  };
  let target = { ...baseJob(), ...(options.target || {}) };
  let nonTarget = otherJob();
  let dailyUsage = options.dailyUsage || 0;
  let providerAttemptsUsed = { ...(options.providerAttemptsUsed || {}) };
  let liveChanged = false;
  let executions = 0;
  let updateCalls = 0;
  let cancellationCalls = 0;
  let cancellationOptions = null;
  let schedulerMutationCalls = 0;
  let boundaryInspections = 0;
  let sleepCalls = 0;
  const cleanupEvents = [];
  const receiptWrites = [];
  const processRef = new EventEmitter();
  const signals = createSignalController(processRef);

  const currentDocumentData = () => (
    target.state === 'ready' ? exactDocumentData() : freshDocumentData()
  );
  const currentPages = () => {
    const count = Number(target.completed_page_count || 0);
    return Array.from({ length: count }, (_, index) => checkpointPage(index + 1));
  };
  const currentArtifacts = includePageCounts => ({
    pages: currentPages(),
    queueCount: 0,
    visualExceptions: [],
    shadowChunkCount: Number(target.assured_page_count || 0) * 2,
    shadowPageCounts: includePageCounts
      ? Array.from({ length: 2 }, (_, index) => ({ pageNumber: index + 1, count: 2 }))
      : [],
  });
  const db = {
    async selectConfigurations() { return [{ ...configuration }]; },
    async updateConfiguration(patch, expected) {
      updateCalls += 1;
      const matches = Object.entries(expected).every(([key, value]) => configuration[key] === value);
      if (!matches) return [];
      configuration = { ...configuration, ...patch };
      if (patch.enabled === true && options.onEnable) {
        await options.onEnable({ signals, configuration: { ...configuration } });
      }
      return [{ ...configuration }];
    },
    async selectOrganizationJobs() { return [{ ...target }, { ...nonTarget }]; },
    async selectReferenceDocument() {
      return { id: DOCUMENT_ID, document_data: currentDocumentData() };
    },
    async selectLiveSnapshot(_documentId, referenceDocumentData) {
      const snapshot = {
        pages: liveChanged ? [{ unexpected: true }] : [],
        chunks: [],
        referenceDocumentData,
      };
      return {
        pageCount: snapshot.pages.length,
        chunkCount: 0,
        sha256: sha256Json(snapshot),
        referenceDocumentData,
      };
    },
    async selectDailyVisualUsage() { return dailyUsage; },
    async selectDailyProviderAttemptUsage() {
      return providerAttemptUsage(now, providerAttemptsUsed);
    },
    async selectTargetArtifacts(_jobId, _pageCount, artifactOptions = {}) {
      return currentArtifacts(Boolean(artifactOptions.includePageCounts));
    },
  };
  const cloud = {
    async inspectBoundary() {
      boundaryInspections += 1;
      const boundary = {
        schedulerState: 'PAUSED',
        artifactDigest: IMAGE_DIGEST,
        jobProvenance: jobProvenance(config),
        executionNames: Array.from({ length: executions }, (_, index) => `existing-${index}`),
        activeExecutionNames: [],
      };
      return options.boundaryDrift
        ? options.boundaryDrift(boundary, boundaryInspections)
        : boundary;
    },
    async verifyManagedSource() {
      now += Number(options.preflightElapsedMs || 0);
    },
    async executeExactTarget(executeOptions) {
      executions += 1;
      if (options.onExecute) {
        await options.onExecute({
          executions,
          get target() { return target; },
          setTarget(value) { target = { ...value }; },
          setNonTarget(value) { nonTarget = { ...value }; },
          setDailyUsage(value) { dailyUsage = value; },
          setProviderAttemptsUsed(value) { providerAttemptsUsed = { ...value }; },
          setLiveChanged(value) { liveChanged = value; },
          signals,
          now,
        });
      } else {
        target = {
          ...target,
          state: 'ready',
          completed_page_count: 2,
          assured_page_count: 2,
          unresolved_region_count: 0,
          next_attempt_at: null,
          committed_evidence_version: EVIDENCE_VERSION,
          claimed_by: null,
          claim_token: null,
          lease_expires_at: null,
          ready_at: new Date(now).toISOString(),
        };
      }
      if (signals.requestedSignal) throw new Error(`Interrupted by ${signals.requestedSignal}`);
      const receipt = executionReceipt(
        config,
        executions,
        executeOptions.workerId,
        options.executionReceiptOverride || {},
      );
      if (options.mutateExecutionReceipt) options.mutateExecutionReceipt(receipt, config);
      if (target.state === 'ready') receipt.readyJobIds = [JOB_ID];
      return receipt;
    },
    async cancelNewActiveExecutions(cancelOptions) {
      cancellationCalls += 1;
      cancellationOptions = { ...cancelOptions };
      cleanupEvents.push('cancel');
      if (options.cancellationReceipts) return options.cancellationReceipts;
      if (!signals.requestedSignal || executions === 0) return [];
      return [{
        name: 'ecos-hosted-indexer-interrupted',
        terminal: true,
        completionTime: new Date(now).toISOString(),
        conditions: [{ type: 'Cancelled', status: 'True' }],
      }];
    },
    async ensureSchedulerPaused() {
      schedulerMutationCalls += 1;
      cleanupEvents.push('scheduler');
      now += Number(options.cleanupAdvanceMs || 0);
      return { state: 'PAUSED', repaired: false };
    },
  };
  const receipts = {
    receiptPath: '/tmp/ecos-hosted-v13-resume-test.json',
    write(audit, seal) {
      const output = JSON.parse(JSON.stringify(audit));
      delete output.seal;
      if (seal) output.seal = { algorithm: 'sha256-stable-json', receiptSha256: sha256Json(output) };
      receiptWrites.push(output);
      return output;
    },
  };
  const clock = {
    now: () => now,
    async sleep(milliseconds) {
      sleepCalls += 1;
      now += milliseconds;
    },
  };
  return {
    config,
    dependencies: {
      db,
      cloud,
      receipts,
      clock,
      signals,
      operatorIdentity: OPERATOR_IDENTITY,
    },
    state: {
      get target() { return target; },
      get configuration() { return configuration; },
      get executions() { return executions; },
      get updateCalls() { return updateCalls; },
      get cancellationCalls() { return cancellationCalls; },
      get cancellationOptions() { return cancellationOptions; },
      get schedulerMutationCalls() { return schedulerMutationCalls; },
      get cleanupEvents() { return [...cleanupEvents]; },
      get sleepCalls() { return sleepCalls; },
      get receipts() { return receiptWrites; },
    },
  };
}

async function expectFailure(harness, pattern) {
  let caught;
  try {
    await runResumeOperator(harness.config, harness.dependencies);
  } catch (error) {
    caught = error;
  }
  assert(caught, 'Expected resume operator failure');
  assert.match(caught.message, pattern);
  assert.equal(harness.state.configuration.enabled, false, 'Failure cleanup must disable configuration');
  const sealed = harness.state.receipts.at(-1);
  assert.equal(sealed.status, 'failed');
  assert.equal(sealed.seal.receiptSha256, sha256Json(Object.fromEntries(
    Object.entries(sealed).filter(([key]) => key !== 'seal'),
  )));
}

async function main() {
  const providerUsageMigration = fs.readFileSync(path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260814165008_ecos_provider_attempt_usage_receipt.sql',
  ), 'utf8');
  assert.match(providerUsageMigration, /security definer/);
  assert.match(providerUsageMigration, /auth\.role\(\) <> 'service_role'/);
  assert.match(providerUsageMigration, /grant execute on function public\.ecos_get_drawing_provider_attempt_usage\(uuid\)\s+to service_role/);
  assert.doesNotMatch(providerUsageMigration, /grant select on public\.ecos_drawing_provider_attempts/);
  assert.match(providerUsageMigration, /'limit', 800/);
  assert.match(providerUsageMigration, /'limit', 1200/);
  assert.match(providerUsageMigration, /'limit', 1600/);
  assert.equal(
    packageJson.scripts['run:ecos-hosted-v13-resume'],
    'node scripts/ecos-hosted-v13-resume-operator.js',
  );
  assert.equal(
    packageJson.scripts['test:ecos-hosted-v13-resume'],
    'node scripts/ecos-hosted-v13-resume-operator-test.js',
  );
  assert.match(
    packageJson.scripts['test:ecos-hosted-indexer'],
    /ecos-hosted-v13-resume-operator-test\.js/,
  );
  assert.throws(
    () => parseConfiguration(environment({ ECOS_V13_RESUME_IMAGE: `${IMAGE}:mutable` })),
    /must be pinned/,
  );
  assert.throws(
    () => parseConfiguration(environment({ ECOS_V13_RESUME_MAX_RUN_SECONDS: '3590' })),
    /leave at least 30 seconds/,
  );
  assert.throws(
    () => parseConfiguration(environment({ ECOS_V13_RESUME_MAX_TOTAL_SECONDS: '4259' })),
    /cover the task timeout and total cleanup budget/,
  );
  assert.throws(
    () => parseConfiguration(environment({
      ECOS_V13_RESUME_CANCEL_TIMEOUT_SECONDS: '600',
      ECOS_V13_RESUME_MAX_TOTAL_SECONDS: '4799',
    })),
    /cover the task timeout and total cleanup budget/,
  );
  assert.throws(
    () => parseConfiguration(environment({
      ECOS_V13_RESUME_SECRET_BINDINGS_JSON: JSON.stringify({
        ...SECRET_BINDINGS,
        SUPABASE_URL: 'ecos-supabase-url:latest',
      }),
    })),
    /immutable numeric secret version/,
  );
  assert.throws(
    () => parseConfiguration(environment({
      ECOS_V13_RESUME_RUNTIME_ENV_JSON: JSON.stringify({
        ...RUNTIME_ENVIRONMENT,
        ECOS_MAX_JOBS_PER_RUN: '1',
      }),
    })),
    /must preserve ECOS_MAX_JOBS_PER_RUN=8/,
  );
  assert.throws(
    () => parseConfiguration(environment({
      ECOS_V13_RESUME_RUNTIME_ENV_JSON: JSON.stringify({
        ...RUNTIME_ENVIRONMENT,
        ECOS_MAX_RUN_SECONDS: '1500',
      }),
    })),
    /must preserve ECOS_MAX_RUN_SECONDS=3300/,
  );
  assert.throws(
    () => parseConfiguration(environment({
      ECOS_V13_RESUME_RUNTIME_ENV_JSON: JSON.stringify({
        ...RUNTIME_ENVIRONMENT,
        ECOS_TARGET_JOB_ID: JOB_ID,
      }),
    })),
    /must not preset ECOS_TARGET_JOB_ID/,
  );

  const taskTemplate = {
    serviceAccountName: SERVICE_ACCOUNT,
    maxRetries: 1,
    containers: [{
      image: IMAGE,
      env: [
        ...Object.entries(RUNTIME_ENVIRONMENT).map(([name, value]) => ({ name, value })),
        ...Object.entries(SECRET_BINDINGS).map(([name, value]) => {
          const [secret, key] = value.split(':');
          return { name, valueFrom: { secretKeyRef: { name: secret, key } } };
        }),
      ],
    }],
  };
  assert.deepEqual(cloudRunJobProvenance({
    metadata: { name: 'namespaces/example-project/jobs/ecos-hosted-indexer', generation: 17 },
    spec: { template: { spec: { taskCount: 1, parallelism: 1, template: { spec: taskTemplate } } } },
  }), jobProvenance(parseConfiguration(environment())));
  const executionProvenance = cloudRunExecutionProvenance({
    metadata: { name: 'ecos-hosted-indexer-execution-1', generation: 1 },
    spec: { taskCount: 1, parallelism: 1, template: { spec: taskTemplate } },
  });
  assert.equal(executionProvenance.resourceName, 'ecos-hosted-indexer-execution-1');
  assert.equal(executionProvenance.containerCount, 1);
  assert.deepEqual(executionProvenance.secretBindings, SECRET_BINDINGS);
  const childSignals = createSignalController(new EventEmitter());
  const killedSignals = [];
  childSignals.addChild({ killed: false, kill: signal => killedSignals.push(signal) });
  childSignals.request('SIGTERM');
  assert.deepEqual(killedSignals, ['SIGTERM'], 'Signal controller must stop active Cloud commands');

  const boundaryFailureHarness = createHarness({
    boundaryDrift(boundary) {
      return { ...boundary, artifactDigest: `sha256:${'f'.repeat(64)}` };
    },
  });
  await expectFailure(boundaryFailureHarness, /artifact digest mismatch/);
  assert.equal(boundaryFailureHarness.state.updateCalls, 0,
    'A failure before mutation must make zero database writes');
  assert.equal(boundaryFailureHarness.state.cancellationCalls, 0,
    'A failure before mutation must not cancel executions');
  assert.equal(boundaryFailureHarness.state.schedulerMutationCalls, 0,
    'A failure before mutation must not repair Scheduler');

  const totalBoundHarness = createHarness({
    environment: { ECOS_V13_RESUME_MAX_TOTAL_SECONDS: '4260' },
    preflightElapsedMs: 1000,
  });
  await expectFailure(totalBoundHarness, /Remaining total time cannot cover/);
  assert.equal(totalBoundHarness.state.updateCalls, 0,
    'A total-bound refusal must occur before the enable write');
  assert.equal(totalBoundHarness.state.executions, 0,
    'A total-bound refusal must not spawn Cloud Run');

  const providerAttemptCapHarness = createHarness({
    providerAttemptsUsed: { sourceOwner: 800, project: 800, organization: 800 },
  });
  await expectFailure(providerAttemptCapHarness, /deferred beyond the bounded wait window/);
  assert.equal(providerAttemptCapHarness.state.updateCalls, 0,
    'An exhausted provider-attempt cap must be detected before enabling the configuration');
  assert.equal(providerAttemptCapHarness.state.executions, 0,
    'An exhausted provider-attempt cap must not spawn Cloud Run');

  const maximumCancellationHarness = createHarness({
    environment: {
      ECOS_V13_RESUME_CANCEL_TIMEOUT_SECONDS: '600',
      ECOS_V13_RESUME_MAX_TOTAL_SECONDS: '4800',
    },
  });
  const maximumCancellationResult = await runResumeOperator(
    maximumCancellationHarness.config,
    maximumCancellationHarness.dependencies,
  );
  assert.equal(maximumCancellationResult.status, 'pass');
  assert.equal(maximumCancellationResult.controls.cleanupBudgetSeconds, 1200);
  assert.equal(maximumCancellationResult.cleanup.budget.budgetSeconds, 1200);
  assert.equal(maximumCancellationResult.cleanup.budget.exhausted, false);
  assert.equal(maximumCancellationResult.executionPhaseDeadline.exhausted, false);
  assert(maximumCancellationHarness.state.updateCalls > 0);

  const retryHarness = createHarness({
    async onExecute(context) {
      if (context.executions === 1) {
        context.setTarget({
          ...context.target,
          state: 'temporarily_unavailable',
          completed_page_count: 1,
          assured_page_count: 1,
          retry_count: 1,
          next_attempt_at: new Date(context.now + 2000).toISOString(),
          failure_diagnostics: { category: 'visual_provider_retry' },
        });
        context.setDailyUsage(1);
      } else {
        context.setTarget({
          ...context.target,
          state: 'ready',
          completed_page_count: 2,
          assured_page_count: 2,
          unresolved_region_count: 0,
          next_attempt_at: null,
          committed_evidence_version: EVIDENCE_VERSION,
          claimed_by: null,
          claim_token: null,
          lease_expires_at: null,
          ready_at: new Date(context.now).toISOString(),
        });
      }
    },
  });
  const retryResult = await runResumeOperator(retryHarness.config, retryHarness.dependencies);
  assert.equal(retryResult.status, 'pass');
  assert.equal(retryResult.slices.length, 2);
  assert.equal(retryHarness.state.executions, 2);
  assert(retryHarness.state.sleepCalls > 0, 'Retry operator did not wait for next_attempt_at');
  assert.equal(retryHarness.state.configuration.enabled, false);
  assert.equal(retryHarness.state.configuration.max_concurrent_jobs, 2);
  assert.equal(retryResult.seal.receiptSha256, sha256Json(Object.fromEntries(
    Object.entries(retryResult).filter(([key]) => key !== 'seal'),
  )));

  const checkpointHarness = createHarness({
    target: {
      state: 'temporarily_unavailable',
      completed_page_count: 1,
      assured_page_count: 1,
      retry_count: 2,
      failure_diagnostics: { category: 'checkpointed_retry' },
    },
  });
  const checkpointResult = await runResumeOperator(
    checkpointHarness.config,
    checkpointHarness.dependencies,
  );
  assert.equal(checkpointResult.status, 'pass');
  assert.equal(checkpointHarness.state.executions, 1);

  const expiredLeaseHarness = createHarness({
    target: {
      state: 'extracting',
      completed_page_count: 1,
      assured_page_count: 1,
      retry_count: 2,
      claimed_by: 'interrupted-worker',
      claim_token: '33333333-3333-4333-8333-333333333333',
      lease_expires_at: new Date(STARTED_AT - 1000).toISOString(),
      heartbeat_at: new Date(STARTED_AT - 600_000).toISOString(),
      failure_diagnostics: {},
    },
  });
  const expiredLeaseResult = await runResumeOperator(
    expiredLeaseHarness.config,
    expiredLeaseHarness.dependencies,
  );
  assert.equal(expiredLeaseResult.status, 'pass');
  assert.equal(expiredLeaseHarness.state.executions, 1);

  await expectFailure(createHarness({
    target: { state: 'needs_review' },
  }), /hard-failure state needs_review/);

  await expectFailure(createHarness({
    target: { state: 'temporarily_unavailable', retry_count: 8, max_retry_count: 8 },
  }), /max retry count/);

  await expectFailure(createHarness({
    async onExecute(context) {
      context.setNonTarget({ ...otherJob(), state: 'temporarily_unavailable' });
      context.setTarget({
        ...context.target,
        state: 'temporarily_unavailable',
        retry_count: 1,
      });
    },
  }), /non-target job changed/);

  await expectFailure(createHarness({
    async onExecute(context) {
      context.setLiveChanged(true);
      context.setTarget({
        ...context.target,
        state: 'temporarily_unavailable',
        retry_count: 1,
      });
    },
  }), /customer-facing live evidence/);

  await expectFailure(createHarness({
    async onExecute(context) {
      context.setDailyUsage(71);
      context.setTarget({
        ...context.target,
        state: 'temporarily_unavailable',
        retry_count: 1,
      });
    },
  }), /daily visual cap/);

  await expectFailure(createHarness({
    mutateExecutionReceipt(receipt) {
      receipt.provenance.serviceAccount = 'drift@example-project.iam.gserviceaccount.com';
    },
  }), /runtime service account drifted/);

  await expectFailure(createHarness({
    mutateExecutionReceipt(receipt) {
      receipt.provenance.environment.ECOS_MAX_JOBS_PER_RUN = '8';
      receipt.provenance.environment.ECOS_MAX_RUN_SECONDS = '3300';
    },
  }), /runtime environment drifted/);

  const postExecutionProviderDriftHarness = createHarness({
    async onExecute(context) {
      context.setTarget({
        ...context.target,
        source_provider: 'google_drive',
        source_locator: { driveFileId: 'post-execution-provider-drift' },
        state: 'ready',
        completed_page_count: 2,
        assured_page_count: 2,
        unresolved_region_count: 0,
        next_attempt_at: null,
        committed_evidence_version: EVIDENCE_VERSION,
        claimed_by: null,
        claim_token: null,
        lease_expires_at: null,
        ready_at: new Date(context.now).toISOString(),
      });
    },
  });
  await expectFailure(
    postExecutionProviderDriftHarness,
    /^Resume target must use its managed source copy$/,
  );
  const postExecutionProviderDriftReceipt =
    postExecutionProviderDriftHarness.state.receipts.at(-1);
  assert.equal(
    postExecutionProviderDriftReceipt.failure.message,
    'Resume target must use its managed source copy',
  );
  assert.deepEqual(postExecutionProviderDriftHarness.state.configuration, {
    organization_id: postExecutionProviderDriftHarness.config.organizationId,
    publication_mode: 'shadow',
    enabled: false,
    max_concurrent_jobs: 2,
    daily_visual_region_limit: 100,
  });
  assert.deepEqual(postExecutionProviderDriftReceipt.cleanup.configuration.errors, []);
  assert.equal(postExecutionProviderDriftReceipt.cleanup.scheduler.state, 'PAUSED');
  assert.equal(postExecutionProviderDriftReceipt.cleanup.budget.exhausted, false);

  await expectFailure(createHarness({
    boundaryDrift(boundary, inspection) {
      if (inspection !== 3) return boundary;
      return {
        ...boundary,
        jobProvenance: { ...boundary.jobProvenance, generation: '18' },
      };
    },
  }), /provenance changed during a slice/);

  await expectFailure(createHarness({
    boundaryDrift(boundary, inspection) {
      return inspection === 3
        ? { ...boundary, artifactDigest: `sha256:${'f'.repeat(64)}` }
        : boundary;
    },
  }), /artifact digest mismatch/);

  await expectFailure(createHarness({
    mutateExecutionReceipt(receipt) { receipt.batchFinishedCount = 2; },
  }), /exactly one batch-finished receipt/);

  await expectFailure(createHarness({
    mutateExecutionReceipt(receipt) { receipt.logTruncated = true; },
  }), /may be truncated/);

  const enableSignalHarness = createHarness({
    async onEnable({ signals }) { signals.request('SIGTERM'); },
  });
  let enableInterrupted;
  try {
    await runResumeOperator(enableSignalHarness.config, enableSignalHarness.dependencies);
  } catch (error) {
    enableInterrupted = error;
  }
  assert(enableInterrupted);
  assert.match(enableInterrupted.message, /Interrupted by SIGTERM/);
  assert.equal(enableSignalHarness.state.executions, 0,
    'A signal during enable must be rechecked before Cloud Run spawn');
  assert(enableSignalHarness.state.updateCalls > 0,
    'A signal during enable must run mutation-started cleanup');
  assert.equal(enableSignalHarness.state.configuration.enabled, false);
  assert.equal(enableSignalHarness.state.cancellationCalls, 1);
  assert.equal(enableSignalHarness.state.receipts.at(-1).status, 'interrupted');

  const signalHarness = createHarness({
    async onExecute(context) {
      context.signals.request('SIGINT');
    },
  });
  let interrupted;
  try {
    await runResumeOperator(signalHarness.config, signalHarness.dependencies);
  } catch (error) {
    interrupted = error;
  }
  assert(interrupted);
  assert.match(interrupted.message, /Interrupted by SIGINT/);
  assert.equal(signalHarness.state.cancellationCalls, 1);
  assert.equal(signalHarness.state.configuration.enabled, false);
  assert.equal(signalHarness.state.receipts.at(-1).status, 'interrupted');
  assert.equal(signalHarness.state.receipts.at(-1).cleanup.cancelledExecutions[0].terminal, true);
  assert.deepEqual(signalHarness.state.cancellationOptions.priorExecutionNames, [],
    'Cancellation must use the last pre-mutation execution inventory');
  assert.deepEqual(signalHarness.state.cleanupEvents, ['scheduler', 'cancel'],
    'Cleanup must contain Scheduler before cancelling executions');

  const cleanupTimeoutHarness = createHarness({ cleanupAdvanceMs: 541_000 });
  await expectFailure(cleanupTimeoutHarness, /cleanup containment deadline exhausted/);
  const cleanupTimeoutReceipt = cleanupTimeoutHarness.state.receipts.at(-1);
  assert.equal(cleanupTimeoutReceipt.cleanup.budget.exhausted, true);
  assert.equal(cleanupTimeoutReceipt.cleanup.containmentDeadline.exhausted, true);
  assert.match(cleanupTimeoutReceipt.cleanup.schedulerError, /deadline exhausted/);

  const nonTerminalCancellationHarness = createHarness({
    async onExecute(context) { context.signals.request('SIGINT'); },
    cancellationReceipts: [{
      name: 'ecos-hosted-indexer-interrupted',
      terminal: false,
      completionTime: null,
    }],
  });
  let cancellationFailure;
  try {
    await runResumeOperator(
      nonTerminalCancellationHarness.config,
      nonTerminalCancellationHarness.dependencies,
    );
  } catch (error) {
    cancellationFailure = error;
  }
  assert(cancellationFailure);
  const cancellationReceipt = nonTerminalCancellationHarness.state.receipts.at(-1);
  assert.equal(cancellationReceipt.status, 'failed');
  assert.match(cancellationReceipt.cleanup.cancellationError, /terminal execution receipt/);

  const preflightHarness = createHarness({
    environment: { ECOS_V13_RESUME_PREFLIGHT_ONLY: 'true' },
  });
  const preflight = await runResumeOperator(preflightHarness.config, preflightHarness.dependencies);
  assert.equal(preflight.status, 'preflight_pass');
  assert.match(preflight.seal.receiptSha256, /^[a-f0-9]{64}$/);
  assert.equal(preflightHarness.state.executions, 0);
  assert.equal(preflightHarness.state.configuration.enabled, false);
  assert.equal(preflightHarness.state.updateCalls, 0,
    'Preflight must make zero database writes');
  assert.equal(preflightHarness.state.cancellationCalls, 0,
    'Preflight must make zero cancellation calls');
  assert.equal(preflightHarness.state.schedulerMutationCalls, 0,
    'Preflight must make zero Scheduler mutations');
  assert.equal(preflight.cleanup.readOnly, true);
  assert.deepEqual(preflight.preflight.dailyProviderAttemptUsage, providerAttemptUsage(STARTED_AT));

  console.log('ECOS hosted evidence 1.3 exact-target resume operator contracts PASS.');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
