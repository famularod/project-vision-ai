#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  EXPECTED_POSTAPPLY_DATABASE_RECEIPT,
  EXPECTED_PREDECESSOR_SOURCE_REHEARSAL_DATABASE_RECEIPT,
  EXPECTED_REHEARSAL_DATABASE_RECEIPT,
  MIGRATION,
  MIGRATION_HISTORY,
  POSTAPPLY_MARKER,
  PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE,
  REHEARSAL_MARKER,
  SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
  assertPredecessorSourceProvenanceEvidence,
  currentCandidate,
  emitRehearsalSql,
  makeReceipt,
  parseDatabaseReceipt,
  postapplyVerifierPath,
  sha256,
  validateEvidence,
} = require('./vitruvius-source-provenance-acl-migration-evidence-lib');
const { modes } = require('./vitruvius-source-provenance-acl-migration-evidence');
const { runGate } = require('./vitruvius-source-provenance-acl-migration-evidence-gate');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const emittedSql = emitRehearsalSql();
assert(!emittedSql.includes(
  '-- @apply-source-provenance-acl-migration 20260812075338',
));
assert(emittedSql.includes(
  '-- BEGIN SOURCE-PROVENANCE-ACL MIGRATION 20260812075338 SHA256 ',
));
assert(emittedSql.includes(
  'revoke all on function\n  public.ecos_enqueue_hosted_index_from_reference_document()',
));
assert(emittedSql.includes("set local role service_role;"));
assert(emittedSql.includes('set document_data = source.document_data'));
assert(emittedSql.includes("'authenticator'"));
assert(emittedSql.includes(REHEARSAL_MARKER));
assert.deepEqual(MIGRATION_HISTORY, [
  '20260809193726', '20260809195802', '20260809201435',
  '20260809222329', '20260810013000', '20260811021601',
  '20260811151028', '20260811235642', '20260812011945',
  '20260812064107', '20260812075338',
]);

const exactCandidate = currentCandidate({
  emittedSql,
  repository: { commit: '3'.repeat(40), tree: '4'.repeat(40), clean: true },
  priorEvidence: PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE,
});
assert.deepEqual(
  exactCandidate.priorEvidence,
  PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE,
);
assert.deepEqual(
  assertPredecessorSourceProvenanceEvidence({ repositoryCommit: 'HEAD' }),
  PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE,
);
assert.throws(
  () => assertPredecessorSourceProvenanceEvidence({
    predecessorSourceRehearsalReceiptPath: path.join(
      __dirname,
      'missing-source-provenance-rehearsal.json',
    ),
  }),
  /source-provenance rehearsal receipt is missing/i,
);

const predecessorReceiptPath = path.resolve(
  __dirname,
  '../validation/output/vitruvius-source-provenance-migration-rehearsal-receipt.json',
);
const predecessorReceipt = JSON.parse(fs.readFileSync(predecessorReceiptPath, 'utf8'));
assert.deepEqual(
  predecessorReceipt.databaseReceipt,
  EXPECTED_PREDECESSOR_SOURCE_REHEARSAL_DATABASE_RECEIPT,
);
const forgedDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'vitruvius-forged-source-predecessor-'),
);
const forgedPredecessorPath = path.join(forgedDirectory, 'receipt.json');
const forgedPredecessor = clone(predecessorReceipt);
forgedPredecessor.databaseReceipt.providerCallsMade = 1;
fs.writeFileSync(forgedPredecessorPath, `${JSON.stringify(forgedPredecessor, null, 2)}\n`);
try {
  assert.throws(
    () => assertPredecessorSourceProvenanceEvidence({
      predecessorSourceRehearsalReceiptPath: forgedPredecessorPath,
      repositoryCommit: 'HEAD',
    }),
    /receipt digest changed/i,
  );
} finally {
  fs.rmSync(forgedDirectory, { recursive: true, force: true });
}

const database = {
  projectRef: 'xdytqlpsqsseoeuxgzre',
  ...SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
};
const rehearsalPayload = clone(EXPECTED_REHEARSAL_DATABASE_RECEIPT);
const postapplyPayload = clone(EXPECTED_POSTAPPLY_DATABASE_RECEIPT);
assert.deepEqual(
  parseDatabaseReceipt(JSON.stringify(rehearsalPayload), REHEARSAL_MARKER),
  rehearsalPayload,
);
assert.throws(
  () => parseDatabaseReceipt(
    `${JSON.stringify(rehearsalPayload)}\n${JSON.stringify(rehearsalPayload)}`,
    REHEARSAL_MARKER,
  ),
  /returned 2 .* receipts/i,
);

const rehearsal = makeReceipt({
  mode: 'rehearsal',
  candidate: exactCandidate,
  database,
  databasePayload: rehearsalPayload,
  executedSql: emittedSql,
  stdout: JSON.stringify(rehearsalPayload),
  stderr: '',
  startedAt: '2026-08-12T12:00:00.000Z',
  finishedAt: '2026-08-12T12:01:00.000Z',
});
const postapplySql = fs.readFileSync(postapplyVerifierPath, 'utf8');
assert(postapplySql.includes("'20260812064107', '20260812075338'"));
assert(postapplySql.includes("'authenticator'"));
assert(postapplySql.includes(POSTAPPLY_MARKER));
const rehearsalDigest = sha256(`${JSON.stringify(rehearsal, null, 2)}\n`);
const postapply = makeReceipt({
  mode: 'postapply',
  candidate: exactCandidate,
  database,
  databasePayload: postapplyPayload,
  executedSql: postapplySql,
  stdout: JSON.stringify(postapplyPayload),
  stderr: '',
  startedAt: '2026-08-12T12:02:00.000Z',
  finishedAt: '2026-08-12T12:03:00.000Z',
  priorReceiptSha256: rehearsalDigest,
});
const expectedDigests = {
  rehearsal: rehearsalDigest,
  postapply: sha256(`${JSON.stringify(postapply, null, 2)}\n`),
};
const evidenceOptions = {
  rehearsal,
  postapply,
  candidate: exactCandidate,
  expectedDigests,
  now: new Date('2026-08-12T12:04:00.000Z'),
};
assert.equal(validateEvidence(evidenceOptions), true);
assert.equal(runGate(evidenceOptions).candidate, exactCandidate);

const directDatabaseRehearsal = clone(rehearsal);
directDatabaseRehearsal.database = {
  host: 'db.xdytqlpsqsseoeuxgzre.supabase.co',
  port: '5432',
  connectionMode: 'direct',
  sslMode: 'require',
};
const directDatabasePostapply = clone(postapply);
directDatabasePostapply.database = directDatabaseRehearsal.database;
directDatabasePostapply.priorReceiptSha256 = sha256(
  `${JSON.stringify(directDatabaseRehearsal, null, 2)}\n`,
);
assert.throws(
  () => runGate({
    rehearsal: directDatabaseRehearsal,
    postapply: directDatabasePostapply,
    candidate: exactCandidate,
    expectedDigests: {
      rehearsal: sha256(`${JSON.stringify(directDatabaseRehearsal, null, 2)}\n`),
      postapply: sha256(`${JSON.stringify(directDatabasePostapply, null, 2)}\n`),
    },
    now: evidenceOptions.now,
  }),
  /source-provenance ACL database target/i,
);

assert.throws(
  () => runGate({
    ...evidenceOptions,
    expectedDigests: {
      rehearsal: '0'.repeat(64),
      postapply: expectedDigests.postapply,
    },
  }),
  /independent receipt digest/i,
);
assert.throws(
  () => runGate({
    rehearsal,
    postapply,
    candidate: exactCandidate,
    now: evidenceOptions.now,
  }),
  /independent receipt digest/i,
);

const forgedPostapply = clone(postapply);
forgedPostapply.databaseReceipt.referenceEnqueueFunctionNonOwnerGrants = 1;
forgedPostapply.databaseReceiptSha256 = sha256(
  JSON.stringify(forgedPostapply.databaseReceipt),
);
assert.throws(
  () => runGate({
    rehearsal,
    postapply: forgedPostapply,
    candidate: exactCandidate,
    expectedDigests: {
      rehearsal: rehearsalDigest,
      postapply: sha256(`${JSON.stringify(forgedPostapply, null, 2)}\n`),
    },
    now: evidenceOptions.now,
  }),
  /postapply database receipt/i,
);

const forgedCandidate = clone(exactCandidate);
forgedCandidate.priorEvidence.rehearsalSha256 = 'f'.repeat(64);
const forgedRehearsal = clone(rehearsal);
forgedRehearsal.candidate = forgedCandidate;
const forgedPostapplyCandidate = clone(postapply);
forgedPostapplyCandidate.candidate = forgedCandidate;
forgedPostapplyCandidate.priorReceiptSha256 = sha256(
  `${JSON.stringify(forgedRehearsal, null, 2)}\n`,
);
assert.throws(
  () => runGate({
    rehearsal: forgedRehearsal,
    postapply: forgedPostapplyCandidate,
    candidate: forgedCandidate,
    expectedDigests: {
      rehearsal: sha256(`${JSON.stringify(forgedRehearsal, null, 2)}\n`),
      postapply: sha256(`${JSON.stringify(forgedPostapplyCandidate, null, 2)}\n`),
    },
    now: evidenceOptions.now,
  }),
  /predecessor source-provenance evidence/i,
);

const dirtyCandidate = clone(exactCandidate);
dirtyCandidate.repository.clean = false;
const dirtyRehearsal = clone(rehearsal);
dirtyRehearsal.candidate = dirtyCandidate;
const dirtyPostapply = clone(postapply);
dirtyPostapply.candidate = dirtyCandidate;
dirtyPostapply.priorReceiptSha256 = sha256(
  `${JSON.stringify(dirtyRehearsal, null, 2)}\n`,
);
assert.throws(
  () => runGate({
    rehearsal: dirtyRehearsal,
    postapply: dirtyPostapply,
    candidate: dirtyCandidate,
    expectedDigests: {
      rehearsal: sha256(`${JSON.stringify(dirtyRehearsal, null, 2)}\n`),
      postapply: sha256(`${JSON.stringify(dirtyPostapply, null, 2)}\n`),
    },
    now: evidenceOptions.now,
  }),
  /receipt is malformed/i,
);

assert.throws(
  () => runGate({
    candidate: exactCandidate,
    rehearsalReceiptPath: path.join(__dirname, 'missing-acl-rehearsal.json'),
    postapplyReceiptPath: path.join(__dirname, 'missing-acl-postapply.json'),
    expectedDigests,
    now: evidenceOptions.now,
  }),
  /source-provenance ACL rehearsal receipt is missing/i,
);

const marker = `-- @apply-source-provenance-acl-migration ${MIGRATION.version}`;
assert.throws(
  () => emitRehearsalSql({ rehearsalTemplateSql: 'select 1;' }),
  /rehearsal marker is not exact/i,
);
assert.throws(
  () => emitRehearsalSql({ rehearsalTemplateSql: `${marker}\n${marker}` }),
  /rehearsal marker is not exact/i,
);
assert.equal(
  modes.rehearsal.expectedConfirmation,
  'ROLLBACK_ONLY_SOURCE_PROVENANCE_ACL_XDYTQLPSQSSEOEUXGZRE',
);
assert.equal(
  modes.postapply.expectedConfirmation,
  'READ_ONLY_SOURCE_PROVENANCE_ACL_XDYTQLPSQSSEOEUXGZRE',
);

console.log('Vitruvius source-provenance ACL migration evidence contracts PASS.');
