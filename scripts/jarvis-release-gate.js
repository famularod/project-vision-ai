#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const manifestPath = path.join(
  repoRoot,
  'validation',
  'output',
  'vic-release-manifest.json',
);
const MIN_LAYER_TIMEOUT_MS = 30_000;
const MAX_LAYER_TIMEOUT_MS = 30 * 60_000;

const layers = [
  layer('Release configuration', 'check', 5),
  layer('Release, migration, UI, and device-flow contracts', 'test:release-contracts', 5),
  layer('Android production signing readiness', 'check:android-production-signing', 2),
  layer('App-shell architecture', 'test:architecture', 5),
  layer('Service boundaries', 'test:service-architecture', 5),
  layer('Behavior and regression suite', 'test:behavior', 20),
  layer('User-interface contracts', 'test:ui', 10),
  layer('Report truth and accounting', 'test:reporter', 5),
  layer('Core workflow simulation', 'test:e2e-core-flow', 5),
  layer('Photo intelligence', 'test:photo-intelligence', 10),
  layer('Authority and safety contracts', 'test:audit-contracts', 15),
  layer('Escaped-defect coverage audit', 'test:jarvis-coverage', 5),
  layer('Web production export', 'web:export', 10),
  layer('Static product contracts', 'jarvis:contracts', 5),
];

function layer(label, script, timeoutMinutes) {
  return { label, script, timeoutMs: timeoutMinutes * 60_000 };
}

function boundedLayerTimeoutMs(value, fallbackMs) {
  const parsed = Number(value);
  const candidate = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
  return Math.min(MAX_LAYER_TIMEOUT_MS, Math.max(MIN_LAYER_TIMEOUT_MS, Math.round(candidate)));
}

function classifyLayerResult(result) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const timedOut = result.error?.code === 'ETIMEDOUT';
  if (result.error || result.status !== 0) {
    return { status: 'fail', timedOut };
  }
  if (output.includes('VIC_GATE_STATUS=WARN')) {
    return { status: 'warn', timedOut: false };
  }
  return { status: 'pass', timedOut: false };
}

function readGitValue(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });
  return result.status === 0 ? String(result.stdout || '').trim() : null;
}

function repositorySnapshot() {
  const status = readGitValue(['status', '--porcelain', '--untracked-files=all']);
  return {
    commit: readGitValue(['rev-parse', 'HEAD']),
    branch: readGitValue(['branch', '--show-current']),
    dirty: status === null ? null : status.length > 0,
    dirtyEntryCount: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
  };
}

function buildReleaseManifest({
  startedAt,
  finishedAt,
  repository,
  environment,
  results,
}) {
  const failed = results.filter(result => result.status === 'fail');
  const warnings = results.filter(result => result.status === 'warn');
  const androidSigning = results.find(
    result => result.script === 'check:android-production-signing',
  );
  const automatedGate = failed.length > 0
    ? 'fail'
    : warnings.length > 0
      ? 'pass_with_warnings'
      : 'pass';

  return {
    schemaVersion: 1,
    gate: 'V.I.C. Automated Release Gate',
    startedAt,
    finishedAt,
    repository,
    environment,
    summary: {
      automatedGate,
      passedLayers: results.filter(result => result.status === 'pass').length,
      warningLayers: warnings.length,
      failedLayers: failed.length,
      releaseCertification: failed.length > 0
        ? 'not_certified'
        : 'device_validation_required',
      androidProductionCertification: androidSigning?.status === 'pass'
        ? 'configuration_passed_artifact_signature_unverified'
        : 'not_certified',
    },
    layers: results,
    manualValidationRequired: [
      'live iPhone, iPad, and web changes propagating without a restart',
      'camera, location, native sign-in, offline recovery, and touch latency on physical devices',
      'visual layout review across supported screen sizes',
      'real Supabase, storage, edge-function, and external AI-provider availability',
      'production Android artifact signing when Android release is in scope',
    ],
  };
}

function writeManifest(manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(temporaryPath, manifestPath);
}

function runReleaseGate(env = process.env) {
  const startedAt = new Date().toISOString();
  const repository = repositorySnapshot();
  const results = [];
  const globalTimeout = env.VIC_LAYER_TIMEOUT_MS;

  console.log('V.I.C. Automated Release Gate');
  console.log(`Started: ${startedAt}`);
  console.log('This gate runs automated evidence. It does not certify physical-device behavior.');
  console.log('');

  for (const configuredLayer of layers) {
    const startedMs = Date.now();
    const timeoutMs = boundedLayerTimeoutMs(globalTimeout, configuredLayer.timeoutMs);
    console.log(
      `\n=== ${configuredLayer.label} (${configuredLayer.script}; timeout ${Math.round(timeoutMs / 1000)}s) ===`,
    );
    const result = spawnSync(npmCommand, ['run', configuredLayer.script], {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
      maxBuffer: 256 * 1024 * 1024,
      timeout: timeoutMs,
      killSignal: 'SIGTERM',
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    const classification = classifyLayerResult(result);
    results.push({
      label: configuredLayer.label,
      script: configuredLayer.script,
      status: classification.status,
      durationMs: Date.now() - startedMs,
      timeoutMs,
      timedOut: classification.timedOut,
      exitCode: result.status,
      signal: result.signal || null,
      error: result.error?.message || null,
    });
  }

  const failed = results.filter(result => result.status === 'fail');
  const warnings = results.filter(result => result.status === 'warn');
  const manifest = buildReleaseManifest({
    startedAt,
    finishedAt: new Date().toISOString(),
    repository,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      ci: Boolean(env.CI),
      releaseTarget: env.VIC_RELEASE_TARGET || 'unspecified',
      productionAndroidSigningRequired:
        env.VIC_REQUIRE_PRODUCTION_ANDROID_SIGNING === '1'
        || env.VIC_REQUIRE_PRODUCTION_ANDROID_SIGNING === 'true'
        || ['android', 'android-production', 'all', 'all-production']
          .includes(String(env.VIC_RELEASE_TARGET || '').toLowerCase()),
    },
    results,
  });
  writeManifest(manifest);

  console.log('\nV.I.C. Automated Gate Summary');
  results.forEach(result => {
    console.log(
      `${result.status.toUpperCase()} ${result.label} (${(result.durationMs / 1000).toFixed(1)}s)`,
    );
    if (result.timedOut) console.log(`  Timed out after ${Math.round(result.timeoutMs / 1000)}s.`);
    if (result.error) console.log(`  ${result.error}`);
  });
  console.log('');
  console.log(
    `Automated Gate: ${
      failed.length > 0
        ? 'FAIL'
        : warnings.length > 0
          ? 'PASS WITH WARNINGS'
          : 'PASS'
    }`,
  );
  console.log(`Machine-readable manifest: ${path.relative(repoRoot, manifestPath)}`);
  console.log('Release Certification: DEVICE VALIDATION REQUIRED');
  console.log('Not certified by this automated run:');
  manifest.manualValidationRequired.forEach(item => console.log(`- ${item}`));

  if (failed.length > 0) process.exitCode = 1;
  return manifest;
}

if (require.main === module) {
  runReleaseGate();
}

module.exports = {
  MAX_LAYER_TIMEOUT_MS,
  MIN_LAYER_TIMEOUT_MS,
  boundedLayerTimeoutMs,
  buildReleaseManifest,
  classifyLayerResult,
  runReleaseGate,
};
