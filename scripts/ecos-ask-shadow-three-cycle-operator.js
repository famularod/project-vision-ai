#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const {
  acceptanceContractHash,
  loadAcceptanceDefinition,
  validateLiveAcceptanceResult,
} = require('./ecos-ask-live-acceptance-lib');
const {
  assert,
  assertCleanOperatorIdentity,
  canonicalSha256,
  canonicalUuid,
  exactText,
  operatorIdentity,
  readJsonFile,
  repoRoot,
  repositoryPath,
  sealObject,
  sha256,
  sha256Json,
  verifySealedObject,
  writeJsonAtomic,
} = require('./ecos-operator-seal-lib');

const LEDGER_SCHEMA_VERSION = 'ecos-ask-shadow-three-cycle-ledger/1.0';
const CYCLE_SCHEMA_VERSION = 'ecos-ask-shadow-cycle/1.0';
const EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const REQUIRED_CYCLES = 3;
const PRODUCTION_HOST = 'xdytqlpsqsseoeuxgzre.supabase.co';
const PRODUCTION_URL = `https://${PRODUCTION_HOST}`;
const TARGETS = Object.freeze([
  Object.freeze({
    key: '2375',
    projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
    expectedCases: 15,
    definitionPath: path.join(repoRoot, 'validation/ecos/ask-ecos-real-world-cases.json'),
  }),
  Object.freeze({
    key: '2321',
    projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    expectedCases: 19,
    definitionPath: path.join(repoRoot, 'validation/ecos/ask-ecos-2321-real-world-cases.json'),
  }),
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseInstant(value, label) {
  const parsed = Date.parse(value || '');
  assert(Number.isFinite(parsed), `${label} must be an ISO timestamp`);
  return parsed;
}

function resultAsLiveComparable(result) {
  const comparable = JSON.parse(JSON.stringify(result));
  comparable.indexMode = 'live';
  if (Array.isArray(comparable?.documentReadiness?.checkedDocuments)) {
    comparable.documentReadiness.checkedDocuments = comparable.documentReadiness.checkedDocuments
      .map(document => ({ ...document, indexMode: 'live' }));
  }
  return comparable;
}

function validateShadowAcceptanceReceipt(result, target, now = new Date()) {
  const definition = loadAcceptanceDefinition(target.definitionPath);
  const failures = [];
  if (definition.productionHost !== PRODUCTION_HOST || definition.projectId !== target.projectId) {
    failures.push(`${target.key} definition identity drifted.`);
  }
  if (definition.cases.length !== target.expectedCases || definition.minimumPassingCases !== target.expectedCases) {
    failures.push(`${target.key} approved case count drifted.`);
  }
  if (result?.indexMode !== 'shadow') failures.push(`${target.key} result did not use protected shadow mode.`);
  if (result?.productionHost !== PRODUCTION_HOST) failures.push(`${target.key} production host drifted.`);
  if (result?.projectId !== target.projectId) failures.push(`${target.key} immutable project id drifted.`);
  try { canonicalUuid(result?.authenticatedUserId, `${target.key} authenticated user`); } catch (error) {
    failures.push(error.message);
  }
  const startedAt = Date.parse(result?.startedAt || '');
  const completedAt = Date.parse(result?.completedAt || '');
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    failures.push(`${target.key} run timestamps are missing or out of order.`);
  }
  const documents = Array.isArray(result?.documentReadiness?.checkedDocuments)
    ? result.documentReadiness.checkedDocuments
    : [];
  if (result?.documentReadiness?.passed !== true || result?.documentReadiness?.failures?.length !== 0) {
    failures.push(`${target.key} document readiness did not pass cleanly.`);
  }
  if (documents.some(document => document?.indexMode !== 'shadow')) {
    failures.push(`${target.key} document readiness contains a non-shadow receipt.`);
  }
  const indexedPages = documents.reduce((sum, document) => sum + positiveInteger(document?.indexedPageCount), 0);
  if (positiveInteger(result?.documentReadiness?.checkedPages) !== indexedPages) {
    failures.push(`${target.key} checked-page total does not match its exact document receipts.`);
  }
  if (
    result?.summary?.total !== target.expectedCases ||
    result?.summary?.passed !== target.expectedCases ||
    result?.summary?.failed !== 0 ||
    result?.summary?.passRate !== 1
  ) failures.push(`${target.key} result is not an exact ${target.expectedCases}/${target.expectedCases} pass.`);
  failures.push(...validateLiveAcceptanceResult(
    resultAsLiveComparable(result),
    definition,
    now,
    target.definitionPath,
  ).map(failure => `${target.key}: ${failure}`));
  if (failures.length > 0) {
    throw new Error(`Shadow acceptance receipt failed closed:\n- ${[...new Set(failures)].join('\n- ')}`);
  }
  return {
    key: target.key,
    projectId: target.projectId,
    projectName: result.projectName,
    productionHost: result.productionHost,
    acceptanceContractSha256: result.acceptanceContractSha256,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    authenticatedUserId: result.authenticatedUserId,
    caseCount: target.expectedCases,
    checkedPages: result.documentReadiness.checkedPages,
    checkedDocuments: documents,
  };
}

function documentSourceSha(documentData) {
  return text(documentData.contentSha256 || documentData.webFileFingerprint || documentData.indexedContentSha256)
    .toLowerCase();
}

function documentRevision(documentData) {
  return text(documentData.drawingRevision || documentData.webVersionGroupId);
}

function buildShadowIdentitySnapshot(results, rawState, expectedOrganizationId) {
  const expectedDocuments = results.flatMap(result => result.checkedDocuments.map(document => ({
    ...document,
    targetKey: result.key,
  })));
  const expectedIds = expectedDocuments.map(document => text(document.id));
  assert(expectedIds.every(Boolean) && new Set(expectedIds).size === expectedIds.length,
    'Acceptance results contain duplicate or malformed document identities');
  const documents = Array.isArray(rawState?.documents) ? rawState.documents : [];
  const jobs = Array.isArray(rawState?.jobs) ? rawState.jobs : [];
  const pages = Array.isArray(rawState?.pages) ? rawState.pages : [];
  const authority = record(rawState?.authorityByJobId);
  assert(documents.length === expectedDocuments.length,
    'Current reference-document inventory does not exactly match the acceptance receipts');
  const normalizedDocuments = [];
  const normalizedJobs = [];
  for (const expected of expectedDocuments.sort((left, right) => left.id.localeCompare(right.id))) {
    const documentMatches = documents.filter(row => text(row?.id) === expected.id);
    assert(documentMatches.length === 1, `Expected one current reference document ${expected.id}`);
    const row = documentMatches[0];
    const data = record(row.document_data);
    assert(!Object.prototype.hasOwnProperty.call(data, 'id') || data.id === row.id,
      `Reference document ${expected.id} embedded identity drifted`);
    canonicalUuid(row.owner_id, `Reference document ${expected.id} owner`);
    assert(data.isCurrent === true && text(data.drawingStatus).toLowerCase() !== 'superseded',
      `Reference document ${expected.id} is not current`);
    assert(data.projectId === expected.projectId,
      `Reference document ${expected.id} project identity drifted`);
    assert(data.organizationId === expectedOrganizationId,
      `Reference document ${expected.id} organization identity drifted`);
    assert(documentSourceSha(data) === expected.sourceSha256,
      `Reference document ${expected.id} source checksum drifted`);
    assert(documentRevision(data) === expected.revision,
      `Reference document ${expected.id} revision drifted`);
    assert(positiveInteger(data.sourcePageCount) === positiveInteger(expected.sourcePageCount),
      `Reference document ${expected.id} page count drifted`);
    assert(data.ecosVerifiedIndexCommitVersion === 'ecos-verified-index-commit/1.0',
      `Reference document ${expected.id} has no exact verified-index commit`);
    assert(data.ecosVerifiedIndexCommittedSha256 === expected.sourceSha256,
      `Reference document ${expected.id} committed checksum drifted`);
    assert(positiveInteger(data.ecosVerifiedIndexCommittedPageCount) === positiveInteger(expected.sourcePageCount),
      `Reference document ${expected.id} committed page count drifted`);
    canonicalSha256(data.ecosVerifiedIndexPageGraphSha256,
      `Reference document ${expected.id} page-graph receipt`);

    const jobMatches = jobs.filter(job => (
      text(job.document_id) === expected.id &&
      job.organization_id === expectedOrganizationId &&
      job.project_id === expected.projectId &&
      job.source_owner_id === row.owner_id &&
      job.source_sha256 === expected.sourceSha256 &&
      text(job.source_revision) === expected.revision &&
      text(job.mode) === 'shadow'
    ));
    assert(jobMatches.length === 1, `Expected one exact current shadow job for ${expected.id}`);
    const job = jobMatches[0];
    canonicalUuid(job.id, `Shadow job for ${expected.id}`);
    assert(authority[job.id] === true, `Shadow job ${job.id} is not current-reference authoritative`);
    assert(job.state === 'ready' && job.committed_evidence_version === EVIDENCE_VERSION,
      `Shadow job ${job.id} is not ready under evidence 1.3`);
    assert(
      positiveInteger(job.source_page_count) === positiveInteger(expected.sourcePageCount) &&
      positiveInteger(job.completed_page_count) === positiveInteger(expected.sourcePageCount) &&
      positiveInteger(job.assured_page_count) === positiveInteger(expected.sourcePageCount) &&
      Number(job.unresolved_region_count) === 0,
      `Shadow job ${job.id} readiness counters drifted`,
    );
    assert(job.claimed_by == null && job.claim_token == null && job.lease_expires_at == null,
      `Shadow job ${job.id} still has an active claim`);
    const jobPages = pages.filter(page => page.job_id === job.id)
      .sort((left, right) => Number(left.page_number) - Number(right.page_number));
    assert(jobPages.length === positiveInteger(expected.sourcePageCount),
      `Shadow job ${job.id} does not have every page receipt`);
    jobPages.forEach((page, index) => {
      assert(
        page.organization_id === expectedOrganizationId &&
        page.project_id === expected.projectId &&
        page.document_id === expected.id &&
        page.source_sha256 === expected.sourceSha256 &&
        Number(page.page_number) === index + 1 &&
        page.state === 'assured' &&
        page.assurance_result?.accepted === true &&
        page.assurance_result?.evidenceVersion === EVIDENCE_VERSION &&
        Number(page.unresolved_region_count) === 0,
        `Shadow job ${job.id} page ${index + 1} identity or Assurance receipt drifted`,
      );
    });
    normalizedDocuments.push({
      id: expected.id,
      ownerId: row.owner_id,
      organizationId: expectedOrganizationId,
      projectId: expected.projectId,
      revision: expected.revision,
      sourceSha256: expected.sourceSha256,
      sourcePageCount: positiveInteger(expected.sourcePageCount),
      pageGraphSha256: data.ecosVerifiedIndexPageGraphSha256,
    });
    normalizedJobs.push({
      id: job.id,
      organizationId: expectedOrganizationId,
      projectId: expected.projectId,
      documentId: expected.id,
      sourceOwnerId: row.owner_id,
      sourceSha256: expected.sourceSha256,
      sourceRevision: expected.revision,
      sourcePageCount: positiveInteger(expected.sourcePageCount),
      completedPageCount: positiveInteger(job.completed_page_count),
      assuredPageCount: positiveInteger(job.assured_page_count),
      unresolvedRegionCount: Number(job.unresolved_region_count),
      evidenceVersion: job.committed_evidence_version,
      pageReceiptSha256: sha256Json(jobPages),
    });
  }
  const snapshot = {
    organizationId: expectedOrganizationId,
    documents: normalizedDocuments,
    jobs: normalizedJobs,
  };
  return { ...snapshot, identitySha256: sha256Json(snapshot) };
}

function createSupabaseIdentityAdapter(config) {
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const data = (result, label) => {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    return result.data || [];
  };
  return {
    async select(documentIds) {
      const documents = data(await client.from('reference_documents')
        .select('id,owner_id,document_data').in('id', documentIds).order('id'),
      'select exact current documents');
      const jobs = data(await client.from('ecos_hosted_index_jobs').select([
        'id,organization_id,project_id,document_id,source_owner_id,source_sha256,source_revision',
        'source_page_count,completed_page_count,assured_page_count,unresolved_region_count',
        'state,mode,committed_evidence_version,claimed_by,claim_token,lease_expires_at',
      ].join(',')).eq('organization_id', config.organizationId).eq('mode', 'shadow')
        .in('document_id', documentIds).order('document_id').order('id'),
      'select exact current shadow jobs');
      const authorityByJobId = {};
      for (const job of jobs) {
        const result = await client.rpc('ecos_hosted_job_matches_reference', {
          p_job_id: job.id,
          p_require_current: true,
        });
        if (result.error) throw new Error(`verify shadow job ${job.id}: ${result.error.message}`);
        authorityByJobId[job.id] = result.data === true;
      }
      const jobIds = jobs.map(job => job.id);
      const pages = jobIds.length === 0 ? [] : data(await client.from('ecos_hosted_index_pages')
        .select('job_id,organization_id,project_id,document_id,source_sha256,page_number,state,assurance_result,unresolved_region_count')
        .in('job_id', jobIds).order('job_id').order('page_number').limit(10_000),
      'select exact current shadow pages');
      return { documents, jobs, pages, authorityByJobId };
    },
  };
}

function createLedgerWriter(outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: false, mode: 0o700 });
  const ledgerPath = path.join(outputDirectory, 'ledger.json');
  return {
    outputDirectory,
    ledgerPath,
    archive(cycleNumber, targetKey, bytes) {
      const directory = path.join(outputDirectory, `cycle-${cycleNumber}`);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const filePath = path.join(directory, `${targetKey}-shadow-acceptance.json`);
      const descriptor = fs.openSync(filePath, 'wx', 0o600);
      try { fs.writeFileSync(descriptor, bytes); } finally { fs.closeSync(descriptor); }
      return path.relative(outputDirectory, filePath);
    },
    save(value) { writeJsonAtomic(ledgerPath, value); },
  };
}

function createReceiptProvider(config, writer) {
  if (config.mode === 'consume') {
    return async (cycleNumber, target) => {
      const configured = config.receipts[cycleNumber - 1][target.key];
      const filePath = repositoryPath(configured, `Cycle ${cycleNumber} ${target.key} receipt`, { mustExist: true });
      return { ...readJsonFile(filePath, `Cycle ${cycleNumber} ${target.key} receipt`), sourcePath: filePath };
    };
  }
  return async (cycleNumber, target) => {
    const cycleDirectory = path.join(writer.outputDirectory, `cycle-${cycleNumber}`);
    fs.mkdirSync(cycleDirectory, { recursive: true, mode: 0o700 });
    const filePath = path.join(cycleDirectory, `.${target.key}-incoming.json`);
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/ecos-ask-live-acceptance.js')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ECOS_LIVE_SHADOW_VALIDATION: 'true',
        ECOS_LIVE_ACCEPTANCE_DEFINITION: path.relative(repoRoot, target.definitionPath),
        ECOS_LIVE_ACCEPTANCE_RESULT: path.relative(repoRoot, filePath),
      },
      encoding: 'utf8',
      timeout: 90 * 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    assert(fs.existsSync(filePath), `${target.key} acceptance runner produced no result receipt`);
    const receipt = readJsonFile(filePath, `${target.key} generated shadow receipt`);
    fs.unlinkSync(filePath);
    assert(result.status === 0,
      `${target.key} acceptance runner failed: ${text(result.stderr || result.stdout).slice(-2_000)}`);
    return { ...receipt, sourcePath: null };
  };
}

async function runThreeCycleLedger(config, dependencies) {
  const now = dependencies.clock || { now: () => Date.now() };
  const identity = assertCleanOperatorIdentity(
    dependencies.operatorIdentity || operatorIdentity(__filename),
  );
  const writer = dependencies.writer;
  const provider = dependencies.receiptProvider;
  const identityAdapter = dependencies.identityAdapter;
  const validateReceipt = dependencies.validateReceipt || validateShadowAcceptanceReceipt;
  const audit = {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    status: 'collecting',
    startedAt: new Date(now.now()).toISOString(),
    productionHost: config.productionHost,
    organizationId: config.organizationId,
    requiredCycles: REQUIRED_CYCLES,
    expectedJobCount: config.expectedJobCount,
    operatorIdentity: identity,
    cycles: [],
  };
  writer.save(audit);
  let previousCompletedAt = null;
  let previousCycleSha256 = null;
  let baselineIdentitySha256 = null;
  try {
    for (let cycleNumber = 1; cycleNumber <= REQUIRED_CYCLES; cycleNumber += 1) {
      const validatedResults = [];
      const archivedResults = [];
      for (const target of config.targets) {
        const receipt = await provider(cycleNumber, target);
        const archivePath = writer.archive(cycleNumber, target.key, receipt.bytes);
        const validated = validateReceipt(receipt.value, target, new Date(now.now()));
        const startedAt = parseInstant(validated.startedAt, `${target.key} cycle ${cycleNumber} start`);
        const completedAt = parseInstant(validated.completedAt, `${target.key} cycle ${cycleNumber} completion`);
        assert(previousCompletedAt == null || startedAt >= previousCompletedAt,
          `Cycle ${cycleNumber} ${target.key} is out of order or overlaps the preceding clean run`);
        previousCompletedAt = completedAt;
        validatedResults.push(validated);
        archivedResults.push({
          target: target.key,
          archivePath,
          fileSha256: sha256(receipt.bytes),
          canonicalReceiptSha256: sha256Json(receipt.value),
          projectId: validated.projectId,
          acceptanceContractSha256: validated.acceptanceContractSha256,
          startedAt: validated.startedAt,
          completedAt: validated.completedAt,
          passed: validated.caseCount,
          total: validated.caseCount,
          checkedPages: validated.checkedPages,
        });
      }
      const documentIds = validatedResults.flatMap(result => result.checkedDocuments.map(document => document.id));
      const rawState = await identityAdapter.select(documentIds);
      const identitySnapshot = buildShadowIdentitySnapshot(
        validatedResults,
        rawState,
        config.organizationId,
      );
      assert(
        identitySnapshot.jobs.length === config.expectedJobCount &&
        identitySnapshot.documents.length === config.expectedJobCount,
        `Cycle ${cycleNumber} did not seal all ${config.expectedJobCount} expected jobs and documents`,
      );
      if (baselineIdentitySha256 == null) baselineIdentitySha256 = identitySnapshot.identitySha256;
      assert(identitySnapshot.identitySha256 === baselineIdentitySha256,
        `Cycle ${cycleNumber} current job/document identity drifted from cycle 1`);
      const cycle = {
        schemaVersion: CYCLE_SCHEMA_VERSION,
        cycleNumber,
        previousCycleSha256,
        productionHost: config.productionHost,
        organizationId: config.organizationId,
        results: archivedResults,
        identity: identitySnapshot,
      };
      cycle.cycleSha256 = sha256Json(cycle);
      previousCycleSha256 = cycle.cycleSha256;
      audit.cycles.push(cycle);
      audit.lastCompletedCycle = cycleNumber;
      audit.baselineIdentitySha256 = baselineIdentitySha256;
      writer.save(audit);
    }
    audit.status = 'pass';
    audit.completedAt = new Date(now.now()).toISOString();
    const sealed = sealObject(audit);
    writer.save(sealed);
    return sealed;
  } catch (error) {
    audit.status = 'failed';
    audit.failedAt = new Date(now.now()).toISOString();
    audit.failure = { name: error.name, message: String(error.message).slice(0, 4_000) };
    const sealed = sealObject(audit);
    writer.save(sealed);
    error.receipt = sealed;
    error.receiptPath = writer.ledgerPath;
    throw error;
  }
}

function verifyThreeCycleLedger(ledger, options = {}) {
  const targets = options.targets || TARGETS;
  const archiveRoot = options.ledgerPath ? path.dirname(path.resolve(options.ledgerPath)) : null;
  verifySealedObject(ledger, 'Three-cycle shadow ledger');
  assert(ledger.schemaVersion === LEDGER_SCHEMA_VERSION, 'Three-cycle ledger schema is invalid');
  assert(ledger.status === 'pass', 'Three-cycle shadow ledger did not pass');
  assert(ledger.productionHost === (options.productionHost || PRODUCTION_HOST),
    'Three-cycle shadow ledger production host drifted');
  if (options.organizationId) {
    assert(ledger.organizationId === options.organizationId,
      'Three-cycle shadow ledger organization drifted');
  }
  assert(ledger.requiredCycles === REQUIRED_CYCLES && ledger.cycles?.length === REQUIRED_CYCLES,
    'Three-cycle shadow ledger must contain exactly three cycles');
  if (options.expectedJobCount != null) {
    assert(ledger.expectedJobCount === options.expectedJobCount,
      'Three-cycle shadow ledger expected job count drifted');
  }
  let previousCycleSha256 = null;
  let identitySha256 = null;
  let previousCompletedAt = null;
  for (let index = 0; index < ledger.cycles.length; index += 1) {
    const cycle = ledger.cycles[index];
    assert(cycle.schemaVersion === CYCLE_SCHEMA_VERSION && cycle.cycleNumber === index + 1,
      'Three-cycle shadow ledger is out of order');
    assert(cycle.previousCycleSha256 === previousCycleSha256,
      `Cycle ${index + 1} chain predecessor drifted`);
    const unsealedCycle = { ...cycle };
    delete unsealedCycle.cycleSha256;
    assert(sha256Json(unsealedCycle) === cycle.cycleSha256,
      `Cycle ${index + 1} seal does not match its contents`);
    previousCycleSha256 = cycle.cycleSha256;
    assert(cycle.identity?.identitySha256 === sha256Json({
      organizationId: cycle.identity.organizationId,
      documents: cycle.identity.documents,
      jobs: cycle.identity.jobs,
    }), `Cycle ${index + 1} identity seal is invalid`);
    assert(
      cycle.identity.documents?.length === ledger.expectedJobCount &&
      cycle.identity.jobs?.length === ledger.expectedJobCount,
      `Cycle ${index + 1} does not seal every expected job and document`,
    );
    if (identitySha256 == null) identitySha256 = cycle.identity.identitySha256;
    assert(cycle.identity.identitySha256 === identitySha256,
      `Cycle ${index + 1} identity drifted`);
    assert(cycle.results?.length === targets.length, `Cycle ${index + 1} result set is incomplete`);
    for (const target of targets) {
      const result = cycle.results.find(item => item.target === target.key);
      assert(result && result.projectId === target.projectId &&
        result.passed === target.expectedCases && result.total === target.expectedCases,
      `Cycle ${index + 1} ${target.key} result identity or pass count drifted`);
      if (!options.allowHistorical) {
        assert(result.acceptanceContractSha256 === acceptanceContractHash(target.definitionPath),
          `Cycle ${index + 1} ${target.key} acceptance contract is no longer current`);
      }
      if (archiveRoot) {
        const archivePath = path.resolve(archiveRoot, result.archivePath || '');
        const relativeArchive = path.relative(archiveRoot, archivePath);
        assert(relativeArchive && !relativeArchive.startsWith('..') && !path.isAbsolute(relativeArchive),
          `Cycle ${index + 1} ${target.key} archive path escaped the ledger`);
        const archived = readJsonFile(archivePath,
          `Cycle ${index + 1} ${target.key} archived acceptance receipt`);
        assert(sha256(archived.bytes) === result.fileSha256,
          `Cycle ${index + 1} ${target.key} archived receipt bytes drifted`);
        assert(sha256Json(archived.value) === result.canonicalReceiptSha256,
          `Cycle ${index + 1} ${target.key} archived receipt contents drifted`);
        const validated = options.allowHistorical ? {
          projectId: archived.value?.projectId,
          acceptanceContractSha256: archived.value?.acceptanceContractSha256,
          startedAt: archived.value?.startedAt,
          completedAt: archived.value?.completedAt,
          caseCount: archived.value?.summary?.total,
          checkedPages: archived.value?.documentReadiness?.checkedPages,
        } : validateShadowAcceptanceReceipt(
          archived.value,
          target,
          options.now || new Date(),
        );
        if (options.allowHistorical) {
          assert(
            archived.value?.indexMode === 'shadow' &&
            archived.value?.productionHost === (options.productionHost || PRODUCTION_HOST) &&
            archived.value?.projectId === target.projectId &&
            archived.value?.summary?.total === target.expectedCases &&
            archived.value?.summary?.passed === target.expectedCases &&
            archived.value?.summary?.failed === 0 &&
            archived.value?.summary?.passRate === 1,
            `Cycle ${index + 1} ${target.key} historical receipt boundary is invalid`,
          );
        }
        assert(
          validated.projectId === result.projectId &&
          validated.acceptanceContractSha256 === result.acceptanceContractSha256 &&
          validated.startedAt === result.startedAt &&
          validated.completedAt === result.completedAt &&
          validated.caseCount === result.total &&
          validated.checkedPages === result.checkedPages,
          `Cycle ${index + 1} ${target.key} archived receipt summary drifted`,
        );
        const startedAt = parseInstant(validated.startedAt,
          `Cycle ${index + 1} ${target.key} archived start`);
        const completedAt = parseInstant(validated.completedAt,
          `Cycle ${index + 1} ${target.key} archived completion`);
        assert(previousCompletedAt == null || startedAt >= previousCompletedAt,
          `Cycle ${index + 1} ${target.key} archived receipt is out of order`);
        previousCompletedAt = completedAt;
      }
    }
  }
  assert(ledger.baselineIdentitySha256 === identitySha256,
    'Three-cycle ledger baseline identity seal drifted');
  return ledger;
}

function parseConfiguration(env = process.env) {
  const mode = text(env.ECOS_SHADOW_LEDGER_MODE).toLowerCase();
  assert(['run', 'consume'].includes(mode), 'ECOS_SHADOW_LEDGER_MODE must be run or consume');
  const supabaseUrl = exactText(env.SUPABASE_URL, 'SUPABASE_URL', 2_000).replace(/\/$/, '');
  const expectedUrl = exactText(env.ECOS_SHADOW_LEDGER_EXPECTED_URL,
    'ECOS_SHADOW_LEDGER_EXPECTED_URL', 2_000).replace(/\/$/, '');
  assert(supabaseUrl === expectedUrl, 'Supabase URL does not match the approved shadow-ledger URL');
  assert(supabaseUrl === PRODUCTION_URL, 'Shadow ledger URL must be the exact HTTPS production origin');
  const productionHost = new URL(supabaseUrl).host;
  assert(productionHost === PRODUCTION_HOST, 'Shadow ledger target is not the sealed production host');
  const organizationId = exactText(env.ECOS_SHADOW_LEDGER_ORGANIZATION_ID,
    'ECOS_SHADOW_LEDGER_ORGANIZATION_ID');
  const expectedJobCount = Number(env.ECOS_SHADOW_LEDGER_EXPECTED_JOB_COUNT);
  assert(Number.isInteger(expectedJobCount) && expectedJobCount >= 1 && expectedJobCount <= 10_000,
    'ECOS_SHADOW_LEDGER_EXPECTED_JOB_COUNT must be an integer from 1 through 10000');
  if (mode === 'run') {
    const acceptanceUrl = exactText(env.EXPO_PUBLIC_SUPABASE_URL,
      'EXPO_PUBLIC_SUPABASE_URL', 2_000).replace(/\/$/, '');
    assert(acceptanceUrl === PRODUCTION_URL,
      'Protected shadow acceptance must use the exact HTTPS production origin');
  }
  let receipts = null;
  if (mode === 'consume') {
    try { receipts = JSON.parse(exactText(env.ECOS_SHADOW_LEDGER_RECEIPTS_JSON,
      'ECOS_SHADOW_LEDGER_RECEIPTS_JSON', 20_000)); } catch (error) {
      throw new Error(`ECOS_SHADOW_LEDGER_RECEIPTS_JSON is invalid: ${error.message}`);
    }
    assert(Array.isArray(receipts) && receipts.length === REQUIRED_CYCLES,
      'Consume mode requires exactly three ordered receipt pairs');
    receipts.forEach((pair, index) => {
      assert(pair && typeof pair === 'object' && !Array.isArray(pair),
        `Cycle ${index + 1} receipt pair is invalid`);
      assert(Object.keys(pair).sort().join(',') === '2321,2375',
        `Cycle ${index + 1} must contain only exact 2375 and 2321 receipts`);
    });
  }
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const outputDirectory = env.ECOS_SHADOW_LEDGER_OUTPUT
    ? repositoryPath(env.ECOS_SHADOW_LEDGER_OUTPUT, 'ECOS_SHADOW_LEDGER_OUTPUT')
    : path.join(repoRoot, 'validation/output', `ecos-ask-shadow-three-cycle-${runId}`);
  assert(!fs.existsSync(outputDirectory), 'Shadow ledger output directory already exists');
  return Object.freeze({
    mode,
    supabaseUrl,
    serviceRoleKey: exactText(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY', 10_000),
    expectedUrl,
    productionHost,
    organizationId,
    expectedJobCount,
    receipts,
    outputDirectory,
    targets: TARGETS,
  });
}

async function main() {
  const config = parseConfiguration(process.env);
  const frozenOperatorIdentity = assertCleanOperatorIdentity(operatorIdentity(__filename));
  const writer = createLedgerWriter(config.outputDirectory);
  try {
    const result = await runThreeCycleLedger(config, {
      clock: { now: () => Date.now() },
      writer,
      receiptProvider: createReceiptProvider(config, writer),
      identityAdapter: createSupabaseIdentityAdapter(config),
      operatorIdentity: frozenOperatorIdentity,
    });
    console.log(`ECOS shadow acceptance ledger PASS: ${writer.ledgerPath}`);
    console.log(`Receipt SHA-256: ${result.seal.receiptSha256}`);
  } catch (error) {
    console.error(`ECOS shadow acceptance ledger FAIL: ${error.message}`);
    if (error.receiptPath) console.error(`Evidence: ${error.receiptPath}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  CYCLE_SCHEMA_VERSION,
  EVIDENCE_VERSION,
  LEDGER_SCHEMA_VERSION,
  PRODUCTION_HOST,
  PRODUCTION_URL,
  REQUIRED_CYCLES,
  TARGETS,
  buildShadowIdentitySnapshot,
  createLedgerWriter,
  createReceiptProvider,
  createSupabaseIdentityAdapter,
  parseConfiguration,
  runThreeCycleLedger,
  validateShadowAcceptanceReceipt,
  verifyThreeCycleLedger,
};
