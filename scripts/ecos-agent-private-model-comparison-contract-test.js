#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(
  path.join(root, 'scripts', 'ecos-agent-private-model-comparison.js'),
  'utf8',
);
const edge = fs.readFileSync(
  path.join(
    root,
    'supabase',
    'functions',
    'ecos-ask-project-candidate',
    'index.ts',
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
assert.match(runner, /FUNCTION_SLUG = 'ecos-ask-project-candidate'/);
assert.doesNotMatch(runner, /FUNCTION_SLUG = 'ecos-ask-project'/);
assert.match(runner, /ECOS_AGENT_COMPARISON_URL/);
assert.match(runner, /ECOS_AGENT_COMPARISON_GATEWAY_TOKEN/);
assert.match(runner, /ECOS_AGENT_SERVERLESS_AUTHORIZATION/);
assert.match(runner, /ECOS_AGENT_WIF_PROVIDER_RESOURCE/);
assert.match(runner, /ECOS_AGENT_WIF_SERVICE_ACCOUNT/);
assert.match(runner, /ECOS_AGENT_SERVERLESS_AUDIENCE/);
assert.match(runner, /mintCloudRunIdToken/);
assert.match(runner, /await ensureServerlessAuthorization\(session\.accessToken\)/);
assert.doesNotMatch(runner, /AGENT_RUNTIME_SERVERLESS_AUTHORIZATION/);
assert(
  runner.indexOf('await ensureServerlessAuthorization(session.accessToken)') <
    runner.indexOf('runtimeBefore = await readRuntimeIdentity()'),
  'private runtime identity must be read only after short-lived authentication is minted',
);
assert.match(runner, /ECOS_AGENT_EXPECTED_PACKAGE_SHA256/);
assert.match(runner, /ECOS_AGENT_EMBEDDING_PROVIDER_URL/);
assert.match(runner, /assertPrivateEmbeddingProviderReady/);
assert.match(runner, /private_embedding_provider_preflight_failed/);
assert(
  runner.indexOf('await assertPrivateEmbeddingProviderReady') <
    runner.indexOf('await assertPrivateQuestionCapacity'),
  'embedding readiness must be verified before capacity or session work',
);
assert.match(runner, /readRuntimeIdentity/);
assert.match(runner, /private_agent_runtime_identity_invalid/);
assert.match(runner, /private_agent_runtime_response_identity_mismatch/);
assert.match(runner, /runtimeStable/);
assert.match(runner, /private_cloud_run_agent_runtime/);
assert.match(runner, /validationMode: 'shadow'/);
assert.match(runner, /evaluationModel: model/);
assert.match(runner, /evaluationAttemptId/);
assert.match(runner, /ECOS_AGENT_COMPARISON_MODELS/);
assert.match(runner, /ECOS_AGENT_COMPARISON_VARIANT_MODE/);
assert.match(runner, /ECOS_AGENT_COMPARISON_ACTIVITY_CLASSES/);
assert.match(runner, /ECOS_AGENT_COMPARISON_PRESET/);
assert.match(runner, /exact-drawing-and-specification-lookup/);
assert.match(runner, /natural-language-and-field-wording/);
assert.match(runner, /missing-evidence-and-incomplete-search/);
assert.match(runner, /ask-ecos-missing-evidence-cases\.json/);
for (const family of [
  '2375-concrete-thickness-natural-language',
  '2375-canopy-a-area',
  '2375-canopy-lighting',
  '2321-canopy-slab-thickness',
  '2321-exhaust-fan-airflow',
]) {
  assert.match(runner, new RegExp(family));
}
assert.match(runner, /agent_comparison_preset_families_conflict/);
assert.match(runner, /\['first', 'all'\]/);
assert.match(runner, /VARIANT_MODE === 'all'/);
assert.match(runner, /NATURAL_LANGUAGE_CASE_VARIANTS/);
assert.match(runner, /agent_comparison_preset_variant_missing/);
assert.match(runner, /activityScores/);
assert.match(runner, /MODEL_EVALUATION_FAILURE_CODES/);
assert.match(runner, /Agent model failure:/);
assert.match(runner, /proofRegionFingerprint/);
assert.match(
  runner,
  /citationsOpenable:[\s\S]*dimensionGrades\.citation\.passed[\s\S]*dimensionGrades\.proof\.passed/,
);
assert.match(runner, /answerRepeatabilityRate/);
assert.match(runner, /proofRepeatabilityRate/);
assert.match(runner, /exactRegionRepeatabilityRate/);
assert.match(runner, /assuranceStatusRepeatabilityRate/);
assert.match(
  runner,
  /eligibleForRecommendation:[\s\S]*answerRepeatabilityRate === 1/,
);
assert.match(
  runner,
  /eligibleForRecommendation:[\s\S]*exactRegionRepeatabilityRate === 1/,
);
assert.match(
  runner,
  /eligibleForRecommendation:[\s\S]*assuranceStatusRepeatabilityRate === 1/,
);
assert.match(runner, /outcomeRepeatability/);
assert.match(runner, /fingerprintRepeatability/);
assert(
  runner.indexOf('const agentDiagnostics =') <
    runner.indexOf('const failures ='),
  'agent diagnostics must be initialized before failure classification',
);
assert.match(runner, /assertPrivateQuestionCapacity/);
assert.match(runner, /revokeOwnerSession/);
assert.match(runner, /retryPrivateCleanupRead/);
assert.match(runner, /authSessionRejected/);
assert.match(runner, /Post-run document fixture read failed:/);
assert.doesNotMatch(
  runner,
  /Boolean\(verification\.error \|\| !verification\.data\?\.user\)/,
);
assert.match(runner, /captureDocumentFixture/);
assert.match(runner, /drawingProjectIsolationPreserved/);
assert.match(runner, /Response is not bound to the exact selected project id/);
assert.match(runner, /outside the frozen selected-project inventory/);
assert.match(runner, /fixtureStable/);
assert.match(runner, /Current-document inventory changed during the comparison/);
assert.match(runner, /item\.replayed === false/);
assert.match(runner, /One or more attempts replayed an earlier answer/);
assert.match(runner, /safeRefusalCases\.length === 0[\s\S]*\? 1/);
assert.match(
  runner,
  /item\.activityClass === 'missing_evidence_and_safe_refusal'/,
);
assert.match(runner, /STALE_OPERATION_RETRY_MS = 125_000/);
assert.match(runner, /code === 'question_in_progress'/);
assert.match(edge, /evaluationModel && !shadowValidation/);
assert.match(edge, /shadow_validation_forbidden/);
assert.match(edge, /evaluation_attempt_id_required/);
assert.match(edge, /resolveECOSAgentOrchestrationMode/);
assert.match(edge, /agentEvaluationDiagnostics/);
assert.match(edge, /agentFailureCode/);
assert.match(edge, /ai_operation_finalize_failed/);
assert.match(edge, /parseECOSAgentExecutionLimits/);
assert.match(edge, /limits:\s*\{\s*\.\.\.executionLimits/);
assert.match(edge, /accepted\.length = 0/);
assert.match(
  edge,
  /const supportingSources = deterministicAnswerOwnsResponse\s*\?\s*citedSources/,
);
assert.match(
  edge,
  /measurementFallback \|\| areaFallback \|\| exactSheetPurposeFallback/,
);
assert.match(
  edge,
  /crossSheetCanopyPlanSetFallback \|\|[\s\S]*crossDisciplineLightingFallback \|\| canopyLightingFallback/,
);
assert.match(
  edge,
  /searches return exact authorized excerpts and citations and count as reading evidence/i,
);

console.log('ECOS private model comparison contract passed.');
