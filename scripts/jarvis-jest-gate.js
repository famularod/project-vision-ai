#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const coverageFloors = {
  statements: 54.5, // measured 55.03% on 2026-09-20 with the native shell included
  branches: 45.5, // measured 45.6% on 2026-09-20 with the native shell included
  functions: 57.5, // measured 58.32% on 2026-09-20 with the native shell included
  lines: 56.5, // measured 57.34% on 2026-09-20 with the native shell included
};
const seriousWarningPatterns = [
  { label: 'React state update outside act()', pattern: /not wrapped in act\(\.\.\.\)/i },
  { label: 'log after Jest completion', pattern: /Cannot log after tests are done/i },
  { label: 'Jest environment teardown access', pattern: /after the Jest environment has been torn down/i },
  { label: 'worker did not exit gracefully', pattern: /worker process has failed to exit gracefully/i },
  { label: 'unhandled promise rejection', pattern: /unhandled(?:promiserejection| promise rejection)/i },
  { label: 'coverage report write failure', pattern: /Failed to write coverage reports/i },
];

/**
 * Build 231 E1, for GitHub only. With VIC_JEST_PARTS not set (the Mac, and
 * anywhere else) this gate runs exactly as before: one jest, in band, with
 * coverage.
 *
 * That one run takes about 17 minutes on the Mac (1,029 s in the gate log of
 * 6 Oct 2026). A GitHub runner's cores are roughly half as fast, so about 30
 * minutes there (an estimate; GitHub was not run), which is as long as a
 * gate layer may run at all. With VIC_JEST_PARTS=N the same suite is split
 * into N parts (jest --shard) and
 * the parts run side by side, each still its own jest in band. Nothing the
 * gate checks is given up: every test still runs once, in band; every
 * part's output is read for the same warnings; and the coverage floors are
 * held against the parts' coverage merged with jest's own coverage library.
 * Jest's worker pool (--maxWorkers) is not used: on the Mac it printed
 * "worker process has failed to exit gracefully", which this gate treats as
 * a failure, in 2 of 7 four-worker runs.
 */
const PARTS_ENVIRONMENT_NAME = 'VIC_JEST_PARTS';
const MAX_PARTS = 8;

function partCount(env = process.env) {
  const raw = String(env[PARTS_ENVIRONMENT_NAME] ?? '').trim();
  if (!raw) return 1;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > MAX_PARTS) {
    throw new Error(`${PARTS_ENVIRONMENT_NAME} must be a whole number from 1 to ${MAX_PARTS}; it is "${raw}".`);
  }
  return Number(raw);
}

/**
 * Build 232: node's own flags for every jest this gate starts, the one run
 * and each part.
 *
 * Node v24.17.0 on the Mac dies now and then (SIGSEGV) inside V8's garbage
 * collector while it walks a frame set up by the function-entry code of V8's
 * "Sparkplug" baseline compiler: Builtins_BaselineOutOfLinePrologue is on
 * the crashed thread in 36 of 36 V8 crash reports from 5 to 13 Oct 2026. On
 * 13 Oct it took this gate's 23-minute run down twice, after 19 and 22
 * minutes, with no test failed. With --no-sparkplug that entry code is never
 * run. Nobody has a stand-alone reproduction of the crash, so "the flag
 * prevents it" rests on those stacks and not on a before-and-after run; what
 * is measured (scripts/jest-no-sparkplug-test.js) is that the flag leaves no
 * function in the baseline tier, in jest's process and in any worker process
 * jest starts.
 *
 * Nothing the gate checks is given up: only a JIT tier of the test runner is
 * off, and the app never runs on node. The flag is node's, so it goes before
 * the jest script; node refuses it in NODE_OPTIONS.
 */
const JEST_NODE_FLAGS = ['--no-sparkplug'];

/**
 * The node command line for one jest: node's flags, the jest script, jest's
 * own arguments. `part` is null for the whole suite in one run.
 */
function jestArguments(coverageDirectory, part = null) {
  return [
    ...JEST_NODE_FLAGS,
    path.join(repoRoot, 'node_modules', 'jest', 'bin', 'jest.js'),
    '--runInBand',
    '--watchman=false',
    '--coverage',
    `--coverageDirectory=${coverageDirectory}`,
    ...(part
      ? [`--shard=${part.index}/${part.count}`, '--coverageReporters=json']
      : ['--coverageReporters=text-summary', '--coverageReporters=json-summary']),
  ];
}

function seriousWarnings(output) {
  return seriousWarningPatterns
    .filter(warning => warning.pattern.test(output))
    .map(warning => `Serious test warning detected: ${warning.label}.`);
}

function coverageFailures(total, floors = coverageFloors) {
  const failures = [];
  for (const [metric, floor] of Object.entries(floors)) {
    const actual = total?.[metric]?.pct;
    if (typeof actual !== 'number') {
      failures.push(`Coverage metric ${metric} is missing.`);
    } else if (actual < floor) {
      failures.push(`${metric} coverage ${actual}% is below the Jarvis floor of ${floor}%.`);
    }
  }
  return failures;
}

/** Jest's own copy of the library its coverage summary is computed with. */
function coverageLibrary() {
  const reporters = path.dirname(require.resolve('@jest/reporters/package.json', { paths: [repoRoot] }));
  return require(require.resolve('istanbul-lib-coverage', { paths: [reporters] }));
}

/** The totals of several parts' coverage (each a coverage-final.json), merged as jest merges its own. */
function mergedCoverageTotal(coverageFiles) {
  const map = coverageLibrary().createCoverageMap({});
  for (const file of coverageFiles) map.merge(JSON.parse(fs.readFileSync(file, 'utf8')));
  return map.getCoverageSummary().toJSON();
}

function coverageSummaryText(total, parts) {
  const line = (label, metric) =>
    `${label.padEnd(13)}: ${total[metric].pct}% ( ${total[metric].covered}/${total[metric].total} )`;
  return [
    `=============================== Coverage summary (${parts} parts merged) ===============================`,
    line('Statements', 'statements'),
    line('Branches', 'branches'),
    line('Functions', 'functions'),
    line('Lines', 'lines'),
    '================================================================================',
  ].join('\n');
}

/** One part of the suite as its own jest; resolves when it ends, with everything it printed. */
function runJestPart(args) {
  return new Promise(resolve => {
    let output = '';
    const child = spawn(process.execPath, args, { cwd: repoRoot, env: process.env });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => resolve({ status: null, error, output }));
    child.on('close', status => resolve({ status, error: null, output }));
  });
}

/** The whole suite as one jest in band: the gate as it has always run. */
function runWholeSuite(coverageDirectory) {
  const result = spawnSync(process.execPath, jestArguments(coverageDirectory), {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
  const combinedOutput = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');

  const failures = [];
  if (result.error) failures.push(`Jest could not start: ${result.error.message}`);
  if (result.status !== 0) failures.push(`Jest exited with status ${result.status ?? 'unknown'}.`);
  failures.push(...seriousWarnings(combinedOutput));

  const coverageSummaryPath = path.join(coverageDirectory, 'coverage-summary.json');
  if (!fs.existsSync(coverageSummaryPath)) {
    failures.push('Jest did not produce a fresh coverage summary for this run.');
  } else {
    failures.push(...coverageFailures(JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8')).total));
  }
  return failures;
}

/** The suite as `count` parts side by side, each its own jest in band. */
async function runSuiteInParts(coverageDirectory, count, { run = runJestPart, write = text => process.stdout.write(text) } = {}) {
  const parts = Array.from({ length: count }, (_unused, index) => ({ index: index + 1, count }));
  const partDirectory = part => path.join(coverageDirectory, `part-${part.index}`);
  const results = await Promise.all(parts.map(async part => {
    const result = await run(jestArguments(partDirectory(part), part));
    // A part's output is printed whole when it ends, so parts do not interleave.
    write(`\n---- jest part ${part.index} of ${count} ----\n${result.output}`);
    return result;
  }));

  const failures = [];
  results.forEach((result, index) => {
    if (result.error) failures.push(`Jest part ${index + 1} of ${count} could not start: ${result.error.message}`);
    if (result.status !== 0) failures.push(`Jest part ${index + 1} of ${count} exited with status ${result.status ?? 'unknown'}.`);
  });
  failures.push(...seriousWarnings(results.map(result => result.output).join('\n')));

  const coverageFiles = parts.map(part => path.join(partDirectory(part), 'coverage-final.json'));
  const missing = coverageFiles.filter(file => !fs.existsSync(file));
  if (missing.length > 0) {
    failures.push(`Jest did not produce fresh coverage for ${missing.length} of ${count} parts.`);
  } else {
    const total = mergedCoverageTotal(coverageFiles);
    write(`\n${coverageSummaryText(total, count)}\n`);
    failures.push(...coverageFailures(total));
  }
  return failures;
}

async function main(env = process.env) {
  const coverageDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'vitruvius-vic-coverage-'),
  );
  let failures;
  try {
    const parts = partCount(env);
    failures = parts === 1
      ? runWholeSuite(coverageDirectory)
      : await runSuiteInParts(coverageDirectory, parts);
  } catch (error) {
    failures = [error.message];
  }

  fs.rmSync(coverageDirectory, { recursive: true, force: true });

  console.log('');
  console.log('ECOS Assurance Strict Jest Gate');
  if (failures.length === 0) {
    console.log('PASS: tests passed, serious harness warnings were absent, and coverage floors held.');
  } else {
    console.log('FAIL:');
    failures.forEach(failure => console.log(`- ${failure}`));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  JEST_NODE_FLAGS,
  MAX_PARTS,
  PARTS_ENVIRONMENT_NAME,
  coverageFailures,
  coverageFloors,
  jestArguments,
  mergedCoverageTotal,
  partCount,
  runSuiteInParts,
  seriousWarningPatterns,
  seriousWarnings,
};
