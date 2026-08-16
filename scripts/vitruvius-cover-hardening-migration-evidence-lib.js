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
const REHEARSAL_MARKER = 'VITRUVIUS_COVER_HARDENING_MIGRATION_REHEARSAL_OK';
const POSTAPPLY_MARKER = 'VITRUVIUS_COVER_HARDENING_POSTAPPLY_OK';
const MIGRATION = Object.freeze({
  version: '20260812011945',
  name: '20260812011945_ecos_visual_exception_dismissal_authority.sql',
});
const HISTORICAL_TRANSITION = Object.freeze({
  commit: '3ffe78ecaec17056b189c4cf525ede8b89a6c7c6',
  rehearsalSha256: '29be874943e31f130a78eae0e72d4e4ca76b4aa625825f80605ddbb837298f1e',
  postapplySha256: 'a4609778e383d6627077b31c22663caf57276f2ef0f3076306dcd003913bce3d',
});
const outputDirectory = path.join(repoRoot, 'validation', 'output');
const rehearsalReceiptPath = path.join(
  outputDirectory, 'vitruvius-cover-hardening-migration-rehearsal-receipt.json',
);
const postapplyReceiptPath = path.join(
  outputDirectory, 'vitruvius-cover-hardening-migration-postapply-receipt.json',
);
const rehearsalTemplatePath = path.join(
  repoRoot, 'validation', 'ecos',
  'vitruvius-cover-hardening-migration-adversarial-rollback.sql',
);
const postapplyVerifierPath = path.join(
  repoRoot, 'validation', 'ecos',
  'vitruvius-cover-hardening-migration-postapply-verify.sql',
);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}
function runGit(args, options = {}) {
  const result = (options.spawnGit || spawnSync)('git', args, {
    cwd: repoRoot, encoding: 'utf8', timeout: 30_000,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(result.error?.message || String(result.stderr || '').trim());
  }
  return String(result.stdout || '').trim();
}
function repositorySnapshot(options = {}) {
  const commit = runGit(['rev-parse', 'HEAD'], options);
  const tree = runGit(['rev-parse', 'HEAD^{tree}'], options);
  const status = runGit(['status', '--porcelain=v1', '--untracked-files=normal'], options);
  return { commit, tree, clean: status.length === 0 };
}
function assertHistoricalTransition(options = {}) {
  const rehearsalPath = path.join(
    outputDirectory, 'vitruvius-postfrozen-migration-rehearsal-receipt.json',
  );
  const postapplyPath = path.join(
    outputDirectory, 'vitruvius-postfrozen-migration-postapply-receipt.json',
  );
  if (!fs.existsSync(rehearsalPath) || !fs.existsSync(postapplyPath)) {
    throw new Error('The sealed seven-migration evidence receipts are missing.');
  }
  if (sha256File(rehearsalPath) !== HISTORICAL_TRANSITION.rehearsalSha256 ||
      sha256File(postapplyPath) !== HISTORICAL_TRANSITION.postapplySha256) {
    throw new Error('The sealed seven-migration evidence receipt digest changed.');
  }
  const rehearsal = JSON.parse(fs.readFileSync(rehearsalPath, 'utf8'));
  const postapply = JSON.parse(fs.readFileSync(postapplyPath, 'utf8'));
  if (rehearsal?.candidate?.repository?.commit !== HISTORICAL_TRANSITION.commit ||
      postapply?.candidate?.repository?.commit !== HISTORICAL_TRANSITION.commit ||
      postapply?.priorReceiptSha256 !== HISTORICAL_TRANSITION.rehearsalSha256) {
    throw new Error('The sealed seven-migration evidence chain is malformed.');
  }
  const descendant = runGit([
    'merge-base', '--is-ancestor', HISTORICAL_TRANSITION.commit,
    options.repositoryCommit || runGit(['rev-parse', 'HEAD'], options),
  ], options);
  void descendant;
  return { ...HISTORICAL_TRANSITION };
}
function stripTransactionBoundary(sql) {
  const lines = String(sql).split(/\r?\n/);
  const beginIndexes = lines.map((line, index) =>
    line.trim().toLowerCase() === 'begin;' ? index : -1).filter(index => index >= 0);
  const commitIndexes = lines.map((line, index) =>
    line.trim().toLowerCase() === 'commit;' ? index : -1).filter(index => index >= 0);
  if (beginIndexes.length !== 1 || commitIndexes.length !== 1 ||
      commitIndexes[0] <= beginIndexes[0]) {
    throw new Error('Final hardening migration has no exact transaction boundary.');
  }
  return [
    ...lines.slice(0, beginIndexes[0]),
    ...lines.slice(beginIndexes[0] + 1, commitIndexes[0]),
    ...lines.slice(commitIndexes[0] + 1),
  ].join('\n').trim();
}
function migrationReceipt() {
  const migrationPath = path.join(repoRoot, 'supabase', 'migrations', MIGRATION.name);
  return {
    version: MIGRATION.version,
    path: path.posix.join('supabase', 'migrations', MIGRATION.name),
    sha256: sha256File(migrationPath),
  };
}
function emitRehearsalSql() {
  const marker = `-- @apply-cover-hardening-migration ${MIGRATION.version}`;
  let emitted = fs.readFileSync(rehearsalTemplatePath, 'utf8');
  if (emitted.split(marker).length - 1 !== 1) {
    throw new Error('Cover hardening rehearsal marker is not exact.');
  }
  const migration = migrationReceipt();
  const body = stripTransactionBoundary(fs.readFileSync(
    path.join(repoRoot, migration.path), 'utf8',
  ));
  const injectedBody = [
    `-- BEGIN COVER HARDENING MIGRATION ${migration.version} SHA256 ${migration.sha256}`,
    body,
    `-- END COVER HARDENING MIGRATION ${migration.version}`,
  ].join('\n');
  // SQL regex literals commonly end in `$'`. Passing the body as a direct
  // replacement string would make JavaScript interpret `$'` as the suffix of
  // the template and silently truncate the emitted migration. A callback
  // preserves every SQL byte exactly.
  emitted = emitted.replace(marker, () => injectedBody);
  return emitted;
}
function currentCandidate(options = {}) {
  const repository = options.repository || repositorySnapshot(options);
  const priorEvidence = options.priorEvidence || assertHistoricalTransition({
    ...options, repositoryCommit: repository.commit,
  });
  const emittedSql = options.emittedSql || emitRehearsalSql();
  return {
    schemaVersion: 1,
    repository,
    priorEvidence,
    migration: migrationReceipt(),
    artifacts: {
      evidenceLibrary: { sha256: sha256File(__filename) },
      rehearsalTemplate: { sha256: sha256File(rehearsalTemplatePath) },
      emittedRehearsal: { sha256: sha256(emittedSql) },
      postapplyVerifier: { sha256: sha256File(postapplyVerifierPath) },
    },
  };
}
function parseDatabaseReceipt(stdout, marker) {
  const matches = String(stdout || '').split(/\r?\n/).map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'))
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(value => value?.receipt === marker);
  if (matches.length !== 1) {
    throw new Error(`Database returned ${matches.length} ${marker} receipts; expected one.`);
  }
  return matches[0];
}
function validateDatabasePayload(payload, mode) {
  const marker = mode === 'rehearsal' ? REHEARSAL_MARKER : POSTAPPLY_MARKER;
  if (payload?.receipt !== marker ||
      JSON.stringify(payload.migrationOrder) !== JSON.stringify([MIGRATION.version])) {
    throw new Error(`The ${mode} cover hardening database receipt is malformed.`);
  }
  if (payload.providerCallsMade !== undefined && payload.providerCallsMade !== 0) {
    throw new Error('Cover hardening rehearsal made a provider call.');
  }
  if (payload.providerCallsMadeByVerifier !== undefined &&
      payload.providerCallsMadeByVerifier !== 0) {
    throw new Error('Cover hardening verifier made a provider call.');
  }
  if (mode === 'rehearsal' && (
    payload.outerTransactionRolledBack !== true ||
    payload.uncommittedObjectDeleted !== true ||
    payload.referencedObjectRetained !== true ||
    payload.directImmutableDeleteDenied !== true ||
    payload.factFreeVisualDismissalPersisted !== true
  )) {
    throw new Error('Cover hardening rehearsal did not prove every required race boundary.');
  }
  if (mode === 'postapply' && (
    payload.storageDeleteGuardsEnabled !== 1 ||
    payload.storageMutationPoliciesExact !== 7 ||
    payload.visualDismissalAuthorityEnabled !== 1
  )) {
    throw new Error('Cover hardening postapply catalog receipt is incomplete.');
  }
  return true;
}
function makeReceipt({ mode, candidate, database, databasePayload, executedSql,
  stdout, stderr, startedAt, finishedAt, priorReceiptSha256 }) {
  validateDatabasePayload(databasePayload, mode);
  return {
    schemaVersion: 1, kind: mode,
    receipt: mode === 'rehearsal' ? REHEARSAL_MARKER : POSTAPPLY_MARKER,
    startedAt, finishedAt, projectRef: database.projectRef,
    database: {
      host: database.host, port: database.port,
      connectionMode: database.connectionMode, sslMode: database.sslMode,
    },
    candidate, databaseReceipt: databasePayload,
    databaseReceiptSha256: sha256(JSON.stringify(databasePayload)),
    ...(mode === 'postapply' ? { priorReceiptSha256 } : {}),
    execution: {
      exitCode: 0, sqlSha256: sha256(executedSql),
      stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr),
      credentialsPersisted: false,
    },
  };
}
function assertExact(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the sealed cover hardening candidate.`);
  }
}
function validateEvidence({ rehearsal, postapply, candidate, now = new Date() }) {
  const nowMs = now.getTime();
  const receiptTimes = {};
  for (const [mode, receipt] of [['rehearsal', rehearsal], ['postapply', postapply]]) {
    const marker = mode === 'rehearsal' ? REHEARSAL_MARKER : POSTAPPLY_MARKER;
    if (receipt?.kind !== mode || receipt.receipt !== marker ||
        receipt.projectRef !== EXPECTED_PROJECT_REF || candidate.repository.clean !== true) {
      throw new Error(`The ${mode} cover hardening receipt is malformed.`);
    }
    assertExact(receipt.candidate, candidate, `${mode} candidate`);
    validateDatabasePayload(receipt.databaseReceipt, mode);
    if (receipt.databaseReceiptSha256 !== sha256(JSON.stringify(receipt.databaseReceipt)) ||
        receipt.execution?.credentialsPersisted !== false ||
        receipt.execution?.sqlSha256 !== (mode === 'rehearsal'
          ? candidate.artifacts.emittedRehearsal.sha256
          : candidate.artifacts.postapplyVerifier.sha256)) {
      throw new Error(`The ${mode} cover hardening execution binding is invalid.`);
    }
    const started = Date.parse(receipt.startedAt);
    const finished = Date.parse(receipt.finishedAt);
    if (!Number.isFinite(started) || !Number.isFinite(finished) ||
        finished < started || finished > nowMs + 300_000 ||
        nowMs - finished > 72 * 60 * 60 * 1000) {
      throw new Error(`The ${mode} cover hardening receipt is stale.`);
    }
    receiptTimes[mode] = { started, finished };
  }
  if (receiptTimes.postapply.started < receiptTimes.rehearsal.finished) {
    throw new Error('Cover hardening postapply verification predates its rehearsal.');
  }
  const rehearsalDigest = sha256(`${JSON.stringify(rehearsal, null, 2)}\n`);
  if (postapply.priorReceiptSha256 !== rehearsalDigest) {
    throw new Error('The cover hardening postapply receipt lost its rehearsal chain.');
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
  EXPECTED_PROJECT_REF, MIGRATION, POSTAPPLY_MARKER, REHEARSAL_MARKER,
  canonicalizeDatabaseUrl, currentCandidate, emitRehearsalSql,
  extractDatabaseTarget, makeReceipt, parseDatabaseReceipt,
  postapplyReceiptPath, postapplyVerifierPath, rehearsalReceiptPath,
  sha256, validateEvidence, writeReceipt,
};
