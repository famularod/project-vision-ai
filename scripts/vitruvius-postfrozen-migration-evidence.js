#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
} = require('./vitruvius-postfrozen-migration-evidence-lib');

const repoRoot = path.resolve(__dirname, '..');
const modes = {
  rehearsal: {
    databaseEnv: 'VITRUVIUS_POSTFROZEN_REHEARSAL_DATABASE_URL',
    confirmationEnv: 'VITRUVIUS_POSTFROZEN_REHEARSAL_CONFIRM',
    expectedConfirmation: `ROLLBACK_ONLY_POSTFROZEN_${EXPECTED_PROJECT_REF.toUpperCase()}`,
    marker: REHEARSAL_MARKER,
    receiptPath: rehearsalReceiptPath,
  },
  postapply: {
    databaseEnv: 'VITRUVIUS_POSTFROZEN_POSTAPPLY_DATABASE_URL',
    confirmationEnv: 'VITRUVIUS_POSTFROZEN_POSTAPPLY_CONFIRM',
    expectedConfirmation: `READ_ONLY_POSTFROZEN_${EXPECTED_PROJECT_REF.toUpperCase()}`,
    marker: POSTAPPLY_MARKER,
    receiptPath: postapplyReceiptPath,
  },
};

function sanitizedEnvironment(env, config, databaseUrl) {
  const childEnv = { ...env };
  delete childEnv[config.databaseEnv];
  delete childEnv[config.confirmationEnv];
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('PG')) delete childEnv[key];
  }

  const parsed = new URL(canonicalizeDatabaseUrl(databaseUrl));
  if (!parsed.password) {
    throw new Error('The controlled database URL must include a password.');
  }
  childEnv.PGHOST = parsed.hostname;
  childEnv.PGPORT = parsed.port;
  childEnv.PGUSER = decodeURIComponent(parsed.username);
  childEnv.PGPASSWORD = decodeURIComponent(parsed.password);
  childEnv.PGDATABASE = decodeURIComponent(parsed.pathname.slice(1));
  childEnv.PGSSLMODE = parsed.searchParams.get('sslmode');
  childEnv.PGAPPNAME = 'vitruvius-postfrozen-migration-evidence';
  childEnv.PGCONNECT_TIMEOUT = '15';
  childEnv.PGOPTIONS = '-c statement_timeout=900000 -c lock_timeout=5000';
  return childEnv;
}

function controlledSqlInput(databaseUrl, sql) {
  const callerSql = String(sql);
  if (/\breset[\t\r\n ]+role[\t\r\n ]*;/i.test(callerSql)) {
    throw new Error(
      'Controlled database evidence SQL must restore postgres explicitly; RESET ROLE is forbidden.',
    );
  }
  const parsed = new URL(canonicalizeDatabaseUrl(databaseUrl));
  const username = decodeURIComponent(parsed.username);
  let expectedSessionUser;
  if (
    username === 'postgres'
    || username === `postgres.${EXPECTED_PROJECT_REF}`
  ) {
    expectedSessionUser = 'postgres';
  } else if (username === `cli_login_postgres.${EXPECTED_PROJECT_REF}`) {
    expectedSessionUser = 'cli_login_postgres';
  } else {
    throw new Error('The controlled database login cannot establish an approved session role.');
  }
  return [
    'SET ROLE postgres;',
    'DO $vitruvius_evidence_role_guard$',
    'BEGIN',
    "  IF current_user IS DISTINCT FROM 'postgres' THEN",
    "    RAISE EXCEPTION 'Vitruvius role guard rejected current_user: %', current_user;",
    '  END IF;',
    `  IF session_user IS DISTINCT FROM '${expectedSessionUser}' THEN`,
    "    RAISE EXCEPTION 'Vitruvius role guard rejected session_user: %', session_user;",
    '  END IF;',
    'END',
    '$vitruvius_evidence_role_guard$;',
    '-- BEGIN CONTROLLED EVIDENCE SQL',
    callerSql,
  ].join('\n');
}

function sanitizeError(value, databaseUrl) {
  let sanitized = String(value || '');
  if (databaseUrl) {
    sanitized = sanitized
      .split(String(databaseUrl)).join('[redacted database URL]');
  }
  sanitized = sanitized.replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    '[redacted database URL]',
  );
  try {
    const parsed = new URL(String(databaseUrl || ''));
    const passwords = new Set([
      parsed.password,
      decodeURIComponent(parsed.password),
    ]);
    for (const password of passwords) {
      if (password) {
        sanitized = sanitized.split(password).join('[redacted database password]');
      }
    }
  } catch {
    // Error sanitization must remain best-effort and must not mask the original failure.
  }
  return sanitized;
}

function executePsql({ sql, env, config, databaseUrl, spawn = spawnSync }) {
  const input = controlledSqlInput(databaseUrl, sql);
  const result = spawn('psql', [
    '--no-psqlrc', '--no-password', '--set=ON_ERROR_STOP=1', '--quiet',
    '--tuples-only', '--no-align', '--file=-',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    env: sanitizedEnvironment(env, config, databaseUrl),
    maxBuffer: 256 * 1024 * 1024,
    timeout: 20 * 60_000,
    killSignal: 'SIGTERM',
  });
  if (result.status !== 0 || result.error) {
    const detail = result.error?.code === 'ETIMEDOUT'
      ? 'controlled database verification timed out'
      : String(result.stderr || '').trim().split(/\r?\n/).slice(-8).join('\n') ||
        'psql returned a nonzero status';
    throw new Error(sanitizeError(detail, databaseUrl));
  }
  return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

function runEvidenceMode(mode, env = process.env, options = {}) {
  const config = modes[mode];
  if (!config) throw new Error('Usage: vitruvius-postfrozen-migration-evidence.js rehearsal|postapply');
  if (env[config.confirmationEnv] !== config.expectedConfirmation) {
    throw new Error(`${config.confirmationEnv} must explicitly confirm the exact controlled operation.`);
  }
  const databaseUrl = env[config.databaseEnv];
  const database = extractDatabaseTarget(databaseUrl);
  const controlledDatabaseUrl = canonicalizeDatabaseUrl(databaseUrl);
  const emittedSql = options.emittedSql || emitRehearsalSql();
  const candidate = currentCandidate({ ...options, emittedSql });
  if (!candidate.repository.clean) {
    throw new Error('Post-frozen evidence requires a clean committed release candidate.');
  }
  let priorReceiptSha256;
  if (mode === 'postapply') {
    if (!fs.existsSync(rehearsalReceiptPath)) {
      throw new Error('Post-frozen postapply verification requires the rehearsal receipt.');
    }
    priorReceiptSha256 = sha256(fs.readFileSync(rehearsalReceiptPath));
  }

  fs.rmSync(config.receiptPath, { force: true });
  if (mode === 'rehearsal') fs.rmSync(postapplyReceiptPath, { force: true });
  const sql = mode === 'rehearsal'
    ? emittedSql
    : fs.readFileSync(postapplyVerifierPath, 'utf8');
  const startedAt = new Date().toISOString();
  const result = executePsql({
    sql, env, config, databaseUrl: controlledDatabaseUrl, spawn: options.spawnPsql,
  });
  const finishedAt = new Date().toISOString();
  const databasePayload = parseDatabaseReceipt(result.stdout, config.marker);
  const receipt = makeReceipt({
    mode, candidate, database, databasePayload,
    stdout: result.stdout, stderr: result.stderr, executedSql: sql,
    startedAt, finishedAt, priorReceiptSha256,
  });
  writeReceipt(config.receiptPath, receipt);
  const receiptSha256 = sha256(fs.readFileSync(config.receiptPath));
  return { receipt, receiptPath: config.receiptPath, receiptSha256 };
}

function main() {
  try {
    const result = runEvidenceMode(process.argv[2]);
    console.log(`${result.receipt.receipt}: PASS`);
    console.log(`Candidate commit: ${result.receipt.candidate.repository.commit}`);
    console.log(`Receipt: ${path.relative(repoRoot, result.receiptPath)}`);
    console.log(`Receipt SHA-256: ${result.receiptSha256}`);
  } catch (error) {
    console.error(`Vitruvius post-frozen migration evidence FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  controlledSqlInput,
  executePsql,
  modes,
  runEvidenceMode,
  sanitizeError,
  sanitizedEnvironment,
};
