#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  SCHEMA_VERSION,
  normalizeOverlaySpec,
  sealCandidate,
  sha256,
} = require('./vitruvius-sealed-candidate');

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
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

function initializeFixtureRepository(repositoryRoot, files) {
  fs.mkdirSync(repositoryRoot, { recursive: true });
  run('git', ['init', '--quiet', '--initial-branch=main'], repositoryRoot);
  run('git', ['config', 'user.name', 'Fixture'], repositoryRoot);
  run('git', ['config', 'user.email', 'fixture@local.invalid'], repositoryRoot);
  for (const [relativePath, value] of Object.entries(files)) {
    const descriptor = typeof value === 'string' ? { contents: value } : value;
    writeFile(
      path.join(repositoryRoot, relativePath),
      descriptor.contents,
      descriptor.mode || 0o644,
    );
  }
  run('git', ['add', '--force', '--all'], repositoryRoot);
  const fixedEnvironment = {
    ...process.env,
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  };
  run('git', ['commit', '--quiet', '-m', 'Fixture baseline'], repositoryRoot, fixedEnvironment);
  return run('git', ['rev-parse', 'HEAD'], repositoryRoot);
}

function writeOverlay(filePath, spec) {
  fs.writeFileSync(filePath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
}

function fileSha(contents) {
  return sha256(Buffer.from(contents, 'utf8'));
}

function candidateOptions(root, sourceRoot, overlayPath, suffix) {
  return {
    sourceRoot,
    overlayPath,
    outputDir: path.join(root, `candidate-${suffix}`),
    evidencePath: path.join(root, `candidate-${suffix}.manifest.json`),
  };
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vitruvius-sealed-candidate-test-'));

try {
  const sourceRoot = path.join(temporaryRoot, 'source');
  const baselineApp = 'baseline application\n';
  const deletedContents = 'retired baseline file\n';
  const baselineCommit = initializeFixtureRepository(sourceRoot, {
    '.gitignore': 'ignored-source.txt\n',
    'app.txt': baselineApp,
    'delete.txt': deletedContents,
    'ignored-source.txt': 'tracked even though the candidate ignore rule matches it\n',
    'scripts/run.sh': { contents: '#!/bin/sh\necho baseline\n', mode: 0o755 },
  });

  const reviewedApp = 'reviewed release application\n';
  const reviewedNewFile = 'export const sealed = true;\n';
  writeFile(path.join(sourceRoot, 'app.txt'), reviewedApp);
  writeFile(path.join(sourceRoot, 'src/new.ts'), reviewedNewFile);
  writeFile(path.join(sourceRoot, 'notes/private.txt'), 'unrelated user work\n');
  writeFile(path.join(sourceRoot, 'output/generated.txt'), 'generated artifact\n');

  const overlayPath = path.join(temporaryRoot, 'overlay.json');
  const overlaySpec = {
    schemaVersion: SCHEMA_VERSION,
    baselineCommit,
    entries: [
      {
        path: 'src/new.ts',
        operation: 'upsert',
        sha256: fileSha(reviewedNewFile),
        mode: '100644',
        allowNew: true,
      },
      {
        path: 'delete.txt',
        operation: 'delete',
        baselineSha256: fileSha(deletedContents),
      },
      {
        path: 'app.txt',
        operation: 'upsert',
        sha256: fileSha(reviewedApp),
        mode: '100644',
      },
    ],
  };
  writeOverlay(overlayPath, overlaySpec);

  const sourceStatusBefore = run(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    sourceRoot,
  );
  const first = sealCandidate(candidateOptions(
    temporaryRoot,
    sourceRoot,
    overlayPath,
    'one',
  ));
  const second = sealCandidate(candidateOptions(
    temporaryRoot,
    sourceRoot,
    overlayPath,
    'two',
  ));
  const sourceStatusAfter = run(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    sourceRoot,
  );

  assert.equal(sourceStatusAfter, sourceStatusBefore, 'Sealing must not mutate the source worktree.');
  assert.equal(fs.readFileSync(path.join(first.candidateRoot, 'app.txt'), 'utf8'), reviewedApp);
  assert.equal(fs.readFileSync(path.join(first.candidateRoot, 'src/new.ts'), 'utf8'), reviewedNewFile);
  assert.equal(fs.existsSync(path.join(first.candidateRoot, 'delete.txt')), false);
  assert.equal(fs.existsSync(path.join(first.candidateRoot, 'notes/private.txt')), false);
  assert.equal(fs.existsSync(path.join(first.candidateRoot, 'output/generated.txt')), false);
  assert.equal(
    fs.statSync(path.join(first.candidateRoot, 'scripts/run.sh')).mode & 0o111,
    0o111,
    'Executable modes from the baseline must be preserved.',
  );
  assert.equal(run('git', ['status', '--porcelain=v1', '--untracked-files=all'], first.candidateRoot), '');
  assert.equal(run('git', ['remote'], first.candidateRoot), '');
  assert.match(
    run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], first.candidateRoot),
    /^ignored-source\.txt$/m,
    'The isolated Git identity must include baseline-tracked files even when .gitignore matches them.',
  );
  assert.equal(first.manifest.candidateGit.branch, 'sealed-candidate');
  assert.equal(first.manifest.candidateGit.clean, true);
  assert.equal(first.manifest.originalWorktree.entryCount, 4);
  assert.deepEqual(
    first.manifest.overlayAllowlist.entries.map(entry => entry.path),
    ['app.txt', 'delete.txt', 'src/new.ts'],
    'The allowlist must be canonical and byte-sorted.',
  );
  assert.deepEqual(
    first.manifest.sourceManifest.entries.map(entry => entry.path),
    ['.gitignore', 'app.txt', 'ignored-source.txt', 'scripts/run.sh', 'src/new.ts'],
    'The source manifest must contain only the baseline plus explicit overlay.',
  );
  assert.equal(
    first.manifest.sourceManifest.sha256,
    second.manifest.sourceManifest.sha256,
    'Identical source candidates must have an identical manifest hash.',
  );
  assert.equal(
    first.manifest.candidateGit.commit,
    second.manifest.candidateGit.commit,
    'Identical candidates must receive an identical isolated Git identity.',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(first.evidencePath, 'utf8')).sourceManifest.sha256,
    first.manifest.sourceManifest.sha256,
  );

  const staleHashOverlay = path.join(temporaryRoot, 'overlay-stale-hash.json');
  writeOverlay(staleHashOverlay, {
    ...overlaySpec,
    entries: [{
      path: 'app.txt',
      operation: 'upsert',
      sha256: '0'.repeat(64),
      mode: '100644',
    }],
  });
  const staleHashOptions = candidateOptions(
    temporaryRoot,
    sourceRoot,
    staleHashOverlay,
    'stale-hash',
  );
  assert.throws(
    () => sealCandidate(staleHashOptions),
    /Reviewed SHA-256 no longer matches/,
  );
  assert.equal(
    fs.existsSync(staleHashOptions.outputDir),
    false,
    'A failed seal must not publish a partial candidate directory.',
  );
  assert.equal(
    fs.existsSync(staleHashOptions.evidencePath),
    false,
    'A failed seal must not publish evidence for a missing candidate.',
  );

  const newWithoutApprovalOverlay = path.join(temporaryRoot, 'overlay-new-without-approval.json');
  writeOverlay(newWithoutApprovalOverlay, {
    ...overlaySpec,
    entries: [{
      path: 'src/new.ts',
      operation: 'upsert',
      sha256: fileSha(reviewedNewFile),
      mode: '100644',
    }],
  });
  assert.throws(
    () => sealCandidate(candidateOptions(
      temporaryRoot,
      sourceRoot,
      newWithoutApprovalOverlay,
      'new-without-approval',
    )),
    /requires allowNew=true/,
  );

  const deleteMismatchOverlay = path.join(temporaryRoot, 'overlay-delete-mismatch.json');
  writeOverlay(deleteMismatchOverlay, {
    ...overlaySpec,
    entries: [{
      path: 'delete.txt',
      operation: 'delete',
      baselineSha256: 'f'.repeat(64),
    }],
  });
  assert.throws(
    () => sealCandidate(candidateOptions(
      temporaryRoot,
      sourceRoot,
      deleteMismatchOverlay,
      'delete-mismatch',
    )),
    /Baseline hash mismatch/,
  );

  assert.throws(
    () => normalizeOverlaySpec({
      schemaVersion: SCHEMA_VERSION,
      baselineCommit,
      entries: [{
        path: '../escape.txt',
        operation: 'upsert',
        sha256: 'a'.repeat(64),
        mode: '100644',
        allowNew: true,
      }],
    }),
    /not canonical/,
  );
  for (const forbiddenPath of [
    '.DS_Store',
    'eng.traineddata',
    'supabase/.temp/pooler-url',
    'ios/some/nested/DerivedData/App.build/object.o',
    'tmp/diagnose.js',
    'validation/output/release.json',
    'validation/builds/old-release.app.zip',
    'validation/local-vision-benchmark/result.json',
    'validation/renderings/desktop.png',
    'workers/ecos-indexer/.pytest_cache/lastfailed',
    'workers/ecos-indexer/__pycache__/worker.cpython-314.pyc',
    'config/private/.env.production',
  ]) {
    assert.throws(
      () => normalizeOverlaySpec({
        schemaVersion: SCHEMA_VERSION,
        baselineCommit,
        entries: [{
          path: forbiddenPath,
          operation: 'upsert',
          sha256: 'a'.repeat(64),
          mode: '100644',
          allowNew: true,
        }],
      }),
      /cannot enter a candidate/,
    );
  }
  assert.throws(
    () => sealCandidate({
      sourceRoot,
      overlayPath,
      outputDir: path.join(sourceRoot, 'candidate-inside-source'),
      evidencePath: path.join(temporaryRoot, 'candidate-inside-source.manifest.json'),
    }),
    /must be outside the original source worktree/,
  );

  const generatedRepository = path.join(temporaryRoot, 'generated-source');
  const generatedBaseline = initializeFixtureRepository(generatedRepository, {
    'app.txt': 'tracked source\n',
    'dist/generated.js': 'tracked generated output\n',
  });
  const generatedOverlayPath = path.join(temporaryRoot, 'generated-overlay.json');
  writeOverlay(generatedOverlayPath, {
    schemaVersion: SCHEMA_VERSION,
    baselineCommit: generatedBaseline,
    entries: [],
  });
  assert.throws(
    () => sealCandidate(candidateOptions(
      temporaryRoot,
      generatedRepository,
      generatedOverlayPath,
      'generated-baseline',
    )),
    /Generated, secret, or repository-control path is present/,
  );

  console.log('Vitruvius sealed release-candidate contracts PASS.');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
