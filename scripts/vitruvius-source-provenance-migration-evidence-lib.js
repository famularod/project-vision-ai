#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  EXPECTED_PROJECT_REF,
  canonicalizeDatabaseUrl,
  extractDatabaseTarget,
} = require('./ecos-build160-migration-evidence-lib');

const repoRoot = path.resolve(__dirname, '..');
const RECEIPT_SCHEMA_VERSION = 1;
const RECEIPT_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const REHEARSAL_MARKER = 'VITRUVIUS_SOURCE_PROVENANCE_REHEARSAL_OK';
const POSTAPPLY_MARKER = 'VITRUVIUS_SOURCE_PROVENANCE_POSTAPPLY_OK';
const SOURCE_PROVENANCE_DATABASE_TARGET = Object.freeze({
  host: 'aws-1-us-west-1.pooler.supabase.com',
  port: '5432',
  connectionMode: 'pooler',
  sslMode: 'require',
});
const MIGRATION = Object.freeze({
  version: '20260812064107',
  name: '20260812064107_ecos_managed_source_provenance_guard.sql',
});
const MIGRATION_HISTORY = Object.freeze([
  '20260809193726', '20260809195802', '20260809201435',
  '20260809222329', '20260810013000', '20260811021601',
  '20260811151028', '20260811235642', '20260812011945',
  MIGRATION.version,
]);
const PREDECESSOR_COVER_EVIDENCE = Object.freeze({
  commit: 'f600c3494be4ef20b6a804629ed0dc0ee2e2ff9d',
  rehearsalSha256: 'ebaa94c664b24b1e438eaffd4e8a98df32f6d7b464b2c44e2cd8331662c453e7',
  postapplySha256: 'fae58537418848e3ec32f77e00676ade700e8aa343d5fc033cd13db985b812ed',
});
const EXPECTED_REHEARSAL_DATABASE_RECEIPT = Object.freeze({
  receipt: REHEARSAL_MARKER,
  migrationOrder: Object.freeze([MIGRATION.version]),
  outerTransactionRolledBack: true,
  derivedEvidenceUpdateSkippedReenqueue: true,
  queueIdentityChangeReenqueued: true,
  durableManagedAuthorityPreserved: true,
  cleanManagedReplacementAllowed: true,
  nonManagedAdvanceAllowed: true,
  identityChangeNotPreserved: true,
  baselineManifestEqual: true,
  aclAdversariesRejected: true,
  protectedStatesPreserved: true,
  exactCanaryUnchanged: true,
  providerCallsMade: 0,
});
const EXPECTED_POSTAPPLY_DATABASE_RECEIPT = Object.freeze({
  receipt: POSTAPPLY_MARKER,
  migrationOrder: MIGRATION_HISTORY,
  hostedConfigurationsEnabled: 0,
  nonShadowConfigurations: 0,
  managedSourceGuardTriggersEnabled: 1,
  referenceEnqueueTriggersEnabled: 1,
  protectedManagedUploadJobsMissingGcsAuthority: 0,
  canaryJobId: '3863b29a-f7c0-4188-b5fb-6aa2e6db8dd2',
  canaryPagesAssured: 6,
  canaryShadowChunks: 113,
  canaryQueueItems: 0,
  canaryVisualExceptions: 0,
  referencePageGraphSha256:
    '755780777226cbae2ee9df553cb10f517a645c1ad6b2a29d903deee17f51dbf8',
  providerCallsMadeByVerifier: 0,
});

const outputDirectory = path.join(repoRoot, 'validation', 'output');
const rehearsalReceiptPath = path.join(
  outputDirectory,
  'vitruvius-source-provenance-migration-rehearsal-receipt.json',
);
const postapplyReceiptPath = path.join(
  outputDirectory,
  'vitruvius-source-provenance-migration-postapply-receipt.json',
);
const predecessorRehearsalReceiptPath = path.join(
  outputDirectory,
  'vitruvius-cover-hardening-migration-rehearsal-receipt.json',
);
const predecessorPostapplyReceiptPath = path.join(
  outputDirectory,
  'vitruvius-cover-hardening-migration-postapply-receipt.json',
);
const rehearsalTemplatePath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'vitruvius-source-provenance-migration-adversarial-rollback.sql',
);
const postapplyVerifierPath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'vitruvius-source-provenance-migration-postapply-verify.sql',
);
const toolchainPaths = Object.freeze({
  evidenceLibrary: __filename,
  evidenceRunner: path.join(__dirname, 'vitruvius-source-provenance-migration-evidence.js'),
  evidenceGate: path.join(__dirname, 'vitruvius-source-provenance-migration-evidence-gate.js'),
  evidenceGateTest: path.join(
    __dirname,
    'vitruvius-source-provenance-migration-evidence-gate-test.js',
  ),
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function runGit(args, options = {}) {
  const result = (options.spawnGit || spawnSync)('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(
      result.error?.message || String(result.stderr || '').trim() ||
        `git exited with ${String(result.status)}`,
    );
  }
  return String(result.stdout || '').trim();
}

function repositorySnapshot(options = {}) {
  const commit = runGit(['rev-parse', 'HEAD'], options);
  const tree = runGit(['rev-parse', 'HEAD^{tree}'], options);
  const status = runGit(
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    options,
  );
  return { commit, tree, clean: status.length === 0 };
}

function parseReceiptFile(filePath, missingMessage) {
  if (!fs.existsSync(filePath)) throw new Error(missingMessage);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${missingMessage.replace(/ is missing\.?$/, '')} is not valid JSON: ${error.message}`);
  }
}

function assertPredecessorCoverEvidence(options = {}) {
  const rehearsalPath = options.predecessorRehearsalReceiptPath ||
    predecessorRehearsalReceiptPath;
  const postapplyPath = options.predecessorPostapplyReceiptPath ||
    predecessorPostapplyReceiptPath;
  if (!fs.existsSync(rehearsalPath) || !fs.existsSync(postapplyPath)) {
    throw new Error('The sealed cover-hardening evidence receipts are missing.');
  }
  if (sha256File(rehearsalPath) !== PREDECESSOR_COVER_EVIDENCE.rehearsalSha256 ||
      sha256File(postapplyPath) !== PREDECESSOR_COVER_EVIDENCE.postapplySha256) {
    throw new Error('The sealed cover-hardening evidence receipt digest changed.');
  }
  const rehearsal = parseReceiptFile(
    rehearsalPath,
    'The sealed cover-hardening rehearsal receipt is missing.',
  );
  const postapply = parseReceiptFile(
    postapplyPath,
    'The sealed cover-hardening postapply receipt is missing.',
  );
  if (rehearsal?.schemaVersion !== 1 || rehearsal.kind !== 'rehearsal' ||
      rehearsal.receipt !== 'VITRUVIUS_COVER_HARDENING_MIGRATION_REHEARSAL_OK' ||
      rehearsal.projectRef !== EXPECTED_PROJECT_REF ||
      rehearsal.candidate?.repository?.commit !== PREDECESSOR_COVER_EVIDENCE.commit ||
      rehearsal.candidate?.repository?.clean !== true ||
      postapply?.schemaVersion !== 1 || postapply.kind !== 'postapply' ||
      postapply.receipt !== 'VITRUVIUS_COVER_HARDENING_POSTAPPLY_OK' ||
      postapply.projectRef !== EXPECTED_PROJECT_REF ||
      postapply.candidate?.repository?.commit !== PREDECESSOR_COVER_EVIDENCE.commit ||
      postapply.candidate?.repository?.clean !== true ||
      postapply.priorReceiptSha256 !== PREDECESSOR_COVER_EVIDENCE.rehearsalSha256) {
    throw new Error('The sealed cover-hardening evidence chain is malformed.');
  }
  runGit([
    'merge-base',
    '--is-ancestor',
    PREDECESSOR_COVER_EVIDENCE.commit,
    options.repositoryCommit || runGit(['rev-parse', 'HEAD'], options),
  ], options);
  return { ...PREDECESSOR_COVER_EVIDENCE };
}

function stripTransactionBoundary(sql) {
  const lines = String(sql).split(/\r?\n/);
  const beginIndexes = lines
    .map((line, index) => line.trim().toLowerCase() === 'begin;' ? index : -1)
    .filter(index => index >= 0);
  const commitIndexes = lines
    .map((line, index) => line.trim().toLowerCase() === 'commit;' ? index : -1)
    .filter(index => index >= 0);
  if (beginIndexes.length !== 1 || commitIndexes.length !== 1 ||
      commitIndexes[0] <= beginIndexes[0]) {
    throw new Error('Source-provenance migration has no exact transaction boundary.');
  }
  return [
    ...lines.slice(0, beginIndexes[0]),
    ...lines.slice(beginIndexes[0] + 1, commitIndexes[0]),
    ...lines.slice(commitIndexes[0] + 1),
  ].join('\n').trim();
}

function migrationReceipt() {
  const migrationPath = path.join(repoRoot, 'supabase', 'migrations', MIGRATION.name);
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Source-provenance migration is missing: ${MIGRATION.name}`);
  }
  return {
    version: MIGRATION.version,
    path: path.posix.join('supabase', 'migrations', MIGRATION.name),
    sha256: sha256File(migrationPath),
  };
}

function emitRehearsalSql(options = {}) {
  const marker = `-- @apply-source-provenance-migration ${MIGRATION.version}`;
  const template = options.rehearsalTemplateSql === undefined
    ? fs.readFileSync(rehearsalTemplatePath, 'utf8')
    : String(options.rehearsalTemplateSql);
  if (template.split(marker).length - 1 !== 1) {
    throw new Error('Source-provenance rehearsal marker is not exact.');
  }
  const migration = migrationReceipt();
  const body = stripTransactionBoundary(fs.readFileSync(
    path.join(repoRoot, migration.path),
    'utf8',
  ));
  const injectedBody = [
    `-- BEGIN SOURCE-PROVENANCE MIGRATION ${migration.version} SHA256 ${migration.sha256}`,
    body,
    `-- END SOURCE-PROVENANCE MIGRATION ${migration.version}`,
  ].join('\n');
  // A callback prevents `$'` in PostgreSQL regex literals from being treated
  // as JavaScript replacement syntax and truncating the emitted migration.
  return template.replace(marker, () => injectedBody);
}

function artifactReceipt(filePath) {
  return {
    path: path.relative(repoRoot, filePath).split(path.sep).join('/'),
    sha256: sha256File(filePath),
  };
}

function currentCandidate(options = {}) {
  const repository = options.repository || repositorySnapshot(options);
  const priorEvidence = options.priorEvidence || options.predecessorEvidence ||
    assertPredecessorCoverEvidence({
      ...options,
      repositoryCommit: repository.commit,
    });
  const emittedSql = options.emittedSql || emitRehearsalSql(options);
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    repository,
    priorEvidence,
    migration: migrationReceipt(),
    artifacts: {
      evidenceLibrary: artifactReceipt(toolchainPaths.evidenceLibrary),
      evidenceRunner: artifactReceipt(toolchainPaths.evidenceRunner),
      evidenceGate: artifactReceipt(toolchainPaths.evidenceGate),
      evidenceGateTest: artifactReceipt(toolchainPaths.evidenceGateTest),
      rehearsalTemplate: artifactReceipt(rehearsalTemplatePath),
      emittedRehearsal: { sha256: sha256(emittedSql) },
      postapplyVerifier: artifactReceipt(postapplyVerifierPath),
    },
  };
}

function parseDatabaseReceipt(stdout, marker) {
  const matches = String(stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'))
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(value => value?.receipt === marker);
  if (matches.length !== 1) {
    throw new Error(`Database returned ${matches.length} ${marker} receipts; expected one.`);
  }
  return matches[0];
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function assertExact(actual, expected, label) {
  if (JSON.stringify(canonicalJson(actual)) !== JSON.stringify(canonicalJson(expected))) {
    throw new Error(`${label} does not match the sealed source-provenance value.`);
  }
}

function validateDatabasePayload(payload, mode) {
  const expected = mode === 'rehearsal'
    ? EXPECTED_REHEARSAL_DATABASE_RECEIPT
    : mode === 'postapply'
      ? EXPECTED_POSTAPPLY_DATABASE_RECEIPT
      : null;
  if (!expected) throw new Error(`Unknown source-provenance evidence mode: ${mode}`);
  assertExact(payload, expected, `${mode} database receipt`);
  return true;
}

function makeReceipt({
  mode,
  candidate,
  database,
  databasePayload,
  executedSql,
  stdout,
  stderr,
  startedAt,
  finishedAt,
  priorReceiptSha256,
}) {
  validateDatabasePayload(databasePayload, mode);
  if (mode === 'postapply' &&
      !/^[a-f0-9]{64}$/.test(String(priorReceiptSha256 || ''))) {
    throw new Error('The source-provenance postapply receipt requires the rehearsal digest.');
  }
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: mode,
    receipt: mode === 'rehearsal' ? REHEARSAL_MARKER : POSTAPPLY_MARKER,
    startedAt,
    finishedAt,
    projectRef: database.projectRef,
    database: {
      host: database.host,
      port: database.port,
      connectionMode: database.connectionMode,
      sslMode: database.sslMode,
    },
    candidate,
    databaseReceipt: databasePayload,
    databaseReceiptSha256: sha256(JSON.stringify(databasePayload)),
    ...(mode === 'postapply' ? { priorReceiptSha256 } : {}),
    execution: {
      exitCode: 0,
      sqlSha256: sha256(executedSql),
      stdoutSha256: sha256(stdout),
      stderrSha256: sha256(stderr),
      credentialsPersisted: false,
    },
  };
}

function validateReceipt(receipt, mode, candidate, nowMs) {
  const marker = mode === 'rehearsal' ? REHEARSAL_MARKER : POSTAPPLY_MARKER;
  if (receipt?.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
      receipt.kind !== mode || receipt.receipt !== marker ||
      receipt.projectRef !== EXPECTED_PROJECT_REF ||
      candidate?.repository?.clean !== true) {
    throw new Error(`The ${mode} source-provenance receipt is malformed.`);
  }
  assertExact(
    receipt.database,
    SOURCE_PROVENANCE_DATABASE_TARGET,
    `${mode} source-provenance database target`,
  );
  assertExact(receipt.candidate, candidate, `${mode} candidate`);
  assertExact(
    candidate.priorEvidence,
    PREDECESSOR_COVER_EVIDENCE,
    'predecessor cover evidence',
  );
  validateDatabasePayload(receipt.databaseReceipt, mode);
  if (receipt.databaseReceiptSha256 !== sha256(JSON.stringify(receipt.databaseReceipt)) ||
      receipt.execution?.exitCode !== 0 ||
      receipt.execution?.credentialsPersisted !== false ||
      receipt.execution?.sqlSha256 !== (mode === 'rehearsal'
        ? candidate.artifacts.emittedRehearsal.sha256
        : candidate.artifacts.postapplyVerifier.sha256) ||
      !/^[a-f0-9]{64}$/.test(String(receipt.execution?.stdoutSha256 || '')) ||
      !/^[a-f0-9]{64}$/.test(String(receipt.execution?.stderrSha256 || ''))) {
    throw new Error(`The ${mode} source-provenance execution binding is invalid.`);
  }
  const started = Date.parse(receipt.startedAt);
  const finished = Date.parse(receipt.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) ||
      finished < started || finished > nowMs + FUTURE_CLOCK_SKEW_MS ||
      nowMs - finished > RECEIPT_MAX_AGE_MS) {
    throw new Error(`The ${mode} source-provenance receipt is stale.`);
  }
  return { started, finished };
}

function validateEvidence({ rehearsal, postapply, candidate, now = new Date() }) {
  const nowMs = now.getTime();
  const rehearsalTime = validateReceipt(rehearsal, 'rehearsal', candidate, nowMs);
  const postapplyTime = validateReceipt(postapply, 'postapply', candidate, nowMs);
  if (postapplyTime.started < rehearsalTime.finished) {
    throw new Error('Source-provenance postapply verification predates its rehearsal.');
  }
  const rehearsalDigest = sha256(`${JSON.stringify(rehearsal, null, 2)}\n`);
  if (postapply.priorReceiptSha256 !== rehearsalDigest) {
    throw new Error('The source-provenance postapply receipt lost its rehearsal chain.');
  }
  return true;
}

function writeReceipt(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
  fs.renameSync(temporaryPath, filePath);
}

module.exports = {
  EXPECTED_POSTAPPLY_DATABASE_RECEIPT,
  EXPECTED_PROJECT_REF,
  EXPECTED_REHEARSAL_DATABASE_RECEIPT,
  MIGRATION,
  MIGRATION_HISTORY,
  POSTAPPLY_MARKER,
  PREDECESSOR_COVER_EVIDENCE,
  REHEARSAL_MARKER,
  SOURCE_PROVENANCE_DATABASE_TARGET,
  assertPredecessorCoverEvidence,
  canonicalizeDatabaseUrl,
  currentCandidate,
  emitRehearsalSql,
  extractDatabaseTarget,
  makeReceipt,
  parseDatabaseReceipt,
  postapplyReceiptPath,
  postapplyVerifierPath,
  rehearsalReceiptPath,
  rehearsalTemplatePath,
  sha256,
  validateDatabasePayload,
  validateEvidence,
  writeReceipt,
};
