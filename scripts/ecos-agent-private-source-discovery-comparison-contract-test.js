#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(
  path.join(root, 'scripts', 'ecos-agent-private-source-discovery-comparison.js'),
  'utf8',
);
const candidate = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'ecos-ask-project-candidate', 'index.ts'),
  'utf8',
);
const questionLanguage = fs.readFileSync(
  path.join(root, 'supabase', 'functions', '_shared', 'ecos-question-language.ts'),
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
for (const caseId of ['source-01', 'source-02', 'source-03', 'source-04', 'source-05']) {
  assert.match(runner, new RegExp(caseId));
}
assert.match(runner, /document-classification-and-source-discovery/);
assert.match(runner, /ecos_list_hosted_shadow_question_documents_v22/);
assert.match(runner, /ecos_load_hosted_shadow_page_context_v21/);
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
assert.match(runner, /revokeOwnerSession/);
assert.match(runner, /fixtureBefore\.snapshotSha256 === fixtureAfter\.snapshotSha256/);
assert.match(runner, /projectIsolationPreserved/);
assert.match(runner, /successfulResearchCalls/);
assert.match(runner, /safeRefusalRate/);
assert.match(runner, /repeatabilityRate/);
assert.match(runner, /repeatabilitySufficient\s*=\s*REPETITIONS\s*>=\s*2/);
assert.match(
  runner,
  /repeatabilityRate\s*===\s*1\s*&&\s*repeatabilitySufficient/,
);
assert.match(runner, /eligibleForRecommendation/);
assert.match(runner, /ECOS_AGENT_COMPARISON_MODELS/);
assert.match(runner, /agent_comparison_model_not_allowed/);
assert.match(runner, /missingViewedDocumentIdentity/);
assert.match(
  runner,
  /attempt\.evaluationCase\.missingViewedDocumentIdentity\s*\|\|\s*positiveInteger\(agentDiagnostics\.successfulResearchCalls\)\s*>\s*0/,
);
assert.match(runner, /insufficient_evidence/);
assert.match(
  candidate,
  /ecosQuestionNeedsViewedDocumentIdentity\(effectiveQuestion\)/,
);
assert.match(candidate, /deterministicGuard:\s*"viewed_document_identity_required"/);
assert.match(
  candidate,
  /if \(exactSheetPurposeFallback\) \{\s*accepted\.length = 0;/,
);
assert.match(
  candidate,
  /if \(crossDisciplineLightingFallback\) \{\s*accepted\.length = 0;/,
);
assert.match(
  candidate,
  /if \(crossSheetCanopyPlanSetFallback\) \{\s*accepted\.length = 0;/,
);
assert.match(candidate, /deterministicAnswerOwnsResponse/);
assert.match(questionLanguage, /export function ecosQuestionNeedsViewedDocumentIdentity/);
assert.doesNotMatch(runner, /validationMode: 'live'/);
assert.doesNotMatch(runner, /ecos-ask-project['"]/);

console.log('ECOS private source-discovery comparison contract passed.');
