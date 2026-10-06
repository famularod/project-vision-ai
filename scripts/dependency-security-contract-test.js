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
// 5.0.12: the 30 Sep 2026 brace-expansion advisories (owner answer Q11).
assert.equal(packageJson.overrides?.['brace-expansion'], '5.0.12');
assert.equal(packageJson.overrides?.xcode?.uuid, '11.1.1');
assert.equal(
  packageLock.packages?.['node_modules/brace-expansion']?.version,
  '5.0.12',
);
assert.equal(
  packageLock.packages?.['node_modules/uuid']?.version,
  '11.1.1',
);
assert.equal(
  packageLock.packages?.['node_modules/@expo/ngrok'],
  undefined,
);
// CI fails on a high or critical advisory in the exact lock; the three
// deferred moderates (decode-uri-component through expo-router) are warned
// below, as the local gate always did (owner answer Q4, 30 Sep 2026).
// Owner answer Q33 (1 Oct 2026): CI runs the same audit gate as this script, so an
// owner-accepted advisory is treated alike in both, and fails if the registry is unreachable.
assert.match(
  mobileWorkflow,
  /run: node scripts\/dependency-audit-gate\.js --require-registry/,
  'CI must fail when the exact dependency lock regains a high or critical advisory.',
);

// Asserting that CI *mentions* npm audit proves the workflow text, not the
// lock. Run the audit here so a new advisory in the exact lock fails this gate
// rather than waiting for a CI file that, until 2026-09-20, triggered only on
// branches that no longer exist.
const { ACCEPTED_ADVISORIES, runDependencyAudit, describe } = require('./dependency-audit-gate');
// Each accepted advisory names who approved it and when it is reviewed again.
ACCEPTED_ADVISORIES.forEach(exception => {
  assert.match(exception.approval, /owner answer Q\d+/);
  assert.match(exception.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
});
const audit = runDependencyAudit(root);

if (!audit.reachable) {
  // No registry access (offline, or a sandboxed build). Do not invent a pass and
  // do not fail a network problem as if it were a vulnerability.
  console.warn(
    `VIC_GATE_STATUS=WARN Dependency audit could not reach the registry; lock contents were not audited${audit.reason ? ` (${audit.reason})` : ''}.`,
  );
} else {
  const counts = audit.counts;
  const critical = Number(counts.critical ?? 0);
  const high = Number(counts.high ?? 0);
  const moderate = Number(counts.moderate ?? 0);
  const low = Number(counts.low ?? 0);
  console.log(
    `Dependency audit: critical=${critical} high=${high} moderate=${moderate} low=${low}`,
  );
  describe(audit).forEach(line => console.log(line));
  // High and critical advisories fail the gate unless the owner accepted that
  // advisory and no non-breaking fix exists yet (owner answers Q33, 1 Oct 2026,
  // and Q35, 2 Oct 2026).
  assert.equal(
    audit.unexcused.length,
    0,
    `npm audit reports ${audit.unexcused.length} high or critical advisories that are not accepted: ${audit.unexcused.map(found => found.name).join(', ')}.`,
  );
  assert.equal(audit.expired.length, 0, 'An accepted advisory now has a fix or passed its review date: update the lock and remove the exception.');
  if (moderate + low > 0) {
    console.warn(
      `VIC_GATE_STATUS=WARN ${moderate} moderate and ${low} low advisories remain in the lock.`,
    );
  }
}

// Review pass 2, C1: say "audited here" only when a real audit report was read.
console.log(
  'Dependency security contract PASS: vulnerable tunnel tooling stays removed, safe transitive fixes stay pinned, CI audits the exact lock, ' +
  (audit.reachable ? 'and the lock was audited here.' : 'but the lock was NOT audited here (see the warning above).'),
);
