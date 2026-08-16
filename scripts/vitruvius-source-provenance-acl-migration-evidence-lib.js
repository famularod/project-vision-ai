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
const REHEARSAL_MARKER = 'VITRUVIUS_SOURCE_PROVENANCE_ACL_REHEARSAL_OK';
const POSTAPPLY_MARKER = 'VITRUVIUS_SOURCE_PROVENANCE_ACL_POSTAPPLY_OK';
const SOURCE_PROVENANCE_ACL_DATABASE_TARGET = Object.freeze({
  host: 'aws-1-us-west-1.pooler.supabase.com',
  port: '5432',
  connectionMode: 'pooler',
  sslMode: 'require',
});
const MIGRATION = Object.freeze({
  version: '20260812075338',
  name: '20260812075338_ecos_source_provenance_trigger_acl_fix.sql',
  sha256: 'ffd08e28b4c132feb6d0c6d8dcf0af684e0f05235bc668e277256d935eb332d5',
});
const MIGRATION_HISTORY = Object.freeze([
  '20260809193726', '20260809195802', '20260809201435',
  '20260809222329', '20260810013000', '20260811021601',
  '20260811151028', '20260811235642', '20260812011945',
  '20260812064107', MIGRATION.version,
]);
const PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE = Object.freeze({
  commit: '2f7b5156c8ee3a5ce45d0d75de501567892b59e0',
  tree: '3ad47d0ca3ee4dd67eef339c149cd1ebf9109cc7',
  rehearsalSha256: '7eade52d7135c213d4b2f7af646535a043cb780858c1edd56e6bb7c82b6deb52',
  migrationVersion: '20260812064107',
  migrationSha256: '1031c91a57d50715ac4dc26225718155a954271e08a12ddaf6239ccc1282d106',
  predecessorCoverEvidence: Object.freeze({
    commit: 'f600c3494be4ef20b6a804629ed0dc0ee2e2ff9d',
    rehearsalSha256: 'ebaa94c664b24b1e438eaffd4e8a98df32f6d7b464b2c44e2cd8331662c453e7',
    postapplySha256: 'fae58537418848e3ec32f77e00676ade700e8aa343d5fc033cd13db985b812ed',
  }),
});
const EXPECTED_PREDECESSOR_SOURCE_REHEARSAL_DATABASE_RECEIPT = Object.freeze({
  receipt: 'VITRUVIUS_SOURCE_PROVENANCE_REHEARSAL_OK',
  migrationOrder: Object.freeze(['20260812064107']),
  providerCallsMade: 0,
  exactCanaryUnchanged: true,
  baselineManifestEqual: true,
  aclAdversariesRejected: true,
  nonManagedAdvanceAllowed: true,
  protectedStatesPreserved: true,
  identityChangeNotPreserved: true,
  outerTransactionRolledBack: true,
  queueIdentityChangeReenqueued: true,
  cleanManagedReplacementAllowed: true,
  durableManagedAuthorityPreserved: true,
  derivedEvidenceUpdateSkippedReenqueue: true,
});
const EXPECTED_REHEARSAL_DATABASE_RECEIPT = Object.freeze({
  receipt: REHEARSAL_MARKER,
  migrationOrder: Object.freeze([MIGRATION.version]),
  outerTransactionRolledBack: true,
  baselineManifestEqual: true,
  enqueueAclClosed: true,
  directServiceInvocationDenied: true,
  serviceRoleTriggerExecutionPreserved: true,
  enqueueCatalogUnchangedExceptAcl: true,
  exactCanaryUnchanged: true,
  nonTargetUnchanged: true,
  hostedConfigurationsHeld: true,
  providerCallsMade: 0,
});
const EXPECTED_POSTAPPLY_DATABASE_RECEIPT = Object.freeze({
  receipt: POSTAPPLY_MARKER,
  migrationOrder: MIGRATION_HISTORY,
  hostedConfigurationsEnabled: 0,
  nonShadowConfigurations: 0,
  referenceEnqueueFunctionNonOwnerGrants: 0,
  managedSourceGuardTriggersEnabled: 1,
  referenceEnqueueTriggersEnabled: 1,
  referenceEnqueueFunctionBindings: 1,
  serviceRoleDirectExecutePrivilege: false,
  protectedManagedUploadJobsMissingGcsAuthority: 0,
  canaryJobId: '3863b29a-f7c0-4188-b5fb-6aa2e6db8dd2',
  canaryPagesAssured: 6,
  canaryShadowChunks: 113,
  canaryQueueItems: 0,
  canaryVisualExceptions: 0,
  referencePageGraphSha256:
    '755780777226cbae2ee9df553cb10f517a645c1ad6b2a29d903deee17f51dbf8',
  livePublishedPages: 0,
  livePublishedChunks: 0,
  providerCallsMadeByVerifier: 0,
});

const outputDirectory = path.join(repoRoot, 'validation', 'output');
const rehearsalReceiptPath = path.join(
  outputDirectory,
  'vitruvius-source-provenance-acl-migration-rehearsal-receipt.json',
);
const postapplyReceiptPath = path.join(
  outputDirectory,
  'vitruvius-source-provenance-acl-migration-postapply-receipt.json',
);
const predecessorSourceRehearsalReceiptPath = path.join(
  outputDirectory,
  'vitruvius-source-provenance-migration-rehearsal-receipt.json',
);
const rehearsalTemplatePath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'vitruvius-source-provenance-acl-migration-adversarial-rollback.sql',
);
const postapplyVerifierPath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'vitruvius-source-provenance-acl-migration-postapply-verify.sql',
);
const toolchainPaths = Object.freeze({
  evidenceLibrary: __filename,
  evidenceRunner: path.join(__dirname, 'vitruvius-source-provenance-acl-migration-evidence.js'),
  evidenceGate: path.join(__dirname, 'vitruvius-source-provenance-acl-migration-evidence-gate.js'),
  evidenceGateTest: path.join(
    __dirname,
    'vitruvius-source-provenance-acl-migration-evidence-gate-test.js',
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

function gitObjectBytes(commit, filePath, options = {}) {
  const result = (options.spawnGit || spawnSync)(
    'git',
    ['show', `${commit}:${filePath}`],
    { cwd: repoRoot, encoding: null, timeout: 30_000 },
  );
  if (result.status !== 0 || result.error) {
    throw new Error(
      result.error?.message || String(result.stderr || '').trim() ||
        `git show failed for ${filePath}`,
    );
  }
  return result.stdout;
}

function assertHistoricalPathBindings(receipt, options = {}) {
  const pathBearing = [
    receipt.candidate?.migration,
    ...Object.values(receipt.candidate?.artifacts || {})
      .filter(artifact => typeof artifact?.path === 'string'),
  ];
  if (pathBearing.length !== 7) {
    throw new Error('The historical source-provenance artifact inventory is incomplete.');
  }
  for (const artifact of pathBearing) {
    if (!/^[a-f0-9]{64}$/.test(String(artifact.sha256 || '')) ||
        sha256(gitObjectBytes(
          PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE.commit,
          artifact.path,
          options,
        )) !== artifact.sha256) {
      throw new Error(
        `The historical source-provenance artifact is not commit-bound: ${artifact.path}`,
      );
    }
  }
}

function assertPredecessorSourceProvenanceEvidence(options = {}) {
  const rehearsalPath = options.predecessorSourceRehearsalReceiptPath ||
    predecessorSourceRehearsalReceiptPath;
  if (!fs.existsSync(rehearsalPath)) {
    throw new Error('The sealed source-provenance rehearsal receipt is missing.');
  }
  if (sha256File(rehearsalPath) !==
      PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE.rehearsalSha256) {
    throw new Error('The sealed source-provenance rehearsal receipt digest changed.');
  }
  const rehearsal = parseReceiptFile(
    rehearsalPath,
    'The sealed source-provenance rehearsal receipt is missing.',
  );
  const expectedDatabase = {
    projectRef: EXPECTED_PROJECT_REF,
    ...SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
  };
  if (rehearsal?.schemaVersion !== 1 || rehearsal.kind !== 'rehearsal' ||
      rehearsal.receipt !== 'VITRUVIUS_SOURCE_PROVENANCE_REHEARSAL_OK' ||
      rehearsal.projectRef !== EXPECTED_PROJECT_REF ||
      rehearsal.candidate?.repository?.commit !==
        PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE.commit ||
      rehearsal.candidate?.repository?.tree !==
        PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE.tree ||
      rehearsal.candidate?.repository?.clean !== true ||
      rehearsal.candidate?.migration?.version !==
        PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE.migrationVersion ||
      rehearsal.candidate?.migration?.sha256 !==
        PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE.migrationSha256) {
    throw new Error('The sealed source-provenance rehearsal chain is malformed.');
  }
  assertExact(
    rehearsal.candidate.priorEvidence,
    PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE.predecessorCoverEvidence,
    'historical source-provenance cover predecessor',
  );
  assertExact(rehearsal.database, SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
    'historical source-provenance database target');
  if (rehearsal.projectRef !== expectedDatabase.projectRef) {
    throw new Error('The historical source-provenance project target changed.');
  }
  assertExact(
    rehearsal.databaseReceipt,
    EXPECTED_PREDECESSOR_SOURCE_REHEARSAL_DATABASE_RECEIPT,
    'historical source-provenance database receipt',
  );
  if (rehearsal.databaseReceiptSha256 !==
      sha256(JSON.stringify(rehearsal.databaseReceipt)) ||
      rehearsal.execution?.exitCode !== 0 ||
      rehearsal.execution?.credentialsPersisted !== false ||
      rehearsal.execution?.sqlSha256 !==
        rehearsal.candidate?.artifacts?.emittedRehearsal?.sha256 ||
      !/^[a-f0-9]{64}$/.test(String(rehearsal.execution?.stdoutSha256 || '')) ||
      !/^[a-f0-9]{64}$/.test(String(rehearsal.execution?.stderrSha256 || ''))) {
    throw new Error('The historical source-provenance execution binding is invalid.');
  }
  const started = Date.parse(rehearsal.startedAt);
  const finished = Date.parse(rehearsal.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
    throw new Error('The historical source-provenance execution chronology is invalid.');
  }
  assertHistoricalPathBindings(rehearsal, options);
  runGit(['rev-parse', '--verify',
    `${PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE.commit}^{commit}`], options);
  if (runGit(['show', '-s', '--format=%T',
      PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE.commit], options) !==
      PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE.tree) {
    throw new Error('The historical source-provenance tree binding changed.');
  }
  runGit([
    'merge-base', '--is-ancestor',
    PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE.commit,
    options.repositoryCommit || runGit(['rev-parse', 'HEAD'], options),
  ], options);
  return { ...PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE };
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
    throw new Error('Source-provenance ACL migration has no exact transaction boundary.');
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
    throw new Error(`Source-provenance ACL migration is missing: ${MIGRATION.name}`);
  }
  const digest = sha256File(migrationPath);
  if (digest !== MIGRATION.sha256) {
    throw new Error('Source-provenance ACL migration digest changed after freeze.');
  }
  return {
    version: MIGRATION.version,
    path: path.posix.join('supabase', 'migrations', MIGRATION.name),
    sha256: digest,
  };
}

function emitRehearsalSql(options = {}) {
  const marker = `-- @apply-source-provenance-acl-migration ${MIGRATION.version}`;
  const template = options.rehearsalTemplateSql === undefined
    ? fs.readFileSync(rehearsalTemplatePath, 'utf8')
    : String(options.rehearsalTemplateSql);
  if (template.split(marker).length - 1 !== 1) {
    throw new Error('Source-provenance ACL rehearsal marker is not exact.');
  }
  const migration = migrationReceipt();
  const body = stripTransactionBoundary(fs.readFileSync(
    path.join(repoRoot, migration.path),
    'utf8',
  ));
  const injectedBody = [
    `-- BEGIN SOURCE-PROVENANCE-ACL MIGRATION ${migration.version} SHA256 ${migration.sha256}`,
    body,
    `-- END SOURCE-PROVENANCE-ACL MIGRATION ${migration.version}`,
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
    assertPredecessorSourceProvenanceEvidence({
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
    throw new Error(`${label} does not match the sealed source-provenance ACL value.`);
  }
}

function validateDatabasePayload(payload, mode) {
  const expected = mode === 'rehearsal'
    ? EXPECTED_REHEARSAL_DATABASE_RECEIPT
    : mode === 'postapply'
      ? EXPECTED_POSTAPPLY_DATABASE_RECEIPT
      : null;
  if (!expected) throw new Error(`Unknown source-provenance ACL evidence mode: ${mode}`);
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
    throw new Error('The source-provenance ACL postapply receipt requires the rehearsal digest.');
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
    throw new Error(`The ${mode} source-provenance ACL receipt is malformed.`);
  }
  assertExact(
    receipt.database,
    SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
    `${mode} source-provenance ACL database target`,
  );
  assertExact(receipt.candidate, candidate, `${mode} candidate`);
  assertExact(
    candidate.priorEvidence,
    PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE,
    'predecessor source-provenance evidence',
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
    throw new Error(`The ${mode} source-provenance ACL execution binding is invalid.`);
  }
  const started = Date.parse(receipt.startedAt);
  const finished = Date.parse(receipt.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) ||
      finished < started || finished > nowMs + FUTURE_CLOCK_SKEW_MS ||
      nowMs - finished > RECEIPT_MAX_AGE_MS) {
    throw new Error(`The ${mode} source-provenance ACL receipt is stale.`);
  }
  return { started, finished };
}

function validateEvidence({ rehearsal, postapply, candidate, now = new Date() }) {
  const nowMs = now.getTime();
  const rehearsalTime = validateReceipt(rehearsal, 'rehearsal', candidate, nowMs);
  const postapplyTime = validateReceipt(postapply, 'postapply', candidate, nowMs);
  if (postapplyTime.started < rehearsalTime.finished) {
    throw new Error('Source-provenance ACL postapply verification predates its rehearsal.');
  }
  const rehearsalDigest = sha256(`${JSON.stringify(rehearsal, null, 2)}\n`);
  if (postapply.priorReceiptSha256 !== rehearsalDigest) {
    throw new Error('The source-provenance ACL postapply receipt lost its rehearsal chain.');
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
  EXPECTED_PREDECESSOR_SOURCE_REHEARSAL_DATABASE_RECEIPT,
  EXPECTED_PROJECT_REF,
  EXPECTED_REHEARSAL_DATABASE_RECEIPT,
  MIGRATION,
  MIGRATION_HISTORY,
  POSTAPPLY_MARKER,
  PREDECESSOR_SOURCE_PROVENANCE_EVIDENCE,
  REHEARSAL_MARKER,
  SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
  assertPredecessorSourceProvenanceEvidence,
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
