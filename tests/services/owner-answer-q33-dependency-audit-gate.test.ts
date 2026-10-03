// Owner answer Q33 (1 Oct 2026): the dependency audit accepts the node-forge
// advisory reached only through Expo's build tool, and only while no
// non-breaking fix exists. Everything else high or critical still fails.
const { evaluateDependencyAudit } = jest.requireActual('../../scripts/dependency-audit-gate') as {
  evaluateDependencyAudit: (report: unknown, now?: Date) => {
    excused: { name: string }[];
    unexcused: { name: string; advisories: string[] }[];
    expired: { advisory: string }[];
  };
};

const NOW = new Date('2026-10-01T20:00:00Z');
const forgeAdvisory = {
  source: 1240912,
  name: 'node-forge',
  dependency: 'node-forge',
  title: 'node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements',
  url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv',
  severity: 'high',
};
const breaking = (name: string) => ({ name, version: '44.0.6', isSemVerMajor: true });

// The 1 Oct 2026 lock, as npm audit --json reports it.
function todaysReport(): { auditReportVersion: number; vulnerabilities: Record<string, any> } {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      '@expo/cli': { severity: 'high', via: ['@expo/code-signing-certificates', 'node-forge'], fixAvailable: breaking('expo') },
      '@expo/code-signing-certificates': { severity: 'high', via: ['node-forge'], fixAvailable: true },
      '@react-native-community/datetimepicker': { severity: 'high', via: ['expo'], fixAvailable: breaking('@react-native-community/datetimepicker') },
      expo: { severity: 'high', via: ['@expo/cli'], fixAvailable: breaking('expo') },
      'node-forge': { severity: 'high', via: [forgeAdvisory], fixAvailable: breaking('expo') },
      'decode-uri-component': {
        severity: 'moderate',
        via: [{ source: 1147955, name: 'decode-uri-component', url: 'https://github.com/advisories/GHSA-vcc3-ghjq-m6fr', severity: 'moderate' }],
        fixAvailable: breaking('expo-router'),
      },
      'query-string': { severity: 'moderate', via: ['decode-uri-component'], fixAvailable: breaking('expo-router') },
      'expo-router': { severity: 'moderate', via: ['query-string'], fixAvailable: breaking('expo-router') },
    },
  };
}

describe('owner answer Q33: the node-forge advisory in Expo\'s build tool', () => {
  it('today\'s five high entries are all accepted, and nothing blocks', () => {
    const result = evaluateDependencyAudit(todaysReport(), NOW);
    expect(result.unexcused).toEqual([]);
    expect(result.expired).toEqual([]);
    expect(result.excused.map(found => found.name).sort()).toEqual([
      '@expo/cli', '@expo/code-signing-certificates', '@react-native-community/datetimepicker', 'expo', 'node-forge',
    ]);
  });

  it('a code-signing package npm calls fixable does not end the exception: only node-forge\'s own fix does', () => {
    expect(evaluateDependencyAudit(todaysReport(), NOW).expired).toEqual([]);
  });

  it('ends once npm reports a non-breaking fix for node-forge, and the five entries block again', () => {
    const report = todaysReport();
    report.vulnerabilities['node-forge'].fixAvailable = true;
    const result = evaluateDependencyAudit(report, NOW);
    expect(result.expired.map(exception => exception.advisory)).toEqual(['GHSA-86w9-cpqp-85rv']);
    expect(result.unexcused).toHaveLength(5);
  });

  it('ends after its review date', () => {
    const result = evaluateDependencyAudit(todaysReport(), new Date('2026-11-02T12:00:00Z'));
    // Q35's braces exception shares the review date (owner answer Q35, 2 Oct 2026).
    expect(result.expired.map(exception => exception.advisory)).toContain('GHSA-86w9-cpqp-85rv');
    expect(result.unexcused).toHaveLength(5);
  });

  it('another high advisory still blocks, also on a package in the accepted chain', () => {
    const report = todaysReport();
    report.vulnerabilities['@expo/cli'] = {
      severity: 'high',
      via: ['@expo/code-signing-certificates', 'node-forge', { source: 1, name: '@expo/cli', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'high' }],
      fixAvailable: breaking('expo'),
    };
    report.vulnerabilities.tar = { severity: 'critical', via: [{ source: 2, name: 'tar', url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff', severity: 'critical' }], fixAvailable: true };
    const blocked = evaluateDependencyAudit(report, NOW).unexcused.map(found => found.name).sort();
    // expo and the date picker reach the new @expo/cli advisory through it.
    expect(blocked).toEqual(['@expo/cli', '@react-native-community/datetimepicker', 'expo', 'tar']);
  });

  it('node-forge reached through a package outside Expo\'s build tool blocks', () => {
    const report = todaysReport();
    report.vulnerabilities['some-runtime-crypto'] = { severity: 'high', via: ['node-forge'], fixAvailable: false };
    expect(evaluateDependencyAudit(report, NOW).unexcused.map(found => found.name)).toEqual(['some-runtime-crypto']);
  });

  it('moderate advisories are never counted here (the gate only warns on them)', () => {
    const names = [...evaluateDependencyAudit(todaysReport(), NOW).excused, ...evaluateDependencyAudit(todaysReport(), NOW).unexcused]
      .map(found => found.name);
    expect(names).not.toContain('decode-uri-component');
    expect(names).not.toContain('expo-router');
  });
});
