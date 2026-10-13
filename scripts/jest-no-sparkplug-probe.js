#!/usr/bin/env node

'use strict';

/**
 * How often a warmed-up function is found running in V8's "Sparkplug"
 * (baseline) tier in THIS node process. V8 answers that itself
 * (%ActiveTierIsSparkplug); nothing here guesses from timings.
 *
 * scripts/jest-no-sparkplug-test.js starts this file the way the repo starts
 * jest (node flags first), and also hands it to jest-worker as the module a
 * worker process runs. It is not a test by itself and starts nothing.
 */

const v8 = require('node:v8');

const FUNCTIONS = 400;
const ROUNDS = 60;
const CALLS_PER_ROUND = 25;

function sparkplugLooks() {
  // V8 only reads "%Name(...)" with this flag on. It is set here, in this
  // short-lived process, so that the process is started with nothing but the
  // flags under test. It changes what V8 will parse, not how it compiles.
  v8.setFlagsFromString('--allow-natives-syntax');
  const inSparkplugTier = new Function('fn', 'return %ActiveTierIsSparkplug(fn);');
  const functions = Array.from(
    { length: FUNCTIONS },
    (_unused, index) => new Function('value', `return (value * 3 + ${index}) | 0;`),
  );

  let looks = 0;
  let foundInSparkplugTier = 0;
  let sum = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const fn of functions) {
      for (let call = 0; call < CALLS_PER_ROUND; call += 1) sum += fn(call);
    }
    for (const fn of functions) {
      looks += 1;
      if (inSparkplugTier(fn)) foundInSparkplugTier += 1;
    }
  }
  return {
    looks,
    foundInSparkplugTier,
    execArgv: process.execArgv,
    pid: process.pid,
    parentPid: process.ppid,
    node: process.version,
    sum,
  };
}

module.exports = { sparkplugLooks };

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(sparkplugLooks())}\n`);
}
