// Independent review of Build 229, R12: the dependency audit must fail closed.
// npm prints JSON for failures too (an error object when the registry refuses
// the audit, `{}` when it has nothing), and the gate used to read any JSON as
// a report with no vulnerabilities and print PASS, even with --require-registry.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

type AuditRead = {
  reachable: boolean;
  reason?: string;
  counts?: Record<string, number>;
  excused?: { name: string }[];
  unexcused?: { name: string }[];
  expired?: { advisory: string }[];
};
const { readDependencyAudit } = jest.requireActual('../../scripts/dependency-audit-gate') as {
  readDependencyAudit: (audit: { error?: unknown; status?: number | null; stdout?: unknown }, now?: Date) => AuditRead;
};

const NOW = new Date('2026-10-05T22:00:00Z');
const counts = (over: Partial<Record<string, number>> = {}) =>
  ({ info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...over });
const report = (vulnerabilities: Record<string, unknown>, vulnerabilityCounts: Record<string, number>) =>
  JSON.stringify({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: vulnerabilityCounts } });
const tar = {
  severity: 'critical',
  via: [{ source: 2, name: 'tar', url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff', severity: 'critical' }],
  fixAvailable: true,
};

describe('independent review R12: only a valid npm audit report is an audit', () => {
  it('a valid report with nothing in it is a clean audit', () => {
    const read = readDependencyAudit({ status: 0, stdout: report({}, counts()) }, NOW);
    expect(read.reachable).toBe(true);
    expect(read.unexcused).toEqual([]);
  });

  it('a valid report with a critical advisory is read, and blocks', () => {
    const read = readDependencyAudit({ status: 1, stdout: report({ tar }, counts({ critical: 1, total: 1 })) }, NOW);
    expect(read.reachable).toBe(true);
    expect(read.unexcused?.map(found => found.name)).toEqual(['tar']);
  });

  it('npm\'s error object is not a report', () => {
    const stdout = JSON.stringify({ error: { code: 'ENOAUDIT', summary: 'Your configured registry does not support audit requests.' } });
    const read = readDependencyAudit({ status: 1, stdout }, NOW);
    expect(read).toEqual({ reachable: false, reason: 'npm audit reported an error (ENOAUDIT)' });
  });

  it('an empty object, a list, a bare value and half a report are not reports', () => {
    expect(readDependencyAudit({ status: 0, stdout: '{}' }, NOW).reachable).toBe(false);
    expect(readDependencyAudit({ status: 0, stdout: '[]' }, NOW).reachable).toBe(false);
    expect(readDependencyAudit({ status: 0, stdout: 'null' }, NOW).reachable).toBe(false);
    expect(readDependencyAudit({ status: 0, stdout: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }) }, NOW).reachable).toBe(false);
    expect(readDependencyAudit({ status: 0, stdout: JSON.stringify({ auditReportVersion: 2, metadata: { vulnerabilities: counts() } }) }, NOW).reachable).toBe(false);
  });

  it('text that is not JSON, no output, a timeout and an unexpected exit status are not reports', () => {
    expect(readDependencyAudit({ status: 1, stdout: 'npm error code ENOTFOUND' }, NOW).reachable).toBe(false);
    expect(readDependencyAudit({ status: 0, stdout: '   ' }, NOW).reachable).toBe(false);
    expect(readDependencyAudit({ error: new Error('spawnSync npm ETIMEDOUT'), status: null, stdout: '' }, NOW).reachable).toBe(false);
    expect(readDependencyAudit({ status: null, stdout: report({}, counts()) }, NOW).reachable).toBe(false);
    expect(readDependencyAudit({ status: 2, stdout: report({}, counts()) }, NOW).reachable).toBe(false);
  });

  it('a report whose counts and list disagree, or whose exit status contradicts it, is not trusted', () => {
    // A truncated list: npm counted a critical advisory the list does not hold.
    expect(readDependencyAudit({ status: 1, stdout: report({}, counts({ critical: 1, total: 1 })) }, NOW).reachable).toBe(false);
    expect(readDependencyAudit({ status: 1, stdout: report({ tar }, counts()) }, NOW).reachable).toBe(false);
    expect(readDependencyAudit({ status: 0, stdout: report({ tar }, counts({ critical: 1, total: 1 })) }, NOW).reachable).toBe(false);
    expect(readDependencyAudit({ status: 1, stdout: report({}, counts()) }, NOW).reachable).toBe(false);
  });

  it('the command line: with --require-registry no valid report is a failure; without it, a warning', () => {
    // A stand-in `npm` that prints the registry's refusal, first on PATH.
    const fakeBin = path.join(__dirname, '..', 'fixtures', 'npm-audit-refused');
    const gate = path.join(__dirname, '..', '..', 'scripts', 'dependency-audit-gate.js');
    const run = (args: string[]) => spawnSync(process.execPath, [gate, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    });
    const required = run(['--require-registry']);
    expect(required.status).toBe(1);
    expect(`${required.stdout}${required.stderr}`).not.toContain('Dependency audit PASS');
    expect(required.stderr).toContain('a valid audit report is required here and none was obtained');
    const optional = run([]);
    expect(optional.status).toBe(0);
    expect(`${optional.stdout}${optional.stderr}`).not.toContain('Dependency audit PASS');
    expect(optional.stderr).toContain('lock contents were not audited (npm audit reported an error (ENOAUDIT))');
  });

  // Review pass 2, C1: the contract script's last line said "the lock was audited here" right after
  // warning that it had not been.
  it('the contract script does not say the lock was audited when no valid report was read', () => {
    const fakeBin = path.join(__dirname, '..', 'fixtures', 'npm-audit-refused');
    const contract = path.join(__dirname, '..', '..', 'scripts', 'dependency-security-contract-test.js');
    const run = spawnSync(process.execPath, [contract], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    });
    const output = `${run.stdout}${run.stderr}`;
    expect(run.status).toBe(0);
    expect(output).toContain('lock contents were not audited');
    expect(output).toContain('but the lock was NOT audited here');
    expect(output).not.toContain('and the lock was audited here');
  });
});
