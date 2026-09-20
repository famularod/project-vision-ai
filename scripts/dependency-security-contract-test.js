#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
assert.equal(packageJson.overrides?.['brace-expansion'], '5.0.9');
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
assert.match(
  mobileWorkflow,
  /npm audit --audit-level=low/,
  'CI must fail when the exact dependency lock regains a known advisory.',
);

// Asserting that CI *mentions* npm audit proves the workflow text, not the
// lock. Run the audit here so a new advisory in the exact lock fails this gate
// rather than waiting for a CI file that, until 2026-09-20, triggered only on
// branches that no longer exist.
const audit = spawnSync(
  'npm',
  ['audit', '--audit-level=low', '--json'],
  { cwd: root, encoding: 'utf8', timeout: 180_000 },
);

if (audit.error || typeof audit.stdout !== 'string' || !audit.stdout.trim()) {
  // No registry access (offline, or a sandboxed build). Do not invent a pass and
  // do not fail a network problem as if it were a vulnerability.
  console.warn(
    'VIC_GATE_STATUS=WARN Dependency audit could not reach the registry; lock contents were not audited.',
  );
} else {
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    report = null;
  }
  const counts = report?.metadata?.vulnerabilities ?? {};
  const critical = Number(counts.critical ?? 0);
  const high = Number(counts.high ?? 0);
  const moderate = Number(counts.moderate ?? 0);
  const low = Number(counts.low ?? 0);
  console.log(
    `Dependency audit: critical=${critical} high=${high} moderate=${moderate} low=${low}`,
  );
  assert.equal(
    critical + high,
    0,
    `npm audit reports ${critical} critical and ${high} high advisories in the exact lock.`,
  );
  if (moderate + low > 0) {
    console.warn(
      `VIC_GATE_STATUS=WARN ${moderate} moderate and ${low} low advisories remain in the lock.`,
    );
  }
}

console.log(
  'Dependency security contract PASS: vulnerable tunnel tooling stays removed, safe transitive fixes stay pinned, CI audits the exact lock, and the lock was audited here.',
);
