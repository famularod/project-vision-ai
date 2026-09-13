#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  QUALITY_FIRST_MODEL_SELECTION_POLICY,
  selectQualityFirstModel,
} = require('./ecos-agent-model-selection');

assert.equal(
  QUALITY_FIRST_MODEL_SELECTION_POLICY,
  'quality_then_cost_within_slo_then_latency/1.0',
);

const equalQuality = selectQualityFirstModel([
  score({
    model: 'gpt-5.6-terra',
    estimatedCostUsd: 0.09,
    p95LatencyMs: 12_000,
  }),
  score({
    model: 'gpt-5.6-luna',
    estimatedCostUsd: 0.01,
    p95LatencyMs: 24_000,
  }),
]);
assert.equal(equalQuality.selectedModel, 'gpt-5.6-luna');

const qualityOutranksCost = selectQualityFirstModel([
  score({
    model: 'gpt-5.6-luna',
    passRate: 0.9,
    estimatedCostUsd: 0.01,
  }),
  score({
    model: 'gpt-5.6-terra',
    estimatedCostUsd: 0.09,
  }),
]);
assert.equal(qualityOutranksCost.selectedModel, 'gpt-5.6-terra');

const eligibilityOutranksRawMetrics = selectQualityFirstModel([
  score({
    model: 'gpt-5.6-luna',
    eligibleForRecommendation: false,
    estimatedCostUsd: 0.01,
  }),
  score({
    model: 'gpt-5.6-terra',
    passRate: 0.99,
    estimatedCostUsd: 0.09,
  }),
]);
assert.equal(eligibilityOutranksRawMetrics.selectedModel, 'gpt-5.6-terra');

for (const runnerName of [
  'ecos-agent-private-conflict-comparison.js',
  'ecos-agent-private-model-comparison.js',
  'ecos-agent-private-progress-comparison.js',
  'ecos-agent-private-schedule-comparison.js',
  'ecos-agent-private-source-discovery-comparison.js',
]) {
  const runner = fs.readFileSync(path.join(__dirname, runnerName), 'utf8');
  assert.match(runner, /compareQualityFirstModelScores/);
  assert.doesNotMatch(runner, /function compare(?:Model)?Scores/);
}

function score(overrides) {
  return {
    model: 'gpt-5.6-terra',
    eligibleForRecommendation: true,
    passRate: 1,
    citationRate: 1,
    isolationRate: 1,
    repeatabilityRate: 1,
    estimatedCostUsd: 0.1,
    p95LatencyMs: 20_000,
    meanLatencyMs: 15_000,
    meanToolCalls: 2,
    ...overrides,
  };
}

console.log('ECOS quality-first, cost-second model selection contract passed.');
