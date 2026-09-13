#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(
  path.join(root, 'scripts', 'ecos-agent-private-schedule-comparison.js'),
  'utf8',
);
const tools = fs.readFileSync(
  path.join(root, 'supabase', 'functions', '_shared', 'ecos-agent-project-tools.ts'),
  'utf8',
);
const candidate = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'ecos-ask-project-candidate', 'index.ts'),
  'utf8',
);
const deterministicAnswer = fs.readFileSync(
  path.join(root, 'supabase', 'functions', '_shared', 'ecos-agent-schedule-answer.ts'),
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
  'schedule-01',
  'schedule-02',
  'schedule-03',
  'schedule-04',
  'schedule-05',
]) {
  assert.match(runner, new RegExp(caseId));
}
assert.match(runner, /validationMode: 'shadow'/);
assert.match(runner, /evaluationModel: input\.model/);
assert.match(runner, /evaluationAttemptId/);
assert.match(runner, /captureScheduleFixture/);
assert.match(runner, /fixtureBefore\.snapshotSha256 === fixtureAfter\.snapshotSha256/);
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
assert.match(runner, /scheduleEvidenceFingerprint/);
assert.match(runner, /repeatabilityRate/);
assert.match(runner, /eligibleForRecommendation/);
assert.match(runner, /requiredAnyConcepts/);
assert.match(runner, /MODEL_EVALUATION_FAILURE_CODES/);
assert.match(runner, /estimatedCostUsd/);
assert.match(runner, /ECOS_AGENT_COMPARISON_MODELS/);
assert.match(runner, /agent_comparison_model_not_allowed/);
assert.match(runner, /STALE_OPERATION_RETRY_MS/);
assert.doesNotMatch(runner, /validationMode: 'live'/);
assert.doesNotMatch(runner, /ecos-ask-project['"]/);
assert.match(tools, /list_project_schedule_activities/);
assert.match(tools, /matchingCount/);
assert.match(tools, /truncated/);
assert.match(tools, /start_ascending/);
assert.match(tools, /const appliedLimit = Math\.min\(25, matching\.length\)/);
assert.match(candidate, /scheduleData:/);
assert.match(candidate, /Dependencies[\s\S]*None recorded/);
assert.match(candidate, /never infer a predecessor or critical path/i);
assert.match(candidate, /buildECOSDeterministicScheduleAnswer/);
assert.match(deterministicAnswer, /complete_status_list/);
assert.match(deterministicAnswer, /next_work/);
assert.match(deterministicAnswer, /dependency_check/);
assert.match(deterministicAnswer, /No dependency is recorded/);
assert.match(deterministicAnswer, /America\/Los_Angeles/);

console.log('ECOS private schedule comparison contract passed.');
