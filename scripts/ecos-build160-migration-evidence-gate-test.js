#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  EXPECTED_MIGRATION_CHAIN,
  EXPECTED_PROJECT_REF,
  POSTAPPLY_MARKER,
  REHEARSAL_MARKER,
  assertExactFrozenMigrationSuffix,
  currentCandidateEvidence,
  emitRehearsalSql,
  exactCurrentMigrationChain,
  extractDatabaseTarget,
  makeEvidenceReceipt,
  parseDatabaseReceipt,
  repositorySnapshot,
  sha256,
  validateMigrationEvidence,
} = require('./ecos-build160-migration-evidence-lib');
const {
  readJson: readGateJson,
  runGate,
} = require('./ecos-build160-migration-evidence-gate');
const {
  executePsql,
  modes,
  sanitizeDatabaseError,
  sanitizedPsqlEnvironment,
} = require('./ecos-build160-migration-evidence');
const {
  SOURCE_PROVENANCE_DATABASE_TARGET,
} = require('./vitruvius-source-provenance-migration-evidence-lib');
const {
  EXPECTED_POSTAPPLY_DATABASE_RECEIPT:
    EXPECTED_SOURCE_ACL_POSTAPPLY_DATABASE_RECEIPT,
  EXPECTED_REHEARSAL_DATABASE_RECEIPT:
    EXPECTED_SOURCE_ACL_REHEARSAL_DATABASE_RECEIPT,
  PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE,
  SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
  currentCandidate: currentSourceProvenanceAclCandidate,
  emitRehearsalSql: emitSourceProvenanceAclRehearsalSql,
  makeReceipt: makeSourceProvenanceAclReceipt,
  postapplyVerifierPath: sourceProvenanceAclPostapplyVerifierPath,
} = require('./vitruvius-source-provenance-acl-migration-evidence-lib');

assert.equal(assertExactFrozenMigrationSuffix([
  '20260809193726_one.sql',
  '20260809195802_two.sql',
  '20260809201435_three.sql',
  '20260809222329_four.sql',
  '20260810013000_five.sql',
]), true);
assert.equal(assertExactFrozenMigrationSuffix([
  '20260809193726_one.sql',
  '20260809195802_two.sql',
  '20260809201435_three.sql',
  '20260809222329_four.sql',
  '20260810013000_five.sql',
  '20260811021601_exact_project_delete_rpc.sql',
  '20260811151028_dave_project_cover_commit_authority.sql',
  '20260811235642_dave_project_cover_cleanup_authority.sql',
  '20260812011945_ecos_visual_exception_dismissal_authority.sql',
  '20260812064107_ecos_managed_source_provenance_guard.sql',
  '20260812075338_ecos_source_provenance_trigger_acl_fix.sql',
], [
  '20260811021601',
  '20260811151028',
  '20260811235642',
  '20260812011945',
  '20260812064107',
  '20260812075338',
]), true);
assert.throws(
  () => assertExactFrozenMigrationSuffix([
    '20260809193726_one.sql',
    '20260809195802_two.sql',
    '20260809201435_three.sql',
    '20260809222329_four.sql',
    '20260810013000_five.sql',
    '20260810020000_unexpected_sixth.sql',
  ]),
  /not the exact frozen five-migration chain/,
);
assert.throws(
  () => assertExactFrozenMigrationSuffix([
    '20260809193726_one.sql',
    '20260809195802_two.sql',
    '20260809201435_three.sql',
    '20260809222329_four.sql',
    '20260810013000_five.sql',
    '20260811021601_exact_project_delete_rpc.sql',
    '20260811151028_dave_project_cover_commit_authority.sql',
    '20260811160000_unapproved.sql',
  ], ['20260811021601', '20260811151028']),
  /not the exact frozen five-migration chain/,
);

const now = new Date('2026-08-10T12:00:00.000Z');
const candidate = {
  schemaVersion: 1,
  repository: {
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    clean: true,
  },
  migrations: [
    { version: '20260809193726', path: 'supabase/migrations/one.sql', sha256: '1'.repeat(64) },
    { version: '20260809195802', path: 'supabase/migrations/two.sql', sha256: '2'.repeat(64) },
    { version: '20260809201435', path: 'supabase/migrations/three.sql', sha256: '3'.repeat(64) },
    { version: '20260809222329', path: 'supabase/migrations/four.sql', sha256: '4'.repeat(64) },
    { version: '20260810013000', path: 'supabase/migrations/five.sql', sha256: '9'.repeat(64) },
  ],
  artifacts: {
    migrationEmitter: { path: 'scripts/emitter.js', sha256: '5'.repeat(64) },
    rehearsalTemplate: { path: 'validation/rehearsal.sql', sha256: '6'.repeat(64) },
    emittedRehearsal: { sha256: '7'.repeat(64) },
    postapplyVerifier: { path: 'validation/postapply.sql', sha256: '8'.repeat(64) },
  },
};
const versions = candidate.migrations.map(migration => migration.version);
const database = {
  projectRef: EXPECTED_PROJECT_REF,
  host: `db.${EXPECTED_PROJECT_REF}.supabase.co`,
  port: '5432',
  connectionMode: 'direct',
  sslMode: 'require',
};
const rehearsalPayload = {
  receipt: REHEARSAL_MARKER,
  migrationOrder: versions,
  outerTransactionRolledBack: true,
  baselineManifestEqual: true,
  providerCallsMade: 0,
  projectIdentityAdversaries: true,
  renderedAnnotationAdversaries: true,
  providerLedgerReplayAndQuota: true,
  authorityLifecycleAndGraphPurge: true,
  pageGraphAndSearchAuthority: true,
};
const postapplyPayload = {
  receipt: POSTAPPLY_MARKER,
  migrationOrder: versions,
  hostedConfigurationsEnabled: 0,
  authorityKeysPresent: 0,
  pageGraphReceiptsPresent: 0,
  providerRequestsBeforeCanary: 0,
  providerAttemptsBeforeCanary: 0,
  requiredTriggersEnabled: 14,
  providerCallsMadeByVerifier: 0,
};

function evidenceReceipt(mode, databasePayload, startedAt, finishedAt) {
  return makeEvidenceReceipt({
    mode,
    candidate: structuredClone(candidate),
    database,
    databasePayload,
    stdout: `${JSON.stringify(databasePayload)}\n`,
    stderr: '',
    executedSql: mode === 'rehearsal' ? 'rehearsal sql' : 'postapply sql',
    startedAt,
    finishedAt,
  });
}

const rehearsal = evidenceReceipt(
  'rehearsal',
  rehearsalPayload,
  '2026-08-10T10:00:00.000Z',
  '2026-08-10T10:05:00.000Z',
);
const postapply = evidenceReceipt(
  'postapply',
  postapplyPayload,
  '2026-08-10T10:30:00.000Z',
  '2026-08-10T10:31:00.000Z',
);

candidate.artifacts.emittedRehearsal.sha256 = rehearsal.execution.sqlSha256;
rehearsal.candidate.artifacts.emittedRehearsal.sha256 = rehearsal.execution.sqlSha256;
postapply.candidate.artifacts.emittedRehearsal.sha256 = rehearsal.execution.sqlSha256;
candidate.artifacts.postapplyVerifier.sha256 = postapply.execution.sqlSha256;
rehearsal.candidate.artifacts.postapplyVerifier.sha256 = postapply.execution.sqlSha256;
postapply.candidate.artifacts.postapplyVerifier.sha256 = postapply.execution.sqlSha256;

assert.equal(validateMigrationEvidence({ rehearsal, postapply, current: candidate, now }), true);

const exactEmittedRehearsal = emitRehearsalSql();
const frozenRepository = {
  commit: 'c'.repeat(40),
  tree: 'd'.repeat(40),
  clean: true,
};
assert.equal(currentCandidateEvidence({
  emittedSql: exactEmittedRehearsal,
  repository: frozenRepository,
}).migrations.length, 5);
const frozenBeginMarkers = exactEmittedRehearsal.match(
  /^-- BEGIN FROZEN MIGRATION \d{14} SHA256 [a-f0-9]{64}$/gm,
);
assert.equal(frozenBeginMarkers.length, 5);
assert.throws(
  () => currentCandidateEvidence({
    emittedSql: `${exactEmittedRehearsal}\n${frozenBeginMarkers[0]}\n`,
    repository: frozenRepository,
  }),
  /exactly the frozen five-migration chain/,
);
const outOfOrderEmittedRehearsal = exactEmittedRehearsal
  .replace(frozenBeginMarkers[0], '__ECOS_FIRST_FROZEN_MARKER__')
  .replace(frozenBeginMarkers[1], frozenBeginMarkers[0])
  .replace('__ECOS_FIRST_FROZEN_MARKER__', frozenBeginMarkers[1]);
assert.throws(
  () => currentCandidateEvidence({
    emittedSql: outOfOrderEmittedRehearsal,
    repository: frozenRepository,
  }),
  /Frozen migration order mismatch/,
);

function rejectsMutation(mutate, pattern) {
  const changedRehearsal = structuredClone(rehearsal);
  const changedPostapply = structuredClone(postapply);
  const changedCurrent = structuredClone(candidate);
  mutate({ rehearsal: changedRehearsal, postapply: changedPostapply, current: changedCurrent });
  assert.throws(
    () => validateMigrationEvidence({
      rehearsal: changedRehearsal,
      postapply: changedPostapply,
      current: changedCurrent,
      now,
    }),
    pattern,
  );
}

rejectsMutation(({ rehearsal: value }) => { value.projectRef = 'foreign-project'; }, /wrong Supabase project/);
rejectsMutation(({ rehearsal: value }) => { value.database.host = 'db.foreign.supabase.co'; }, /not the sealed/);
rejectsMutation(({ rehearsal: value }) => {
  value.startedAt = '2026-08-01T00:00:00.000Z';
  value.finishedAt = '2026-08-01T00:00:00.000Z';
}, /stale/);
rejectsMutation(({ rehearsal: value }) => {
  value.candidate.artifacts.emittedRehearsal.sha256 = 'f'.repeat(64);
}, /does not match/);
rejectsMutation(({ current }) => { current.repository.clean = false; }, /not clean/);
rejectsMutation(({ postapply: value }) => {
  value.startedAt = '2026-08-10T09:59:00.000Z';
}, /predates/);
rejectsMutation(({ postapply: value }) => {
  value.databaseReceipt.providerAttemptsBeforeCanary = 1;
}, /unsafe providerAttemptsBeforeCanary/);
rejectsMutation(({ postapply: value }) => {
  value.databaseReceiptSha256 = '0'.repeat(64);
}, /digest is invalid/);
rejectsMutation(({ rehearsal: value }) => {
  value.execution.credentialsPersisted = true;
}, /execution receipt is unsafe/);
rejectsMutation(({ rehearsal: value }) => {
  value.execution.sqlSha256 = '0'.repeat(64);
}, /executed SQL does not match/);

assert.deepEqual(
  extractDatabaseTarget(`postgresql://postgres:secret@db.${EXPECTED_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`),
  database,
);
assert.deepEqual(
  extractDatabaseTarget(
    `postgresql://postgres.${EXPECTED_PROJECT_REF}:secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
  ),
  {
    projectRef: EXPECTED_PROJECT_REF,
    host: 'aws-0-us-west-1.pooler.supabase.com',
    port: '6543',
    connectionMode: 'pooler',
    sslMode: 'verify-full',
  },
);
assert.deepEqual(
  extractDatabaseTarget(
    `postgresql://cli_login_postgres.${EXPECTED_PROJECT_REF}:secret@aws-1-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  ),
  {
    projectRef: EXPECTED_PROJECT_REF,
    ...SOURCE_PROVENANCE_DATABASE_TARGET,
  },
);
assert.throws(
  () => extractDatabaseTarget(
    'postgresql://cli_login_postgres.foreign:secret@aws-1-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require',
  ),
  /not the sealed/i,
);
assert.throws(
  () => extractDatabaseTarget('postgresql://postgres:secret@db.foreign.supabase.co:5432/postgres?sslmode=require'),
  /not the sealed/,
);
assert.throws(
  () => extractDatabaseTarget(
    `postgresql://postgres:secret@db.${EXPECTED_PROJECT_REF}.supabase.co:5432/postgres`,
  ),
  /require TLS/,
);
assert.throws(() => extractDatabaseTarget('https://example.com'), /must use PostgreSQL/);
assert.throws(
  () => extractDatabaseTarget(
    `postgresql://postgres:secret@db.${EXPECTED_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require&host=127.0.0.1&port=1`,
  ),
  /connection parameter|override/i,
);
assert.throws(
  () => extractDatabaseTarget(
    `postgresql://postgres:secret@db.${EXPECTED_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require&hostaddr=127.0.0.1`,
  ),
  /connection parameter|override/i,
);
assert.throws(
  () => extractDatabaseTarget(
    `postgresql://postgres:secret@db.${EXPECTED_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require&sslmode=verify-full`,
  ),
  /exactly one sslmode/i,
);

assert.deepEqual(
  parseDatabaseReceipt(`NOTICE\n${JSON.stringify(rehearsalPayload)}\n`, REHEARSAL_MARKER),
  rehearsalPayload,
);
assert.throws(
  () => parseDatabaseReceipt(
    `${JSON.stringify(rehearsalPayload)}\n${JSON.stringify(rehearsalPayload)}\n`,
    REHEARSAL_MARKER,
  ),
  /returned 2/,
);

const secretUrl = `postgresql://postgres:super-secret@db.${EXPECTED_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`;
const processEnv = {
  PATH: process.env.PATH,
  ECOS_BUILD160_REHEARSAL_DATABASE_URL: secretUrl,
  ECOS_BUILD160_REHEARSAL_CONFIRM: modes.rehearsal.expectedConfirmation,
};
const childEnv = sanitizedPsqlEnvironment(processEnv, modes.rehearsal, secretUrl);
assert.equal(childEnv.ECOS_BUILD160_REHEARSAL_DATABASE_URL, undefined);
assert.equal(childEnv.ECOS_BUILD160_REHEARSAL_CONFIRM, undefined);
assert.equal(childEnv.PGDATABASE, secretUrl);
let capturedArgs;
let capturedOptions;
const result = executePsql({
  sql: 'select 1;',
  env: processEnv,
  config: modes.rehearsal,
  databaseUrl: secretUrl,
  spawn: (_command, args, options) => {
    capturedArgs = args;
    capturedOptions = options;
    return { status: 0, stdout: `${JSON.stringify(rehearsalPayload)}\n`, stderr: '' };
  },
});
assert.equal(result.stderr, '');
assert(!capturedArgs.join(' ').includes('super-secret'));
assert.equal(capturedOptions.input, 'select 1;');
assert.equal(capturedOptions.env.PGDATABASE, secretUrl);
assert(!sanitizeDatabaseError(`failed ${secretUrl}`, secretUrl).includes('super-secret'));
assert.equal(
  sanitizeDatabaseError('failed postgresql://postgres:another-secret@example.com/postgres'),
  'failed [redacted database URL]',
);

const root = path.resolve(__dirname, '..');
assert.match(
  fs.readFileSync(path.join(root, '.gitignore'), 'utf8'),
  /^\/validation\/output\/$/m,
  'Migration evidence receipts must remain generated release evidence.',
);
for (const sourcePath of [
  path.join(__dirname, 'ecos-build160-migration-evidence.js'),
  path.join(__dirname, 'ecos-build160-migration-evidence-gate.js'),
]) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert(!source.includes('console.log(databaseUrl)'));
  assert(!source.includes('console.error(databaseUrl)'));
}

const exactMigrationNames = EXPECTED_MIGRATION_CHAIN.map(item => path.basename(item.path));
assert.equal(exactCurrentMigrationChain().length, 11);
assert.throws(
  () => exactCurrentMigrationChain({ migrationNames: exactMigrationNames.slice(0, -1) }),
  /missing, out of order, or contains an extra migration/i,
);
const outOfOrderMigrationNames = [...exactMigrationNames];
[outOfOrderMigrationNames[6], outOfOrderMigrationNames[7]] = [
  outOfOrderMigrationNames[7],
  outOfOrderMigrationNames[6],
];
assert.throws(
  () => exactCurrentMigrationChain({ migrationNames: outOfOrderMigrationNames }),
  /missing, out of order, or contains an extra migration/i,
);
assert.throws(
  () => exactCurrentMigrationChain({
    migrationNames: [...exactMigrationNames, '20260812020000_unapproved.sql'],
  }),
  /missing, out of order, or contains an extra migration/i,
);
assert.throws(
  () => exactCurrentMigrationChain({
    migrationNames: exactMigrationNames,
    digestFile: (filePath) => filePath.endsWith(exactMigrationNames[10])
      ? '0'.repeat(64)
      : sha256(fs.readFileSync(filePath)),
  }),
  /Current migration chain does not match/i,
);

const liveRepository = repositorySnapshot();
const syntheticCleanRepository = { ...liveRepository, clean: true };
const sourceProvenanceAclEmittedSql = emitSourceProvenanceAclRehearsalSql();
const sourceProvenanceAclCandidate = currentSourceProvenanceAclCandidate({
  emittedSql: sourceProvenanceAclEmittedSql,
  priorEvidence: PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE,
  repository: syntheticCleanRepository,
});
const sourceProvenanceAclRehearsalPayload = structuredClone(
  EXPECTED_SOURCE_ACL_REHEARSAL_DATABASE_RECEIPT,
);
const sourceProvenanceAclPostapplyPayload = structuredClone(
  EXPECTED_SOURCE_ACL_POSTAPPLY_DATABASE_RECEIPT,
);
const sourceProvenanceAclRehearsal = makeSourceProvenanceAclReceipt({
  mode: 'rehearsal',
  candidate: sourceProvenanceAclCandidate,
  database: {
    projectRef: EXPECTED_PROJECT_REF,
    ...SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
  },
  databasePayload: sourceProvenanceAclRehearsalPayload,
  executedSql: sourceProvenanceAclEmittedSql,
  stdout: JSON.stringify(sourceProvenanceAclRehearsalPayload),
  stderr: '',
  startedAt: '2026-08-12T08:00:00.000Z',
  finishedAt: '2026-08-12T08:01:00.000Z',
});
const sourceProvenanceAclRehearsalDigest = sha256(
  `${JSON.stringify(sourceProvenanceAclRehearsal, null, 2)}\n`,
);
const sourceProvenanceAclPostapply = makeSourceProvenanceAclReceipt({
  mode: 'postapply',
  candidate: sourceProvenanceAclCandidate,
  database: {
    projectRef: EXPECTED_PROJECT_REF,
    ...SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
  },
  databasePayload: sourceProvenanceAclPostapplyPayload,
  executedSql: fs.readFileSync(sourceProvenanceAclPostapplyVerifierPath, 'utf8'),
  stdout: JSON.stringify(sourceProvenanceAclPostapplyPayload),
  stderr: '',
  startedAt: '2026-08-12T08:02:00.000Z',
  finishedAt: '2026-08-12T08:03:00.000Z',
  priorReceiptSha256: sourceProvenanceAclRehearsalDigest,
});
const sourceProvenanceAclExpectedDigests = {
  rehearsal: sourceProvenanceAclRehearsalDigest,
  postapply: sha256(`${JSON.stringify(sourceProvenanceAclPostapply, null, 2)}\n`),
};
const sourceProvenanceAclGateOptions = {
  now: new Date('2026-08-12T08:04:00.000Z'),
  repository: syntheticCleanRepository,
  sourceProvenanceAclExpectedDigests,
  sourceProvenanceAclPostapply,
  sourceProvenanceAclRehearsal,
};
const historicalGateResult = runGate(sourceProvenanceAclGateOptions);
assert.equal(historicalGateResult.migrationCount, 11);
assert.equal(historicalGateResult.commit, liveRepository.commit);
assert.throws(
  () => runGate({
    ...sourceProvenanceAclGateOptions,
    repository: { ...liveRepository, clean: false },
  }),
  /working tree is not clean/i,
);
assert.throws(
  () => runGate({
    ...sourceProvenanceAclGateOptions,
    sourceProvenanceAclExpectedDigests: {},
  }),
  /source-provenance independent receipt digest/i,
);
const changedSourceProvenanceAclPostapply = structuredClone(sourceProvenanceAclPostapply);
changedSourceProvenanceAclPostapply.databaseReceipt.canaryPagesAssured = 5;
assert.throws(
  () => runGate({
    ...sourceProvenanceAclGateOptions,
    sourceProvenanceAclPostapply: changedSourceProvenanceAclPostapply,
  }),
  /source-provenance independent receipt digest/i,
);

const storedFrozenRehearsal = readGateJson(
  path.join(root, 'validation', 'output', 'ecos-build160-migration-rehearsal-receipt.json'),
  'Stored frozen-five rehearsal',
);
const forgedFrozenRehearsal = structuredClone(storedFrozenRehearsal);
forgedFrozenRehearsal.projectRef = 'forged-project';
assert.throws(
  () => runGate({
    ...sourceProvenanceAclGateOptions,
    repository: syntheticCleanRepository,
    rehearsal: forgedFrozenRehearsal,
  }),
  /sealed historical digest/i,
);
const storedSourceProvenanceRehearsal = readGateJson(
  path.join(
    root,
    'validation',
    'output',
    'vitruvius-source-provenance-migration-rehearsal-receipt.json',
  ),
  'Stored source-provenance rehearsal',
);
for (const forgeHistoricalSourceReceipt of [
  (receipt) => { receipt.databaseReceipt.exactCanaryUnchanged = false; },
  (receipt) => { receipt.execution.sqlSha256 = '0'.repeat(64); },
  (receipt) => {
    receipt.candidate.artifacts.rehearsalTemplate.sha256 = '0'.repeat(64);
  },
]) {
  const forgedSourceProvenanceRehearsal = structuredClone(
    storedSourceProvenanceRehearsal,
  );
  forgeHistoricalSourceReceipt(forgedSourceProvenanceRehearsal);
  assert.throws(
    () => runGate({
      ...sourceProvenanceAclGateOptions,
      sourceProvenanceRehearsal: forgedSourceProvenanceRehearsal,
    }),
    /sealed historical digest/i,
  );
}
assert.throws(
  () => runGate({
    ...sourceProvenanceAclGateOptions,
    repository: syntheticCleanRepository,
    receiptPaths: {
      coverPostapply: path.join(root, 'validation', 'output', 'missing-cover-receipt.json'),
    },
  }),
  /sealed cover-hardening post-apply receipt is missing/i,
);
assert.throws(
  () => runGate({
    ...sourceProvenanceAclGateOptions,
    repository: {
      commit: '83b0b7acb074eebc8fbad0b8ba486fe87fa0a769',
      tree: '661fd5becbb4bae906a8b6e87190c43af595d20c',
      clean: true,
    },
  }),
  /Source-provenance rehearsal is not an ancestor/i,
);

console.log('ECOS Build 160 migration evidence gate contracts PASS.');
