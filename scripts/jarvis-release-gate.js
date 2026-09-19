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
  'jarvis-release-manifest.json',
);
const evidencePolicy = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'validation', 'jarvis', 'release-evidence-policy.json'),
  'utf8',
));
const escapedDefectRegistry = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'validation', 'jarvis', 'escaped-defects.json'),
  'utf8',
));
const MIN_LAYER_TIMEOUT_MS = 30_000;
const MAX_LAYER_TIMEOUT_MS = 30 * 60_000;

const layers = [
  layer('Release configuration', 'check', 5),
  layer('Ask ECOS live real-world acceptance', 'check:ecos-ask:live-evidence', 2),
  layer('Dependency security contract', 'test:dependency-security', 2),
  layer('Protected cleanup and operations monitoring', 'test:production-operations-health', 2),
  layer('Reproducible native release generation', 'test:native-release-generation', 2),
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
  layer('Authoritative intelligence integration', 'test:authoritative-intelligence', 2),
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

function readGitResult(args, options = {}) {
  const runGit = options.runGit || spawnSync;
  const cwd = options.cwd || repoRoot;
  const result = runGit('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status === 0 && !result.error) {
    return { value: String(result.stdout || '').trim(), error: null };
  }
  return {
    value: null,
    error: result.error?.message
      || String(result.stderr || '').trim()
      || `git ${args.join(' ')} exited with ${String(result.status)}`,
  };
}

function repositorySnapshot(options = {}) {
  const commitResult = readGitResult(['rev-parse', 'HEAD'], options);
  const branchResult = readGitResult(['branch', '--show-current'], options);
  // `all` can emit tens of thousands of paths and overflow a child-process buffer.
  // `normal` still reports every tracked change plus one entry for each untracked
  // file or directory, which is the release-relevant truth this count represents.
  const statusResult = readGitResult(
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    options,
  );
  const status = statusResult.value;
  const inspectionErrors = [
    commitResult.error ? `commit: ${commitResult.error}` : null,
    statusResult.error ? `status: ${statusResult.error}` : null,
  ].filter(Boolean);
  return {
    commit: commitResult.value,
    branch: branchResult.value,
    dirty: status === null ? null : status.length > 0,
    dirtyEntryCount: status === null
      ? null
      : status.split(/\r?\n/).filter(Boolean).length,
    dirtyEntryMode: 'porcelain_v1_untracked_files_or_directories',
    inspectionStatus: status === null || commitResult.value === null ? 'failed' : 'complete',
    inspectionError: inspectionErrors.length > 0 ? inspectionErrors.join('; ') : null,
  };
}

function repositoryCandidateResult(repository) {
  const inspected = repository.inspectionStatus === 'complete'
    && typeof repository.dirty === 'boolean'
    && Number.isInteger(repository.dirtyEntryCount)
    && /^[0-9a-f]{40,64}$/i.test(String(repository.commit || ''));
  const clean = inspected && repository.dirty === false;
  return {
    label: 'Exact repository candidate identity',
    script: 'internal:repository-candidate',
    status: clean ? 'pass' : 'fail',
    durationMs: 0,
    timeoutMs: 0,
    timedOut: false,
    exitCode: clean ? 0 : 1,
    signal: null,
    error: clean
      ? null
      : inspected
        ? `Working tree has ${repository.dirtyEntryCount} dirty status entries.`
        : `Working-tree inspection failed: ${repository.inspectionError || 'unknown Git error'}`,
  };
}

function buildReleaseManifest({
  startedAt,
  finishedAt,
  repository,
  environment,
  results,
}) {
  const manifestResults = results.some(
    result => result.script === 'internal:repository-candidate',
  )
    ? results
    : [repositoryCandidateResult(repository), ...results];
  const failed = manifestResults.filter(result => result.status === 'fail');
  const warnings = manifestResults.filter(result => result.status === 'warn');
  const androidSigning = manifestResults.find(
    result => result.script === 'check:android-production-signing',
  );
  const automatedGate = failed.length > 0
    ? 'fail'
    : warnings.length > 0
      ? 'pass_with_warnings'
      : 'pass';

  return {
    schemaVersion: 1,
    gate: 'ECOS Assurance Automated Release Gate',
    identity: evidencePolicy.identity,
    startedAt,
    finishedAt,
    repository,
    environment,
    summary: {
      automatedGate,
      passedLayers: manifestResults.filter(result => result.status === 'pass').length,
      warningLayers: warnings.length,
      failedLayers: failed.length,
      releaseCertification: failed.length > 0
        ? 'not_certified'
        : 'device_validation_required',
      androidProductionCertification: androidSigning?.status === 'pass'
        ? 'configuration_passed_artifact_signature_unverified'
        : 'not_certified',
    },
    layers: manifestResults,
    evidence: {
      deviceValidation: {
        status: 'required',
        requiredPlatforms: evidencePolicy.requiredPlatforms,
        requiredJourneys: evidencePolicy.requiredDeviceJourneys.map(journey => journey.id),
        template: 'validation/jarvis/device-evidence-template.json',
      },
      performance: {
        status: 'measurement_required',
        budgets: evidencePolicy.performanceBudgets,
      },
      visualRegression: {
        status: evidencePolicy.certificationRules.missingVisualBaselineStatus,
        baselineDefinition: 'validation/jarvis/visual-regression-baselines.json',
      },
      historicalDefectReplay: {
        status: 'registered',
        registeredDefectFamilies: escapedDefectRegistry.defects.length,
        registry: 'validation/jarvis/escaped-defects.json',
      },
    },
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

  console.log('ECOS Assurance Automated Release Gate');
  console.log(`Started: ${startedAt}`);
  console.log('This gate runs automated evidence. It does not certify physical-device behavior.');
  if (repository.dirty === false) {
    console.log('Repository candidate: clean working tree.');
  } else if (repository.dirty === true) {
    console.log(
      `Repository candidate: BLOCKED by ${repository.dirtyEntryCount} dirty status entries.`,
    );
  } else {
    console.log(
      `Repository candidate: BLOCKED because Git inspection failed (${repository.inspectionError || 'unknown error'}).`,
    );
  }
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

  console.log('\nECOS Assurance Automated Gate Summary');
  manifest.layers.forEach(result => {
    console.log(
      `${result.status.toUpperCase()} ${result.label} (${(result.durationMs / 1000).toFixed(1)}s)`,
    );
    if (result.timedOut) console.log(`  Timed out after ${Math.round(result.timeoutMs / 1000)}s.`);
    if (result.error) console.log(`  ${result.error}`);
  });
  console.log('');
  console.log(
    `Automated Gate: ${
      manifest.summary.failedLayers > 0
        ? 'FAIL'
        : manifest.summary.warningLayers > 0
          ? 'PASS WITH WARNINGS'
          : 'PASS'
    }`,
  );
  console.log(`Machine-readable manifest: ${path.relative(repoRoot, manifestPath)}`);
  console.log(
    `Release Certification: ${manifest.summary.releaseCertification === 'not_certified'
      ? 'NOT CERTIFIED'
      : 'DEVICE VALIDATION REQUIRED'}`,
  );
  console.log('Not certified by this automated run:');
  manifest.manualValidationRequired.forEach(item => console.log(`- ${item}`));

  if (manifest.summary.failedLayers > 0) process.exitCode = 1;
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
  repositoryCandidateResult,
  repositorySnapshot,
  runReleaseGate,
};
