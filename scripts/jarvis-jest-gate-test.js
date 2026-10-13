#!/usr/bin/env node

/**
 * The strict jest step of the release gate (scripts/jarvis-jest-gate.js).
 *
 * Build 231 E1: on GitHub the suite runs as several in-band parts side by
 * side (VIC_JEST_PARTS), because one in-band run does not fit a runner. This
 * holds two things: the Mac's run is the command it always was, and the
 * parts mode gives up nothing the gate checks.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
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
} = require('./jarvis-jest-gate');

const jestBinary = path.join(path.resolve(__dirname, '..'), 'node_modules', 'jest', 'bin', 'jest.js');

// Requiring the gate must not start the suite.
assert.equal(require.cache[require.resolve('./jarvis-jest-gate')].loaded, true);
// This file is run by the release gate's own test, which the release-hardening checks run.
assert(
  fs.readFileSync(path.join(__dirname, 'jarvis-release-gate-test.js'), 'utf8').includes("require('./jarvis-jest-gate-test');"),
  'scripts/jarvis-release-gate-test.js must run this contract.',
);

// The Mac: nothing set, one run, and exactly the command the gate has always used.
assert.equal(PARTS_ENVIRONMENT_NAME, 'VIC_JEST_PARTS');
for (const unset of [{}, { VIC_JEST_PARTS: '' }, { VIC_JEST_PARTS: '  ' }, { VIC_JEST_PARTS: '1' }]) {
  assert.equal(partCount(unset), 1);
}
assert.deepEqual(jestArguments('/tmp/coverage'), [
  jestBinary,
  '--runInBand',
  '--watchman=false',
  '--coverage',
  '--coverageDirectory=/tmp/coverage',
  '--coverageReporters=text-summary',
  '--coverageReporters=json-summary',
]);

// GitHub: a whole number of parts; anything else stops the gate rather than quietly running one way or the other.
assert.equal(partCount({ VIC_JEST_PARTS: '3' }), 3);
assert.equal(partCount({ VIC_JEST_PARTS: String(MAX_PARTS) }), MAX_PARTS);
for (const wrong of ['0', '-2', '2.5', 'three', String(MAX_PARTS + 1), '1e1']) {
  assert.throws(() => partCount({ VIC_JEST_PARTS: wrong }), /VIC_JEST_PARTS must be a whole number from 1 to 8/);
}
// Each part is still jest in band with coverage, never a worker pool.
const partArguments = jestArguments('/tmp/coverage/part-2', { index: 2, count: 3 });
assert.deepEqual(partArguments, [
  jestBinary,
  '--runInBand',
  '--watchman=false',
  '--coverage',
  '--coverageDirectory=/tmp/coverage/part-2',
  '--shard=2/3',
  '--coverageReporters=json',
]);
assert(!partArguments.some(argument => /maxWorkers|^-w$/.test(argument)));

// The same six warnings fail the gate, whichever way the suite ran.
assert.deepEqual(seriousWarningPatterns.map(warning => warning.label), [
  'React state update outside act()',
  'log after Jest completion',
  'Jest environment teardown access',
  'worker did not exit gracefully',
  'unhandled promise rejection',
  'coverage report write failure',
]);
for (const [printed, label] of [
  ['Warning: An update to Page inside a test was not wrapped in act(...).', 'React state update outside act()'],
  ['Cannot log after tests are done. Did you forget to wait for something async in your test?', 'log after Jest completion'],
  ['ReferenceError: You are trying to access a property after the Jest environment has been torn down.', 'Jest environment teardown access'],
  ['A worker process has failed to exit gracefully and has been force exited.', 'worker did not exit gracefully'],
  ['(node:1) UnhandledPromiseRejectionWarning: Error: boom', 'unhandled promise rejection'],
  ['Unhandled promise rejection: boom', 'unhandled promise rejection'],
  ['Failed to write coverage reports:', 'coverage report write failure'],
]) {
  assert.deepEqual(seriousWarnings(`PASS tests/a.test.ts\n${printed}\n`), [`Serious test warning detected: ${label}.`]);
}
assert.deepEqual(seriousWarnings('PASS tests/a.test.ts\nTests: 3 passed, 3 total\n'), []);

// The floors are the same numbers, held against whatever totals the run produced.
assert.deepEqual(coverageFloors, { statements: 54.5, branches: 45.5, functions: 57.5, lines: 56.5 });
const atFloor = { statements: { pct: 54.5 }, branches: { pct: 45.5 }, functions: { pct: 57.5 }, lines: { pct: 56.5 } };
assert.deepEqual(coverageFailures(atFloor), []);
assert.deepEqual(coverageFailures({ ...atFloor, branches: { pct: 45.49 } }), ['branches coverage 45.49% is below the Jarvis floor of 45.5%.']);
assert.deepEqual(coverageFailures({ ...atFloor, lines: undefined }), ['Coverage metric lines is missing.']);

// Two parts' coverage of one file merge into what one run would have counted.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vitruvius-jest-gate-test-'));
const position = line => ({ start: { line, column: 0 }, end: { line, column: 10 } });
function fileCoverage(statementHits, functionHits, branchHits) {
  return {
    '/repo/services/Example.ts': {
      path: '/repo/services/Example.ts',
      statementMap: { 0: position(1), 1: position(2), 2: position(3), 3: position(4) },
      fnMap: { 0: { name: 'a', decl: position(1), loc: position(1), line: 1 }, 1: { name: 'b', decl: position(3), loc: position(3), line: 3 } },
      branchMap: { 0: { type: 'if', loc: position(2), locations: [position(2), position(2)], line: 2 } },
      s: Object.fromEntries(statementHits.map((hits, index) => [index, hits])),
      f: Object.fromEntries(functionHits.map((hits, index) => [index, hits])),
      b: { 0: branchHits },
    },
  };
}
function writeCoverage(name, coverage) {
  const directory = path.join(temporary, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'coverage-final.json'), JSON.stringify(coverage));
  return path.join(directory, 'coverage-final.json');
}

(async () => {
  try {
    // Part 1 ran the first two statements and one side of the branch; part 2 never loaded the file's second half
    // but ran statement 3; statement 4, function b and the branch's other side were run by neither.
    const first = writeCoverage('part-1', fileCoverage([2, 1, 0, 0], [1, 0], [1, 0]));
    const second = writeCoverage('part-2', fileCoverage([0, 0, 5, 0], [0, 0], [0, 0]));
    const merged = mergedCoverageTotal([first, second]);
    assert.deepEqual(
      [merged.statements, merged.functions, merged.branches, merged.lines].map(metric => [metric.covered, metric.total, metric.pct]),
      [[3, 4, 75], [1, 2, 50], [1, 2, 50], [3, 4, 75]],
    );
    // A file only one part saw at all is still counted once.
    const other = { '/repo/services/Other.ts': { ...fileCoverage([1], [], [])['/repo/services/Example.ts'], path: '/repo/services/Other.ts', statementMap: { 0: position(1) }, fnMap: {}, branchMap: {}, f: {}, b: {} } };
    const withOther = mergedCoverageTotal([first, writeCoverage('part-3', { ...fileCoverage([0, 0, 5, 0], [0, 0], [0, 0]), ...other })]);
    assert.deepEqual([withOther.statements.covered, withOther.statements.total], [4, 5]);

    // The parts start together; every one must pass, be free of the warnings, and the merged coverage must hold the floors.
    const good = fileCoverage([1, 1, 1, 1], [1, 1], [1, 1]);
    async function gate(outputs, { coverage = good, statuses = outputs.map(() => 0) } = {}) {
      const coverageDirectory = fs.mkdtempSync(path.join(temporary, 'run-'));
      const started = [];
      let running = 0;
      let mostAtOnce = 0;
      const printed = [];
      const failures = await runSuiteInParts(coverageDirectory, outputs.length, {
        write: text => printed.push(text),
        run: async args => {
          started.push(args);
          running += 1;
          mostAtOnce = Math.max(mostAtOnce, running);
          await new Promise(resolve => setTimeout(resolve, 5));
          running -= 1;
          const index = started.indexOf(args);
          const directory = args.find(argument => argument.startsWith('--coverageDirectory=')).split('=')[1];
          if (coverage) {
            fs.mkdirSync(directory, { recursive: true });
            fs.writeFileSync(path.join(directory, 'coverage-final.json'), JSON.stringify(coverage));
          }
          return { status: statuses[index], error: null, output: outputs[index] };
        },
      });
      return { failures, started, mostAtOnce, printed: printed.join('') };
    }

    const passing = await gate(['PASS tests/a.test.ts', 'PASS tests/b.test.ts', 'PASS tests/c.test.ts']);
    assert.deepEqual(passing.failures, []);
    assert.equal(passing.mostAtOnce, 3);
    assert.deepEqual(
      passing.started.map(args => args.filter(argument => argument.startsWith('--shard='))[0]),
      ['--shard=1/3', '--shard=2/3', '--shard=3/3'],
    );
    assert(passing.started.every(args => args.includes('--runInBand') && args.includes('--coverage')));
    assert.equal(new Set(passing.started.map(args => args.find(argument => argument.startsWith('--coverageDirectory=')))).size, 3);
    // Everything each part printed is shown, part by part, and the merged totals after them.
    for (const expected of ['---- jest part 1 of 3 ----\nPASS tests/a.test.ts', '---- jest part 3 of 3 ----\nPASS tests/c.test.ts', 'Coverage summary (3 parts merged)', 'Statements   : 100% ( 4/4 )']) {
      assert(passing.printed.includes(expected), `missing from the output: ${expected}`);
    }

    assert.deepEqual(
      (await gate(['PASS', 'FAIL tests/b.test.ts'], { statuses: [0, 1] })).failures,
      ['Jest part 2 of 2 exited with status 1.'],
    );
    assert.deepEqual(
      (await gate(['PASS', 'PASS\nWarning: An update to Page inside a test was not wrapped in act(...).'])).failures,
      ['Serious test warning detected: React state update outside act().'],
    );
    assert.deepEqual(
      (await gate(['PASS', 'PASS'], { coverage: fileCoverage([1, 1, 0, 0], [1, 0], [1, 0]) })).failures,
      [
        'statements coverage 50% is below the Jarvis floor of 54.5%.',
        'functions coverage 50% is below the Jarvis floor of 57.5%.',
        'lines coverage 50% is below the Jarvis floor of 56.5%.',
      ],
    );
    assert.deepEqual(
      (await gate(['PASS', 'PASS'], { coverage: null })).failures,
      ['Jest did not produce fresh coverage for 2 of 2 parts.'],
    );

    console.log('Strict jest gate contract PASS: one in-band run when VIC_JEST_PARTS is not set; in-band parts side by side when it is, with the same warnings and coverage floors.');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
