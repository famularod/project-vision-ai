#!/usr/bin/env node

// The dependency audit both the local release gate and CI run: no high or
// critical advisory in the exact lock, except an advisory the owner accepted
// in writing, and only while no non-breaking fix exists for it.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

/**
 * Owner answer Q33 (1 Oct 2026): node-forge <= 1.4.0 (GHSA-86w9-cpqp-85rv,
 * an RSA PKCS#1 v1.5 signature check that accepts extra nested
 * DigestAlgorithm elements) reaches the lock only through Expo's
 * command-line build tool (expo -> @expo/cli -> @expo/code-signing-certificates
 * -> node-forge). The app on the phone and iPad never contains or uses it, and
 * Expo update code signing is not configured. When it was published, 1.4.0 was
 * the newest node-forge and the newest @expo/cli and code-signing package still
 * required it, so no update could remove it. The exception ends by itself as
 * soon as npm reports a non-breaking fix for node-forge, or on reviewBy.
 */
const ACCEPTED_ADVISORIES = [
  {
    advisory: 'GHSA-86w9-cpqp-85rv',
    package: 'node-forge',
    reachedThrough: [
      '@expo/code-signing-certificates',
      '@expo/cli',
      'expo',
      '@react-native-community/datetimepicker',
    ],
    approval: 'owner answer Q33, 1 Oct 2026',
    reviewBy: '2026-11-01',
  },
];

const BLOCKING = new Set(['high', 'critical']);

function advisoryId(via) {
  const match = String(via.url || '').match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i);
  return match ? match[0].toLowerCase() : `npm-${via.source}`;
}

// A non-breaking fix exists when npm can apply one without a major upgrade.
function nonBreakingFixAvailable(entry) {
  const fix = entry?.fixAvailable;
  return fix === true || (fix !== null && typeof fix === 'object' && fix.isSemVerMajor === false);
}

/** The blocking (high or critical) advisories a vulnerable package reaches, following npm's `via` chain. */
function blockingAdvisoriesOf(name, vulnerabilities, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const entry = vulnerabilities[name];
  if (!entry) return [];
  return (entry.via || []).flatMap(via => {
    if (typeof via === 'string') return blockingAdvisoriesOf(via, vulnerabilities, seen);
    return BLOCKING.has(via.severity) ? [{ id: advisoryId(via), package: via.name || name, title: via.title || '' }] : [];
  });
}

/**
 * Splits the report's high and critical packages into those an accepted
 * advisory explains (excused) and the rest (unexcused). An accepted advisory
 * stops excusing anything once its package has a non-breaking fix or its
 * review date has passed (expired).
 */
function evaluateDependencyAudit(report, now = new Date(), accepted = ACCEPTED_ADVISORIES) {
  const vulnerabilities = report?.vulnerabilities || {};
  const expired = accepted.filter(exception =>
    nonBreakingFixAvailable(vulnerabilities[exception.package]) ||
    now.getTime() > Date.parse(`${exception.reviewBy}T23:59:59Z`));
  const standing = accepted.filter(exception => !expired.includes(exception));
  const excused = [];
  const unexcused = [];
  Object.entries(vulnerabilities).forEach(([name, entry]) => {
    if (!BLOCKING.has(entry.severity)) return;
    const advisories = blockingAdvisoriesOf(name, vulnerabilities);
    const covered = advisories.length > 0 && advisories.every(found => standing.some(exception =>
      exception.advisory.toLowerCase() === found.id && exception.package === found.package &&
      (name === exception.package || exception.reachedThrough.includes(name))));
    (covered ? excused : unexcused).push({ name, severity: entry.severity, advisories: advisories.map(found => found.id) });
  });
  return { excused, unexcused, expired };
}

function runDependencyAudit(cwd = path.resolve(__dirname, '..')) {
  const audit = spawnSync('npm', ['audit', '--audit-level=low', '--json'], { cwd, encoding: 'utf8', timeout: 180_000 });
  if (audit.error || typeof audit.stdout !== 'string' || !audit.stdout.trim()) return { reachable: false };
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    return { reachable: false };
  }
  const counts = report?.metadata?.vulnerabilities ?? {};
  return { reachable: true, counts, ...evaluateDependencyAudit(report) };
}

function describe(result) {
  const lines = [];
  result.expired.forEach(exception => lines.push(
    `Accepted advisory ${exception.advisory} (${exception.package}) no longer applies: a non-breaking fix exists or its review date passed. Update the lock, then remove the exception.`));
  result.excused.forEach(found => lines.push(
    `VIC_GATE_STATUS=WARN ${found.severity} ${found.name}: accepted (${found.advisories.join(', ')}; owner answer Q33) until a non-breaking fix exists.`));
  result.unexcused.forEach(found => lines.push(
    `BLOCKING ${found.severity} ${found.name} (${found.advisories.join(', ') || 'advisory'}).`));
  return lines;
}

if (require.main === module) {
  const requireRegistry = process.argv.includes('--require-registry');
  const result = runDependencyAudit();
  if (!result.reachable) {
    console.warn('VIC_GATE_STATUS=WARN Dependency audit could not reach the registry; lock contents were not audited.');
    process.exit(requireRegistry ? 1 : 0);
  }
  describe(result).forEach(line => console.log(line));
  if (result.unexcused.length > 0) {
    console.error(`Dependency audit FAIL: ${result.unexcused.length} high or critical advisories are not accepted.`);
    process.exit(1);
  }
  console.log('Dependency audit PASS: no high or critical advisory beyond the owner-accepted ones.');
}

module.exports = { ACCEPTED_ADVISORIES, evaluateDependencyAudit, runDependencyAudit, describe };
