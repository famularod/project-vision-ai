#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildShadowIdentitySnapshot,
  parseConfiguration,
  runThreeCycleLedger,
  validateShadowAcceptanceReceipt,
  verifyThreeCycleLedger,
} = require('./ecos-ask-shadow-three-cycle-operator');
const { sealObject } = require('./ecos-operator-seal-lib');

const ORGANIZATION_ID = 'organization-exact';
const USER_ID = '18de1577-8ae4-4aae-b192-554e88c9b6b2';
const TARGETS = Object.freeze([
  Object.freeze({
    key: '2375',
    projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
    expectedCases: 1,
    definitionPath: '/test/2375.json',
  }),
  Object.freeze({
    key: '2321',
    projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    expectedCases: 1,
    definitionPath: '/test/2321.json',
  }),
]);

function exactDocument(target) {
  const suffix = target.key;
  return {
    id: `document-${suffix}`,
    name: `Drawing ${suffix}`,
    projectId: target.projectId,
    revision: `revision-${suffix}`,
    sourceSha256: target.key === '2375' ? 'a'.repeat(64) : 'b'.repeat(64),
    evidenceVersion: 'ecos-hosted-evidence/1.3',
    sourcePageCount: 1,
    indexedPageCount: 1,
    indexMode: 'shadow',
  };
}

function acceptanceReceipt(target, startOffset) {
  const document = exactDocument(target);
  const startedAt = new Date(Date.parse('2026-08-11T12:00:00.000Z') + startOffset).toISOString();
  const completedAt = new Date(Date.parse(startedAt) + 1_000).toISOString();
  return {
    schemaVersion: 'ecos-ask-live-acceptance-result/1.0',
    definitionSchemaVersion: 'ecos-ask-live-acceptance/1.0',
    acceptanceContractSha256: target.key === '2375' ? 'c'.repeat(64) : 'd'.repeat(64),
    startedAt,
    completedAt,
    productionHost: 'xdytqlpsqsseoeuxgzre.supabase.co',
    projectId: target.projectId,
    projectName: `Project ${target.key}`,
    authenticatedUserId: USER_ID,
    indexMode: 'shadow',
    documentReadiness: {
      passed: true,
      failures: [],
      checkedDocuments: [document],
      checkedPages: 1,
    },
    summary: { total: 1, passed: 1, failed: 0, passRate: 1 },
    cases: [{
      id: `case-${target.key}`,
      question: `Question for project ${target.key}?`,
      passed: true,
      failures: [],
      citations: [{
        documentId: document.id,
        projectId: target.projectId,
        sourceSha256: document.sourceSha256,
        evidenceVersion: 'ecos-hosted-evidence/1.3',
        documentName: document.name,
        revision: document.revision,
        pageNumber: 1,
        sheetNumber: 'A1',
        regionId: 'proof-1',
      }],
    }],
  };
}

function rawIdentityState() {
  const documents = TARGETS.map(target => {
    const expected = exactDocument(target);
    return {
      id: expected.id,
      owner_id: USER_ID,
      document_data: {
        id: expected.id,
        isCurrent: true,
        drawingStatus: 'For Construction',
        projectId: target.projectId,
        organizationId: ORGANIZATION_ID,
        contentSha256: expected.sourceSha256,
        drawingRevision: expected.revision,
        sourcePageCount: 1,
        ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
        ecosVerifiedIndexCommittedSha256: expected.sourceSha256,
        ecosVerifiedIndexCommittedPageCount: 1,
        ecosVerifiedIndexPageGraphSha256: target.key === '2375' ? 'e'.repeat(64) : 'f'.repeat(64),
      },
    };
  });
  const jobs = TARGETS.map((target, index) => {
    const expected = exactDocument(target);
    return {
      id: index === 0
        ? '22222222-2222-4222-8222-222222222222'
        : '33333333-3333-4333-8333-333333333333',
      organization_id: ORGANIZATION_ID,
      project_id: target.projectId,
      document_id: expected.id,
      source_owner_id: USER_ID,
      source_sha256: expected.sourceSha256,
      source_revision: expected.revision,
      source_page_count: 1,
      completed_page_count: 1,
      assured_page_count: 1,
      unresolved_region_count: 0,
      state: 'ready',
      mode: 'shadow',
      committed_evidence_version: 'ecos-hosted-evidence/1.3',
      claimed_by: null,
      claim_token: null,
      lease_expires_at: null,
    };
  });
  const pages = jobs.map(job => ({
    job_id: job.id,
    organization_id: ORGANIZATION_ID,
    project_id: job.project_id,
    document_id: job.document_id,
    source_sha256: job.source_sha256,
    page_number: 1,
    state: 'assured',
    assurance_result: { accepted: true, evidenceVersion: 'ecos-hosted-evidence/1.3' },
    unresolved_region_count: 0,
  }));
  return {
    documents,
    jobs,
    pages,
    authorityByJobId: Object.fromEntries(jobs.map(job => [job.id, true])),
  };
}

// The public validator is exercised against the real production definitions in
// their focused acceptance tests. Here the orchestration uses a fixture-level
// validator so failures can isolate ordering and immutable identity behavior.
function fixtureValidated(receipt, target) {
  assert.equal(receipt.indexMode, 'shadow');
  assert.equal(receipt.productionHost, 'xdytqlpsqsseoeuxgzre.supabase.co');
  assert.equal(receipt.projectId, target.projectId);
  assert.equal(receipt.summary.passed, 1);
  return {
    key: target.key,
    projectId: target.projectId,
    projectName: receipt.projectName,
    productionHost: receipt.productionHost,
    acceptanceContractSha256: receipt.acceptanceContractSha256,
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
    authenticatedUserId: receipt.authenticatedUserId,
    caseCount: 1,
    checkedPages: 1,
    checkedDocuments: receipt.documentReadiness.checkedDocuments,
  };
}

function memoryWriter() {
  return {
    ledgerPath: '/tmp/ledger.json',
    archived: [],
    saved: [],
    archive(cycleNumber, target, bytes) {
      this.archived.push({ cycleNumber, target, bytes: Buffer.from(bytes) });
      return `cycle-${cycleNumber}/${target}.json`;
    },
    save(value) { this.saved.push(JSON.parse(JSON.stringify(value))); },
  };
}

async function main() {
  assert.throws(() => parseConfiguration({
    ECOS_SHADOW_LEDGER_MODE: 'consume',
    SUPABASE_URL: 'http://xdytqlpsqsseoeuxgzre.supabase.co',
    ECOS_SHADOW_LEDGER_EXPECTED_URL: 'http://xdytqlpsqsseoeuxgzre.supabase.co',
  }), /exact HTTPS production origin/);

  // Fail-closed unit coverage of the exact production validator's early
  // boundaries does not require a valid full benchmark receipt.
  const productionTarget = require('./ecos-ask-shadow-three-cycle-operator').TARGETS[0];
  const invalidMode = acceptanceReceipt({ ...productionTarget, expectedCases: 1 }, 0);
  invalidMode.indexMode = 'live';
  assert.throws(
    () => validateShadowAcceptanceReceipt(invalidMode, productionTarget, new Date('2026-08-11T12:01:00Z')),
    /protected shadow mode/,
  );

  const results = TARGETS.map((target, index) => fixtureValidated(
    acceptanceReceipt(target, index * 2_000), target,
  ));
  const snapshot = buildShadowIdentitySnapshot(results, rawIdentityState(), ORGANIZATION_ID);
  assert.equal(snapshot.documents.length, 2);
  assert.equal(snapshot.jobs.length, 2);
  assert.match(snapshot.identitySha256, /^[a-f0-9]{64}$/);

  const wrongOrg = rawIdentityState();
  wrongOrg.documents[0].document_data.organizationId = 'foreign-org';
  assert.throws(
    () => buildShadowIdentitySnapshot(results, wrongOrg, ORGANIZATION_ID),
    /organization identity drifted/,
  );
  const ambiguousJob = rawIdentityState();
  ambiguousJob.jobs.push({ ...ambiguousJob.jobs[0], id: '44444444-4444-4444-8444-444444444444' });
  ambiguousJob.authorityByJobId[ambiguousJob.jobs.at(-1).id] = true;
  assert.throws(
    () => buildShadowIdentitySnapshot(results, ambiguousJob, ORGANIZATION_ID),
    /Expected one exact current shadow job/,
  );
  const stalePage = rawIdentityState();
  stalePage.pages[0].assurance_result.accepted = false;
  assert.throws(
    () => buildShadowIdentitySnapshot(results, stalePage, ORGANIZATION_ID),
    /Assurance receipt drifted/,
  );

  const writer = memoryWriter();
  let nextRun = 0;
  const config = {
    productionHost: 'xdytqlpsqsseoeuxgzre.supabase.co',
    organizationId: ORGANIZATION_ID,
    expectedJobCount: 2,
    targets: TARGETS,
  };
  const ledger = await runThreeCycleLedger(config, {
    clock: { now: () => Date.parse('2026-08-11T12:30:00.000Z') },
    operatorIdentity: {
      repositoryCommit: '1'.repeat(40),
      repositoryTree: '2'.repeat(40),
      workingTreeDirty: false,
      workingTreeStatusSha256: '3'.repeat(64),
      operatorScriptSha256: '4'.repeat(64),
    },
    writer,
    receiptProvider: async (_cycleNumber, target) => {
      const receipt = acceptanceReceipt(target, nextRun * 2_000);
      nextRun += 1;
      return { value: receipt, bytes: Buffer.from(JSON.stringify(receipt)) };
    },
    validateReceipt: fixtureValidated,
    identityAdapter: { select: async () => rawIdentityState() },
  });
  assert.equal(ledger.status, 'pass');
  assert.equal(ledger.cycles.length, 3);
  assert.equal(writer.archived.length, 6);
  assert.notEqual(ledger.cycles[0].cycleSha256, ledger.cycles[1].cycleSha256);
  assert.equal(ledger.cycles[1].previousCycleSha256, ledger.cycles[0].cycleSha256);
  assert.equal(ledger.cycles[2].previousCycleSha256, ledger.cycles[1].cycleSha256);

  // Verify structural tampering is rejected independently of current contract
  // hashing, which is already covered by the production acceptance tests.
  const sealed = sealObject({ ...structuredClone(ledger), seal: undefined });
  sealed.cycles[1].identity.identitySha256 = '0'.repeat(64);
  assert.throws(() => verifyThreeCycleLedger(sealed, { targets: [] }), /seal does not match/);

  const driftWriter = memoryWriter();
  let driftRun = 0;
  await assert.rejects(
    runThreeCycleLedger(config, {
      clock: { now: () => Date.parse('2026-08-11T13:30:00.000Z') },
      operatorIdentity: {
        repositoryCommit: '1'.repeat(40), repositoryTree: '2'.repeat(40), workingTreeDirty: false,
        workingTreeStatusSha256: '3'.repeat(64), operatorScriptSha256: '4'.repeat(64),
      },
      writer: driftWriter,
      receiptProvider: async (_cycleNumber, target) => {
        const receipt = acceptanceReceipt(target, driftRun * 2_000);
        driftRun += 1;
        return { value: receipt, bytes: Buffer.from(JSON.stringify(receipt)) };
      },
      validateReceipt: fixtureValidated,
      identityAdapter: {
        select: async () => {
          const state = rawIdentityState();
          if (driftRun > 2) {
            state.documents[0].document_data.ecosVerifiedIndexPageGraphSha256 = '9'.repeat(64);
          }
          return state;
        },
      },
    }),
    /identity drifted/,
  );
  assert.equal(driftWriter.saved.at(-1).status, 'failed');
  assert.equal(driftWriter.saved.at(-1).seal.algorithm, 'sha256-stable-json');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-shadow-ledger-test-'));
  try {
    for (const archive of writer.archived) {
      const directory = path.join(temp, `cycle-${archive.cycleNumber}`);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, `${archive.target}.json`), archive.bytes);
    }
    const ledgerPath = path.join(temp, 'ledger.json');
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
    assert.equal(verifyThreeCycleLedger(ledger, {
      targets: TARGETS,
      productionHost: 'xdytqlpsqsseoeuxgzre.supabase.co',
      organizationId: ORGANIZATION_ID,
      ledgerPath,
      allowHistorical: true,
    }).status, 'pass');
    fs.appendFileSync(path.join(temp, 'cycle-2', '2375.json'), ' ');
    assert.throws(() => verifyThreeCycleLedger(ledger, {
      targets: TARGETS,
      productionHost: 'xdytqlpsqsseoeuxgzre.supabase.co',
      organizationId: ORGANIZATION_ID,
      ledgerPath,
      allowHistorical: true,
    }), /archived receipt bytes drifted/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('ECOS three-cycle shadow acceptance operator contracts PASS.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
