#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const coverageDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'vitruvius-vic-coverage-'),
);
const coverageSummaryPath = path.join(coverageDirectory, 'coverage-summary.json');
const coverageFloors = {
  statements: 60.5,
  branches: 45.5,
  functions: 65.5,
  lines: 63.5,
};
const seriousWarningPatterns = [
  { label: 'React state update outside act()', pattern: /not wrapped in act\(\.\.\.\)/i },
  { label: 'log after Jest completion', pattern: /Cannot log after tests are done/i },
  { label: 'Jest environment teardown access', pattern: /after the Jest environment has been torn down/i },
  { label: 'worker did not exit gracefully', pattern: /worker process has failed to exit gracefully/i },
  { label: 'unhandled promise rejection', pattern: /unhandled(?:promiserejection| promise rejection)/i },
  { label: 'coverage report write failure', pattern: /Failed to write coverage reports/i },
];

const result = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'node_modules', 'jest', 'bin', 'jest.js'),
    '--runInBand',
    '--watchman=false',
    '--coverage',
    `--coverageDirectory=${coverageDirectory}`,
    '--coverageReporters=text-summary',
    '--coverageReporters=json-summary',
  ],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  },
);

const combinedOutput = `${result.stdout || ''}${result.stderr || ''}`;
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');

const failures = [];
if (result.error) failures.push(`Jest could not start: ${result.error.message}`);
if (result.status !== 0) failures.push(`Jest exited with status ${result.status ?? 'unknown'}.`);

for (const warning of seriousWarningPatterns) {
  if (warning.pattern.test(combinedOutput)) {
    failures.push(`Serious test warning detected: ${warning.label}.`);
  }
}

if (!fs.existsSync(coverageSummaryPath)) {
  failures.push('Jest did not produce a fresh coverage summary for this run.');
} else {
  const coverage = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8')).total;
  for (const [metric, floor] of Object.entries(coverageFloors)) {
    const actual = coverage?.[metric]?.pct;
    if (typeof actual !== 'number') {
      failures.push(`Coverage metric ${metric} is missing.`);
    } else if (actual < floor) {
      failures.push(`${metric} coverage ${actual}% is below the Jarvis floor of ${floor}%.`);
    }
  }
}

fs.rmSync(coverageDirectory, { recursive: true, force: true });

console.log('');
console.log('Jarvis Strict Jest Gate');
if (failures.length === 0) {
  console.log('PASS: tests passed, serious harness warnings were absent, and coverage floors held.');
} else {
  console.log('FAIL:');
  failures.forEach(failure => console.log(`- ${failure}`));
  process.exitCode = 1;
}
