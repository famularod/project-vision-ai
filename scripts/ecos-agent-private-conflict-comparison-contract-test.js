#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(
  path.join(root, 'scripts', 'ecos-agent-private-conflict-comparison.js'),
  'utf8',
);
const candidate = fs.readFileSync(
  path.join(
    root,
    'supabase',
    'functions',
    'ecos-ask-project-candidate',
    'index.ts',
  ),
  'utf8',
);
const fixtures = fs.readFileSync(
  path.join(
    root,
    'supabase',
    'functions',
    '_shared',
    'ecos-agent-conflict-fixtures.ts',
  ),
  'utf8',
);
const deterministicAnswer = fs.readFileSync(
  path.join(
    root,
    'supabase',
    'functions',
    '_shared',
    'ecos-agent-conflict-answer.ts',
  ),
  'utf8',
);

for (const model of [
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'deepseek-v4-flash',
]) {
  assert.match(runner, new RegExp(model.replaceAll('.', '\\.')));
}
for (const caseId of [
  'conflict-01',
  'conflict-02',
  'conflict-03',
  'conflict-04',
  'conflict-05',
]) {
  assert.match(runner, new RegExp(caseId));
  assert.match(fixtures, new RegExp(`"${caseId}"`));
}
assert.match(runner, /validationMode: 'shadow'/);
assert.match(runner, /evaluationModel: input\.model/);
assert.match(runner, /evaluationAttemptId/);
assert.match(runner, /evaluationFixtureId: input\.evaluationCase\.id/);
assert.match(runner, /assertPrivateQuestionCapacity/);
assert.match(runner, /assertNoActiveQuestions/);
assert.match(runner, /createOwnerSession/);
assert.match(runner, /revokeOwnerSession/);
assert.match(runner, /countPersistedFixtureRows/);
assert.match(runner, /fixturePersistencePrevented/);
assert.match(runner, /projectStateStable/);
assert.match(runner, /projectIsolationPreserved/);
assert.match(runner, /repeatabilityRate/);
assert.match(runner, /eligibleForRecommendation/);
assert.match(runner, /MODEL_EVALUATION_FAILURE_CODES/);
assert.match(runner, /estimatedCostUsd/);
assert.match(runner, /STALE_OPERATION_RETRY_MS/);
assert.doesNotMatch(runner, /validationMode: 'live'/);
assert.doesNotMatch(runner, /ecos-ask-project['"]/);

assert.match(candidate, /evaluationFixtureId\?: string/);
assert.match(candidate, /evaluation_fixture_forbidden/);
assert.match(candidate, /evaluation_fixture_invalid/);
assert.match(candidate, /evaluation_fixture_question_mismatch/);
assert.match(candidate, /shadowValidation \|\| !protectedWorkerAuthorized/);
assert.match(candidate, /!evaluationModel \|\|/);
assert.match(candidate, /!evaluationAttemptId/);
assert.match(candidate, /requestContract !== ECOS_CURRENT_QUESTION_CONTRACT/);
assert.match(candidate, /getECOSControlledConflictFixture/);
assert.match(candidate, /controlledEvaluationEvidenceBundle/);
assert.match(candidate, /searchControlledEvaluationFixtureDocuments/);
assert.match(candidate, /buildECOSDeterministicConflictAnswer/);
assert.match(candidate, /evaluationFixtureId: evaluationFixtureId \|\| null/);

assert.match(fixtures, /Private controlled conflict fixture; not customer project evidence/);
assert.match(fixtures, /private-conflict-fixture:/);
assert.match(fixtures, /getECOSControlledConflictFixture/);
assert.match(fixtures, /normalizedText\(fixture\.question\) === normalizedText\(question\)/);
assert.doesNotMatch(fixtures, /SUPABASE|OPENAI_API_KEY|service_role/i);
assert.match(deterministicAnswer, /selectedSources\.length !== requiredIds\.length/);
assert.match(deterministicAnswer, /private-conflict-fixture:/);

console.log('ECOS private conflict comparison contract passed.');
