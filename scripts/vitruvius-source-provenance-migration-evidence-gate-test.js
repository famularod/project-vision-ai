#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  EXPECTED_POSTAPPLY_DATABASE_RECEIPT,
  EXPECTED_REHEARSAL_DATABASE_RECEIPT,
  MIGRATION,
  POSTAPPLY_MARKER,
  PREDECESSOR_COVER_EVIDENCE,
  REHEARSAL_MARKER,
  SOURCE_PROVENANCE_DATABASE_TARGET,
  assertPredecessorCoverEvidence,
  currentCandidate,
  emitRehearsalSql,
  makeReceipt,
  parseDatabaseReceipt,
  postapplyVerifierPath,
  sha256,
  validateEvidence,
} = require('./vitruvius-source-provenance-migration-evidence-lib');
const { modes } = require('./vitruvius-source-provenance-migration-evidence');
const { runGate } = require('./vitruvius-source-provenance-migration-evidence-gate');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const emittedSql = emitRehearsalSql();
assert(!emittedSql.includes(
  '-- @apply-source-provenance-migration 20260812064107',
));
assert(emittedSql.includes(
  '-- BEGIN SOURCE-PROVENANCE MIGRATION 20260812064107 SHA256 ',
));
assert(emittedSql.includes(
  'create or replace function public.ecos_reference_document_enqueue_identity(',
));
assert(emittedSql.includes(
  'create or replace function public.ecos_guard_hosted_managed_source_authority()',
));
assert(emittedSql.includes('new.source_provider := old.source_provider;'));
assert(emittedSql.includes('new.source_locator := old.source_locator;'));
assert(emittedSql.includes(REHEARSAL_MARKER));

const exactCandidate = currentCandidate({
  emittedSql,
  repository: { commit: '1'.repeat(40), tree: '2'.repeat(40), clean: true },
  priorEvidence: PREDECESSOR_COVER_EVIDENCE,
});
assert.deepEqual(
  exactCandidate.priorEvidence,
  PREDECESSOR_COVER_EVIDENCE,
);
assert.deepEqual(
  assertPredecessorCoverEvidence({ repositoryCommit: 'HEAD' }),
  PREDECESSOR_COVER_EVIDENCE,
);
assert.throws(
  () => assertPredecessorCoverEvidence({
    predecessorRehearsalReceiptPath: path.join(__dirname, 'missing-cover-rehearsal.json'),
    predecessorPostapplyReceiptPath: path.join(__dirname, 'missing-cover-postapply.json'),
  }),
  /cover-hardening evidence receipts are missing/i,
);

const database = {
  projectRef: 'xdytqlpsqsseoeuxgzre',
  ...SOURCE_PROVENANCE_DATABASE_TARGET,
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
  /source-provenance database target/i,
);

// Independent digests are mandatory and cannot be self-derived by the gate.
assert.throws(
  () => runGate({
    ...evidenceOptions,
    expectedDigests: { rehearsal: '0'.repeat(64), postapply: expectedDigests.postapply },
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

// A forged database receipt remains invalid even if an attacker recomputes
// its internal hash and supplies matching outer file digests.
const forgedPostapply = clone(postapply);
forgedPostapply.databaseReceipt.canaryPagesAssured = 5;
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

// The sealed cover predecessor cannot be replaced by a self-consistent fork.
const forgedCandidate = clone(exactCandidate);
forgedCandidate.priorEvidence.postapplySha256 = 'f'.repeat(64);
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
  /predecessor cover evidence/i,
);

// A dirty tree is never a releasable evidence candidate, even when both
// receipts and both independently supplied digests agree with that dirty tree.
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
    rehearsalReceiptPath: path.join(__dirname, 'missing-source-rehearsal.json'),
    postapplyReceiptPath: path.join(__dirname, 'missing-source-postapply.json'),
    expectedDigests,
    now: evidenceOptions.now,
  }),
  /source-provenance rehearsal receipt is missing/i,
);

const marker = `-- @apply-source-provenance-migration ${MIGRATION.version}`;
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
  'ROLLBACK_ONLY_SOURCE_PROVENANCE_XDYTQLPSQSSEOEUXGZRE',
);
assert.equal(
  modes.postapply.expectedConfirmation,
  'READ_ONLY_SOURCE_PROVENANCE_XDYTQLPSQSSEOEUXGZRE',
);

console.log('Vitruvius source-provenance migration evidence contracts PASS.');
