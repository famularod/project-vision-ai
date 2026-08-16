#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const packageLock = JSON.parse(
  fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'),
);
const mobileWorkflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'mobile-ci.yml'),
  'utf8',
);
const hostedIndexerDockerfile = fs.readFileSync(
  path.join(root, 'workers', 'ecos-indexer', 'Dockerfile'),
  'utf8',
);
const hostedIndexerRequirements = fs.readFileSync(
  path.join(root, 'workers', 'ecos-indexer', 'requirements.txt'),
  'utf8',
);
const hostedIndexerEntrypoint = fs.readFileSync(
  path.join(root, 'workers', 'ecos-indexer', 'entrypoint.sh'),
  'utf8',
);
const hostedIndexerDockerignore = fs.readFileSync(
  path.join(root, 'workers', 'ecos-indexer', '.dockerignore'),
  'utf8',
);
const hostedIndexerClamavChecksums = fs.readFileSync(
  path.join(root, 'workers', 'ecos-indexer', 'clamav-databases.sha256'),
  'utf8',
);
const hostedIndexerDeploy = fs.readFileSync(
  path.join(root, 'scripts', 'deploy-ecos-hosted-indexer.sh'),
  'utf8',
);

const parseHashedRequirements = source => {
  const packages = new Map();
  let current = null;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const requirement = line.match(/^([A-Za-z0-9_.-]+)==([^\s\\]+)(?:\s+\\)?$/);
    if (requirement) {
      current = {
        name: requirement[1].toLowerCase().replace(/_/g, '-'),
        version: requirement[2],
        hashes: [],
      };
      assert.equal(packages.has(current.name), false, `Duplicate Python lock entry: ${current.name}`);
      packages.set(current.name, current);
      continue;
    }
    const hash = line.match(/^--hash=sha256:([a-f0-9]{64})(?:\s+\\)?$/);
    assert.ok(hash && current, `Unrecognized or unhashed Python lock line: ${line}`);
    current.hashes.push(hash[1]);
  }
  for (const value of packages.values()) {
    assert.ok(value.hashes.length > 0, `Python lock entry is missing a SHA-256 hash: ${value.name}`);
  }
  return packages;
};

assert.equal(
  packageJson.devDependencies?.['@expo/ngrok'],
  undefined,
  'Unused @expo/ngrok must not restore its vulnerable development tunnel chain.',
);
assert.equal(packageJson.overrides?.['brace-expansion'], '5.0.9');
assert.equal(packageJson.dependencies?.['image-size'], 'file:vendor/image-size-safe');
assert.equal(packageJson.overrides?.['image-size'], '$image-size');
assert.equal(
  packageJson.overrides?.['@istanbuljs/load-nyc-config']?.['js-yaml'],
  '3.15.1',
);
assert.equal(packageJson.overrides?.xcode?.uuid, '11.1.1');
assert.equal(
  packageLock.packages?.['node_modules/brace-expansion']?.version,
  '5.0.9',
);
assert.equal(
  packageLock.packages?.['node_modules/uuid']?.version,
  '11.1.1',
);
assert.equal(
  packageLock.packages?.['node_modules/@expo/ngrok'],
  undefined,
);
assert.equal(
  packageLock.packages?.['vendor/image-size-safe']?.version,
  '2.0.3-vitruvius.1',
);
assert.equal(packageLock.packages?.['node_modules/image-size']?.link, true);
assert.equal(
  packageLock.packages?.['node_modules/probe-image-size']?.version,
  '7.3.0',
);
assert.equal(
  packageLock.packages?.['node_modules/js-yaml']?.version,
  '3.15.1',
);

const boundedImageSize = require('image-size');
const iconDimensions = boundedImageSize(
  fs.readFileSync(path.join(root, 'assets', 'icon.png')),
);
assert.ok(iconDimensions.width > 0 && iconDimensions.height > 0);
const pathDimensions = boundedImageSize(path.join(root, 'assets', 'icon.png'));
assert.deepEqual(pathDimensions, iconDimensions);
const maliciousIcns = Buffer.alloc(16);
maliciousIcns.write('icns', 0, 'ascii');
maliciousIcns.writeUInt32BE(16, 4);
maliciousIcns.write('ic07', 8, 'ascii');
maliciousIcns.writeUInt32BE(0, 12);
assert.throws(() => boundedImageSize(maliciousIcns), /unsupported image container/);
const maliciousJxl = Buffer.from([
  0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20,
  0x0d, 0x0a, 0x87, 0x0a,
]);
assert.throws(() => boundedImageSize(maliciousJxl), /unsupported image container/);
const maliciousHeif = Buffer.alloc(16);
maliciousHeif.writeUInt32BE(16, 0);
maliciousHeif.write('ftyp', 4, 'ascii');
maliciousHeif.write('heic', 8, 'ascii');
assert.throws(() => boundedImageSize(maliciousHeif), /unsupported image container/);
assert.throws(
  () => boundedImageSize(new Uint8Array(32 * 1024 * 1024 + 1)),
  /exceeds the build limit/,
);
assert.match(
  mobileWorkflow,
  /npm audit --audit-level=low/,
  'CI must fail when the exact dependency lock regains a known advisory.',
);

assert.match(
  hostedIndexerDockerfile,
  /^FROM python:3\.12\.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2$/m,
  'The hosted worker base image must be an immutable Python patch release and manifest digest.',
);
assert.match(
  hostedIndexerDockerfile,
  /^FROM clamav\/clamav:1\.5\.4@sha256:0af8760cd96f9ab67d07977af36e155431581a9fe9f0ec8b256c9f855fda183e AS clamav-definitions$/m,
  'The reviewed ClamAV definitions must come from an immutable upstream image manifest.',
);
for (const fromLine of hostedIndexerDockerfile.match(/^FROM .+$/gm) ?? []) {
  assert.match(fromLine, /@sha256:[a-f0-9]{64}(?: AS [a-z-]+)?$/, `Mutable build stage: ${fromLine}`);
}
assert.match(
  hostedIndexerDockerfile,
  /snapshot\.debian\.org\/archive\/debian\/20260731T000000Z/,
  'Debian packages must resolve from the reviewed immutable snapshot.',
);
for (const pinnedPackage of [
  'ca-certificates=20230311+deb12u1',
  'clamav=1.4.3+dfsg-1~deb12u2',
  'clamav-freshclam=1.4.3+dfsg-1~deb12u2',
  'tesseract-ocr=5.3.0-2',
]) {
  assert.ok(
    hostedIndexerDockerfile.includes(pinnedPackage),
    `The hosted worker apt install must pin ${pinnedPackage}.`,
  );
}
assert.match(
  hostedIndexerDockerfile,
  /pip install --require-hashes --only-binary=:all: --requirement requirements\.txt/,
  'The hosted worker must reject any Python artifact outside the exact hashed lock.',
);
assert.doesNotMatch(
  hostedIndexerDockerfile,
  /RUN(?:[^\n]|\\\n)*(?:&&|\()\s*freshclam\s+--/,
  'Mutable ClamAV signatures must not become an executable image-build input.',
);
assert.match(
  hostedIndexerDockerfile,
  /COPY --from=clamav-definitions \/var\/lib\/clamav\/main\.cvd[\s\S]*COPY --from=clamav-definitions \/var\/lib\/clamav\/daily\.cvd[\s\S]*COPY --from=clamav-definitions \/var\/lib\/clamav\/bytecode\.cvd/,
  'The build must copy only the complete reviewed ClamAV database set from the sealed stage.',
);
assert.doesNotMatch(
  hostedIndexerDockerfile,
  /database\.clamav\.net|\bcurl\b/,
  'The image build must not depend on mutable ClamAV CDN responses.',
);
assert.match(
  hostedIndexerDockerfile,
  /sha256sum --check --strict \/usr\/local\/share\/ecos\/clamav-databases\.sha256/,
  'The image build must fail closed when a fetched definition drifts from its reviewed hash.',
);
assert.match(
  hostedIndexerDockerfile,
  /CMD \["\/usr\/local\/bin\/ecos-entrypoint"\]/,
  'The hosted worker must enter through the fail-closed malware-definition gate.',
);
assert.match(hostedIndexerDockerfile, /chmod 0444 \/var\/lib\/clamav\/\*\.cvd/);
assert.match(hostedIndexerDockerfile, /chmod 0555 \/var\/lib\/clamav/);
assert.match(
  hostedIndexerEntrypoint,
  /sha256sum --check --strict --status "\$clamav_database_checksums"/,
  'Every worker invocation must verify the image-bound definition hashes before Python starts.',
);
assert.doesNotMatch(
  hostedIndexerEntrypoint,
  /freshclam|https?:\/\//i,
  'Runtime startup must not refresh definitions or make an outbound database request.',
);
assert.ok(
  hostedIndexerEntrypoint.indexOf('/usr/bin/sha256sum') <
    hostedIndexerEntrypoint.indexOf('exec /usr/local/bin/python -m ecos_indexer'),
  'Python must not start before the image-bound definition integrity check.',
);

const expectedClamavChecksums = new Map([
  ['main.cvd', '0b2182d229f46981ec8f535382222f7c9dfdd656b250ad47988b910a8d302365'],
  ['daily.cvd', '3cdafbf2162d0ffa899836704f80929a54075708f5d671f49adfecaa1ded5623'],
  ['bytecode.cvd', '6d4aa01f219e988060fc419f495d07f27e0cdf1a2cccc065971da922c76f7ffb'],
]);
const lockedClamavChecksums = new Map();
for (const line of hostedIndexerClamavChecksums.trim().split(/\r?\n/)) {
  const match = line.match(/^([a-f0-9]{64})  (main|daily|bytecode)\.cvd$/);
  assert.ok(match, `Malformed ClamAV checksum lock line: ${line}`);
  assert.equal(lockedClamavChecksums.has(`${match[2]}.cvd`), false, 'Duplicate ClamAV lock entry.');
  lockedClamavChecksums.set(`${match[2]}.cvd`, match[1]);
}
assert.deepEqual(
  lockedClamavChecksums,
  expectedClamavChecksums,
  'ClamAV definition bytes must remain bound to the reviewed SHA-256 set.',
);

const dockerignoreRules = hostedIndexerDockerignore.split(/\r?\n/).filter(Boolean);
assert.deepEqual(
  dockerignoreRules,
  [
    '**',
    '!.dockerignore',
    '!Dockerfile',
    '!requirements.txt',
    '!entrypoint.sh',
    '!clamav-databases.sha256',
    '!ecos_indexer/',
    '!ecos_indexer/*.py',
    '!ecos_indexer/**/*.py',
  ],
  'The Cloud Build context must allow only sealed build inputs and Python package source.',
);

const runEntrypointFixture = ({ corruptDatabase = '', missingDatabase = '', missingChecksums = false }) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-entrypoint-contract-'));
  const databaseDirectory = path.join(fixtureRoot, 'clamav');
  const checksumFile = path.join(fixtureRoot, 'clamav-databases.sha256');
  const fakePython = path.join(fixtureRoot, 'python');
  const pythonEnvironment = path.join(fixtureRoot, 'python.env');
  const pythonArguments = path.join(fixtureRoot, 'python.args');
  const entrypoint = path.join(fixtureRoot, 'entrypoint.sh');
  fs.mkdirSync(databaseDirectory);
  const fixtureChecksums = [];
  for (const databaseName of ['main.cvd', 'daily.cvd', 'bytecode.cvd']) {
    const contents = Buffer.from(`fixture-${databaseName}`);
    fixtureChecksums.push(
      `${crypto.createHash('sha256').update(contents).digest('hex')}  ${databaseName}`,
    );
    if (databaseName !== missingDatabase) {
      fs.writeFileSync(
        path.join(databaseDirectory, databaseName),
        databaseName === corruptDatabase ? Buffer.from('corrupted') : contents,
      );
    }
  }
  if (!missingChecksums) fs.writeFileSync(checksumFile, `${fixtureChecksums.join('\n')}\n`);
  fs.writeFileSync(fakePython, [
    '#!/bin/sh',
    'set -eu',
    'env | sort > ' + JSON.stringify(pythonEnvironment),
    'printf \'%s\\n\' "$*" > ' + JSON.stringify(pythonArguments),
    '',
  ].join('\n'), { mode: 0o700 });
  fs.writeFileSync(
    entrypoint,
    hostedIndexerEntrypoint
      .replace('/var/lib/clamav', databaseDirectory)
      .replace('/usr/local/share/ecos/clamav-databases.sha256', checksumFile)
      .replace('/usr/bin/sha256sum', '/sbin/sha256sum')
      .replace('/usr/local/bin/python', fakePython),
    { mode: 0o700 },
  );
  try {
    const result = spawnSync('/bin/sh', [entrypoint], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        SUPABASE_URL: 'entrypoint-test-supabase-url',
        SUPABASE_SERVICE_ROLE_KEY: 'entrypoint-test-supabase-secret',
        ECOS_VISUAL_PROVIDER_TOKEN: 'entrypoint-test-provider-secret',
        ECOS_SERVICE_WORKER_TOKEN: 'entrypoint-test-worker-secret',
      },
    });
    const readFixture = fixturePath => (
      fs.existsSync(fixturePath) ? fs.readFileSync(fixturePath, 'utf8') : ''
    );
    return {
      ...result,
      pythonEnvironment: readFixture(pythonEnvironment),
      pythonArguments: readFixture(pythonArguments),
    };
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
};

const successfulEntrypoint = runEntrypointFixture({});
assert.equal(successfulEntrypoint.status, 0, successfulEntrypoint.stderr);
assert.match(successfulEntrypoint.pythonEnvironment, /entrypoint-test-supabase-secret/);
assert.equal(successfulEntrypoint.pythonArguments.trim(), '-m ecos_indexer');

const corruptedDatabaseEntrypoint = runEntrypointFixture({ corruptDatabase: 'daily.cvd' });
assert.notEqual(corruptedDatabaseEntrypoint.status, 0, 'A changed definition must stop startup.');
assert.match(corruptedDatabaseEntrypoint.stderr, /ClamAV definition integrity verification failed/);
assert.equal(corruptedDatabaseEntrypoint.pythonArguments, '', 'Python started with a changed definition.');

const missingDatabaseEntrypoint = runEntrypointFixture({ missingDatabase: 'main.cvd' });
assert.notEqual(missingDatabaseEntrypoint.status, 0, 'A missing definition must stop startup.');
assert.match(missingDatabaseEntrypoint.stderr, /ClamAV definition integrity verification failed/);
assert.equal(missingDatabaseEntrypoint.pythonArguments, '', 'Python started without all definitions.');

const missingChecksumsEntrypoint = runEntrypointFixture({ missingChecksums: true });
assert.notEqual(missingChecksumsEntrypoint.status, 0, 'A missing checksum lock must stop startup.');
assert.match(missingChecksumsEntrypoint.stderr, /ClamAV checksum lock is unavailable/);
assert.equal(missingChecksumsEntrypoint.pythonArguments, '', 'Python started without the checksum lock.');

const lockedPythonPackages = parseHashedRequirements(hostedIndexerRequirements);
const expectedPythonPackages = new Map(Object.entries({
  certifi: '2026.7.22',
  'charset-normalizer': '3.4.9',
  idna: '3.18',
  packaging: '26.3',
  pillow: '11.3.0',
  pymupdf: '1.28.2',
  pytesseract: '0.3.13',
  requests: '2.34.2',
  urllib3: '2.7.0',
}));
assert.deepEqual(
  [...lockedPythonPackages.keys()].sort(),
  [...expectedPythonPackages.keys()].sort(),
  'The hosted worker Python lock must include exactly the reviewed direct and transitive packages.',
);
for (const [name, version] of expectedPythonPackages) {
  assert.equal(lockedPythonPackages.get(name)?.version, version, `${name} must remain exactly pinned.`);
}
assert.doesNotMatch(
  hostedIndexerRequirements,
  /(?:>=|<=|~=|!=|===|(?<![=])<(?![=])|(?<![=])>(?![=])|\*)/,
  'The hosted worker Python lock must not contain ranges or wildcard versions.',
);

assert.match(
  hostedIndexerDeploy,
  /artifacts repositories create "\$\{REPOSITORY\}"[\s\S]*?--immutable-tags/,
  'New worker repositories must reject moved or overwritten tags.',
);
assert.match(
  hostedIndexerDeploy,
  /artifacts repositories update "\$\{REPOSITORY\}"[\s\S]*?--immutable-tags/,
  'Existing worker repositories must be upgraded to immutable tags before a build.',
);
assert.match(
  hostedIndexerDeploy,
  /value\(dockerConfig\.immutableTags\)/,
  'The deploy workflow must verify immutable-tag enforcement instead of assuming it.',
);
assert.match(
  hostedIndexerDeploy,
  /value\(image_summary\.fully_qualified_digest\)/,
  'The deploy workflow must resolve the build output to a fully qualified digest.',
);
assert.ok(
  hostedIndexerDeploy.includes('[[ "${IMAGE_DIGEST}" != "${IMAGE_REPOSITORY}@sha256:"* ]]') &&
    hostedIndexerDeploy.includes('[[ ! "${IMAGE_SHA256}" =~ ^[a-f0-9]{64}$ ]]'),
  'The resolved build output must be validated as the expected repository plus SHA-256 digest.',
);
assert.match(
  hostedIndexerDeploy,
  /--image="\$\{IMAGE_DIGEST\}"/,
  'Cloud Run must deploy the immutable build digest, never the mutable build tag.',
);
assert.doesNotMatch(
  hostedIndexerDeploy,
  /--image="\$\{IMAGE\}"/,
  'The mutable build tag must not cross the Cloud Run deployment boundary.',
);
assert.match(
  hostedIndexerDeploy,
  /gcloud run jobs describe[\s\S]*?--format=json/,
  'The deploy workflow must read back the complete Cloud Run job provenance.',
);
assert.ok(
  hostedIndexerDeploy.includes('container?.image !== process.env.ECOS_EXPECTED_IMAGE'),
  'The deploy workflow must fail when Cloud Run does not retain the resolved digest.',
);
assert.match(
  hostedIndexerDeploy,
  /HELD_SCHEDULE='0 0 31 2 \*'/,
  'A newly created scheduler must start with a schedule that cannot launch the worker.',
);
assert.match(
  hostedIndexerDeploy,
  /services list --enabled[\s\S]*?config\.name=cloudscheduler\.googleapis\.com[\s\S]*?value\(config\.name\)/,
  'Scheduler API state must be inspected before any controlled deployment work.',
);
assert.match(
  hostedIndexerDeploy,
  /scheduler jobs list[\s\S]*?EXPECTED_SCHEDULER_RESOURCE[\s\S]*?value\(name\)/,
  'Scheduler discovery must fail on API or permission errors instead of treating every describe failure as absence.',
);
assert.match(
  hostedIndexerDeploy,
  /run jobs list[\s\S]*?metadata\.name=\$\{JOB_NAME\}[\s\S]*?value\(metadata\.name\)/,
  'Cloud Run job discovery must fail on API or permission errors before invoker-grant cleanup.',
);
assert.doesNotMatch(
  hostedIndexerDeploy,
  /services enable[\s\S]{0,300}cloudscheduler\.googleapis\.com/,
  'The deploy workflow must not implicitly enable Scheduler and replay missed jobs.',
);
assert.match(
  hostedIndexerDeploy,
  /scheduler jobs pause "\$\{SCHEDULE_NAME\}"/,
  'The deploy workflow must explicitly pause the scheduler.',
);
assert.match(
  hostedIndexerDeploy,
  /if \[\[ "\$\{SCHEDULER_STATE\}" != "PAUSED" \]\]/,
  'The deploy workflow must verify that the scheduler remains paused after its update.',
);
assert.ok(
  hostedIndexerDeploy.indexOf('if [[ "${SCHEDULER_STATE}" != "PAUSED" ]]') <
    hostedIndexerDeploy.indexOf('gcloud run jobs add-iam-policy-binding'),
  'Scheduler pause verification must precede the worker invocation grant.',
);
assert.ok(
  hostedIndexerDeploy.indexOf('gcloud run jobs remove-iam-policy-binding') <
    hostedIndexerDeploy.indexOf('gcloud builds submit'),
  'Any pre-existing scheduler invocation grant must be removed before Cloud Build.',
);
assert.ok(
  hostedIndexerDeploy.indexOf('REMAINING_SCHEDULER_INVOKER_ROLE=') <
    hostedIndexerDeploy.indexOf('gcloud builds submit'),
  'Invocation-grant removal must be read back before Cloud Build.',
);

const runHostedDeployFixture = ({
  resolvedImage,
  deployedImage,
  schedulerExists = true,
  schedulerState = 'PAUSED',
  schedulerPostUpdateState = '',
  schedulerApiState = 'ENABLED',
  schedulerListSucceeds = true,
  schedulerUpdateSucceeds = true,
  existingInvoker = true,
  invokerRemovalSucceeds = true,
  runJobExists = true,
  runJobListSucceeds = true,
  executeAfterDeploy = false,
  supabaseUrlSecretVersion = '3',
  supabaseServiceRoleSecretVersion = '7',
  visualProviderEnabled = 'true',
  visualProviderUrlSecretVersion = '5',
  serviceWorkerTokenSecretVersion = '9',
  secretVersionState = 'ENABLED',
  deployedSecretBindings = null,
}) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-supply-chain-contract-'));
  const fixtureBin = path.join(fixtureRoot, 'bin');
  const commandLog = path.join(fixtureRoot, 'gcloud.log');
  const schedulerStateFile = path.join(fixtureRoot, 'scheduler-state');
  const invokerStateFile = path.join(fixtureRoot, 'invoker-state');
  fs.mkdirSync(fixtureBin);
  fs.writeFileSync(schedulerStateFile, schedulerState + '\n');
  fs.writeFileSync(invokerStateFile, existingInvoker ? 'roles/run.invoker\n' : '');
  const expectedBindings = {
    SUPABASE_URL: `ecos-supabase-url:${supabaseUrlSecretVersion}`,
    SUPABASE_SERVICE_ROLE_KEY: `ecos-supabase-service-role-key:${supabaseServiceRoleSecretVersion}`,
    ...(visualProviderEnabled === 'true' ? {
      ECOS_VISUAL_PROVIDER_URL: `ecos-visual-provider-url:${visualProviderUrlSecretVersion}`,
      ECOS_VISUAL_PROVIDER_TOKEN: `ecos-service-worker-token:${serviceWorkerTokenSecretVersion}`,
    } : {}),
  };
  const deployedJobJson = JSON.stringify({
    spec: {
      template: {
        spec: {
          template: {
            spec: {
              containers: [{
                image: deployedImage,
                env: Object.entries(deployedSecretBindings || expectedBindings).map(([name, binding]) => {
                  const separator = binding.lastIndexOf(':');
                  return {
                    name,
                    valueFrom: {
                      secretKeyRef: {
                        name: binding.slice(0, separator),
                        key: binding.slice(separator + 1),
                      },
                    },
                  };
                }),
              }],
            },
          },
        },
      },
    },
  });
  fs.writeFileSync(path.join(fixtureBin, 'gcloud'), [
    '#!/usr/bin/env bash',
    'set -eu',
    'printf \'%s\\n\' "$*" >> "$ECOS_FAKE_GCLOUD_LOG"',
    'case "$*" in',
    '  services\\ list\\ --enabled\\ *) if [[ "$ECOS_FAKE_SCHEDULER_API_STATE" == "ENABLED" ]]; then printf \'cloudscheduler.googleapis.com\\n\'; fi ;;',
    '  *"dockerConfig.immutableTags"*) printf \'true\\n\' ;;',
    '  "artifacts docker images describe "*) printf \'%s\\n\' "$ECOS_FAKE_RESOLVED_IMAGE" ;;',
    '  "secrets versions describe "*) printf \'%s\\n\' "$ECOS_FAKE_SECRET_VERSION_STATE" ;;',
    '  "run jobs remove-iam-policy-binding "*) if [[ "$ECOS_FAKE_INVOKER_REMOVAL_SUCCEEDS" == "true" ]]; then : > "$ECOS_FAKE_INVOKER_STATE_FILE"; else exit 1; fi ;;',
    '  "run jobs get-iam-policy "*) cat "$ECOS_FAKE_INVOKER_STATE_FILE" ;;',
    '  "run jobs add-iam-policy-binding "*) printf \'roles/run.invoker\\n\' > "$ECOS_FAKE_INVOKER_STATE_FILE" ;;',
    '  "run jobs list "*) if [[ "$ECOS_FAKE_RUN_JOB_LIST_SUCCEEDS" != "true" ]]; then exit 1; elif [[ "$ECOS_FAKE_RUN_JOB_EXISTS" == "true" ]]; then printf \'fixture-job\\n\'; fi ;;',
    '  "run jobs describe "*"--format=json"*) printf \'%s\\n\' "$ECOS_FAKE_DEPLOYED_JOB_JSON" ;;',
    '  "run jobs describe "*) printf \'%s\\n\' "$ECOS_FAKE_DEPLOYED_IMAGE" ;;',
    '  scheduler\\ jobs\\ list\\ *) if [[ "$ECOS_FAKE_SCHEDULER_LIST_SUCCEEDS" != "true" ]]; then exit 1; elif [[ "$ECOS_FAKE_SCHEDULER_EXISTS" == "true" ]]; then printf \'fixture-schedule\\n\'; fi ;;',
    '  scheduler\\ jobs\\ create\\ http\\ *) printf \'ENABLED\\n\' > "$ECOS_FAKE_SCHEDULER_STATE_FILE" ;;',
    '  scheduler\\ jobs\\ pause\\ *) printf \'PAUSED\\n\' > "$ECOS_FAKE_SCHEDULER_STATE_FILE" ;;',
    '  scheduler\\ jobs\\ update\\ http\\ *) if [[ "$ECOS_FAKE_SCHEDULER_UPDATE_SUCCEEDS" != "true" ]]; then exit 1; elif [[ -n "$ECOS_FAKE_SCHEDULER_POST_UPDATE_STATE" ]]; then printf \'%s\\n\' "$ECOS_FAKE_SCHEDULER_POST_UPDATE_STATE" > "$ECOS_FAKE_SCHEDULER_STATE_FILE"; fi ;;',
    '  scheduler\\ jobs\\ describe\\ *"value(state)"*) cat "$ECOS_FAKE_SCHEDULER_STATE_FILE" ;;',
    'esac',
    '',
  ].join('\n'), { mode: 0o700 });
  try {
    const result = spawnSync('/bin/bash', [path.join(root, 'scripts', 'deploy-ecos-hosted-indexer.sh')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: fixtureBin + ':' + process.env.PATH,
        ECOS_FAKE_GCLOUD_LOG: commandLog,
        ECOS_FAKE_RESOLVED_IMAGE: resolvedImage,
        ECOS_FAKE_DEPLOYED_IMAGE: deployedImage,
        ECOS_FAKE_DEPLOYED_JOB_JSON: deployedJobJson,
        ECOS_FAKE_SECRET_VERSION_STATE: secretVersionState,
        ECOS_FAKE_SCHEDULER_EXISTS: schedulerExists ? 'true' : 'false',
        ECOS_FAKE_SCHEDULER_STATE_FILE: schedulerStateFile,
        ECOS_FAKE_SCHEDULER_POST_UPDATE_STATE: schedulerPostUpdateState,
        ECOS_FAKE_SCHEDULER_API_STATE: schedulerApiState,
        ECOS_FAKE_SCHEDULER_LIST_SUCCEEDS: schedulerListSucceeds ? 'true' : 'false',
        ECOS_FAKE_SCHEDULER_UPDATE_SUCCEEDS: schedulerUpdateSucceeds ? 'true' : 'false',
        ECOS_FAKE_INVOKER_STATE_FILE: invokerStateFile,
        ECOS_FAKE_INVOKER_REMOVAL_SUCCEEDS: invokerRemovalSucceeds ? 'true' : 'false',
        ECOS_FAKE_RUN_JOB_EXISTS: runJobExists ? 'true' : 'false',
        ECOS_FAKE_RUN_JOB_LIST_SUCCEEDS: runJobListSucceeds ? 'true' : 'false',
        ECOS_GCP_PROJECT_ID: 'fixture-project',
        ECOS_GCP_REGION: 'us-west1',
        ECOS_GCP_ARTIFACT_REPOSITORY: 'fixture-repository',
        ECOS_GCP_JOB_NAME: 'fixture-job',
        ECOS_GCP_SCHEDULE_NAME: 'fixture-schedule',
        ECOS_GCP_IMAGE_TAG: 'contract-test',
        ECOS_EXECUTE_AFTER_DEPLOY: executeAfterDeploy ? 'true' : 'false',
        ...(supabaseUrlSecretVersion == null ? {} : {
          ECOS_SUPABASE_URL_SECRET_VERSION: String(supabaseUrlSecretVersion),
        }),
        ...(supabaseServiceRoleSecretVersion == null ? {} : {
          ECOS_SUPABASE_SERVICE_ROLE_KEY_SECRET_VERSION: String(supabaseServiceRoleSecretVersion),
        }),
        ECOS_VISUAL_PROVIDER_ENABLED: visualProviderEnabled,
        ...(visualProviderUrlSecretVersion == null ? {} : {
          ECOS_VISUAL_PROVIDER_URL_SECRET_VERSION: String(visualProviderUrlSecretVersion),
        }),
        ...(serviceWorkerTokenSecretVersion == null ? {} : {
          ECOS_SERVICE_WORKER_TOKEN_SECRET_VERSION: String(serviceWorkerTokenSecretVersion),
        }),
      },
    });
    return {
      ...result,
      commandLog: fs.existsSync(commandLog) ? fs.readFileSync(commandLog, 'utf8') : '',
    };
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
};

const fixtureRepository = 'us-west1-docker.pkg.dev/fixture-project/fixture-repository/fixture-job';
const fixtureDigest = fixtureRepository + '@sha256:' + 'a'.repeat(64);
const successfulDeploy = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  schedulerState: 'ENABLED',
});
assert.equal(successfulDeploy.status, 0, successfulDeploy.stderr);
assert.match(
  successfulDeploy.commandLog,
  /artifacts repositories update fixture-repository[^\n]*--immutable-tags/,
  'The realistic deploy boundary must enable immutable tags on an existing repository.',
);
const cloudRunDeploy = successfulDeploy.commandLog.split('\n')
  .find(line => line.startsWith('run jobs deploy fixture-job '));
assert.ok(
  cloudRunDeploy?.includes('--image=' + fixtureDigest),
  'Cloud Run must receive the resolved digest.',
);
assert.equal(
  cloudRunDeploy?.includes('--image=' + fixtureRepository + ':contract-test'),
  false,
  'Cloud Run must never receive the build tag.',
);
assert.ok(
  cloudRunDeploy?.includes(
    '--set-secrets=SUPABASE_URL=ecos-supabase-url:3,' +
    'SUPABASE_SERVICE_ROLE_KEY=ecos-supabase-service-role-key:7,' +
    'ECOS_VISUAL_PROVIDER_URL=ecos-visual-provider-url:5,' +
    'ECOS_VISUAL_PROVIDER_TOKEN=ecos-service-worker-token:9',
  ),
  'Cloud Run must receive only the explicitly approved numeric secret versions.',
);
assert.doesNotMatch(cloudRunDeploy || '', /:latest(?:,|$)/,
  'Cloud Run must never receive a moving secret alias.');
const successfulDeployCommands = successfulDeploy.commandLog.trim().split('\n');
const pauseCommandIndex = successfulDeployCommands.findIndex(line =>
  line.startsWith('scheduler jobs pause fixture-schedule '),
);
const schedulerUpdateIndex = successfulDeployCommands.findIndex(line =>
  line.startsWith('scheduler jobs update http fixture-schedule '),
);
const invocationGrantIndex = successfulDeployCommands.findIndex(line =>
  line.startsWith('run jobs add-iam-policy-binding fixture-job '),
);
const cloudBuildIndex = successfulDeployCommands.findIndex(line =>
  line.startsWith('builds submit workers/ecos-indexer '),
);
assert.ok(pauseCommandIndex >= 0, 'An enabled scheduler must be paused explicitly.');
assert.ok(pauseCommandIndex < cloudBuildIndex, 'An existing scheduler must be paused before Cloud Build starts.');
const invocationRemovalIndex = successfulDeployCommands.findIndex(line =>
  line.startsWith('run jobs remove-iam-policy-binding fixture-job '),
);
const invocationReadbackIndex = successfulDeployCommands.findIndex(line =>
  line.startsWith('run jobs get-iam-policy fixture-job '),
);
assert.ok(invocationRemovalIndex >= 0 && invocationRemovalIndex < cloudBuildIndex);
assert.ok(invocationReadbackIndex > invocationRemovalIndex && invocationReadbackIndex < cloudBuildIndex);
assert.ok(schedulerUpdateIndex > pauseCommandIndex, 'Scheduler configuration must happen after pausing.');
assert.ok(invocationGrantIndex > schedulerUpdateIndex, 'Invocation access must be granted only after paused configuration.');

const newSchedulerDeploy = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  schedulerExists: false,
  runJobExists: false,
  existingInvoker: false,
});
assert.equal(newSchedulerDeploy.status, 0, newSchedulerDeploy.stderr);
assert.match(
  newSchedulerDeploy.commandLog,
  /scheduler jobs create http fixture-schedule[^\n]*--schedule=0 0 31 2 \*[^\n]*--time-zone=UTC/,
  'A new scheduler must be created with the inert held schedule before it is paused.',
);
assert.match(newSchedulerDeploy.commandLog, /scheduler jobs pause fixture-schedule/);

const alreadyHeldDeploy = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  schedulerState: 'PAUSED',
});
assert.equal(alreadyHeldDeploy.status, 0, alreadyHeldDeploy.stderr);

const noVisualProviderDeploy = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  visualProviderEnabled: 'false',
  visualProviderUrlSecretVersion: null,
  serviceWorkerTokenSecretVersion: null,
});
assert.equal(noVisualProviderDeploy.status, 0, noVisualProviderDeploy.stderr);
const noVisualProviderCommand = noVisualProviderDeploy.commandLog.split('\n')
  .find(line => line.startsWith('run jobs deploy fixture-job '));
assert.match(
  noVisualProviderCommand || '',
  /--set-secrets=SUPABASE_URL=ecos-supabase-url:3,SUPABASE_SERVICE_ROLE_KEY=ecos-supabase-service-role-key:7(?: |$)/,
  'The explicit no-visual deployment must retain only the exact Supabase bindings.',
);
assert.doesNotMatch(noVisualProviderCommand || '', /ECOS_VISUAL_PROVIDER/);

const missingSecretVersion = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  supabaseUrlSecretVersion: null,
});
assert.notEqual(missingSecretVersion.status, 0, 'A missing required secret version must fail closed.');
assert.match(missingSecretVersion.stderr, /immutable numeric Secret Manager version/);
assert.doesNotMatch(missingSecretVersion.commandLog, /builds submit|scheduler jobs pause/);

const movingSecretAlias = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  supabaseUrlSecretVersion: 'latest',
});
assert.notEqual(movingSecretAlias.status, 0, 'A moving secret alias must fail closed.');
assert.match(movingSecretAlias.stderr, /aliases such as latest are forbidden/);
assert.doesNotMatch(movingSecretAlias.commandLog, /builds submit|scheduler jobs pause/);

const incompleteVisualSecretVersions = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  serviceWorkerTokenSecretVersion: null,
});
assert.notEqual(incompleteVisualSecretVersions.status, 0,
  'An incomplete visual secret-version pair must fail closed.');
assert.doesNotMatch(incompleteVisualSecretVersions.commandLog, /builds submit|scheduler jobs pause/);

const disabledBoundSecretVersion = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  secretVersionState: 'DISABLED',
});
assert.notEqual(disabledBoundSecretVersion.status, 0,
  'A disabled exact secret version must fail closed.');
assert.match(disabledBoundSecretVersion.stderr, /Required bound secret version is not enabled/);
assert.doesNotMatch(disabledBoundSecretVersion.commandLog, /builds submit workers\/ecos-indexer/);

const driftedSecretReadback = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  deployedSecretBindings: {
    SUPABASE_URL: 'ecos-supabase-url:latest',
    SUPABASE_SERVICE_ROLE_KEY: 'ecos-supabase-service-role-key:7',
    ECOS_VISUAL_PROVIDER_URL: 'ecos-visual-provider-url:5',
    ECOS_VISUAL_PROVIDER_TOKEN: 'ecos-service-worker-token:9',
  },
});
assert.notEqual(driftedSecretReadback.status, 0,
  'A deployed secret-binding drift must fail before Scheduler invocation is restored.');
assert.match(driftedSecretReadback.stderr, /Cloud Run secret binding verification failed/);
assert.doesNotMatch(
  driftedSecretReadback.commandLog,
  /run jobs add-iam-policy-binding fixture-job/,
  'Scheduler invocation must not be restored after secret-binding drift.',
);

const unknownSchedulerState = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  schedulerState: 'UPDATE_FAILED',
});
assert.notEqual(unknownSchedulerState.status, 0, 'An unknown existing scheduler state must fail closed.');
assert.doesNotMatch(unknownSchedulerState.commandLog, /builds submit workers\/ecos-indexer/);

const unsafeSchedulerState = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  schedulerPostUpdateState: 'ENABLED',
});
assert.notEqual(unsafeSchedulerState.status, 0, 'A scheduler that resumes after update must fail closed.');
assert.match(unsafeSchedulerState.stderr, /did not remain paused after configuration update/);
assert.doesNotMatch(
  unsafeSchedulerState.commandLog,
  /run jobs add-iam-policy-binding fixture-job/,
  'Invocation access must not be granted when paused-state verification fails.',
);

const disabledSchedulerApi = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  schedulerApiState: 'DISABLED',
});
assert.notEqual(disabledSchedulerApi.status, 0, 'A disabled Scheduler API must require controlled bootstrap.');
assert.match(disabledSchedulerApi.stderr, /separately controlled bootstrap/);
assert.doesNotMatch(disabledSchedulerApi.commandLog, /builds submit workers\/ecos-indexer/);

const schedulerDiscoveryFailure = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  schedulerListSucceeds: false,
});
assert.notEqual(schedulerDiscoveryFailure.status, 0, 'Scheduler discovery errors must fail closed.');
assert.doesNotMatch(schedulerDiscoveryFailure.commandLog, /builds submit workers\/ecos-indexer/);

const retainedInvoker = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  invokerRemovalSucceeds: false,
});
assert.notEqual(retainedInvoker.status, 0, 'A retained scheduler invoker grant must fail closed.');
assert.match(retainedInvoker.stderr, /invocation access could not be removed before build/);
assert.doesNotMatch(retainedInvoker.commandLog, /builds submit workers\/ecos-indexer/);

const runJobDiscoveryFailure = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  runJobListSucceeds: false,
});
assert.notEqual(runJobDiscoveryFailure.status, 0, 'Cloud Run job discovery errors must fail closed.');
assert.doesNotMatch(runJobDiscoveryFailure.commandLog, /builds submit workers\/ecos-indexer/);

const schedulerUpdateFailure = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  schedulerUpdateSucceeds: false,
});
assert.notEqual(schedulerUpdateFailure.status, 0, 'A scheduler update failure must fail closed.');
assert.doesNotMatch(schedulerUpdateFailure.commandLog, /run jobs add-iam-policy-binding fixture-job/);

const explicitManualExecution = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureDigest,
  executeAfterDeploy: true,
});
assert.equal(explicitManualExecution.status, 0, explicitManualExecution.stderr);
const manualCommands = explicitManualExecution.commandLog.trim().split('\n');
const manualExecuteIndex = manualCommands.findIndex(line => line.startsWith('run jobs execute fixture-job '));
const manualGrantIndex = manualCommands.findIndex(line => line.startsWith('run jobs add-iam-policy-binding fixture-job '));
assert.ok(manualExecuteIndex > manualGrantIndex, 'Explicit manual execution must occur only after the paused deploy gate.');

const invalidBuildOutput = runHostedDeployFixture({
  resolvedImage: fixtureRepository + ':contract-test',
  deployedImage: fixtureDigest,
});
assert.notEqual(invalidBuildOutput.status, 0, 'A tag-shaped build result must fail closed.');
assert.match(invalidBuildOutput.stderr, /did not resolve inside the expected worker repository/);
assert.doesNotMatch(invalidBuildOutput.commandLog, /run jobs deploy fixture-job/);

const mismatchedDeployment = runHostedDeployFixture({
  resolvedImage: fixtureDigest,
  deployedImage: fixtureRepository + '@sha256:' + 'b'.repeat(64),
});
assert.notEqual(mismatchedDeployment.status, 0, 'A changed Cloud Run digest must fail closed.');
assert.match(mismatchedDeployment.stderr, /Cloud Run image digest verification failed/);
assert.doesNotMatch(
  mismatchedDeployment.commandLog,
  /run jobs add-iam-policy-binding/,
  'Scheduler invocation setup must not continue after a digest mismatch.',
);

const runHostedSecretConfigurationFixture = ({ malformedVersion = false } = {}) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-secret-version-contract-'));
  const fixtureBin = path.join(fixtureRoot, 'bin');
  const commandLog = path.join(fixtureRoot, 'commands.log');
  const versionManifest = path.join(fixtureRoot, 'exact-secret-versions.env');
  fs.mkdirSync(fixtureBin);
  fs.writeFileSync(path.join(fixtureBin, 'gcloud'), [
    '#!/usr/bin/env bash',
    'set -eu',
    'printf \'gcloud %s\\n\' "$*" >> "$ECOS_FAKE_SECRET_COMMAND_LOG"',
    'case "$*" in',
    '  "secrets versions add ecos-supabase-url "*) cat >/dev/null; printf \'projects/fixture-project/secrets/ecos-supabase-url/versions/%s\\n\' "$ECOS_FAKE_URL_VERSION" ;;',
    '  "secrets versions add ecos-supabase-service-role-key "*) cat >/dev/null; printf \'projects/fixture-project/secrets/ecos-supabase-service-role-key/versions/7\\n\' ;;',
    '  "secrets versions add ecos-visual-provider-url "*) cat >/dev/null; printf \'projects/fixture-project/secrets/ecos-visual-provider-url/versions/5\\n\' ;;',
    '  "secrets versions add ecos-service-worker-token "*) cat >/dev/null; printf \'projects/fixture-project/secrets/ecos-service-worker-token/versions/9\\n\' ;;',
    'esac',
    '',
  ].join('\n'), { mode: 0o700 });
  fs.writeFileSync(path.join(fixtureBin, 'npx'), [
    '#!/usr/bin/env bash',
    'set -eu',
    'printf \'npx supabase secrets set invoked\\n\' >> "$ECOS_FAKE_SECRET_COMMAND_LOG"',
    '',
  ].join('\n'), { mode: 0o700 });
  const protectedValues = {
    SUPABASE_URL: 'https://secret-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'protected-service-role-value',
    ECOS_VISUAL_PROVIDER_URL: 'https://protected-visual.example.test',
    ECOS_SERVICE_WORKER_TOKEN: 'protected-worker-token',
  };
  const result = spawnSync('/bin/bash', [
    path.join(root, 'scripts', 'configure-ecos-hosted-indexer-secrets.sh'),
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: fixtureBin + ':' + process.env.PATH,
      ECOS_FAKE_SECRET_COMMAND_LOG: commandLog,
      ECOS_FAKE_URL_VERSION: malformedVersion ? 'latest' : '3',
      ECOS_GCP_PROJECT_ID: 'fixture-project',
      SUPABASE_PROJECT_REF: 'fixture-ref',
      ECOS_HOSTED_SECRET_VERSION_OUTPUT: versionManifest,
      ...protectedValues,
    },
  });
  const output = `${result.stdout}${result.stderr}${
    fs.existsSync(commandLog) ? fs.readFileSync(commandLog, 'utf8') : ''
  }`;
  for (const value of Object.values(protectedValues)) {
    assert.equal(output.includes(value), false, 'Secret configuration output exposed a protected value.');
  }
  const manifest = fs.existsSync(versionManifest)
    ? fs.readFileSync(versionManifest, 'utf8')
    : null;
  const manifestMode = fs.existsSync(versionManifest)
    ? fs.statSync(versionManifest).mode & 0o777
    : null;
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  return { ...result, manifest, manifestMode };
};

const exactSecretConfiguration = runHostedSecretConfigurationFixture();
assert.equal(exactSecretConfiguration.status, 0, exactSecretConfiguration.stderr);
assert.equal(exactSecretConfiguration.manifest, [
  'ECOS_SUPABASE_URL_SECRET_VERSION=3',
  'ECOS_SUPABASE_SERVICE_ROLE_KEY_SECRET_VERSION=7',
  'ECOS_VISUAL_PROVIDER_ENABLED=true',
  'ECOS_VISUAL_PROVIDER_URL_SECRET_VERSION=5',
  'ECOS_SERVICE_WORKER_TOKEN_SECRET_VERSION=9',
  '',
].join('\n'));
assert.equal(exactSecretConfiguration.manifestMode, 0o600,
  'Exact secret-version manifests must remain operator-only.');

const malformedSecretConfiguration = runHostedSecretConfigurationFixture({ malformedVersion: true });
assert.notEqual(malformedSecretConfiguration.status, 0,
  'Secret configuration must fail when Secret Manager does not return a numeric version.');
assert.match(malformedSecretConfiguration.stderr, /did not return one immutable numeric version/);
assert.equal(malformedSecretConfiguration.manifest, null,
  'A malformed version must not produce an approval manifest.');

console.log(
  'Dependency security contract PASS: application and hosted-worker inputs stay immutable, hashed, and digest-deployed.',
);
