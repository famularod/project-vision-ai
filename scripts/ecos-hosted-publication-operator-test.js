#!/usr/bin/env node

const assert = require('node:assert/strict');
const {
  PROMOTE_ALLOWANCE,
  ROLLBACK_ALLOWANCE,
  parseConfiguration,
  runPublicationTransition,
} = require('./ecos-hosted-publication-operator');
const { sha256Json } = require('./ecos-operator-seal-lib');

const ORGANIZATION_ID = 'organization-exact';
const OPERATOR_ID = '18de1577-8ae4-4aae-b192-554e88c9b6b2';
const USER_ID = '8d006c18-d883-47da-a9df-b07219528637';
const PRODUCTION_URL = 'https://xdytqlpsqsseoeuxgzre.supabase.co';

function identityFixture() {
  const documents = [
    {
      id: 'document-2321',
      ownerId: USER_ID,
      organizationId: ORGANIZATION_ID,
      projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
      revision: 'revision-2321',
      sourceSha256: 'b'.repeat(64),
      sourcePageCount: 1,
      pageGraphSha256: 'd'.repeat(64),
    },
    {
      id: 'document-2375',
      ownerId: USER_ID,
      organizationId: ORGANIZATION_ID,
      projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
      revision: 'revision-2375',
      sourceSha256: 'a'.repeat(64),
      sourcePageCount: 1,
      pageGraphSha256: 'c'.repeat(64),
    },
  ];
  const jobs = documents.map((document, index) => ({
    id: index === 0
      ? '22222222-2222-4222-8222-222222222222'
      : '33333333-3333-4333-8333-333333333333',
    organizationId: ORGANIZATION_ID,
    projectId: document.projectId,
    documentId: document.id,
    sourceOwnerId: USER_ID,
    sourceSha256: document.sourceSha256,
    sourceRevision: document.revision,
    sourcePageCount: 1,
    completedPageCount: 1,
    assuredPageCount: 1,
    unresolvedRegionCount: 0,
    evidenceVersion: 'ecos-hosted-evidence/1.3',
    pageReceiptSha256: '',
  }));
  for (const job of jobs) {
    job.pageReceiptSha256 = sha256Json([{
      job_id: job.id,
      organization_id: job.organizationId,
      project_id: job.projectId,
      document_id: job.documentId,
      source_sha256: job.sourceSha256,
      page_number: 1,
      state: 'assured',
      assurance_result: { accepted: true, evidenceVersion: 'ecos-hosted-evidence/1.3' },
      unresolved_region_count: 0,
    }]);
  }
  const body = { organizationId: ORGANIZATION_ID, documents, jobs };
  return { ...body, identitySha256: sha256Json(body) };
}

function ledgerFixture() {
  const identity = identityFixture();
  return {
    organizationId: ORGANIZATION_ID,
    expectedJobCount: 2,
    cycles: [1, 2, 3].map(cycleNumber => ({ cycleNumber, identity })),
    baselineIdentitySha256: identity.identitySha256,
    seal: { receiptSha256: '9'.repeat(64) },
  };
}

function rawIdentityState(identity = identityFixture()) {
  const documents = identity.documents.map(document => ({
    id: document.id,
    owner_id: document.ownerId,
    document_data: {
      id: document.id,
      isCurrent: true,
      drawingStatus: 'For Construction',
      projectId: document.projectId,
      organizationId: document.organizationId,
      contentSha256: document.sourceSha256,
      drawingRevision: document.revision,
      sourcePageCount: document.sourcePageCount,
      ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
      ecosVerifiedIndexCommittedSha256: document.sourceSha256,
      ecosVerifiedIndexCommittedPageCount: document.sourcePageCount,
      ecosVerifiedIndexPageGraphSha256: document.pageGraphSha256,
    },
  }));
  const jobs = identity.jobs.map(job => ({
    id: job.id,
    organization_id: job.organizationId,
    project_id: job.projectId,
    document_id: job.documentId,
    source_owner_id: job.sourceOwnerId,
    source_sha256: job.sourceSha256,
    source_revision: job.sourceRevision,
    source_page_count: job.sourcePageCount,
    completed_page_count: job.completedPageCount,
    assured_page_count: job.assuredPageCount,
    unresolved_region_count: job.unresolvedRegionCount,
    state: 'ready',
    mode: 'shadow',
    committed_evidence_version: job.evidenceVersion,
    claimed_by: null,
    claim_token: null,
    lease_expires_at: null,
  }));
  return {
    documents,
    jobs,
    pages: jobs.map(job => ({
      job_id: job.id,
      organization_id: job.organization_id,
      project_id: job.project_id,
      document_id: job.document_id,
      source_sha256: job.source_sha256,
      page_number: 1,
      state: 'assured',
      assurance_result: { accepted: true, evidenceVersion: 'ecos-hosted-evidence/1.3' },
      unresolved_region_count: 0,
    })),
    authorityByJobId: Object.fromEntries(jobs.map(job => [job.id, true])),
  };
}

function configuration(mode = 'shadow', isEnabled = false) {
  return {
    organization_id: ORGANIZATION_ID,
    publication_mode: mode,
    enabled: isEnabled,
    max_concurrent_jobs: 1,
    daily_visual_region_limit: 700,
    updated_by: null,
    updated_at: '2026-08-11T11:00:00.000Z',
  };
}

function createDb(initial = configuration()) {
  let target = structuredClone(initial);
  const foreign = {
    organization_id: 'foreign-org',
    publication_mode: 'shadow',
    enabled: false,
    max_concurrent_jobs: 2,
    daily_visual_region_limit: 50,
    updated_by: null,
    updated_at: '2026-08-01T00:00:00.000Z',
  };
  const identityState = rawIdentityState();
  const manifestJobs = identityState.jobs.map(job => ({ ...job, created_at: '2026-08-01T00:00:00Z' }));
  const calls = [];
  const configurations = () => [structuredClone(target), structuredClone(foreign)];
  return {
    calls,
    get target() { return structuredClone(target); },
    async selectConfigurations() { return configurations(); },
    async inspect() {
      return {
        configurations: configurations(),
        jobs: structuredClone(manifestJobs),
        identityState: structuredClone(identityState),
      };
    },
    async updateConfiguration(patch, expected) {
      calls.push({ patch: structuredClone(patch), expected: structuredClone(expected) });
      const matches = Object.entries(expected).every(([key, value]) => target[key] === value);
      if (!matches) return [];
      target = { ...target, ...structuredClone(patch) };
      return [structuredClone(target)];
    },
  };
}

function createCloud(options = {}) {
  let calls = 0;
  return {
    async inspect() {
      calls += 1;
      const drift = options.driftAt === calls;
      return {
        schedulerState: options.schedulerState || 'PAUSED',
        schedulerJob: 'ecos-scheduler',
        cloudRunJob: 'ecos-worker',
        executionNames: drift ? ['execution-before', 'execution-drift'] : ['execution-before'],
        activeExecutionNames: [],
      };
    },
  };
}

function memoryWriter() {
  return {
    filePath: '/tmp/publication-receipt.json',
    values: [],
    save(value) { this.values.push(structuredClone(value)); },
  };
}

function signal() {
  return { requestedSignal: null, install() {}, remove() {} };
}

function config(action, options = {}) {
  return {
    action,
    allowance: action === 'promote' ? PROMOTE_ALLOWANCE : ROLLBACK_ALLOWANCE,
    preflightOnly: options.preflightOnly || false,
    productionHost: 'xdytqlpsqsseoeuxgzre.supabase.co',
    organizationId: ORGANIZATION_ID,
    updatedBy: OPERATOR_ID,
    expectedJobCount: 2,
    cloudRunJob: 'ecos-worker',
    schedulerJob: 'ecos-scheduler',
  };
}

function commonDependencies(db, cloud = createCloud()) {
  return {
    db,
    cloud,
    ledger: ledgerFixture(),
    ledgerInfo: {
      receiptSha256: '9'.repeat(64),
      baselineIdentitySha256: identityFixture().identitySha256,
    },
    clock: { now: () => Date.parse('2026-08-11T12:00:00.000Z') },
    operatorIdentity: {
      repositoryCommit: '1'.repeat(40), repositoryTree: '2'.repeat(40), workingTreeDirty: false,
      workingTreeStatusSha256: '3'.repeat(64), operatorScriptSha256: '4'.repeat(64),
    },
    receipts: memoryWriter(),
    signal: signal(),
  };
}

async function main() {
  const preflightDb = createDb();
  const preflightDependencies = commonDependencies(preflightDb);
  const preflight = await runPublicationTransition(
    config('promote', { preflightOnly: true }), preflightDependencies,
  );
  assert.equal(preflight.status, 'preflight_pass');
  assert.equal(preflight.cleanup.readOnly, true);
  assert.equal(
    preflight.seal.receiptSha256,
    preflightDependencies.receipts.values.at(-1).seal.receiptSha256,
  );
  assert.equal(preflightDb.calls.length, 0);
  assert.equal(preflightDb.target.publication_mode, 'shadow');

  const promoteDb = createDb();
  const promoteDependencies = commonDependencies(promoteDb);
  const promotion = await runPublicationTransition(config('promote'), promoteDependencies);
  assert.equal(promotion.status, 'pass');
  assert.equal(promotion.after.configuration.publication_mode, 'live');
  assert.equal(promotion.after.configuration.enabled, true);
  assert.equal(promoteDb.calls.length, 1);
  assert.deepEqual(Object.keys(promoteDb.calls[0].expected).sort(), [
    'daily_visual_region_limit', 'enabled', 'max_concurrent_jobs', 'organization_id',
    'publication_mode', 'updated_at', 'updated_by',
  ]);
  assert.equal(promoteDb.calls[0].expected.organization_id, ORGANIZATION_ID);

  const rollbackDependencies = commonDependencies(createDb(promotion.after.configuration));
  rollbackDependencies.priorPromotion = promotion;
  rollbackDependencies.priorPromotionInfo = { receiptSha256: promotion.seal.receiptSha256 };
  const rollback = await runPublicationTransition(config('rollback'), rollbackDependencies);
  assert.equal(rollback.status, 'pass');
  assert.equal(rollback.after.configuration.publication_mode, 'shadow');
  assert.equal(rollback.after.configuration.enabled, false);

  const historicalRollbackDb = createDb(promotion.after.configuration);
  const historicalInspect = historicalRollbackDb.inspect.bind(historicalRollbackDb);
  historicalRollbackDb.inspect = async () => {
    const value = await historicalInspect();
    value.identityState.documents[0].document_data.ecosVerifiedIndexPageGraphSha256 = '8'.repeat(64);
    return value;
  };
  const historicalRollbackDependencies = commonDependencies(historicalRollbackDb);
  historicalRollbackDependencies.priorPromotion = promotion;
  historicalRollbackDependencies.priorPromotionInfo = { receiptSha256: promotion.seal.receiptSha256 };
  const historicalRollback = await runPublicationTransition(
    config('rollback'), historicalRollbackDependencies,
  );
  assert.equal(historicalRollback.status, 'pass');
  assert.equal(historicalRollback.before.identity.matchesLedger, false);
  assert.equal(historicalRollbackDb.target.publication_mode, 'shadow');

  const unsafeCloudDb = createDb();
  const unsafeCloudDependencies = commonDependencies(
    unsafeCloudDb,
    createCloud({ schedulerState: 'ENABLED' }),
  );
  await assert.rejects(
    runPublicationTransition(config('promote'), unsafeCloudDependencies),
    /Scheduler must remain PAUSED/,
  );
  assert.equal(unsafeCloudDb.calls.length, 0);
  assert.equal(unsafeCloudDependencies.receipts.values.at(-1).cleanup.readOnly, true);

  const driftDb = createDb();
  const driftDependencies = commonDependencies(driftDb, createCloud({ driftAt: 3 }));
  await assert.rejects(
    runPublicationTransition(config('promote'), driftDependencies),
    /execution inventory changed/,
  );
  assert.equal(driftDb.calls.length, 2, 'promotion plus automatic rollback are required');
  assert.equal(driftDb.target.publication_mode, 'shadow');
  assert.equal(driftDb.target.enabled, false);
  const failed = driftDependencies.receipts.values.at(-1);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.cleanup.attempted, true);
  assert.equal(failed.cleanup.errors.length, 0,
    'The exact database transition should roll back cleanly after transient Cloud drift');
  assert.match(failed.failure.message, /execution inventory changed/);

  const activeState = rawIdentityState();
  activeState.jobs[0].claimed_by = 'worker';
  const activeDb = createDb();
  const originalInspect = activeDb.inspect.bind(activeDb);
  activeDb.inspect = async () => ({ ...(await originalInspect()), identityState: activeState });
  await assert.rejects(
    runPublicationTransition(config('promote'), commonDependencies(activeDb)),
    /active claim/,
  );
  assert.equal(activeDb.calls.length, 0);

  const incompleteDb = createDb();
  const incompleteInspect = incompleteDb.inspect.bind(incompleteDb);
  incompleteDb.inspect = async () => {
    const value = await incompleteInspect();
    value.jobs[0].state = 'failed_internal';
    return value;
  };
  await assert.rejects(
    runPublicationTransition(config('promote'), commonDependencies(incompleteDb)),
    /Every target organization job must be an exact ready/,
  );
  assert.equal(incompleteDb.calls.length, 0);

  assert.throws(() => parseConfiguration({
    ECOS_PUBLICATION_ACTION: 'promote',
    ECOS_PUBLICATION_ALLOW_MUTATION: ROLLBACK_ALLOWANCE,
    SUPABASE_URL: PRODUCTION_URL,
    ECOS_PUBLICATION_EXPECTED_URL: PRODUCTION_URL,
  }), /allowance must equal/);
  assert.throws(() => parseConfiguration({
    ECOS_PUBLICATION_ACTION: 'promote',
    ECOS_PUBLICATION_ALLOW_MUTATION: PROMOTE_ALLOWANCE,
    SUPABASE_URL: 'http://xdytqlpsqsseoeuxgzre.supabase.co',
    ECOS_PUBLICATION_EXPECTED_URL: 'http://xdytqlpsqsseoeuxgzre.supabase.co',
  }), /exact HTTPS production origin/);

  console.log('ECOS exact-organization publication transition operator contracts PASS.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
