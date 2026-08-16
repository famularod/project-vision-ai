#!/usr/bin/env node

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const {
  buildShadowIdentitySnapshot,
  verifyThreeCycleLedger,
} = require('./ecos-ask-shadow-three-cycle-operator');
const {
  assert,
  assertCleanOperatorIdentity,
  canonicalSha256,
  canonicalUuid,
  exactText,
  operatorIdentity,
  readSealedReceipt,
  repoRoot,
  repositoryPath,
  sealObject,
  sha256,
  sha256Json,
  verifySealedObject,
  writeJsonAtomic,
} = require('./ecos-operator-seal-lib');

const RECEIPT_SCHEMA_VERSION = 'ecos-hosted-publication-transition/1.0';
const PRODUCTION_HOST = 'xdytqlpsqsseoeuxgzre.supabase.co';
const PRODUCTION_URL = `https://${PRODUCTION_HOST}`;
const PROMOTE_ALLOWANCE = 'single-organization-shadow-to-live';
const ROLLBACK_ALLOWANCE = 'single-organization-live-to-shadow';
const ACTIVE_JOB_STATES = new Set([
  'fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring',
]);

function enabled(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function configCore(row) {
  return {
    organization_id: row?.organization_id,
    publication_mode: row?.publication_mode,
    enabled: row?.enabled,
    max_concurrent_jobs: Number(row?.max_concurrent_jobs),
    daily_visual_region_limit: Number(row?.daily_visual_region_limit),
    updated_by: row?.updated_by ?? null,
    updated_at: row?.updated_at,
  };
}

function exactTargetConfiguration(configurations, organizationId) {
  assert(Array.isArray(configurations), 'Hosted configuration inventory is missing');
  const matches = configurations.filter(row => row?.organization_id === organizationId);
  assert(matches.length === 1, 'Expected exactly one target organization configuration');
  const row = configCore(matches[0]);
  assert(['shadow', 'live'].includes(row.publication_mode), 'Target publication mode is invalid');
  assert(typeof row.enabled === 'boolean', 'Target enabled state is invalid');
  assert(Number.isInteger(row.max_concurrent_jobs) && row.max_concurrent_jobs >= 1 && row.max_concurrent_jobs <= 8,
    'Target concurrency is invalid');
  assert(Number.isInteger(row.daily_visual_region_limit) && row.daily_visual_region_limit >= 0,
    'Target visual limit is invalid');
  assert(Number.isFinite(Date.parse(row.updated_at || '')), 'Target configuration update time is invalid');
  if (row.updated_by != null) canonicalUuid(row.updated_by, 'Target configuration updated_by');
  return row;
}

function nonTargetConfigurationSeal(configurations, organizationId) {
  const rows = configurations.filter(row => row?.organization_id !== organizationId)
    .map(configCore);
  assert(rows.every(row => typeof row.organization_id === 'string' && row.organization_id),
    'Non-target configuration identity is malformed');
  rows.sort((left, right) => left.organization_id.localeCompare(right.organization_id));
  return { count: rows.length, sha256: sha256Json(rows) };
}

function currentIdentityFromLedger(ledger, rawState) {
  const expected = ledger.cycles.at(-1).identity;
  const results = [{
    key: 'sealed-ledger',
    checkedDocuments: expected.documents.map(document => ({
      id: document.id,
      projectId: document.projectId,
      revision: document.revision,
      sourceSha256: document.sourceSha256,
      sourcePageCount: document.sourcePageCount,
    })),
  }];
  const current = buildShadowIdentitySnapshot(results, rawState, ledger.organizationId);
  assert(current.identitySha256 === expected.identitySha256,
    'Current job/document readiness identity does not match the three-cycle ledger');
  return { ...current, sealSha256: current.identitySha256, matchesLedger: true };
}

function historicalIdentitySnapshot(ledger, rawState) {
  const rawStateSha256 = sha256Json(rawState);
  let matchesLedger = false;
  let exactIdentitySha256 = null;
  try {
    const exact = currentIdentityFromLedger(ledger, rawState);
    matchesLedger = true;
    exactIdentitySha256 = exact.identitySha256;
  } catch {
    // Rollback must remain available after legitimate document or job drift.
    // The receipt still seals the complete current raw identity state.
  }
  return {
    historicalLedgerIdentitySha256: ledger.baselineIdentitySha256,
    currentRawStateSha256: rawStateSha256,
    exactIdentitySha256,
    matchesLedger,
    sealSha256: rawStateSha256,
  };
}

function assertJobManifestSafe(jobs, organizationId, options = {}) {
  assert(Array.isArray(jobs) && jobs.length > 0, 'Target organization job inventory is empty');
  assert(jobs.every(job => job?.organization_id === organizationId),
    'Job manifest contains another organization');
  assert(jobs.every(job => !ACTIVE_JOB_STATES.has(job?.state)),
    'A target organization database job is actively processing');
  assert(jobs.every(job => job?.claimed_by == null && job?.claim_token == null && job?.lease_expires_at == null),
    'A target organization database job still has a claim');
  if (options.requireReady) {
    assert(jobs.length === options.expectedJobCount,
      `Expected ${options.expectedJobCount} target organization jobs, found ${jobs.length}`);
    assert(jobs.every(job => (
      job?.mode === 'shadow' &&
      job?.state === 'ready' &&
      job?.committed_evidence_version === 'ecos-hosted-evidence/1.3' &&
      Number.isInteger(Number(job?.source_page_count)) && Number(job.source_page_count) > 0 &&
      Number(job?.completed_page_count) === Number(job.source_page_count) &&
      Number(job?.assured_page_count) === Number(job.source_page_count) &&
      Number(job?.unresolved_region_count) === 0
    )), 'Every target organization job must be an exact ready evidence-1.3 shadow job');
  }
  const rows = [...jobs].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return { count: rows.length, sha256: sha256Json(rows) };
}

function assertCloudBoundary(value, config) {
  assert(value?.schedulerState === 'PAUSED', 'Cloud Scheduler must remain PAUSED');
  assert(Array.isArray(value.executionNames), 'Cloud Run execution inventory is missing');
  assert(Array.isArray(value.activeExecutionNames), 'Cloud Run active execution inventory is missing');
  assert(value.activeExecutionNames.length === 0, 'A Cloud Run execution is already active');
  assert(value.cloudRunJob === config.cloudRunJob, 'Cloud Run job identity drifted');
  assert(value.schedulerJob === config.schedulerJob, 'Cloud Scheduler job identity drifted');
  return {
    schedulerState: value.schedulerState,
    schedulerJob: value.schedulerJob,
    cloudRunJob: value.cloudRunJob,
    executionNames: [...value.executionNames].sort(),
    activeExecutionNames: [],
  };
}

function createCloudBoundaryAdapter(config, options = {}) {
  const execute = options.execFileSync || execFileSync;
  const gcloudJson = args => {
    const output = execute('gcloud', [...args, '--format=json'], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(String(output || '').trim());
  };
  return {
    async inspect() {
      const scheduler = gcloudJson([
        'scheduler', 'jobs', 'describe', config.schedulerJob,
        '--location', config.gcpRegion, '--project', config.gcpProject,
      ]);
      const cloudRunJob = gcloudJson([
        'run', 'jobs', 'describe', config.cloudRunJob,
        '--region', config.gcpRegion, '--project', config.gcpProject,
      ]);
      assert((cloudRunJob?.status?.conditions || []).some(condition => (
        condition.type === 'Ready' && condition.status === 'True'
      )), 'Cloud Run job is not Ready');
      const executions = gcloudJson([
        'run', 'jobs', 'executions', 'list', '--job', config.cloudRunJob,
        '--region', config.gcpRegion, '--project', config.gcpProject,
      ]);
      return {
        schedulerState: scheduler.state,
        schedulerJob: String(scheduler?.name || '').split('/').at(-1),
        cloudRunJob: String(cloudRunJob?.metadata?.name || cloudRunJob?.name || '').split('/').at(-1),
        executionNames: executions.map(row => row?.metadata?.name).filter(Boolean),
        activeExecutionNames: executions.filter(row => !row?.status?.completionTime)
          .map(row => row?.metadata?.name).filter(Boolean),
      };
    },
  };
}

function createSupabaseAdapter(config) {
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows = (result, label) => {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    return result.data || [];
  };
  const selectIdentityState = async documentIds => {
    const documents = rows(await client.from('reference_documents')
      .select('id,owner_id,document_data').in('id', documentIds).order('id'),
    'select exact current documents');
    const jobs = rows(await client.from('ecos_hosted_index_jobs').select([
      'id,organization_id,project_id,document_id,source_owner_id,source_sha256,source_revision',
      'source_page_count,completed_page_count,assured_page_count,unresolved_region_count',
      'state,mode,committed_evidence_version,claimed_by,claim_token,lease_expires_at',
    ].join(',')).eq('organization_id', config.organizationId).eq('mode', 'shadow')
      .in('document_id', documentIds).order('document_id').order('id'),
    'select exact current shadow jobs');
    const authorityByJobId = {};
    for (const job of jobs) {
      const authority = await client.rpc('ecos_hosted_job_matches_reference', {
        p_job_id: job.id, p_require_current: true,
      });
      if (authority.error) throw new Error(`verify shadow job ${job.id}: ${authority.error.message}`);
      authorityByJobId[job.id] = authority.data === true;
    }
    const jobIds = jobs.map(job => job.id);
    const pages = jobIds.length === 0 ? [] : rows(await client.from('ecos_hosted_index_pages')
      .select('job_id,organization_id,project_id,document_id,source_sha256,page_number,state,assurance_result,unresolved_region_count')
      .in('job_id', jobIds).order('job_id').order('page_number').limit(10_000),
    'select exact current shadow pages');
    return { documents, jobs, pages, authorityByJobId };
  };
  return {
    async selectConfigurations() {
      return rows(await client.from('ecos_hosted_index_configuration')
        .select('organization_id,publication_mode,enabled,max_concurrent_jobs,daily_visual_region_limit,updated_by,updated_at')
        .order('organization_id'), 'select hosted configurations');
    },
    async inspect(documentIds) {
      const configurations = await this.selectConfigurations();
      const jobs = rows(await client.from('ecos_hosted_index_jobs').select('*')
        .eq('organization_id', config.organizationId).order('id'),
      'select target organization job manifest');
      return { configurations, jobs, identityState: await selectIdentityState(documentIds) };
    },
    async updateConfiguration(patch, expected) {
      let query = client.from('ecos_hosted_index_configuration').update(patch);
      for (const [key, value] of Object.entries(expected)) {
        query = value == null ? query.is(key, null) : query.eq(key, value);
      }
      return rows(await query.select(
        'organization_id,publication_mode,enabled,max_concurrent_jobs,daily_visual_region_limit,updated_by,updated_at',
      ), 'update exact organization publication configuration');
    },
  };
}

function createSignalController(processRef = process) {
  let requestedSignal = null;
  const handlers = new Map();
  return {
    install() {
      for (const signal of ['SIGINT', 'SIGTERM']) {
        const handler = () => { if (!requestedSignal) requestedSignal = signal; };
        handlers.set(signal, handler);
        processRef.on(signal, handler);
      }
    },
    remove() {
      for (const [signal, handler] of handlers) processRef.off(signal, handler);
      handlers.clear();
    },
    get requestedSignal() { return requestedSignal; },
  };
}

function createReceiptWriter(config, options = {}) {
  const now = options.now || new Date();
  const runId = options.runId || now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const filePath = options.filePath || path.join(
    repoRoot,
    'validation/output',
    `ecos-hosted-publication-${config.action}-${sha256(config.organizationId).slice(0, 16)}-${runId}.json`,
  );
  return {
    filePath,
    save(value) { writeJsonAtomic(filePath, value); },
  };
}

function approvedLedgerInfo(ledgerFile, ledger) {
  return {
    path: path.relative(repoRoot, ledgerFile),
    fileSha256: sha256(require('node:fs').readFileSync(ledgerFile)),
    receiptSha256: ledger.seal.receiptSha256,
    baselineIdentitySha256: ledger.baselineIdentitySha256,
    finalCycleSha256: ledger.cycles.at(-1).cycleSha256,
  };
}

function expectedUpdatePredicate(configuration) {
  return {
    organization_id: configuration.organization_id,
    publication_mode: configuration.publication_mode,
    enabled: configuration.enabled,
    max_concurrent_jobs: configuration.max_concurrent_jobs,
    daily_visual_region_limit: configuration.daily_visual_region_limit,
    updated_by: configuration.updated_by,
    updated_at: configuration.updated_at,
  };
}

async function inspectBoundary(config, ledger, dependencies, options = {}) {
  const documentIds = ledger.cycles.at(-1).identity.documents.map(document => document.id);
  const database = await dependencies.db.inspect(documentIds);
  const configuration = exactTargetConfiguration(database.configurations, config.organizationId);
  const identity = options.allowHistoricalIdentity
    ? historicalIdentitySnapshot(ledger, database.identityState)
    : currentIdentityFromLedger(ledger, database.identityState);
  const cloud = assertCloudBoundary(await dependencies.cloud.inspect(), config);
  const jobManifest = assertJobManifestSafe(database.jobs, config.organizationId, {
    requireReady: !options.allowHistoricalIdentity,
    expectedJobCount: config.expectedJobCount,
  });
  return {
    configuration,
    nonTargetConfigurations: nonTargetConfigurationSeal(database.configurations, config.organizationId),
    jobManifest,
    identity,
    cloud,
  };
}

function assertUnchangedBoundary(before, after, label) {
  assert(after.nonTargetConfigurations.count === before.nonTargetConfigurations.count &&
    after.nonTargetConfigurations.sha256 === before.nonTargetConfigurations.sha256,
  `${label}: another organization configuration changed`);
  assert(after.jobManifest.count === before.jobManifest.count &&
    after.jobManifest.sha256 === before.jobManifest.sha256,
  `${label}: target organization job manifest changed`);
  assert(after.identity.sealSha256 === before.identity.sealSha256,
    `${label}: exact job/document readiness changed`);
  assert(sha256Json(after.cloud.executionNames) === sha256Json(before.cloud.executionNames),
    `${label}: Cloud Run execution inventory changed`);
}

async function rollbackToBaseline(config, ledger, dependencies, expectedLive, baseline, audit) {
  const cleanup = { attempted: true, errors: [] };
  try {
    const currentConfiguration = exactTargetConfiguration(
      await dependencies.db.selectConfigurations(),
      config.organizationId,
    );
    if (currentConfiguration.publication_mode === 'shadow' && currentConfiguration.enabled === false) {
      cleanup.alreadyShadow = true;
      cleanup.after = await inspectBoundary(config, ledger, dependencies);
      return cleanup;
    }
    assert(currentConfiguration.publication_mode === 'live' && currentConfiguration.enabled === true,
      'Automatic rollback found an unexpected publication state');
    if (expectedLive) {
      assert(sha256Json(currentConfiguration) === sha256Json(expectedLive),
        'Automatic rollback live configuration no longer matches this operation');
    }
    const rollbackAt = new Date(dependencies.clock.now()).toISOString();
    const updated = await dependencies.db.updateConfiguration({
      publication_mode: 'shadow',
      enabled: false,
      max_concurrent_jobs: baseline.max_concurrent_jobs,
      daily_visual_region_limit: baseline.daily_visual_region_limit,
      updated_by: config.updatedBy,
      updated_at: rollbackAt,
    }, expectedUpdatePredicate(currentConfiguration));
    assert(updated.length === 1, 'Automatic rollback did not update exactly one organization');
    const after = await inspectBoundary(config, ledger, dependencies);
    assert(after.configuration.publication_mode === 'shadow' && after.configuration.enabled === false,
      'Automatic rollback did not restore shadow-disabled state');
    assertUnchangedBoundary(audit.before, after, 'Automatic rollback');
    cleanup.after = after;
  } catch (error) {
    cleanup.errors.push(String(error.message).slice(0, 4_000));
  }
  return cleanup;
}

async function runPublicationTransition(config, dependencies) {
  const identity = assertCleanOperatorIdentity(
    dependencies.operatorIdentity || operatorIdentity(__filename),
  );
  const signal = dependencies.signal || createSignalController(process);
  const ledger = dependencies.ledger;
  const writer = dependencies.receipts;
  const expectedFrom = config.action === 'promote'
    ? { publication_mode: 'shadow', enabled: false }
    : { publication_mode: 'live', enabled: true };
  const expectedTo = config.action === 'promote'
    ? { publication_mode: 'live', enabled: true }
    : { publication_mode: 'shadow', enabled: false };
  const audit = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    action: config.action,
    status: 'preflight',
    startedAt: new Date(dependencies.clock.now()).toISOString(),
    organizationId: config.organizationId,
    productionHost: config.productionHost,
    operatorIdentity: identity,
    approval: {
      allowance: config.allowance,
      updatedBy: config.updatedBy,
      preflightOnly: config.preflightOnly,
      ledger: dependencies.ledgerInfo,
      priorPromotion: dependencies.priorPromotionInfo || null,
    },
    mutationStarted: false,
  };
  let operationError = null;
  let expectedLive = null;
  let baseline = null;
  signal.install();
  writer.save(audit);
  const assertNotInterrupted = () => assert(!signal.requestedSignal,
    `Interrupted by ${signal.requestedSignal}`);
  try {
    assertNotInterrupted();
    const boundaryOptions = { allowHistoricalIdentity: config.action === 'rollback' };
    const before = await inspectBoundary(config, ledger, dependencies, boundaryOptions);
    audit.before = before;
    baseline = before.configuration;
    if (config.action === 'promote') {
      assert(ledger.cycles.at(-1).identity.jobs.length === config.expectedJobCount,
        'Three-cycle ledger does not seal every expected organization job');
    }
    assert(before.configuration.publication_mode === expectedFrom.publication_mode &&
      before.configuration.enabled === expectedFrom.enabled,
    `${config.action} requires exact ${expectedFrom.publication_mode}/${expectedFrom.enabled ? 'enabled' : 'disabled'} baseline`);
    if (config.action === 'rollback') {
      const promoted = dependencies.priorPromotion?.after?.configuration;
      assert(promoted && sha256Json(before.configuration) === sha256Json(promoted),
        'Rollback baseline does not exactly match the approved promotion receipt');
    }
    assertNotInterrupted();
    const immediate = await inspectBoundary(config, ledger, dependencies, boundaryOptions);
    assert(sha256Json(immediate) === sha256Json(before),
      'Publication boundary drifted between preflight reads');
    audit.status = 'preflight_pass';
    writer.save(audit);
    if (config.preflightOnly) {
      audit.cleanup = { readOnly: true, mutationStarted: false };
      const complete = new Error('Publication preflight complete');
      complete.code = 'ECOS_PUBLICATION_PREFLIGHT_COMPLETE';
      throw complete;
    }

    assertNotInterrupted();
    audit.mutationStarted = true;
    audit.mutationStartedAt = new Date(dependencies.clock.now()).toISOString();
    audit.status = 'mutating';
    writer.save(audit);
    const transitionAt = new Date(dependencies.clock.now()).toISOString();
    const updated = await dependencies.db.updateConfiguration({
      publication_mode: expectedTo.publication_mode,
      enabled: expectedTo.enabled,
      max_concurrent_jobs: before.configuration.max_concurrent_jobs,
      daily_visual_region_limit: before.configuration.daily_visual_region_limit,
      updated_by: config.updatedBy,
      updated_at: transitionAt,
    }, expectedUpdatePredicate(before.configuration));
    assert(updated.length === 1, 'Publication transition did not update exactly one organization');
    expectedLive = config.action === 'promote' ? configCore(updated[0]) : null;
    assertNotInterrupted();
    const after = await inspectBoundary(config, ledger, dependencies, boundaryOptions);
    assert(after.configuration.publication_mode === expectedTo.publication_mode &&
      after.configuration.enabled === expectedTo.enabled,
    'Publication transition did not reach the exact requested state');
    assert(after.configuration.max_concurrent_jobs === before.configuration.max_concurrent_jobs &&
      after.configuration.daily_visual_region_limit === before.configuration.daily_visual_region_limit,
    'Publication transition changed resource controls');
    assert(after.configuration.updated_by === config.updatedBy &&
      Date.parse(after.configuration.updated_at) === Date.parse(transitionAt),
    'Publication transition audit identity or timestamp drifted');
    assertUnchangedBoundary(before, after, 'Publication transition');
    audit.after = after;
    audit.status = 'pass';
    audit.cleanup = { required: false, errors: [] };
  } catch (error) {
    if (error.code !== 'ECOS_PUBLICATION_PREFLIGHT_COMPLETE') {
      operationError = error;
      audit.status = signal.requestedSignal ? 'interrupted' : 'failed';
      audit.failure = { name: error.name, message: String(error.message).slice(0, 4_000) };
      if (audit.mutationStarted && config.action === 'promote' && baseline) {
        audit.cleanup = await rollbackToBaseline(
          config, ledger, dependencies, expectedLive, baseline, audit,
        );
        if (audit.cleanup.errors.length > 0) {
          audit.failure.rollbackError = audit.cleanup.errors.join('; ');
        }
      } else {
        audit.cleanup = { readOnly: !audit.mutationStarted, mutationStarted: audit.mutationStarted, errors: [] };
      }
    }
  } finally {
    audit.finishedAt = new Date(dependencies.clock.now()).toISOString();
    signal.remove();
    const sealed = sealObject(audit);
    writer.save(sealed);
    if (operationError) {
      operationError.receipt = sealed;
      operationError.receiptPath = writer.filePath;
    }
  }
  if (operationError) throw operationError;
  return sealObject(audit);
}

function parseConfiguration(env = process.env) {
  const action = exactText(env.ECOS_PUBLICATION_ACTION, 'ECOS_PUBLICATION_ACTION', 20).toLowerCase();
  assert(['promote', 'rollback'].includes(action), 'ECOS_PUBLICATION_ACTION must be promote or rollback');
  const allowance = exactText(env.ECOS_PUBLICATION_ALLOW_MUTATION,
    'ECOS_PUBLICATION_ALLOW_MUTATION', 100);
  assert(allowance === (action === 'promote' ? PROMOTE_ALLOWANCE : ROLLBACK_ALLOWANCE),
    `Mutation allowance must equal ${action === 'promote' ? PROMOTE_ALLOWANCE : ROLLBACK_ALLOWANCE}`);
  const supabaseUrl = exactText(env.SUPABASE_URL, 'SUPABASE_URL', 2_000).replace(/\/$/, '');
  const expectedUrl = exactText(env.ECOS_PUBLICATION_EXPECTED_URL,
    'ECOS_PUBLICATION_EXPECTED_URL', 2_000).replace(/\/$/, '');
  assert(supabaseUrl === expectedUrl, 'Supabase URL does not match the approved publication URL');
  assert(supabaseUrl === PRODUCTION_URL, 'Publication URL must be the exact HTTPS production origin');
  const productionHost = new URL(supabaseUrl).host;
  assert(productionHost === PRODUCTION_HOST, 'Publication target is not the sealed production host');
  return Object.freeze({
    action,
    allowance,
    preflightOnly: enabled(env.ECOS_PUBLICATION_PREFLIGHT_ONLY),
    supabaseUrl,
    expectedUrl,
    productionHost,
    serviceRoleKey: exactText(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY', 10_000),
    organizationId: exactText(env.ECOS_PUBLICATION_ORGANIZATION_ID,
      'ECOS_PUBLICATION_ORGANIZATION_ID'),
    updatedBy: canonicalUuid(env.ECOS_PUBLICATION_UPDATED_BY, 'ECOS_PUBLICATION_UPDATED_BY'),
    expectedJobCount: (() => {
      const value = Number(env.ECOS_PUBLICATION_EXPECTED_JOB_COUNT);
      assert(Number.isInteger(value) && value >= 1 && value <= 10_000,
        'ECOS_PUBLICATION_EXPECTED_JOB_COUNT must be an integer from 1 through 10000');
      return value;
    })(),
    ledgerPath: repositoryPath(env.ECOS_PUBLICATION_LEDGER_PATH,
      'ECOS_PUBLICATION_LEDGER_PATH', { mustExist: true }),
    ledgerSha256: canonicalSha256(env.ECOS_PUBLICATION_LEDGER_SHA256,
      'ECOS_PUBLICATION_LEDGER_SHA256'),
    priorPromotionPath: action === 'rollback' ? repositoryPath(
      env.ECOS_PUBLICATION_PROMOTION_RECEIPT_PATH,
      'ECOS_PUBLICATION_PROMOTION_RECEIPT_PATH', { mustExist: true },
    ) : null,
    priorPromotionSha256: action === 'rollback' ? canonicalSha256(
      env.ECOS_PUBLICATION_PROMOTION_RECEIPT_SHA256,
      'ECOS_PUBLICATION_PROMOTION_RECEIPT_SHA256',
    ) : null,
    gcpProject: exactText(env.ECOS_GCP_PROJECT, 'ECOS_GCP_PROJECT'),
    gcpRegion: exactText(env.ECOS_GCP_REGION, 'ECOS_GCP_REGION'),
    cloudRunJob: exactText(env.ECOS_GCP_JOB, 'ECOS_GCP_JOB'),
    schedulerJob: exactText(env.ECOS_GCP_SCHEDULER, 'ECOS_GCP_SCHEDULER'),
  });
}

function loadApprovedEvidence(config) {
  const ledgerRead = readSealedReceipt(
    config.ledgerPath, config.ledgerSha256, 'Approved three-cycle shadow ledger',
  );
  const ledger = verifyThreeCycleLedger(ledgerRead.value, {
    productionHost: config.productionHost,
    organizationId: config.organizationId,
    ledgerPath: config.ledgerPath,
    expectedJobCount: config.expectedJobCount,
    allowHistorical: config.action === 'rollback',
  });
  let priorPromotion = null;
  let priorPromotionInfo = null;
  if (config.action === 'rollback') {
    const read = readSealedReceipt(
      config.priorPromotionPath, config.priorPromotionSha256, 'Approved promotion receipt',
    );
    priorPromotion = verifySealedObject(read.value, 'Approved promotion receipt');
    assert(priorPromotion.schemaVersion === RECEIPT_SCHEMA_VERSION &&
      priorPromotion.action === 'promote' && priorPromotion.status === 'pass',
    'Rollback requires one passed promotion receipt');
    assert(priorPromotion.organizationId === config.organizationId &&
      priorPromotion.productionHost === config.productionHost,
    'Promotion receipt target identity drifted');
    assert(priorPromotion.approval?.ledger?.receiptSha256 === ledger.seal.receiptSha256,
      'Promotion receipt was not approved against this exact shadow ledger');
    priorPromotionInfo = {
      path: path.relative(repoRoot, config.priorPromotionPath),
      fileSha256: sha256(read.bytes),
      receiptSha256: priorPromotion.seal.receiptSha256,
    };
  }
  return {
    ledger,
    ledgerInfo: approvedLedgerInfo(config.ledgerPath, ledger),
    priorPromotion,
    priorPromotionInfo,
  };
}

async function main() {
  const config = parseConfiguration(process.env);
  const evidence = loadApprovedEvidence(config);
  const receipts = createReceiptWriter(config);
  try {
    const result = await runPublicationTransition(config, {
      ...evidence,
      clock: { now: () => Date.now() },
      db: createSupabaseAdapter(config),
      cloud: createCloudBoundaryAdapter(config),
      receipts,
    });
    console.log(`ECOS publication ${config.action.toUpperCase()} ${result.status.toUpperCase()}: ${config.organizationId}`);
    console.log(`Evidence: ${receipts.filePath}`);
    console.log(`Receipt SHA-256: ${result.seal.receiptSha256}`);
  } catch (error) {
    console.error(`ECOS publication ${config.action.toUpperCase()} FAIL: ${error.message}`);
    if (error.receiptPath) console.error(`Evidence: ${error.receiptPath}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  ACTIVE_JOB_STATES,
  PRODUCTION_HOST,
  PRODUCTION_URL,
  PROMOTE_ALLOWANCE,
  RECEIPT_SCHEMA_VERSION,
  ROLLBACK_ALLOWANCE,
  assertCloudBoundary,
  assertJobManifestSafe,
  assertUnchangedBoundary,
  configCore,
  createCloudBoundaryAdapter,
  createReceiptWriter,
  createSignalController,
  createSupabaseAdapter,
  currentIdentityFromLedger,
  exactTargetConfiguration,
  historicalIdentitySnapshot,
  loadApprovedEvidence,
  nonTargetConfigurationSeal,
  parseConfiguration,
  runPublicationTransition,
};
