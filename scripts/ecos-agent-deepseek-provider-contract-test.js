#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const bridge = read(
  'supabase',
  'functions',
  'ecos-agent-deepseek-model-bridge',
  'index.ts',
);
const providerBridge = read(
  'supabase',
  'functions',
  'ecos-agent-model-bridge',
  'index.ts',
);
const candidate = read(
  'supabase',
  'functions',
  'ecos-ask-project-candidate',
  'index.ts',
);
const dockerfile = read(
  'workers',
  'ecos-agent-query-runtime',
  'Dockerfile',
);
const evaluation = read(
  'supabase',
  'functions',
  '_shared',
  'ecos-agent-model-evaluation.ts',
);

assert.match(providerBridge, /https:\/\/api\.deepseek\.com\/responses/);
assert.match(providerBridge, /models: new Set\(\["deepseek-v4-flash"\]\)/);
assert.match(providerBridge, /reasoningEfforts: new Set\(\["none"\]\)/);
assert.match(bridge, /required\("DEEPSEEK_API_KEY"\)/);
assert.doesNotMatch(bridge, /Deno\.env\.get\("DEEPSEEK_API_KEY"\).*fetch/);
assert.match(candidate, /ECOS_AGENT_DEEPSEEK_MODEL_BRIDGE_URL/);
assert.match(candidate, /bridgeRequired: deepSeekEvaluation/);
assert.match(candidate, /reasoningEffort: deepSeekEvaluation \? "none" : "medium"/);
assert.match(candidate, /validateOutputText:/);
assert.match(candidate, /isECOSProposedAnswerSchemaValue\(parsed\)/);
assert.match(candidate, /normalizeProposedAnswer\(parsed\)/);
assert.match(dockerfile, /ECOS_AGENT_DEEPSEEK_MODEL_BRIDGE_URL/);
assert.match(evaluation, /model: "deepseek-v4-flash"/);
assert.match(evaluation, /pricingVerifiedOn: "2026-09-11"/);
assert.doesNotMatch(candidate, /DEEPSEEK_API_KEY/);
assert.doesNotMatch(dockerfile, /DEEPSEEK_API_KEY/);

console.log('ECOS private DeepSeek provider contract passed.');
