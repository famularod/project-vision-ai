#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function load(relativePath, mocks = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleUnderTest = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    specifier => mocks[specifier] || {},
    moduleUnderTest,
    moduleUnderTest.exports,
  );
  return { exports: moduleUnderTest.exports, source };
}

const learningModule = load('services/PIELearningEngine.ts');
const {
  buildPIELearning,
  isVerifiedLearningEvent,
  updateBeliefLearning,
  updatePatternLearning,
} = learningModule.exports;

const runtime = {
  generatedAt: '2026-07-16T12:00:00.000Z',
  overallConfidence: 'high',
  beliefChanges: [{ id: 'automatic-correction', direction: 'corrected', wasPIEWrong: true }],
  confidenceChanges: [{ id: 'gps', source: 'GPS', reason: 'Automatic GPS adjustment', updatedConfidence: 'high' }],
  lessonsLearned: [{ id: 'reflection', lesson: 'Automated reflection', confidence: 'high' }],
  scheduleSummary: { totalItems: 12 },
  photoProgress: { acceptedEvidence: [{ summary: 'A photo exists.' }] },
};

const unverified = buildPIELearning({
  runtime,
  reportDraft: { needsReview: false, reportReadiness: 'high', confidence: 'high' },
  predictionResult: { predictionConfidence: 'high' },
  patternIntelligence: { patternMatches: [{
    id: 'pattern-only',
    pattern: { summary: 'Automated similarity only' },
    explanation: 'A pattern resembles prior records but has no verified outcome.',
    confidence: 'high',
  }] },
});
assert.strictEqual(unverified.learningEvents.length, 0, 'draft readiness, confidence, patterns, schedules, and photos are not verified outcomes');
assert.strictEqual(unverified.learningSignals.length, 0);
assert.strictEqual(unverified.lessonsLearned.length, 0);
assert.strictEqual(unverified.memoryConsolidation.length, 0);
assert.strictEqual(unverified.confidence, 'low', 'no verified outcome means low learning confidence');
assert(unverified.confidenceCalibration.every(item => item.adjustment === 'hold'));

const verifiedPrediction = {
  id: 'verified-prediction-1',
  source: 'prediction_confirmed',
  event: 'The inspection passed on the forecast date.',
  outcome: 'confirmed',
  evidence: ['Inspection record 1442'],
  confidence: 'high',
  organizationId: 'org-1',
  projectId: 'project-1',
  verifiedAt: '2026-07-16T11:30:00.000Z',
  verifiedBy: 'manager-1',
  verificationStatus: 'human_validated',
  provenanceRecordIds: ['inspection:1442'],
};
assert.strictEqual(isVerifiedLearningEvent(verifiedPrediction), true);
const learned = buildPIELearning({
  runtime,
  organizationId: 'org-1',
  projectId: 'project-1',
  verifiedLearningEvents: [verifiedPrediction],
});
assert.strictEqual(learned.learningEvents.length, 1);
assert(learned.learningSignals.some(signal => signal.source === 'prediction_confirmed'));
assert(learned.confidenceCalibration.some(item => item.adjustment === 'raise'));

assert.strictEqual(isVerifiedLearningEvent({
  ...verifiedPrediction,
  provenanceRecordIds: [],
}), false, 'a claimed outcome without traceable records must be rejected');
assert.strictEqual(isVerifiedLearningEvent({
  ...verifiedPrediction,
  source: 'report_approval',
  outcome: 'confirmed',
}), false, 'source and outcome semantics must agree');
assert.strictEqual(isVerifiedLearningEvent({
  ...verifiedPrediction,
  verifiedBy: 'DAVE automation',
}), false, 'automation cannot impersonate a human verifier');
assert.strictEqual(buildPIELearning({
  runtime,
  organizationId: 'org-1',
  projectId: 'project-1',
  verifiedLearningEvents: [{ ...verifiedPrediction, projectId: 'project-2' }],
}).learningEvents.length, 0, 'verified events cannot cross project boundaries');

const beliefs = updateBeliefLearning({
  runtime,
  beliefSystem: {
    beliefs: [{
      id: 'ready-belief',
      statement: 'The report looks ready.',
      readiness: 'Ready',
      supportingEvidence: [],
      contradictingEvidence: [],
      explanation: { readinessReason: 'Automated readiness only.' },
      confidence: 'high',
    }],
  },
}, []);
assert.strictEqual(beliefs[0].confidenceChange, 'hold', 'readiness alone must never strengthen a belief');

const scopedBeliefs = updateBeliefLearning({
  runtime,
  beliefSystem: {
    beliefs: [
      {
        id: 'electrical-belief',
        statement: 'Electrical rough-in is complete.',
        readiness: 'Ready',
        supportingEvidence: [],
        contradictingEvidence: [],
        explanation: { readinessReason: 'Electrical evidence.' },
        confidence: 'high',
      },
      {
        id: 'concrete-belief',
        statement: 'Concrete placement is delayed.',
        readiness: 'Ready',
        supportingEvidence: [],
        contradictingEvidence: [],
        explanation: { readinessReason: 'Concrete evidence.' },
        confidence: 'high',
      },
    ],
  },
}, [{
  source: 'prediction_confirmed',
  outcome: 'confirmed',
  provenanceRecordIds: ['electrical-belief'],
}]);
assert.deepStrictEqual(
  scopedBeliefs.map(item => item.confidenceChange),
  ['increase', 'hold'],
  'verified learning must only change the specifically provenance-linked belief',
);

const scopedPatterns = updatePatternLearning({
  runtime,
  patternIntelligence: {
    patternMatches: [
      { id: 'electrical-match', pattern: { id: 'electrical-pattern', summary: 'Electrical', evidence: [] }, explanation: 'Electrical', confidence: 'high' },
      { id: 'concrete-match', pattern: { id: 'concrete-pattern', summary: 'Concrete', evidence: [] }, explanation: 'Concrete', confidence: 'high' },
    ],
  },
}, [{
  source: 'prediction_confirmed',
  outcome: 'confirmed',
  provenanceRecordIds: ['electrical-pattern'],
}]);
assert.deepStrictEqual(
  scopedPatterns.map(item => item.confidenceChange),
  ['increase', 'hold'],
  'verified learning must only change the specifically provenance-linked pattern',
);

for (const forbidden of [
  'Report draft was approved or ready without review flags.',
  "input.predictionResult?.predictionConfidence === 'high'",
  "input.predictionResult?.predictionConfidence === 'low'",
  "id: 'event-schedule-change'",
  "id: 'event-photo-evidence'",
]) {
  assert(!learningModule.source.includes(forbidden), `unsafe inferred-learning marker remains: ${forbidden}`);
}

const ledger = load('services/PIEDecisionLedger.ts');
const layer4 = load('services/PIELayer4Automation.ts', {
  './PIEDecisionLedger': ledger.exports,
  './PIEExecutiveJudgmentRepository': { requirePersistedExecutiveJudgment: value => value },
});
const { collectRelevantOutcomeEvidence } = layer4.exports;
const context = {
  projectId: 'project-a',
  selectedOption: 'Install AHU-7',
  selectedReason: 'Mechanical startup requirement',
  assumptions: [],
  risks: [],
  constraints: [],
  evidenceAvailable: [],
  predictedOutcomes: [{
    description: 'AHU-7 mechanical startup',
    measurableResult: 'Startup inspection passes',
    evidenceRequired: ['relevant-document'],
  }],
};
const evidence = [
  { id: 'unrelated-photo', sourceType: 'photo', organizationId: 'org-1', projectId: 'project-a', summary: 'Parking lot striping.' },
  { id: 'wrong-project', sourceType: 'project_update', organizationId: 'org-1', projectId: 'project-b', summary: 'AHU-7 installation complete.' },
  { id: 'wrong-organization', sourceType: 'document', organizationId: 'org-2', projectId: 'project-a', summary: 'AHU-7 mechanical startup inspection.' },
  { id: 'generic-token', sourceType: 'photo', organizationId: 'org-1', projectId: 'project-a', summary: 'Mechanical room housekeeping photo.' },
  { id: 'relevant-document', sourceType: 'document', organizationId: 'org-1', projectId: 'project-a', summary: 'AHU-7 installation inspection record.' },
];
const boundary = { organizationId: 'org-1', projectId: 'project-a' };
assert.deepStrictEqual(
  collectRelevantOutcomeEvidence(evidence, context, boundary).map(item => item.id),
  ['relevant-document'],
  'evidence must match both the project and decision context; source type alone is not relevance',
);
assert.strictEqual(
  collectRelevantOutcomeEvidence([evidence[0]], context, boundary).length,
  0,
  'no semantic match must return no evidence instead of falling back to every record',
);

const actor = {
  id: 'dave-system',
  name: 'DAVE',
  role: 'system',
  organizationId: 'org-1',
};
const lifecycleEvidence = {
  id: 'ahu-inspection',
  sourceType: 'document',
  organizationId: 'org-1',
  projectId: 'project-a',
  summary: 'AHU-7 mechanical startup inspection passed and completed.',
};
const predictedOutcome = ledger.exports.buildPredictedOutcome({
  id: 'prediction-ahu',
  description: 'AHU-7 mechanical startup',
  measurableResult: 'Startup inspection passes',
  expectedDirection: 'verify',
  expectedReviewDate: '2026-07-20T12:00:00.000Z',
  evidenceRequired: ['ahu-inspection'],
  responsibleOwner: 'Project manager',
  validationAuthority: 'Project manager',
  predictionConfidence: 'high',
  rationale: 'Startup is required before turnover.',
});
let decision = ledger.exports.createDecisionRecord({
  id: 'decision-ahu',
  organizationId: 'org-1',
  projectId: 'project-a',
  createdBy: actor,
  createdAt: '2026-07-16T12:00:00.000Z',
  snapshot: {
    projectId: 'project-a',
    situationId: 'situation-ahu',
    recommendationId: 'recommendation-ahu',
    selectedOption: 'Install AHU-7',
    decisionOwner: 'Project manager',
    decisionAuthority: 'Project manager',
    decisionDate: '2026-07-16T12:00:00.000Z',
    evidenceAvailable: [lifecycleEvidence],
    knownEvidenceGaps: [],
    assumptions: [],
    risks: [],
    constraints: [],
    predictedOutcomes: [predictedOutcome],
    recommendationConfidence: 'high',
    confidenceExplanation: 'Evidence-backed recommendation.',
    selectedReason: 'Mechanical startup is required.',
  },
});
decision = ledger.exports.transitionDecisionStatus({
  decision,
  nextStatus: 'approved',
  actor,
  reason: 'A human approved the decision.',
  source: 'user',
});
const implementationReview = layer4.exports.automateLayer4DecisionLifecycle({
  decision,
  actor,
  evidence: [lifecycleEvidence],
  now: '2026-07-17T12:00:00.000Z',
});
assert.strictEqual(implementationReview.decision.currentStatus, 'approved');
assert(
  implementationReview.exceptions.some(item => item.action === 'confirm_implementation'),
  'evidence cannot move an approved decision to implemented without explicit confirmation',
);
const observed = layer4.exports.comparePredictedAndActualOutcomesAutomatically(
  implementationReview.decision,
  [lifecycleEvidence],
  actor,
  '2026-07-18T12:00:00.000Z',
);
assert.strictEqual(observed.validationStatus, 'unvalidated', 'automatic comparison never validates itself');
const systemSupportedReview = layer4.exports.automateLayer4DecisionLifecycle({
  decision: {
    ...implementationReview.decision,
    currentStatus: 'outcome_validated',
    actualOutcomes: [{ ...observed, validationStatus: 'system_supported' }],
  },
  actor,
  evidence: [lifecycleEvidence],
  now: '2026-07-19T12:00:00.000Z',
});
assert.strictEqual(systemSupportedReview.decision.currentStatus, 'outcome_validated');
assert(systemSupportedReview.exceptions.some(item => item.id.includes('human-validation')));
const humanValidatedReview = layer4.exports.automateLayer4DecisionLifecycle({
  decision: {
    ...implementationReview.decision,
    currentStatus: 'outcome_validated',
    actualOutcomes: [{
      ...observed,
      validationStatus: 'human_validated',
      validator: { id: 'manager-1', name: 'Project manager', role: 'validation_authority', organizationId: 'org-1' },
      validationDate: '2026-07-19T11:00:00.000Z',
    }],
  },
  actor,
  evidence: [lifecycleEvidence],
  now: '2026-07-19T12:00:00.000Z',
});
assert.strictEqual(humanValidatedReview.decision.currentStatus, 'closed');

const coreSource = fs.readFileSync(path.join(root, 'services/PIECoreIntelligence.ts'), 'utf8');
assert(coreSource.includes('verifiedLearningEvents?: readonly PIEVerifiedLearningEvent[]'));
assert.strictEqual(
  (coreSource.match(/verifiedLearningEvents: input\.verifiedLearningEvents/g) || []).length,
  2,
  'Core must pass verified events through to both learning passes without synthesizing them',
);

console.log('DAVE learning-safety behavior tests passed.');
