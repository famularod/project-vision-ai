#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');

function loadTs(relativePath, mocks = {}) {
  const fullPath = path.join(rootDir, relativePath);
  const source = fs.readFileSync(fullPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      strict: true,
      esModuleInterop: true,
    },
  });
  const sandbox = {
    exports: {},
    require: specifier => {
      if (specifier in mocks) return mocks[specifier];
      return require(specifier);
    },
    console,
    Date,
    Object,
    JSON,
    RegExp,
    Set,
    Map,
    String,
    Number,
    Boolean,
    Error,
    Array,
  };
  vm.runInNewContext(compiled.outputText, sandbox, { filename: fullPath });
  return sandbox.exports;
}

const ledger = loadTs('services/PIEDecisionLedger.ts');
const automation = loadTs('services/PIELayer4Automation.ts', {
  './PIEDecisionLedger': ledger,
  './PIEExecutiveJudgmentRepository': {
    requirePersistedExecutiveJudgment: record => record,
  },
});

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
  summary: 'Electrical rough-in completed and verified ready for inspection.',
  capturedAt: '2026-07-01T12:00:00.000Z',
  versionId: 'v1',
  contentHash: 'h1',
};

const updateEvidence = {
  id: 'update-1',
  sourceType: 'project_update',
  organizationId: 'org-1',
  projectId: 'project-1',
  summary: 'Owner confirmed electrical rough-in completed.',
  capturedAt: '2026-07-01T12:00:00.000Z',
  versionId: 'v1',
  contentHash: 'h2',
};

const conflictEvidence = {
  ...evidence,
  id: 'photo-conflict',
  summary: 'Conflicting evidence says the work is blocked and unsafe.',
};

const crossOrgEvidence = {
  ...evidence,
  organizationId: 'org-2',
};

function makeReport(overrides = {}) {
  return {
    id: overrides.id || 'report-1',
    reportType: 'daily_project_update',
    audience: 'internal_team',
    title: 'Project Update',
    subject: 'Project Update',
    body: overrides.body || 'Electrical rough-in needs owner approval and inspection readiness verification.',
    openingLine: 'Please review the updates below.',
    closingLine: 'Please let me know if you have any questions.',
    executiveSummary: overrides.executiveSummary || ['Approve electrical rough-in verification before inspection.'],
    sections: [],
    locationGroups: [],
    actionItems: overrides.actionItems || [{
      id: 'action-1',
      owner: 'Owner One',
      action: 'Verify electrical rough-in readiness',
      projectName: 'Project 1',
      areaName: 'Canopy B',
      needsOwner: false,
      sourceEvidenceIds: ['photo-1'],
    }],
    imageReferences: [],
    risks: overrides.risks || [],
    decisionsNeeded: overrides.decisionsNeeded || [],
    confidence: overrides.confidence || 'high',
    reportReadiness: overrides.reportReadiness || 'high',
    needsReview: overrides.needsReview || false,
    reviewFlags: overrides.reviewFlags || [],
    sourceEvidence: [],
    constructionUnderstanding: {
      locationGroups: [],
      workAreas: [],
      executiveSummaryBullets: [],
      reviewFlags: [],
    },
    generatedAt: '2026-07-01T12:00:00.000Z',
  };
}

const report = makeReport();
assert.throws(
  () => automation.buildLayer4DecisionCandidate({
    report,
    existingDecisions: [],
    organizationId: 'org-1',
    projectId: 'project-1',
    actor,
    evidence: [evidence, updateEvidence],
    now: '2026-07-01T12:00:00.000Z',
  }),
  /report-only input/i,
  'live Layer 4 candidate creation should reject report-only input',
);
const candidate = automation.buildDeprecatedReportOnlyLayer4DecisionCandidate({
  report,
  existingDecisions: [],
  organizationId: 'org-1',
  projectId: 'project-1',
  actor,
  evidence: [evidence, updateEvidence],
  now: '2026-07-01T12:00:00.000Z',
});
assert.strictEqual(candidate.created, true, 'meaningful recommendation should create candidate');
assert(candidate.decision.immutableSnapshot.predictedOutcomes.length > 0, 'predicted outcomes should be generated');
assert(candidate.decision.immutableSnapshot.evidenceAvailable.length >= 2, 'available evidence should be linked automatically');

const ordinaryNote = automation.buildDeprecatedReportOnlyLayer4DecisionCandidate({
  report: makeReport({
    id: 'note-1',
    body: 'General informational summary only.',
    executiveSummary: ['Informational summary.'],
    actionItems: [],
    decisionsNeeded: [],
    risks: [],
    confidence: 'medium',
  }),
  existingDecisions: [],
  organizationId: 'org-1',
  projectId: 'project-1',
  actor,
  evidence: [evidence],
});
assert.strictEqual(ordinaryNote.created, false, 'ordinary notes should not create decisions');

const duplicate = automation.buildDeprecatedReportOnlyLayer4DecisionCandidate({
  report,
  existingDecisions: [candidate.decision],
  organizationId: 'org-1',
  projectId: 'project-1',
  actor,
  evidence: [evidence],
});
assert.strictEqual(duplicate.created, false, 'duplicate decisions should not be created');
assert.strictEqual(duplicate.duplicateDecisionId, candidate.decision.id);

assert.throws(
  () => automation.buildDeprecatedReportOnlyLayer4DecisionCandidate({
    report,
    existingDecisions: [],
    organizationId: 'org-1',
    projectId: 'project-1',
    actor,
    evidence: [crossOrgEvidence],
  }),
  /another organization/i,
  'cross-organization evidence cannot trigger automation',
);

let approved = ledger.transitionDecisionStatus({
  decision: candidate.decision,
  nextStatus: 'approved',
  actor,
  reason: 'Human approved the decision.',
  source: 'user',
});
const automated = automation.automateLayer4DecisionLifecycle({
  decision: approved,
  actor,
  evidence: [evidence, updateEvidence],
  now: '2026-07-02T12:00:00.000Z',
});
assert(automated.decision.outcomePlan, 'outcome plan should be generated automatically');
assert(
  ['awaiting_outcome', 'outcome_observed', 'outcome_validated', 'closed'].includes(automated.decision.currentStatus),
  'routine lifecycle transitions should occur from verified evidence',
);
assert(automated.automaticActions.length >= 2, 'automatic actions should be recorded');
assert(
  automated.decision.auditHistory.some(event => event.source === 'system' || event.automation),
  'automatic actions should create audit records',
);

const highImpactReport = makeReport({
  id: 'report-safety',
  risks: [{
    id: 'risk-1',
    projectName: 'Project 1',
    areaName: 'Canopy B',
    summary: 'Safety compliance response may affect inspection authority.',
    severity: 'high',
    sourceEvidenceIds: ['photo-1'],
  }],
});
let highImpact = automation.buildDeprecatedReportOnlyLayer4DecisionCandidate({
  report: highImpactReport,
  existingDecisions: [],
  organizationId: 'org-1',
  projectId: 'project-1',
  actor,
  evidence: [evidence],
  now: '2026-07-01T12:00:00.000Z',
}).decision;
highImpact = ledger.transitionDecisionStatus({
  decision: highImpact,
  nextStatus: 'approved',
  actor,
  reason: 'Human approved high-impact decision.',
  source: 'user',
});
const highImpactAutomation = automation.automateLayer4DecisionLifecycle({
  decision: highImpact,
  actor,
  evidence: [evidence],
});
assert.strictEqual(highImpactAutomation.decision.currentStatus, 'approved');
assert(highImpactAutomation.exceptions.some(item => item.action === 'approve'), 'high-impact transitions require human approval');

const weakEvidenceReview = automation.automateLayer4DecisionLifecycle({
  decision: approved,
  actor,
  evidence: [],
});
assert.notStrictEqual(weakEvidenceReview.decision.currentStatus, 'closed', 'weak evidence must not trigger closure');

const conflictReview = automation.automateLayer4DecisionLifecycle({
  decision: approved,
  actor,
  evidence: [conflictEvidence],
});
assert(conflictReview.exceptions.some(item => item.action === 'resolve_conflict'), 'conflicting evidence creates an exception');

const fidelity = automation.proposeImplementationQualityFromEvidence(approved, [evidence, updateEvidence]);
assert(['high_fidelity', 'implemented_as_designed', 'partial_fidelity'].includes(fidelity.quality), 'implementation fidelity should be proposed from evidence');

const actual = automation.comparePredictedAndActualOutcomesAutomatically(
  automated.decision,
  [evidence, updateEvidence],
  actor,
);
assert(actual.predictionComparisons.length > 0, 'predicted and actual outcomes should be compared automatically');

const corrected = ledger.appendDecisionSnapshotVersion(
  automated.decision,
  {
    ...automated.decision.immutableSnapshot,
    knownEvidenceGaps: ['Wrong owner corrected by user.'],
  },
  actor,
  'Wrong owner.',
);
assert.strictEqual(corrected.versions.length, automated.decision.versions.length + 1);
assert.notDeepStrictEqual(corrected.versions[0].snapshot.knownEvidenceGaps, corrected.versions[corrected.versions.length - 1].snapshot.knownEvidenceGaps);

const policy = automation.classifyLayer4AutomationPolicy({
  confidence: 'low',
  evidenceSufficient: true,
  reversible: true,
  impact: 'low',
  authorityRequired: false,
  evidenceConflicts: false,
});
assert.strictEqual(policy.level, 'human_decision_required', 'low-confidence automation is blocked');

const uiSource = fs.readFileSync(path.join(rootDir, 'screens/ReportsScreen.tsx'), 'utf8');
assert(!uiSource.includes('Record Decision Snapshot'), 'normal UI should not require routine snapshot management');
assert(!uiSource.includes('Record Implementation Quality'), 'normal UI should not require routine implementation status management');
assert(!uiSource.includes('Record Actual Outcome'), 'normal UI should not require routine outcome recording');
assert(!uiSource.includes('Close Decision'), 'normal UI should not require routine closeout management');

console.log('Layer 4 automation tests passed.');
