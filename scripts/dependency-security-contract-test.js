#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
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

assert.equal(
  packageJson.devDependencies?.['@expo/ngrok'],
  undefined,
  'Unused @expo/ngrok must not restore its vulnerable development tunnel chain.',
);
assert.equal(packageJson.overrides?.['brace-expansion'], '5.0.8');
assert.equal(packageJson.overrides?.xcode?.uuid, '11.1.1');
assert.equal(
  packageLock.packages?.['node_modules/brace-expansion']?.version,
  '5.0.8',
);
assert.equal(
  packageLock.packages?.['node_modules/uuid']?.version,
  '11.1.1',
);
assert.equal(
  packageLock.packages?.['node_modules/@expo/ngrok'],
  undefined,
);
assert.match(
  mobileWorkflow,
  /npm audit --audit-level=low/,
  'CI must fail when the exact dependency lock regains a known advisory.',
);

console.log(
  'Dependency security contract PASS: vulnerable tunnel tooling stays removed, safe transitive fixes stay pinned, and CI audits the exact lock.',
);
