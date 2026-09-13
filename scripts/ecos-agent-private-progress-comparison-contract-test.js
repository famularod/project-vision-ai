#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(
  path.join(root, 'scripts', 'ecos-agent-private-progress-comparison.js'),
  'utf8',
);
const tools = fs.readFileSync(
  path.join(
    root,
    'supabase',
    'functions',
    '_shared',
    'ecos-agent-project-tools.ts',
  ),
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
const deterministicAnswer = fs.readFileSync(
  path.join(
    root,
    'supabase',
    'functions',
    '_shared',
    'ecos-agent-progress-answer.ts',
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
  'progress-01',
  'progress-02',
  'progress-03',
  'progress-04',
  'progress-05',
]) {
  assert.match(runner, new RegExp(caseId));
}
assert.match(runner, /validationMode: 'shadow'/);
assert.match(runner, /evaluationModel: input\.model/);
assert.match(runner, /evaluationAttemptId/);
assert.match(runner, /captureProgressFixture/);
assert.match(
  runner,
  /fixtureBefore\.snapshotSha256 === fixtureAfter\.snapshotSha256/,
);
assert.match(runner, /assertPrivateQuestionCapacity/);
assert.match(runner, /assertNoActiveQuestions/);
assert.match(runner, /createOwnerSession/);
assert.match(runner, /ECOS_AGENT_WIF_PROVIDER_RESOURCE/);
assert.match(runner, /ECOS_AGENT_WIF_SERVICE_ACCOUNT/);
assert.match(runner, /ECOS_AGENT_SERVERLESS_AUDIENCE/);
assert.match(runner, /mintCloudRunIdToken/);
assert.match(runner, /await ensureServerlessAuthorization\(session\.accessToken\)/);
assert.match(runner, /revokeOwnerSession/);
assert.match(runner, /projectIsolationPreserved/);
assert.match(runner, /evidenceFingerprint/);
assert.match(runner, /repeatabilityRate/);
assert.match(runner, /eligibleForRecommendation/);
assert.match(runner, /photoOnly/);
assert.match(runner, /openIssuesOnly/);
assert.match(runner, /completionBoundary/);
assert.match(runner, /MODEL_EVALUATION_FAILURE_CODES/);
assert.match(runner, /estimatedCostUsd/);
assert.match(runner, /ECOS_AGENT_COMPARISON_MODELS/);
assert.match(runner, /agent_comparison_model_not_allowed/);
assert.match(runner, /STALE_OPERATION_RETRY_MS/);
assert.match(runner, /corpus\.includes\(canonical\(key\)\)/);
assert.doesNotMatch(runner, /validationMode: 'live'/);
assert.doesNotMatch(runner, /ecos-ask-project['"]/);
assert.match(tools, /list_project_progress_records/);
assert.match(tools, /photosOnly/);
assert.match(tools, /occurred_descending/);
assert.match(tools, /const appliedLimit = Math\.min\(25, matching\.length\)/);
assert.match(candidate, /progressData:/);
assert.match(candidate, /Inspection acceptance/);
assert.match(candidate, /buildECOSDeterministicProgressAnswer/);
assert.match(candidate, /\["Last updated", record\.updated_at\]/);
assert.match(candidate, /task marked complete[\s\S]*inspection acceptance/i);
assert.match(deterministicAnswer, /latest_task_progress/);
assert.match(deterministicAnswer, /photo_backed_work/);
assert.match(deterministicAnswer, /open_field_issues/);
assert.match(deterministicAnswer, /completion_is_not_acceptance/);
assert.match(deterministicAnswer, /records no inspection acceptance/);

console.log('ECOS private progress comparison contract passed.');
