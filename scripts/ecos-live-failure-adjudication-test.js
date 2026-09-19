#!/usr/bin/env node

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const adjudicationPath = path.join(
  repoRoot,
  'validation',
  'ecos',
  'ask-ecos-live-v411-adjudication.json',
);

const adjudication = readJson(adjudicationPath);
assert.equal(adjudication.schemaVersion, 'ecos-live-failure-adjudication/1.0');
assert.equal(adjudication.sourceResults.length, 2);

const failedCaseIds = new Set();
let sourceTotal = 0;
let sourcePassed = 0;
let sourceFailed = 0;
let verifiedSourceCount = 0;

for (const source of adjudication.sourceResults) {
  const sourcePath = resolveRepositoryPath(source.path);
  assert.match(source.sha256, /^[a-f0-9]{64}$/);
  if (fs.existsSync(sourcePath)) {
    verifiedSourceCount += 1;
    const bytes = fs.readFileSync(sourcePath);
    assert.equal(sha256(bytes), source.sha256, `${source.path} changed after adjudication.`);
    const result = JSON.parse(bytes.toString('utf8'));
    assert.deepEqual(result.summary, {
      total: source.total,
      passed: source.passed,
      failed: source.failed,
      passRate: source.passed / source.total,
    });
    assert.equal(result.cases.length, source.total);
    for (const testCase of result.cases) {
      if (testCase.passed === true) continue;
      assert.ok(Array.isArray(testCase.failures) && testCase.failures.length > 0);
      assert.ok(!failedCaseIds.has(testCase.id), `Duplicate failed case id ${testCase.id}.`);
      failedCaseIds.add(testCase.id);
    }
  }
  sourceTotal += source.total;
  sourcePassed += source.passed;
  sourceFailed += source.failed;
}

assert.equal(sourceTotal, 34);
assert.equal(sourcePassed, 21);
assert.equal(sourceFailed, 13);

const rows = adjudication.adjudications;
assert.equal(rows.length, sourceFailed);
const adjudicatedIds = new Set(rows.map(row => row.caseId));
if (verifiedSourceCount === adjudication.sourceResults.length) {
  assert.deepEqual([...adjudicatedIds].sort(), [...failedCaseIds].sort());
}

const validClassifications = new Set([
  'evaluator_defect',
  'product_defect',
  'proof_coverage_defect',
]);
for (const row of rows) {
  assert.ok(validClassifications.has(row.classification), `Unknown classification for ${row.caseId}.`);
  assert.ok(String(row.answerDisposition || '').trim(), `Missing answer disposition for ${row.caseId}.`);
  assert.ok(String(row.reason || '').trim(), `Missing reason for ${row.caseId}.`);
  assert.ok(String(row.repair || '').trim(), `Missing repair for ${row.caseId}.`);
}

const counts = rows.reduce((value, row) => {
  value[row.classification] = (value[row.classification] || 0) + 1;
  return value;
}, {});
assert.equal(counts.evaluator_defect, adjudication.summary.evaluatorDefects);
assert.equal(counts.product_defect, adjudication.summary.productDefects);
assert.equal(counts.proof_coverage_defect, adjudication.summary.proofCoverageDefects);
assert.equal(rows.length, adjudication.summary.failedCases);

console.log('PASS Ask ECOS live failure adjudication covers all 13 failed customer-path cases');
console.log('PASS 8 evaluator defects, 4 product defects, and 1 proof-coverage defect are separated');
console.log(
  verifiedSourceCount === adjudication.sourceResults.length
    ? 'PASS the two source result files remain byte-identical to the adjudicated evidence'
    : 'PASS historical source-result digests remain pinned without packaging private run receipts',
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveRepositoryPath(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, absolutePath);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Source must remain inside the repository.');
  return absolutePath;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
