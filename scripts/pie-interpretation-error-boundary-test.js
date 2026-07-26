#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('App.tsx');
const workflow = read('services/PIEPhotoVisionMobileWorkflow.ts');

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert(startIndex >= 0, `missing start marker ${start}`);
  assert(endIndex > startIndex, `missing end marker ${end}`);
  return source.slice(startIndex, endIndex);
}

const interpretationHelper = sliceBetween(
  app,
  'function possibleInterpretationsForPIEResult',
  'function buildSuggestedObservedNote',
);
assert(
  interpretationHelper.includes('pieResultSupportsInterpretations') &&
    interpretationHelper.includes("'analysis_failed_retry'") &&
    interpretationHelper.includes("'comparison_unavailable'") &&
    interpretationHelper.includes("'analyzing'") &&
    interpretationHelper.includes("'no_suitable_prior_photo'"),
  'Failure, unavailable, analyzing, and no-prior states must not feed possible interpretations.',
);

const preview = sliceBetween(app, 'function BuildUpdateScreen', 'function ReadOnlyUpdateDetailScreen');
assert(
  preview.includes('updateSupportsPIEInterpretations(update, pieStatus)') &&
    preview.includes("update.possibleInterpretations || []") &&
    preview.includes('Possible interpretations') &&
    preview.includes('onConfirmInterpretation') &&
    preview.includes('onDismissInterpretation'),
  'Preview must keep genuine interpretation confirm/dismiss behavior behind the completed-analysis guard.',
);

const resultApply = sliceBetween(
  app,
  'function applyPhotoIntelligenceResult',
  'async function retryPhotoAnalysis',
);
assert(
  resultApply.includes("summary.status === 'complete' ? update.possibleInterpretations || [] : []") &&
    resultApply.includes('possibleInterpretationsForPIEResult(result)'),
  'Failed analysis hydration must not keep stale stored failure text in possible interpretations.',
);

const unavailable = sliceBetween(workflow, 'function unavailableState', 'function failedRetryState');
const failed = sliceBetween(workflow, 'function failedRetryState', 'function describeVisibleChange');
assert(
  unavailable.includes('possibleConcerns: []') &&
    failed.includes('possibleConcerns: []') &&
    !unavailable.includes('possibleConcerns: [safeUnavailableReason(summary)]') &&
    !failed.includes('possibleConcerns: [safeUnavailableReason(summary)]'),
  'Unavailable and retry states must keep safe failure reasons out of interpretation-tier possibleConcerns.',
);

assert(
  unavailable.includes('safeUnavailableReason(summary)') &&
    failed.includes('safeUnavailableReason(summary)') &&
    workflow.includes('providerResponseStatus: safeUnavailableReason(summary)') &&
    workflow.includes('providerFailureReason: providerResponse.failureReason') &&
    workflow.includes('readPIEPhotoVisionProviderResponse(functionData)'),
  'Failure reasons must remain available through limitations and diagnostics.',
);

assert(
  workflow.includes('export function classifyPIEPhotoVisionFailureMessage') &&
    workflow.includes("return 'network'") &&
    workflow.includes("return 'auth'") &&
    workflow.includes("return 'provider_side'") &&
    workflow.includes("return 'malformed_response'") &&
    workflow.includes("return 'unknown'"),
  'Failure categorization must be a separately testable classifier.',
);

const classifier = sliceBetween(
  workflow,
  'export function classifyPIEPhotoVisionFailureMessage',
  'function timestampMs',
);
assert(
  classifier.indexOf('provider|openai|vision|model|secret|api key|upstream|function') <
    classifier.indexOf('network|fetch|timeout|offline|connection|unreachable|supabase'),
  'Provider-specific timeout/upstream failures must not be misclassified as device network failures.',
);
[
  ['network', 'network|fetch|timeout|offline|connection|unreachable|supabase'],
  ['auth', 'auth|jwt|token|permission|unauthorized|forbidden|401|403'],
  ['provider_side', 'provider|openai|vision|model|secret|api key|upstream|function'],
  ['malformed_response', 'stale|result|pair|same_evidence|same_asset|identical|empty|missing|file'],
].forEach(([category, pattern]) => {
  assert(
    classifier.includes(pattern) && classifier.includes(`return '${category}'`),
    `Classifier must map ${pattern} to ${category}.`,
  );
});

console.log('PIE interpretation error-boundary tests passed.');
