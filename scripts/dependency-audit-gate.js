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
  },  /**
   * Owner answer Q35 (2 Oct 2026): braces <= 3.0.3 (GHSA-vfj7-8cjw-p6xm, a
   * stack overflow from deeply nested brace patterns) is a file-pattern
   * library that Metro, Jest and Expo's command-line tool use while building
   * and testing. npm traces it through the packages below because they
   * declare those tools; its code is not in the shipped app (none of its text
   * is in the Build 229 iOS bundle or web export), and it only ever reads
   * patterns from this repository's own configuration. When it was published,
   * 3.0.3 was the newest braces, so no update could remove it. The exception
   * ends by itself once npm reports a non-breaking fix for braces, or on
   * reviewBy.
   */
  {
    advisory: 'GHSA-vfj7-8cjw-p6xm',
    package: 'braces',
    reachedThrough: [
      '@expo/cli', '@expo/metro', '@expo/metro-config', '@expo/metro-file-map', '@jest/console',
      '@jest/core', '@jest/environment', '@jest/expect', '@jest/fake-timers', '@jest/globals',
      '@jest/reporters', '@jest/test-result', '@jest/test-sequencer', '@jest/transform',
      '@react-native-community/datetimepicker', '@react-native/community-cli-plugin',
      '@react-native/jest-preset', '@react-native/metro-config', '@react-native/virtualized-lists',
      '@types/jest', 'babel-jest', 'create-jest', 'expect', 'expo', 'jest', 'jest-circus', 'jest-cli',
      'jest-config', 'jest-environment-jsdom', 'jest-environment-node', 'jest-expo', 'jest-haste-map',
      'jest-message-util', 'jest-resolve', 'jest-resolve-dependencies', 'jest-runner', 'jest-runtime',
      'jest-snapshot', 'jest-watch-typeahead', 'jest-watcher', 'metro', 'metro-config', 'metro-file-map',
      'metro-transform-worker', 'micromatch', 'react-native', 'react-native-reanimated',
      'react-native-worklets',
    ],
    approval: 'owner answer Q35, 2 Oct 2026',
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
    const approvals = [...new Set(advisories.flatMap(found => standing
      .filter(exception => exception.advisory.toLowerCase() === found.id)
      .map(exception => exception.approval.replace(/,.*$/, ''))))];
    (covered ? excused : unexcused).push({ name, severity: entry.severity, advisories: advisories.map(found => found.id), approvals });
  });
  return { excused, unexcused, expired };
}

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

/**
 * Why an `npm audit --json` result is not a usable audit report, or null when
 * it is one (independent review R12). npm prints JSON for failures too: an
 * error object when the registry refuses the audit, `{}` when it has nothing
 * to say. Those used to read as "no vulnerabilities" and print PASS, even with
 * --require-registry. A real report has npm's report version, a vulnerability
 * list, and severity counts that agree with that list. npm exits 0 for a clean
 * report and 1 when the report lists anything, so any other status is a failure.
 */
function auditReportProblem(report, status) {
  if (status !== 0 && status !== 1) return `npm audit exited with status ${status === null || status === undefined ? 'unknown' : status}`;
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return 'npm audit did not print a report';
  if (report.error) return `npm audit reported an error (${String(report.error.code || report.error.summary || 'unknown').slice(0, 80)})`;
  if (typeof report.auditReportVersion !== 'number') return 'npm audit printed JSON that is not an audit report';
  const vulnerabilities = report.vulnerabilities;
  if (vulnerabilities === null || typeof vulnerabilities !== 'object' || Array.isArray(vulnerabilities)) return 'the audit report has no vulnerability list';
  const counts = report.metadata?.vulnerabilities;
  if (counts === null || typeof counts !== 'object') return 'the audit report has no severity counts';
  for (const severity of SEVERITIES) {
    if (!Number.isInteger(counts[severity]) || counts[severity] < 0) return `the audit report has no ${severity} count`;
    const listed = Object.values(vulnerabilities).filter(entry => entry?.severity === severity).length;
    if (listed !== counts[severity]) return `the audit report counts ${counts[severity]} ${severity} but lists ${listed}`;
  }
  const listedTotal = Object.keys(vulnerabilities).length;
  if (status === 0 && listedTotal > 0) return 'npm audit exited clean but its report lists vulnerabilities';
  if (status === 1 && listedTotal === 0) return 'npm audit exited with a failure but its report lists nothing';
  return null;
}

/** Reads what the npm audit process returned. Anything short of a valid report is "not audited", never a pass. */
function readDependencyAudit(audit, now = new Date()) {
  if (!audit || audit.error) return { reachable: false, reason: 'npm audit could not run or timed out' };
  if (typeof audit.stdout !== 'string' || !audit.stdout.trim()) return { reachable: false, reason: 'npm audit printed nothing' };
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    return { reachable: false, reason: 'npm audit did not print JSON' };
  }
  const problem = auditReportProblem(report, audit.status);
  if (problem) return { reachable: false, reason: problem };
  return { reachable: true, counts: report.metadata.vulnerabilities, ...evaluateDependencyAudit(report, now) };
}

function runDependencyAudit(cwd = path.resolve(__dirname, '..')) {
  return readDependencyAudit(
    spawnSync('npm', ['audit', '--audit-level=low', '--json'], { cwd, encoding: 'utf8', timeout: 180_000 }),
  );
}

function describe(result) {
  const lines = [];
  result.expired.forEach(exception => lines.push(
    `Accepted advisory ${exception.advisory} (${exception.package}) no longer applies: a non-breaking fix exists or its review date passed. Update the lock, then remove the exception.`));
  result.excused.forEach(found => lines.push(
    `VIC_GATE_STATUS=WARN ${found.severity} ${found.name}: accepted (${found.advisories.join(', ')}; ${found.approvals.join(', ')}) until a non-breaking fix exists.`));
  result.unexcused.forEach(found => lines.push(
    `BLOCKING ${found.severity} ${found.name} (${found.advisories.join(', ') || 'advisory'}).`));
  return lines;
}

if (require.main === module) {
  const requireRegistry = process.argv.includes('--require-registry');
  const result = runDependencyAudit();
  if (!result.reachable) {
    console.warn(`VIC_GATE_STATUS=WARN Dependency audit could not reach the registry; lock contents were not audited (${result.reason}).`);
    if (requireRegistry) console.error('Dependency audit FAIL: a valid audit report is required here and none was obtained.');
    process.exit(requireRegistry ? 1 : 0);
  }
  describe(result).forEach(line => console.log(line));
  if (result.unexcused.length > 0) {
    console.error(`Dependency audit FAIL: ${result.unexcused.length} high or critical advisories are not accepted.`);
    process.exit(1);
  }
  console.log('Dependency audit PASS: no high or critical advisory beyond the owner-accepted ones.');
}

module.exports = { ACCEPTED_ADVISORIES, auditReportProblem, evaluateDependencyAudit, readDependencyAudit, runDependencyAudit, describe };
