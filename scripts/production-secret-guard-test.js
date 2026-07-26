#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceGuard = path.join(root, 'scripts', 'production-secret-guard.js');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vitruvius-secret-guard-'));

function runGuard() {
  return spawnSync(
    process.execPath,
    [path.join(fixtureRoot, 'scripts', 'production-secret-guard.js')],
    {
    cwd: fixtureRoot,
    encoding: 'utf8',
    },
  );
}

try {
  fs.mkdirSync(path.join(fixtureRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'new-runtime-feature'), { recursive: true });
  fs.copyFileSync(
    sourceGuard,
    path.join(fixtureRoot, 'scripts', 'production-secret-guard.js'),
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'App.tsx'),
    "import {\n  runtimeValue,\n} from './new-runtime-feature/runtime';\nexport default runtimeValue;\n",
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'new-runtime-feature', 'runtime.ts'),
    `export const runtimeValue = '${'sk-' + 'a'.repeat(28)}';\n`,
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'unreachable.ts'),
    `export const ignoredFixture = '${'sk-' + 'b'.repeat(28)}';\n`,
  );

  const reachableFailure = runGuard();
  assert.notEqual(
    reachableFailure.status,
    0,
    'A secret-shaped value in an untracked runtime dependency must fail the guard.',
  );
  assert.match(
    `${reachableFailure.stdout}\n${reachableFailure.stderr}`,
    /new-runtime-feature[/\\]runtime\.ts contains an OpenAI secret-shaped value/,
  );
  assert.doesNotMatch(
    `${reachableFailure.stdout}\n${reachableFailure.stderr}`,
    /unreachable\.ts/,
    'An unrelated untracked file must not be mislabeled as client runtime.',
  );

  fs.writeFileSync(
    path.join(fixtureRoot, 'new-runtime-feature', 'runtime.ts'),
    "export const runtimeValue = 'safe-runtime-value';\n",
  );
  const cleanResult = runGuard();
  assert.equal(
    cleanResult.status,
    0,
    `A clean runtime fixture should pass.\n${cleanResult.stdout}\n${cleanResult.stderr}`,
  );
  assert.match(cleanResult.stdout, /Production secret guard passed/);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('Production secret guard regression PASS.');
