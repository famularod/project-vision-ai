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
  repositoryCandidateResult,
  repositorySnapshot,
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
  repository: {
    commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    branch: 'test',
    dirty: true,
    dirtyEntryCount: 1,
    dirtyEntryMode: 'porcelain_v1_untracked_files_or_directories',
    inspectionStatus: 'complete',
    inspectionError: null,
  },
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
assert.equal(manifest.summary.automatedGate, 'fail');
assert.equal(manifest.summary.failedLayers, 1);
assert.equal(manifest.layers[0].script, 'internal:repository-candidate');
assert.match(manifest.layers[0].error, /1 dirty status entr/);
assert.equal(manifest.summary.androidProductionCertification, 'not_certified');
assert.equal(manifest.summary.releaseCertification, 'not_certified');
assert.equal(manifest.gate, 'ECOS Assurance Automated Release Gate');
assert.deepEqual(manifest.identity, {
  product: 'Vitruvius',
  intelligenceSystem: 'ECOS',
  intelligenceEngine: 'ECOS Core',
  qaSystem: 'ECOS Assurance',
  qaNameStatus: 'canonical',
});
assert.equal(manifest.evidence.deviceValidation.status, 'required');
assert.deepEqual(manifest.evidence.deviceValidation.requiredPlatforms, ['iphone', 'ipad', 'web']);
assert.equal(manifest.evidence.performance.status, 'measurement_required');
assert.equal(manifest.evidence.visualRegression.status, 'visual_baseline_required');
assert(manifest.evidence.historicalDefectReplay.registeredDefectFamilies >= 25);

const fakeGit = (_command, args) => {
  const key = args.join(' ');
  if (key === 'rev-parse HEAD') {
    return { status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' };
  }
  if (key === 'branch --show-current') return { status: 0, stdout: 'release/test\n' };
  if (key === 'status --porcelain=v1 --untracked-files=normal') {
    return { status: 0, stdout: ' M App.tsx\n?? generated-output/\n' };
  }
  throw new Error(`Unexpected git call: ${key}`);
};
const dirtySnapshot = repositorySnapshot({ runGit: fakeGit, cwd: '/test' });
assert.equal(dirtySnapshot.dirty, true);
assert.equal(dirtySnapshot.dirtyEntryCount, 2);
assert.equal(dirtySnapshot.inspectionStatus, 'complete');
assert.equal(repositoryCandidateResult(dirtySnapshot).status, 'fail');

const failedGitSnapshot = repositorySnapshot({
  cwd: '/test',
  runGit: (_command, args) => args[0] === 'status'
    ? { status: null, stdout: '', stderr: '', error: new Error('stdout maxBuffer exceeded') }
    : { status: 0, stdout: 'value\n' },
});
assert.equal(failedGitSnapshot.dirty, null);
assert.equal(failedGitSnapshot.dirtyEntryCount, null);
assert.equal(failedGitSnapshot.inspectionStatus, 'failed');
assert.match(failedGitSnapshot.inspectionError, /maxBuffer/);
assert.equal(repositoryCandidateResult(failedGitSnapshot).status, 'fail');

const cleanCandidate = repositoryCandidateResult({
  commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  branch: 'release/test',
  dirty: false,
  dirtyEntryCount: 0,
  inspectionStatus: 'complete',
  inspectionError: null,
});
assert.equal(cleanCandidate.status, 'pass');

const missingCommitCandidate = repositoryCandidateResult({
  commit: null,
  branch: 'release/test',
  dirty: false,
  dirtyEntryCount: 0,
  inspectionStatus: 'failed',
  inspectionError: 'commit: unavailable',
});
assert.equal(missingCommitCandidate.status, 'fail');
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
  'check:ecos-build160-migration-evidence',
  'check:cover-hardening-migration-evidence',
  'check:source-provenance-acl-migration-evidence',
  'check:ecos-ask:live-evidence',
  'check:ecos-ask:2321-live-evidence',
  'test:dependency-security',
  'test:production-operations-health',
  'test:native-release-generation',
]) {
  assert(
    releaseGateSource.includes(script),
    `ECOS Assurance must report ${script} as a named release layer.`,
  );
}
assert(
  releaseGateSource.indexOf('check:ecos-build160-migration-evidence')
    < releaseGateSource.indexOf('check:cover-hardening-migration-evidence'),
  'The frozen-five receipt must precede the continuation receipt that verifies both post-frozen transitions.',
);
assert(
  releaseGateSource.indexOf('check:cover-hardening-migration-evidence')
    < releaseGateSource.indexOf('check:source-provenance-acl-migration-evidence'),
  'The sealed cover receipt must precede its managed-source provenance continuation.',
);
assert(
  releaseGateSource.indexOf('check:source-provenance-acl-migration-evidence')
    < releaseGateSource.indexOf('check:ecos-ask:live-evidence'),
  'All database rehearsal and post-apply receipts must gate live Ask acceptance.',
);
const packageScripts = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
).scripts;
assert.equal(
  packageScripts['run:ecos-build160-migration-rehearsal'],
  'node scripts/ecos-build160-migration-evidence.js rehearsal',
);
assert.equal(
  packageScripts['run:ecos-build160-migration-postapply'],
  'node scripts/ecos-build160-migration-evidence.js postapply',
);
assert.equal(
  packageScripts['check:ecos-build160-migration-evidence'],
  'node scripts/ecos-build160-migration-evidence-gate.js',
);
assert.equal(
  packageScripts['run:postfrozen-migration-rehearsal'],
  'node scripts/vitruvius-postfrozen-migration-evidence.js rehearsal',
);
assert.equal(
  packageScripts['run:postfrozen-migration-postapply'],
  'node scripts/vitruvius-postfrozen-migration-evidence.js postapply',
);
assert.equal(
  packageScripts['check:postfrozen-migration-evidence'],
  'node scripts/vitruvius-postfrozen-migration-evidence-gate.js',
);
assert.equal(
  packageScripts['run:cover-hardening-migration-rehearsal'],
  'node scripts/vitruvius-cover-hardening-migration-evidence.js rehearsal',
);
assert.equal(
  packageScripts['run:cover-hardening-migration-postapply'],
  'node scripts/vitruvius-cover-hardening-migration-evidence.js postapply',
);
assert.equal(
  packageScripts['check:cover-hardening-migration-evidence'],
  'node scripts/vitruvius-cover-hardening-migration-evidence-gate.js',
);
assert.equal(
  packageScripts['run:source-provenance-migration-rehearsal'],
  'node scripts/vitruvius-source-provenance-migration-evidence.js rehearsal',
);
assert.equal(
  packageScripts['run:source-provenance-migration-postapply'],
  'node scripts/vitruvius-source-provenance-migration-evidence.js postapply',
);
assert.equal(
  packageScripts['check:source-provenance-migration-evidence'],
  'node scripts/vitruvius-source-provenance-migration-evidence-gate.js',
);
assert.equal(
  packageScripts['run:source-provenance-acl-migration-rehearsal'],
  'node scripts/vitruvius-source-provenance-acl-migration-evidence.js rehearsal',
);
assert.equal(
  packageScripts['run:source-provenance-acl-migration-postapply'],
  'node scripts/vitruvius-source-provenance-acl-migration-evidence.js postapply',
);
assert.equal(
  packageScripts['check:source-provenance-acl-migration-evidence'],
  'node scripts/vitruvius-source-provenance-acl-migration-evidence-gate.js',
);

console.log('ECOS Assurance release gate timeout and manifest contracts PASS.');
