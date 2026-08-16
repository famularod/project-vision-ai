const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');

const REQUIRED_ALLOWANCE = 'single-shadow-job-only';
const EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const ACTIVE_JOB_STATES = ['fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring'];
const preflightOnly = ['1', 'true', 'yes'].includes(
  String(process.env.ECOS_V13_CANARY_PREFLIGHT_ONLY || '').trim().toLowerCase(),
);
const expectFreshAuthority = ['1', 'true', 'yes'].includes(
  String(process.env.ECOS_V13_CANARY_EXPECT_FRESH_AUTHORITY || '').trim().toLowerCase(),
);
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

const required = name => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const gcloudJson = args => JSON.parse(execFileSync('gcloud', [...args, '--format=json'], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
}));

const sha256File = filePath => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const stableJson = value => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256Json = value => crypto.createHash('sha256').update(stableJson(value)).digest('hex');

const withoutReferenceAuthority = documentData => Object.fromEntries(
  Object.entries(documentData || {}).filter(
    ([key]) => !REFERENCE_AUTHORITY_MUTATION_KEYS.includes(key),
  ),
);

const assertFreshReferenceAuthority = documentData => {
  for (const key of REFERENCE_RECEIPT_KEYS) {
    assert(documentData[key] == null, `Fresh reference document unexpectedly carries ${key}`);
  }
};

const assertExactReferenceAuthority = (documentData, expectedSha, expectedPages) => {
  assert(
    documentData.ecosVerifiedIndexCommitVersion === 'ecos-verified-index-commit/1.0',
    'Reference document commit version mismatch',
  );
  assert(
    documentData.ecosVerifiedIndexCommittedSha256 === expectedSha,
    'Reference document committed SHA mismatch',
  );
  assert(
    Number(documentData.ecosVerifiedIndexCommittedPageCount) === expectedPages,
    'Reference document committed page count mismatch',
  );
  assert(
    /^[0-9a-f]{64}$/.test(String(documentData.ecosVerifiedIndexPageGraphSha256 || '')),
    'Reference document page graph receipt is missing or malformed',
  );
  const pageGraph = documentData.extractedPages;
  assert(
    Array.isArray(pageGraph) && pageGraph.length === expectedPages,
    'Reference document page graph is missing',
  );
  assert(
    sha256Json(pageGraph) === documentData.ecosVerifiedIndexPageGraphSha256,
    'Reference document page graph digest mismatch',
  );
  const expectedPageNumbers = Array.from({ length: expectedPages }, (_, index) => index + 1);
  assert(
    pageGraph.map(page => Number(page?.pageNumber)).join(',') === expectedPageNumbers.join(','),
    'Reference document page graph identities are incomplete',
  );
  assert(pageGraph.every(page => (
    page?.assurance?.accepted === true
    && page.assurance?.evidenceVersion === EVIDENCE_VERSION
    && page?.visualCoverage?.sourceSha256 === expectedSha
    && page.visualCoverage?.evidenceVersion === EVIDENCE_VERSION
    && Number(page.visualCoverage?.pageNumber) === Number(page.pageNumber)
  )), 'Reference document page graph is not exactly assured');
};

const sameIds = (left, right) => (
  [...left].sort().join(',') === [...right].sort().join(',')
);

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const exactlyOne = (rows, message) => {
  assert(Array.isArray(rows) && rows.length === 1, message);
  return rows[0];
};

const isResetClean = row => (
  row.state === 'queued'
  && Number(row.completed_page_count) === 0
  && Number(row.assured_page_count) === 0
  && Number(row.unresolved_region_count) === 0
  && Number(row.retry_count) === 0
  && row.next_attempt_at == null
  && row.claimed_by == null
  && row.claim_token == null
  && row.lease_expires_at == null
  && row.heartbeat_at == null
  && row.committed_evidence_version == null
  && row.ready_at == null
);

const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
const allowance = required('ECOS_V13_CANARY_ALLOW_MUTATION');
assert(allowance === REQUIRED_ALLOWANCE, `ECOS_V13_CANARY_ALLOW_MUTATION must equal ${REQUIRED_ALLOWANCE}`);

const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
const expectedUrl = required('ECOS_V13_CANARY_EXPECTED_URL').replace(/\/$/, '');
assert(supabaseUrl === expectedUrl, 'Supabase URL does not match the explicitly approved canary URL');

const targetJobId = required('ECOS_V13_CANARY_JOB_ID').toLowerCase();
const targetSourceSha = required('ECOS_V13_CANARY_SOURCE_SHA256').toLowerCase();
assert(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(targetJobId),
  'ECOS_V13_CANARY_JOB_ID must be a canonical UUID',
);
assert(/^[0-9a-f]{64}$/.test(targetSourceSha), 'ECOS_V13_CANARY_SOURCE_SHA256 must be a SHA-256 checksum');
const targetDocumentId = required('ECOS_V13_CANARY_DOCUMENT_ID');
const expectedPageCount = Number(required('ECOS_V13_CANARY_EXPECTED_PAGE_COUNT'));
assert(
  Number.isInteger(expectedPageCount) && expectedPageCount > 0 && expectedPageCount <= 1000,
  'ECOS_V13_CANARY_EXPECTED_PAGE_COUNT must be an integer from 1 through 1000',
);
const canaryVisualLimit = Number(required('ECOS_V13_CANARY_VISUAL_LIMIT'));
assert(
  Number.isInteger(canaryVisualLimit) && canaryVisualLimit >= 0,
  'ECOS_V13_CANARY_VISUAL_LIMIT must be a non-negative integer',
);
const expectedImage = required('ECOS_V13_CANARY_IMAGE');
const expectedDigest = required('ECOS_V13_CANARY_IMAGE_DIGEST');
const gcpProject = required('ECOS_GCP_PROJECT');
const gcpRegion = required('ECOS_GCP_REGION');
const cloudRunJob = required('ECOS_GCP_JOB');
const schedulerJob = required('ECOS_GCP_SCHEDULER');
const organizationId = required('ECOS_V13_CANARY_ORGANIZATION_ID');

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const auditDirectory = path.resolve(__dirname, '../validation/output');
fs.mkdirSync(auditDirectory, { recursive: true });
const auditPath = path.join(auditDirectory, `ecos-hosted-v13-canary-${runId}.json`);
const audit = {
  runId,
  startedAt: new Date().toISOString(),
  target: {
    jobId: targetJobId,
    documentId: targetDocumentId,
    sourceSha256: targetSourceSha,
    expectedPageCount,
    visualRegionLimit: canaryVisualLimit,
  },
  cloud: {},
  preflight: {},
  execution: {},
  cleanup: {},
  postconditions: {},
  status: 'preflight',
};

const saveAudit = () => {
  fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(auditPath, 0o600);
};

const selectCounts = async documentId => {
  const pageResult = await supabase
    .from('ecos_hosted_document_pages')
    .select('document_id', { count: 'exact', head: true })
    .eq('document_id', documentId);
  if (pageResult.error) throw pageResult.error;
  const chunkResult = await supabase
    .from('ecos_hosted_document_chunks')
    .select('document_id', { count: 'exact', head: true })
    .eq('document_id', documentId);
  if (chunkResult.error) throw chunkResult.error;
  return { pages: pageResult.count || 0, chunks: chunkResult.count || 0 };
};

const selectLiveSnapshot = async (documentId, referenceDocumentData) => {
  const pagesResult = await supabase
    .from('ecos_hosted_document_pages')
    .select([
      'organization_id,project_id,document_id,page_number,source_sha256,evidence_version',
      'sheet_number,sheet_title,sheet_mapping_status,page_text,regions,assurance_result,published_at',
    ].join(','))
    .eq('document_id', documentId)
    .order('organization_id', { ascending: true })
    .order('page_number', { ascending: true });
  if (pagesResult.error) throw pagesResult.error;
  const chunksResult = await supabase
    .from('ecos_hosted_document_chunks')
    .select([
      'organization_id,project_id,document_id,page_number,region_id,chunk_index,chunk_text',
      'sheet_number,confidence,metadata,published_at',
    ].join(','))
    .eq('document_id', documentId)
    .order('organization_id', { ascending: true })
    .order('page_number', { ascending: true })
    .order('region_id', { ascending: true })
    .order('chunk_index', { ascending: true });
  if (chunksResult.error) throw chunksResult.error;
  const snapshot = {
    pages: pagesResult.data,
    chunks: chunksResult.data,
    referenceDocumentData: withoutReferenceAuthority(referenceDocumentData),
  };
  return {
    pageCount: pagesResult.data.length,
    chunkCount: chunksResult.data.length,
    sha256: sha256Json(snapshot),
  };
};

const selectConfigurations = async () => {
  const result = await supabase
    .from('ecos_hosted_index_configuration')
    .select('organization_id,publication_mode,enabled,max_concurrent_jobs,daily_visual_region_limit')
    .order('organization_id', { ascending: true });
  if (result.error) throw result.error;
  return result.data;
};

const assertGlobalConfigurationIsolation = (configurations, expectedTarget) => {
  const targetConfig = exactlyOne(
    configurations.filter(row => row.organization_id === organizationId),
    'Expected one hosted-index configuration row for the canary organization',
  );
  assert(
    configurations.every(row => row.organization_id === organizationId || row.enabled === false),
    'Another organization is enabled and could win the global claim ordering',
  );
  if (expectedTarget) {
    assert(targetConfig.enabled === expectedTarget.enabled, 'Canary configuration enabled state drifted');
    assert(targetConfig.publication_mode === expectedTarget.publication_mode, 'Canary publication mode drifted');
    assert(targetConfig.max_concurrent_jobs === expectedTarget.max_concurrent_jobs, 'Canary concurrency drifted');
    assert(
      targetConfig.daily_visual_region_limit === expectedTarget.daily_visual_region_limit,
      'Canary visual limit drifted',
    );
  }
  return targetConfig;
};

const selectOrganizationJobs = async () => {
  const result = await supabase
    .from('ecos_hosted_index_jobs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true });
  if (result.error) throw result.error;
  return result.data;
};

const exactTargetEvidenceVersion = row => {
  const freshResetMarker = String(row.failure_diagnostics?.targetEvidenceVersion || '').trim();
  return freshResetMarker || String(row.target_evidence_version || '').trim();
};

const isExactTargetClaimEligible = (row, configuration, organizationJobs, nowMs) => {
  const leaseMs = row.lease_expires_at == null ? null : Date.parse(row.lease_expires_at);
  let stateEligible = false;
  if (row.state === 'queued' || row.state === 'temporarily_unavailable') {
    const nextAttemptMs = row.next_attempt_at == null ? nowMs : Date.parse(row.next_attempt_at);
    stateEligible = nextAttemptMs <= nowMs && (leaseMs == null || leaseMs < nowMs);
  } else {
    stateEligible = ACTIVE_JOB_STATES.includes(row.state) && leaseMs != null && leaseMs < nowMs;
  }
  const activeOrganizationJobs = organizationJobs.filter(candidate => (
    candidate.id !== row.id
    && ACTIVE_JOB_STATES.includes(candidate.state)
    && candidate.lease_expires_at != null
    && Date.parse(candidate.lease_expires_at) >= nowMs
  )).length;
  return (
    row.id === targetJobId
    && row.source_sha256 === targetSourceSha
    && row.mode === 'shadow'
    && row.committed_evidence_version == null
    && exactTargetEvidenceVersion(row) === EVIDENCE_VERSION
    && configuration.organization_id === organizationId
    && configuration.enabled === true
    && configuration.publication_mode === 'shadow'
    && stateEligible
    && Number(row.retry_count) < Number(row.max_retry_count)
    && activeOrganizationJobs < Number(configuration.max_concurrent_jobs)
  );
};

const verifyNonTargetManifest = (currentRows, baselineRows, context) => {
  assert(currentRows.length === 23, `${context}: expected the frozen 23-job manifest`);
  assert(
    sameIds(currentRows.map(row => row.id), baselineRows.map(row => row.id)),
    `${context}: a job was added, removed, or replaced`,
  );
  const currentNonTarget = currentRows
    .filter(row => row.id !== targetJobId)
    .sort((left, right) => left.id.localeCompare(right.id));
  const baselineNonTarget = baselineRows
    .filter(row => row.id !== targetJobId)
    .sort((left, right) => left.id.localeCompare(right.id));
  assert(currentNonTarget.length === 22, `${context}: expected exactly 22 non-target jobs`);
  assert(baselineNonTarget.length === 22, `${context}: baseline does not contain 22 non-target jobs`);
  const currentSha256 = sha256Json(currentNonTarget);
  const baselineSha256 = sha256Json(baselineNonTarget);
  assert(currentSha256 === baselineSha256, `${context}: a non-target job changed`);
  return {
    count: currentNonTarget.length,
    sha256: currentSha256,
  };
};

const describeExecution = name => gcloudJson([
  'run', 'jobs', 'executions', 'describe', name,
  '--region', gcpRegion,
  '--project', gcpProject,
]);

const assertSuccessfulExecution = execution => {
  assert(execution?.metadata?.name, 'Cloud Run execution description is missing its name');
  assert(execution?.status?.completionTime, 'Cloud Run execution has no completion time');
  assert(
    (execution?.status?.conditions || []).some(condition => (
      condition.type === 'Completed' && condition.status === 'True'
    )),
    'Cloud Run execution did not report Completed=True',
  );
  assert(Number(execution?.status?.succeededCount) === 1, 'Cloud Run execution did not succeed exactly once');
  assert(Number(execution?.status?.failedCount || 0) === 0, 'Cloud Run execution reported a failed task');
  assert(Number(execution?.spec?.taskCount) === 1, 'Cloud Run execution did not use exactly one task');
  const environment = execution?.spec?.template?.spec?.containers?.[0]?.env || [];
  const maxJobs = environment.find(value => value.name === 'ECOS_MAX_JOBS_PER_RUN')?.value;
  const exactJobId = environment.find(value => value.name === 'ECOS_TARGET_JOB_ID')?.value;
  const exactSourceSha = environment.find(value => value.name === 'ECOS_TARGET_SOURCE_SHA256')?.value;
  assert(maxJobs === '1', 'Cloud Run execution did not preserve the one-job override');
  assert(exactJobId === targetJobId, 'Cloud Run execution did not preserve the exact target job override');
  assert(
    exactSourceSha === targetSourceSha,
    'Cloud Run execution did not preserve the exact target source checksum override',
  );
  return execution;
};

const readExecutionLogs = async executionName => {
  const filter = [
    'resource.type="cloud_run_job"',
    `resource.labels.job_name="${cloudRunJob}"`,
    `labels."run.googleapis.com/execution_name"="${executionName}"`,
  ].join(' AND ');
  let entries = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    entries = gcloudJson([
      'logging', 'read', filter,
      '--project', gcpProject,
      '--limit', '500',
      '--order', 'asc',
    ]);
    const events = entries.map(entry => entry?.jsonPayload).filter(value => value?.event);
    if (events.some(value => value.event === 'ecos_hosted_index_batch_finished')) break;
    await sleep(5000);
  }
  const events = entries.map(entry => entry?.jsonPayload).filter(value => value?.event);
  const started = events.filter(value => value.event === 'ecos_hosted_index_job_started');
  const ready = events.filter(value => value.event === 'ecos_hosted_index_job_ready');
  const batches = events.filter(value => value.event === 'ecos_hosted_index_batch_finished');
  const errors = entries.filter(entry => ['ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'].includes(entry.severity));
  assert(started.length === 1 && started[0].jobId === targetJobId, 'Execution did not start only the canary job');
  assert(ready.length === 1 && ready[0].jobId === targetJobId, 'Execution did not ready only the canary job');
  assert(batches.length === 1 && Number(batches[0].jobsProcessed) === 1, 'Execution did not process exactly one job');
  assert(errors.length === 0, 'Execution-scoped Cloud Logging contains errors');
  return { events, errorCount: errors.length };
};

const verifySchedulerAndImage = () => {
  const scheduler = gcloudJson([
    'scheduler', 'jobs', 'describe', schedulerJob,
    '--location', gcpRegion,
    '--project', gcpProject,
  ]);
  assert(scheduler.state === 'PAUSED', 'Cloud Scheduler must remain PAUSED');
  const job = gcloudJson([
    'run', 'jobs', 'describe', cloudRunJob,
    '--region', gcpRegion,
    '--project', gcpProject,
  ]);
  const configuredImage = job?.spec?.template?.spec?.template?.spec?.containers?.[0]?.image;
  assert(configuredImage === expectedImage, `Cloud Run image mismatch: ${configuredImage || 'missing'}`);
  const ready = (job?.status?.conditions || []).some(condition => (
    condition.type === 'Ready' && condition.status === 'True'
  ));
  assert(ready, 'Cloud Run job is not Ready');
  const artifact = gcloudJson([
    'artifacts', 'docker', 'images', 'describe', expectedImage,
    '--project', gcpProject,
  ]);
  const artifactDigest = artifact?.image_summary?.digest || artifact?.imageSummary?.digest;
  assert(artifactDigest === expectedDigest, `Artifact digest mismatch: ${artifactDigest || 'missing'}`);
  const executions = gcloudJson([
    'run', 'jobs', 'executions', 'list',
    '--job', cloudRunJob,
    '--region', gcpRegion,
    '--project', gcpProject,
  ]);
  const active = executions.filter(execution => !execution?.status?.completionTime);
  assert(active.length === 0, 'A Cloud Run execution is already active');
  return {
    schedulerState: scheduler.state,
    image: configuredImage,
    digest: artifactDigest,
    generation: job?.metadata?.generation,
    priorExecutionNames: executions.map(execution => execution?.metadata?.name).filter(Boolean),
  };
};

let baselineConfig;
let baselineJobManifest = [];
let executionName;

const disableConfiguration = async () => {
  let mutationError;
  try {
    const result = await supabase
      .from('ecos_hosted_index_configuration')
      .update({ enabled: false })
      .eq('organization_id', organizationId)
      .select('organization_id');
    if (result.error) mutationError = result.error;
  } catch (error) {
    mutationError = error;
  }
  const configurations = await selectConfigurations();
  const row = exactlyOne(
    configurations.filter(value => value.organization_id === organizationId),
    'Failed to re-read the exact canary organization after emergency disable',
  );
  assert(row.enabled === false, 'Canary organization did not become disabled');
  return {
    row,
    reconciledAfterMutationError: mutationError ? mutationError.message : null,
  };
};

const restoreConfiguration = async () => {
  if (!baselineConfig) return null;
  let mutationError;
  try {
    const result = await supabase
      .from('ecos_hosted_index_configuration')
      .update({
        enabled: false,
        publication_mode: baselineConfig.publication_mode,
        max_concurrent_jobs: baselineConfig.max_concurrent_jobs,
        daily_visual_region_limit: baselineConfig.daily_visual_region_limit,
      })
      .eq('organization_id', organizationId)
      .eq('enabled', false)
      .select('organization_id');
    if (result.error) mutationError = result.error;
  } catch (error) {
    mutationError = error;
  }
  const configurations = await selectConfigurations();
  const row = assertGlobalConfigurationIsolation(configurations, baselineConfig);
  return {
    row,
    reconciledAfterMutationError: mutationError ? mutationError.message : null,
  };
};

async function main() {
  saveAudit();
  audit.cloud = verifySchedulerAndImage();

  const baselineConfigurations = await selectConfigurations();
  baselineConfig = assertGlobalConfigurationIsolation(baselineConfigurations);
  assert(baselineConfig.enabled === false, 'Hosted indexing must be disabled before the canary');
  assert(baselineConfig.publication_mode === 'shadow', 'Canary must remain shadow-only');
  assert(
    canaryVisualLimit <= Number(baselineConfig.daily_visual_region_limit),
    'Canary visual limit must not exceed the disabled baseline visual limit',
  );

  const jobManifest = await selectOrganizationJobs();
  assert(jobManifest.length === 23, `Expected the frozen 23-job manifest, found ${jobManifest.length}`);
  assert(jobManifest.every(row => row.mode === 'shadow'), 'Every canary-organization job must be shadow-only');
  baselineJobManifest = jobManifest;
  const target = exactlyOne(
    jobManifest.filter(row => row.id === targetJobId),
    'Exact canary job was not found',
  );
  assert(isResetClean(target), 'Exact canary target must match the clean evidence-1.3 reset predicate');
  assert(target.document_id === targetDocumentId, 'Canary document identity mismatch');
  assert(target.source_sha256 === targetSourceSha, 'Canary source SHA mismatch');
  assert(
    Number(target.source_page_count) === expectedPageCount,
    `Canary source must contain exactly ${expectedPageCount} pages`,
  );
  assert(
    exactTargetEvidenceVersion(target) === EVIDENCE_VERSION,
    'Canary target does not carry the exact evidence-1.3 reset marker',
  );
  const baselineNonTargetManifest = verifyNonTargetManifest(
    jobManifest,
    baselineJobManifest,
    'Preflight',
  );

  const referenceResult = await supabase
    .from('reference_documents')
    .select('id,document_data')
    .eq('id', targetDocumentId);
  if (referenceResult.error) throw referenceResult.error;
  const reference = exactlyOne(referenceResult.data, 'Canary reference document was not found');
  const documentData = reference.document_data || {};
  for (const field of ['contentSha256', 'webFileFingerprint', 'indexedContentSha256']) {
    assert(documentData[field] === targetSourceSha, `Reference document ${field} mismatch`);
  }
  if (expectFreshAuthority) {
    assertFreshReferenceAuthority(documentData);
  } else {
    assertExactReferenceAuthority(documentData, targetSourceSha, expectedPageCount);
  }
  assert(documentData.isCurrent === true, 'Canary document is not current');
  assert(documentData.drawingStatus === 'For Construction', 'Canary document is not For Construction');
  assert(String(documentData.drawingRevision) === '1', 'Canary drawing revision mismatch');
  assert(
    Number(documentData.sourcePageCount) === expectedPageCount,
    'Reference document source page count mismatch',
  );

  const locator = target.source_locator || {};
  assert(target.source_provider === 'managed_upload', 'Canary must use the managed source copy');
  assert(locator.gcsBucket && locator.gcsObject, 'Canary managed source locator is incomplete');
  const sourceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vitruvius-v13-canary-'));
  try {
    const sourcePath = path.join(sourceDirectory, 'source.pdf');
    execFileSync('gcloud', [
      'storage', 'cp', `gs://${locator.gcsBucket}/${locator.gcsObject}`, sourcePath,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    assert(sha256File(sourcePath) === targetSourceSha, 'Managed canary source bytes do not match the recorded SHA');
  } finally {
    fs.rmSync(sourceDirectory, { recursive: true, force: true });
  }

  for (const table of [
    'ecos_hosted_index_pages',
    'ecos_hosted_shadow_chunks',
    'ecos_hosted_visual_exceptions',
    'ecos_hosted_shadow_materialization_queue',
  ]) {
    const result = await supabase.from(table).select('job_id', { count: 'exact', head: true }).eq('job_id', targetJobId);
    if (result.error) throw result.error;
    assert((result.count || 0) === 0, `${table} is not clean for the canary job`);
  }
  const liveCountsBefore = await selectCounts(targetDocumentId);
  const liveSnapshotBefore = await selectLiveSnapshot(targetDocumentId, documentData);
  audit.preflight = {
    expectFreshAuthority,
    configuration: baselineConfig,
    allConfigurations: baselineConfigurations,
    jobManifest,
    nonTargetManifest: baselineNonTargetManifest,
    reference: {
      id: reference.id,
      name: documentData.name,
      projectName: documentData.projectName,
      drawingRevision: documentData.drawingRevision,
      drawingStatus: documentData.drawingStatus,
      sourcePageCount: documentData.sourcePageCount,
    },
    liveCountsBefore,
    liveSnapshotBefore,
  };
  audit.status = 'exact_target_ready';
  saveAudit();
  if (preflightOnly) {
    audit.status = 'preflight_pass';
    audit.finishedAt = new Date().toISOString();
    saveAudit();
    console.log(`ECOS hosted evidence 1.3 canary preflight PASS: ${targetJobId}`);
    console.log(`Evidence: ${auditPath}`);
    return;
  }

  let operationError;
  try {
    const enableResult = await supabase
      .from('ecos_hosted_index_configuration')
      .update({
        enabled: true,
        publication_mode: 'shadow',
        max_concurrent_jobs: 1,
        daily_visual_region_limit: canaryVisualLimit,
      })
      .eq('organization_id', organizationId)
      .eq('enabled', false)
      .eq('publication_mode', 'shadow')
      .eq('max_concurrent_jobs', baselineConfig.max_concurrent_jobs)
      .eq('daily_visual_region_limit', baselineConfig.daily_visual_region_limit)
      .select('organization_id');
    if (enableResult.error) throw enableResult.error;
    exactlyOne(enableResult.data, 'Failed to enable the exact contained canary configuration');

    const enabledConfigurations = await selectConfigurations();
    const enabledConfig = assertGlobalConfigurationIsolation(enabledConfigurations, {
      ...baselineConfig,
      enabled: true,
      publication_mode: 'shadow',
      max_concurrent_jobs: 1,
      daily_visual_region_limit: canaryVisualLimit,
    });

    const claimManifest = await selectOrganizationJobs();
    const preExecutionNonTargetManifest = verifyNonTargetManifest(
      claimManifest,
      baselineJobManifest,
      'Pre-execution',
    );
    assert(claimManifest.every(row => row.mode === 'shadow'), 'Every canary-organization job must remain shadow-only');
    const claimTarget = exactlyOne(
      claimManifest.filter(row => row.id === targetJobId),
      'Exact canary target disappeared before execution',
    );
    assert(
      isExactTargetClaimEligible(claimTarget, enabledConfig, claimManifest, Date.now()),
      'The exact canary job is not eligible for the exact-target claim RPC',
    );
    audit.preExecution = {
      configuration: enabledConfig,
      exactTargetJobId: claimTarget.id,
      exactTargetSourceSha256: claimTarget.source_sha256,
      nonTargetManifest: preExecutionNonTargetManifest,
      cloud: verifySchedulerAndImage(),
    };
    assert(
      sameIds(audit.preExecution.cloud.priorExecutionNames, audit.cloud.priorExecutionNames),
      'A concurrent Cloud Run execution appeared during canary isolation',
    );

    audit.status = 'executing';
    saveAudit();
    const workerId = `ecos-v13-canary-${runId}`;
    const execution = spawnSync('gcloud', [
      'run', 'jobs', 'execute', cloudRunJob,
      '--project', gcpProject,
      '--region', gcpRegion,
      '--tasks=1',
      '--task-timeout=30m',
      '--update-env-vars', [
        'ECOS_MAX_JOBS_PER_RUN=1',
        'ECOS_MAX_RUN_SECONDS=1500',
        `ECOS_WORKER_ID=${workerId}`,
        `ECOS_TARGET_JOB_ID=${targetJobId}`,
        `ECOS_TARGET_SOURCE_SHA256=${targetSourceSha}`,
      ].join(','),
      '--wait',
      '--format=json',
    ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    audit.execution.stdout = String(execution.stdout || '').slice(-20000);
    audit.execution.stderr = String(execution.stderr || '').slice(-20000);
    audit.execution.exitCode = execution.status;
    assert(!execution.error, `Cloud Run execution failed to start: ${execution.error?.message}`);
    assert(execution.status === 0, `Cloud Run execution exited ${execution.status}`);
    let executionRecord;
    try {
      executionRecord = JSON.parse(String(execution.stdout || '').trim());
    } catch (error) {
      throw new Error(`Cloud Run returned invalid JSON: ${error.message}`);
    }
    executionName = executionRecord?.metadata?.name;
    assert(executionName, 'Cloud Run did not return an execution name');
    const describedExecution = assertSuccessfulExecution(describeExecution(executionName));
    audit.execution.name = executionName;
    audit.execution.status = describedExecution.status;
    audit.execution.taskCount = describedExecution.spec?.taskCount;
  } catch (error) {
    operationError = error;
  } finally {
    audit.status = 'cleaning_up';
    const cleanupErrors = [];
    try {
      saveAudit();
    } catch (error) {
      cleanupErrors.push(`write cleanup-start audit: ${error.message}`);
    }
    let disableConfirmed = false;
    try {
      audit.cleanup.disabled = await disableConfiguration();
      disableConfirmed = true;
    } catch (error) {
      cleanupErrors.push(`disable configuration: ${error.message}`);
    }
    if (disableConfirmed) {
      try {
        audit.cleanup.configuration = await restoreConfiguration();
      } catch (error) {
        cleanupErrors.push(`restore configuration: ${error.message}`);
      }
    } else {
      audit.cleanup.restorationSkipped = 'Configuration disable could not be confirmed; baseline configuration restoration was skipped.';
    }
    try {
      const cleanupManifest = await selectOrganizationJobs();
      audit.cleanup.nonTargetManifest = verifyNonTargetManifest(
        cleanupManifest,
        baselineJobManifest,
        'Cleanup',
      );
    } catch (error) {
      cleanupErrors.push(`verify non-target jobs: ${error.message}`);
    }
    audit.cleanup.errors = cleanupErrors;
    audit.cleanup.completedAt = new Date().toISOString();
    try {
      saveAudit();
    } catch (error) {
      cleanupErrors.push(`write cleanup-complete audit: ${error.message}`);
    }
    if (cleanupErrors.length > 0) {
      const primary = operationError ? `; operation error: ${operationError.message}` : '';
      operationError = new Error(`Canary cleanup failed: ${cleanupErrors.join('; ')}${primary}`);
    }
  }
  if (operationError) throw operationError;

  const schedulerAfter = verifySchedulerAndImage();
  const configAfter = assertGlobalConfigurationIsolation(await selectConfigurations(), baselineConfig);
  const newExecutionNames = schedulerAfter.priorExecutionNames.filter(
    name => !audit.cloud.priorExecutionNames.includes(name),
  );
  assert(
    newExecutionNames.length === 1 && newExecutionNames[0] === executionName,
    'The canary was not the only new Cloud Run execution',
  );
  const executionLogs = await readExecutionLogs(executionName);

  const targetAfterResult = await supabase
    .from('ecos_hosted_index_jobs')
    .select('*')
    .eq('id', targetJobId);
  if (targetAfterResult.error) throw targetAfterResult.error;
  const targetAfter = exactlyOne(targetAfterResult.data, 'Canary job missing after execution');
  assert(targetAfter.state === 'ready', `Canary job is ${targetAfter.state}, not ready`);
  assert(targetAfter.organization_id === organizationId, 'Canary organization identity changed');
  assert(targetAfter.document_id === targetDocumentId, 'Canary document identity changed');
  assert(targetAfter.mode === 'shadow', 'Canary left shadow mode');
  assert(targetAfter.source_sha256 === targetSourceSha, 'Canary source SHA changed');
  assert(targetAfter.committed_evidence_version === EVIDENCE_VERSION, 'Canary committed evidence version mismatch');
  assert(targetAfter.source_scan_status === 'clean', 'Canary source scan did not pass');
  assert(
    Number(targetAfter.completed_page_count) === expectedPageCount,
    `Canary did not complete ${expectedPageCount} pages`,
  );
  assert(
    Number(targetAfter.assured_page_count) === expectedPageCount,
    `Canary did not assure ${expectedPageCount} pages`,
  );
  assert(Number(targetAfter.unresolved_region_count) === 0, 'Canary has unresolved visual regions');
  assert(targetAfter.claimed_by == null && targetAfter.claim_token == null, 'Canary claim was not released');
  assert(targetAfter.lease_expires_at == null, 'Canary lease was not released');

  const pagesResult = await supabase
    .from('ecos_hosted_index_pages')
    .select('page_number,source_sha256,state,assurance_result,unresolved_region_count')
    .eq('job_id', targetJobId)
    .order('page_number', { ascending: true });
  if (pagesResult.error) throw pagesResult.error;
  const expectedPageNumbers = Array.from({ length: expectedPageCount }, (_, index) => index + 1);
  assert(
    pagesResult.data.length === expectedPageCount,
    `Expected ${expectedPageCount} canary pages, found ${pagesResult.data.length}`,
  );
  assert(
    pagesResult.data.map(row => row.page_number).join(',') === expectedPageNumbers.join(','),
    'Canary page identities are incomplete',
  );
  assert(pagesResult.data.every(row => (
    row.source_sha256 === targetSourceSha
    && row.state === 'assured'
    && row.assurance_result?.accepted === true
    && Number(row.unresolved_region_count) === 0
  )), 'A canary page failed Assurance or source binding');

  const queueResult = await supabase
    .from('ecos_hosted_shadow_materialization_queue')
    .select('job_id', { count: 'exact', head: true })
    .eq('job_id', targetJobId);
  if (queueResult.error) throw queueResult.error;
  assert((queueResult.count || 0) === 0, 'Canary materialization queue is not empty');
  const visualResult = await supabase
    .from('ecos_hosted_visual_exceptions')
    .select([
      'job_id',
      'page_number',
      'region_key',
      'state',
      'evidence_version',
      'exception_fingerprint',
      'assurance_result',
      'claimed_by',
      'lease_expires_at',
      'next_attempt_at',
    ].join(','))
    .eq('job_id', targetJobId);
  if (visualResult.error) throw visualResult.error;
  assert(visualResult.data.every(row => (
    row.job_id === targetJobId
    && expectedPageNumbers.includes(Number(row.page_number))
    && String(row.region_key || '').trim().length > 0
    && row.state === 'resolved'
    && row.evidence_version === EVIDENCE_VERSION
    && /^[a-f0-9]{64}$/.test(String(row.exception_fingerprint || ''))
    && row.assurance_result?.accepted === true
    && row.assurance_result?.evidenceVersion === EVIDENCE_VERSION
    && row.assurance_result?.exceptionFingerprint === row.exception_fingerprint
    && row.claimed_by == null
    && row.lease_expires_at == null
    && row.next_attempt_at == null
  )), 'Canary contains an unresolved or unbound visual exception');
  const shadowResult = await supabase
    .from('ecos_hosted_shadow_chunks')
    .select('job_id', { count: 'exact', head: true })
    .eq('job_id', targetJobId);
  if (shadowResult.error) throw shadowResult.error;
  assert((shadowResult.count || 0) > 0, 'Canary produced no shadow search chunks');
  const shadowPageCounts = [];
  for (const pageNumber of expectedPageNumbers) {
    const result = await supabase
      .from('ecos_hosted_shadow_chunks')
      .select('job_id', { count: 'exact', head: true })
      .eq('job_id', targetJobId)
      .eq('page_number', pageNumber);
    if (result.error) throw result.error;
    shadowPageCounts.push({ pageNumber, count: result.count || 0 });
  }
  assert(
    shadowPageCounts.every(value => value.count > 0),
    'Canary shadow chunks do not cover every expected page',
  );
  const liveCountsAfter = await selectCounts(targetDocumentId);
  const referenceAfterResult = await supabase
    .from('reference_documents')
    .select('document_data')
    .eq('id', targetDocumentId);
  if (referenceAfterResult.error) throw referenceAfterResult.error;
  const referenceAfter = exactlyOne(referenceAfterResult.data, 'Canary reference document disappeared');
  assertExactReferenceAuthority(referenceAfter.document_data || {}, targetSourceSha, expectedPageCount);
  const liveSnapshotAfter = await selectLiveSnapshot(targetDocumentId, referenceAfter.document_data || {});
  assert(
    JSON.stringify(liveCountsAfter) === JSON.stringify(audit.preflight.liveCountsBefore),
    'Shadow canary changed customer-facing hosted document evidence',
  );
  assert(
    liveSnapshotAfter.sha256 === audit.preflight.liveSnapshotBefore.sha256,
    'Shadow canary changed customer-facing evidence content or reference metadata',
  );

  const finalManifest = await selectOrganizationJobs();
  const finalNonTargetManifest = verifyNonTargetManifest(
    finalManifest,
    baselineJobManifest,
    'Postcondition',
  );

  audit.postconditions = {
    scheduler: schedulerAfter,
    configuration: configAfter,
    executionLogs,
    target: targetAfter,
    pages: pagesResult.data,
    shadowChunkCount: shadowResult.count,
    shadowPageCounts,
    resolvedVisualExceptionCount: visualResult.data.length,
    liveCountsAfter,
    liveSnapshotAfter,
    nonTargetManifest: finalNonTargetManifest,
  };
  audit.status = 'pass';
  audit.finishedAt = new Date().toISOString();
  saveAudit();
  console.log(`ECOS hosted evidence 1.3 canary PASS: ${targetJobId}`);
  console.log(`Execution: ${executionName}`);
  console.log(`Evidence: ${auditPath}`);
}

main().catch(error => {
  audit.status = 'failed';
  audit.failure = { name: error.name, message: error.message };
  audit.finishedAt = new Date().toISOString();
  try { saveAudit(); } catch {}
  console.error(`ECOS hosted evidence 1.3 canary FAIL: ${error.message}`);
  console.error(`Evidence: ${auditPath}`);
  process.exitCode = 1;
});
