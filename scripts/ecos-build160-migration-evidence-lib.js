#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const EXPECTED_PROJECT_REF = 'xdytqlpsqsseoeuxgzre';
const RECEIPT_SCHEMA_VERSION = 1;
const RECEIPT_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const REHEARSAL_MARKER = 'ECOS_BUILD160_MIGRATION_REHEARSAL_OK';
const POSTAPPLY_MARKER = 'ECOS_BUILD160_POSTAPPLY_OK';
const EXPECTED_FROZEN_MIGRATION_VERSIONS = Object.freeze([
  '20260809193726',
  '20260809195802',
  '20260809201435',
  '20260809222329',
  '20260810013000',
]);
const EXPECTED_MIGRATION_CHAIN = Object.freeze([
  Object.freeze({
    version: '20260809193726',
    path: 'supabase/migrations/20260809193726_ecos_project_evidence_exact_project_binding.sql',
    sha256: '1e96d376d2f869b220d32371e90636211b0011a85485f380af4c2c8340d2c65d',
  }),
  Object.freeze({
    version: '20260809195802',
    path: 'supabase/migrations/20260809195802_ecos_pdf_annotation_rendered_corroboration.sql',
    sha256: '1d45a851add1711e4f76a2bb1b56d9c76c941206e95b5c522fe8ba31704b59e2',
  }),
  Object.freeze({
    version: '20260809201435',
    path: 'supabase/migrations/20260809201435_ecos_drawing_provider_attempt_reservations.sql',
    sha256: '67a393e48159e73fd7f91c5af24e98702026ae927dc6d7f5e3049b68037dddd4',
  }),
  Object.freeze({
    version: '20260809222329',
    path: 'supabase/migrations/20260809222329_ecos_reference_document_authority_keys_guard.sql',
    sha256: '84b0380c4948442d2917b64829430578ee6fa9e7f31b0ac410b66445640318e4',
  }),
  Object.freeze({
    version: '20260810013000',
    path: 'supabase/migrations/20260810013000_ecos_hosted_page_graph_and_search_authority.sql',
    sha256: 'c5217481bd7e47e9599f402953bfcdac90adaea5166928cce3ef704d889ed0fb',
  }),
  Object.freeze({
    version: '20260811021601',
    path: 'supabase/migrations/20260811021601_exact_project_delete_rpc.sql',
    sha256: '36be147372655a6ef2b2682297de9d0197df355a6cd4fffecef417e2f6dcdfa9',
  }),
  Object.freeze({
    version: '20260811151028',
    path: 'supabase/migrations/20260811151028_dave_project_cover_commit_authority.sql',
    sha256: 'f397798167d23d11343699a2308b0250fea7e07a5f30909a2e63b34ef7ff7123',
  }),
  Object.freeze({
    version: '20260811235642',
    path: 'supabase/migrations/20260811235642_dave_project_cover_cleanup_authority.sql',
    sha256: 'dda573a021c9244149de96ebb587a98227161cc72c31784354a4c3fd85b388ee',
  }),
  Object.freeze({
    version: '20260812011945',
    path: 'supabase/migrations/20260812011945_ecos_visual_exception_dismissal_authority.sql',
    sha256: '109ea23574c07811c1b24187f4059697854c5b2bee986d444b3c8ac5a8f0596e',
  }),
  Object.freeze({
    version: '20260812064107',
    path: 'supabase/migrations/20260812064107_ecos_managed_source_provenance_guard.sql',
    sha256: '1031c91a57d50715ac4dc26225718155a954271e08a12ddaf6239ccc1282d106',
  }),
  Object.freeze({
    version: '20260812075338',
    path: 'supabase/migrations/20260812075338_ecos_source_provenance_trigger_acl_fix.sql',
    sha256: 'ffd08e28b4c132feb6d0c6d8dcf0af684e0f05235bc668e277256d935eb332d5',
  }),
]);
const SEALED_HISTORICAL_EVIDENCE = Object.freeze({
  frozenFive: Object.freeze({
    commit: '83b0b7acb074eebc8fbad0b8ba486fe87fa0a769',
    tree: '661fd5becbb4bae906a8b6e87190c43af595d20c',
    rehearsalSha256: '41bbda7f5e1c559ff328e0f542b279177db446fad7f8d32c1612a23230db34f2',
    postapplySha256: '56f5db603494eb31c96c620a700d3d92071f0a3e2a27838f5fc0f18316fb3cac',
  }),
  postFrozen: Object.freeze({
    commit: '3ffe78ecaec17056b189c4cf525ede8b89a6c7c6',
    tree: 'fe4bc9ea91441d0fb4d6da321912bf1d912bfc10',
    rehearsalSha256: '29be874943e31f130a78eae0e72d4e4ca76b4aa625825f80605ddbb837298f1e',
    postapplySha256: 'a4609778e383d6627077b31c22663caf57276f2ef0f3076306dcd003913bce3d',
  }),
  coverHardening: Object.freeze({
    commit: 'f600c3494be4ef20b6a804629ed0dc0ee2e2ff9d',
    tree: 'aa0842aad452253171dd96901552ba275852e5ff',
    rehearsalSha256: 'ebaa94c664b24b1e438eaffd4e8a98df32f6d7b464b2c44e2cd8331662c453e7',
    postapplySha256: 'fae58537418848e3ec32f77e00676ade700e8aa343d5fc033cd13db985b812ed',
  }),
  sourceProvenanceRehearsal: Object.freeze({
    commit: '2f7b5156c8ee3a5ce45d0d75de501567892b59e0',
    tree: '3ad47d0ca3ee4dd67eef339c149cd1ebf9109cc7',
    rehearsalSha256: '7eade52d7135c213d4b2f7af646535a043cb780858c1edd56e6bb7c82b6deb52',
  }),
});
const outputDirectory = path.join(repoRoot, 'validation', 'output');
const rehearsalReceiptPath = path.join(
  outputDirectory,
  'ecos-build160-migration-rehearsal-receipt.json',
);
const postapplyReceiptPath = path.join(
  outputDirectory,
  'ecos-build160-migration-postapply-receipt.json',
);
const rehearsalTemplatePath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'ecos-migration-adversarial-rollback.sql',
);
const postapplyVerifierPath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'ecos-pending-rollout-postapply-verify.sql',
);
const migrationEmitterPath = path.join(repoRoot, 'scripts', 'migration-static-validation.js');

function assertExactFrozenMigrationSuffix(
  migrationNames,
  approvedPostFrozenVersions = [],
) {
  const firstVersion = EXPECTED_FROZEN_MIGRATION_VERSIONS[0];
  const actualSuffix = migrationNames
    .filter(name => name.slice(0, 14) >= firstVersion)
    .map(name => name.slice(0, 14));
  const expectedSuffix = [
    ...EXPECTED_FROZEN_MIGRATION_VERSIONS,
    ...approvedPostFrozenVersions,
  ];
  if (JSON.stringify(actualSuffix) !== JSON.stringify(expectedSuffix)) {
    throw new Error(
      `Repository migration suffix is not the exact frozen five-migration chain plus approved post-frozen transition: ${actualSuffix.join(',') || 'none'}`,
    );
  }
  return true;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function exactCurrentMigrationChain(options = {}) {
  const migrationDirectory = path.join(repoRoot, 'supabase', 'migrations');
  const migrationNames = options.migrationNames || fs.readdirSync(migrationDirectory)
    .filter(name => name.endsWith('.sql'))
    .sort();
  const firstVersion = EXPECTED_FROZEN_MIGRATION_VERSIONS[0];
  const actualNames = migrationNames.filter(name => name.slice(0, 14) >= firstVersion);
  const expectedNames = EXPECTED_MIGRATION_CHAIN.map(item => path.basename(item.path));
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Repository migration history after the sealed ancestor is missing, out of order, or contains an extra migration: ${actualNames.join(',') || 'none'}`,
    );
  }
  const digestFile = options.digestFile || sha256File;
  const actual = EXPECTED_MIGRATION_CHAIN.map((expected) => ({
    version: expected.version,
    path: expected.path,
    sha256: digestFile(path.join(repoRoot, expected.path)),
  }));
  assertExactObject(actual, EXPECTED_MIGRATION_CHAIN, 'Current migration chain');
  return actual;
}

function run(command, args, options = {}) {
  const result = (options.spawn || spawnSync)(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 128 * 1024 * 1024,
    timeout: options.timeout || 60_000,
    env: options.env || process.env,
    input: options.input,
  });
  if (result.status !== 0 || result.error) {
    const detail = result.error?.message
      || String(result.stderr || '').trim()
      || `${command} exited with ${String(result.status)}`;
    throw new Error(detail);
  }
  return String(result.stdout || '');
}

function repositorySnapshot(options = {}) {
  const runGit = (args) => run('git', args, options);
  const commit = runGit(['rev-parse', 'HEAD']).trim();
  const tree = runGit(['rev-parse', 'HEAD^{tree}']).trim();
  const status = runGit(['status', '--porcelain=v1', '--untracked-files=normal']);
  if (!/^[0-9a-f]{40,64}$/.test(commit) || !/^[0-9a-f]{40,64}$/.test(tree)) {
    throw new Error('The release candidate Git identity is malformed.');
  }
  return {
    commit,
    tree,
    clean: status.trim().length === 0,
  };
}

function assertSealedReceiptBundle(bundle, expectedSha256, label) {
  if (!bundle?.value || !/^[a-f0-9]{64}$/.test(String(bundle.digest || ''))) {
    throw new Error(`${label} is missing or malformed.`);
  }
  if (bundle.digest !== expectedSha256) {
    throw new Error(`${label} does not match its sealed historical digest.`);
  }
  return bundle.value;
}

function assertHistoricalCandidate(candidate, anchor, migrations, label) {
  if (!candidate || candidate.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new Error(`${label} candidate is malformed.`);
  }
  assertExactObject(candidate.repository, {
    commit: anchor.commit,
    tree: anchor.tree,
    clean: true,
  }, `${label} repository anchor`);
  assertExactObject(candidate.migrations, migrations, `${label} migration transition`);
  return true;
}

function assertHistoricalCoverCandidate(candidate) {
  const anchor = SEALED_HISTORICAL_EVIDENCE.coverHardening;
  if (!candidate || candidate.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new Error('Cover-hardening candidate is malformed.');
  }
  assertExactObject(candidate.repository, {
    commit: anchor.commit,
    tree: anchor.tree,
    clean: true,
  }, 'Cover-hardening repository anchor');
  assertExactObject(
    candidate.migration,
    EXPECTED_MIGRATION_CHAIN[8],
    'Cover-hardening migration transition',
  );
  assertExactObject(candidate.priorEvidence, {
    commit: SEALED_HISTORICAL_EVIDENCE.postFrozen.commit,
    rehearsalSha256: SEALED_HISTORICAL_EVIDENCE.postFrozen.rehearsalSha256,
    postapplySha256: SEALED_HISTORICAL_EVIDENCE.postFrozen.postapplySha256,
  }, 'Cover-hardening predecessor evidence');
  return true;
}

function assertHistoricalSourceProvenanceRehearsalCandidate(candidate) {
  const anchor = SEALED_HISTORICAL_EVIDENCE.sourceProvenanceRehearsal;
  assertExactObject(candidate, {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    repository: {
      commit: anchor.commit,
      tree: anchor.tree,
      clean: true,
    },
    priorEvidence: {
      commit: SEALED_HISTORICAL_EVIDENCE.coverHardening.commit,
      rehearsalSha256: SEALED_HISTORICAL_EVIDENCE.coverHardening.rehearsalSha256,
      postapplySha256: SEALED_HISTORICAL_EVIDENCE.coverHardening.postapplySha256,
    },
    migration: EXPECTED_MIGRATION_CHAIN[9],
    artifacts: {
      evidenceLibrary: {
        path: 'scripts/vitruvius-source-provenance-migration-evidence-lib.js',
        sha256: '0dd8ca96ddf14ed814115e1c34ac167205c1f26e230540153d31b1d6b65691b0',
      },
      evidenceRunner: {
        path: 'scripts/vitruvius-source-provenance-migration-evidence.js',
        sha256: '0a31f386e58a07bac3322b01a6a10e2b990a32752e89ac4e527678a709df92c3',
      },
      evidenceGate: {
        path: 'scripts/vitruvius-source-provenance-migration-evidence-gate.js',
        sha256: 'f97a68b075ef1f5e9032e76f61969b9931a93c84cf74bdc2eaceb320c8e076b5',
      },
      evidenceGateTest: {
        path: 'scripts/vitruvius-source-provenance-migration-evidence-gate-test.js',
        sha256: 'af280d0a19f04c9e91e9f2249b88078d2527d13c6cda349d3806b0fb8f746b5f',
      },
      rehearsalTemplate: {
        path: 'validation/ecos/vitruvius-source-provenance-migration-adversarial-rollback.sql',
        sha256: '9a45aea15f54cf926a8110a8f9f8b975ff8a65a25a1c57d2b303db2cee6a5c79',
      },
      emittedRehearsal: {
        sha256: 'b56eb4e50b27e363763b197a086d8fa4702581ef9fb8d0080c44657306e6386c',
      },
      postapplyVerifier: {
        path: 'validation/ecos/vitruvius-source-provenance-migration-postapply-verify.sql',
        sha256: '870ac9976da185cccb484871c7d196c189b312c8cd39da47987c64b1802cf89a',
      },
    },
  }, 'Source-provenance rehearsal historical candidate');
  return true;
}

function assertHistoricalDatabaseTarget(receipt, expectedDatabase, label) {
  if (receipt?.projectRef !== EXPECTED_PROJECT_REF) {
    throw new Error(`${label} targets the wrong Supabase project.`);
  }
  assertExactObject(receipt.database, expectedDatabase, `${label} database target`);
  return true;
}

function assertGitCommitTree(commit, expectedTree, label, options = {}) {
  let actualTree;
  try {
    actualTree = run('git', ['rev-parse', `${commit}^{tree}`], options).trim();
  } catch {
    throw new Error(`${label} sealed historical commit is unavailable.`);
  }
  if (actualTree !== expectedTree) {
    throw new Error(`${label} sealed historical commit tree does not match.`);
  }
}

function assertGitAncestor(ancestor, descendant, label, options = {}) {
  try {
    run('git', ['merge-base', '--is-ancestor', ancestor, descendant], options);
  } catch {
    throw new Error(`${label} is not an ancestor of the current release candidate.`);
  }
}

function validateHistoricalRepository(repository, options = {}) {
  if (!repository || !/^[a-f0-9]{40,64}$/.test(String(repository.commit || '')) ||
      !/^[a-f0-9]{40,64}$/.test(String(repository.tree || ''))) {
    throw new Error('The current release candidate Git identity is malformed.');
  }
  if (repository.clean !== true) {
    throw new Error('The release candidate working tree is not clean.');
  }
  exactCurrentMigrationChain(options);
  assertGitCommitTree(repository.commit, repository.tree, 'Current release candidate', options);
  for (const [label, anchor] of [
    ['Post-frozen transition', SEALED_HISTORICAL_EVIDENCE.postFrozen],
    ['Frozen-five receipt', SEALED_HISTORICAL_EVIDENCE.frozenFive],
    ['Cover-hardening transition', SEALED_HISTORICAL_EVIDENCE.coverHardening],
    ['Source-provenance rehearsal', SEALED_HISTORICAL_EVIDENCE.sourceProvenanceRehearsal],
  ]) {
    assertGitCommitTree(anchor.commit, anchor.tree, label, options);
  }
  // Database transition timestamps and Git ancestry are independent seals.
  // Validate the exact known commit graph instead of inferring it from the
  // database receipt clock.
  assertGitAncestor(
    SEALED_HISTORICAL_EVIDENCE.postFrozen.commit,
    SEALED_HISTORICAL_EVIDENCE.frozenFive.commit,
    'Post-frozen transition',
    options,
  );
  assertGitAncestor(
    SEALED_HISTORICAL_EVIDENCE.frozenFive.commit,
    SEALED_HISTORICAL_EVIDENCE.coverHardening.commit,
    'Frozen-five receipt',
    options,
  );
  assertGitAncestor(
    SEALED_HISTORICAL_EVIDENCE.coverHardening.commit,
    SEALED_HISTORICAL_EVIDENCE.sourceProvenanceRehearsal.commit,
    'Cover-hardening transition',
    options,
  );
  assertGitAncestor(
    SEALED_HISTORICAL_EVIDENCE.sourceProvenanceRehearsal.commit,
    repository.commit,
    'Source-provenance rehearsal',
    options,
  );
  return true;
}

function validateHistoricalEvidenceOrder(stages) {
  const frozenFinished = assertIsoDate(
    stages.frozenFive.postapply.finishedAt,
    'frozen-five postapply finishedAt',
  );
  const postFrozenStarted = assertIsoDate(
    stages.postFrozen.rehearsal.startedAt,
    'post-frozen rehearsal startedAt',
  );
  const postFrozenFinished = assertIsoDate(
    stages.postFrozen.postapply.finishedAt,
    'post-frozen postapply finishedAt',
  );
  const coverStarted = assertIsoDate(
    stages.coverHardening.rehearsal.startedAt,
    'cover-hardening rehearsal startedAt',
  );
  const coverFinished = assertIsoDate(
    stages.coverHardening.postapply.finishedAt,
    'cover-hardening postapply finishedAt',
  );
  const sourceProvenanceStarted = assertIsoDate(
    stages.sourceProvenance.rehearsal.startedAt,
    'source-provenance rehearsal startedAt',
  );
  const sourceProvenanceFinished = assertIsoDate(
    stages.sourceProvenance.rehearsal.finishedAt,
    'source-provenance rehearsal finishedAt',
  );
  const sourceProvenanceAclStarted = stages.sourceProvenanceAcl
    ? assertIsoDate(
      stages.sourceProvenanceAcl.rehearsal.startedAt,
      'source-provenance ACL rehearsal startedAt',
    )
    : null;
  if (postFrozenStarted < frozenFinished || coverStarted < postFrozenFinished ||
      sourceProvenanceStarted < coverFinished ||
      (sourceProvenanceAclStarted !== null &&
        sourceProvenanceAclStarted < sourceProvenanceFinished)) {
    throw new Error('The migration transition evidence receipts are out of order.');
  }
  return true;
}

function parseControlledDatabaseUrl(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(String(databaseUrl || ''));
  } catch {
    throw new Error('The controlled database URL is missing or malformed.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('The controlled database URL must use PostgreSQL.');
  }
  if (parsed.hash) {
    throw new Error('The controlled database URL must not contain a fragment.');
  }

  const host = parsed.hostname.toLowerCase();
  let username = '';
  let password = '';
  try {
    username = decodeURIComponent(parsed.username || '').toLowerCase();
    password = decodeURIComponent(parsed.password || '');
  } catch {
    throw new Error('The controlled database credentials are malformed.');
  }
  const directHost = `db.${EXPECTED_PROJECT_REF}.supabase.co`;
  const direct = host === directHost && username === 'postgres';
  const pooler = host.endsWith('.pooler.supabase.com')
    && (
      username === `postgres.${EXPECTED_PROJECT_REF}`
      || username === `cli_login_postgres.${EXPECTED_PROJECT_REF}`
    );
  if (!direct && !pooler) {
    throw new Error('The database target is not the sealed Build 160 Supabase project.');
  }
  if (parsed.pathname !== '/postgres') {
    throw new Error('The controlled database URL must target the postgres database.');
  }
  const parameters = [...parsed.searchParams.entries()];
  if (parameters.length === 0) {
    throw new Error('The controlled database URL must explicitly require TLS.');
  }
  if (parameters.length !== 1 || parameters[0][0] !== 'sslmode') {
    throw new Error(
      'The controlled database URL must contain exactly one sslmode connection parameter and no overrides.',
    );
  }
  const sslMode = parameters[0][1];
  if (!['require', 'verify-full'].includes(sslMode)) {
    throw new Error('The controlled database URL must explicitly require TLS.');
  }
  const port = parsed.port || (direct ? '5432' : '6543');
  if ((direct && port !== '5432') || (pooler && !['5432', '6543'].includes(port))) {
    throw new Error('The controlled database URL uses an unsupported Supabase port.');
  }
  const target = {
    projectRef: EXPECTED_PROJECT_REF,
    host,
    port,
    connectionMode: direct ? 'direct' : 'pooler',
    sslMode,
  };
  const encodedPassword = password ? `:${encodeURIComponent(password)}` : '';
  const connectionUrl = `postgresql://${encodeURIComponent(username)}${encodedPassword}`
    + `@${host}:${port}/postgres?sslmode=${encodeURIComponent(sslMode)}`;
  return { target, connectionUrl };
}

function extractDatabaseTarget(databaseUrl) {
  return parseControlledDatabaseUrl(databaseUrl).target;
}

function canonicalizeDatabaseUrl(databaseUrl) {
  return parseControlledDatabaseUrl(databaseUrl).connectionUrl;
}

function emitRehearsalSql(options = {}) {
  return run(
    process.execPath,
    [migrationEmitterPath, '--emit-ecos-rehearsal'],
    { ...options, timeout: options.timeout || 120_000 },
  );
}

function parseFrozenMigrations(emittedSql) {
  const matches = [...String(emittedSql).matchAll(
    /^-- BEGIN FROZEN MIGRATION (\d{14}) SHA256 ([a-f0-9]{64})$/gm,
  )];
  if (matches.length !== EXPECTED_FROZEN_MIGRATION_VERSIONS.length) {
    throw new Error('The emitted rehearsal does not contain exactly the frozen five-migration chain.');
  }
  const seen = new Set();
  return matches.map((match, index) => {
    const version = match[1];
    if (version !== EXPECTED_FROZEN_MIGRATION_VERSIONS[index]) {
      throw new Error(
        `Frozen migration order mismatch at position ${index + 1}: ${version}`,
      );
    }
    if (seen.has(version)) throw new Error(`Duplicate frozen migration version: ${version}`);
    seen.add(version);
    const names = fs.readdirSync(path.join(repoRoot, 'supabase', 'migrations'))
      .filter(name => name.startsWith(`${version}_`) && name.endsWith('.sql'));
    if (names.length !== 1) {
      throw new Error(`Frozen migration ${version} does not resolve to exactly one source file.`);
    }
    const relativePath = path.posix.join('supabase', 'migrations', names[0]);
    const actualSha256 = sha256File(path.join(repoRoot, relativePath));
    if (actualSha256 !== match[2]) {
      throw new Error(`Frozen migration ${version} does not match the emitted rehearsal hash.`);
    }
    return { version, path: relativePath, sha256: actualSha256 };
  });
}

function currentCandidateEvidence(options = {}) {
  const emittedSql = options.emittedSql || emitRehearsalSql(options);
  const migrations = parseFrozenMigrations(emittedSql);
  const artifacts = {
    migrationEmitter: {
      path: 'scripts/migration-static-validation.js',
      sha256: sha256File(migrationEmitterPath),
    },
    rehearsalTemplate: {
      path: 'validation/ecos/ecos-migration-adversarial-rollback.sql',
      sha256: sha256File(rehearsalTemplatePath),
    },
    emittedRehearsal: {
      sha256: sha256(emittedSql),
    },
    postapplyVerifier: {
      path: 'validation/ecos/ecos-pending-rollout-postapply-verify.sql',
      sha256: sha256File(postapplyVerifierPath),
    },
  };
  const repository = options.repository || repositorySnapshot(options);
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    repository,
    migrations,
    artifacts,
  };
}

function parseDatabaseReceipt(stdout, marker) {
  const parsed = String(stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(value => value && value.receipt === marker);
  if (parsed.length !== 1) {
    throw new Error(`The database returned ${parsed.length} ${marker} receipts; expected exactly one.`);
  }
  return parsed[0];
}

function validateDatabaseReceiptPayload(payload, mode, migrationVersions) {
  const expectedMarker = mode === 'rehearsal' ? REHEARSAL_MARKER : POSTAPPLY_MARKER;
  if (!payload || payload.receipt !== expectedMarker) {
    throw new Error(`The ${mode} database receipt marker is invalid.`);
  }
  if (JSON.stringify(payload.migrationOrder) !== JSON.stringify(migrationVersions)) {
    throw new Error(`The ${mode} database receipt migration order is invalid.`);
  }
  if (mode === 'rehearsal') {
    for (const key of [
      'outerTransactionRolledBack',
      'baselineManifestEqual',
      'projectIdentityAdversaries',
      'renderedAnnotationAdversaries',
      'providerLedgerReplayAndQuota',
      'authorityLifecycleAndGraphPurge',
      'pageGraphAndSearchAuthority',
    ]) {
      if (payload[key] !== true) throw new Error(`The rehearsal did not prove ${key}.`);
    }
    if (payload.providerCallsMade !== 0) {
      throw new Error('The rollback rehearsal reports a provider call.');
    }
  } else {
    for (const key of [
      'hostedConfigurationsEnabled',
      'authorityKeysPresent',
      'pageGraphReceiptsPresent',
      'providerRequestsBeforeCanary',
      'providerAttemptsBeforeCanary',
      'providerCallsMadeByVerifier',
    ]) {
      if (payload[key] !== 0) throw new Error(`The post-apply verifier reported unsafe ${key}.`);
    }
    if (!Number.isInteger(payload.requiredTriggersEnabled) || payload.requiredTriggersEnabled < 1) {
      throw new Error('The post-apply verifier did not attest its required triggers.');
    }
  }
  return payload;
}

function makeEvidenceReceipt({
  mode,
  candidate,
  database,
  databasePayload,
  stdout,
  stderr,
  executedSql,
  startedAt,
  finishedAt,
}) {
  const marker = mode === 'rehearsal' ? REHEARSAL_MARKER : POSTAPPLY_MARKER;
  const migrationVersions = candidate.migrations.map(migration => migration.version);
  validateDatabaseReceiptPayload(databasePayload, mode, migrationVersions);
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: mode,
    receipt: marker,
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
    databaseReceiptSha256: sha256(Buffer.from(JSON.stringify(databasePayload), 'utf8')),
    execution: {
      exitCode: 0,
      sqlSha256: sha256(Buffer.from(String(executedSql || ''), 'utf8')),
      stdoutSha256: sha256(Buffer.from(String(stdout || ''), 'utf8')),
      stderrSha256: sha256(Buffer.from(String(stderr || ''), 'utf8')),
      credentialsPersisted: false,
    },
  };
}

function assertIsoDate(value, label) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) throw new Error(`${label} is not a valid timestamp.`);
  return timestamp;
}

function assertExactObject(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the current release candidate.`);
  }
}

function validateOneEvidenceReceipt(receipt, mode, current, nowMs) {
  const expectedMarker = mode === 'rehearsal' ? REHEARSAL_MARKER : POSTAPPLY_MARKER;
  if (!receipt || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION
    || receipt.kind !== mode || receipt.receipt !== expectedMarker) {
    throw new Error(`The ${mode} migration evidence receipt is malformed.`);
  }
  if (receipt.projectRef !== EXPECTED_PROJECT_REF) {
    throw new Error(`The ${mode} migration evidence targets the wrong Supabase project.`);
  }
  const target = extractDatabaseTarget(
    receipt.database?.connectionMode === 'direct'
      ? `postgresql://postgres@${receipt.database?.host}:${receipt.database?.port}/postgres?sslmode=${receipt.database?.sslMode}`
      : `postgresql://postgres.${receipt.projectRef}@${receipt.database?.host}:${receipt.database?.port}/postgres?sslmode=${receipt.database?.sslMode}`,
  );
  assertExactObject(receipt.database, {
    host: target.host,
    port: target.port,
    connectionMode: target.connectionMode,
    sslMode: target.sslMode,
  }, `${mode} database target`);

  const startedMs = assertIsoDate(receipt.startedAt, `${mode} startedAt`);
  const finishedMs = assertIsoDate(receipt.finishedAt, `${mode} finishedAt`);
  if (finishedMs < startedMs || finishedMs > nowMs + FUTURE_CLOCK_SKEW_MS) {
    throw new Error(`The ${mode} migration evidence timestamps are invalid.`);
  }
  if (nowMs - finishedMs > RECEIPT_MAX_AGE_MS) {
    throw new Error(`The ${mode} migration evidence is stale.`);
  }
  if (current.repository.clean !== true) {
    throw new Error('The release candidate working tree is not clean.');
  }
  assertExactObject(receipt.candidate, current, `${mode} candidate evidence`);
  validateDatabaseReceiptPayload(
    receipt.databaseReceipt,
    mode,
    current.migrations.map(migration => migration.version),
  );
  if (receipt.databaseReceiptSha256 !== sha256(
    Buffer.from(JSON.stringify(receipt.databaseReceipt), 'utf8'),
  )) {
    throw new Error(`The ${mode} database receipt digest is invalid.`);
  }
  if (receipt.execution?.exitCode !== 0 || receipt.execution?.credentialsPersisted !== false) {
    throw new Error(`The ${mode} execution receipt is unsafe.`);
  }
  const expectedSqlSha256 = mode === 'rehearsal'
    ? current.artifacts.emittedRehearsal.sha256
    : current.artifacts.postapplyVerifier.sha256;
  if (receipt.execution?.sqlSha256 !== expectedSqlSha256) {
    throw new Error(`The ${mode} executed SQL does not match the sealed candidate.`);
  }
  for (const key of ['sqlSha256', 'stdoutSha256', 'stderrSha256']) {
    if (!/^[a-f0-9]{64}$/.test(String(receipt.execution?.[key] || ''))) {
      throw new Error(`The ${mode} execution ${key} is invalid.`);
    }
  }
  return { startedMs, finishedMs };
}

function validateMigrationEvidence({ rehearsal, postapply, current, now = new Date() }) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error('The validation clock is invalid.');
  const rehearsalTimes = validateOneEvidenceReceipt(rehearsal, 'rehearsal', current, nowMs);
  const postapplyTimes = validateOneEvidenceReceipt(postapply, 'postapply', current, nowMs);
  if (postapplyTimes.startedMs < rehearsalTimes.finishedMs) {
    throw new Error('The post-apply verification predates the rollback rehearsal.');
  }
  return true;
}

function writeReceipt(filePath, receipt) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

module.exports = {
  EXPECTED_MIGRATION_CHAIN,
  SEALED_HISTORICAL_EVIDENCE,
  assertExactFrozenMigrationSuffix,
  assertHistoricalCandidate,
  assertHistoricalCoverCandidate,
  assertHistoricalSourceProvenanceRehearsalCandidate,
  assertHistoricalDatabaseTarget,
  assertSealedReceiptBundle,
  canonicalizeDatabaseUrl,
  EXPECTED_PROJECT_REF,
  POSTAPPLY_MARKER,
  RECEIPT_MAX_AGE_MS,
  REHEARSAL_MARKER,
  currentCandidateEvidence,
  emitRehearsalSql,
  exactCurrentMigrationChain,
  extractDatabaseTarget,
  makeEvidenceReceipt,
  outputDirectory,
  parseDatabaseReceipt,
  postapplyReceiptPath,
  postapplyVerifierPath,
  rehearsalReceiptPath,
  repositorySnapshot,
  run,
  sha256,
  validateDatabaseReceiptPayload,
  validateHistoricalEvidenceOrder,
  validateHistoricalRepository,
  validateMigrationEvidence,
  writeReceipt,
};
