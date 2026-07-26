#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const moduleCache = new Map();

function loadTs(relativePath) {
  const normalized = relativePath.endsWith('.ts') ? relativePath : `${relativePath}.ts`;
  const fullPath = path.join(rootDir, normalized);
  if (moduleCache.has(fullPath)) return moduleCache.get(fullPath);
  const source = fs.readFileSync(fullPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const sandbox = {
    exports: {},
    require: specifier => {
      if (specifier.startsWith('.')) {
        return loadTs(path.join(path.dirname(normalized), specifier));
      }
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
    Math,
    Array,
  };
  vm.runInNewContext(compiled.outputText, sandbox, { filename: fullPath });
  moduleCache.set(fullPath, sandbox.exports);
  return sandbox.exports;
}

const reality = loadTs('services/PIERealityModel.ts');
const simulation = loadTs('services/PIEDecisionSimulation.ts');
const challenge = loadTs('services/PIERecommendationChallenge.ts');
const jarvis = loadTs('services/PIEJarvisReasoningValidation.ts');
const confidence = loadTs('services/PIEConfidenceDecomposition.ts');
const evidenceValue = loadTs('services/PIEEvidenceValuePrioritization.ts');
const predictive = loadTs('services/PIEPredictiveReality.ts');

const mode = process.argv[2] || 'all';

function sampleRealityModel(overrides = {}) {
  const model = reality.buildPIERealityModel({
    organizationId: 'org-decision',
    projectId: 'project-2375',
    generatedAt: '2026-07-02T12:00:00.000Z',
    sourceEvidenceCutoffAt: '2026-07-02T12:00:00.000Z',
    objects: [
      {
        id: 'obj-canopy-b',
        organizationId: 'org-decision',
        projectId: 'project-2375',
        type: 'area',
        name: 'Canopy B electrical rough-in',
        projectName: 'Building 2375',
        areaName: 'Canopy B',
        summary: 'Electrical rough-in is due tomorrow and needs verification.',
        status: 'at_risk',
        confidence: 'high',
        evidenceType: 'schedule',
        evidenceId: 'schedule-rough-in',
        classification: 'fact',
        updatedAt: '2026-07-02T12:00:00.000Z',
      },
      {
        id: 'obj-photo-canopy-b',
        organizationId: 'org-decision',
        projectId: 'project-2375',
        type: 'photo',
        name: 'Canopy B current photo',
        projectName: 'Building 2375',
        areaName: 'Canopy B',
        summary: 'Photo shows current electrical area condition.',
        status: 'needs_verification',
        confidence: 'medium',
        evidenceType: 'photo',
        evidenceId: 'photo-canopy-b',
        classification: 'fact',
        updatedAt: '2026-07-02T12:10:00.000Z',
      },
    ],
  });
  return {
    ...model,
    ...overrides,
  };
}

function sampleJudgment(model = sampleRealityModel(), overrides = {}) {
  const action = {
    id: 'action-verify-canopy-b',
    type: 'verify',
    action: 'Verify Canopy B electrical rough-in before inspection.',
    why: 'Electrical rough-in is due tomorrow and current readiness needs confirmation.',
    expectedOutcome: 'Inspection readiness is verified or the blocker is identified early.',
    successMeasure: 'Current photo and note confirm whether rough-in is ready for inspection.',
    score: {
      valueCreated: 8,
      riskReduced: 8,
      uncertaintyReduced: 7,
      scheduleImpact: 8,
      safetyImpact: 7,
      qualityImpact: 7,
      communicationImpact: 6,
      effortRequired: 3,
      urgency: 8,
      reversibility: 8,
      confidenceReadiness: 7,
      downstreamEffect: 7,
      total: 82,
      readiness: 'Ready',
      readinessReason: 'Evidence is strong enough to verify in the field.',
    },
    governance: {
      recommendation: 'Verify Canopy B electrical rough-in before inspection.',
      why: 'This protects inspection readiness with low effort.',
      supportingEvidence: ['schedule-rough-in', 'photo-canopy-b'],
      assumptions: ['Inspection is still scheduled tomorrow.'],
      uncertainty: ['Owner confirmation may still be needed.'],
      alternativesConsidered: ['Monitor only', 'Escalate now'],
      whyAlternativesLost: ['Monitoring does not reduce inspection uncertainty.', 'Escalation is premature before verification.'],
      tradeoffs: [],
      expectedOutcome: 'Verification reduces uncertainty before inspection.',
      successMeasure: 'Photo and note support ready/not-ready status.',
      whatWouldChangeRecommendation: ['Inspection date moves', 'Current photo contradicts schedule.'],
    },
    confidence: 'high',
  };

  return {
    generatedAt: '2026-07-02T12:00:00.000Z',
    authority: {
      organizationId: model.organizationId,
      projectId: model.projectId,
      realityModelId: `reality-model-${model.organizationId}-${model.projectId}`,
      realityModelVersion: model.version,
      realitySnapshotId: `reality-snapshot-${model.organizationId}-${model.projectId}-v${model.version}`,
      evidenceCutoffTime: model.sourceEvidenceCutoffAt,
      activeConflictIds: model.evidenceConflicts.map(item => item.id),
      activeUncertaintyIds: model.activeUncertainties.map(item => item.id),
      persistenceStatus: 'authoritative_local',
    },
    executiveJudgment: {
      highestValueAction: action,
      whatMattersMost: 'Inspection readiness at Canopy B.',
      decisionNeeded: 'Confirm whether rough-in is ready.',
      greatestValue: 'Avoid failed inspection or late escalation.',
      riskReduction: 'Reduces inspection readiness risk.',
      uncertaintyReduction: 'Current evidence confirms readiness.',
      whatCanWait: 'Broad report edits can wait.',
      whatShouldEscalate: 'Escalate only if verification finds a blocker.',
      whatShouldNotEscalate: 'Do not escalate low-confidence concerns before verification.',
      bestActionIfEvidenceIncomplete: 'Collect one current photo and note.',
      whenNoActionIsCorrect: 'No action is correct only if readiness is already verified.',
      readiness: 'Ready',
      explanation: {
        summary: 'Verify the area before inspection.',
        whatMattersMost: 'Inspection readiness.',
        decisionNeeded: 'Confirm readiness.',
        greatestValue: 'Avoid inspection failure.',
        uncertaintyReduction: 'Photo and note reduce uncertainty.',
        riskReduction: 'Reduces schedule risk.',
        whatCanWait: 'Non-critical communication.',
        whatShouldEscalate: 'Only verified blocker.',
        whatShouldNotEscalate: 'Unverified issue.',
        incompleteEvidenceAction: 'Collect current photo.',
        noActionRationale: 'Monitor only if readiness is already verified.',
      },
    },
    highestValueAction: action,
    executiveDecisions: [{
      id: 'decision-1',
      decision: 'Confirm rough-in readiness.',
      whyNow: 'Inspection is approaching.',
      owner: 'Project team',
      options: ['verify', 'monitor', 'escalate'],
      readiness: 'Ready',
      confidence: 'high',
    }],
    executivePriorities: [],
    executiveRisks: [{
      id: 'risk-inspection',
      risk: 'Inspection readiness could be wrong.',
      whyItMatters: 'A failed inspection can affect schedule.',
      severity: 'high',
      shouldEscalate: false,
      confidence: 'high',
    }],
    executiveOpportunities: [],
    executiveConstraints: [{
      id: 'constraint-inspection',
      constraint: 'Inspection schedule',
      limits: 'Work must be verified before inspection.',
      actionRequired: 'Verify current status.',
      confidence: 'high',
    }],
    executiveTradeoffs: [],
    tradeoffAnalysis: {
      summary: 'Verify beats monitor and premature escalation.',
      dimensions: ['evidence_vs_time', 'escalation_vs_local_resolution'],
      options: [
        { id: 'tradeoff-verify', label: action.action, actionType: 'verify', gains: ['Reduces uncertainty'], losses: ['Requires a short walk'], uncertaintyReduction: 8, projectGoalProtection: 8, totalOutcomeScore: 82, unnecessaryNoiseRisk: 2 },
        { id: 'tradeoff-monitor', label: 'Monitor only', actionType: 'monitor', gains: ['No disruption'], losses: ['Leaves inspection uncertainty'], uncertaintyReduction: 2, projectGoalProtection: 3, totalOutcomeScore: 45, unnecessaryNoiseRisk: 1 },
      ],
      preferredOption: null,
      bestTotalOutcome: action.action,
      uncertaintyEfficientOption: action.action,
      projectGoalProtectedBy: action.action,
      leastNoisyOption: 'Monitor only',
      explanation: 'Verification reduces uncertainty without unnecessary escalation.',
    },
    escalationAnalysis: {
      shouldEscalate: false,
      timing: 'after_verification',
      target: { role: 'Project authority', reason: 'Escalate if blocker is verified.', ask: 'Approve recovery action if verification finds a blocker.' },
      triggers: [],
      evidenceStrongEnough: true,
      justification: 'Do not escalate until verification confirms a blocker.',
      evidenceRequiredBeforeEscalation: ['Current photo and status note.'],
      escalationRisk: 'Premature escalation may create noise.',
      localResolutionFirst: true,
    },
    opportunityCost: {
      chosenAction: action.action,
      alternativesDelayed: ['Monitor only'],
      costOfActingNow: 'Short field verification.',
      costOfWaiting: 'Inspection uncertainty remains.',
      costOfEscalating: 'Potential communication noise.',
      costOfNoAction: 'Risk remains.',
      protectedValue: 'Inspection readiness.',
    },
    decisionTiming: {
      recommendation: 'act_now',
      reason: 'Inspection is approaching.',
      timeSensitivity: 'today',
      decisionWindow: 'Before tomorrow inspection.',
      whatCanWait: ['Non-critical report polish'],
      whatCannotWait: ['Current readiness verification'],
    },
    noActionReasoning: {
      isValid: false,
      reason: 'No action leaves readiness uncertain.',
      conditions: ['Readiness already verified'],
      monitoringNeeded: ['Inspection status'],
      whenWaitingIsBetter: ['Evidence unavailable'],
      unnecessaryActionRisks: ['None material for verification'],
      riskIfWrong: 'Inspection issue missed.',
    },
    waitForEvidenceReasoning: {
      shouldWaitForEvidence: false,
      reason: 'Evidence can be collected as the action.',
      evidenceNeeded: ['Current photo and note.'],
      smallestEvidenceRequest: 'Capture one current photo and note for Canopy B.',
      decisionBlocked: 'Not blocked.',
      actionAfterEvidence: action.action,
    },
    actionSafetyCheck: {
      recommendationIsEvidenceBacked: true,
      alignsWithCurrentSituation: true,
      doesNotContradictRealityModel: true,
      doesNotOverstatePrediction: true,
      escalationIsJustified: true,
      noActionWasConsidered: true,
      missingEvidenceWasConsidered: true,
      reportWordingWillNotOverclaim: true,
      readiness: 'Ready',
      warnings: [],
      finalRecommendationSafe: true,
    },
    executiveResourceNeeds: [],
    executiveEscalations: [],
    executiveActions: [action],
    executiveReadiness: 'Ready',
    executiveJudgmentSummary: 'Verify Canopy B electrical rough-in before inspection.',
    confidence: 'high',
    ...overrides,
  };
}

function missingEvidence(hasGap = true) {
  return {
    generatedAt: '2026-07-02T12:00:00.000Z',
    summary: hasGap ? 'Need one current photo.' : 'No blocking evidence gaps detected.',
    items: hasGap ? [gap()] : [],
    prioritizedItems: hasGap ? [gap()] : [],
    requests: hasGap ? [request()] : [],
    minimumEvidenceNeeded: hasGap ? [request()] : [],
    highestImpactEvidenceGap: hasGap ? gap() : null,
    uncertaintyReductionActions: hasGap ? ['Take one photo.'] : [],
    totalEstimatedUncertaintyReduction: hasGap ? 35 : 0,
  };
}

function photoIntelligence() {
  return {
    progressEvents: [{
      id: 'photo-progress-canopy-b-1',
      progressDirection: 'uncertain',
      verificationStatus: 'needs_review',
      confidence: 'medium',
    }],
    conflicts: [{
      id: 'photo-conflict-canopy-b',
      conflictType: 'reported_complete_but_visibly_incomplete',
      summary: 'Written status says rough-in is complete, but the current photo still needs review.',
    }],
    progressEstimate: {
      state: 'insufficient_scope',
      summary: 'Photo evidence is useful but cannot prove completion.',
    },
  };
}

function gap() {
  return {
    id: 'gap-current-photo',
    type: 'missing_current_photo',
    title: 'Current photo needed',
    summary: 'Need a current photo.',
    whyItMatters: 'It confirms inspection readiness.',
    decisionAffected: 'Inspection readiness decision.',
    smallestEvidenceRequest: 'Capture one current photo for Canopy B.',
    nextCaptureAction: 'Take Photo',
    priority: 'high',
    impact: { decisionAffected: 'Inspection', understandingImpact: 'High', recommendationImpact: 'High', reportImpact: 'Medium', severity: 'high' },
    reasons: [{ id: 'reason-1', summary: 'Current evidence is needed.', source: 'Photo' }],
    uncertaintyReduction: 35,
  };
}

function request() {
  return {
    id: 'request-current-photo',
    type: 'missing_current_photo',
    request: 'Capture one current photo for Canopy B.',
    minimumEvidence: 'Current photo for Canopy B.',
    suggestedCaptureAction: 'Take Photo',
    projectName: 'Building 2375',
    areaName: 'Canopy B',
    priority: 'high',
    uncertaintyReduction: 35,
  };
}

function buildBundle(overrides = {}) {
  const model = sampleRealityModel(overrides.model || {});
  const judgment = sampleJudgment(model, overrides.judgment || {});
  const predictiveReality = predictive.buildPIEPredictiveReality({
    realityModel: model,
    missingEvidence: missingEvidence(true),
    generatedAt: '2026-07-02T12:00:00.000Z',
    priorForecasts: [],
  });
  const sim = simulation.buildPIEDecisionSimulation({
    realityModel: model,
    executiveJudgment: judgment,
    executiveJudgmentRecord: {
      id: 'judgment-1',
      organizationId: model.organizationId,
      projectId: model.projectId,
      realityModelId: judgment.authority.realityModelId,
      realityModelVersion: model.version,
      realitySnapshotId: judgment.authority.realitySnapshotId,
      judgmentTime: judgment.generatedAt,
      situationSummary: 'Inspection readiness.',
      primaryRecommendation: judgment.highestValueAction.action,
      alternativesConsidered: ['Monitor only'],
      tradeoffs: judgment.tradeoffAnalysis,
      risks: judgment.executiveRisks,
      constraints: judgment.executiveConstraints,
      opportunities: judgment.executiveOpportunities,
      resourceConsiderations: [],
      priorityRationale: 'Inspection due.',
      escalationRationale: judgment.escalationAnalysis.justification,
      authorityRequirement: 'Project authority',
      noActionOption: judgment.noActionReasoning.reason,
      confidence: 'high',
      uncertainty: ['Owner confirmation may still be needed.'],
      supportingRealityObjectIds: model.objects.map(object => object.identity.id),
      supportingAssertionIds: model.objects.flatMap(object => object.assertions.map(assertion => assertion.id)),
      activeConflictIds: [],
      activeUncertaintyIds: model.activeUncertainties.map(item => item.id),
      evidenceCutoffTime: model.sourceEvidenceCutoffAt,
      conditionsThatWouldChangeRecommendation: ['Inspection date moves'],
      supersededBy: null,
      supersededAt: null,
      immutable: true,
    },
    predictiveReality,
    missingEvidence: missingEvidence(true),
    longitudinalPhotoIntelligence: photoIntelligence(),
    generatedAt: '2026-07-02T12:00:00.000Z',
  });
  const challenged = challenge.challengePIERecommendation({
    realityModel: model,
    executiveJudgment: judgment,
    simulation: sim,
    generatedAt: '2026-07-02T12:00:00.000Z',
  });
  const validation = jarvis.validatePIEReasoningWithJARVIS({
    realityModel: model,
    executiveJudgment: judgment,
    simulation: sim,
    challenge: challenged,
    generatedAt: '2026-07-02T12:00:00.000Z',
  });
  return { model, judgment, predictiveReality, sim, challenged, validation };
}

function testSimulation() {
  const { sim } = buildBundle();
  assert(sim.options.some(option => option.optionType === 'recommended_action'));
  assert(sim.options.some(option => option.optionType === 'credible_alternative'));
  assert(sim.options.some(option => option.optionType === 'no_action'));
  assert(sim.options.some(option => option.optionType === 'delay_and_gather_evidence'));
  assert(sim.scenarios.filter(scenario => scenario.optionId === sim.options[0].optionId).length >= 6);
  assert(sim.scenarios.some(scenario => scenario.scenarioType === 'visual_progress_not_matching_reported_progress'));
  assert(sim.scores.every(score => score.components.length >= 14));
  assert(sim.provenance.executiveJudgmentId === 'judgment-1');
  assert(sim.provenance.photoProgressEventIdsUsed.includes('photo-progress-canopy-b-1'));
  assert(sim.inputSignature);
}

function testChallenge() {
  const { challenged } = buildBundle();
  assert(challenged.strongestArgumentAgainst.challenge.length > 0);
  assert(challenged.disconfirmingEvidenceNeeded.actionRequired.length > 0);
  assert(challenged.implementationFailureRisks.length > 0);
  assert(challenged.noActionOrDelayCouldBeBetter.challenge.includes('No-action') || challenged.noActionOrDelayCouldBeBetter.challenge.includes('Delay'));
  assert(challenged.visualEvidenceOverinterpretationChallenge.challenge.includes('Visual evidence'));
  assert(challenged.assumptionChangeChallenge.challenge.length > 0);
  assert(challenged.summary.includes('Strongest challenge'));
}

function testJarvis() {
  const baseline = buildBundle();
  const { validation } = baseline;
  assert(['pass', 'pass_with_warnings', 'needs_more_evidence', 'human_review_required', 'blocked'].includes(validation.status));
  [
    'reality-authority',
    'evidence-traceability',
    'option-completeness',
    'no-action-considered',
    'simulation-reproducibility',
    'sensitivity-analysis',
    'photo-evidence-interpretation',
    'causal-reasoning',
    'challenge-completeness',
    'summary-consistency',
  ].forEach(id => assert(validation.checks.some(check => check.id === id), `Missing ${id}`));

  const model = sampleRealityModel();
  const unsupported = {
    ...model,
    objects: model.objects.map(object => ({
      ...object,
      assertions: object.assertions.map(assertion => ({
        ...assertion,
        classification: 'fact',
        supportingEvidenceIds: [],
      })),
    })),
  };
  const judgment = sampleJudgment(unsupported);
  const sim = simulation.buildPIEDecisionSimulation({ realityModel: unsupported, executiveJudgment: judgment, missingEvidence: missingEvidence(true) });
  const challenged = challenge.challengePIERecommendation({ realityModel: unsupported, executiveJudgment: judgment, simulation: sim });
  const blocked = jarvis.validatePIEReasoningWithJARVIS({ realityModel: unsupported, executiveJudgment: judgment, simulation: sim, challenge: challenged });
  assert(blocked.status === 'blocked');
  assert(blocked.checks.find(check => check.id === 'fact-support')?.status === 'blocked');

  const recoveredFactSupport = jarvis.validatePIEReasoningWithJARVIS({
    realityModel: baseline.model,
    executiveJudgment: baseline.judgment,
    simulation: baseline.sim,
    challenge: baseline.challenged,
  });
  assert(
    recoveredFactSupport.checks.find(check => check.id === 'fact-support')?.status === 'pass',
    'supported facts must recover after the unsafe mutation is removed',
  );

  const staleJudgment = {
    ...baseline.judgment,
    authority: {
      ...baseline.judgment.authority,
      realityModelVersion: baseline.model.version + 1,
    },
  };
  const staleAuthority = jarvis.validatePIEReasoningWithJARVIS({
    realityModel: baseline.model,
    executiveJudgment: staleJudgment,
    simulation: baseline.sim,
    challenge: baseline.challenged,
  });
  assert(
    staleAuthority.checks.find(check => check.id === 'reality-authority')?.status === 'blocked',
    'a stale or mismatched Reality Model version must block the recommendation',
  );

  const incompleteSimulation = {
    ...baseline.sim,
    options: baseline.sim.options.filter(option => option.optionType !== 'no_action'),
  };
  const missingNoAction = jarvis.validatePIEReasoningWithJARVIS({
    realityModel: baseline.model,
    executiveJudgment: {
      ...baseline.judgment,
      noActionReasoning: {
        ...baseline.judgment.noActionReasoning,
        reason: '',
      },
    },
    simulation: incompleteSimulation,
    challenge: baseline.challenged,
  });
  assert(
    missingNoAction.checks.find(check => check.id === 'option-completeness')?.status === 'blocked',
    'missing no-action option must fail option completeness',
  );
  assert(
    missingNoAction.checks.find(check => check.id === 'no-action-considered')?.status === 'blocked',
    'missing no-action reasoning must block validation',
  );

  const openConflictModel = sampleRealityModel({
    evidenceConflicts: [{
      id: 'conflict-executable-adversarial',
      organizationId: 'org-decision',
      projectId: 'project-2375',
      affectedObjectIds: [],
      affectedAssertionIds: [],
      supportingEvidenceSideA: ['schedule-rough-in'],
      supportingEvidenceSideB: ['photo-canopy-b'],
      conflictType: 'status_contradiction',
      severity: 'high',
      confidence: 'medium',
      status: 'open',
      recommendedNextEvidence: ['Confirm the current field condition.'],
      createdAt: '2026-07-02T12:00:00.000Z',
    }],
  });
  const openConflictJudgment = sampleJudgment(openConflictModel);
  const openConflictSimulation = simulation.buildPIEDecisionSimulation({
    realityModel: openConflictModel,
    executiveJudgment: openConflictJudgment,
    missingEvidence: missingEvidence(true),
  });
  const openConflictChallenge = challenge.challengePIERecommendation({
    realityModel: openConflictModel,
    executiveJudgment: openConflictJudgment,
    simulation: openConflictSimulation,
  });
  const openConflictValidation = jarvis.validatePIEReasoningWithJARVIS({
    realityModel: openConflictModel,
    executiveJudgment: openConflictJudgment,
    simulation: openConflictSimulation,
    challenge: openConflictChallenge,
  });
  assert(
    openConflictValidation.checks.find(check => check.id === 'unresolved-conflicts')?.status === 'needs_more_evidence',
    'open conflicts must remain visible and request evidence',
  );

  const resolvedConflictModel = {
    ...openConflictModel,
    evidenceConflicts: openConflictModel.evidenceConflicts.map(conflict => ({
      ...conflict,
      status: 'resolved',
    })),
  };
  const resolvedConflictJudgment = sampleJudgment(resolvedConflictModel);
  const resolvedConflictSimulation = simulation.buildPIEDecisionSimulation({
    realityModel: resolvedConflictModel,
    executiveJudgment: resolvedConflictJudgment,
    missingEvidence: missingEvidence(false),
  });
  const resolvedConflictChallenge = challenge.challengePIERecommendation({
    realityModel: resolvedConflictModel,
    executiveJudgment: resolvedConflictJudgment,
    simulation: resolvedConflictSimulation,
  });
  const resolvedConflictValidation = jarvis.validatePIEReasoningWithJARVIS({
    realityModel: resolvedConflictModel,
    executiveJudgment: resolvedConflictJudgment,
    simulation: resolvedConflictSimulation,
    challenge: resolvedConflictChallenge,
  });
  assert(
    resolvedConflictValidation.checks.find(check => check.id === 'unresolved-conflicts')?.status === 'pass',
    'resolved conflicts must recover to a passing conflict check',
  );
}

function testConfidence() {
  const { model, judgment, predictiveReality, sim, challenged, validation } = buildBundle();
  const result = confidence.decomposePIERecommendationConfidence({
    realityModel: model,
    executiveJudgment: judgment,
    predictiveReality,
    simulation: sim,
    challenge: challenged,
    jarvisValidation: validation,
  });
  ['evidence', 'reality_model', 'identity', 'causal', 'forecast', 'option_generation', 'option_comparison', 'simulation', 'execution', 'photo_evidence', 'outcome_measurement', 'overall_recommendation']
    .forEach(name => assert(result.components.some(component => component.name === name), `Missing ${name}`));
  assert(result.primaryConfidenceLimiter);
}

function testCausalReasoning() {
  const { validation, challenged } = buildBundle();
  assert(validation.checks.some(check => check.id === 'causal-reasoning'));
  assert(challenged.assumptionChangeChallenge.actionRequired.length > 0);

  const model = sampleRealityModel({
    evidenceConflicts: [{
      id: 'conflict-causation',
      organizationId: 'org-decision',
      projectId: 'project-2375',
      affectedObjectIds: ['obj-canopy-b'],
      affectedAssertionIds: [],
      supportingEvidenceSideA: ['schedule-rough-in'],
      supportingEvidenceSideB: ['photo-canopy-b'],
      conflictType: 'status_contradiction',
      severity: 'high',
      confidence: 'medium',
      status: 'open',
      recommendedNextEvidence: ['Confirm whether visual condition caused the schedule risk.'],
      createdAt: '2026-07-02T12:00:00.000Z',
    }],
  });
  const judgment = sampleJudgment(model, {
    executiveRisks: [{
      id: 'risk-causal',
      risk: 'Schedule risk may be associated with incomplete rough-in.',
      whyItMatters: 'The sequence suggests possible contribution, but cause is not confirmed.',
      severity: 'high',
      shouldEscalate: false,
      confidence: 'medium',
    }],
  });
  const sim = simulation.buildPIEDecisionSimulation({ realityModel: model, executiveJudgment: judgment, missingEvidence: missingEvidence(true) });
  const challengedConflict = challenge.challengePIERecommendation({ realityModel: model, executiveJudgment: judgment, simulation: sim });
  const result = jarvis.validatePIEReasoningWithJARVIS({ realityModel: model, executiveJudgment: judgment, simulation: sim, challenge: challengedConflict });
  assert(result.checks.some(check => check.id === 'causal-reasoning'), 'causal reasoning check should run with conflicts');
}

function testPrediction() {
  const model = sampleRealityModel();
  const first = predictive.buildPIEPredictiveReality({ realityModel: model, missingEvidence: missingEvidence(true) });
  const second = predictive.buildPIEPredictiveReality({ realityModel: model, missingEvidence: missingEvidence(true), priorForecasts: first.forecasts });
  assert(first.predictiveReality.predictedEvent);
  assert(first.predictiveReality.leadingIndicators.length > 0);
  assert(first.predictiveReality.reassessmentTrigger);
  assert(first.forecastInvalidationTriggers.includes('new_evidence_arrives'));
  assert(second.priorForecastsForCalibration.length === first.forecasts.length);
}

function testDecisionQuality() {
  const { sim, model, judgment } = buildBundle();
  assert(sim.sensitivityAnalysis.factors.length >= 12);
  assert(sim.sensitivityAnalysis.factors.some(factor => factor.factor === 'photo_progress_interpretation'));
  assert(sim.sensitivityAnalysis.factors.some(factor => factor.factor === 'deadline'));
  sim.sensitivityAnalysis.factors.forEach(factor => {
    assert(
      factor.rescoredOptions.length === sim.options.length,
      `${factor.factor} must rescore every option`,
    );
    assert(
      factor.eligibleOptionIds.length === factor.rescoredOptions.filter(score => !score.disqualified).length,
      `${factor.factor} must report the exact eligible option set`,
    );
    assert(Number.isFinite(factor.baselineMargin), `${factor.factor} must report a baseline score margin`);
    assert(Number.isFinite(factor.perturbedMargin), `${factor.factor} must report a perturbed score margin`);
    const preferredScore = factor.rescoredOptions.find(
      score => score.optionId === factor.preferredOptionAfterChange,
    );
    assert(
      factor.preferredOptionAfterChange === 'none' || (preferredScore && !preferredScore.disqualified),
      `${factor.factor} must never select a disqualified option`,
    );
  });
  const regulatory = sim.sensitivityAnalysis.factors.find(
    factor => factor.factor === 'regulatory_interpretation',
  );
  assert(
    regulatory.rescoredOptions.some(score => score.disqualified),
    'stricter regulatory interpretation must exercise the compliance gate',
  );
  assert(sim.sensitivityAnalysis.robustness);
  assert(sim.provenance.realityModelVersion === model.version);
  assert(sim.provenance.conditionsThatWouldChangeRecommendation.length > 0);
  const value = evidenceValue.prioritizeEvidenceByDecisionValue({
    realityModel: model,
    executiveJudgment: judgment,
    missingEvidence: missingEvidence(true),
    simulation: sim,
  });
  assert(value.highestValueEvidence);
  assert(value.oneRequestForUser);
  assert(value.highestValueEvidence.safetyImpact);
}

function testEvidenceValue() {
  const { sim, model, judgment } = buildBundle();
  const value = evidenceValue.prioritizeEvidenceByDecisionValue({
    realityModel: model,
    executiveJudgment: judgment,
    missingEvidence: missingEvidence(true),
    simulation: sim,
  });
  assert(value.values.length === 1, 'normal UI should receive one highest-value request first');
  assert(value.highestValueEvidence.request.includes('photo'));
  assert(['none', 'low', 'medium', 'high', 'critical'].includes(value.highestValueEvidence.safetyImpact));
  assert(typeof value.highestValueEvidence.canProceedWithoutIt === 'boolean');
}

function testMinimalUi() {
  const app = fs.readFileSync(path.join(rootDir, 'App.tsx'), 'utf8');
  const home = app;
  const capture = app;
  const reports = fs.readFileSync(path.join(rootDir, 'screens/ReportsScreen.tsx'), 'utf8');
  const provider = fs.readFileSync(path.join(rootDir, 'providers/PIELiveAuthorityProvider.tsx'), 'utf8');
  const visibleUi = [app, home, capture, reports].join('\n');
  ['Run Simulation', 'Challenge Recommendation', 'Validate with JARVIS', 'Recalculate Confidence', 'Compare Options']
    .forEach(text => assert(!visibleUi.includes(text), `${text} should not be a normal UI control`));
  assert(provider.includes('jarvisReasoningValidation'));
  assert(provider.includes('layer4DecisionCreationAllowed: false'));
}

const tests = {
  simulation: testSimulation,
  challenge: testChallenge,
  'jarvis-reasoning': testJarvis,
  confidence: testConfidence,
  'causal-reasoning': testCausalReasoning,
  prediction: testPrediction,
  'decision-quality': testDecisionQuality,
  'evidence-value': testEvidenceValue,
  'minimal-ui-intelligence': testMinimalUi,
};

if (mode === 'all') {
  Object.values(tests).forEach(test => test());
  console.log('PASS decision intelligence tests');
} else if (tests[mode]) {
  tests[mode]();
  console.log(`PASS ${mode}`);
} else {
  throw new Error(`Unknown decision intelligence test mode: ${mode}`);
}
