#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeOverlaySpec } = require('./vitruvius-sealed-candidate');
const { prepareOverlayDraft } = require('./vitruvius-release-overlay-draft');

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(
      result.error?.message
      || String(result.stderr || '').trim()
      || `${command} exited with ${String(result.status)}`,
    );
  }
  return String(result.stdout || '').trim();
}

function writeFile(filePath, contents, mode = 0o644) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { encoding: 'utf8', mode });
  fs.chmodSync(filePath, mode);
}

function initializeRepository(repositoryRoot, files) {
  fs.mkdirSync(repositoryRoot, { recursive: true });
  run('git', ['init', '--quiet', '--initial-branch=main'], repositoryRoot);
  run('git', ['config', 'user.name', 'Fixture'], repositoryRoot);
  run('git', ['config', 'user.email', 'fixture@local.invalid'], repositoryRoot);
  for (const [relativePath, descriptorValue] of Object.entries(files)) {
    const descriptor = typeof descriptorValue === 'string'
      ? { contents: descriptorValue, mode: 0o644 }
      : descriptorValue;
    writeFile(
      path.join(repositoryRoot, relativePath),
      descriptor.contents,
      descriptor.mode || 0o644,
    );
  }
  run('git', ['add', '--force', '--all'], repositoryRoot);
  run('git', ['commit', '--quiet', '-m', 'Baseline'], repositoryRoot, {
    ...process.env,
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  });
  return run('git', ['rev-parse', 'HEAD'], repositoryRoot);
}

function outputOptions(temporaryRoot, sourceRoot, baselineCommit, suffix, allowUntracked) {
  return {
    sourceRoot,
    baselineCommit,
    allowUntracked,
    draftPath: path.join(temporaryRoot, `${suffix}.overlay.json`),
    summaryPath: path.join(temporaryRoot, `${suffix}.summary.md`),
  };
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vitruvius-overlay-draft-test-'));

try {
  const sourceRoot = path.join(temporaryRoot, 'source');
  const baselineCommit = initializeRepository(sourceRoot, {
    '.gitignore': 'allowed-dir/ignored-source.ts\n',
    'app.txt': 'baseline app\n',
    'old.txt': 'delete me\n',
    'unchanged.txt': 'unchanged\n',
    'scripts/run.sh': { contents: '#!/bin/sh\necho baseline\n', mode: 0o755 },
  });
  writeFile(path.join(sourceRoot, 'app.txt'), 'reviewed app\n');
  fs.unlinkSync(path.join(sourceRoot, 'old.txt'));
  writeFile(path.join(sourceRoot, 'scripts/run.sh'), '#!/bin/sh\necho reviewed\n', 0o755);
  writeFile(path.join(sourceRoot, 'allowed-dir/new.js'), 'module.exports = true;\n');
  writeFile(path.join(sourceRoot, 'allowed-dir/ignored-source.ts'), 'export const ignoredButApproved = true;\n');
  writeFile(path.join(sourceRoot, 'allowed-dir/nested/new.json'), '{"ready":true}\n');
  writeFile(path.join(sourceRoot, 'exact/single.ts'), 'export const exact = true;\n');
  writeFile(path.join(sourceRoot, 'notes/private.txt'), 'unrelated user work\n');
  writeFile(path.join(sourceRoot, 'allowed-dir/__pycache__/cache.pyc'), 'cache bytes\n');
  writeFile(path.join(sourceRoot, 'allowed-dir/.DS_Store'), 'macOS metadata\n');
  writeFile(path.join(sourceRoot, 'allowed-dir/.temp/session.json'), '{"token":"must-not-enter"}\n');
  writeFile(path.join(sourceRoot, 'allowed-dir/.pytest_cache/lastfailed'), '{}\n');
  writeFile(path.join(sourceRoot, 'allowed-dir/nested/.env.production'), 'TOKEN=must-not-enter\n');
  writeFile(path.join(sourceRoot, 'tmp/diagnose.js'), 'temporary diagnostic\n');
  writeFile(
    path.join(sourceRoot, 'validation/local-vision-benchmark/results/local.json'),
    '{"local":true}\n',
  );
  writeFile(path.join(sourceRoot, 'validation/builds/old-release.app.zip'), 'release artifact\n');
  writeFile(path.join(sourceRoot, 'validation/renderings/desktop.png'), 'render bytes\n');
  writeFile(path.join(sourceRoot, '.env.local'), 'SECRET=must-not-enter\n');
  writeFile(path.join(sourceRoot, 'eng.traineddata'), 'local OCR model artifact\n');

  const options = outputOptions(
    temporaryRoot,
    sourceRoot,
    baselineCommit,
    'review',
    ['allowed-dir', 'exact/single.ts'],
  );
  const sourceStatusBefore = run(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    sourceRoot,
  );
  const result = prepareOverlayDraft(options);
  const sourceStatusAfter = run(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    sourceRoot,
  );
  assert.equal(sourceStatusAfter, sourceStatusBefore, 'Draft preparation must not mutate the source.');
  assert.equal(fs.existsSync(path.join(temporaryRoot, 'sealed-candidate')), false);

  const draft = JSON.parse(fs.readFileSync(result.draftPath, 'utf8'));
  assert.deepEqual(normalizeOverlaySpec(draft), draft, 'The draft must be accepted unchanged by the sealer schema.');
  assert.deepEqual(
    draft.entries.map(entry => entry.path),
    [
      'allowed-dir/ignored-source.ts',
      'allowed-dir/nested/new.json',
      'allowed-dir/new.js',
      'app.txt',
      'exact/single.ts',
      'old.txt',
      'scripts/run.sh',
    ],
  );
  assert.equal(draft.entries.find(entry => entry.path === 'app.txt').allowNew, false);
  assert.equal(draft.entries.find(entry => entry.path === 'old.txt').operation, 'delete');
  assert.equal(draft.entries.find(entry => entry.path === 'scripts/run.sh').mode, '100755');
  for (const relativePath of [
    'allowed-dir/nested/new.json',
    'allowed-dir/ignored-source.ts',
    'allowed-dir/new.js',
    'exact/single.ts',
  ]) {
    assert.equal(draft.entries.find(entry => entry.path === relativePath).allowNew, true);
  }
  for (const forbiddenPath of [
    '.env.local',
    'allowed-dir/.DS_Store',
    'allowed-dir/.pytest_cache/lastfailed',
    'allowed-dir/.temp/session.json',
    'allowed-dir/__pycache__/cache.pyc',
    'allowed-dir/nested/.env.production',
    'eng.traineddata',
    'notes/private.txt',
    'tmp/diagnose.js',
    'validation/local-vision-benchmark/results/local.json',
    'validation/builds/old-release.app.zip',
    'validation/renderings/desktop.png',
  ]) {
    assert.equal(
      draft.entries.some(entry => entry.path === forbiddenPath),
      false,
      `${forbiddenPath} must not enter the review draft.`,
    );
  }
  assert.equal(result.excludedUntracked.count, 1);
  assert.deepEqual(result.excludedUntracked.sample, ['notes/private.txt']);
  assert.equal(result.deniedUntracked.count, 11);
  assert.deepEqual(result.deniedUntracked.sample, [
    '.env.local',
    'allowed-dir/.DS_Store',
    'allowed-dir/.pytest_cache/lastfailed',
    'allowed-dir/.temp/session.json',
    'allowed-dir/__pycache__/cache.pyc',
    'allowed-dir/nested/.env.production',
    'eng.traineddata',
    'tmp/diagnose.js',
    'validation/builds/old-release.app.zip',
    'validation/local-vision-benchmark/results/local.json',
    'validation/renderings/desktop.png',
  ]);

  const summary = fs.readFileSync(result.summaryPath, 'utf8');
  assert.match(summary, /DRAFT ONLY\. This tool did not seal, build, deploy, reindex, install, stage, or commit anything/);
  assert.match(summary, /Allowed new-path rules/);
  assert.match(summary, /Untracked paths deliberately excluded/);
  assert.match(summary, /Denied generated, benchmark, cache, or secret paths/);
  assert.match(summary, /Only after approval, pass the unchanged draft JSON/);
  assert.equal(fs.statSync(result.draftPath).mode & 0o077, 0);
  assert.equal(fs.statSync(result.summaryPath).mode & 0o077, 0);

  const noMatch = outputOptions(
    temporaryRoot,
    sourceRoot,
    baselineCommit,
    'no-match',
    ['unchanged.txt'],
  );
  assert.throws(
    () => prepareOverlayDraft(noMatch),
    /matched no eligible new source files/,
  );
  assert.equal(fs.existsSync(noMatch.draftPath), false);
  assert.equal(fs.existsSync(noMatch.summaryPath), false);

  assert.throws(
    () => prepareOverlayDraft(outputOptions(
      temporaryRoot,
      sourceRoot,
      baselineCommit,
      'forbidden-rule',
      ['validation/local-vision-benchmark'],
    )),
    /cannot be allowed/,
  );
  assert.throws(
    () => prepareOverlayDraft({
      sourceRoot,
      baselineCommit,
      allowUntracked: [],
      draftPath: path.join(sourceRoot, 'draft.json'),
      summaryPath: path.join(temporaryRoot, 'inside-source-summary.md'),
    }),
    /must be outside the source worktree/,
  );

  const forbiddenTrackedRoot = path.join(temporaryRoot, 'forbidden-tracked-source');
  const forbiddenTrackedBaseline = initializeRepository(forbiddenTrackedRoot, {
    'app.txt': 'baseline\n',
    'validation/local-vision-benchmark/fixture.txt': 'tracked local benchmark\n',
  });
  writeFile(
    path.join(forbiddenTrackedRoot, 'validation/local-vision-benchmark/fixture.txt'),
    'modified local benchmark\n',
  );
  const forbiddenTrackedOptions = outputOptions(
    temporaryRoot,
    forbiddenTrackedRoot,
    forbiddenTrackedBaseline,
    'forbidden-tracked',
    [],
  );
  assert.throws(
    () => prepareOverlayDraft(forbiddenTrackedOptions),
    /Baseline contains a forbidden/,
  );
  assert.equal(fs.existsSync(forbiddenTrackedOptions.draftPath), false);
  assert.equal(fs.existsSync(forbiddenTrackedOptions.summaryPath), false);

  console.log('Vitruvius review-only release overlay draft contracts PASS.');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
