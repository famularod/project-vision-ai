#!/usr/bin/env node

'use strict';

/**
 * Build 232: every jest this repo starts is started with node's
 * --no-sparkplug.
 *
 * WHY. Node v24.17.0 on the Mac dies now and then (SIGSEGV) inside V8's
 * garbage collector while it walks a frame set up by the function-entry code
 * of V8's "Sparkplug" baseline compiler (Builtins_BaselineOutOfLinePrologue
 * on the crashed thread in 36 of 36 V8 crash reports, 5 to 13 Oct 2026). On
 * 13 Oct it took the release build's 23-minute in-band jest run down twice.
 * With Sparkplug off that entry code is never run. Nobody has a stand-alone
 * reproduction of the crash, so "the flag prevents it" rests on those
 * stacks; what IS measured, here, is that the flag leaves no function in
 * the baseline tier. Only a JIT tier of the test runner is given up: the
 * app never runs on node.
 *
 * WHAT THIS HOLDS
 * 1. The places. The strict jest gate, every package.json script, every
 *    GitHub workflow command and every other script start jest as
 *    `node --no-sparkplug node_modules/jest/bin/jest.js ...` or not at all.
 *    (The flag is refused in NODE_OPTIONS, and after the jest script it
 *    would go to jest, so its place on the command line is checked too.)
 * 2. The flag. A node started that way has a warmed-up function in the
 *    baseline tier 0 times; started with --sparkplug it has some, so the 0
 *    is not the probe failing to see.
 * 3. Jest's worker processes. jest-worker (the copy jest's runner, coverage
 *    reporter and file map use) starts each worker with its parent's node
 *    flags. Shown with a real worker process: it reports the flag on its own
 *    command line and 0 functions in the baseline tier. This process stands
 *    in for the jest process there, so its process.execArgv is set to the
 *    flags for the length of the fork; everything the worker reports is the
 *    worker's own.
 *
 * At most one child process runs at a time.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const gate = require('./jarvis-jest-gate');

const repoRoot = path.resolve(__dirname, '..');
const REQUIRED_NODE_FLAG = '--no-sparkplug';
const JEST_SCRIPT = 'node_modules/jest/bin/jest.js';
const probePath = path.join(__dirname, 'jest-no-sparkplug-probe.js');

const failures = [];
let checks = 0;
function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

/** The commands in one shell line that run jest itself (a word that is `jest` or a path ending in jest / jest.js). */
function jestStarts(commandLine) {
  return String(commandLine)
    .split(/&&|\|\||[;|\n]/)
    .map(command => command.trim().split(/\s+/).map(word => word.replace(/^["']|["']$/g, '')))
    .filter(words => words.some(word => /^(?:.*\/)?jest(?:\.js)?$/.test(word)))
    .map(words => words.join(' '));
}

/** `node`, then node's flags with --no-sparkplug among them, then the jest script: the only way this repo starts jest. */
function startedWithTheFlag(command) {
  const words = command.split(' ');
  const script = words.indexOf(JEST_SCRIPT);
  const nodeFlags = words.slice(1, Math.max(script, 1));
  return words[0] === 'node'
    && script >= 2
    && nodeFlags.every(flag => flag.startsWith('--'))
    && nodeFlags.includes(REQUIRED_NODE_FLAG);
}

// The reading of a command line is itself held, so that it cannot go blind.
for (const [commandLine, starts, right] of [
  ['jest --runInBand --watchman=false', 1, false],
  ['node scripts/a-test.js && npx jest tests/a.test.ts', 1, false],
  ['node_modules/.bin/jest tests/a.test.ts; echo done', 1, false],
  [`node ${JEST_SCRIPT} --runInBand`, 1, false],
  [`node ${JEST_SCRIPT} --no-sparkplug --runInBand`, 1, false],
  [`NODE_OPTIONS=--no-sparkplug node ${JEST_SCRIPT}`, 1, false],
  [`node --no-sparkplug ${JEST_SCRIPT} --runInBand tests/a.test.ts`, 1, true],
  [`node --no-sparkplug ${JEST_SCRIPT} && node --max-old-space-size=4096 --no-sparkplug ${JEST_SCRIPT} --coverage`, 2, true],
  ['node scripts/jarvis-jest-gate.js', 0, true],
  ['npm run test:unit && npx jest-expo --help && node x.js --config jest.config.js', 0, true],
]) {
  const found = jestStarts(commandLine);
  check(
    found.length === starts && found.every(startedWithTheFlag) === right,
    `This check misreads "${commandLine}": it found ${found.length} jest start(s), ${found.filter(startedWithTheFlag).length} with the flag.`,
  );
}

// 1a. The strict jest gate: node's flag is in front of the jest script, for the one run and for a part.
check(
  Array.isArray(gate.JEST_NODE_FLAGS) && gate.JEST_NODE_FLAGS.includes(REQUIRED_NODE_FLAG),
  `scripts/jarvis-jest-gate.js must export JEST_NODE_FLAGS with ${REQUIRED_NODE_FLAG}.`,
);
for (const [label, args] of [
  ['the one run', gate.jestArguments('/tmp/coverage')],
  ['a part', gate.jestArguments('/tmp/coverage/part-1', { index: 1, count: 3 })],
]) {
  const script = args.findIndex(argument => argument.endsWith(path.join('jest', 'bin', 'jest.js')));
  const flag = args.indexOf(REQUIRED_NODE_FLAG);
  check(
    script > 0 && flag >= 0 && flag < script,
    `scripts/jarvis-jest-gate.js starts jest for ${label} without ${REQUIRED_NODE_FLAG} in front of the jest script.`,
  );
}

// 1b. package.json: every script that runs jest itself.
const packageScripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts;
const scriptStarts = Object.entries(packageScripts)
  .flatMap(([name, commandLine]) => jestStarts(commandLine).map(command => ({ name, command })));
check(scriptStarts.length > 0, 'No package.json script starts jest: this check no longer reads what it was written for.');
for (const name of ['test:unit', 'test:unit:coverage', 'test:web-foundation']) {
  check(
    scriptStarts.some(start => start.name === name),
    `package.json "${name}" no longer starts jest itself: say here what it does now.`,
  );
}
for (const { name, command } of scriptStarts) {
  check(
    startedWithTheFlag(command),
    `package.json "${name}" starts jest without the flag ("${command.slice(0, 70)}"). It must be "node ${REQUIRED_NODE_FLAG} ${JEST_SCRIPT} ...".`,
  );
}

// 1c. GitHub workflows: the commands of every `run:`. Today none starts jest itself; they go through npm scripts.
const workflowDirectory = path.join(repoRoot, '.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowDirectory).filter(file => /\.ya?ml$/.test(file));
check(workflowFiles.length > 0, 'No GitHub workflow was found to read.');
let workflowCommands = 0;
for (const file of workflowFiles) {
  const lines = fs.readFileSync(path.join(workflowDirectory, file), 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const run = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[index]);
    if (!run) continue;
    const commands = [];
    if (/^[|>][+-]?$/.test(run[2])) {
      const indent = run[1].length;
      while (index + 1 < lines.length && (!lines[index + 1].trim() || lines[index + 1].search(/\S/) > indent)) {
        index += 1;
        commands.push(lines[index]);
      }
    } else {
      commands.push(run[2]);
    }
    workflowCommands += commands.length;
    for (const command of commands.flatMap(jestStarts)) {
      check(
        startedWithTheFlag(command),
        `.github/workflows/${file} starts jest without the flag ("${command.slice(0, 70)}").`,
      );
    }
  }
}
check(workflowCommands > 0, 'No `run:` command was read from the GitHub workflows.');

// 1d. No other script starts jest, and nothing tries the flag where node refuses it.
const startsJest = new RegExp([
  /jest\/bin\/jest/, /['"]jest['"],\s*['"]bin['"]/, /\.bin\/jest/, // the jest script by its path
  /\bnpx(?:\.cmd)?\s+jest\b/, /['"]npx(?:\.cmd)?['"],\s*\[\s*['"]jest['"]/, // through npx
  /(?:spawn|exec)\w*\(\s*['"`]jest\b/, // the bare command
  /require\(\s*['"](?:jest|jest-cli|@jest\/core)['"]\s*\)/, // jest run inside the script's own node
].map(pattern => pattern.source).join('|'));
const ownFiles = new Set(['jarvis-jest-gate.js', 'jarvis-jest-gate-test.js', path.basename(__filename)]);
for (const file of fs.readdirSync(__dirname).filter(name => !ownFiles.has(name) && fs.statSync(path.join(__dirname, name)).isFile())) {
  check(
    !startsJest.test(fs.readFileSync(path.join(__dirname, file), 'utf8')),
    `scripts/${file} starts jest. Only scripts/jarvis-jest-gate.js may, with JEST_NODE_FLAGS; or hold the new start here.`,
  );
}
const everyCommand = [
  ...Object.values(packageScripts),
  ...workflowFiles.map(file => fs.readFileSync(path.join(workflowDirectory, file), 'utf8')),
].join('\n');
check(
  !/NODE_OPTIONS[^\n]*sparkplug/.test(everyCommand),
  'Node refuses --no-sparkplug in NODE_OPTIONS ("not allowed in NODE_OPTIONS", exit 9): put it on the node command line.',
);

// This file is run by the release gate's own test, which the release-hardening checks (and so GitHub) run.
check(
  fs.readFileSync(path.join(__dirname, 'jarvis-release-gate-test.js'), 'utf8').includes("require('./jest-no-sparkplug-test');"),
  'scripts/jarvis-release-gate-test.js must run this check.',
);

// 2 and 3 start processes with exactly the flags under test: a NODE_OPTIONS of the caller's is kept out of them.
function withoutNodeOptions(env) {
  const { NODE_OPTIONS: _ignored, ...rest } = env;
  return rest;
}

/** The probe in a node started with these flags in front of the script, as the repo starts jest. */
function probeInNode(nodeFlags) {
  const result = spawnSync(process.execPath, [...nodeFlags, probePath], {
    encoding: 'utf8',
    env: withoutNodeOptions(process.env),
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    return { problem: result.error ? result.error.message : `exit ${result.status}: ${String(result.stderr).trim().slice(0, 200)}` };
  }
  return JSON.parse(result.stdout);
}

/** The probe in a jest-worker child process whose parent has these node flags. */
async function probeInJestWorker(nodeFlags, jestWorkerPath) {
  const { Worker } = require(jestWorkerPath);
  const ownFlags = process.execArgv.slice();
  const ownNodeOptions = process.env.NODE_OPTIONS;
  let worker;
  try {
    process.execArgv.splice(0, process.execArgv.length, ...nodeFlags);
    delete process.env.NODE_OPTIONS;
    // The options jest's runner gives its test workers (jest-runner/build/index.js), with one worker.
    worker = new Worker(probePath, {
      exposedMethods: ['sparkplugLooks'],
      forkOptions: { serialization: 'json', stdio: 'pipe' },
      maxRetries: 0,
      numWorkers: 1,
    });
    return await worker.sparkplugLooks();
  } catch (error) {
    return { problem: error.message };
  } finally {
    if (worker) await worker.end();
    process.execArgv.splice(0, process.execArgv.length, ...ownFlags);
    if (ownNodeOptions !== undefined) process.env.NODE_OPTIONS = ownNodeOptions;
  }
}

function count(looked) {
  return looked.problem ? `not measured (${looked.problem})` : `${looked.foundInSparkplugTier} of ${looked.looks}`;
}

(async () => {
  const notes = [];
  // Where Sparkplug is known to be at work (the Mac, where node crashes) the probe must be seen to see it. Elsewhere
  // a probe that sees none even with --sparkplug is said, not failed: GitHub's Linux runner was never measured.
  function seesSparkplug(looked, where) {
    if (looked.problem || looked.foundInSparkplugTier > 0) {
      check(!looked.problem, `The probe did not run ${where}: ${looked.problem}`);
    } else if (process.platform === 'darwin') {
      check(false, `With --sparkplug the probe found no function in the baseline tier ${where}: it cannot tell the flag's effect.`);
    } else {
      notes.push(`NOTE: with --sparkplug the probe found no function in the baseline tier ${where} on ${process.platform}; the 0 with the flag shows nothing here.`);
    }
  }
  function flagIsInForce(looked, where) {
    check(!looked.problem, `The probe did not run ${where}: ${looked.problem}`);
    if (looked.problem) return;
    check(
      looked.execArgv.includes(REQUIRED_NODE_FLAG),
      `${REQUIRED_NODE_FLAG} is not on the command line ${where}: its node flags are [${looked.execArgv.join(' ')}].`,
    );
    check(
      looked.looks > 0 && looked.foundInSparkplugTier === 0,
      `${where}, ${count(looked)} looks at a warmed-up function found it in the baseline tier; the flag must leave none.`,
    );
  }

  // 2. The flag does what it is here for.
  const flagged = probeInNode([REQUIRED_NODE_FLAG]);
  const unflagged = probeInNode(['--sparkplug']);
  flagIsInForce(flagged, `in a node started with ${REQUIRED_NODE_FLAG}`);
  seesSparkplug(unflagged, 'in a node started with --sparkplug');

  // 3. Jest's worker processes get it from the jest process.
  const resolveFrom = (request, from) => require.resolve(request, { paths: [from] });
  const jestWorkerOf = owner => resolveFrom('jest-worker', path.dirname(resolveFrom(`${owner}/package.json`, repoRoot)));
  const jestWorkerPath = jestWorkerOf('jest-runner');
  for (const owner of ['@jest/reporters', 'jest-haste-map']) {
    check(
      jestWorkerOf(owner) === jestWorkerPath,
      `${owner} uses another copy of jest-worker than jest-runner: hold that copy here as well.`,
    );
  }
  const flaggedWorker = await probeInJestWorker([REQUIRED_NODE_FLAG], jestWorkerPath);
  const unflaggedWorker = await probeInJestWorker(['--sparkplug'], jestWorkerPath);
  flagIsInForce(flaggedWorker, `in a jest worker process whose parent has ${REQUIRED_NODE_FLAG}`);
  check(
    flaggedWorker.problem || (flaggedWorker.pid !== process.pid && flaggedWorker.parentPid === process.pid),
    'The jest-worker probe did not run in a child process of this one.',
  );
  seesSparkplug(unflaggedWorker, 'in a jest worker process whose parent has --sparkplug');

  notes.forEach(note => console.log(note));
  if (failures.length > 0) {
    console.error(`Jest node flag check FAIL: ${failures.length} of ${checks} checks.`);
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(
    `Jest node flag check PASS (${checks} checks): ${scriptStarts.length} package.json jest starts and the strict gate's two carry ${REQUIRED_NODE_FLAG}; `
    + `no workflow command (${workflowCommands} read) or other script starts jest. Warmed-up functions found in the baseline tier: `
    + `${count(flagged)} with the flag (${count(unflagged)} with --sparkplug); in a jest worker process ${count(flaggedWorker)} (${count(unflaggedWorker)}).`,
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
