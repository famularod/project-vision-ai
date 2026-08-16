#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  EXPECTED_PROJECT_REF,
  POSTAPPLY_MARKER,
  REHEARSAL_MARKER,
  canonicalizeDatabaseUrl,
  currentCandidateEvidence,
  emitRehearsalSql,
  extractDatabaseTarget,
  makeEvidenceReceipt,
  parseDatabaseReceipt,
  postapplyReceiptPath,
  postapplyVerifierPath,
  rehearsalReceiptPath,
  writeReceipt,
} = require('./ecos-build160-migration-evidence-lib');

const modes = {
  rehearsal: {
    databaseEnv: 'ECOS_BUILD160_REHEARSAL_DATABASE_URL',
    confirmationEnv: 'ECOS_BUILD160_REHEARSAL_CONFIRM',
    expectedConfirmation: `ROLLBACK_ONLY_PREAPPLY_${EXPECTED_PROJECT_REF.toUpperCase()}`,
    marker: REHEARSAL_MARKER,
    receiptPath: rehearsalReceiptPath,
  },
  postapply: {
    databaseEnv: 'ECOS_BUILD160_POSTAPPLY_DATABASE_URL',
    confirmationEnv: 'ECOS_BUILD160_POSTAPPLY_CONFIRM',
    expectedConfirmation: `READ_ONLY_POSTAPPLY_${EXPECTED_PROJECT_REF.toUpperCase()}`,
    marker: POSTAPPLY_MARKER,
    receiptPath: postapplyReceiptPath,
  },
};

function sanitizedPsqlEnvironment(env, config, databaseUrl) {
  const childEnv = { ...env };
  delete childEnv[config.databaseEnv];
  delete childEnv[config.confirmationEnv];
  childEnv.PGDATABASE = databaseUrl;
  childEnv.PGAPPNAME = 'vitruvius-build160-migration-evidence';
  childEnv.PGCONNECT_TIMEOUT = '15';
  childEnv.PGOPTIONS = '-c statement_timeout=900000 -c lock_timeout=5000';
  return childEnv;
}

function sanitizeDatabaseError(value, databaseUrl) {
  let sanitized = String(value || '');
  if (databaseUrl) sanitized = sanitized.split(String(databaseUrl)).join('[redacted database URL]');
  return sanitized.replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    '[redacted database URL]',
  );
}

function executePsql({ sql, env, config, databaseUrl, spawn = spawnSync }) {
  const result = spawn(
    'psql',
    [
      '--no-psqlrc',
      '--no-password',
      '--set=ON_ERROR_STOP=1',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--file=-',
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      input: sql,
      env: sanitizedPsqlEnvironment(env, config, databaseUrl),
      maxBuffer: 256 * 1024 * 1024,
      timeout: 20 * 60_000,
      killSignal: 'SIGTERM',
    },
  );
  if (result.status !== 0 || result.error) {
    const detail = result.error?.code === 'ETIMEDOUT'
      ? 'the controlled database verification timed out'
      : String(result.stderr || '').trim().split(/\r?\n/).slice(-8).join('\n')
        || 'psql returned a nonzero status';
    throw new Error(sanitizeDatabaseError(detail, databaseUrl));
  }
  return {
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function runEvidenceMode(mode, env = process.env, options = {}) {
  const config = modes[mode];
  if (!config) throw new Error('Usage: ecos-build160-migration-evidence.js rehearsal|postapply');
  if (env[config.confirmationEnv] !== config.expectedConfirmation) {
    throw new Error(
      `${config.confirmationEnv} must explicitly confirm the exact controlled ${mode} operation.`,
    );
  }
  const databaseUrl = env[config.databaseEnv];
  const database = extractDatabaseTarget(databaseUrl);
  const controlledDatabaseUrl = canonicalizeDatabaseUrl(databaseUrl);
  const emittedSql = options.emittedSql || emitRehearsalSql(options);
  const candidate = currentCandidateEvidence({ ...options, emittedSql });
  if (!candidate.repository.clean) {
    throw new Error('The migration evidence runner requires a clean, committed release candidate.');
  }

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
    databaseUrl: controlledDatabaseUrl,
    spawn: options.spawnPsql,
  });
  const finishedAt = new Date().toISOString();
  const databasePayload = parseDatabaseReceipt(result.stdout, config.marker);
  const receipt = makeEvidenceReceipt({
    mode,
    candidate,
    database,
    databasePayload,
    stdout: result.stdout,
    stderr: result.stderr,
    executedSql: sql,
    startedAt,
    finishedAt,
  });
  writeReceipt(config.receiptPath, receipt);
  return { receipt, receiptPath: config.receiptPath };
}

function main() {
  try {
    const mode = process.argv[2];
    const result = runEvidenceMode(mode);
    console.log(`${result.receipt.receipt}: PASS`);
    console.log(`Candidate commit: ${result.receipt.candidate.repository.commit}`);
    console.log(`Supabase project: ${result.receipt.projectRef}`);
    console.log(`Receipt: ${path.relative(path.resolve(__dirname, '..'), result.receiptPath)}`);
  } catch (error) {
    console.error(`ECOS Build 160 migration evidence FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  executePsql,
  modes,
  runEvidenceMode,
  sanitizeDatabaseError,
  sanitizedPsqlEnvironment,
};
