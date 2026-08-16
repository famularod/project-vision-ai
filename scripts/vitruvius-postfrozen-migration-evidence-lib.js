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
const REHEARSAL_MARKER = 'VITRUVIUS_POSTFROZEN_MIGRATION_REHEARSAL_OK';
const POSTAPPLY_MARKER = 'VITRUVIUS_POSTFROZEN_POSTAPPLY_OK';
const TRANSITION_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: '20260811021601',
    name: '20260811021601_exact_project_delete_rpc.sql',
  }),
  Object.freeze({
    version: '20260811151028',
    name: '20260811151028_dave_project_cover_commit_authority.sql',
  }),
]);
const outputDirectory = path.join(repoRoot, 'validation', 'output');
const rehearsalReceiptPath = path.join(
  outputDirectory,
  'vitruvius-postfrozen-migration-rehearsal-receipt.json',
);
const postapplyReceiptPath = path.join(
  outputDirectory,
  'vitruvius-postfrozen-migration-postapply-receipt.json',
);
const rehearsalTemplatePath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'vitruvius-postfrozen-migration-adversarial-rollback.sql',
);
const postapplyVerifierPath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'vitruvius-postfrozen-migration-postapply-verify.sql',
);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function run(command, args, options = {}) {
  const result = (options.spawn || spawnSync)(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    timeout: options.timeout || 60_000,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(
      result.error?.message || String(result.stderr || '').trim() ||
        `${command} exited with ${String(result.status)}`,
    );
  }
  return String(result.stdout || '');
}

function repositorySnapshot(options = {}) {
  const runGit = args => run('git', args, options);
  const commit = runGit(['rev-parse', 'HEAD']).trim();
  const tree = runGit(['rev-parse', 'HEAD^{tree}']).trim();
  const status = runGit(['status', '--porcelain=v1', '--untracked-files=normal']);
  return {
    commit,
    tree,
    clean: status.trim().length === 0,
  };
}

function stripTransactionBoundary(sql, name) {
  const lines = String(sql).split(/\r?\n/);
  const beginIndexes = lines
    .map((line, index) => line.trim().toLowerCase() === 'begin;' ? index : -1)
    .filter(index => index >= 0);
  const commitIndexes = lines
    .map((line, index) => line.trim().toLowerCase() === 'commit;' ? index : -1)
    .filter(index => index >= 0);
  if (beginIndexes.length !== 1 || commitIndexes.length !== 1 ||
      commitIndexes[0] <= beginIndexes[0]) {
    throw new Error(`${name} does not have one exact top-level transaction boundary.`);
  }
  return [
    ...lines.slice(0, beginIndexes[0]),
    ...lines.slice(beginIndexes[0] + 1, commitIndexes[0]),
    ...lines.slice(commitIndexes[0] + 1),
  ].join('\n').trim();
}

function transitionMigrations() {
  return TRANSITION_MIGRATIONS.map(({ version, name }) => {
    const filePath = path.join(repoRoot, 'supabase', 'migrations', name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Post-frozen migration is missing: ${name}`);
    }
    return {
      version,
      path: path.posix.join('supabase', 'migrations', name),
      sha256: sha256File(filePath),
    };
  });
}

function emitRehearsalSql() {
  let emitted = fs.readFileSync(rehearsalTemplatePath, 'utf8');
  for (const migration of transitionMigrations()) {
    const marker = `-- @apply-post-frozen-migration ${migration.version}`;
    if (emitted.split(marker).length - 1 !== 1) {
      throw new Error(`Post-frozen rehearsal marker is not exact: ${marker}`);
    }
    const body = stripTransactionBoundary(
      fs.readFileSync(path.join(repoRoot, migration.path), 'utf8'),
      migration.path,
    );
    emitted = emitted.replace(
      marker,
      () => [
        `-- BEGIN POST-FROZEN MIGRATION ${migration.version} SHA256 ${migration.sha256}`,
        body,
        `-- END POST-FROZEN MIGRATION ${migration.version}`,
      ].join('\n'),
    );
  }
  return emitted;
}

function currentCandidate(options = {}) {
  const emittedSql = options.emittedSql || emitRehearsalSql();
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    repository: options.repository || repositorySnapshot(options),
    migrations: transitionMigrations(),
    artifacts: {
      evidenceLibrary: {
        path: 'scripts/vitruvius-postfrozen-migration-evidence-lib.js',
        sha256: sha256File(__filename),
      },
      rehearsalTemplate: {
        path: 'validation/ecos/vitruvius-postfrozen-migration-adversarial-rollback.sql',
        sha256: sha256File(rehearsalTemplatePath),
      },
      emittedRehearsal: { sha256: sha256(emittedSql) },
      postapplyVerifier: {
        path: 'validation/ecos/vitruvius-postfrozen-migration-postapply-verify.sql',
        sha256: sha256File(postapplyVerifierPath),
      },
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

function validateDatabasePayload(payload, mode) {
  const marker = mode === 'rehearsal' ? REHEARSAL_MARKER : POSTAPPLY_MARKER;
  if (payload?.receipt !== marker || JSON.stringify(payload.migrationOrder) !==
      JSON.stringify(TRANSITION_MIGRATIONS.map(item => item.version))) {
    throw new Error(`The ${mode} post-frozen database receipt is malformed.`);
  }
  const required = mode === 'rehearsal'
    ? [
        'outerTransactionRolledBack',
        'exactProjectDeletion',
        'sameNameSiblingPreserved',
        'coverReceiptCommitted',
        'coverRetryIdempotent',
        'directCoverMutationDenied',
      ]
    : [];
  for (const key of required) {
    if (payload[key] !== true) throw new Error(`Post-frozen rehearsal did not prove ${key}.`);
  }
  const zeroKeys = mode === 'rehearsal'
    ? ['providerCallsMade']
    : ['legacyDeleteFunctionsPresent', 'providerCallsMadeByVerifier'];
  for (const key of zeroKeys) {
    if (payload[key] !== 0) throw new Error(`Post-frozen ${mode} reported unsafe ${key}.`);
  }
  if (mode === 'postapply' && (
    payload.transitionFunctionsPresent !== 2 ||
    payload.coverAuthorityTriggersEnabled !== 1 ||
    payload.storagePoliciesExact !== 2
  )) {
    throw new Error('Post-frozen postapply catalog receipt is incomplete.');
  }
  return true;
}

function makeReceipt({
  mode, candidate, database, databasePayload, stdout, stderr, executedSql,
  startedAt, finishedAt, priorReceiptSha256,
}) {
  validateDatabasePayload(databasePayload, mode);
  if (mode === 'postapply' && !/^[a-f0-9]{64}$/.test(String(priorReceiptSha256 || ''))) {
    throw new Error('The postapply receipt requires the rehearsal receipt digest.');
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

function assertExact(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the sealed post-frozen candidate.`);
  }
}

function validateReceipt(receipt, mode, candidate, nowMs) {
  const marker = mode === 'rehearsal' ? REHEARSAL_MARKER : POSTAPPLY_MARKER;
  if (receipt?.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
      receipt.kind !== mode || receipt.receipt !== marker ||
      receipt.projectRef !== EXPECTED_PROJECT_REF) {
    throw new Error(`The ${mode} post-frozen receipt is malformed.`);
  }
  if (candidate.repository.clean !== true) {
    throw new Error('The post-frozen release candidate working tree is not clean.');
  }
  assertExact(receipt.candidate, candidate, `${mode} candidate`);
  validateDatabasePayload(receipt.databaseReceipt, mode);
  if (receipt.databaseReceiptSha256 !== sha256(JSON.stringify(receipt.databaseReceipt))) {
    throw new Error(`The ${mode} database receipt digest is invalid.`);
  }
  const expectedSql = mode === 'rehearsal'
    ? candidate.artifacts.emittedRehearsal.sha256
    : candidate.artifacts.postapplyVerifier.sha256;
  if (receipt.execution?.exitCode !== 0 ||
      receipt.execution?.credentialsPersisted !== false ||
      receipt.execution?.sqlSha256 !== expectedSql) {
    throw new Error(`The ${mode} execution is not bound to the sealed SQL.`);
  }
  const started = Date.parse(receipt.startedAt);
  const finished = Date.parse(receipt.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) ||
      finished < started || finished > nowMs + FUTURE_CLOCK_SKEW_MS ||
      nowMs - finished > RECEIPT_MAX_AGE_MS) {
    throw new Error(`The ${mode} post-frozen evidence timestamps are invalid or stale.`);
  }
  return { started, finished };
}

function validateEvidence({ rehearsal, postapply, candidate, now = new Date() }) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const rehearsalTimes = validateReceipt(rehearsal, 'rehearsal', candidate, nowMs);
  const postapplyTimes = validateReceipt(postapply, 'postapply', candidate, nowMs);
  if (postapplyTimes.started < rehearsalTimes.finished) {
    throw new Error('Post-frozen postapply verification predates its rollback rehearsal.');
  }
  const rehearsalReceiptSha256 = sha256(`${JSON.stringify(rehearsal, null, 2)}\n`);
  if (postapply.priorReceiptSha256 !== rehearsalReceiptSha256) {
    throw new Error('The postapply rehearsal receipt digest does not match.');
  }
  return true;
}

function writeReceipt(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

module.exports = {
  EXPECTED_PROJECT_REF,
  POSTAPPLY_MARKER,
  REHEARSAL_MARKER,
  TRANSITION_MIGRATIONS,
  currentCandidate,
  canonicalizeDatabaseUrl,
  emitRehearsalSql,
  extractDatabaseTarget,
  makeReceipt,
  parseDatabaseReceipt,
  postapplyReceiptPath,
  postapplyVerifierPath,
  rehearsalReceiptPath,
  sha256,
  validateDatabasePayload,
  validateEvidence,
  writeReceipt,
};
