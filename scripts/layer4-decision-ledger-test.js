#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const servicePath = path.join(rootDir, 'services/PIEDecisionLedger.ts');
const source = fs.readFileSync(servicePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    strict: true,
  },
});
const sandbox = {
  exports: {},
  require,
  console,
  Date,
  Object,
  JSON,
  RegExp,
  Set,
  String,
  Number,
  Boolean,
  Error,
};
vm.runInNewContext(compiled.outputText, sandbox, { filename: servicePath });
const ledger = sandbox.exports;

const actor = {
  id: 'owner-1',
  name: 'Owner One',
  role: 'decision_owner',
  organizationId: 'org-1',
  authorizedPermissions: [
    'view_decision_history',
    'create_decision_snapshot',
    'approve_decision',
    'reject_decision',
    'defer_decision',
    'implement_decision',
    'cancel_decision',
    'record_outcome_plan',
    'record_implementation_assessment',
    'record_outcome',
    'close_decision',
    'append_decision_version',
  ],
  identitySource: 'supabase_auth',
  cloudTrusted: true,
};
const validator = {
  id: 'validator-1',
  name: 'Validator One',
  role: 'validation_authority',
  organizationId: 'org-1',
  authorizedPermissions: [
    'view_decision_history',
    'record_outcome',
    'validate_outcome',
    'dispute_outcome',
    'close_decision',
    'append_decision_version',
  ],
  identitySource: 'supabase_auth',
  cloudTrusted: true,
};
const outsider = {
  id: 'outsider',
  name: 'Outsider',
  role: 'validation_authority',
  organizationId: 'org-2',
  authorizedPermissions: [
    'view_decision_history',
    'record_outcome',
    'validate_outcome',
    'dispute_outcome',
    'close_decision',
    'append_decision_version',
  ],
  identitySource: 'supabase_auth',
  cloudTrusted: true,
};
const evidence = {
  id: 'photo-1',
  sourceType: 'photo',
  organizationId: 'org-1',
  projectId: 'project-1',
  summary: 'Current progress photo',
  capturedAt: '2026-07-01T12:00:00.000Z',
};
const prediction = ledger.buildPredictedOutcome({
  id: 'prediction-1',
  description: 'Area is ready for inspection',
  measurableResult: 'Inspection readiness verified',
  baseline: 'Needs verification',
  targetValue: 'Ready',
  expectedDirection: 'verify',
  expectedReviewDate: '2026-07-08T12:00:00.000Z',
  evidenceRequired: ['Current photo', 'Owner confirmation'],
  responsibleOwner: 'Owner One',
  validationAuthority: 'Validator One',
  predictionConfidence: 'medium',
  rationale: 'Schedule and photo evidence indicate readiness can be verified.',
});

function makeDecision() {
  return ledger.createDecisionRecord({
    id: 'decision-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    createdBy: actor,
    createdAt: '2026-07-01T12:00:00.000Z',
    snapshot: {
      projectId: 'project-1',
      situationId: 'situation-1',
      issueId: 'issue-1',
      recommendationId: 'recommendation-1',
      selectedOption: 'Verify inspection readiness',
      decisionStatus: 'proposed',
      decisionOwner: 'Owner One',
      decisionAuthority: 'Validator One',
      decisionDate: '2026-07-01T12:00:00.000Z',
      evidenceAvailable: [evidence],
      knownEvidenceGaps: ['Need owner confirmation'],
      assumptions: ['Photo reflects current condition'],
      risks: ['Inspection may fail if readiness is overstated'],
      constraints: ['No unsupported escalation'],
      predictedOutcomes: [prediction],
      recommendationConfidence: 'medium',
      confidenceExplanation: 'Confidence is medium because current evidence exists but owner confirmation is still needed.',
      selectedReason: 'This option reduces inspection uncertainty before communication.',
    },
  });
}

function expectThrow(fn, pattern) {
  assert.throws(fn, pattern);
}

let decision = makeDecision();
assert(Object.isFrozen(decision.immutableSnapshot), 'immutable snapshot should be frozen');
const originalEvidenceSummary = decision.immutableSnapshot.evidenceAvailable[0].summary;
decision = ledger.appendDecisionSnapshotVersion(
  decision,
  {
    ...decision.immutableSnapshot,
    evidenceAvailable: [{
      ...evidence,
      id: 'photo-2',
      summary: 'Later photo that must not rewrite history',
    }],
  },
  actor,
  'Later evidence creates a new version.',
  '2026-07-02T12:00:00.000Z',
);
assert.strictEqual(decision.immutableSnapshot.evidenceAvailable[0].summary, originalEvidenceSummary);
assert.strictEqual(decision.versions.length, 2);

expectThrow(
  () => ledger.transitionDecisionStatus({
    decision,
    nextStatus: 'closed',
    actor,
    reason: 'Action item completed.',
    source: 'user',
  }),
  /Invalid transition|cannot close/i,
);

decision = ledger.transitionDecisionStatus({
  decision,
  nextStatus: 'approved',
  actor,
  reason: 'Approved for implementation.',
  source: 'user',
});
expectThrow(
  () => ledger.transitionDecisionStatus({
    decision,
    nextStatus: 'implemented',
    actor,
    reason: 'Implemented without plan.',
    source: 'user',
  }),
  /outcome plan/i,
);

const plan = ledger.buildOutcomePlan({
  id: 'plan-1',
  checks: ['Check inspection readiness'],
  reviewDate: '2026-07-08T12:00:00.000Z',
  responsibleOwner: 'Owner One',
  acceptedEvidence: ['Current photo', 'Owner confirmation'],
  evidenceReferences: [evidence],
  validationAuthority: 'Validator One',
});
const assessment = ledger.buildImplementationAssessment({
  id: 'assessment-1',
  quality: 'partial_fidelity',
  approvedScopeImplemented: false,
  materialDeviations: ['Owner confirmation was omitted'],
  omittedControls: ['Validation before communication'],
  timingDeviations: [],
  externalFactors: ['Inspection schedule moved'],
  supportingEvidence: [evidence],
  assessedBy: actor,
});
decision = ledger.transitionDecisionStatus({
  decision,
  nextStatus: 'implemented',
  actor,
  reason: 'Implemented with plan.',
  source: 'user',
  outcomePlan: plan,
  implementationAssessment: assessment,
});
assert.strictEqual(ledger.decisionAwaitingOutcomeReview(decision), true);
assert.strictEqual(decision.implementationAssessment.quality, 'partial_fidelity');

const outcome = ledger.buildActualOutcomeRecord({
  id: 'outcome-1',
  decisionId: decision.id,
  organizationId: 'org-1',
  projectId: 'project-1',
  classification: 'mixed',
  summary: 'Readiness was partly verified, but owner confirmation was still missing.',
  actualResults: ['Inspection readiness verified partially'],
  measuredValues: { 'prediction-1': 'Partial' },
  predictedOutcomes: decision.immutableSnapshot.predictedOutcomes,
  evidenceReferences: [evidence],
  unintendedConsequences: ['Follow-up required'],
  confoundingFactors: ['Owner unavailable'],
  observationPeriod: {
    startedAt: '2026-07-01T12:00:00.000Z',
    endedAt: '2026-07-08T12:00:00.000Z',
  },
  validationStatus: 'unvalidated',
  validator: null,
  validationDate: null,
  createdBy: actor,
});
assert.strictEqual(outcome.predictionComparisons[0].predictedOutcomeId, 'prediction-1');
decision = ledger.transitionDecisionStatus({
  decision,
  nextStatus: 'outcome_observed',
  actor,
  reason: 'Outcome observed.',
  source: 'user',
  actualOutcome: outcome,
});
assert.strictEqual(decision.actualOutcomes.length, 1);

expectThrow(
  () => ledger.updateLatestOutcomeValidation(
    decision,
    'human_validated',
    { ...validator, authorizedPermissions: [] },
    'Same-organization user without permission cannot validate.',
  ),
  /permission denied/i,
);

expectThrow(
  () => ledger.updateLatestOutcomeValidation(
    decision,
    'human_validated',
    outsider,
    'Outsider cannot validate.',
  ),
  /organization|validator/i,
);

decision = ledger.updateLatestOutcomeValidation(
  decision,
  'disputed',
  validator,
  'Validation authority disputed the result.',
  [evidence],
);
assert.strictEqual(decision.actualOutcomes[0].validationStatus, 'unvalidated');
assert.strictEqual(decision.actualOutcomes[1].validationStatus, 'disputed');
assert.notStrictEqual(decision.actualOutcomes[0].id, decision.actualOutcomes[1].id);
expectThrow(
  () => ledger.transitionDecisionStatus({
    decision,
    nextStatus: 'closed',
    actor,
    reason: 'Try closing disputed outcome.',
    source: 'user',
  }),
  /Invalid transition|not validated|cannot close/i,
);

decision = ledger.updateLatestOutcomeValidation(
  decision,
  'human_validated',
  validator,
  'Validation authority confirmed the result.',
  [evidence],
);
assert.strictEqual(decision.currentStatus, 'outcome_validated');
assert.strictEqual(decision.actualOutcomes[2].validationStatus, 'human_validated');
decision = ledger.transitionDecisionStatus({
  decision,
  nextStatus: 'closed',
  actor,
  reason: 'Closed after validated outcome.',
  source: 'user',
});
assert.strictEqual(decision.currentStatus, 'closed');
assert(decision.auditHistory.length >= 7, 'audit history should record changes');

expectThrow(
  () => ledger.createDecisionRecord({
    organizationId: 'org-1',
    projectId: 'project-1',
    createdBy: actor,
    snapshot: {
      ...makeDecision().immutableSnapshot,
      confidenceExplanation: '',
    },
  }),
  /confidence/i,
);

expectThrow(
  () => ledger.createDecisionRecord({
    organizationId: 'org-1',
    projectId: 'project-1',
    createdBy: actor,
    snapshot: {
      ...makeDecision().immutableSnapshot,
      evidenceAvailable: [{
        ...evidence,
        organizationId: 'org-2',
      }],
    },
  }),
  /another organization/i,
);

console.log('Layer 4 decision ledger tests passed.');
