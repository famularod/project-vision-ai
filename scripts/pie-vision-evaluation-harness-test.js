#!/usr/bin/env node

const assert = require('assert');
const {
  evaluatePhotoVisionCase,
  labeledCases,
} = require('./pie-vision-evaluation-harness');

const crossAngleCase = {
  id: 'canopy-c-cross-angle',
  expected: {
    comparability: 'probable',
    sameGeneralScene: true,
    materialVisibleChange: true,
    changeType: 'object_added',
    addedObject: 'concrete ramp',
    progressConclusion: 'partial_progress_visible',
    confidence: 'medium_or_higher',
    maximumLatencyMs: 60_000,
  },
};
const passingResult = {
  comparabilityClassification: 'probable',
  sameSceneProbability: 0.88,
  conclusion: 'partial_progress_visible',
  confidence: 'high',
  objectAdditions: [{
    objectName: 'concrete ramp',
    description: 'A finished concrete ramp is visible beside the canopy support.',
    location: 'Canopy C',
  }],
  objectRemovals: [],
  materialOrStructuralChanges: [],
  latencyMs: 12_500,
};

assert.deepStrictEqual(labeledCases({ cases: [crossAngleCase] }), [crossAngleCase]);
assert.deepStrictEqual(labeledCases({ scenarios: [crossAngleCase] }), [crossAngleCase]);

const passed = evaluatePhotoVisionCase(crossAngleCase, passingResult);
assert.strictEqual(passed.status, 'passed');
assert.deepStrictEqual(passed.divergence, []);

const failed = evaluatePhotoVisionCase(crossAngleCase, {
  ...passingResult,
  comparabilityClassification: 'not_comparable',
  sameSceneProbability: 0.3,
  conclusion: 'unable_to_determine',
  confidence: 'low',
  objectAdditions: [],
});
assert.strictEqual(failed.status, 'failed');
assert(failed.divergence.some(item => item.includes('comparability expected probable')));
assert(failed.divergence.some(item => item.includes('same scene expected')));
assert(failed.divergence.some(item => item.includes('added object not found')));

const slow = evaluatePhotoVisionCase(crossAngleCase, {
  ...passingResult,
  latencyMs: 70_000,
});
assert.strictEqual(slow.status, 'failed');
assert(slow.divergence.some(item => item.includes('latency expected at most 60000ms')));

const noProgressCase = evaluatePhotoVisionCase({
  id: 'unscoped-object-change',
  expected: {
    progressConclusion: 'unable_to_determine',
    jarvisMustPreventProjectProgressConclusion: true,
  },
}, {
  conclusion: 'progress_visible',
});
assert.strictEqual(noProgressCase.status, 'failed');
assert(noProgressCase.divergence.some(item => item.includes('project progress was claimed')));

console.log('PASS PIE photo-vision evaluation harness');
