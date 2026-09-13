#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(
  path.join(root, 'scripts', 'ecos-agent-private-conflict-comparison.js'),
  'utf8',
);
const conversationRunner = fs.readFileSync(
  path.join(root, 'scripts', 'ecos-agent-private-conversation-comparison.js'),
  'utf8',
);
const deepSeekConversationRunner = fs.readFileSync(
  path.join(
    root,
    'scripts',
    'ecos-agent-private-deepseek-conversation-comparison.js',
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
const context = fs.readFileSync(
  path.join(
    root,
    'supabase',
    'functions',
    '_shared',
    'ecos-agent-conversation-context.ts',
  ),
  'utf8',
);
const fixtures = fs.readFileSync(
  path.join(
    root,
    'supabase',
    'functions',
    '_shared',
    'ecos-agent-conversation-fixtures.ts',
  ),
  'utf8',
);

assert.match(conversationRunner, /ECOS_AGENT_EVALUATION_KIND = 'conversation'/);
assert.match(conversationRunner, /ecos-agent-private-conflict-comparison/);
for (const model of ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']) {
  assert.match(runner, new RegExp(model.replaceAll('.', '\\.')));
}
assert.match(runner, /deepseek-v4-flash/);
assert.match(runner, /DEFAULT_MODEL_IDS/);
assert.match(deepSeekConversationRunner, /ECOS_AGENT_EVALUATION_KIND = 'conversation'/);
assert.match(deepSeekConversationRunner, /ECOS_AGENT_COMPARISON_MODELS = 'deepseek-v4-flash'/);
assert.match(deepSeekConversationRunner, /ecos-agent-private-conflict-comparison/);
for (const caseId of [
  'conversation-01',
  'conversation-02',
  'conversation-03',
  'conversation-04',
  'conversation-05',
]) {
  assert.match(runner, new RegExp(caseId));
  assert.match(fixtures, new RegExp(`"${caseId}"`));
}
assert.match(runner, /requiredSlots: attempts\.length \* 2/);
assert.match(runner, /const PRIVATE_QUESTION_HOURLY_LIMIT = 60/);
assert.match(runner, /ECOS_AGENT_COMPARISON_CASE_IDS/);
assert.match(runner, /ECOS_AGENT_COMPARISON_MODELS/);
assert.match(runner, /selectExactAllowedValues/);
assert.match(runner, /allowed\.includes\(value\)/);
assert.match(runner, /ensureServerlessAuthorization\(session\.accessToken\)/);
assert.match(runner, /mintCloudRunIdToken/);
assert.match(runner, /conversationId: input\.conversationId/);
assert.match(runner, /priorTurnId: input\.priorTurnId/);
assert.match(runner, /evaluateConversationSeed/);
assert.match(runner, /evaluateConversationCase/);
assert.match(runner, /projectIsolationPreserved/);
assert.match(runner, /projectStateStable/);
assert.match(runner, /sessionRevocationVerified/);
assert.match(runner, /repeatabilityRate/);
assert.doesNotMatch(runner, /validationMode: 'live'/);

assert.match(candidate, /loadPriorConversationTurn/);
assert.match(candidate, /parseECOSAgentConversationOperationRecord/);
assert.match(candidate, /resolveECOSAgentConversationQuestion/);
assert.match(candidate, /buildECOSAgentConversationEnvelope/);
assert.match(candidate, /buildECOSDeterministicConversationAnswer/);
assert.match(context, /conversation_project_switch_not_explicit/);
assert.match(context, /record\.owner_id/);
assert.match(context, /record\.response_expires_at/);
assert.match(context, /record\.project_ids/);
assert.match(fixtures, /private-conversation-fixture:/);
assert.doesNotMatch(fixtures, /SUPABASE|OPENAI_API_KEY|service_role/i);

console.log('ECOS private conversation comparison contract passed.');
