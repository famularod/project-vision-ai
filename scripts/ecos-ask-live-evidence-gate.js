#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  loadAcceptanceDefinition,
  repoRoot,
  resultPath,
  validateLiveAcceptanceResult,
} = require('./ecos-ask-live-acceptance-lib');

/**
 * Is fresh live acceptance evidence REQUIRED, or merely desirable?
 *
 * Same idiom as androidProductionSigningRequired in
 * scripts/android-production-signing-gate.js: certification-only requirements
 * warn by default and fail when a release is actually being certified.
 */
function liveAcceptanceEvidenceRequired(env = process.env) {
  const explicit = String(env.VIC_REQUIRE_ECOS_ASK_LIVE_EVIDENCE || '').toLowerCase();
  if (explicit === '1' || explicit === 'true') return true;
  const target = String(env.VIC_RELEASE_TARGET || '').toLowerCase();
  return ['ios', 'ios-production', 'android', 'android-production', 'all', 'all-production']
    .includes(target);
}

function runGate(now = new Date(), env = process.env) {
  const definition = loadAcceptanceDefinition();
  if (!fs.existsSync(resultPath)) {
    // ABSENT evidence is "not measured here", which is the normal state of a
    // clean checkout: resultPath lives under validation/output/, which is
    // gitignored, and the evidence must be under 24 hours old. Failing on that
    // made qa:release impossible to pass from a fresh clone or in CI — the last
    // recorded manifest (2026-09-14) is automatedGate: fail on exactly this
    // layer. With the whole chain dying at step two, test:behavior never ran, and
    // a deterministic test failure plus an act() warning sat unnoticed for a day.
    // A gate nobody can run protects nothing.
    //
    // STALE or INVALID evidence still fails below: that means somebody measured
    // and the result was not good enough, which is a real signal. Only absence is
    // downgraded, and only when a release is not being certified.
    if (liveAcceptanceEvidenceRequired(env)) {
      console.error('Ask ECOS live acceptance FAIL.');
      console.error('No production acceptance evidence exists. Run npm run test:ecos-ask:live first.');
      return { passed: false, failures: ['Production acceptance evidence is missing.'] };
    }
    console.log('VIC_GATE_STATUS=WARN');
    console.log('WARN: no Ask ECOS live acceptance evidence in this checkout, so real-world answer quality is NOT certified by this run.');
    console.log('Run npm run test:ecos-ask:live to produce it, or set VIC_RELEASE_TARGET (or VIC_REQUIRE_ECOS_ASK_LIVE_EVIDENCE=1) to require it.');
    return { passed: true, failures: [], certified: false };
  }
  let result;
  try {
    result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch (error) {
    const message = `Production acceptance evidence is unreadable: ${error.message}`;
    console.error(`Ask ECOS live acceptance FAIL.\n- ${message}`);
    return { passed: false, failures: [message] };
  }
  const failures = validateLiveAcceptanceResult(result, definition, now);
  if (failures.length > 0) {
    console.error('Ask ECOS live acceptance FAIL.');
    failures.forEach(failure => console.error(`- ${failure}`));
    console.error(`Evidence: ${path.relative(repoRoot, resultPath)}`);
    return { passed: false, failures };
  }
  console.log(`Ask ECOS live acceptance PASS: ${result.summary.passed}/${result.summary.total} real-world production questions correct.`);
  console.log(`Project: ${result.projectName}`);
  console.log(`Completed: ${result.completedAt}`);
  console.log(`Evidence: ${path.relative(repoRoot, resultPath)}`);
  return { passed: true, failures: [], certified: true };
}

if (require.main === module) {
  const outcome = runGate();
  if (!outcome.passed) process.exitCode = 1;
}

module.exports = { runGate };
