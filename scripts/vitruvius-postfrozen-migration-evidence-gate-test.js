#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  POSTAPPLY_MARKER,
  REHEARSAL_MARKER,
  TRANSITION_MIGRATIONS,
  currentCandidate,
  emitRehearsalSql,
  makeReceipt,
  postapplyVerifierPath,
  sha256,
  validateEvidence,
} = require('./vitruvius-postfrozen-migration-evidence-lib');
const {
  controlledSqlInput,
  executePsql,
  modes,
  sanitizeError,
  sanitizedEnvironment,
} = require('./vitruvius-postfrozen-migration-evidence');
const { runGate } = require('./vitruvius-postfrozen-migration-evidence-gate');
const {
  modes: coverHardeningModes,
} = require('./vitruvius-cover-hardening-migration-evidence');
const {
  modes: sourceProvenanceModes,
} = require('./vitruvius-source-provenance-migration-evidence');
const {
  emitRehearsalSql: emitSourceProvenanceRehearsalSql,
} = require('./vitruvius-source-provenance-migration-evidence-lib');

const emittedSql = emitRehearsalSql();
for (const migration of TRANSITION_MIGRATIONS) {
  const beginMarker = `-- BEGIN POST-FROZEN MIGRATION ${migration.version} SHA256 `;
  const endMarker = `-- END POST-FROZEN MIGRATION ${migration.version}`;
  assert.equal(emittedSql.split(beginMarker).length - 1, 1);
  assert.equal(emittedSql.split(endMarker).length - 1, 1);
  assert.equal(
    emittedSql.includes(`-- @apply-post-frozen-migration ${migration.version}`),
    false,
  );
}
assert(emittedSql.includes('rollback;'));
assert(emittedSql.includes(REHEARSAL_MARKER));
assert(fs.readFileSync(postapplyVerifierPath, 'utf8').includes(POSTAPPLY_MARKER));

const repository = {
  commit: '1'.repeat(40),
  tree: '2'.repeat(40),
  clean: true,
};
const candidate = currentCandidate({ emittedSql, repository });
assert.deepEqual(
  candidate.migrations.map(item => item.version),
  ['20260811021601', '20260811151028'],
);
assert.equal(candidate.artifacts.emittedRehearsal.sha256, sha256(emittedSql));

const database = {
  projectRef: 'xdytqlpsqsseoeuxgzre',
  host: 'db.xdytqlpsqsseoeuxgzre.supabase.co',
  port: '5432',
  connectionMode: 'direct',
  sslMode: 'require',
};
const rehearsalPayload = {
  receipt: REHEARSAL_MARKER,
  migrationOrder: ['20260811021601', '20260811151028'],
  outerTransactionRolledBack: true,
  exactProjectDeletion: true,
  sameNameSiblingPreserved: true,
  coverReceiptCommitted: true,
  coverRetryIdempotent: true,
  directCoverMutationDenied: true,
  providerCallsMade: 0,
};
const postapplyPayload = {
  receipt: POSTAPPLY_MARKER,
  migrationOrder: ['20260811021601', '20260811151028'],
  legacyDeleteFunctionsPresent: 0,
  transitionFunctionsPresent: 2,
  coverAuthorityTriggersEnabled: 1,
  storagePoliciesExact: 2,
  providerCallsMadeByVerifier: 0,
};
const rehearsalSql = emittedSql;
const postapplySql = fs.readFileSync(postapplyVerifierPath, 'utf8');
const rehearsal = makeReceipt({
  mode: 'rehearsal', candidate, database,
  databasePayload: rehearsalPayload,
  stdout: JSON.stringify(rehearsalPayload), stderr: '', executedSql: rehearsalSql,
  startedAt: '2026-08-11T20:00:00.000Z',
  finishedAt: '2026-08-11T20:01:00.000Z',
});
const postapply = makeReceipt({
  mode: 'postapply', candidate, database,
  databasePayload: postapplyPayload,
  stdout: JSON.stringify(postapplyPayload), stderr: '', executedSql: postapplySql,
  startedAt: '2026-08-11T20:02:00.000Z',
  finishedAt: '2026-08-11T20:03:00.000Z',
  priorReceiptSha256: sha256(`${JSON.stringify(rehearsal, null, 2)}\n`),
});
assert.equal(validateEvidence({
  rehearsal, postapply, candidate, now: new Date('2026-08-11T20:04:00.000Z'),
}), true);

const receiptBytes = value => `${JSON.stringify(value, null, 2)}\n`;
const expectedDigests = {
  rehearsal: sha256(receiptBytes(rehearsal)),
  postapply: sha256(receiptBytes(postapply)),
};
assert.equal(
  runGate({ candidate, rehearsal, postapply, expectedDigests }).candidate,
  candidate,
);
assert.throws(
  () => runGate({ candidate, rehearsal, postapply }),
  /independent receipt digest/i,
);
assert.throws(
  () => runGate({
    candidate,
    rehearsal,
    postapply,
    expectedDigests: { ...expectedDigests, postapply: '0'.repeat(64) },
  }),
  /independent receipt digest/i,
);

const wrongReceiptChain = structuredClone(postapply);
wrongReceiptChain.priorReceiptSha256 = '0'.repeat(64);
assert.throws(
  () => validateEvidence({
    rehearsal,
    postapply: wrongReceiptChain,
    candidate,
    now: new Date('2026-08-11T20:04:00.000Z'),
  }),
  /rehearsal receipt digest/i,
);

const mutated = structuredClone(postapply);
mutated.databaseReceipt.storagePoliciesExact = 1;
assert.throws(
  () => validateEvidence({
    rehearsal, postapply: mutated, candidate,
    now: new Date('2026-08-11T20:04:00.000Z'),
  }),
  /digest|catalog receipt/i,
);

const wrongCandidate = structuredClone(candidate);
wrongCandidate.migrations[1].sha256 = 'f'.repeat(64);
assert.throws(
  () => validateEvidence({
    rehearsal, postapply, candidate: wrongCandidate,
    now: new Date('2026-08-11T20:04:00.000Z'),
  }),
  /sealed post-frozen candidate/i,
);

assert.equal(
  modes.rehearsal.expectedConfirmation,
  'ROLLBACK_ONLY_POSTFROZEN_XDYTQLPSQSSEOEUXGZRE',
);
assert.equal(
  modes.postapply.expectedConfirmation,
  'READ_ONLY_POSTFROZEN_XDYTQLPSQSSEOEUXGZRE',
);

const databasePassword = 'pooler secret/:@?';
const databaseUrl = `postgresql://cli_login_postgres.xdytqlpsqsseoeuxgzre:${encodeURIComponent(databasePassword)}`
  + '@aws-1-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require';
const processEnv = {
  PATH: process.env.PATH,
  VITRUVIUS_POSTFROZEN_REHEARSAL_DATABASE_URL: databaseUrl,
  VITRUVIUS_POSTFROZEN_REHEARSAL_CONFIRM: modes.rehearsal.expectedConfirmation,
  PGHOSTADDR: '127.0.0.1',
  PGSERVICE: 'uncontrolled-service',
  PGSERVICEFILE: '/tmp/uncontrolled-pg-service.conf',
  PGPASSFILE: '/tmp/uncontrolled-pgpass',
  PGREQUIREAUTH: 'none',
  PGCHANNELBINDING: 'disable',
  PGSSLNEGOTIATION: 'direct',
  PGSSLMINPROTOCOLVERSION: 'TLSv1',
  PGTARGETSESSIONATTRS: 'read-only',
  PGLOADBALANCEHOSTS: 'random',
  PGSYSCONFDIR: '/tmp/uncontrolled-pg-system',
  PGOPTIONS: '-c role=uncontrolled_role -c statement_timeout=0',
};
const childEnv = sanitizedEnvironment(processEnv, modes.rehearsal, databaseUrl);
assert.equal(childEnv.VITRUVIUS_POSTFROZEN_REHEARSAL_DATABASE_URL, undefined);
assert.equal(childEnv.VITRUVIUS_POSTFROZEN_REHEARSAL_CONFIRM, undefined);
assert.equal(childEnv.PGHOSTADDR, undefined);
assert.equal(childEnv.PGSERVICE, undefined);
assert.equal(childEnv.PGSERVICEFILE, undefined);
assert.equal(childEnv.PGPASSFILE, undefined);
assert.equal(childEnv.PGREQUIREAUTH, undefined);
assert.equal(childEnv.PGCHANNELBINDING, undefined);
assert.equal(childEnv.PGSSLNEGOTIATION, undefined);
assert.equal(childEnv.PGSSLMINPROTOCOLVERSION, undefined);
assert.equal(childEnv.PGTARGETSESSIONATTRS, undefined);
assert.equal(childEnv.PGLOADBALANCEHOSTS, undefined);
assert.equal(childEnv.PGSYSCONFDIR, undefined);
assert.equal(childEnv.PGHOST, 'aws-1-us-west-1.pooler.supabase.com');
assert.equal(childEnv.PGPORT, '5432');
assert.equal(childEnv.PGUSER, 'cli_login_postgres.xdytqlpsqsseoeuxgzre');
assert.equal(childEnv.PGPASSWORD, databasePassword);
assert.equal(childEnv.PGDATABASE, 'postgres');
assert.equal(childEnv.PGSSLMODE, 'require');
assert.equal(childEnv.PGAPPNAME, 'vitruvius-postfrozen-migration-evidence');
assert.equal(
  childEnv.PGOPTIONS,
  '-c statement_timeout=900000 -c lock_timeout=5000',
);
assert(!childEnv.PGOPTIONS.includes('role='));
assert.deepEqual(
  Object.keys(childEnv).filter(key => key.startsWith('PG')).sort(),
  [
    'PGAPPNAME',
    'PGCONNECT_TIMEOUT',
    'PGDATABASE',
    'PGHOST',
    'PGOPTIONS',
    'PGPASSWORD',
    'PGPORT',
    'PGSSLMODE',
    'PGUSER',
  ],
);

let capturedArgs;
let capturedOptions;
const psqlResult = executePsql({
  sql: 'select 1;',
  env: processEnv,
  config: modes.rehearsal,
  databaseUrl,
  spawn: (_command, args, options) => {
    capturedArgs = args;
    capturedOptions = options;
    return { status: 0, stdout: '1\n', stderr: '' };
  },
});
assert.equal(psqlResult.stdout, '1\n');
const expectedPoolerInput = [
  'SET ROLE postgres;',
  'DO $vitruvius_evidence_role_guard$',
  'BEGIN',
  "  IF current_user IS DISTINCT FROM 'postgres' THEN",
  "    RAISE EXCEPTION 'Vitruvius role guard rejected current_user: %', current_user;",
  '  END IF;',
  "  IF session_user IS DISTINCT FROM 'cli_login_postgres' THEN",
  "    RAISE EXCEPTION 'Vitruvius role guard rejected session_user: %', session_user;",
  '  END IF;',
  'END',
  '$vitruvius_evidence_role_guard$;',
  '-- BEGIN CONTROLLED EVIDENCE SQL',
  'select 1;',
].join('\n');
assert.equal(capturedOptions.input, expectedPoolerInput);
assert.equal(controlledSqlInput(databaseUrl, 'select 1;'), expectedPoolerInput);
assert(
  capturedOptions.input.indexOf('$vitruvius_evidence_role_guard$;')
    < capturedOptions.input.indexOf('select 1;'),
);
assert.equal(capturedOptions.env.PGHOST, childEnv.PGHOST);
assert.equal(capturedOptions.env.PGPORT, childEnv.PGPORT);
assert.equal(capturedOptions.env.PGUSER, childEnv.PGUSER);
assert.equal(capturedOptions.env.PGPASSWORD, databasePassword);
assert.equal(capturedOptions.env.PGDATABASE, 'postgres');
assert.equal(capturedOptions.env.PGSSLMODE, 'require');
assert.equal(
  capturedOptions.env.PGOPTIONS,
  '-c statement_timeout=900000 -c lock_timeout=5000',
);
assert(!capturedOptions.env.PGOPTIONS.includes('role='));
assert(!capturedArgs.join(' ').includes(databasePassword));
assert(!capturedArgs.join(' ').includes(databaseUrl));
assert(!capturedArgs.includes('--dbname'));
assert(!capturedArgs.includes('-d'));

const fakeReceipt = JSON.stringify(rehearsalPayload);
assert.throws(
  () => executePsql({
    sql: `select '${fakeReceipt.replaceAll("'", "''")}';`,
    env: processEnv,
    config: modes.rehearsal,
    databaseUrl,
    spawn: () => ({
      status: 1,
      stdout: `${fakeReceipt}\n`,
      stderr: 'ERROR: Vitruvius role guard rejected session_user',
    }),
  }),
  /role guard rejected session_user/i,
);

const sanitizedFailure = sanitizeError(
  `connection failed for ${databaseUrl}; password=${databasePassword}`,
  databaseUrl,
);
assert(!sanitizedFailure.includes(databaseUrl));
assert(!sanitizedFailure.includes(databasePassword));
assert.match(sanitizedFailure, /redacted database/i);
const encodedPassword = new URL(databaseUrl).password;
const sanitizedEncodedFailure = sanitizeError(
  `encoded password=${encodedPassword}`,
  databaseUrl,
);
assert(!sanitizedEncodedFailure.includes(encodedPassword));
assert.match(sanitizedEncodedFailure, /redacted database password/i);

const passwordlessDatabaseUrl =
  'postgresql://cli_login_postgres.xdytqlpsqsseoeuxgzre'
  + '@aws-1-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require';
assert.throws(
  () => sanitizedEnvironment(processEnv, modes.rehearsal, passwordlessDatabaseUrl),
  /must include a password/i,
);

const directDatabaseUrl = 'postgresql://postgres:direct-secret'
  + '@db.xdytqlpsqsseoeuxgzre.supabase.co:5432/postgres?sslmode=require';
for (const {
  config, url, expectedHost, expectedUser, expectedSessionUser,
} of [
  ...Object.values(coverHardeningModes).map(config => ({
    config,
    url: directDatabaseUrl,
    expectedHost: 'db.xdytqlpsqsseoeuxgzre.supabase.co',
    expectedUser: 'postgres',
    expectedSessionUser: 'postgres',
  })),
  ...Object.values(sourceProvenanceModes).map(config => ({
    config,
    url: databaseUrl,
    expectedHost: 'aws-1-us-west-1.pooler.supabase.com',
    expectedUser: 'cli_login_postgres.xdytqlpsqsseoeuxgzre',
    expectedSessionUser: 'cli_login_postgres',
  })),
]) {
  const compatibleEnv = sanitizedEnvironment({
    PATH: process.env.PATH,
    [config.databaseEnv]: url,
    [config.confirmationEnv]: config.expectedConfirmation,
    PGPASSFILE: '/tmp/uncontrolled-pgpass',
    PGOPTIONS: '-c role=uncontrolled_role',
  }, config, url);
  assert.equal(compatibleEnv[config.databaseEnv], undefined);
  assert.equal(compatibleEnv[config.confirmationEnv], undefined);
  assert.equal(compatibleEnv.PGPASSFILE, undefined);
  assert.equal(compatibleEnv.PGHOST, expectedHost);
  assert.equal(compatibleEnv.PGUSER, expectedUser);
  assert.equal(compatibleEnv.PGDATABASE, 'postgres');
  assert.equal(compatibleEnv.PGSSLMODE, 'require');
  assert.equal(
    compatibleEnv.PGOPTIONS,
    '-c statement_timeout=900000 -c lock_timeout=5000',
  );
  assert(!compatibleEnv.PGOPTIONS.includes('role='));
  let compatibleInput;
  executePsql({
    sql: 'select 2;',
    env: {
      PATH: process.env.PATH,
      [config.databaseEnv]: url,
      [config.confirmationEnv]: config.expectedConfirmation,
    },
    config,
    databaseUrl: url,
    spawn: (_command, _args, options) => {
      compatibleInput = options.input;
      return { status: 0, stdout: '2\n', stderr: '' };
    },
  });
  assert(compatibleInput.startsWith('SET ROLE postgres;\n'));
  assert(compatibleInput.includes(
    `IF session_user IS DISTINCT FROM '${expectedSessionUser}' THEN`,
  ));
  assert(compatibleInput.endsWith('-- BEGIN CONTROLLED EVIDENCE SQL\nselect 2;'));
}

let injectionSpawned = false;
const injectedLoginUrl = 'postgresql://cli_login_postgres.xdytqlpsqsseoeuxgzre%27%3Bselect%201%3B--:secret'
  + '@aws-1-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require';
assert.throws(
  () => executePsql({
    sql: 'select 1;',
    env: processEnv,
    config: modes.rehearsal,
    databaseUrl: injectedLoginUrl,
    spawn: () => {
      injectionSpawned = true;
      return { status: 0, stdout: '1\n', stderr: '' };
    },
  }),
  /not the sealed/i,
);
assert.equal(injectionSpawned, false);

const sourceProvenanceTemplatePath = path.join(
  __dirname,
  '..',
  'validation',
  'ecos',
  'vitruvius-source-provenance-migration-adversarial-rollback.sql',
);
const sourceProvenanceTemplateSql = fs.readFileSync(
  sourceProvenanceTemplatePath,
  'utf8',
);
assert.equal(
  sourceProvenanceTemplateSql.match(/^set local role postgres;$/gmi)?.length,
  2,
);
assert.doesNotMatch(sourceProvenanceTemplateSql, /\breset\s+role\s*;/i);
const sourceProvenanceEmittedSql = emitSourceProvenanceRehearsalSql();
assert.doesNotMatch(sourceProvenanceEmittedSql, /\breset\s+role\s*;/i);
const controlledSourceProvenanceSql = controlledSqlInput(
  databaseUrl,
  sourceProvenanceEmittedSql,
);
const controlledSqlDelimiter = '-- BEGIN CONTROLLED EVIDENCE SQL\n';
assert.equal(
  controlledSourceProvenanceSql.slice(
    controlledSourceProvenanceSql.indexOf(controlledSqlDelimiter)
      + controlledSqlDelimiter.length,
  ),
  sourceProvenanceEmittedSql,
  'Controlled SQL must append the emitted source rehearsal byte-for-byte.',
);

let resetRoleSpawned = false;
assert.throws(
  () => executePsql({
    sql: 'select 1;\n  ReSeT\t ROLE ;\nselect 2;',
    env: processEnv,
    config: modes.rehearsal,
    databaseUrl,
    spawn: () => {
      resetRoleSpawned = true;
      return { status: 0, stdout: '1\n', stderr: '' };
    },
  }),
  /RESET ROLE is forbidden/i,
);
assert.equal(resetRoleSpawned, false);

const packageScripts = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'package.json'),
  'utf8',
)).scripts;
assert.equal(
  packageScripts['check:postfrozen-migration-evidence'],
  'node scripts/vitruvius-postfrozen-migration-evidence-gate.js',
);

console.log('Vitruvius post-frozen migration evidence contracts PASS.');
