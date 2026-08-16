#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');

const EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const RECEIPT_VERSION = 'ecos-hosted-v13-resume-receipt/1.0';
const REQUIRED_ALLOWANCE = 'single-shadow-job-resume-only';
const CLEANUP_SLICE_CONFIGURATION_SECONDS = 120;
const CLEANUP_CONTAINMENT_SECONDS = 180;
const CLEANUP_POST_RUN_VERIFICATION_SECONDS = 120;
const CLEANUP_COMPLETION_VERIFICATION_SECONDS = 120;
const CLEANUP_FINAL_VERIFICATION_SECONDS = 60;
const GCLOUD_READ_TIMEOUT_MS = 120_000;
const GCLOUD_COPY_TIMEOUT_MS = 10 * 60_000;
const LOG_ENTRY_LIMIT = 5_000;
const EXPECTED_PROVIDER_ATTEMPT_LIMITS = Object.freeze({
  sourceOwner: 800,
  project: 1200,
  organization: 1600,
});
const ACTIVE_JOB_STATES = new Set([
  'fetching_source',
  'extracting',
  'mapping',
  'awaiting_visual',
  'assuring',
]);
const RETRYABLE_JOB_STATES = new Set(['queued', 'temporarily_unavailable', ...ACTIVE_JOB_STATES]);
const REFERENCE_RECEIPT_KEYS = [
  'ecosVerifiedIndexCommitVersion',
  'ecosVerifiedIndexCommittedAt',
  'ecosVerifiedIndexCommittedSha256',
  'ecosVerifiedIndexCommittedPageCount',
  'ecosVerifiedIndexPageGraphSha256',
];
const REFERENCE_AUTHORITY_MUTATION_KEYS = [
  ...REFERENCE_RECEIPT_KEYS,
  'extractedPages',
  'extractedText',
  'extractionStatus',
  'searchablePageCount',
  'indexedContentSha256',
  'sourcePageCount',
  'documentIntelligenceVersion',
  'documentVisualIndexVersion',
];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const required = (env, name) => {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const requiredInteger = (env, name, minimum, maximum) => {
  const raw = required(env, name);
  const value = Number(raw);
  assert(Number.isInteger(value) && value >= minimum && value <= maximum,
    `${name} must be an integer from ${minimum} through ${maximum}`);
  return value;
};

const enabled = value => ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());

const stableJson = value => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sha256Json = value => sha256(stableJson(value));
const boundedText = value => String(value || '').slice(-20_000);

const exactSha256 = (value, label) => {
  const normalized = String(value || '').trim().toLowerCase();
  assert(/^[a-f0-9]{64}$/.test(normalized), `${label} must be a SHA-256 checksum`);
  return normalized;
};

const exactGitObjectId = (value, label) => {
  const normalized = String(value || '').trim().toLowerCase();
  assert(/^[a-f0-9]{40}$/.test(normalized), `${label} must be a Git object id`);
  return normalized;
};

function requiredJsonObject(env, name) {
  const raw = required(env, name);
  let value;
  try { value = JSON.parse(raw); } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }
  assert(value && typeof value === 'object' && !Array.isArray(value),
    `${name} must be a JSON object`);
  return Object.freeze(Object.fromEntries(Object.entries(value).sort(([left], [right]) => (
    left.localeCompare(right)
  ))));
}

function parseRuntimeEnvironment(env) {
  const value = requiredJsonObject(env, 'ECOS_V13_RESUME_RUNTIME_ENV_JSON');
  assert(Object.keys(value).length > 0, 'ECOS_V13_RESUME_RUNTIME_ENV_JSON must not be empty');
  for (const [key, item] of Object.entries(value)) {
    assert(/^[A-Z][A-Z0-9_]*$/.test(key), `Runtime environment key ${key} is invalid`);
    assert(typeof item === 'string' && item.length <= 2_000,
      `Runtime environment value ${key} must be a bounded string`);
  }
  for (const forbidden of [
    'ECOS_TARGET_JOB_ID',
    'ECOS_TARGET_SOURCE_SHA256',
    'ECOS_WORKER_ID',
  ]) assert(!(forbidden in value), `Baseline runtime environment must not preset ${forbidden}`);
  assert(value.ECOS_MAX_JOBS_PER_RUN === '8',
    'Baseline runtime environment must preserve ECOS_MAX_JOBS_PER_RUN=8');
  assert(value.ECOS_MAX_RUN_SECONDS === '3300',
    'Baseline runtime environment must preserve ECOS_MAX_RUN_SECONDS=3300');
  return value;
}

function parseSecretBindings(env) {
  const value = requiredJsonObject(env, 'ECOS_V13_RESUME_SECRET_BINDINGS_JSON');
  for (const requiredKey of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    assert(typeof value[requiredKey] === 'string', `Secret binding ${requiredKey} is required`);
  }
  const hasVisualUrl = 'ECOS_VISUAL_PROVIDER_URL' in value;
  const hasVisualToken = 'ECOS_VISUAL_PROVIDER_TOKEN' in value;
  assert(hasVisualUrl === hasVisualToken,
    'Visual provider URL and token secret bindings must be present together');
  for (const [key, item] of Object.entries(value)) {
    assert(/^[A-Z][A-Z0-9_]*$/.test(key), `Secret environment key ${key} is invalid`);
    assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,254}:[1-9][0-9]*$/.test(String(item)),
      `Secret binding ${key} must name one immutable numeric secret version`);
  }
  return value;
}

function expectedExecutionEnvironment(config, options) {
  return Object.freeze({
    ...config.runtimeEnvironment,
    ECOS_MAX_JOBS_PER_RUN: '1',
    ECOS_MAX_RUN_SECONDS: String(options.maxRunSeconds),
    ECOS_TARGET_JOB_ID: options.targetJobId,
    ECOS_TARGET_SOURCE_SHA256: options.targetSourceSha256,
    ECOS_WORKER_ID: options.workerId,
  });
}

const withoutReferenceAuthority = documentData => Object.fromEntries(
  Object.entries(documentData || {}).filter(
    ([key]) => !REFERENCE_AUTHORITY_MUTATION_KEYS.includes(key),
  ),
);

function parseConfiguration(env = process.env) {
  assert(
    required(env, 'ECOS_V13_RESUME_ALLOW_MUTATION') === REQUIRED_ALLOWANCE,
    `ECOS_V13_RESUME_ALLOW_MUTATION must equal ${REQUIRED_ALLOWANCE}`,
  );
  const supabaseUrl = required(env, 'SUPABASE_URL').replace(/\/$/, '');
  const expectedUrl = required(env, 'ECOS_V13_RESUME_EXPECTED_URL').replace(/\/$/, '');
  assert(supabaseUrl === expectedUrl, 'Supabase URL does not match the explicitly approved resume URL');

  const targetJobId = required(env, 'ECOS_V13_RESUME_JOB_ID').toLowerCase();
  const targetSourceSha256 = required(env, 'ECOS_V13_RESUME_SOURCE_SHA256').toLowerCase();
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(targetJobId),
    'ECOS_V13_RESUME_JOB_ID must be a canonical UUID',
  );
  assert(/^[a-f0-9]{64}$/.test(targetSourceSha256),
    'ECOS_V13_RESUME_SOURCE_SHA256 must be a SHA-256 checksum');

  const expectedImage = required(env, 'ECOS_V13_RESUME_IMAGE');
  const expectedImageDigest = required(env, 'ECOS_V13_RESUME_IMAGE_DIGEST');
  assert(expectedImage.endsWith(`@${expectedImageDigest}`),
    'ECOS_V13_RESUME_IMAGE must be pinned to ECOS_V13_RESUME_IMAGE_DIGEST');
  assert(/^sha256:[a-f0-9]{64}$/.test(expectedImageDigest),
    'ECOS_V13_RESUME_IMAGE_DIGEST must be a SHA-256 digest');

  const taskTimeoutSeconds = requiredInteger(
    env,
    'ECOS_V13_RESUME_TASK_TIMEOUT_SECONDS',
    300,
    86_400,
  );
  const maxRunSeconds = requiredInteger(env, 'ECOS_V13_RESUME_MAX_RUN_SECONDS', 60, 86_340);
  assert(maxRunSeconds <= taskTimeoutSeconds - 30,
    'ECOS_V13_RESUME_MAX_RUN_SECONDS must leave at least 30 seconds for task cleanup');
  const maxTotalSeconds = requiredInteger(
    env,
    'ECOS_V13_RESUME_MAX_TOTAL_SECONDS',
    60,
    604_800,
  );
  const referenceAuthorityMode = required(env, 'ECOS_V13_RESUME_REFERENCE_AUTHORITY_MODE');
  assert(['fresh', 'exact'].includes(referenceAuthorityMode),
    'ECOS_V13_RESUME_REFERENCE_AUTHORITY_MODE must be fresh or exact');
  const runtimeServiceAccount = required(env, 'ECOS_V13_RESUME_SERVICE_ACCOUNT').toLowerCase();
  assert(/^[a-z0-9][a-z0-9-]{0,62}@[a-z0-9][a-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(
    runtimeServiceAccount,
  ), 'ECOS_V13_RESUME_SERVICE_ACCOUNT must be an exact Google service account');
  const runtimeEnvironment = parseRuntimeEnvironment(env);
  const secretBindings = parseSecretBindings(env);
  for (const key of Object.keys(runtimeEnvironment)) {
    assert(!(key in secretBindings),
      `Runtime environment key ${key} cannot also be a secret binding`);
  }

  const expectedOperatorIdentity = Object.freeze({
    repositoryCommit: exactGitObjectId(
      required(env, 'ECOS_V13_RESUME_REPOSITORY_COMMIT'),
      'ECOS_V13_RESUME_REPOSITORY_COMMIT',
    ),
    repositoryTree: exactGitObjectId(
      required(env, 'ECOS_V13_RESUME_REPOSITORY_TREE'),
      'ECOS_V13_RESUME_REPOSITORY_TREE',
    ),
    workingTreeStatusSha256: exactSha256(
      required(env, 'ECOS_V13_RESUME_WORKTREE_STATUS_SHA256'),
      'ECOS_V13_RESUME_WORKTREE_STATUS_SHA256',
    ),
    operatorScriptSha256: exactSha256(
      required(env, 'ECOS_V13_RESUME_OPERATOR_SHA256'),
      'ECOS_V13_RESUME_OPERATOR_SHA256',
    ),
    workingTreeDirty: (() => {
      const raw = required(env, 'ECOS_V13_RESUME_WORKTREE_DIRTY').toLowerCase();
      assert(['true', 'false'].includes(raw),
        'ECOS_V13_RESUME_WORKTREE_DIRTY must be true or false');
      return raw === 'true';
    })(),
  });
  const cancelTimeoutSeconds = requiredInteger(
    env,
    'ECOS_V13_RESUME_CANCEL_TIMEOUT_SECONDS',
    30,
    600,
  );
  const cleanupBudgetSeconds = cancelTimeoutSeconds
    + CLEANUP_SLICE_CONFIGURATION_SECONDS
    + CLEANUP_CONTAINMENT_SECONDS
    + CLEANUP_POST_RUN_VERIFICATION_SECONDS
    + CLEANUP_COMPLETION_VERIFICATION_SECONDS
    + CLEANUP_FINAL_VERIFICATION_SECONDS;
  assert(taskTimeoutSeconds + cleanupBudgetSeconds <= maxTotalSeconds,
    'ECOS_V13_RESUME_MAX_TOTAL_SECONDS must cover the task timeout and total cleanup budget');

  return Object.freeze({
    supabaseUrl,
    serviceRoleKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    expectedUrl,
    targetJobId,
    targetDocumentId: required(env, 'ECOS_V13_RESUME_DOCUMENT_ID'),
    targetSourceSha256,
    expectedPageCount: requiredInteger(env, 'ECOS_V13_RESUME_EXPECTED_PAGE_COUNT', 1, 1000),
    organizationId: required(env, 'ECOS_V13_RESUME_ORGANIZATION_ID'),
    expectedJobCount: requiredInteger(env, 'ECOS_V13_RESUME_EXPECTED_JOB_COUNT', 1, 10_000),
    expectedBaselineConcurrency: requiredInteger(
      env,
      'ECOS_V13_RESUME_EXPECTED_BASELINE_CONCURRENCY',
      1,
      8,
    ),
    expectedBaselineVisualLimit: requiredInteger(
      env,
      'ECOS_V13_RESUME_EXPECTED_BASELINE_VISUAL_LIMIT',
      0,
      100_000,
    ),
    executionVisualLimit: requiredInteger(
      env,
      'ECOS_V13_RESUME_EXECUTION_VISUAL_LIMIT',
      1,
      100_000,
    ),
    maxSlices: requiredInteger(env, 'ECOS_V13_RESUME_MAX_SLICES', 1, 100),
    maxTotalSeconds,
    maxWaitSeconds: requiredInteger(env, 'ECOS_V13_RESUME_MAX_WAIT_SECONDS', 0, 86_400),
    pollSeconds: requiredInteger(env, 'ECOS_V13_RESUME_POLL_SECONDS', 1, 60),
    taskTimeoutSeconds,
    maxRunSeconds,
    cancelTimeoutSeconds,
    cleanupSliceConfigurationSeconds: CLEANUP_SLICE_CONFIGURATION_SECONDS,
    cleanupContainmentSeconds: CLEANUP_CONTAINMENT_SECONDS,
    cleanupPostRunVerificationSeconds: CLEANUP_POST_RUN_VERIFICATION_SECONDS,
    cleanupCompletionVerificationSeconds: CLEANUP_COMPLETION_VERIFICATION_SECONDS,
    cleanupFinalVerificationSeconds: CLEANUP_FINAL_VERIFICATION_SECONDS,
    cleanupBudgetSeconds,
    referenceAuthorityMode,
    preflightOnly: enabled(env.ECOS_V13_RESUME_PREFLIGHT_ONLY),
    expectedImage,
    expectedImageDigest,
    runtimeServiceAccount,
    runtimeEnvironment,
    secretBindings,
    expectedOperatorIdentity,
    gcpProject: required(env, 'ECOS_GCP_PROJECT'),
    gcpRegion: required(env, 'ECOS_GCP_REGION'),
    cloudRunJob: required(env, 'ECOS_GCP_JOB'),
    schedulerJob: required(env, 'ECOS_GCP_SCHEDULER'),
  });
}

function assertTargetIdentity(job, config) {
  assert(job && job.id === config.targetJobId, 'Exact resume job was not found');
  assert(job.organization_id === config.organizationId, 'Resume organization identity mismatch');
  assert(job.document_id === config.targetDocumentId, 'Resume document identity mismatch');
  assert(job.source_sha256 === config.targetSourceSha256, 'Resume source SHA mismatch');
  assert(Number(job.source_page_count) === config.expectedPageCount, 'Resume page count mismatch');
  assert(job.source_provider === 'managed_upload', 'Resume target must use its managed source copy');
  assert(job.source_locator?.gcsBucket && job.source_locator?.gcsObject,
    'Resume target managed source locator is incomplete');
  assert(job.mode === 'shadow', 'Resume target must remain shadow-only');
  assert(job.committed_evidence_version == null || (
    job.state === 'ready' && job.committed_evidence_version === EVIDENCE_VERSION
  ), 'Resume target carries an unexpected committed evidence version');
  const targetVersion = String(
    job.failure_diagnostics?.targetEvidenceVersion || job.target_evidence_version || '',
  ).trim();
  assert(
    job.state === 'ready' || targetVersion === EVIDENCE_VERSION,
    'Resume target does not carry the exact evidence-1.3 contract',
  );
  const completed = Number(job.completed_page_count || 0);
  const assured = Number(job.assured_page_count || 0);
  const unresolved = Number(job.unresolved_region_count || 0);
  assert(Number.isInteger(completed) && completed >= 0 && completed <= config.expectedPageCount,
    'Resume completed-page checkpoint is invalid');
  assert(Number.isInteger(assured) && assured >= 0 && assured <= completed,
    'Resume assured-page checkpoint is invalid');
  assert(Number.isInteger(unresolved) && unresolved >= 0,
    'Resume unresolved-region checkpoint is invalid');
  assert(Number(job.retry_count) >= 0 && Number(job.max_retry_count) > 0,
    'Resume retry counters are invalid');
  return job;
}

function assertReferenceAuthority(documentData, config, mode = config.referenceAuthorityMode) {
  for (const key of ['contentSha256', 'webFileFingerprint', 'indexedContentSha256']) {
    assert(documentData[key] === config.targetSourceSha256, `Reference document ${key} mismatch`);
  }
  assert(documentData.isCurrent === true, 'Resume reference document is not current');
  assert(Number(documentData.sourcePageCount) === config.expectedPageCount,
    'Resume reference source page count mismatch');
  if (mode === 'fresh') {
    for (const key of REFERENCE_RECEIPT_KEYS) {
      assert(documentData[key] == null, `Fresh reference document unexpectedly carries ${key}`);
    }
    return;
  }
  assert(documentData.ecosVerifiedIndexCommitVersion === 'ecos-verified-index-commit/1.0',
    'Reference document commit version mismatch');
  assert(documentData.ecosVerifiedIndexCommittedSha256 === config.targetSourceSha256,
    'Reference document committed SHA mismatch');
  assert(Number(documentData.ecosVerifiedIndexCommittedPageCount) === config.expectedPageCount,
    'Reference document committed page count mismatch');
  const pageGraph = documentData.extractedPages;
  assert(Array.isArray(pageGraph) && pageGraph.length === config.expectedPageCount,
    'Reference document page graph is missing');
  assert(sha256Json(pageGraph) === documentData.ecosVerifiedIndexPageGraphSha256,
    'Reference document page graph digest mismatch');
  assert(pageGraph.every((page, index) => (
    Number(page?.pageNumber) === index + 1
    && page?.assurance?.accepted === true
    && page.assurance?.evidenceVersion === EVIDENCE_VERSION
    && page?.visualCoverage?.sourceSha256 === config.targetSourceSha256
    && page.visualCoverage?.evidenceVersion === EVIDENCE_VERSION
    && Number(page.visualCoverage?.pageNumber) === index + 1
  )), 'Reference document page graph is not exactly assured');
}

const nonTargetManifest = (jobs, config) => {
  assert(jobs.length === config.expectedJobCount,
    `Expected ${config.expectedJobCount} organization jobs, found ${jobs.length}`);
  assert(jobs.every(job => job.mode === 'shadow'), 'Every organization job must remain shadow-only');
  const target = jobs.filter(job => job.id === config.targetJobId);
  assert(target.length === 1, 'Expected exactly one resume target');
  const rows = jobs.filter(job => job.id !== config.targetJobId)
    .sort((left, right) => left.id.localeCompare(right.id));
  return { target: target[0], count: rows.length, sha256: sha256Json(rows) };
};

function assertConfigurationBoundary(configurations, config, expected) {
  const targetRows = configurations.filter(row => row.organization_id === config.organizationId);
  assert(targetRows.length === 1, 'Expected one exact hosted-index configuration row');
  assert(configurations.every(row => (
    row.organization_id === config.organizationId || row.enabled === false
  )), 'Another organization is enabled and could claim work');
  const row = targetRows[0];
  assert(row.enabled === expected.enabled, 'Hosted-index enabled state drifted');
  assert(row.publication_mode === 'shadow', 'Hosted-index publication mode left shadow');
  assert(Number(row.max_concurrent_jobs) === expected.maxConcurrentJobs,
    'Hosted-index concurrency drifted');
  assert(Number(row.daily_visual_region_limit) === expected.dailyVisualRegionLimit,
    'Hosted-index visual cap drifted');
  return row;
}

const nextUtcDay = nowMs => {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) + 1000;
};

function assertProviderAttemptUsage(value, nowMs) {
  assert(value && typeof value === 'object' && !Array.isArray(value),
    'Provider-attempt usage receipt is missing');
  const dayStartMs = Date.parse(value.dayStart);
  const resetAtMs = Date.parse(value.resetAt);
  assert(Number.isFinite(dayStartMs) && Number.isFinite(resetAtMs),
    'Provider-attempt usage receipt has malformed UTC bounds');
  assert(resetAtMs - dayStartMs === 86_400_000,
    'Provider-attempt usage receipt has an invalid UTC window');
  assert(nowMs >= dayStartMs && nowMs < resetAtMs,
    'Provider-attempt usage receipt is outside the current UTC day');
  const normalized = {
    dayStart: new Date(dayStartMs).toISOString(),
    resetAt: new Date(resetAtMs).toISOString(),
  };
  for (const [scope, expectedLimit] of Object.entries(EXPECTED_PROVIDER_ATTEMPT_LIMITS)) {
    const item = value[scope];
    assert(item && typeof item === 'object' && !Array.isArray(item),
      `Provider-attempt ${scope} usage is missing`);
    const used = Number(item.used);
    const limit = Number(item.limit);
    assert(Number.isInteger(used) && used >= 0,
      `Provider-attempt ${scope} usage is invalid`);
    assert(Number.isInteger(limit) && limit === expectedLimit,
      `Provider-attempt ${scope} safety limit drifted`);
    assert(used <= limit, `Provider-attempt ${scope} usage exceeds its safety limit`);
    normalized[scope] = { used, limit };
  }
  return normalized;
}

const providerAttemptUsageExhausted = usage => (
  Object.keys(EXPECTED_PROVIDER_ATTEMPT_LIMITS)
    .some(scope => usage[scope].used >= usage[scope].limit)
);

function eligibleAt(job, dailyVisualUsage, providerAttemptUsage, config, nowMs) {
  assertTargetIdentity(job, config);
  const attempts = assertProviderAttemptUsage(providerAttemptUsage, nowMs);
  if (job.state === 'ready') return nowMs;
  assert(RETRYABLE_JOB_STATES.has(job.state), `Resume target entered hard-failure state ${job.state}`);
  assert(Number(job.retry_count) < Number(job.max_retry_count), 'Resume target reached max retry count');
  let at = nowMs;
  if (job.next_attempt_at != null) {
    const parsed = Date.parse(job.next_attempt_at);
    assert(Number.isFinite(parsed), 'Resume target next_attempt_at is malformed');
    at = Math.max(at, parsed);
  }
  if (job.lease_expires_at != null) {
    const parsed = Date.parse(job.lease_expires_at);
    assert(Number.isFinite(parsed), 'Resume target lease expiry is malformed');
    at = Math.max(at, parsed + 1000);
  }
  if (ACTIVE_JOB_STATES.has(job.state)) {
    assert(job.lease_expires_at != null, 'Active resume target is missing its lease expiry');
  }
  if (dailyVisualUsage >= config.executionVisualLimit) {
    at = Math.max(at, nextUtcDay(nowMs));
  }
  if (providerAttemptUsageExhausted(attempts)) {
    at = Math.max(at, Date.parse(attempts.resetAt) + 1000);
  }
  return at;
}

function assertTargetArtifacts(artifacts, config, { final = false } = {}) {
  const expectedPages = new Set(Array.from({ length: config.expectedPageCount }, (_, index) => index + 1));
  const actualPageNumbers = artifacts.pages.map(page => Number(page.page_number));
  assert(new Set(actualPageNumbers).size === actualPageNumbers.length,
    'Target page checkpoints contain duplicate identities');
  assert(artifacts.pages.every(page => (
    expectedPages.has(Number(page.page_number))
    && page.source_sha256 === config.targetSourceSha256
  )), 'A target page is outside the exact source/page boundary');
  assert(Number(artifacts.queueCount) >= 0, 'Target materialization queue count is invalid');
  assert(Number(artifacts.shadowChunkCount) >= 0, 'Target shadow chunk count is invalid');
  assert(artifacts.visualExceptions.every(row => (
    expectedPages.has(Number(row.page_number))
    && String(row.region_key || '').trim().length > 0
  )), 'A target visual exception is outside the exact page boundary');
  if (!final) return;
  assert(artifacts.pages.length === config.expectedPageCount,
    'Final target page set is incomplete');
  assert(artifacts.pages.every(page => (
    page.state === 'assured'
    && page.assurance_result?.accepted === true
    && page.assurance_result?.evidenceVersion === EVIDENCE_VERSION
    && Number(page.unresolved_region_count) === 0
  )), 'A final target page is not exactly assured');
  assert(Number(artifacts.queueCount) === 0, 'Final materialization queue is not empty');
  assert(Number(artifacts.shadowChunkCount) > 0, 'Final target produced no shadow chunks');
  assert(Array.isArray(artifacts.shadowPageCounts)
    && artifacts.shadowPageCounts.length === config.expectedPageCount
    && artifacts.shadowPageCounts.every(value => value.count > 0),
  'Final shadow chunks do not cover every page');
  assert(artifacts.visualExceptions.every(row => (
    row.state === 'resolved'
    && row.evidence_version === EVIDENCE_VERSION
    && /^[a-f0-9]{64}$/.test(String(row.exception_fingerprint || ''))
    && row.assurance_result?.accepted === true
    && row.assurance_result?.evidenceVersion === EVIDENCE_VERSION
    && row.assurance_result?.exceptionFingerprint === row.exception_fingerprint
    && row.claimed_by == null
    && row.lease_expires_at == null
    && row.next_attempt_at == null
  )), 'A final visual exception is unresolved, stale, or unbound');
}

function configuredEnvironment(container) {
  const values = {};
  const secrets = {};
  const rows = Array.isArray(container?.env) ? container.env : [];
  for (const row of rows) {
    const name = String(row?.name || '').trim();
    assert(/^[A-Z][A-Z0-9_]*$/.test(name), 'Cloud Run environment contains an invalid key');
    assert(!(name in values) && !(name in secrets),
      `Cloud Run environment contains duplicate key ${name}`);
    if (typeof row.value === 'string') {
      values[name] = row.value;
      continue;
    }
    const secret = row?.valueFrom?.secretKeyRef || row?.valueSource?.secretKeyRef;
    const secretName = String(secret?.name || secret?.secret || '').trim();
    const version = String(secret?.key || secret?.version || '').trim();
    assert(secretName && version, `Cloud Run environment ${name} has no exact value or secret version`);
    secrets[name] = `${secretName}:${version}`;
  }
  return {
    values: Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))),
    secrets: Object.fromEntries(Object.entries(secrets).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function cloudRunJobProvenance(job) {
  const executionSpec = job?.spec?.template?.spec || {};
  const taskSpec = executionSpec?.template?.spec || {};
  const containers = Array.isArray(taskSpec?.containers) ? taskSpec.containers : [];
  const container = containers[0];
  const environment = configuredEnvironment(container);
  return {
    resourceName: job?.metadata?.name || job?.name || null,
    generation: String(job?.metadata?.generation || job?.generation || ''),
    image: container?.image || null,
    serviceAccount: taskSpec?.serviceAccountName || taskSpec?.serviceAccount || null,
    taskCount: Number(executionSpec?.taskCount || 0),
    parallelism: Number(executionSpec?.parallelism || 0),
    maxRetries: Number(taskSpec?.maxRetries ?? -1),
    containerCount: containers.length,
    environment: environment.values,
    secretBindings: environment.secrets,
  };
}

function cloudRunExecutionProvenance(execution) {
  const executionSpec = execution?.spec || {};
  const taskSpec = executionSpec?.template?.spec || {};
  const containers = Array.isArray(taskSpec?.containers) ? taskSpec.containers : [];
  const container = containers[0];
  const environment = configuredEnvironment(container);
  return {
    resourceName: execution?.metadata?.name || execution?.name || null,
    generation: String(execution?.metadata?.generation || execution?.generation || ''),
    image: container?.image || null,
    serviceAccount: taskSpec?.serviceAccountName || taskSpec?.serviceAccount || null,
    taskCount: Number(executionSpec?.taskCount || 0),
    parallelism: Number(executionSpec?.parallelism || 0),
    maxRetries: Number(taskSpec?.maxRetries ?? -1),
    containerCount: containers.length,
    environment: environment.values,
    secretBindings: environment.secrets,
  };
}

function assertExactMap(actual, expected, label) {
  assert(stableJson(actual) === stableJson(expected), `${label} drifted`);
}

function assertCloudRunProvenance(provenance, config, expectedEnvironment, label) {
  assert(provenance?.resourceName, `${label} resource identity is missing`);
  assert(/^[1-9][0-9]*$/.test(provenance.generation), `${label} generation is missing`);
  assert(provenance.image === config.expectedImage, `${label} image digest drifted`);
  assert(provenance.serviceAccount === config.runtimeServiceAccount,
    `${label} runtime service account drifted`);
  assert(provenance.taskCount === 1, `${label} task count must be one`);
  assert(provenance.parallelism === 1, `${label} parallelism must be one`);
  assert(provenance.maxRetries === 1, `${label} max retries must be one`);
  assert(provenance.containerCount === 1, `${label} container count must be one`);
  assertExactMap(provenance.secretBindings, config.secretBindings, `${label} secret bindings`);
  assertExactMap(provenance.environment, expectedEnvironment, `${label} runtime environment`);
  return provenance;
}

const cloudResourceLeaf = value => String(value || '').split('/').filter(Boolean).at(-1) || '';

function assertCloudBoundary(boundary, config) {
  assert(boundary.schedulerState === 'PAUSED', 'Cloud Scheduler must remain PAUSED');
  assert(boundary.artifactDigest === config.expectedImageDigest, 'Cloud artifact digest mismatch');
  assertCloudRunProvenance(
    boundary.jobProvenance,
    config,
    config.runtimeEnvironment,
    'Cloud Run job',
  );
  assert(cloudResourceLeaf(boundary.jobProvenance.resourceName) === config.cloudRunJob,
    'Cloud Run job resource identity drifted');
  assert(Array.isArray(boundary.executionNames), 'Cloud Run execution inventory is missing');
  assert(Array.isArray(boundary.activeExecutionNames), 'Cloud Run active execution inventory is missing');
  assert(boundary.activeExecutionNames.length === 0, 'A Cloud Run execution is already active');
  return boundary;
}

function currentOperatorIdentity(options = {}) {
  const execute = options.execFileSync || execFileSync;
  const runGit = (args, encoding = null) => execute('git', args, {
    cwd: path.resolve(__dirname, '..'),
    encoding,
    timeout: 30_000,
    maxBuffer: 100 * 1024 * 1024,
  });
  const runGitText = args => String(runGit(args, 'utf8') || '').trim();
  const status = Buffer.from(runGit([
    'status', '--porcelain=v1', '-z', '--untracked-files=all',
  ]) || '');
  const trackedPatch = Buffer.from(runGit([
    'diff', '--binary', '--no-ext-diff', 'HEAD', '--',
  ]) || '');
  const untrackedPaths = Buffer.from(runGit([
    'ls-files', '--others', '--exclude-standard', '-z',
  ]) || '').toString('utf8').split('\0').filter(Boolean).sort();
  const repositoryRoot = path.resolve(__dirname, '..');
  const untracked = untrackedPaths.map(relativePath => {
    const absolutePath = path.resolve(repositoryRoot, relativePath);
    assert(absolutePath.startsWith(`${repositoryRoot}${path.sep}`),
      'Untracked identity path escaped the repository');
    const stat = fs.lstatSync(absolutePath);
    const contents = stat.isSymbolicLink()
      ? Buffer.from(fs.readlinkSync(absolutePath))
      : fs.readFileSync(absolutePath);
    return {
      path: relativePath,
      mode: stat.mode & 0o777,
      type: stat.isSymbolicLink() ? 'symlink' : 'file',
      size: contents.length,
      sha256: sha256(contents),
    };
  });
  const workingTreeStateSha256 = sha256Json({
    statusSha256: sha256(status),
    trackedPatchSha256: sha256(trackedPatch),
    untracked,
  });
  return Object.freeze({
    repositoryCommit: runGitText(['rev-parse', 'HEAD']).toLowerCase(),
    repositoryTree: runGitText(['rev-parse', 'HEAD^{tree}']).toLowerCase(),
    workingTreeDirty: status.length > 0,
    workingTreeStatusSha256: workingTreeStateSha256,
    operatorScriptSha256: sha256(fs.readFileSync(__filename)),
  });
}

function assertOperatorIdentity(identity, config) {
  const expected = config.expectedOperatorIdentity;
  assert(identity.repositoryCommit === expected.repositoryCommit,
    'Resume operator repository commit does not match the approved candidate');
  assert(identity.repositoryTree === expected.repositoryTree,
    'Resume operator repository tree does not match the approved candidate');
  assert(identity.workingTreeStatusSha256 === expected.workingTreeStatusSha256,
    'Resume operator working-tree status does not match the approved candidate');
  assert(identity.operatorScriptSha256 === expected.operatorScriptSha256,
    'Resume operator script does not match the approved candidate');
  assert(identity.workingTreeDirty === expected.workingTreeDirty,
    'Resume operator working-tree dirty state does not match the approved candidate');
  return identity;
}

function validateExecutionSlice(slice, config) {
  assert(slice && slice.name, 'Cloud Run execution name is missing');
  assert(slice.completed === true && slice.succeededCount === 1 && slice.failedCount === 0,
    'Cloud Run execution did not complete exactly once');
  assertCloudRunProvenance(
    slice.provenance,
    config,
    expectedExecutionEnvironment(config, {
      targetJobId: config.targetJobId,
      targetSourceSha256: config.targetSourceSha256,
      maxRunSeconds: config.maxRunSeconds,
      workerId: slice.workerId,
    }),
    'Cloud Run execution',
  );
  assert(slice.provenance.resourceName === slice.name,
    'Cloud Run execution resource identity drifted');
  assert(slice.errorLogCount === 0, 'Execution-scoped Cloud Logging contains errors');
  assert(slice.startedJobIds.length === 1 && slice.startedJobIds[0] === config.targetJobId,
    'Execution did not start only the exact target');
  assert(slice.readyJobIds.every(jobId => jobId === config.targetJobId),
    'Execution readied a non-target job');
  assert(slice.jobsProcessed === 1, 'Execution did not process exactly one job');
  assert(slice.batchFinishedCount === 1,
    'Execution logs must contain exactly one batch-finished receipt');
  assert(slice.logTruncated === false, 'Execution-scoped Cloud Logging may be truncated');
}

function assertTerminalCancellations(receipts) {
  assert(Array.isArray(receipts), 'Cloud Run cancellation receipt is missing');
  for (const receipt of receipts) {
    assert(receipt && receipt.name && receipt.terminal === true,
      'Cloud Run cancellation did not return a terminal execution receipt');
    assert(Number.isFinite(Date.parse(receipt.completionTime)),
      `Cloud Run cancellation completion time is invalid for ${receipt.name}`);
  }
  return receipts;
}

function createSignalController(processRef = process) {
  let requestedSignal = null;
  const children = new Set();
  const handlers = new Map();
  const request = signal => {
    if (!requestedSignal) requestedSignal = signal;
    for (const child of children) {
      if (!child.killed) {
        try { child.kill('SIGTERM'); } catch {}
      }
    }
  };
  return {
    install() {
      for (const signal of ['SIGINT', 'SIGTERM']) {
        const handler = () => request(signal);
        handlers.set(signal, handler);
        processRef.on(signal, handler);
      }
    },
    remove() {
      for (const [signal, handler] of handlers) processRef.off(signal, handler);
      handlers.clear();
    },
    request,
    addChild(value) {
      children.add(value);
      if (requestedSignal && !value.killed) {
        try { value.kill('SIGTERM'); } catch {}
      }
    },
    removeChild(value) { children.delete(value); },
    get requestedSignal() { return requestedSignal; },
  };
}

function createReceiptWriter(config, options = {}) {
  const directory = options.directory || path.resolve(__dirname, '../validation/output');
  const runId = options.runId || `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
  const receiptPath = path.join(directory, `ecos-hosted-v13-resume-${config.targetJobId}-${runId}.json`);
  const write = (audit, seal = false) => {
    fs.mkdirSync(directory, { recursive: true });
    const unsealed = { ...audit };
    delete unsealed.seal;
    const output = seal ? {
      ...unsealed,
      seal: {
        algorithm: 'sha256-stable-json',
        receiptSha256: sha256Json(unsealed),
      },
    } : unsealed;
    const temporaryPath = `${receiptPath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, receiptPath);
    return output;
  };
  return { receiptPath, write };
}

function createOperationDeadline(clock, deadlineMs, label) {
  const startedMs = clock.now();
  let lastCompletedMs = startedMs;
  let exhausted = false;
  const remainingMs = () => Math.max(0, deadlineMs - clock.now());
  const run = async (operationLabel, operation) => {
    const availableMs = remainingMs();
    if (availableMs <= 0) {
      exhausted = true;
      throw new Error(`${label} deadline exhausted before ${operationLabel}`);
    }
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        exhausted = true;
        controller.abort();
        reject(new Error(`${label} deadline exhausted during ${operationLabel}`));
      }, availableMs);
    });
    try {
      const result = await Promise.race([
        operation({ signal: controller.signal, deadlineMs, timeoutMs: availableMs }),
        timeout,
      ]);
      lastCompletedMs = clock.now();
      if (lastCompletedMs > deadlineMs) {
        exhausted = true;
        throw new Error(`${label} deadline exhausted during ${operationLabel}`);
      }
      return result;
    } catch (error) {
      lastCompletedMs = clock.now();
      if (lastCompletedMs > deadlineMs) exhausted = true;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    deadlineMs,
    label,
    remainingMs,
    run,
    receipt() {
      return {
        label,
        startedAt: new Date(startedMs).toISOString(),
        deadlineAt: new Date(deadlineMs).toISOString(),
        completedAt: new Date(lastCompletedMs).toISOString(),
        elapsedMs: Math.max(0, lastCompletedMs - startedMs),
        remainingMs: Math.max(0, deadlineMs - lastCompletedMs),
        exhausted,
      };
    },
  };
}

async function reconcileDisabledConfiguration(db, config, baselineConfig, deadline = null) {
  const run = (label, operation) => deadline ? deadline.run(label, operation) : operation({});
  const errors = [];
  try {
    await run('disable configuration', options => db.updateConfiguration(
      { enabled: false },
      { organization_id: config.organizationId },
      options,
    ));
  } catch (error) {
    errors.push(`disable mutation: ${error.message}`);
  }
  let disabled = false;
  try {
    const configurations = await run(
      'read disabled configuration',
      options => db.selectConfigurations(options),
    );
    const row = configurations.find(value => value.organization_id === config.organizationId);
    disabled = Boolean(row && row.enabled === false);
    if (!disabled) errors.push('disable reconciliation: exact organization remains enabled');
  } catch (error) {
    errors.push(`disable reconciliation: ${error.message}`);
  }
  if (disabled && baselineConfig) {
    try {
      await run('restore baseline configuration', options => db.updateConfiguration({
        enabled: false,
        publication_mode: 'shadow',
        max_concurrent_jobs: baselineConfig.max_concurrent_jobs,
        daily_visual_region_limit: baselineConfig.daily_visual_region_limit,
      }, { organization_id: config.organizationId, enabled: false }, options));
    } catch (error) {
      errors.push(`baseline restore mutation: ${error.message}`);
    }
    try {
      const configurations = await run(
        'verify baseline configuration',
        options => db.selectConfigurations(options),
      );
      assertConfigurationBoundary(configurations, config, {
        enabled: false,
        maxConcurrentJobs: Number(baselineConfig.max_concurrent_jobs),
        dailyVisualRegionLimit: Number(baselineConfig.daily_visual_region_limit),
      });
    } catch (error) {
      errors.push(`baseline restore reconciliation: ${error.message}`);
    }
  }
  return { disabled, errors };
}

async function runResumeOperator(config, dependencies) {
  const { db, cloud, clock, receipts, signals } = dependencies;
  const operatorIdentity = assertOperatorIdentity(
    dependencies.operatorIdentity || currentOperatorIdentity(),
    config,
  );
  const startedMs = clock.now();
  const totalDeadlineMs = startedMs + config.maxTotalSeconds * 1000;
  const executionDeadlineMs = totalDeadlineMs - config.cleanupBudgetSeconds * 1000;
  let baselineConfig = null;
  let baselineCloud = null;
  let baselineNonTarget = null;
  let baselineLive = null;
  let operationError = null;
  let mutationStarted = false;
  let cleanupBudgetStartedMs = null;
  let cleanupPriorExecutionNames = [];
  const executionPhaseDeadline = createOperationDeadline(
    clock,
    executionDeadlineMs,
    'execution phase',
  );
  const assertNotInterrupted = () => assert(
    !signals.requestedSignal,
    `Interrupted by ${signals.requestedSignal}`,
  );
  const assertSliceTimeAvailable = () => {
    const remainingSeconds = config.maxTotalSeconds - ((clock.now() - startedMs) / 1000);
    assert(
      remainingSeconds >= config.taskTimeoutSeconds + config.cleanupBudgetSeconds,
      'Remaining total time cannot cover one task timeout and total cleanup budget',
    );
    return remainingSeconds;
  };
  const audit = {
    receiptVersion: RECEIPT_VERSION,
    startedAt: new Date(startedMs).toISOString(),
    status: 'preflight',
    operatorIdentity,
    target: {
      jobId: config.targetJobId,
      documentId: config.targetDocumentId,
      sourceSha256: config.targetSourceSha256,
      expectedPageCount: config.expectedPageCount,
      organizationId: config.organizationId,
      evidenceVersion: EVIDENCE_VERSION,
    },
    controls: {
      expectedUrl: config.expectedUrl,
      expectedImage: config.expectedImage,
      expectedImageDigest: config.expectedImageDigest,
      expectedJobCount: config.expectedJobCount,
      expectedBaselineConcurrency: config.expectedBaselineConcurrency,
      expectedBaselineVisualLimit: config.expectedBaselineVisualLimit,
      executionVisualLimit: config.executionVisualLimit,
      maxSlices: config.maxSlices,
      maxTotalSeconds: config.maxTotalSeconds,
      maxWaitSeconds: config.maxWaitSeconds,
      taskTimeoutSeconds: config.taskTimeoutSeconds,
      maxRunSeconds: config.maxRunSeconds,
      cancelTimeoutSeconds: config.cancelTimeoutSeconds,
      cleanupSliceConfigurationSeconds: config.cleanupSliceConfigurationSeconds,
      cleanupContainmentSeconds: config.cleanupContainmentSeconds,
      cleanupPostRunVerificationSeconds: config.cleanupPostRunVerificationSeconds,
      cleanupCompletionVerificationSeconds: config.cleanupCompletionVerificationSeconds,
      cleanupFinalVerificationSeconds: config.cleanupFinalVerificationSeconds,
      cleanupBudgetSeconds: config.cleanupBudgetSeconds,
      runtimeServiceAccount: config.runtimeServiceAccount,
      runtimeEnvironment: config.runtimeEnvironment,
      secretBindings: config.secretBindings,
      referenceAuthorityMode: config.referenceAuthorityMode,
      schedulerMustRemainPaused: true,
      publicationMode: 'shadow',
      concurrency: 1,
    },
    slices: [],
    cleanup: {},
  };
  const save = seal => receipts.write(audit, seal);
  signals.install();
  save(false);

  try {
    assertNotInterrupted();
    const cloudBoundary = assertCloudBoundary(await cloud.inspectBoundary(signals), config);
    baselineCloud = cloudBoundary;

    const configurations = await db.selectConfigurations();
    baselineConfig = assertConfigurationBoundary(configurations, config, {
      enabled: false,
      maxConcurrentJobs: config.expectedBaselineConcurrency,
      dailyVisualRegionLimit: config.expectedBaselineVisualLimit,
    });
    assert(config.executionVisualLimit <= Number(baselineConfig.daily_visual_region_limit),
      'Execution visual cap exceeds the approved disabled baseline');

    const manifest = nonTargetManifest(await db.selectOrganizationJobs(config.organizationId), config);
    const target = assertTargetIdentity(manifest.target, config);
    baselineNonTarget = { count: manifest.count, sha256: manifest.sha256 };
    const reference = await db.selectReferenceDocument(config.targetDocumentId);
    assert(reference && reference.id === config.targetDocumentId, 'Exact reference document was not found');
    assertReferenceAuthority(reference.document_data || {}, config,
      target.state === 'ready' ? 'exact' : config.referenceAuthorityMode);
    await cloud.verifyManagedSource(target.source_locator, config.targetSourceSha256, signals);
    baselineLive = await db.selectLiveSnapshot(
      config.targetDocumentId,
      withoutReferenceAuthority(reference.document_data || {}),
    );
    const initialArtifacts = await db.selectTargetArtifacts(
      config.targetJobId,
      config.expectedPageCount,
      { includePageCounts: target.state === 'ready' },
    );
    assertTargetArtifacts(initialArtifacts, config, { final: target.state === 'ready' });
    const initialDailyUsage = await db.selectDailyVisualUsage(config.organizationId, clock.now());
    assert(initialDailyUsage <= config.executionVisualLimit,
      'Provider daily visual usage already exceeds the execution cap');
    const initialProviderAttemptUsage = assertProviderAttemptUsage(
      await db.selectDailyProviderAttemptUsage(config.targetJobId, clock.now()),
      clock.now(),
    );
    audit.preflight = {
      cloud: cloudBoundary,
      configuration: baselineConfig,
      nonTargetManifest: baselineNonTarget,
      target,
      liveSnapshot: baselineLive,
      targetArtifacts: initialArtifacts,
      dailyVisualUsage: initialDailyUsage,
      dailyProviderAttemptUsage: initialProviderAttemptUsage,
    };
    assertNotInterrupted();
    audit.status = config.preflightOnly ? 'preflight_pass' : 'ready_to_resume';
    save(false);
    if (config.preflightOnly) {
      const complete = new Error('Resume preflight complete');
      complete.code = 'ECOS_RESUME_PREFLIGHT_COMPLETE';
      throw complete;
    }

    for (let sliceNumber = 1; sliceNumber <= config.maxSlices; sliceNumber += 1) {
      assertNotInterrupted();
      const elapsedSeconds = (clock.now() - startedMs) / 1000;
      assert(elapsedSeconds < config.maxTotalSeconds, 'Resume operator exceeded max total seconds');

      let currentManifest = nonTargetManifest(
        await executionPhaseDeadline.run(
          'read organization manifest',
          options => db.selectOrganizationJobs(config.organizationId, options),
        ),
        config,
      );
      assert(currentManifest.count === baselineNonTarget.count
        && currentManifest.sha256 === baselineNonTarget.sha256,
      'A non-target job changed before the next slice');
      let current = assertTargetIdentity(currentManifest.target, config);
      if (current.state === 'ready') break;
      let dailyUsage = await executionPhaseDeadline.run(
        'read daily visual usage',
        options => db.selectDailyVisualUsage(config.organizationId, clock.now(), options),
      );
      assert(dailyUsage <= config.executionVisualLimit, 'Provider daily visual cap was exceeded');
      let providerAttemptUsage = assertProviderAttemptUsage(
        await executionPhaseDeadline.run(
          'read daily provider-attempt usage',
          options => db.selectDailyProviderAttemptUsage(config.targetJobId, clock.now(), options),
        ),
        clock.now(),
      );
      const dueAt = eligibleAt(
        current,
        dailyUsage,
        providerAttemptUsage,
        config,
        clock.now(),
      );
      if (dueAt > clock.now()) {
        const waitMs = dueAt - clock.now();
        assert(waitMs <= config.maxWaitSeconds * 1000,
          'Resume target is deferred beyond the bounded wait window');
        assert(clock.now() + waitMs <= executionDeadlineMs,
          'Resume wait would consume the task or total cleanup budget');
        audit.status = 'waiting_for_retry';
        audit.waiting = { sliceNumber, until: new Date(dueAt).toISOString(), waitMs };
        save(false);
        while (clock.now() < dueAt) {
          assertNotInterrupted();
          await clock.sleep(Math.min(config.pollSeconds * 1000, dueAt - clock.now()));
        }
        delete audit.waiting;
        currentManifest = nonTargetManifest(
          await executionPhaseDeadline.run(
            'read organization manifest after wait',
            options => db.selectOrganizationJobs(config.organizationId, options),
          ),
          config,
        );
        assert(currentManifest.sha256 === baselineNonTarget.sha256,
          'A non-target job changed while waiting');
        current = assertTargetIdentity(currentManifest.target, config);
        if (current.state === 'ready') break;
        dailyUsage = await executionPhaseDeadline.run(
          'read daily visual usage after wait',
          options => db.selectDailyVisualUsage(config.organizationId, clock.now(), options),
        );
        providerAttemptUsage = assertProviderAttemptUsage(
          await executionPhaseDeadline.run(
            'read daily provider-attempt usage after wait',
            options => db.selectDailyProviderAttemptUsage(config.targetJobId, clock.now(), options),
          ),
          clock.now(),
        );
        assert(eligibleAt(
          current,
          dailyUsage,
          providerAttemptUsage,
          config,
          clock.now(),
        ) <= clock.now(),
          'Resume target is not eligible after the bounded wait');
      }

      const referenceBefore = await executionPhaseDeadline.run(
        'read reference authority before slice',
        options => db.selectReferenceDocument(config.targetDocumentId, options),
      );
      const liveBefore = await executionPhaseDeadline.run(
        'read live evidence before slice',
        options => db.selectLiveSnapshot(
          config.targetDocumentId,
          withoutReferenceAuthority(referenceBefore.document_data || {}),
          options,
        ),
      );
      assert(liveBefore.sha256 === baselineLive.sha256,
        'Customer-facing live evidence changed before a slice');
      const cloudBefore = assertCloudBoundary(await executionPhaseDeadline.run(
        'verify Cloud boundary before slice',
        options => cloud.inspectBoundary(signals, options),
      ), config);
      assert(stableJson(cloudBefore.jobProvenance) === stableJson(baselineCloud.jobProvenance),
        'Cloud Run job provenance changed after preflight');
      cleanupPriorExecutionNames = [...cloudBefore.executionNames];
      assertSliceTimeAvailable();
      assertNotInterrupted();

      mutationStarted = true;
      audit.mutationStarted = true;
      audit.mutationStartedAt = new Date(clock.now()).toISOString();
      const enableResult = await executionPhaseDeadline.run(
        'enable contained configuration',
        options => db.updateConfiguration({
          enabled: true,
          publication_mode: 'shadow',
          max_concurrent_jobs: 1,
          daily_visual_region_limit: config.executionVisualLimit,
        }, {
          organization_id: config.organizationId,
          enabled: false,
          publication_mode: 'shadow',
          max_concurrent_jobs: baselineConfig.max_concurrent_jobs,
          daily_visual_region_limit: baselineConfig.daily_visual_region_limit,
        }, options),
      );
      assert(enableResult.length === 1, 'Failed to enable exactly one contained resume configuration');
      const enabledConfigurations = await executionPhaseDeadline.run(
        'verify contained configuration',
        options => db.selectConfigurations(options),
      );
      assertConfigurationBoundary(enabledConfigurations, config, {
        enabled: true,
        maxConcurrentJobs: 1,
        dailyVisualRegionLimit: config.executionVisualLimit,
      });
      assertNotInterrupted();
      assertSliceTimeAvailable();

      let slice;
      let sliceError = null;
      audit.status = 'executing_slice';
      audit.currentSlice = sliceNumber;
      save(false);
      try {
        assertNotInterrupted();
        slice = await cloud.executeExactTarget({
          targetJobId: config.targetJobId,
          targetSourceSha256: config.targetSourceSha256,
          maxRunSeconds: config.maxRunSeconds,
          taskTimeoutSeconds: config.taskTimeoutSeconds,
          deadlineMs: executionDeadlineMs,
          priorExecutionNames: cloudBefore.executionNames,
          workerId: `ecos-v13-resume-${config.targetJobId.slice(0, 8)}-${sliceNumber}`,
          signals,
        });
        assertNotInterrupted();
        validateExecutionSlice(slice, config);
      } catch (error) {
        sliceError = error;
      } finally {
        cleanupBudgetStartedMs = clock.now();
        const sliceCleanupDeadline = createOperationDeadline(
          clock,
          Math.min(
            totalDeadlineMs,
            cleanupBudgetStartedMs + config.cleanupSliceConfigurationSeconds * 1000,
          ),
          'slice configuration cleanup',
        );
        const sliceCleanup = await reconcileDisabledConfiguration(
          db,
          config,
          baselineConfig,
          sliceCleanupDeadline,
        );
        audit.sliceCleanupDeadline = sliceCleanupDeadline.receipt();
        if (sliceCleanup.errors.length > 0) {
          const prefix = sliceError ? `${sliceError.message}; ` : '';
          sliceError = new Error(`${prefix}slice cleanup failed: ${sliceCleanup.errors.join('; ')}`);
        }
      }
      if (sliceError) throw sliceError;

      const postRunDeadline = createOperationDeadline(
        clock,
        Math.min(
          totalDeadlineMs,
          cleanupBudgetStartedMs + (
            config.cleanupSliceConfigurationSeconds
            + config.cleanupPostRunVerificationSeconds
          ) * 1000,
        ),
        `slice ${sliceNumber} post-run verification`,
      );
      const cloudAfter = assertCloudBoundary(await postRunDeadline.run(
        'verify Cloud boundary',
        options => cloud.inspectBoundary(signals, options),
      ), config);
      assert(stableJson(cloudAfter.jobProvenance) === stableJson(baselineCloud.jobProvenance),
        'Cloud Run job provenance changed during a slice');
      const postManifest = nonTargetManifest(
        await postRunDeadline.run(
          'verify organization manifest',
          options => db.selectOrganizationJobs(config.organizationId, options),
        ),
        config,
      );
      assert(postManifest.count === baselineNonTarget.count
        && postManifest.sha256 === baselineNonTarget.sha256,
      'A non-target job changed during a slice');
      const targetAfter = assertTargetIdentity(postManifest.target, config);
      const referenceAfter = await postRunDeadline.run(
        'verify reference authority',
        options => db.selectReferenceDocument(config.targetDocumentId, options),
      );
      const liveAfter = await postRunDeadline.run(
        'verify live evidence',
        options => db.selectLiveSnapshot(
          config.targetDocumentId,
          withoutReferenceAuthority(referenceAfter.document_data || {}),
          options,
        ),
      );
      assert(liveAfter.sha256 === baselineLive.sha256,
        'A slice changed customer-facing live evidence');
      const dailyUsageAfter = await postRunDeadline.run(
        'verify daily visual usage',
        options => db.selectDailyVisualUsage(config.organizationId, clock.now(), options),
      );
      assert(dailyUsageAfter <= config.executionVisualLimit,
        'A slice exceeded the provider daily visual cap');
      const providerAttemptUsageAfter = assertProviderAttemptUsage(
        await postRunDeadline.run(
          'verify daily provider-attempt usage',
          options => db.selectDailyProviderAttemptUsage(config.targetJobId, clock.now(), options),
        ),
        clock.now(),
      );
      const artifactsAfter = await postRunDeadline.run(
        'verify target artifacts',
        options => db.selectTargetArtifacts(
          config.targetJobId,
          config.expectedPageCount,
          { includePageCounts: targetAfter.state === 'ready', ...options },
        ),
      );
      assertTargetArtifacts(artifactsAfter, config, { final: targetAfter.state === 'ready' });
      audit.slices.push({
        sliceNumber,
        cloudBefore,
        execution: slice,
        cloudAfter,
        targetBefore: current,
        targetAfter,
        nonTargetManifest: { count: postManifest.count, sha256: postManifest.sha256 },
        liveSnapshotSha256: liveAfter.sha256,
        dailyVisualUsageBefore: dailyUsage,
        dailyVisualUsageAfter: dailyUsageAfter,
        dailyProviderAttemptUsageBefore: providerAttemptUsage,
        dailyProviderAttemptUsageAfter: providerAttemptUsageAfter,
        targetArtifacts: artifactsAfter,
        postRunDeadline: postRunDeadline.receipt(),
      });
      delete audit.currentSlice;
      audit.status = targetAfter.state === 'ready' ? 'verifying_final' : 'slice_complete';
      save(false);
      if (targetAfter.state === 'ready') break;
      assert(RETRYABLE_JOB_STATES.has(targetAfter.state),
        `Resume target entered hard-failure state ${targetAfter.state}`);
      assert(Number(targetAfter.retry_count) < Number(targetAfter.max_retry_count),
        'Resume target reached max retry count');
      cleanupBudgetStartedMs = null;
    }

    const completionDeadline = createOperationDeadline(
      clock,
      Math.min(
        totalDeadlineMs,
        (cleanupBudgetStartedMs || clock.now()) + (
          config.cleanupSliceConfigurationSeconds
          + config.cleanupPostRunVerificationSeconds
          + config.cleanupCompletionVerificationSeconds
        ) * 1000,
      ),
      'completion verification',
    );
    const finalManifest = nonTargetManifest(
      await completionDeadline.run(
        'verify final organization manifest',
        options => db.selectOrganizationJobs(config.organizationId, options),
      ),
      config,
    );
    assert(finalManifest.sha256 === baselineNonTarget.sha256,
      'A non-target job changed before final sealing');
    const finalTarget = assertTargetIdentity(finalManifest.target, config);
    assert(finalTarget.state === 'ready', 'Resume target did not reach ready within the slice bound');
    assert(finalTarget.committed_evidence_version === EVIDENCE_VERSION,
      'Resume target final evidence version mismatch');
    assert(Number(finalTarget.completed_page_count) === config.expectedPageCount
      && Number(finalTarget.assured_page_count) === config.expectedPageCount
      && Number(finalTarget.unresolved_region_count) === 0,
    'Resume target final counters are incomplete');
    assert(finalTarget.claimed_by == null && finalTarget.claim_token == null
      && finalTarget.lease_expires_at == null,
    'Resume target final claim was not released');
    const finalArtifacts = await completionDeadline.run(
      'verify final target artifacts',
      options => db.selectTargetArtifacts(
        config.targetJobId,
        config.expectedPageCount,
        { includePageCounts: true, ...options },
      ),
    );
    assertTargetArtifacts(finalArtifacts, config, { final: true });
    const finalReference = await completionDeadline.run(
      'verify final reference authority',
      options => db.selectReferenceDocument(config.targetDocumentId, options),
    );
    assertReferenceAuthority(finalReference.document_data || {}, config, 'exact');
    const finalLive = await completionDeadline.run(
      'verify final live evidence',
      options => db.selectLiveSnapshot(
        config.targetDocumentId,
        withoutReferenceAuthority(finalReference.document_data || {}),
        options,
      ),
    );
    assert(finalLive.sha256 === baselineLive.sha256,
      'Customer-facing live evidence changed before final sealing');
    const finalDailyVisualUsage = await completionDeadline.run(
      'verify final daily visual usage',
      options => db.selectDailyVisualUsage(config.organizationId, clock.now(), options),
    );
    assert(finalDailyVisualUsage <= config.executionVisualLimit,
      'Final provider daily visual usage exceeds the execution cap');
    const finalProviderAttemptUsage = assertProviderAttemptUsage(
      await completionDeadline.run(
        'verify final daily provider-attempt usage',
        options => db.selectDailyProviderAttemptUsage(config.targetJobId, clock.now(), options),
      ),
      clock.now(),
    );
    audit.final = {
      target: finalTarget,
      targetArtifacts: finalArtifacts,
      referencePageGraphSha256: finalReference.document_data.ecosVerifiedIndexPageGraphSha256,
      nonTargetManifest: { count: finalManifest.count, sha256: finalManifest.sha256 },
      liveSnapshot: finalLive,
      dailyVisualUsage: finalDailyVisualUsage,
      dailyProviderAttemptUsage: finalProviderAttemptUsage,
      completionDeadline: completionDeadline.receipt(),
    };
    audit.status = 'pass';
  } catch (error) {
    if (error.code !== 'ECOS_RESUME_PREFLIGHT_COMPLETE') {
      operationError = error;
      audit.status = signals.requestedSignal ? 'interrupted' : 'failed';
      audit.failure = { name: error.name, message: boundedText(error.message) };
    }
  } finally {
    audit.executionPhaseDeadline = executionPhaseDeadline.receipt();
    audit.cleanup.mutationStarted = mutationStarted;
    const recordCleanupFailure = (field, error) => {
      audit.cleanup[field] = boundedText(error.message);
      if (!operationError) operationError = error;
      audit.status = 'failed';
      audit.failure = { name: operationError.name, message: boundedText(operationError.message) };
    };
    if (mutationStarted) {
      const cleanupStartedMs = cleanupBudgetStartedMs || clock.now();
      const cleanupDeadlineMs = Math.min(
        totalDeadlineMs,
        cleanupStartedMs + config.cleanupBudgetSeconds * 1000,
      );
      audit.cleanup.budget = {
        budgetSeconds: config.cleanupBudgetSeconds,
        sliceConfigurationSeconds: config.cleanupSliceConfigurationSeconds,
        containmentSeconds: config.cleanupContainmentSeconds,
        postRunVerificationSeconds: config.cleanupPostRunVerificationSeconds,
        completionVerificationSeconds: config.cleanupCompletionVerificationSeconds,
        cancellationSeconds: config.cancelTimeoutSeconds,
        finalVerificationSeconds: config.cleanupFinalVerificationSeconds,
        startedAt: new Date(cleanupStartedMs).toISOString(),
        deadlineAt: new Date(cleanupDeadlineMs).toISOString(),
        totalDeadlineAt: new Date(totalDeadlineMs).toISOString(),
      };
      const containmentDeadline = createOperationDeadline(
        clock,
        Math.min(
          cleanupDeadlineMs,
          cleanupStartedMs + (
            config.cleanupSliceConfigurationSeconds
            + config.cleanupPostRunVerificationSeconds
            + config.cleanupCompletionVerificationSeconds
            + config.cleanupContainmentSeconds
          ) * 1000,
        ),
        'cleanup containment',
      );
      const cleanup = await reconcileDisabledConfiguration(
        db,
        config,
        baselineConfig,
        containmentDeadline,
      );
      audit.cleanup.configuration = cleanup;
      if (cleanup.errors.length > 0) {
        recordCleanupFailure(
          'configurationError',
          new Error(`Final cleanup failed: ${cleanup.errors.join('; ')}`),
        );
      }
      try {
        audit.cleanup.scheduler = await containmentDeadline.run(
          'contain Scheduler',
          options => cloud.ensureSchedulerPaused({ signals, ...options }),
        );
        if (audit.cleanup.scheduler.state !== 'PAUSED') {
          throw new Error('Cloud Scheduler could not be confirmed PAUSED');
        }
        if (audit.cleanup.scheduler.repaired) {
          throw new Error('Cloud Scheduler drifted from PAUSED and required cleanup repair');
        }
      } catch (error) {
        recordCleanupFailure('schedulerError', error);
      }
      audit.cleanup.containmentDeadline = containmentDeadline.receipt();
      const cancellationDeadline = createOperationDeadline(
        clock,
        Math.min(
          cleanupDeadlineMs - config.cleanupFinalVerificationSeconds * 1000,
          cleanupStartedMs + (
            config.cleanupSliceConfigurationSeconds
            + config.cleanupPostRunVerificationSeconds
            + config.cleanupCompletionVerificationSeconds
            + config.cleanupContainmentSeconds
            + config.cancelTimeoutSeconds
          ) * 1000,
        ),
        'cleanup cancellation',
      );
      try {
        audit.cleanup.cancelledExecutions = await cancellationDeadline.run(
          'cancel and reconcile new executions',
          async options => assertTerminalCancellations(await cloud.cancelNewActiveExecutions({
            signals,
            timeoutSeconds: config.cancelTimeoutSeconds,
            pollSeconds: config.pollSeconds,
            priorExecutionNames: cleanupPriorExecutionNames,
            ...options,
          })),
        );
        assert(operationError || audit.cleanup.cancelledExecutions.length === 0,
          'An unexpected Cloud Run execution required cancellation during final cleanup');
      } catch (error) {
        recordCleanupFailure('cancellationError', error);
      }
      audit.cleanup.cancellationDeadline = cancellationDeadline.receipt();
      const finalVerificationDeadline = createOperationDeadline(
        clock,
        cleanupDeadlineMs,
        'cleanup final verification',
      );
      if (baselineNonTarget) {
        try {
          const cleanupManifest = nonTargetManifest(
            await finalVerificationDeadline.run(
              'verify non-target manifest',
              options => db.selectOrganizationJobs(config.organizationId, options),
            ),
            config,
          );
          assert(cleanupManifest.sha256 === baselineNonTarget.sha256,
            'A non-target job changed during final cleanup');
          audit.cleanup.nonTargetManifest = {
            count: cleanupManifest.count,
            sha256: cleanupManifest.sha256,
          };
        } catch (error) {
          recordCleanupFailure('nonTargetError', error);
        }
      }
      audit.cleanup.finalVerificationDeadline = finalVerificationDeadline.receipt();
      audit.cleanup.budget.completedAt = new Date(clock.now()).toISOString();
      audit.cleanup.budget.elapsedMs = Math.max(0, clock.now() - cleanupStartedMs);
      audit.cleanup.budget.remainingMs = Math.max(0, cleanupDeadlineMs - clock.now());
      audit.cleanup.budget.exhausted = clock.now() > cleanupDeadlineMs || [
        audit.cleanup.containmentDeadline,
        audit.cleanup.cancellationDeadline,
        audit.cleanup.finalVerificationDeadline,
      ].some(value => value.exhausted);
      if (audit.cleanup.budget.exhausted) {
        recordCleanupFailure(
          'deadlineError',
          new Error('Total cleanup deadline was exhausted before final sealing'),
        );
      }
    } else {
      audit.cleanup.readOnly = true;
      audit.cleanup.configuration = { skipped: true, reason: 'no mutation started' };
      audit.cleanup.cancelledExecutions = [];
      audit.cleanup.scheduler = { skipped: true, reason: 'no mutation started' };
      if (baselineNonTarget) {
        try {
          const cleanupManifest = nonTargetManifest(
            await db.selectOrganizationJobs(config.organizationId),
            config,
          );
          assert(cleanupManifest.sha256 === baselineNonTarget.sha256,
            'A non-target job changed during final cleanup');
          audit.cleanup.nonTargetManifest = {
            count: cleanupManifest.count,
            sha256: cleanupManifest.sha256,
          };
        } catch (error) {
          recordCleanupFailure('nonTargetError', error);
        }
      }
    }
    audit.cleanup.completedAt = new Date(clock.now()).toISOString();
    audit.finishedAt = new Date(clock.now()).toISOString();
    signals.remove();
    let sealed = save(true);
    if (mutationStarted && clock.now() > totalDeadlineMs) {
      const deadlineError = new Error('Operator max total deadline was exhausted during receipt sealing');
      audit.cleanup.deadlineError = deadlineError.message;
      audit.cleanup.budget.exhausted = true;
      audit.status = 'failed';
      if (!operationError) operationError = deadlineError;
      audit.failure = { name: operationError.name, message: boundedText(operationError.message) };
      audit.cleanup.completedAt = new Date(clock.now()).toISOString();
      audit.finishedAt = new Date(clock.now()).toISOString();
      sealed = save(true);
    }
    audit.seal = sealed.seal;
    if (operationError) {
      operationError.receipt = sealed;
      operationError.receiptPath = receipts.receiptPath;
    }
  }
  if (operationError) throw operationError;
  return audit;
}

function createSupabaseAdapter(config) {
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const noError = (result, context) => {
    if (result.error) throw new Error(`${context}: ${result.error.message}`);
    return result.data;
  };
  const withAbort = (query, options) => (
    options?.signal ? query.abortSignal(options.signal) : query
  );
  return {
    async selectConfigurations(options = {}) {
      const result = await withAbort(client.from('ecos_hosted_index_configuration')
        .select('organization_id,publication_mode,enabled,max_concurrent_jobs,daily_visual_region_limit')
        .order('organization_id', { ascending: true }), options);
      return noError(result, 'select hosted configurations');
    },
    async updateConfiguration(patch, expected, options = {}) {
      let query = client.from('ecos_hosted_index_configuration').update(patch);
      for (const [key, value] of Object.entries(expected)) query = query.eq(key, value);
      const result = await withAbort(query.select(
        'organization_id,publication_mode,enabled,max_concurrent_jobs,daily_visual_region_limit',
      ), options);
      return noError(result, 'update exact hosted configuration');
    },
    async selectOrganizationJobs(organizationId, options = {}) {
      const result = await withAbort(client.from('ecos_hosted_index_jobs').select('*')
        .eq('organization_id', organizationId).order('created_at', { ascending: true }), options);
      return noError(result, 'select organization job manifest');
    },
    async selectReferenceDocument(documentId, options = {}) {
      const result = await withAbort(
        client.from('reference_documents').select('id,document_data').eq('id', documentId),
        options,
      );
      const rows = noError(result, 'select exact reference document');
      assert(rows.length === 1, 'Expected one exact reference document');
      return rows[0];
    },
    async selectLiveSnapshot(documentId, referenceDocumentData, options = {}) {
      const pages = noError(await withAbort(client.from('ecos_hosted_document_pages').select([
        'organization_id,project_id,document_id,page_number,source_sha256,evidence_version',
        'sheet_number,sheet_title,sheet_mapping_status,page_text,regions,assurance_result,published_at',
      ].join(',')).eq('document_id', documentId).order('organization_id').order('page_number'),
      options),
      'select live hosted pages');
      const chunks = noError(await withAbort(client.from('ecos_hosted_document_chunks').select([
        'organization_id,project_id,document_id,page_number,region_id,chunk_index,chunk_text',
        'sheet_number,confidence,metadata,published_at',
      ].join(',')).eq('document_id', documentId).order('organization_id').order('page_number')
        .order('region_id').order('chunk_index'), options), 'select live hosted chunks');
      const snapshot = { pages, chunks, referenceDocumentData };
      return {
        pageCount: pages.length,
        chunkCount: chunks.length,
        sha256: sha256Json(snapshot),
        referenceDocumentData,
      };
    },
    async selectDailyVisualUsage(organizationId, nowMs, options = {}) {
      const now = new Date(nowMs);
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      const result = await withAbort(client.from('ecos_hosted_index_usage')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('event_type', 'visual_region_reserved')
        .gte('created_at', start), options);
      if (result.error) throw new Error(`select provider daily usage: ${result.error.message}`);
      return Number(result.count || 0);
    },
    async selectDailyProviderAttemptUsage(jobId, _nowMs, options = {}) {
      const result = await withAbort(client.rpc('ecos_get_drawing_provider_attempt_usage', {
        p_job_id: jobId,
      }), options);
      if (result.error) {
        throw new Error(`select daily provider-attempt usage: ${result.error.message}`);
      }
      return result.data;
    },
    async selectTargetArtifacts(jobId, expectedPageCount, options = {}) {
      const pages = noError(await withAbort(client.from('ecos_hosted_index_pages')
        .select('page_number,source_sha256,state,assurance_result,unresolved_region_count')
        .eq('job_id', jobId).order('page_number'), options), 'select target pages');
      const queueResult = await withAbort(client.from('ecos_hosted_shadow_materialization_queue')
        .select('job_id', { count: 'exact', head: true }).eq('job_id', jobId), options);
      if (queueResult.error) throw new Error(`select target materialization queue: ${queueResult.error.message}`);
      const visualExceptions = noError(await withAbort(client.from('ecos_hosted_visual_exceptions').select([
        'job_id,page_number,region_key,state,evidence_version,exception_fingerprint',
        'assurance_result,claimed_by,lease_expires_at,next_attempt_at',
      ].join(',')).eq('job_id', jobId).order('page_number').order('region_key'),
      options),
      'select target visual exceptions');
      const shadowResult = await withAbort(client.from('ecos_hosted_shadow_chunks')
        .select('job_id', { count: 'exact', head: true }).eq('job_id', jobId), options);
      if (shadowResult.error) throw new Error(`select target shadow chunks: ${shadowResult.error.message}`);
      const shadowPageCounts = [];
      if (options.includePageCounts) {
        for (let pageNumber = 1; pageNumber <= expectedPageCount; pageNumber += 1) {
          const result = await withAbort(client.from('ecos_hosted_shadow_chunks')
            .select('job_id', { count: 'exact', head: true })
            .eq('job_id', jobId).eq('page_number', pageNumber), options);
          if (result.error) throw new Error(`select target shadow page ${pageNumber}: ${result.error.message}`);
          shadowPageCounts.push({ pageNumber, count: Number(result.count || 0) });
        }
      }
      return {
        pages,
        queueCount: Number(queueResult.count || 0),
        visualExceptions,
        shadowChunkCount: Number(shadowResult.count || 0),
        shadowPageCounts,
      };
    },
  };
}

function runGcloud(args, signals, options = {}) {
  const timeoutMs = options.timeoutMs || GCLOUD_READ_TIMEOUT_MS;
  if (signals?.requestedSignal && !options.allowAfterSignal) {
    return Promise.resolve({
      error: new Error(`Interrupted by ${signals.requestedSignal}`),
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
    });
  }
  return new Promise(resolve => {
    const child = spawn('gcloud', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (options.trackSignal !== false) signals?.addChild(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let forceTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      forceTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 5_000);
    }, timeoutMs);
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (options.trackSignal !== false) signals?.removeChild(child);
      resolve({ ...result, stdout, stderr, timedOut });
    };
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-40 * 1024 * 1024); });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-40 * 1024 * 1024); });
    child.on('error', error => finish({ error, status: null, signal: null }));
    child.on('close', (status, signal) => {
      finish({ status, signal, error: null });
    });
  });
}

async function gcloudJson(args, signals, options = {}) {
  const result = await runGcloud([...args, '--format=json'], signals, options);
  if (signals?.requestedSignal && !options.allowAfterSignal) {
    throw new Error(`Interrupted by ${signals.requestedSignal}`);
  }
  assert(!result.timedOut, `gcloud ${args.slice(0, 3).join(' ')} timed out`);
  assert(!result.error, `gcloud ${args.slice(0, 3).join(' ')} failed: ${result.error?.message}`);
  assert(result.status === 0,
    `gcloud ${args.slice(0, 3).join(' ')} exited ${result.status}: ${boundedText(result.stderr)}`);
  try { return JSON.parse(result.stdout.trim()); } catch (error) {
    throw new Error(`gcloud ${args.slice(0, 3).join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function createCloudAdapter(config) {
  const listExecutions = (signals, options) => gcloudJson([
    'run', 'jobs', 'executions', 'list',
    '--job', config.cloudRunJob,
    '--region', config.gcpRegion,
    '--project', config.gcpProject,
  ], signals, options);
  const scheduler = (signals, options) => gcloudJson([
    'scheduler', 'jobs', 'describe', config.schedulerJob,
    '--location', config.gcpRegion,
    '--project', config.gcpProject,
  ], signals, options);
  const describeExecution = (name, signals, options) => gcloudJson([
    'run', 'jobs', 'executions', 'describe', name,
    '--region', config.gcpRegion,
    '--project', config.gcpProject,
  ], signals, options);
  return {
    async inspectBoundary(signals, options = {}) {
      const schedulerResult = await scheduler(signals, options);
      const job = await gcloudJson([
        'run', 'jobs', 'describe', config.cloudRunJob,
        '--region', config.gcpRegion,
        '--project', config.gcpProject,
      ], signals, options);
      assert((job?.status?.conditions || []).some(value => (
        value.type === 'Ready' && value.status === 'True'
      )), 'Cloud Run job is not Ready');
      const artifact = await gcloudJson([
        'artifacts', 'docker', 'images', 'describe', config.expectedImage,
        '--project', config.gcpProject,
      ], signals, options);
      const artifactDigest = artifact?.image_summary?.digest || artifact?.imageSummary?.digest;
      const executions = await listExecutions(signals, options);
      const executionNames = executions.map(value => value?.metadata?.name).filter(Boolean);
      return {
        schedulerState: schedulerResult.state,
        artifactDigest,
        jobProvenance: cloudRunJobProvenance(job),
        executionNames,
        activeExecutionNames: executions.filter(value => !value?.status?.completionTime)
          .map(value => value?.metadata?.name).filter(Boolean),
      };
    },
    async verifyManagedSource(locator, expectedSha256, signals) {
      assert(locator?.gcsBucket && locator?.gcsObject, 'Managed source locator is incomplete');
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vitruvius-v13-resume-'));
      try {
        const target = path.join(directory, 'source.pdf');
        const result = await runGcloud([
          'storage', 'cp', '--quiet', `gs://${locator.gcsBucket}/${locator.gcsObject}`, target,
        ], signals, { timeoutMs: GCLOUD_COPY_TIMEOUT_MS });
        assert(!signals?.requestedSignal, `Interrupted by ${signals?.requestedSignal}`);
        assert(!result.timedOut, 'Managed source download timed out');
        assert(!result.error && result.status === 0,
          `Managed source download failed: ${boundedText(result.error?.message || result.stderr)}`);
        assert(sha256(fs.readFileSync(target)) === expectedSha256,
          'Managed source bytes do not match the exact source SHA');
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    async executeExactTarget(options) {
      assert(!options.signals.requestedSignal, `Interrupted by ${options.signals.requestedSignal}`);
      const boundedOptions = maximumMs => {
        const remainingMs = Number(options.deadlineMs) - Date.now();
        assert(remainingMs > 0, 'Execution and log verification deadline exhausted');
        return { timeoutMs: Math.max(1, Math.min(maximumMs, remainingMs)) };
      };
      let monitorError = null;
      let monitorPromise = Promise.resolve();
      const monitor = setInterval(() => {
        if (monitorError || options.signals.requestedSignal) return;
        monitorPromise = monitorPromise.then(async () => {
          if ((await scheduler(options.signals, boundedOptions(GCLOUD_READ_TIMEOUT_MS))).state !== 'PAUSED') {
            throw new Error('Cloud Scheduler left PAUSED during the exact-target execution');
          }
          const active = (await listExecutions(
            options.signals,
            boundedOptions(GCLOUD_READ_TIMEOUT_MS),
          ))
            .filter(value => !value?.status?.completionTime);
          if (active.length > 1) throw new Error('More than one Cloud Run execution became active');
        }).catch(error => {
          monitorError = error;
          options.signals.request('SAFETY_BOUNDARY');
        });
      }, 5000);
      const result = await runGcloud([
        'run', 'jobs', 'execute', config.cloudRunJob,
        '--project', config.gcpProject,
        '--region', config.gcpRegion,
        '--tasks=1',
        `--task-timeout=${options.taskTimeoutSeconds}s`,
        '--update-env-vars', [
          'ECOS_MAX_JOBS_PER_RUN=1',
          `ECOS_MAX_RUN_SECONDS=${options.maxRunSeconds}`,
          `ECOS_WORKER_ID=${options.workerId}`,
          `ECOS_TARGET_JOB_ID=${options.targetJobId}`,
          `ECOS_TARGET_SOURCE_SHA256=${options.targetSourceSha256}`,
        ].join(','),
        '--wait',
        '--format=json',
      ], options.signals, {
        ...boundedOptions(options.taskTimeoutSeconds * 1000),
      });
      clearInterval(monitor);
      await monitorPromise;
      if (monitorError) throw monitorError;
      if (options.signals.requestedSignal) {
        throw new Error(`Interrupted by ${options.signals.requestedSignal}`);
      }
      assert(!result.timedOut, 'Cloud Run execution wait exceeded the exact task timeout');
      assert(!result.error, `Cloud Run execution failed to start: ${result.error?.message}`);
      assert(result.status === 0, `Cloud Run execution exited ${result.status}`);
      let record;
      try { record = JSON.parse(result.stdout.trim()); } catch (error) {
        throw new Error(`Cloud Run returned invalid JSON: ${error.message}`);
      }
      const name = record?.metadata?.name;
      assert(name, 'Cloud Run execution name is missing');
      const executionsAfter = await listExecutions(
        options.signals,
        boundedOptions(GCLOUD_READ_TIMEOUT_MS),
      );
      const newExecutionNames = executionsAfter.map(value => value?.metadata?.name).filter(Boolean)
        .filter(value => !options.priorExecutionNames.includes(value));
      assert(newExecutionNames.length === 1 && newExecutionNames[0] === name,
        'The exact target was not the only new Cloud Run execution');
      assert(executionsAfter.every(value => value?.status?.completionTime),
        'A Cloud Run execution remains active after the exact-target slice');
      const described = await describeExecution(
        name,
        options.signals,
        boundedOptions(GCLOUD_READ_TIMEOUT_MS),
      );
      const provenance = cloudRunExecutionProvenance(described);
      const filter = [
        'resource.type="cloud_run_job"',
        `resource.labels.job_name="${config.cloudRunJob}"`,
        `labels."run.googleapis.com/execution_name"="${name}"`,
      ].join(' AND ');
      let logEntries = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        logEntries = await gcloudJson([
          'logging', 'read', filter,
          '--project', config.gcpProject,
          '--limit', String(LOG_ENTRY_LIMIT),
          '--order', 'asc',
        ], options.signals, boundedOptions(GCLOUD_READ_TIMEOUT_MS));
        assert(logEntries.length < LOG_ENTRY_LIMIT,
          'Execution-scoped Cloud Logging reached its hard entry limit');
        const events = logEntries.map(entry => entry?.jsonPayload).filter(value => value?.event);
        if (events.some(value => value.event === 'ecos_hosted_index_batch_finished')) break;
        assert(!options.signals.requestedSignal,
          `Interrupted by ${options.signals.requestedSignal}`);
        const remainingMs = Number(options.deadlineMs) - Date.now();
        assert(remainingMs > 0, 'Execution and log verification deadline exhausted');
        await new Promise(resolve => setTimeout(resolve, Math.min(5000, remainingMs)));
      }
      const events = logEntries.map(entry => entry?.jsonPayload).filter(value => value?.event);
      const startedJobIds = events.filter(value => value.event === 'ecos_hosted_index_job_started')
        .map(value => value.jobId);
      const readyJobIds = events.filter(value => value.event === 'ecos_hosted_index_job_ready')
        .map(value => value.jobId);
      const batches = events.filter(value => value.event === 'ecos_hosted_index_batch_finished');
      return {
        name,
        workerId: options.workerId,
        completed: Boolean(described?.status?.completionTime)
          && (described?.status?.conditions || []).some(value => value.type === 'Completed' && value.status === 'True'),
        succeededCount: Number(described?.status?.succeededCount || 0),
        failedCount: Number(described?.status?.failedCount || 0),
        provenance,
        startedJobIds,
        readyJobIds,
        jobsProcessed: Number(batches[0]?.jobsProcessed ?? -1),
        batchFinishedCount: batches.length,
        logEntryCount: logEntries.length,
        logEntryLimit: LOG_ENTRY_LIMIT,
        logTruncated: false,
        errorLogCount: logEntries.filter(entry => (
          ['ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'].includes(entry.severity)
        )).length,
        stdoutSha256: sha256(result.stdout),
        stderrSha256: sha256(result.stderr),
      };
    },
    async cancelNewActiveExecutions(options = {}) {
      const priorExecutionNames = new Set(options.priorExecutionNames || []);
      const cleanupOptions = () => {
        const remainingMs = Math.min(
          Number(options.timeoutMs || Number.MAX_SAFE_INTEGER),
          Number(options.deadlineMs || Number.MAX_SAFE_INTEGER) - Date.now(),
        );
        assert(remainingMs > 0, 'Cleanup cancellation deadline exhausted');
        return { allowAfterSignal: true, trackSignal: false, timeoutMs: remainingMs };
      };
      const active = (await listExecutions(null, cleanupOptions())).filter(value => (
        !value?.status?.completionTime
        && !priorExecutionNames.has(value?.metadata?.name)
      )).map(value => value.metadata.name);
      const cancelled = [];
      for (const name of active) {
        const result = await runGcloud([
          'run', 'jobs', 'executions', 'cancel', name,
          '--region', config.gcpRegion,
          '--project', config.gcpProject,
          '--no-async',
          '--quiet',
        ], null, cleanupOptions());
        if (result.timedOut) throw new Error(`Cancellation timed out for ${name}`);
        if (result.error || result.status !== 0) {
          const raced = await describeExecution(name, null, cleanupOptions());
          if (!raced?.status?.completionTime) {
            throw new Error(`Cancellation failed for ${name}: ${boundedText(
              result.error?.message || result.stderr,
            )}`);
          }
        }
        const deadline = Math.min(
          Number(options.deadlineMs || Number.MAX_SAFE_INTEGER),
          Date.now() + Number(options.timeoutSeconds || config.cancelTimeoutSeconds) * 1000,
        );
        let terminal = await describeExecution(name, null, cleanupOptions());
        while (!terminal?.status?.completionTime && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, Math.min(
            Number(options.pollSeconds || 1) * 1000,
            Math.max(1, deadline - Date.now()),
          )));
          terminal = await describeExecution(name, null, cleanupOptions());
        }
        assert(terminal?.status?.completionTime, `Cancellation did not reach terminal state for ${name}`);
        cancelled.push({
          name,
          terminal: true,
          completionTime: terminal.status.completionTime,
          conditions: terminal.status.conditions || [],
        });
      }
      const remaining = (await listExecutions(null, cleanupOptions())).filter(value => (
        !value?.status?.completionTime
        && !priorExecutionNames.has(value?.metadata?.name)
      ));
      assert(remaining.length === 0, 'A new Cloud Run execution remains active after cancellation');
      return cancelled;
    },
    async ensureSchedulerPaused(options = {}) {
      const cleanupOptions = () => {
        const remainingMs = Math.min(
          Number(options.timeoutMs || GCLOUD_READ_TIMEOUT_MS),
          Number(options.deadlineMs || Number.MAX_SAFE_INTEGER) - Date.now(),
        );
        assert(remainingMs > 0, 'Cleanup Scheduler deadline exhausted');
        return { allowAfterSignal: true, trackSignal: false, timeoutMs: remainingMs };
      };
      let value = await scheduler(null, cleanupOptions());
      let repaired = false;
      if (value.state !== 'PAUSED') {
        const result = await runGcloud([
          'scheduler', 'jobs', 'pause', config.schedulerJob,
          '--location', config.gcpRegion,
          '--project', config.gcpProject,
          '--quiet',
        ], null, cleanupOptions());
        assert(!result.timedOut && !result.error && result.status === 0,
          `Cloud Scheduler pause failed: ${boundedText(result.error?.message || result.stderr)}`);
        repaired = true;
        value = await scheduler(null, cleanupOptions());
      }
      return { state: value.state, repaired };
    },
  };
}

async function main() {
  const config = parseConfiguration(process.env);
  const receipts = createReceiptWriter(config);
  const signals = createSignalController(process);
  try {
    const result = await runResumeOperator(config, {
      db: createSupabaseAdapter(config),
      cloud: createCloudAdapter(config),
      clock: { now: () => Date.now(), sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) },
      receipts,
      signals,
    });
    console.log(`ECOS hosted evidence 1.3 resume ${result.status.toUpperCase()}: ${config.targetJobId}`);
    console.log(`Evidence: ${receipts.receiptPath}`);
    console.log(`Receipt SHA-256: ${result.seal.receiptSha256}`);
  } catch (error) {
    console.error(`ECOS hosted evidence 1.3 resume FAIL: ${error.message}`);
    if (error.receiptPath) console.error(`Evidence: ${error.receiptPath}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  EVIDENCE_VERSION,
  RECEIPT_VERSION,
  assertProviderAttemptUsage,
  assertReferenceAuthority,
  assertCloudBoundary,
  assertCloudRunProvenance,
  assertOperatorIdentity,
  assertTerminalCancellations,
  assertTargetArtifacts,
  assertTargetIdentity,
  cloudRunExecutionProvenance,
  cloudRunJobProvenance,
  createCloudAdapter,
  createReceiptWriter,
  createSignalController,
  currentOperatorIdentity,
  eligibleAt,
  nonTargetManifest,
  parseConfiguration,
  runResumeOperator,
  sha256Json,
  stableJson,
  validateExecutionSlice,
  withoutReferenceAuthority,
};
