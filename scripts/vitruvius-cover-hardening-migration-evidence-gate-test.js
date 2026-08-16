#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  POSTAPPLY_MARKER, REHEARSAL_MARKER, currentCandidate,
  emitRehearsalSql, makeReceipt, postapplyVerifierPath, sha256,
  validateEvidence,
} = require('./vitruvius-cover-hardening-migration-evidence-lib');
const { modes } = require('./vitruvius-cover-hardening-migration-evidence');
const { runGate } = require('./vitruvius-cover-hardening-migration-evidence-gate');

const emittedSql = emitRehearsalSql();
assert(!emittedSql.includes('-- @apply-cover-hardening-migration 20260812011945'));
assert(emittedSql.includes('-- BEGIN COVER HARDENING MIGRATION 20260812011945 SHA256 '));
assert(emittedSql.includes('create or replace function public.ecos_dismiss_hosted_visual_exception_v1('));
assert(emittedSql.includes("p_normalized_dismissal->'facts' is distinct from '[]'::jsonb"));
assert(emittedSql.includes('Every bounded diagnostic candidate must be dismissed'));
assert(emittedSql.includes(REHEARSAL_MARKER));
const candidate = currentCandidate({
  emittedSql,
  repository: { commit: '1'.repeat(40), tree: '2'.repeat(40), clean: true },
  priorEvidence: {
    commit: '3ffe78ecaec17056b189c4cf525ede8b89a6c7c6',
    rehearsalSha256: '29be874943e31f130a78eae0e72d4e4ca76b4aa625825f80605ddbb837298f1e',
    postapplySha256: 'a4609778e383d6627077b31c22663caf57276f2ef0f3076306dcd003913bce3d',
  },
});
const database = {
  projectRef: 'xdytqlpsqsseoeuxgzre',
  host: 'db.xdytqlpsqsseoeuxgzre.supabase.co', port: '5432',
  connectionMode: 'direct', sslMode: 'require',
};
const rehearsalPayload = {
  receipt: REHEARSAL_MARKER, migrationOrder: ['20260812011945'],
  outerTransactionRolledBack: true, uncommittedObjectDeleted: true,
  referencedObjectRetained: true, directImmutableDeleteDenied: true,
  factFreeVisualDismissalPersisted: true, providerCallsMade: 0,
};
const postapplyPayload = {
  receipt: POSTAPPLY_MARKER, migrationOrder: ['20260812011945'],
  storageDeleteGuardsEnabled: 1, storageMutationPoliciesExact: 7,
  visualDismissalAuthorityEnabled: 1,
  providerCallsMadeByVerifier: 0,
};
const rehearsal = makeReceipt({
  mode: 'rehearsal', candidate, database, databasePayload: rehearsalPayload,
  executedSql: emittedSql, stdout: JSON.stringify(rehearsalPayload), stderr: '',
  startedAt: '2026-08-11T23:00:00.000Z',
  finishedAt: '2026-08-11T23:01:00.000Z',
});
const postapplySql = fs.readFileSync(postapplyVerifierPath, 'utf8');
const postapply = makeReceipt({
  mode: 'postapply', candidate, database, databasePayload: postapplyPayload,
  executedSql: postapplySql, stdout: JSON.stringify(postapplyPayload), stderr: '',
  startedAt: '2026-08-11T23:02:00.000Z',
  finishedAt: '2026-08-11T23:03:00.000Z',
  priorReceiptSha256: sha256(`${JSON.stringify(rehearsal, null, 2)}\n`),
});
assert.equal(validateEvidence({
  rehearsal, postapply, candidate, now: new Date('2026-08-11T23:04:00.000Z'),
}), true);
const expectedDigests = {
  rehearsal: sha256(`${JSON.stringify(rehearsal, null, 2)}\n`),
  postapply: sha256(`${JSON.stringify(postapply, null, 2)}\n`),
};
assert.equal(runGate({
  rehearsal, postapply, candidate, expectedDigests,
  now: new Date('2026-08-11T23:04:00.000Z'),
}).candidate, candidate);
assert.throws(() => runGate({ rehearsal, postapply, candidate }), /independent receipt digest/i);
assert.equal(
  modes.rehearsal.expectedConfirmation,
  'ROLLBACK_ONLY_COVER_HARDENING_XDYTQLPSQSSEOEUXGZRE',
);
assert.equal(
  modes.postapply.expectedConfirmation,
  'READ_ONLY_COVER_HARDENING_XDYTQLPSQSSEOEUXGZRE',
);
const packageScripts = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'package.json'), 'utf8',
)).scripts;
assert.equal(
  packageScripts['check:cover-hardening-migration-evidence'],
  'node scripts/vitruvius-cover-hardening-migration-evidence-gate.js',
);
console.log('Vitruvius cover hardening migration evidence contracts PASS.');
