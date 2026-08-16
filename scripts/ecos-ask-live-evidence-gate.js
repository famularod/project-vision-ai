#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  loadAcceptanceDefinition,
  repoRoot,
  validateLiveAcceptanceResult,
} = require('./ecos-ask-live-acceptance-lib');

const RELEASE_DEFINITION_PATH = path.join(
  repoRoot,
  'validation',
  'ecos',
  'ask-ecos-real-world-cases.json',
);
const RELEASE_RESULT_PATH = path.join(
  repoRoot,
  'validation',
  'output',
  'ecos-ask-live-acceptance.json',
);

function runGate(now = new Date(), options = {}) {
  const selectedDefinitionPath = path.resolve(options.definitionPath || RELEASE_DEFINITION_PATH);
  const selectedResultPath = path.resolve(options.resultPath || RELEASE_RESULT_PATH);
  const definition = loadAcceptanceDefinition(selectedDefinitionPath);
  if (!fs.existsSync(selectedResultPath)) {
    console.error('Ask ECOS live acceptance FAIL.');
    console.error('No production acceptance evidence exists. Run npm run test:ecos-ask:live first.');
    return { passed: false, failures: ['Production acceptance evidence is missing.'] };
  }
  let result;
  try {
    result = JSON.parse(fs.readFileSync(selectedResultPath, 'utf8'));
  } catch (error) {
    const message = `Production acceptance evidence is unreadable: ${error.message}`;
    console.error(`Ask ECOS live acceptance FAIL.\n- ${message}`);
    return { passed: false, failures: [message] };
  }
  const failures = validateLiveAcceptanceResult(result, definition, now, selectedDefinitionPath);
  if (failures.length > 0) {
    console.error('Ask ECOS live acceptance FAIL.');
    failures.forEach(failure => console.error(`- ${failure}`));
    console.error(`Evidence: ${path.relative(repoRoot, selectedResultPath)}`);
    return { passed: false, failures };
  }
  console.log(`Ask ECOS live acceptance PASS: ${result.summary.passed}/${result.summary.total} real-world production questions correct.`);
  console.log(`Project: ${result.projectName}`);
  console.log(`Completed: ${result.completedAt}`);
  console.log(`Evidence: ${path.relative(repoRoot, selectedResultPath)}`);
  return { passed: true, failures: [] };
}

if (require.main === module) {
  const outcome = runGate();
  if (!outcome.passed) process.exitCode = 1;
}

module.exports = { RELEASE_DEFINITION_PATH, RELEASE_RESULT_PATH, runGate };
