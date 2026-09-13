#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(
  path.join(root, 'scripts', 'ecos-agent-private-synthesis-diagnostic.js'),
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
  'synthesis-01-signoff-readiness',
  'synthesis-02-current-risks',
  'synthesis-03-two-week-focus',
  'synthesis-04-hazmat-canopy',
  'synthesis-05-overdue-without-update',
]) {
  assert.match(runner, new RegExp(caseId));
}
for (const caseId of [
  'broad-research-01-signoff-brief',
  'broad-research-02-risk-brief',
  'broad-research-03-two-week-plan',
  'broad-research-04-hazmat-canopy-brief',
  'broad-research-05-overdue-update-audit',
]) {
  assert.match(runner, new RegExp(caseId));
}
assert.match(runner, /validationMode: 'shadow'/);
assert.match(runner, /evaluationModel: input\.model/);
assert.match(runner, /evaluationAttemptId/);
assert.match(runner, /assertPrivateQuestionCapacity/);
assert.match(runner, /assertNoActiveQuestions/);
assert.match(runner, /createOwnerSession/);
assert.match(runner, /ECOS_AGENT_WIF_PROVIDER_RESOURCE/);
assert.match(runner, /ECOS_AGENT_WIF_SERVICE_ACCOUNT/);
assert.match(runner, /ECOS_AGENT_SERVERLESS_AUDIENCE/);
assert.match(runner, /mintCloudRunIdToken/);
assert.match(runner, /await ensureServerlessAuthorization\(session\.accessToken\)/);
assert(
  runner.indexOf('await ensureServerlessAuthorization(session.accessToken)') <
    runner.indexOf('runtime = await readRuntimeIdentity'),
  'private runtime identity must be read only after short-lived authentication is minted',
);
assert.match(runner, /revokeOwnerSession/);
assert.match(runner, /captureProjectState/);
assert.match(runner, /projectStateStable/);
assert.match(runner, /captureSynthesisOracle/);
assert.match(runner, /evaluateSemantics/);
assert.match(runner, /semanticPass/);
assert.match(runner, /semanticQualificationDeferred: false/);
assert.match(runner, /diagnosticOnly: true/);
assert.match(runner, /EXPECTED_PACKAGE_SHA256/);
assert.match(runner, /ECOS_AGENT_COMPARISON_MODELS/);
assert.match(runner, /ECOS_AGENT_SYNTHESIS_CASE_SET/);
assert.match(runner, /ECOS_AGENT_SYNTHESIS_REPETITIONS/);
assert.match(runner, /evaluateResearchBreadth/);
assert.match(runner, /evaluateRepeatability/);
assert.match(runner, /no successful evidence-bearing research calls/);
assert.doesNotMatch(runner, /fewer than three successful research calls/);
assert.match(runner, /inspect_project_evidence_inventory/);
assert.match(runner, /open_project_evidence/);
assert.match(runner, /agent_comparison_model_not_allowed/);
assert.doesNotMatch(runner, /validationMode: 'live'/);
assert.doesNotMatch(runner, /ecos-ask-project['"]/);
assert.doesNotMatch(runner, /evaluationFixtureId/);

console.log('ECOS private cross-document synthesis diagnostic contract passed.');
