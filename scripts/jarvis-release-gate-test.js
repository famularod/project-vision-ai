#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MAX_LAYER_TIMEOUT_MS,
  MIN_LAYER_TIMEOUT_MS,
  boundedLayerTimeoutMs,
  buildReleaseManifest,
  classifyLayerResult,
} = require('./jarvis-release-gate');

assert.equal(boundedLayerTimeoutMs('1', 60_000), MIN_LAYER_TIMEOUT_MS);
assert.equal(boundedLayerTimeoutMs(String(MAX_LAYER_TIMEOUT_MS + 1), 60_000), MAX_LAYER_TIMEOUT_MS);
assert.equal(boundedLayerTimeoutMs('invalid', 75_000), 75_000);
assert.deepEqual(classifyLayerResult({ status: 0, stdout: 'PASS' }), {
  status: 'pass',
  timedOut: false,
});
assert.deepEqual(classifyLayerResult({ status: 0, stdout: 'VIC_GATE_STATUS=WARN' }), {
  status: 'warn',
  timedOut: false,
});
assert.deepEqual(
  classifyLayerResult({
    status: null,
    error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
  }),
  { status: 'fail', timedOut: true },
);

const manifest = buildReleaseManifest({
  startedAt: '2026-07-22T00:00:00.000Z',
  finishedAt: '2026-07-22T00:01:00.000Z',
  repository: { commit: 'abc', branch: 'test', dirty: true, dirtyEntryCount: 1 },
  environment: {
    nodeVersion: 'v20',
    platform: 'test',
    architecture: 'test',
    ci: true,
    releaseTarget: 'ios',
    productionAndroidSigningRequired: false,
  },
  results: [
    {
      label: 'Android production signing readiness',
      script: 'check:android-production-signing',
      status: 'warn',
    },
    { label: 'Tests', script: 'test', status: 'pass' },
  ],
});
assert.equal(manifest.summary.automatedGate, 'pass_with_warnings');
assert.equal(manifest.summary.androidProductionCertification, 'not_certified');
assert.equal(manifest.summary.releaseCertification, 'device_validation_required');
assert.equal(manifest.gate, 'Jarvis Automated Release Gate');
assert.deepEqual(manifest.identity, {
  product: 'Vitruvius',
  intelligenceEngine: 'Core',
  qaSystem: 'Jarvis',
  qaNameStatus: 'working_name',
});
assert.equal(manifest.evidence.deviceValidation.status, 'required');
assert.deepEqual(manifest.evidence.deviceValidation.requiredPlatforms, ['iphone', 'ipad', 'web']);
assert.equal(manifest.evidence.performance.status, 'measurement_required');
assert.equal(manifest.evidence.visualRegression.status, 'visual_baseline_required');
assert(manifest.evidence.historicalDefectReplay.registeredDefectFamilies >= 25);
assert.match(
  fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'),
  /^\/validation\/output\/$/m,
  'Generated release manifests must stay out of source control.',
);
const releaseGateSource = fs.readFileSync(
  path.join(__dirname, 'jarvis-release-gate.js'),
  'utf8',
);
for (const script of [
  'test:dependency-security',
  'test:production-operations-health',
  'test:native-release-generation',
]) {
  assert(
    releaseGateSource.includes(script),
    `Jarvis must report ${script} as a named release layer.`,
  );
}

console.log('Jarvis release gate timeout and manifest contracts PASS.');
