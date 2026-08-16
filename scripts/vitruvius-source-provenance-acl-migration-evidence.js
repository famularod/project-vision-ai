#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { executePsql } = require('./vitruvius-postfrozen-migration-evidence');
const {
  EXPECTED_PROJECT_REF,
  POSTAPPLY_MARKER,
  REHEARSAL_MARKER,
  canonicalizeDatabaseUrl,
  currentCandidate,
  emitRehearsalSql,
  extractDatabaseTarget,
  makeReceipt,
  parseDatabaseReceipt,
  postapplyReceiptPath,
  postapplyVerifierPath,
  rehearsalReceiptPath,
  sha256,
  writeReceipt,
} = require('./vitruvius-source-provenance-acl-migration-evidence-lib');

const modes = Object.freeze({
  rehearsal: Object.freeze({
    databaseEnv: 'VITRUVIUS_SOURCE_PROVENANCE_ACL_REHEARSAL_DATABASE_URL',
    confirmationEnv: 'VITRUVIUS_SOURCE_PROVENANCE_ACL_REHEARSAL_CONFIRM',
    expectedConfirmation:
      `ROLLBACK_ONLY_SOURCE_PROVENANCE_ACL_${EXPECTED_PROJECT_REF.toUpperCase()}`,
    marker: REHEARSAL_MARKER,
    receiptPath: rehearsalReceiptPath,
  }),
  postapply: Object.freeze({
    databaseEnv: 'VITRUVIUS_SOURCE_PROVENANCE_ACL_POSTAPPLY_DATABASE_URL',
    confirmationEnv: 'VITRUVIUS_SOURCE_PROVENANCE_ACL_POSTAPPLY_CONFIRM',
    expectedConfirmation:
      `READ_ONLY_SOURCE_PROVENANCE_ACL_${EXPECTED_PROJECT_REF.toUpperCase()}`,
    marker: POSTAPPLY_MARKER,
    receiptPath: postapplyReceiptPath,
  }),
});

function runEvidenceMode(mode, env = process.env, options = {}) {
  const config = modes[mode];
  if (!config) {
    throw new Error(
      'Usage: vitruvius-source-provenance-acl-migration-evidence.js rehearsal|postapply',
    );
  }
  if (env[config.confirmationEnv] !== config.expectedConfirmation) {
    throw new Error(`${config.confirmationEnv} must confirm the controlled operation.`);
  }
  const databaseUrl = env[config.databaseEnv];
  const database = extractDatabaseTarget(databaseUrl);
  const emittedSql = options.emittedSql || emitRehearsalSql(options);
  const candidate = currentCandidate({ ...options, emittedSql });
  if (candidate.repository.clean !== true) {
    throw new Error(
      'Source-provenance ACL evidence requires a clean, exact committed candidate.',
    );
  }

  let priorReceiptSha256;
  if (mode === 'postapply') {
    if (!fs.existsSync(rehearsalReceiptPath)) {
      throw new Error('Source-provenance ACL postapply requires its rehearsal receipt.');
    }
    priorReceiptSha256 = sha256(fs.readFileSync(rehearsalReceiptPath));
  }

  // Remove stale receipts only after every preflight and clean-candidate check.
  fs.rmSync(config.receiptPath, { force: true });
  if (mode === 'rehearsal') fs.rmSync(postapplyReceiptPath, { force: true });
  const sql = mode === 'rehearsal'
    ? emittedSql
    : fs.readFileSync(postapplyVerifierPath, 'utf8');
  const startedAt = new Date().toISOString();
  const result = executePsql({
    sql,
    env,
    config,
    databaseUrl: canonicalizeDatabaseUrl(databaseUrl),
    spawn: options.spawnPsql,
  });
  const finishedAt = new Date().toISOString();
  const databasePayload = parseDatabaseReceipt(result.stdout, config.marker);
  const receipt = makeReceipt({
    mode,
    candidate,
    database,
    databasePayload,
    executedSql: sql,
    stdout: result.stdout,
    stderr: result.stderr,
    startedAt,
    finishedAt,
    priorReceiptSha256,
  });
  writeReceipt(config.receiptPath, receipt);
  return {
    receipt,
    receiptPath: config.receiptPath,
    receiptSha256: sha256(fs.readFileSync(config.receiptPath)),
  };
}

function main() {
  try {
    const result = runEvidenceMode(process.argv[2]);
    console.log(`${result.receipt.receipt}: PASS`);
    console.log(`Receipt: ${path.relative(process.cwd(), result.receiptPath)}`);
    console.log(`Receipt SHA-256: ${result.receiptSha256}`);
  } catch (error) {
    console.error(`Source-provenance ACL migration evidence FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { modes, runEvidenceMode };
