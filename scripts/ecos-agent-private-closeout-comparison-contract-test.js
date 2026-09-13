#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(
  path.join(root, 'scripts', 'ecos-agent-private-conflict-comparison.js'),
  'utf8',
);
const closeoutRunner = fs.readFileSync(
  path.join(root, 'scripts', 'ecos-agent-private-closeout-comparison.js'),
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
    'ecos-agent-acceptance-fixtures.ts',
  ),
  'utf8',
);
const deterministicAnswer = fs.readFileSync(
  path.join(
    root,
    'supabase',
    'functions',
    '_shared',
    'ecos-agent-acceptance-answer.ts',
  ),
  'utf8',
);

assert.match(closeoutRunner, /ECOS_AGENT_EVALUATION_KIND = 'acceptance'/);
assert.match(closeoutRunner, /ecos-agent-private-conflict-comparison/);
for (const model of [
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'deepseek-v4-flash',
]) {
  assert.match(runner, new RegExp(model.replaceAll('.', '\\.')));
}
for (const caseId of [
  'closeout-01',
  'closeout-02',
  'closeout-03',
  'closeout-04',
  'closeout-05',
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
assert.match(runner, /exactEvidenceSet/);
assert.match(runner, /projectIsolationPreserved/);
assert.match(runner, /repeatabilityRate/);
assert.match(runner, /eligibleForRecommendation/);
assert.match(runner, /estimatedCostUsd/);
assert.doesNotMatch(runner, /validationMode: 'live'/);

assert.match(candidate, /getECOSControlledAcceptanceFixture/);
assert.match(candidate, /controlledEvaluationEvidenceBundle/);
assert.match(candidate, /searchControlledEvaluationFixtureDocuments/);
assert.match(candidate, /buildECOSDeterministicAcceptanceAnswer/);
assert.match(candidate, /deterministicAcceptanceSynthesis/);
assert.match(fixtures, /private-acceptance-fixture:/);
assert.match(fixtures, /getECOSControlledAcceptanceFixture/);
assert.match(
  fixtures,
  /normalizedText\(fixture\.question\) === normalizedText\(question\)/,
);
assert.doesNotMatch(fixtures, /SUPABASE|OPENAI_API_KEY|service_role/i);
assert.match(
  deterministicAnswer,
  /selectedSources\.length !== requiredIds\.length/,
);
assert.match(deterministicAnswer, /private-acceptance-fixture:/);

console.log('ECOS private closeout comparison contract passed.');
