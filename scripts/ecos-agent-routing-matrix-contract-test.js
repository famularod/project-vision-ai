#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const matrixPath = path.join(
  root,
  'validation',
  'ecos',
  'ask-ecos-end-user-reliability-matrix.json',
);
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const canonicalCases = new Map();

for (const relativePath of matrix.canonicalSuites || []) {
  const suite = JSON.parse(
    fs.readFileSync(path.join(root, relativePath), 'utf8'),
  );
  for (const testCase of suite.cases || []) {
    canonicalCases.set(`${suite.projectName}::${testCase.id}`, testCase);
  }
}

assert.equal(matrix.schemaVersion, 'ecos-end-user-reliability-matrix/2.0');
assert.equal(matrix.families.length, 10);

const attempts = matrix.families.flatMap((family) => {
  assert.equal(typeof family.activityClass, 'string');
  assert.ok(family.activityClass.length > 0);
  assert.equal(family.variants.length, 5);
  assert.ok(
    canonicalCases.has(`${family.projectName}::${family.canonicalCaseId}`),
    `missing canonical case for ${family.id}`,
  );
  return family.variants.map((question, index) => ({
    id: `${family.id}-variant-${index + 1}`,
    question: question.trim().replace(/\s+/g, ' '),
  }));
});

assert.equal(attempts.length, 50);
assert.equal(matrix.stagedExecution.languageFirstPassAttemptCount, 50);
assert.equal(new Set(attempts.map((attempt) => attempt.id)).size, 50);
assert.equal(new Set(attempts.map((attempt) => attempt.question)).size, 50);
assert.ok(
  attempts.some((attempt) =>
    attempt.question === 'What is the thickness of the new cement on the north lot?'
  ),
);
assert.ok(attempts.some((attempt) => /teh cement paving/i.test(attempt.question)));
assert.ok(
  matrix.families.some((family) =>
    family.activityClass === 'missing_evidence_and_safe_refusal'
  ),
);
assert.ok(
  matrix.families.some((family) =>
    family.activityClass === 'cross_document_comparison'
  ),
);

console.log('ECOS 50-question routing matrix contract passed.');
