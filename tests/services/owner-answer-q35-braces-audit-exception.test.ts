// Owner answer Q35 (2 Oct 2026): the dependency audit accepts the braces
// advisory, which npm traces through the build and test tools (Metro, Jest,
// Expo's command-line tool), only while no non-breaking fix exists. The
// node-forge exception (Q33) is unchanged, and everything else high or
// critical still fails.
const { evaluateDependencyAudit, describe: describeAudit } = jest.requireActual('../../scripts/dependency-audit-gate') as {
  evaluateDependencyAudit: (report: unknown, now?: Date) => {
    excused: { name: string; advisories: string[]; approvals: string[]; severity: string }[];
    unexcused: { name: string; advisories: string[] }[];
    expired: { advisory: string }[];
  };
  describe: (result: unknown) => string[];
};

const NOW = new Date('2026-10-02T22:00:00Z');
const bracesAdvisory = {
  source: 1290001,
  name: 'braces',
  dependency: 'braces',
  title: 'braces vulnerable to stack-exhaustion denial of service through deeply nested patterns',
  url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  severity: 'high',
};
const forgeAdvisory = {
  source: 1240912,
  name: 'node-forge',
  dependency: 'node-forge',
  title: 'node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements',
  url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv',
  severity: 'high',
};
const breaking = (name: string) => ({ name, version: '44.0.6', isSemVerMajor: true });

// The 2 Oct 2026 lock in miniature, as npm audit --json reports it: braces
// through micromatch into Metro and Jest, and both advisories into Expo's CLI.
function todaysReport(): { auditReportVersion: number; vulnerabilities: Record<string, any> } {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      braces: { severity: 'high', via: [bracesAdvisory], fixAvailable: breaking('jest') },
      micromatch: { severity: 'high', via: ['braces'], fixAvailable: breaking('jest') },
      metro: { severity: 'high', via: ['micromatch'], fixAvailable: breaking('expo') },
      'jest-haste-map': { severity: 'high', via: ['micromatch'], fixAvailable: breaking('jest') },
      jest: { severity: 'high', via: ['jest-haste-map'], fixAvailable: breaking('jest') },
      'react-native': { severity: 'high', via: ['metro'], fixAvailable: breaking('expo') },
      'node-forge': { severity: 'high', via: [forgeAdvisory], fixAvailable: breaking('expo') },
      '@expo/code-signing-certificates': { severity: 'high', via: ['node-forge'], fixAvailable: true },
      '@expo/cli': { severity: 'high', via: ['@expo/code-signing-certificates', 'metro', 'node-forge'], fixAvailable: breaking('expo') },
      expo: { severity: 'high', via: ['@expo/cli'], fixAvailable: breaking('expo') },
      'query-string': {
        severity: 'moderate',
        via: [{ source: 1147955, name: 'decode-uri-component', url: 'https://github.com/advisories/GHSA-vcc3-ghjq-m6fr', severity: 'moderate' }],
        fixAvailable: breaking('expo-router'),
      },
    },
  };
}

describe('owner answer Q35: the braces advisory in the build and test tools', () => {
  it('today\'s braces and node-forge entries are all accepted, and nothing blocks', () => {
    const result = evaluateDependencyAudit(todaysReport(), NOW);
    expect(result.unexcused).toEqual([]);
    expect(result.expired).toEqual([]);
    expect(result.excused.map(found => found.name).sort()).toEqual([
      '@expo/cli', '@expo/code-signing-certificates', 'braces', 'expo', 'jest', 'jest-haste-map', 'metro', 'micromatch', 'node-forge', 'react-native',
    ]);
  });

  it('each warning names the owner answer that accepted it', () => {
    const lines = describeAudit(evaluateDependencyAudit(todaysReport(), NOW));
    expect(lines).toContain('VIC_GATE_STATUS=WARN high braces: accepted (ghsa-vfj7-8cjw-p6xm; owner answer Q35) until a non-breaking fix exists.');
    expect(lines).toContain('VIC_GATE_STATUS=WARN high node-forge: accepted (ghsa-86w9-cpqp-85rv; owner answer Q33) until a non-breaking fix exists.');
    expect(lines).toContain('VIC_GATE_STATUS=WARN high @expo/cli: accepted (ghsa-86w9-cpqp-85rv, ghsa-vfj7-8cjw-p6xm; owner answer Q33, owner answer Q35) until a non-breaking fix exists.');
  });

  it('braces reached through a package outside the accepted list blocks', () => {
    const report = todaysReport();
    report.vulnerabilities['some-runtime-glob'] = { severity: 'high', via: ['braces'], fixAvailable: false };
    expect(evaluateDependencyAudit(report, NOW).unexcused.map(found => found.name)).toEqual(['some-runtime-glob']);
  });

  it('ends once npm reports a non-breaking fix for braces; the node-forge exception stands', () => {
    const report = todaysReport();
    report.vulnerabilities.braces.fixAvailable = true;
    const result = evaluateDependencyAudit(report, NOW);
    expect(result.expired.map(exception => exception.advisory)).toEqual(['GHSA-vfj7-8cjw-p6xm']);
    // Everything that reaches braces blocks again, @expo/cli and expo included.
    expect(result.unexcused.map(found => found.name).sort()).toEqual([
      '@expo/cli', 'braces', 'expo', 'jest', 'jest-haste-map', 'metro', 'micromatch', 'react-native',
    ]);
    expect(result.excused.map(found => found.name).sort()).toEqual(['@expo/code-signing-certificates', 'node-forge']);
  });

  it('ends after its review date, with Q33\'s', () => {
    const result = evaluateDependencyAudit(todaysReport(), new Date('2026-11-02T12:00:00Z'));
    expect(result.expired.map(exception => exception.advisory).sort()).toEqual(['GHSA-86w9-cpqp-85rv', 'GHSA-vfj7-8cjw-p6xm']);
    expect(result.excused).toEqual([]);
  });

  it('another high advisory on a test tool still blocks', () => {
    const report = todaysReport();
    report.vulnerabilities.jest = {
      severity: 'high',
      via: ['jest-haste-map', { source: 3, name: 'jest', url: 'https://github.com/advisories/GHSA-gggg-hhhh-jjjj', severity: 'high' }],
      fixAvailable: breaking('jest'),
    };
    expect(evaluateDependencyAudit(report, NOW).unexcused.map(found => found.name)).toEqual(['jest']);
  });
});
