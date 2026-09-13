#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const matrix = JSON.parse(fs.readFileSync(path.join(
  path.resolve(__dirname, '..'),
  'validation',
  'ecos',
  'ask-ecos-agent-activity-matrix.json',
), 'utf8'));

assert.equal(matrix.schemaVersion, 'ecos-agent-activity-matrix/1.0');
assert.equal(matrix.activities.length, 10);
const cases = matrix.activities.flatMap((activity) => {
  assert.ok(activity.id);
  assert.ok(activity.evidenceMode);
  assert.ok(Array.isArray(activity.requiredSourceTypes));
  assert.equal(activity.cases.length, 5);
  return activity.cases.map((testCase) => ({...testCase, activityId: activity.id}));
});
assert.equal(cases.length, 50);
assert.equal(new Set(cases.map((testCase) => testCase.id)).size, 50);
assert.ok(cases.every((testCase) => testCase.question && testCase.expectedOutcome));
assert.ok(matrix.executionRule.includes('blocked, not passed'));
assert.ok(matrix.activities.some((activity) =>
  activity.evidenceMode === 'controlled_conflict_fixture'
));
assert.ok(matrix.activities.some((activity) =>
  activity.evidenceMode === 'controlled_conversation_sequence'
));

const qualifiedActivities = matrix.activities.filter((activity) =>
  activity.qualification?.status === 'qualified_private'
);
assert.deepEqual(
  qualifiedActivities.map((activity) => activity.id),
  [
    'exact-drawing-and-specification-lookup',
    'natural-language-and-field-wording',
    'schedule-status-and-dependencies',
    'task-update-photo-and-completion-research',
    'document-classification-and-source-discovery',
    'conflicting-and-superseded-records',
    'cross-document-status-risk-and-recommendations',
    'missing-evidence-and-incomplete-search',
    'inspection-compliance-closeout-and-signoff',
  ],
);
assert.deepEqual(
  qualifiedActivities.map((activity) => activity.qualification.selectedModel),
  [
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.6-luna',
    'gpt-5.6-luna',
    'gpt-5.6-luna',
    'gpt-5.6-luna',
    'gpt-5.6-luna',
    'gpt-5.6-luna',
  ],
);
assert.ok(qualifiedActivities.every((activity) =>
  activity.qualification.candidateCommit && activity.qualification.qualityFirstBasis
));
const missingEvidenceQualification = qualifiedActivities.find((activity) =>
  activity.id === 'missing-evidence-and-incomplete-search'
).qualification;
assert.equal(missingEvidenceQualification.candidateCommit, '7510786');
assert.equal(
  missingEvidenceQualification.receiptSha256,
  '1ca76eee272200b40b5d4f7a4b8c1ee20ae448491eebc25da9c709bc5006ffc9',
);
const progressQualification = qualifiedActivities.find((activity) =>
  activity.id === 'task-update-photo-and-completion-research'
).qualification;
assert.equal(progressQualification.selectedModel, 'gpt-5.6-luna');
assert.equal(
  progressQualification.selectionReceiptSha256,
  'f0db8b762837dc5790afb068e5b1c69a3705bd6b17aa56020a8ad55a5e15ce91',
);
const conflictQualification = qualifiedActivities.find((activity) =>
  activity.id === 'conflicting-and-superseded-records'
).qualification;
assert.equal(conflictQualification.candidateCommit, 'a0230d68aa45705874a4215e9a0e93d417ebb48c');
assert.equal(
  conflictQualification.receiptSha256,
  '892047122e4803bc5b6eda0d37cdb05bb4006cb355725aee73adde5b1997a2e3',
);
assert.equal(
  conflictQualification.selectionReceiptSha256,
  'cdcaeeaaa3bd3769e58728b66a69c539e0f6dd4c7b144b86f837fe4ea217e02f',
);
const synthesisQualification = qualifiedActivities.find((activity) =>
  activity.id === 'cross-document-status-risk-and-recommendations'
).qualification;
assert.equal(
  synthesisQualification.candidateCommit,
  'a3c41f269cee7c2b6017a10cd790d7be3340695c',
);
assert.equal(
  synthesisQualification.receiptSha256,
  '0d8f6378c0c7998dbf027669752680108b22d7043ad134b5259723635cfb3c67',
);
assert.equal(
  synthesisQualification.repeatReceiptSha256,
  '9775622c5dbc372c668d31069bbff3604b1a5f6ac9eee194aa6b0e552ab61b25',
);
const closeoutQualification = qualifiedActivities.find((activity) =>
  activity.id === 'inspection-compliance-closeout-and-signoff'
).qualification;
assert.equal(
  closeoutQualification.candidateCommit,
  'a57b041635fb85b17abd4d7535df6ecbacb4e2d6',
);
assert.equal(
  closeoutQualification.receiptSha256,
  'aae861ec4a6b5400b32328d372e05248dfbc73de5060ee34c8eadc0fcc0eea98',
);

console.log('ECOS 10-activity, 50-case model-routing matrix contract passed.');
