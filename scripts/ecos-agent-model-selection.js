#!/usr/bin/env node

const QUALITY_FIRST_MODEL_SELECTION_POLICY =
  'quality_then_cost_within_slo_then_latency/1.0';

const QUALITY_FIELDS = Object.freeze([
  'passRate',
  'correctnessRate',
  'citationRate',
  'citationOpenabilityRate',
  'safeRefusalRate',
  'safeRefusalPassRate',
  'isolationRate',
  'projectIsolationRate',
  'repeatabilityRate',
  'proofRepeatabilityRate',
  'exactRegionRepeatabilityRate',
  'assuranceStatusRepeatabilityRate',
]);

function compareQualityFirstModelScores(left, right) {
  const eligibilityDifference = Number(right.eligibleForRecommendation) -
    Number(left.eligibleForRecommendation);
  if (eligibilityDifference) return eligibilityDifference;

  for (const field of QUALITY_FIELDS) {
    if (!(field in left) && !(field in right)) continue;
    const qualityDifference = finiteOrZero(right[field]) -
      finiteOrZero(left[field]);
    if (qualityDifference) return qualityDifference;
  }

  const costDifference = finiteOrInfinity(left.estimatedCostUsd) -
    finiteOrInfinity(right.estimatedCostUsd);
  if (costDifference) return costDifference;

  const p95Difference = finiteOrInfinity(left.p95LatencyMs) -
    finiteOrInfinity(right.p95LatencyMs);
  if (p95Difference) return p95Difference;

  const meanLatencyDifference = meanLatency(left) - meanLatency(right);
  if (meanLatencyDifference) return meanLatencyDifference;

  const toolDifference = finiteOrInfinity(left.meanToolCalls) -
    finiteOrInfinity(right.meanToolCalls);
  if (toolDifference) return toolDifference;

  return String(left.model || '').localeCompare(String(right.model || ''));
}

function selectQualityFirstModel(scores) {
  const rankedScores = [...scores].sort(compareQualityFirstModelScores);
  return {
    policy: QUALITY_FIRST_MODEL_SELECTION_POLICY,
    rankedScores,
    selectedModel: rankedScores.find((score) =>
      score.eligibleForRecommendation
    )?.model || null,
  };
}

function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function finiteOrInfinity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.POSITIVE_INFINITY;
}

function meanLatency(score) {
  const value = score.meanLatencyMs ?? score.meanElapsedMs;
  return finiteOrInfinity(value);
}

module.exports = {
  QUALITY_FIRST_MODEL_SELECTION_POLICY,
  compareQualityFirstModelScores,
  selectQualityFirstModel,
};
