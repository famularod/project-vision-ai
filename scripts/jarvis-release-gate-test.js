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
  'check:ecos-ask:live-evidence',
  'test:dependency-security',
  'test:production-operations-health',
  'test:native-release-generation',
]) {
  assert(
    releaseGateSource.includes(script),
    `ECOS Assurance must report ${script} as a named release layer.`,
  );
}

// Review pass 1, L11: five check scripts were run by nothing automatic. No
// release-gate layer reached them through package.json, and one was not
// named in package.json at all, so all five stayed red, unseen, from the
// first commit this repository keeps until they were repaired by hand.
// Each must be reached from a gate layer the way every other check script
// is: a package script that names it, inside a group a layer runs.
const packageScripts = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
).scripts;
const gateLayerScripts = [...releaseGateSource.matchAll(/layer\('[^']+',\s*'([^']+)',\s*\d+\)/g)]
  .map(match => match[1]);
assert(gateLayerScripts.length >= 19, 'The release gate\'s layers could not be read from its source.');

/** The check-script files a package script runs, through any "npm run" chain. */
function scriptFilesRunBy(name, seen = new Set(), files = new Set()) {
  if (seen.has(name)) return files;
  seen.add(name);
  const body = packageScripts[name];
  assert(typeof body === 'string', `package.json has no script named ${name}.`);
  for (const match of body.matchAll(/npm run ([\w:.-]+)/g)) scriptFilesRunBy(match[1], seen, files);
  for (const match of body.matchAll(/node scripts\/([\w.-]+\.js)/g)) files.add(match[1]);
  return files;
}

const layersThatRun = new Map();
for (const layerScript of gateLayerScripts) {
  for (const file of scriptFilesRunBy(layerScript)) {
    layersThatRun.set(file, [...(layersThatRun.get(file) || []), layerScript]);
  }
}
for (const file of [
  'dave-assertion-authority-static-test.js',
  'dave-communications-test.js',
  'dave-field-test-readiness-test.js',
  'dave-intelligence-test.js',
  'project-area-persistence-test.js',
]) {
  assert(
    fs.existsSync(path.join(__dirname, file)),
    `scripts/${file} is missing.`,
  );
  assert(
    layersThatRun.has(file),
    `No release-gate layer runs scripts/${file}. Name it in a package script that a gate layer runs.`,
  );
  // None of them needs the suite's half hour, and that layer has the least room.
  assert(
    !layersThatRun.get(file).includes('test:behavior'),
    `scripts/${file} must not be added to the behaviour layer, which is the one layer close to its time limit.`,
  );
}
// The group they are in must not start the whole "check" again (it needs the network for one of its steps).
for (const group of ['test:authority-contracts', 'test:workspace-contracts']) {
  assert(
    !new Set(reachedPackageScripts(group)).has('check'),
    `${group} must not run "npm run check" again.`,
  );
}

function reachedPackageScripts(name, seen = new Set()) {
  if (seen.has(name)) return [...seen];
  seen.add(name);
  for (const match of (packageScripts[name] || '').matchAll(/npm run ([\w:.-]+)/g)) reachedPackageScripts(match[1], seen);
  return [...seen];
}

console.log('ECOS Assurance release gate timeout and manifest contracts PASS.');

// The gate's strict jest step has its own contract (Build 231 E1: on GitHub
// the suite runs as in-band parts side by side). It runs from here so that
// the release-hardening checks, which run this file, hold it as well.
require('./jarvis-jest-gate-test');
