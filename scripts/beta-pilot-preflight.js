#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { validatePilotPreflight } = require('./beta-readiness-gate');

function planPath(argv) {
  const index = argv.indexOf('--plan');
  return index >= 0 ? argv[index + 1] : null;
}

function main(argv = process.argv.slice(2)) {
  const filePath = planPath(argv);
  if (!filePath) {
    process.stderr.write(
      'Usage: node scripts/beta-pilot-preflight.js --plan <pilot-evidence-json>\n',
    );
    return 1;
  }
  const input = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const root = process.cwd();
  const result = validatePilotPreflight(input, {
    evidenceExists: ref => /^https:\/\//i.test(ref) || fs.existsSync(path.resolve(root, ref)),
  });
  process.stdout.write(`Vitruvius outside-user pilot preflight: ${result.ok ? 'PASS' : 'FAIL'}\n`);
  for (const failure of result.failures) process.stdout.write(`- ${failure}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(
      `Vitruvius outside-user pilot preflight FAIL: ${error instanceof Error ? error.message : 'Plan could not be read.'}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { main };
