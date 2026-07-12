import type { PIEBeliefEngineResult } from './PIEBeliefEngine';
import type { PIEEvidenceQualityResult } from './PIEEvidenceQuality';
import type { PIEEvidenceTimeline } from './PIEEvidenceTimeline';
import type { PIEMissingEvidenceResult } from './PIEMissingEvidence';
import type { PIEPatternIntelligence } from './PIEPatternEngine';
import type { PIEPredictiveRealityResult } from './PIEPredictiveReality';
import type { PIEAdaptivePolicy } from './PIEAdaptiveIntelligence';
import type { PIEDecisionMemoryResult } from './PIEDecisionMemory';
import type {
  PIERealityConflict,
  PIERealityModel,
  PIERealityObject,
  PIERealityObjectIntelligenceResult,
  PIERealityReadiness,
  PIERealityUncertaintyRecord,
} from './PIERealityModel';
import type { PIESituationResult } from './PIESituationIntelligence';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';
import type { PIERealityPersistenceStatus } from './PIERealityModelOrchestrator';

export type PIEExecutiveActionType =
  | 'verify'
  | 'capture_evidence'
  | 'escalate'
  | 'wait'
  | 'communicate'
  | 'assign_owner'
  | 'approve'
  | 'reject'
  | 'monitor'
  | 'recover_schedule'
  | 'resolve_blocker'
  | 'inspect'
  | 'defer'
  | 'no_action';

export type PIEExecutiveReadiness =
  | 'Ready'
  | 'Needs Verification'
  | 'Uncertain'
  | 'Blocked';

export type PIEExecutiveDecision = {
  id: string;
  decision: string;
  whyNow: string;
  owner: string;
  options: PIEExecutiveActionType[];
  readiness: PIEExecutiveReadiness;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutivePriority = {
  id: string;
  priority: string;
  reason: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  goalSupported: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveRisk = {
  id: string;
  risk: string;
  whyItMatters: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  shouldEscalate: boolean;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveOpportunity = {
  id: string;
  opportunity: string;
  valueCreated: string;
  action: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveConstraint = {
  id: string;
  constraint: string;
  limits: string;
  actionRequired: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveTradeoff = {
  id: string;
  optionA: string;
  optionB: string;
  optionAStrength: string;
  optionBStrength: string;
  preferredOption: string;
  whyAlternativeLost: string;
};

export type PIEExecutiveResourceNeed = {
  id: string;
  resource: string;
  reason: string;
  ownerNeeded: boolean;
  urgency: 'critical' | 'high' | 'medium' | 'low';
};

export type PIEExecutiveEscalation = {
  id: string;
  escalation: string;
  shouldEscalate: boolean;
  why: string;
  target: string;
};

export type PIETradeoffDimension =
  | 'speed_vs_quality'
  | 'cost_vs_schedule'
  | 'risk_vs_progress'
  | 'evidence_vs_time'
  | 'safety_vs_productivity'
  | 'communication_vs_noise'
  | 'short_term_vs_long_term'
  | 'escalation_vs_local_resolution';

export type PIETradeoffOption = {
  id: string;
  label: string;
  actionType: PIEExecutiveActionType;
  gains: string[];
  losses: string[];
  uncertaintyReduction: number;
  projectGoalProtection: number;
  totalOutcomeScore: number;
  unnecessaryNoiseRisk: number;
};

export type PIETradeoffAnalysis = {
  summary: string;
  dimensions: PIETradeoffDimension[];
  options: PIETradeoffOption[];
  preferredOption: PIETradeoffOption | null;
  bestTotalOutcome: string;
  uncertaintyEfficientOption: string;
  projectGoalProtectedBy: string;
  leastNoisyOption: string;
  explanation: string;
};

export type PIEEscalationTrigger = {
  id: string;
  trigger: string;
  present: boolean;
  evidence: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEEscalationTarget = {
  role: string;
  reason: string;
  ask: string;
};

export type PIEEscalationAnalysis = {
  shouldEscalate: boolean;
  timing: 'now' | 'after_verification' | 'monitor_only';
  target: PIEEscalationTarget;
  triggers: PIEEscalationTrigger[];
  evidenceStrongEnough: boolean;
  justification: string;
  evidenceRequiredBeforeEscalation: string[];
  escalationRisk: string;
  localResolutionFirst: boolean;
};

export type PIEOpportunityCost = {
  chosenAction: string;
  alternativesDelayed: string[];
  costOfActingNow: string;
  costOfWaiting: string;
  costOfEscalating: string;
  costOfNoAction: string;
  protectedValue: string;
};

export type PIEDecisionTiming = {
  recommendation: 'act_now' | 'wait_for_evidence' | 'monitor' | 'escalate_now' | 'defer';
  reason: string;
  timeSensitivity: 'immediate' | 'today' | 'soon' | 'can_wait';
  decisionWindow: string;
  whatCanWait: string[];
  whatCannotWait: string[];
};

export type PIENoActionReasoning = {
  isValid: boolean;
  reason: string;
  conditions: string[];
  monitoringNeeded: string[];
  whenWaitingIsBetter: string[];
  unnecessaryActionRisks: string[];
  riskIfWrong: string;
};

export type PIEWaitForEvidenceReasoning = {
  shouldWaitForEvidence: boolean;
  reason: string;
  evidenceNeeded: string[];
  smallestEvidenceRequest: string;
  decisionBlocked: string;
  actionAfterEvidence: string;
};

export type PIEExecutiveActionSafetyCheck = {
  recommendationIsEvidenceBacked: boolean;
  alignsWithCurrentSituation: boolean;
  doesNotContradictRealityModel: boolean;
  doesNotOverstatePrediction: boolean;
  escalationIsJustified: boolean;
  noActionWasConsidered: boolean;
  missingEvidenceWasConsidered: boolean;
  reportWordingWillNotOverclaim: boolean;
  readiness: PIEExecutiveReadiness;
  warnings: string[];
  finalRecommendationSafe: boolean;
};

export type PIEExecutiveGovernance = {
  recommendation: string;
  why: string;
  supportingEvidence: string[];
  assumptions: string[];
  uncertainty: string[];
  alternativesConsidered: string[];
  whyAlternativesLost: string[];
  tradeoffs: PIEExecutiveTradeoff[];
  expectedOutcome: string;
  successMeasure: string;
  whatWouldChangeRecommendation: string[];
};

export type PIEExecutiveJudgmentExplanation = {
  summary: string;
  whatMattersMost: string;
  decisionNeeded: string;
  greatestValue: string;
  uncertaintyReduction: string;
  riskReduction: string;
  whatCanWait: string;
  whatShouldEscalate: string;
  whatShouldNotEscalate: string;
  incompleteEvidenceAction: string;
  noActionRationale: string;
};

export type PIEExecutiveActionScore = {
  valueCreated: number;
  riskReduced: number;
  uncertaintyReduced: number;
  scheduleImpact: number;
  safetyImpact: number;
  qualityImpact: number;
  communicationImpact: number;
  effortRequired: number;
  urgency: number;
  reversibility: number;
  confidenceReadiness: number;
  downstreamEffect: number;
  total: number;
  readiness: PIEExecutiveReadiness;
  readinessReason: string;
};

export type PIEExecutiveAction = {
  id: string;
  type: PIEExecutiveActionType;
  action: string;
  why: string;
  expectedOutcome: string;
  successMeasure: string;
  score: PIEExecutiveActionScore;
  governance: PIEExecutiveGovernance;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveJudgment = {
  highestValueAction: PIEExecutiveAction | null;
  whatMattersMost: string;
  decisionNeeded: string;
  greatestValue: string;
  riskReduction: string;
  uncertaintyReduction: string;
  whatCanWait: string;
  whatShouldEscalate: string;
  whatShouldNotEscalate: string;
  bestActionIfEvidenceIncomplete: string;
  whenNoActionIsCorrect: string;
  readiness: PIEExecutiveReadiness;
  explanation: PIEExecutiveJudgmentExplanation;
};

export type PIEExecutiveJudgmentResult = {
  generatedAt: string;
  authority: PIEExecutiveJudgmentAuthority;
  executiveJudgment: PIEExecutiveJudgment;
  highestValueAction: PIEExecutiveAction | null;
  executiveDecisions: PIEExecutiveDecision[];
  executivePriorities: PIEExecutivePriority[];
  executiveRisks: PIEExecutiveRisk[];
  executiveOpportunities: PIEExecutiveOpportunity[];
  executiveConstraints: PIEExecutiveConstraint[];
  executiveTradeoffs: PIEExecutiveTradeoff[];
  tradeoffAnalysis: PIETradeoffAnalysis;
  escalationAnalysis: PIEEscalationAnalysis;
  opportunityCost: PIEOpportunityCost;
  decisionTiming: PIEDecisionTiming;
  noActionReasoning: PIENoActionReasoning;
  waitForEvidenceReasoning: PIEWaitForEvidenceReasoning;
  actionSafetyCheck: PIEExecutiveActionSafetyCheck;
  executiveResourceNeeds: PIEExecutiveResourceNeed[];
  executiveEscalations: PIEExecutiveEscalation[];
  executiveActions: PIEExecutiveAction[];
  executiveReadiness: PIEExecutiveReadiness;
  executiveJudgmentSummary: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveJudgmentAuthority = {
  organizationId: string;
  projectId: string;
  realityModelId: string;
  realityModelVersion: number;
  realitySnapshotId: string;
  evidenceCutoffTime: string;
  activeConflictIds: string[];
  activeUncertaintyIds: string[];
  persistenceStatus?: PIERealityPersistenceStatus;
};

export type PIEExecutiveJudgmentInput = {
  realityModel: PIERealityModel;
  authority?: PIEExecutiveJudgmentAuthority;
  objectIntelligence?: PIERealityObjectIntelligenceResult | null;
  situationIntelligence?: PIESituationResult | null;
  predictiveReality?: PIEPredictiveRealityResult | null;
  evidenceQuality?: PIEEvidenceQualityResult | null;
  missingEvidence?: PIEMissingEvidenceResult | null;
  beliefSystem?: PIEBeliefEngineResult | null;
  patternIntelligence?: PIEPatternIntelligence | null;
  evidenceTimeline?: PIEEvidenceTimeline | null;
  adaptivePolicies?: PIEAdaptivePolicy[];
  decisionMemory?: PIEDecisionMemoryResult | null;
  generatedAt?: string;
};

export function buildPIEExecutiveJudgment(
  input: PIEExecutiveJudgmentInput,
): PIEExecutiveJudgmentResult {
  const generatedAt = input.generatedAt || input.realityModel.generatedAt || new Date().toISOString();
  const authority = requireExecutiveJudgmentAuthority(input);
  const executiveDecisions = identifyExecutiveDecisions(input);
  const executivePriorities = rankExecutivePriorities(input);
  const executiveRisks = identifyExecutiveRisks(input);
  const executiveOpportunities = identifyExecutiveOpportunities(input);
  const executiveConstraints = identifyExecutiveConstraints(input);
  const executiveTradeoffs = buildExecutiveTradeoffs(input, {
    priorities: executivePriorities,
    risks: executiveRisks,
    opportunities: executiveOpportunities,
  });
  const executiveResourceNeeds = identifyExecutiveResourceNeeds(input);
  const executiveEscalations = identifyExecutiveEscalations(executiveRisks);
  const executiveActions = scoreExecutiveActions(
    buildExecutiveActions(input, {
      decisions: executiveDecisions,
      priorities: executivePriorities,
      risks: executiveRisks,
      opportunities: executiveOpportunities,
      constraints: executiveConstraints,
      tradeoffs: executiveTradeoffs,
    }),
    input,
  );
  const highestValueAction = selectHighestValueAction(executiveActions);
  const tradeoffAnalysis = analyzeExecutiveTradeoffs(input, executiveActions);
  const escalationAnalysis = analyzeEscalationNeed(input, executiveRisks, executiveActions);
  const opportunityCost = calculateOpportunityCost(input, highestValueAction, executiveActions);
  const noActionReasoning = evaluateNoActionOption(input, executiveRisks, executiveConstraints);
  const waitForEvidenceReasoning = evaluateWaitForEvidenceOption(input, executiveConstraints, executiveActions);
  const decisionTiming = evaluateDecisionTiming(input, highestValueAction, escalationAnalysis, waitForEvidenceReasoning);
  const actionSafetyCheck = performExecutiveActionSafetyCheck(input, {
    highestValueAction,
    escalationAnalysis,
    noActionReasoning,
    waitForEvidenceReasoning,
  });
  const executiveReadiness = highestValueAction?.score.readiness || readinessFromInputs(input);
  const explanation = explainExecutiveJudgment(input, {
    highestValueAction,
    priorities: executivePriorities,
    decisions: executiveDecisions,
    risks: executiveRisks,
    opportunities: executiveOpportunities,
    constraints: executiveConstraints,
    escalations: executiveEscalations,
  });
  const executiveJudgment: PIEExecutiveJudgment = {
    highestValueAction,
    whatMattersMost: explanation.whatMattersMost,
    decisionNeeded: explanation.decisionNeeded,
    greatestValue: explanation.greatestValue,
    riskReduction: explanation.riskReduction,
    uncertaintyReduction: explanation.uncertaintyReduction,
    whatCanWait: explanation.whatCanWait,
    whatShouldEscalate: explanation.whatShouldEscalate,
    whatShouldNotEscalate: explanation.whatShouldNotEscalate,
    bestActionIfEvidenceIncomplete: explanation.incompleteEvidenceAction,
    whenNoActionIsCorrect: explanation.noActionRationale,
    readiness: executiveReadiness,
    explanation,
  };

  return {
    generatedAt,
    authority,
    executiveJudgment,
    highestValueAction,
    executiveDecisions,
    executivePriorities,
    executiveRisks,
    executiveOpportunities,
    executiveConstraints,
    executiveTradeoffs,
    tradeoffAnalysis,
    escalationAnalysis,
    opportunityCost,
    decisionTiming,
    noActionReasoning,
    waitForEvidenceReasoning,
    actionSafetyCheck,
    executiveResourceNeeds,
    executiveEscalations,
    executiveActions,
    executiveReadiness,
    executiveJudgmentSummary: summarizeExecutiveJudgment(executiveJudgment, {
      decision: executiveDecisions[0],
      risk: executiveRisks[0],
      opportunity: executiveOpportunities[0],
      escalationAnalysis,
      actionSafetyCheck,
    }),
    confidence: confidenceFromReadiness(executiveReadiness, input),
  };
}

export function buildExecutiveJudgmentAuthority(input: {
  realityModel: PIERealityModel;
  snapshotId?: string | null;
  conflicts?: PIERealityConflict[];
  uncertainties?: PIERealityUncertaintyRecord[];
  persistenceStatus?: PIERealityPersistenceStatus;
}): PIEExecutiveJudgmentAuthority {
  const activeConflicts = input.conflicts || input.realityModel.evidenceConflicts || [];
  const activeUncertainties = input.uncertainties || input.realityModel.activeUncertainties || [];
  return {
    organizationId: input.realityModel.organizationId,
    projectId: input.realityModel.projectId,
    realityModelId: realityModelRecordId(input.realityModel),
    realityModelVersion: input.realityModel.version,
    realitySnapshotId: input.snapshotId || realitySnapshotIdForModel(input.realityModel),
    evidenceCutoffTime: input.realityModel.sourceEvidenceCutoffAt,
    activeConflictIds: activeConflicts.map(conflict => conflict.id),
    activeUncertaintyIds: activeUncertainties.map(uncertainty => uncertainty.id),
    persistenceStatus: input.persistenceStatus,
  };
}

export function requireExecutiveJudgmentAuthority(
  input: PIEExecutiveJudgmentInput,
): PIEExecutiveJudgmentAuthority {
  const authority = input.authority;
  if (!authority) {
    throw new Error('Executive Judgment requires authoritative Reality Model metadata.');
  }
  if (
    authority.organizationId !== input.realityModel.organizationId ||
    authority.projectId !== input.realityModel.projectId ||
    authority.realityModelVersion !== input.realityModel.version ||
    !authority.realitySnapshotId ||
    !authority.evidenceCutoffTime
  ) {
    throw new Error('Executive Judgment authority metadata does not match the authoritative Reality Model.');
  }
  return authority;
}

export function realityModelRecordId(model: PIERealityModel): string {
  return `reality-model-${model.organizationId}-${model.projectId}`;
}

export function realitySnapshotIdForModel(model: PIERealityModel): string {
  return `reality-snapshot-${model.organizationId}-${model.projectId}-v${model.version}`;
}

export function identifyExecutiveDecisions(
  input: PIEExecutiveJudgmentInput,
): PIEExecutiveDecision[] {
  const situationDecision = input.situationIntelligence?.situationPriorities[0]
    ? {
        id: 'decision-situation-priority',
        decision: input.situationIntelligence.situationPriorities[0].priority,
        whyNow: input.situationIntelligence.situationPriorities[0].reason,
        owner: 'User',
        options: ['verify', 'capture_evidence', 'monitor'] as PIEExecutiveActionType[],
        readiness: readinessFromConfidence(input.situationIntelligence.situationPriorities[0].confidence),
        confidence: input.situationIntelligence.situationPriorities[0].confidence,
      }
    : null;
  const predictiveDecision = input.predictiveReality?.risks[0]
    ? {
        id: 'decision-predictive-reality-risk',
        decision: input.predictiveReality.risks[0].risk,
        whyNow: input.predictiveReality.noActionForecast.summary,
        owner: 'User',
        options: ['verify', 'recover_schedule', 'resolve_blocker', 'no_action'] as PIEExecutiveActionType[],
        readiness: input.predictiveReality.confidence === 'high' ? 'Ready' as const : 'Needs Verification' as const,
        confidence: input.predictiveReality.risks[0].confidence,
      }
    : null;
  const missingDecision = input.missingEvidence?.highestImpactEvidenceGap
    ? {
        id: 'decision-missing-evidence',
        decision: input.missingEvidence.highestImpactEvidenceGap.decisionAffected,
        whyNow: input.missingEvidence.highestImpactEvidenceGap.whyItMatters,
        owner: 'User',
        options: ['capture_evidence', 'defer', 'no_action'] as PIEExecutiveActionType[],
        readiness: 'Needs Verification' as const,
        confidence: 'medium' as ProjectConfidenceLevel,
      }
    : null;

  return [situationDecision, predictiveDecision, missingDecision]
    .filter((decision): decision is PIEExecutiveDecision => Boolean(decision))
    .slice(0, 8);
}

export function rankExecutivePriorities(
  input: PIEExecutiveJudgmentInput,
): PIEExecutivePriority[] {
  const objectPriorities = input.realityModel.objects
    .filter(object =>
      object.currentStatus === 'blocked' ||
      object.currentStatus === 'at_risk' ||
      object.intelligence.readiness === 'Blocked' ||
      object.intelligence.riskLevel === 'high' ||
      object.intelligence.riskLevel === 'critical',
    )
    .map((object, index) => ({
      id: `priority-object-${index + 1}`,
      priority: object.name,
      reason: object.intelligence.summary || object.currentState.summary,
      urgency: urgencyFromObject(object),
      goalSupported: object.intelligence.goalsSupported[0]?.goal || 'Improve project readiness.',
      confidence: object.intelligence.confidence.level,
    }));
  const situationPriorities = (input.situationIntelligence?.situationPriorities || [])
    .map((priority, index) => ({
      id: `priority-situation-${index + 1}`,
      priority: priority.priority,
      reason: priority.reason,
      urgency: priority.rank === 1 ? 'high' as const : 'medium' as const,
      goalSupported: 'Resolve current situation priority.',
      confidence: priority.confidence,
    }));

  return uniquePriorities([...objectPriorities, ...situationPriorities])
    .sort((left, right) => urgencyScore(right.urgency) - urgencyScore(left.urgency) ||
      confidenceScore(right.confidence) - confidenceScore(left.confidence))
    .slice(0, 8);
}

export function identifyExecutiveRisks(
  input: PIEExecutiveJudgmentInput,
): PIEExecutiveRisk[] {
  const predictiveRisks = (input.predictiveReality?.risks || []).map((risk, index) => ({
    id: `risk-predictive-${index + 1}`,
    risk: risk.risk,
    whyItMatters: risk.verificationNeeded,
    severity: risk.severity,
    shouldEscalate: risk.growsIfNothingChanges && (risk.severity === 'critical' || risk.severity === 'high'),
    confidence: risk.confidence,
  }));
  const situationRisks = (input.situationIntelligence?.situationRisks || []).map((risk, index) => ({
    id: `risk-situation-${index + 1}`,
    risk: risk.risk,
    whyItMatters: risk.whyItMatters,
    severity: risk.severity,
    shouldEscalate: risk.severity === 'critical' || risk.severity === 'high',
    confidence: risk.confidence,
  }));
  const objectRisks = input.realityModel.objects
    .filter(object => object.intelligence.riskLevel !== 'low')
    .map((object, index) => ({
      id: `risk-object-${index + 1}`,
      risk: object.name,
      whyItMatters: object.intelligence.summary,
      severity: object.intelligence.riskLevel,
      shouldEscalate: object.intelligence.riskLevel === 'critical',
      confidence: object.intelligence.confidence.level,
    }));

  return uniqueRisks([...predictiveRisks, ...situationRisks, ...objectRisks]).slice(0, 10);
}

export function identifyExecutiveOpportunities(
  input: PIEExecutiveJudgmentInput,
): PIEExecutiveOpportunity[] {
  const predictiveOpportunities = (input.predictiveReality?.opportunities || []).map((opportunity, index) => ({
    id: `opportunity-predictive-${index + 1}`,
    opportunity: opportunity.opportunity,
    valueCreated: opportunity.expectedRealityChange,
    action: opportunity.recoveryAction,
    confidence: opportunity.confidence,
  }));
  const readyObjects = input.realityModel.intelligence.objectsReady.slice(0, 4).map((object, index) => ({
    id: `opportunity-ready-${index + 1}`,
    opportunity: `${object.name} is ready to use.`,
    valueCreated: object.intelligence.goalsSupported[0]?.goal || 'Advance project readiness.',
    action: object.intelligence.nextBestAction.action,
    confidence: object.intelligence.confidence.level,
  }));

  return [...predictiveOpportunities, ...readyObjects].slice(0, 8);
}

export function identifyExecutiveConstraints(
  input: PIEExecutiveJudgmentInput,
): PIEExecutiveConstraint[] {
  const missingConstraints = (input.missingEvidence?.minimumEvidenceNeeded || []).slice(0, 4).map((request, index) => ({
    id: `constraint-missing-${index + 1}`,
    constraint: request.request,
    limits: request.minimumEvidence,
    actionRequired: request.suggestedCaptureAction,
    confidence: 'medium' as ProjectConfidenceLevel,
  }));
  const evidenceConstraint = input.evidenceQuality?.evidenceReadiness &&
    input.evidenceQuality.evidenceReadiness !== 'strong' &&
    input.evidenceQuality.evidenceReadiness !== 'good'
    ? {
        id: 'constraint-evidence-quality',
        constraint: `Evidence readiness is ${input.evidenceQuality.evidenceReadiness}.`,
        limits: 'DAVE should verify before making a confident executive recommendation.',
        actionRequired: 'Collect stronger current evidence.',
        confidence: input.evidenceQuality.averageScore >= 60 ? 'medium' as const : 'low' as const,
      }
    : null;
  const staleConstraint = input.evidenceTimeline?.staleAreas[0]
    ? {
        id: 'constraint-stale-area',
        constraint: input.evidenceTimeline.staleAreas[0].summary,
        limits: 'Stale evidence reduces confidence in current readiness.',
        actionRequired: input.evidenceTimeline.staleAreas[0].recommendedEvidence,
        confidence: 'medium' as ProjectConfidenceLevel,
      }
    : null;

  return [evidenceConstraint, staleConstraint, ...missingConstraints]
    .filter((constraint): constraint is PIEExecutiveConstraint => Boolean(constraint))
    .slice(0, 8);
}

export function buildExecutiveActions(
  input: PIEExecutiveJudgmentInput,
  context: {
    decisions?: PIEExecutiveDecision[];
    priorities?: PIEExecutivePriority[];
    risks?: PIEExecutiveRisk[];
    opportunities?: PIEExecutiveOpportunity[];
    constraints?: PIEExecutiveConstraint[];
    tradeoffs?: PIEExecutiveTradeoff[];
  } = {},
): PIEExecutiveAction[] {
  const priority = context.priorities?.[0];
  const risk = context.risks?.[0];
  const opportunity = context.opportunities?.[0];
  const constraint = context.constraints?.[0];
  const decision = context.decisions?.[0];
  const candidates = [
    risk ? actionFromRisk(risk, input, context.tradeoffs || []) : null,
    opportunity ? actionFromOpportunity(opportunity, input, context.tradeoffs || []) : null,
    constraint ? actionFromConstraint(constraint, input, context.tradeoffs || []) : null,
    priority ? actionFromPriority(priority, input, context.tradeoffs || []) : null,
    decision ? actionFromDecision(decision, input, context.tradeoffs || []) : null,
    noActionCandidate(input, context),
  ];

  return candidates.filter((action): action is PIEExecutiveAction => Boolean(action));
}

export function scoreExecutiveActions(
  actions: PIEExecutiveAction[],
  input: PIEExecutiveJudgmentInput,
): PIEExecutiveAction[] {
  return actions.map(action => {
    const score = scoreAction(action, input);
    return {
      ...action,
      score,
      confidence: confidenceFromReadiness(score.readiness, input),
      governance: {
        ...action.governance,
        recommendation: action.action,
        why: action.why,
      },
    };
  }).sort((left, right) => right.score.total - left.score.total);
}

export function selectHighestValueAction(
  actions: PIEExecutiveAction[],
): PIEExecutiveAction | null {
  return actions[0] || null;
}

export function explainExecutiveJudgment(
  input: PIEExecutiveJudgmentInput,
  context: {
    highestValueAction?: PIEExecutiveAction | null;
    priorities?: PIEExecutivePriority[];
    decisions?: PIEExecutiveDecision[];
    risks?: PIEExecutiveRisk[];
    opportunities?: PIEExecutiveOpportunity[];
    constraints?: PIEExecutiveConstraint[];
    escalations?: PIEExecutiveEscalation[];
  } = {},
): PIEExecutiveJudgmentExplanation {
  const highestValueAction = context.highestValueAction || null;
  const priority = context.priorities?.[0];
  const decision = context.decisions?.[0];
  const risk = context.risks?.[0];
  const opportunity = context.opportunities?.[0];
  const constraint = context.constraints?.[0];
  const escalation = context.escalations?.find(item => item.shouldEscalate);

  return {
    summary: highestValueAction?.governance.why || 'DAVE needs stronger evidence before a confident executive action.',
    whatMattersMost: priority?.priority || input.situationIntelligence?.situationSummary.headline || 'No single priority is clear yet.',
    decisionNeeded: decision?.decision || 'No immediate executive decision is required.',
    greatestValue: opportunity?.valueCreated || highestValueAction?.expectedOutcome || 'Value comes from reducing uncertainty before action.',
    uncertaintyReduction: constraint?.actionRequired || input.missingEvidence?.minimumEvidenceNeeded[0]?.suggestedCaptureAction || 'Current uncertainty can wait if it does not affect schedule, safety, quality, or communication.',
    riskReduction: risk?.whyItMatters || 'No major risk reduction is clear yet.',
    whatCanWait: input.realityModel.objects.find(object => object.intelligence.readiness === 'Ready')?.name || 'Items without schedule, safety, quality, or communication impact can wait.',
    whatShouldEscalate: escalation?.escalation || 'No escalation is required from current evidence.',
    whatShouldNotEscalate: context.risks?.find(item => !item.shouldEscalate)?.risk || 'Do not escalate low-confidence risks before verification.',
    incompleteEvidenceAction: constraint?.actionRequired || 'If evidence is incomplete, verify before acting.',
    noActionRationale: noActionRationale(input),
  };
}

export function summarizeExecutiveJudgment(
  judgment: PIEExecutiveJudgment,
  context: {
    decision?: PIEExecutiveDecision | null;
    risk?: PIEExecutiveRisk | null;
    opportunity?: PIEExecutiveOpportunity | null;
    escalationAnalysis?: PIEEscalationAnalysis | null;
    actionSafetyCheck?: PIEExecutiveActionSafetyCheck | null;
  } = {},
): string {
  const action = judgment.highestValueAction;
  const escalation = context.escalationAnalysis?.shouldEscalate
    ? `Escalate: ${context.escalationAnalysis.justification}`
    : `Do not escalate yet: ${context.escalationAnalysis?.justification || judgment.whatShouldNotEscalate}`;
  const nextStep = action?.score.readiness === 'Ready'
    ? action.action
    : action?.governance.whatWouldChangeRecommendation[0] ||
      judgment.bestActionIfEvidenceIncomplete;
  const whatNotToDo = action?.type === 'escalate' && context.escalationAnalysis?.shouldEscalate === false
    ? 'Do not escalate without verification.'
    : judgment.whatShouldNotEscalate;
  const why = action?.why || judgment.explanation.summary;

  return [
    `Highest-value action: ${action?.action || 'No executive action is ready.'}`,
    `Decision needed: ${context.decision?.decision || judgment.decisionNeeded}`,
    `Top risk: ${context.risk?.risk || 'No major risk is confirmed.'}`,
    `Top opportunity: ${context.opportunity?.opportunity || judgment.greatestValue}`,
    `Best next step: ${nextStep}`,
    `Can wait: ${judgment.whatCanWait}`,
    `Do not do: ${whatNotToDo}`,
    escalation,
    `Readiness: ${context.actionSafetyCheck?.readiness || judgment.readiness}`,
    `Why: ${why}`,
  ].join(' ');
}

export function performExecutiveActionSafetyCheck(
  input: PIEExecutiveJudgmentInput,
  context: {
    highestValueAction?: PIEExecutiveAction | null;
    escalationAnalysis?: PIEEscalationAnalysis | null;
    noActionReasoning?: PIENoActionReasoning | null;
    waitForEvidenceReasoning?: PIEWaitForEvidenceReasoning | null;
  } = {},
): PIEExecutiveActionSafetyCheck {
  const action = context.highestValueAction || null;
  const governance = action?.governance;
  const actionText = `${action?.action || ''} ${action?.why || ''}`;
  const realityContradiction = input.realityModel.objects.some(object =>
    object.currentStatus === 'contradicted' &&
    new RegExp(escapeRegExp(object.name), 'i').test(actionText)
  );
  const predictionIsWeak = input.predictiveReality?.confidence === 'low' ||
    input.predictiveReality?.readinessForecasts.some(forecast =>
      forecast.confidence === 'low' && new RegExp(escapeRegExp(forecast.summary), 'i').test(actionText)
    );
  const escalationRequested = action?.type === 'escalate';
  const escalationIsJustified = !escalationRequested ||
    Boolean(context.escalationAnalysis?.shouldEscalate && context.escalationAnalysis.evidenceStrongEnough);
  const missingEvidenceWasConsidered = Boolean(
    context.waitForEvidenceReasoning?.evidenceNeeded.length ||
    context.waitForEvidenceReasoning?.smallestEvidenceRequest ||
    input.missingEvidence?.highestImpactEvidenceGap ||
    governance?.whatWouldChangeRecommendation.length,
  );
  const noActionWasConsidered = Boolean(context.noActionReasoning || action?.type === 'no_action');
  const recommendationIsEvidenceBacked = Boolean(governance?.supportingEvidence.length);
  const alignsWithCurrentSituation = Boolean(
    input.situationIntelligence?.situationSummary.whatMattersNow ||
    input.situationIntelligence?.situationPriorities.length ||
    input.realityModel.summary.summary,
  );
  const reportWordingWillNotOverclaim =
    !predictionIsWeak &&
    (action?.score.readiness === 'Ready' || missingEvidenceWasConsidered || action?.type === 'no_action');
  const warnings = [
    recommendationIsEvidenceBacked ? null : 'Recommendation needs supporting evidence.',
    alignsWithCurrentSituation ? null : 'Recommendation is not clearly tied to the current situation.',
    realityContradiction ? 'Recommendation may contradict a current Reality Model object.' : null,
    predictionIsWeak ? 'Prediction is weak; do not overstate future impact.' : null,
    escalationIsJustified ? null : 'Escalation is not justified.',
    noActionWasConsidered ? null : 'No-action option was not considered.',
    missingEvidenceWasConsidered ? null : 'Missing evidence was not considered.',
    reportWordingWillNotOverclaim ? null : 'Report wording should avoid overclaiming.',
  ].filter((warning): warning is string => Boolean(warning));
  const finalRecommendationSafe = warnings.length === 0;
  const readiness: PIEExecutiveReadiness = finalRecommendationSafe
    ? action?.score.readiness || 'Ready'
    : escalationIsJustified && recommendationIsEvidenceBacked
      ? 'Needs Verification'
      : 'Uncertain';

  return {
    recommendationIsEvidenceBacked,
    alignsWithCurrentSituation,
    doesNotContradictRealityModel: !realityContradiction,
    doesNotOverstatePrediction: !predictionIsWeak,
    escalationIsJustified,
    noActionWasConsidered,
    missingEvidenceWasConsidered,
    reportWordingWillNotOverclaim,
    readiness,
    warnings,
    finalRecommendationSafe,
  };
}

export function analyzeExecutiveTradeoffs(
  input: PIEExecutiveJudgmentInput,
  actions: PIEExecutiveAction[] = [],
): PIETradeoffAnalysis {
  const options = compareExecutiveOptions(input, actions);
  const preferredOption = options[0] || null;
  const dimensions = identifyTradeoffDimensions(input, actions);
  const uncertaintyEfficientOption = [...options]
    .sort((left, right) => right.uncertaintyReduction - left.uncertaintyReduction)[0]?.label ||
    'Wait for evidence';
  const projectGoalProtectedBy = [...options]
    .sort((left, right) => right.projectGoalProtection - left.projectGoalProtection)[0]?.label ||
    'Monitor until a project goal is affected';
  const leastNoisyOption = [...options]
    .sort((left, right) => left.unnecessaryNoiseRisk - right.unnecessaryNoiseRisk)[0]?.label ||
    'Monitor until a clear trigger appears';

  return {
    summary: preferredOption
      ? `${preferredOption.label} creates the best current tradeoff across ${dimensions.join(', ')}.`
      : 'DAVE needs stronger evidence before comparing executive options.',
    dimensions,
    options,
    preferredOption,
    bestTotalOutcome: preferredOption?.label || 'No option is strong enough yet.',
    uncertaintyEfficientOption,
    projectGoalProtectedBy,
    leastNoisyOption,
    explanation: explainTradeoffDecision(input, preferredOption, options),
  };
}

export function compareExecutiveOptions(
  input: PIEExecutiveJudgmentInput,
  actions: PIEExecutiveAction[] = [],
): PIETradeoffOption[] {
  const actionOptions = actions.slice(0, 5).map(action => {
    const text = `${action.action} ${action.why}`;
    const isEscalation = action.type === 'escalate';
    const isNoAction = action.type === 'no_action';
    const uncertaintyReduction = action.score.uncertaintyReduced;
    const unnecessaryNoiseRisk = isEscalation
      ? (action.score.readiness === 'Ready' ? 5 : 10)
      : /communicat|report|owner|assign/i.test(text)
        ? 6
        : isNoAction || action.type === 'monitor'
          ? 1
          : 3;
    const projectGoalProtection = Math.max(
      action.score.riskReduced,
      action.score.scheduleImpact,
      action.score.safetyImpact,
      action.score.qualityImpact,
    );
    return {
      id: `option-${action.id}`,
      label: action.action,
      actionType: action.type,
      gains: [
        action.expectedOutcome,
        action.score.riskReduced >= 7 ? 'Reduces meaningful project risk.' : null,
        uncertaintyReduction >= 7 ? 'Reduces uncertainty efficiently.' : null,
        action.score.scheduleImpact >= 7 ? 'Protects schedule readiness.' : null,
      ].filter((item): item is string => Boolean(item)),
      losses: [
        action.score.effortRequired >= 6 ? 'Requires higher coordination effort.' : null,
        isEscalation ? 'May create communication noise if evidence is weak.' : null,
        unnecessaryNoiseRisk >= 7 ? 'Creates unnecessary noise without a clear trigger.' : null,
        isNoAction && /risk|blocked|overdue|safety/i.test(text)
          ? 'May allow a known risk to grow.'
          : null,
        action.score.reversibility <= 3 ? 'Harder to reverse after communication or approval.' : null,
      ].filter((item): item is string => Boolean(item)),
      uncertaintyReduction,
      projectGoalProtection,
      totalOutcomeScore: action.score.total,
      unnecessaryNoiseRisk,
    };
  });

  const hasWaitOption = actionOptions.some(option => option.actionType === 'wait');
  const hasNoActionOption = actionOptions.some(option => option.actionType === 'no_action');
  const explicitOptions = [
    ...actionOptions,
    hasWaitOption
      ? null
      : {
          id: 'option-wait-for-evidence',
          label: evaluateWaitForEvidenceOption(input).smallestEvidenceRequest,
          actionType: 'wait' as const,
          gains: ['Avoids acting on weak evidence.', 'Improves recommendation confidence.'],
          losses: ['May delay a time-sensitive decision.'],
          uncertaintyReduction: input.missingEvidence?.highestImpactEvidenceGap ? 9 : 5,
          projectGoalProtection: input.predictiveReality?.risks.length ? 6 : 4,
          totalOutcomeScore: input.missingEvidence?.highestImpactEvidenceGap ? 58 : 40,
          unnecessaryNoiseRisk: 2,
        },
    hasNoActionOption
      ? null
      : {
          id: 'option-no-action',
          label: 'Take no executive action right now.',
          actionType: 'no_action' as const,
          gains: ['Avoids unnecessary work and communication noise.'],
          losses: input.predictiveReality?.risks.length
            ? ['Risk may grow if the forecast is correct.']
            : ['May miss a low-visibility issue.'],
          uncertaintyReduction: 1,
          projectGoalProtection: input.predictiveReality?.risks.length ? 2 : 5,
          totalOutcomeScore: input.predictiveReality?.risks.length ? 22 : 46,
          unnecessaryNoiseRisk: 1,
        },
  ].filter((option): option is PIETradeoffOption => Boolean(option));

  return explicitOptions.sort((left, right) => right.totalOutcomeScore - left.totalOutcomeScore);
}

export function calculateOpportunityCost(
  input: PIEExecutiveJudgmentInput,
  chosenAction: PIEExecutiveAction | null,
  actions: PIEExecutiveAction[] = [],
): PIEOpportunityCost {
  const alternatives = actions
    .filter(action => action.id !== chosenAction?.id)
    .slice(0, 4)
    .map(action => action.action);
  const scheduleRisk = input.predictiveReality?.risks.find(risk =>
    /schedule|inspection|milestone|delay/i.test(risk.risk),
  );
  const weakEvidence = input.evidenceQuality?.evidenceReadiness &&
    !['strong', 'good'].includes(input.evidenceQuality.evidenceReadiness);

  return {
    chosenAction: chosenAction?.action || 'No executive action selected yet.',
    alternativesDelayed: alternatives.length ? alternatives : ['Monitor', 'Wait for evidence'],
    costOfActingNow: weakEvidence
      ? 'Acting now may use weak or incomplete evidence.'
      : 'Acting now may delay lower-priority monitoring work.',
    costOfWaiting: scheduleRisk
      ? `Waiting may allow ${scheduleRisk.risk} to grow.`
      : 'Waiting may delay useful clarity, but no major project impact is proven yet.',
    costOfEscalating: 'Escalating without a clear trigger may create noise and reduce focus.',
    costOfNoAction: noActionRationale(input),
    protectedValue:
      chosenAction?.expectedOutcome ||
      input.situationIntelligence?.situationSummary.whatMattersNow ||
      'Project focus is protected by avoiding low-value action.',
  };
}

export function analyzeEscalationNeed(
  input: PIEExecutiveJudgmentInput,
  risks: PIEExecutiveRisk[] = [],
  actions: PIEExecutiveAction[] = [],
): PIEEscalationAnalysis {
  const triggers = identifyEscalationTriggers(input, risks, actions);
  const presentTriggers = triggers.filter(trigger => trigger.present);
  const target = determineEscalationTarget(input, presentTriggers);
  const evidenceIsWeak = input.evidenceQuality?.evidenceReadiness &&
    !['strong', 'good'].includes(input.evidenceQuality.evidenceReadiness);
  const safetyTrigger = presentTriggers.some(trigger => /safety/i.test(trigger.trigger));
  const evidenceStrongEnough = !evidenceIsWeak || safetyTrigger ||
    presentTriggers.some(trigger => trigger.confidence === 'high');
  const escalationPolicy = policyAdjustment(input, 'escalation_threshold');
  const policyRaisedThreshold = /raise/i.test(escalationPolicy);
  const wisdomSaysNoEscalation = input.decisionMemory?.whenNotToActReasons.some(reason =>
    reason.reason === 'escalation_creates_noise' ||
    reason.reason === 'user_correction_history_suggests_caution' ||
    reason.reason === 'truth_over_speed'
  );
  const shouldEscalate = presentTriggers.length > 0 &&
    evidenceStrongEnough &&
    (!policyRaisedThreshold || safetyTrigger || presentTriggers.length > 1) &&
    (!wisdomSaysNoEscalation || safetyTrigger);

  return {
    shouldEscalate,
    timing: shouldEscalate ? 'now' : evidenceIsWeak ? 'after_verification' : 'monitor_only',
    target,
    triggers,
    evidenceStrongEnough,
    justification: shouldEscalate
      ? `${presentTriggers[0].trigger} is present and has enough support for escalation.`
      : evidenceIsWeak
        ? 'Escalation should wait until DAVE verifies the evidence unless safety risk becomes clear.'
        : policyRaisedThreshold
          ? 'Adaptive policy raised the escalation threshold for similar weak-outcome situations.'
        : wisdomSaysNoEscalation
          ? 'Decision Memory indicates escalation may create noise or violate truth over speed.'
        : 'Escalation is not justified from the current evidence.',
    evidenceRequiredBeforeEscalation: shouldEscalate
      ? []
      : [
          input.missingEvidence?.minimumEvidenceNeeded[0]?.minimumEvidence,
          input.evidenceTimeline?.staleAreas[0]?.recommendedEvidence,
          input.predictiveReality?.risks[0]?.verificationNeeded,
        ].filter((item): item is string => Boolean(item)).slice(0, 4),
    escalationRisk: shouldEscalate
      ? 'Escalation may interrupt local resolution, so the ask should be specific.'
      : 'Unnecessary escalation may create noise and reduce trust in DAVE recommendations.',
    localResolutionFirst: !shouldEscalate,
  };
}

export function identifyEscalationTriggers(
  input: PIEExecutiveJudgmentInput,
  risks: PIEExecutiveRisk[] = [],
  actions: PIEExecutiveAction[] = [],
): PIEEscalationTrigger[] {
  const hasBlockedDecision = input.situationIntelligence?.situationBlockers.length ||
    input.realityModel.objects.some(object => object.currentStatus === 'blocked');
  const ownerMissing = input.realityModel.objects.some(object => object.intelligence.ownerNeeded);
  const safetyRisk = risks.find(risk => /safety|hazard|unsafe/i.test(`${risk.risk} ${risk.whyItMatters}`));
  const scheduleRisk = risks.find(risk =>
    /schedule|inspection|milestone|delay|overdue/i.test(`${risk.risk} ${risk.whyItMatters}`) &&
    (risk.severity === 'critical' || risk.severity === 'high')
  );
  const repeatedIssue = input.patternIntelligence?.recurringIssues[0];
  const failedLowerAction = actions.some(action =>
    action.type === 'resolve_blocker' && action.score.readiness === 'Blocked'
  );
  const timingRequiresLeadership = input.predictiveReality?.risks.some(risk =>
    (risk.severity === 'critical' || risk.severity === 'high') &&
    /today|tomorrow|overdue|inspection|leadership|decision/i.test(`${risk.risk} ${risk.verificationNeeded}`)
  );
  const evidenceStrongEnough = input.evidenceQuality?.evidenceReadiness
    ? ['strong', 'good'].includes(input.evidenceQuality.evidenceReadiness)
    : Boolean(risks.some(risk => risk.confidence === 'high'));

  return [
    {
      id: 'trigger-blocked-decision',
      trigger: 'decision is blocked',
      present: Boolean(hasBlockedDecision),
      evidence: input.situationIntelligence?.situationBlockers[0]?.blocker || 'No blocked decision is visible.',
      confidence: hasBlockedDecision ? 'medium' : 'low',
    },
    {
      id: 'trigger-owner-missing',
      trigger: 'owner is missing',
      present: ownerMissing,
      evidence: input.realityModel.objects.find(object => object.intelligence.ownerNeeded)?.name ||
        'No missing owner is visible.',
      confidence: ownerMissing ? 'medium' : 'low',
    },
    {
      id: 'trigger-safety-risk',
      trigger: 'safety risk is present',
      present: Boolean(safetyRisk),
      evidence: safetyRisk?.whyItMatters || 'No safety escalation trigger is visible.',
      confidence: safetyRisk?.confidence || 'low',
    },
    {
      id: 'trigger-schedule-impact',
      trigger: 'schedule impact is meaningful',
      present: Boolean(scheduleRisk),
      evidence: scheduleRisk?.whyItMatters || 'No high-impact schedule trigger is visible.',
      confidence: scheduleRisk?.confidence || 'low',
    },
    {
      id: 'trigger-repeated-issue',
      trigger: 'repeated issue is not resolving',
      present: Boolean(repeatedIssue),
      evidence: repeatedIssue?.summary || 'No repeated unresolved issue is visible.',
      confidence: repeatedIssue?.confidence || 'low',
    },
    {
      id: 'trigger-lower-action-failed',
      trigger: 'lower-level action has failed',
      present: failedLowerAction,
      evidence: failedLowerAction ? 'A local resolution action is blocked.' : 'No failed lower-level action is visible.',
      confidence: failedLowerAction ? 'medium' : 'low',
    },
    {
      id: 'trigger-leadership-timing',
      trigger: 'timing requires leadership action',
      present: Boolean(timingRequiresLeadership),
      evidence: input.predictiveReality?.risks[0]?.verificationNeeded || 'No leadership timing trigger is visible.',
      confidence: timingRequiresLeadership ? 'medium' : 'low',
    },
    {
      id: 'trigger-evidence-strong-enough',
      trigger: 'evidence is strong enough to justify escalation',
      present: evidenceStrongEnough,
      evidence: input.evidenceQuality?.summary || 'Evidence strength is not established yet.',
      confidence: evidenceStrongEnough ? 'high' : 'low',
    },
  ];
}

export function determineEscalationTarget(
  input: PIEExecutiveJudgmentInput,
  triggers: PIEEscalationTrigger[] = [],
): PIEEscalationTarget {
  const safety = triggers.find(trigger => /safety/i.test(trigger.trigger) && trigger.present);
  const owner = triggers.find(trigger => /owner/i.test(trigger.trigger) && trigger.present);
  const schedule = triggers.find(trigger => /schedule/i.test(trigger.trigger) && trigger.present);
  if (safety) {
    return {
      role: 'Safety owner or project leadership',
      reason: safety.evidence,
      ask: 'Confirm safety status, required control, and responsible owner.',
    };
  }
  if (owner) {
    return {
      role: 'Responsible project owner',
      reason: owner.evidence,
      ask: 'Assign an owner and confirm the next action.',
    };
  }
  if (schedule) {
    return {
      role: 'Project leadership or scheduler',
      reason: schedule.evidence,
      ask: 'Confirm schedule impact and recovery action.',
    };
  }
  return {
    role: 'Project record',
    reason: input.situationIntelligence?.situationSummary.whatMattersNow || 'No escalation owner is justified yet.',
    ask: 'Monitor until evidence supports a specific escalation ask.',
  };
}

export function evaluateDecisionTiming(
  input: PIEExecutiveJudgmentInput,
  highestValueAction: PIEExecutiveAction | null = null,
  escalationAnalysis: PIEEscalationAnalysis = analyzeEscalationNeed(input),
  waitForEvidenceReasoning: PIEWaitForEvidenceReasoning = evaluateWaitForEvidenceOption(input),
): PIEDecisionTiming {
  const urgentRisk = input.predictiveReality?.risks.find(risk =>
    risk.severity === 'critical' || /tomorrow|today|overdue|safety/i.test(`${risk.risk} ${risk.verificationNeeded}`)
  );
  const whatCannotWait = [
    urgentRisk?.risk,
    input.situationIntelligence?.situationBlockers[0]?.blocker,
  ].filter((item): item is string => Boolean(item));
  const whatCanWait = [
    input.realityModel.intelligence.objectsReady[0]?.name,
    input.situationIntelligence?.situationOpportunities[0]?.opportunity,
  ].filter((item): item is string => Boolean(item));

  if (escalationAnalysis.shouldEscalate) {
    return {
      recommendation: 'escalate_now',
      reason: escalationAnalysis.justification,
      timeSensitivity: 'immediate',
      decisionWindow: 'Escalate before the risk or blocker grows.',
      whatCanWait,
      whatCannotWait,
    };
  }
  if (waitForEvidenceReasoning.shouldWaitForEvidence) {
    return {
      recommendation: 'wait_for_evidence',
      reason: waitForEvidenceReasoning.reason,
      timeSensitivity: urgentRisk ? 'today' : 'soon',
      decisionWindow: urgentRisk ? 'Collect evidence today before deciding.' : 'Collect evidence before communicating a conclusion.',
      whatCanWait,
      whatCannotWait,
    };
  }
  if (highestValueAction?.type === 'no_action' || highestValueAction?.type === 'monitor') {
    return {
      recommendation: 'monitor',
      reason: highestValueAction.why,
      timeSensitivity: 'can_wait',
      decisionWindow: 'Monitor until risk, owner, schedule, safety, or quality changes.',
      whatCanWait,
      whatCannotWait,
    };
  }
  return {
    recommendation: highestValueAction?.score.readiness === 'Ready' ? 'act_now' : 'defer',
    reason: highestValueAction?.why || 'No executive action is ready yet.',
    timeSensitivity: urgentRisk ? 'today' : 'soon',
    decisionWindow: highestValueAction?.score.readiness === 'Ready'
      ? 'Act while evidence supports the recommendation.'
      : 'Defer until readiness improves.',
    whatCanWait,
    whatCannotWait,
  };
}

export function evaluateNoActionOption(
  input: PIEExecutiveJudgmentInput,
  risks: PIEExecutiveRisk[] = [],
  constraints: PIEExecutiveConstraint[] = [],
): PIENoActionReasoning {
  const blockingRisk = risks.find(risk => risk.severity === 'critical' || risk.shouldEscalate);
  const missingConstraint = constraints[0];
  const issueResolving = input.realityModel.objects.some(object =>
    /resolv|complete|ready|improving/i.test(`${object.currentStatus} ${object.currentState.summary} ${object.intelligence.momentum}`)
  );
  const lowImpact = !blockingRisk &&
    !input.predictiveReality?.risks.some(risk => risk.severity === 'critical' || risk.severity === 'high') &&
    !input.situationIntelligence?.situationBlockers.length;
  const irreversibleRisk = risks.some(risk =>
    /irreversible|approval|communicat|send|reject/i.test(`${risk.risk} ${risk.whyItMatters}`)
  );
  const isValid = lowImpact && !input.situationIntelligence?.situationBlockers.length;

  return {
    isValid,
    reason: isValid
      ? 'No action is valid when current evidence does not show meaningful schedule, safety, quality, communication, or decision risk.'
      : 'No action is not preferred because a risk, blocker, or missing decision could grow.',
    conditions: [
      'No safety risk is present.',
      'No owner-blocked decision is waiting.',
      'No schedule impact is likely to grow.',
      issueResolving ? 'Issue is already resolving.' : null,
      lowImpact ? 'Likely impact is low and monitoring is enough.' : null,
      missingConstraint ? `Missing evidence is monitored: ${missingConstraint.constraint}` : null,
    ].filter((item): item is string => Boolean(item)),
    monitoringNeeded: [
      input.predictiveReality?.risks[0]?.verificationNeeded,
      input.evidenceTimeline?.staleAreas[0]?.recommendedEvidence,
      input.situationIntelligence?.situationSummary.whatNeedsVerification,
    ].filter((item): item is string => Boolean(item)).slice(0, 4),
    whenWaitingIsBetter: [
      input.evidenceQuality?.evidenceReadiness && !['strong', 'good'].includes(input.evidenceQuality.evidenceReadiness)
        ? 'Evidence is too weak.'
        : null,
      issueResolving ? 'Issue is already resolving.' : null,
      'Escalation would create noise without a clear trigger.',
      'Risk is low and monitoring is enough.',
      /inspection/i.test(input.situationIntelligence?.situationSummary.whatMattersNow || '')
        ? 'Action should wait until inspection result.'
        : null,
      missingConstraint ? 'User needs one more piece of evidence first.' : null,
      irreversibleRisk ? 'Action is not reversible.' : null,
      lowImpact ? 'Likely impact is low.' : null,
    ].filter((item): item is string => Boolean(item)),
    unnecessaryActionRisks: [
      'Escalation creates unnecessary noise when no trigger is present.',
      irreversibleRisk ? 'Irreversible communication or approval may be premature.' : null,
      lowImpact ? 'Action may consume attention without improving the project state.' : null,
    ].filter((item): item is string => Boolean(item)),
    riskIfWrong: blockingRisk?.whyItMatters || 'The main risk is missing a low-visibility change before it affects the project.',
  };
}

export function evaluateWaitForEvidenceOption(
  input: PIEExecutiveJudgmentInput,
  constraints: PIEExecutiveConstraint[] = [],
  actions: PIEExecutiveAction[] = [],
): PIEWaitForEvidenceReasoning {
  const missing = input.missingEvidence?.highestImpactEvidenceGap;
  const weakEvidence = input.evidenceQuality?.evidenceReadiness &&
    !['strong', 'good'].includes(input.evidenceQuality.evidenceReadiness);
  const nonEvidenceAction = actions.find(action =>
    action.type !== 'capture_evidence' &&
    action.type !== 'verify' &&
    action.type !== 'no_action' &&
    action.score.readiness !== 'Ready'
  );
  const smallestEvidenceRequest =
    input.missingEvidence?.minimumEvidenceNeeded[0]?.suggestedCaptureAction ||
    constraints[0]?.actionRequired ||
    input.evidenceTimeline?.staleAreas[0]?.recommendedEvidence ||
    'Collect one current piece of evidence before deciding.';

  return {
    shouldWaitForEvidence: Boolean(missing || weakEvidence || nonEvidenceAction),
    reason: missing?.whyItMatters ||
      (weakEvidence ? 'Current evidence is not strong enough for a final executive action.' : 'Waiting is optional; evidence does not clearly block the decision.'),
    evidenceNeeded: [
      missing?.smallestEvidenceRequest,
      constraints[0]?.limits,
      input.evidenceTimeline?.staleAreas[0]?.recommendedEvidence,
      input.predictiveReality?.risks[0]?.verificationNeeded,
    ].filter((item): item is string => Boolean(item)).slice(0, 5),
    smallestEvidenceRequest,
    decisionBlocked: missing?.decisionAffected || nonEvidenceAction?.action || 'No decision is blocked by missing evidence.',
    actionAfterEvidence: nonEvidenceAction?.action || 'Re-score executive actions after the evidence arrives.',
  };
}

export function explainTradeoffDecision(
  input: PIEExecutiveJudgmentInput,
  preferredOption: PIETradeoffOption | null,
  options: PIETradeoffOption[] = [],
): string {
  if (!preferredOption) {
    return 'DAVE cannot compare options until stronger evidence is available.';
  }
  const nextBest = options.find(option => option.id !== preferredOption.id);
  const evidenceBoundary = input.evidenceQuality?.evidenceReadiness &&
    !['strong', 'good'].includes(input.evidenceQuality.evidenceReadiness)
    ? ' Evidence is not strong, so DAVE favors verification before irreversible action.'
    : '';
  const noiseBoundary = preferredOption.unnecessaryNoiseRisk <= 3
    ? ' It also avoids unnecessary noise.'
    : ' DAVE should watch for unnecessary communication noise.';
  return `${preferredOption.label} wins because it protects the project goal while managing uncertainty.${nextBest ? ` It beats ${nextBest.label} because ${preferredOption.gains[0] || 'it creates more value'}.` : ''}${noiseBoundary}${evidenceBoundary}`;
}

function buildExecutiveTradeoffs(
  input: PIEExecutiveJudgmentInput,
  context: {
    priorities?: PIEExecutivePriority[];
    risks?: PIEExecutiveRisk[];
    opportunities?: PIEExecutiveOpportunity[];
  },
): PIEExecutiveTradeoff[] {
  const risk = context.risks?.[0];
  const opportunity = context.opportunities?.[0];
  const priority = context.priorities?.[0];
  return [
    {
      id: 'tradeoff-act-vs-verify',
      optionA: risk ? `Act on ${risk.risk}` : 'Act now',
      optionB: 'Verify first',
      optionAStrength: risk?.whyItMatters || opportunity?.valueCreated || 'Acting now may create schedule or communication value.',
      optionBStrength: input.missingEvidence?.minimumEvidenceNeeded[0]?.suggestedCaptureAction || 'Verification reduces uncertainty.',
      preferredOption: input.evidenceQuality?.evidenceReadiness === 'strong' ? 'Act now' : 'Verify first',
      whyAlternativeLost: input.evidenceQuality?.evidenceReadiness === 'strong'
        ? 'Waiting may delay a ready action.'
        : 'Acting now relies on incomplete evidence.',
    },
    {
      id: 'tradeoff-escalate-vs-monitor',
      optionA: 'Escalate',
      optionB: 'Monitor',
      optionAStrength: risk?.shouldEscalate ? 'Escalation may reduce growing risk.' : 'Escalation creates visibility.',
      optionBStrength: 'Monitoring avoids unnecessary noise.',
      preferredOption: risk?.shouldEscalate ? 'Escalate' : 'Monitor',
      whyAlternativeLost: risk?.shouldEscalate
        ? 'Monitoring may allow the risk to grow.'
        : 'Escalation is not justified without high-impact evidence.',
    },
  ].filter(tradeoff => priority || risk || opportunity);
}

function identifyTradeoffDimensions(
  input: PIEExecutiveJudgmentInput,
  actions: PIEExecutiveAction[],
): PIETradeoffDimension[] {
  const text = [
    ...actions.map(action => `${action.action} ${action.why}`),
    input.situationIntelligence?.situationSummary.whatMattersNow,
    input.predictiveReality?.predictiveRealitySummary,
    input.missingEvidence?.summary,
  ].filter(Boolean).join(' ');
  const dimensions: PIETradeoffDimension[] = [
    'risk_vs_progress',
    'evidence_vs_time',
  ];
  if (/quality|inspect|verification|rework/i.test(text)) dimensions.push('speed_vs_quality');
  if (/cost|budget|schedule|delay/i.test(text)) dimensions.push('cost_vs_schedule');
  if (/safety|hazard|unsafe/i.test(text)) dimensions.push('safety_vs_productivity');
  if (/communicat|report|owner|escalat/i.test(text)) dimensions.push('communication_vs_noise');
  if (/temporary|short|long|closeout|certificate/i.test(text)) dimensions.push('short_term_vs_long_term');
  if (/escalat|local|owner/i.test(text)) dimensions.push('escalation_vs_local_resolution');
  return Array.from(new Set(dimensions));
}

function identifyExecutiveResourceNeeds(
  input: PIEExecutiveJudgmentInput,
): PIEExecutiveResourceNeed[] {
  return input.realityModel.objects
    .filter(object => object.intelligence.ownerNeeded)
    .slice(0, 6)
    .map((object, index) => ({
      id: `resource-owner-${index + 1}`,
      resource: `Owner for ${object.name}`,
      reason: object.intelligence.nextBestAction.reason,
      ownerNeeded: true,
      urgency: urgencyFromObject(object),
    }));
}

function identifyExecutiveEscalations(
  risks: PIEExecutiveRisk[],
): PIEExecutiveEscalation[] {
  return risks.slice(0, 6).map((risk, index) => ({
    id: `escalation-${index + 1}`,
    escalation: risk.risk,
    shouldEscalate: risk.shouldEscalate,
    why: risk.whyItMatters,
    target: risk.shouldEscalate ? 'Project leadership or responsible owner' : 'Project record only',
  }));
}

function actionFromRisk(
  risk: PIEExecutiveRisk,
  input: PIEExecutiveJudgmentInput,
  tradeoffs: PIEExecutiveTradeoff[],
): PIEExecutiveAction {
  const type: PIEExecutiveActionType = risk.shouldEscalate ? 'escalate' : 'verify';
  const action = risk.shouldEscalate
    ? `Escalate ${risk.risk}.`
    : `Verify ${risk.risk}.`;
  return createAction({
    id: `action-risk-${risk.id}`,
    type,
    action,
    why: risk.whyItMatters,
    expectedOutcome: risk.shouldEscalate ? 'Risk owner responds before impact grows.' : 'Risk is verified before escalation.',
    successMeasure: 'Risk status, owner, and next step are confirmed.',
    input,
    tradeoffs,
    evidence: [risk.whyItMatters],
    uncertainty: [input.missingEvidence?.summary, input.predictiveReality?.risks[0]?.verificationNeeded],
  });
}

function actionFromOpportunity(
  opportunity: PIEExecutiveOpportunity,
  input: PIEExecutiveJudgmentInput,
  tradeoffs: PIEExecutiveTradeoff[],
): PIEExecutiveAction {
  return createAction({
    id: `action-opportunity-${opportunity.id}`,
    type: actionTypeFromText(opportunity.action),
    action: opportunity.action,
    why: opportunity.valueCreated,
    expectedOutcome: opportunity.opportunity,
    successMeasure: 'Expected readiness or recovery change is confirmed.',
    input,
    tradeoffs,
    evidence: [opportunity.valueCreated],
    uncertainty: [input.predictiveReality?.recoveryForecast.realityEvolution.verificationNeeded],
  });
}

function actionFromConstraint(
  constraint: PIEExecutiveConstraint,
  input: PIEExecutiveJudgmentInput,
  tradeoffs: PIEExecutiveTradeoff[],
): PIEExecutiveAction {
  return createAction({
    id: `action-constraint-${constraint.id}`,
    type: 'capture_evidence',
    action: constraint.actionRequired,
    why: constraint.limits,
    expectedOutcome: 'DAVE can make a stronger executive recommendation after the constraint is cleared.',
    successMeasure: 'Missing evidence, owner, status, or readiness is confirmed.',
    input,
    tradeoffs,
    evidence: [constraint.constraint],
    uncertainty: [constraint.limits],
  });
}

function actionFromPriority(
  priority: PIEExecutivePriority,
  input: PIEExecutiveJudgmentInput,
  tradeoffs: PIEExecutiveTradeoff[],
): PIEExecutiveAction {
  return createAction({
    id: `action-priority-${priority.id}`,
    type: actionTypeFromText(priority.priority + priority.reason),
    action: `Focus on ${priority.priority}.`,
    why: priority.reason,
    expectedOutcome: priority.goalSupported,
    successMeasure: 'Priority has a confirmed owner, evidence, and next step.',
    input,
    tradeoffs,
    evidence: [priority.reason],
    uncertainty: [input.situationIntelligence?.situationSummary.whatNeedsVerification],
  });
}

function actionFromDecision(
  decision: PIEExecutiveDecision,
  input: PIEExecutiveJudgmentInput,
  tradeoffs: PIEExecutiveTradeoff[],
): PIEExecutiveAction {
  return createAction({
    id: `action-decision-${decision.id}`,
    type: decision.options[0] || 'verify',
    action: `Decide: ${decision.decision}.`,
    why: decision.whyNow,
    expectedOutcome: 'Decision path is clear and user-approved.',
    successMeasure: 'Decision is accepted, rejected, deferred, or assigned.',
    input,
    tradeoffs,
    evidence: [decision.whyNow],
    uncertainty: [input.beliefSystem?.beliefsNeedingVerification[0]?.explanation.readinessReason],
  });
}

function noActionCandidate(
  input: PIEExecutiveJudgmentInput,
  context: {
    risks?: PIEExecutiveRisk[];
    constraints?: PIEExecutiveConstraint[];
    tradeoffs?: PIEExecutiveTradeoff[];
  },
): PIEExecutiveAction {
  return createAction({
    id: 'action-no-action',
    type: 'no_action',
    action: 'Take no executive action right now.',
    why: noActionRationale(input),
    expectedOutcome: 'DAVE continues monitoring without creating unnecessary work.',
    successMeasure: 'No schedule, safety, quality, communication, or decision risk grows.',
    input,
    tradeoffs: context.tradeoffs || [],
    evidence: ['No high-confidence executive action may be ready.'],
    uncertainty: [context.constraints?.[0]?.limits, context.risks?.[0]?.whyItMatters],
  });
}

function createAction(input: {
  id: string;
  type: PIEExecutiveActionType;
  action: string;
  why: string;
  expectedOutcome: string;
  successMeasure: string;
  input: PIEExecutiveJudgmentInput;
  tradeoffs: PIEExecutiveTradeoff[];
  evidence: Array<string | null | undefined>;
  uncertainty: Array<string | null | undefined>;
}): PIEExecutiveAction {
  const supportingEvidence = input.evidence.filter((item): item is string => Boolean(item));
  const uncertainty = input.uncertainty.filter((item): item is string => Boolean(item));
  const alternatives = input.tradeoffs.map(tradeoff => tradeoff.optionA === input.action ? tradeoff.optionB : tradeoff.optionA);
  const score = defaultActionScore(input.type);
  return {
    id: input.id,
    type: input.type,
    action: input.action,
    why: input.why,
    expectedOutcome: input.expectedOutcome,
    successMeasure: input.successMeasure,
    score,
    governance: {
      recommendation: input.action,
      why: input.why,
      supportingEvidence,
      assumptions: buildAssumptions(input.input),
      uncertainty,
      alternativesConsidered: alternatives.length ? alternatives : ['Wait', 'Verify first', 'No action'],
      whyAlternativesLost: input.tradeoffs.map(tradeoff => tradeoff.whyAlternativeLost),
      tradeoffs: input.tradeoffs,
      expectedOutcome: input.expectedOutcome,
      successMeasure: input.successMeasure,
      whatWouldChangeRecommendation: buildWhatWouldChange(input.input),
    },
    confidence: confidenceFromReadiness(score.readiness, input.input),
  };
}

function scoreAction(
  action: PIEExecutiveAction,
  input: PIEExecutiveJudgmentInput,
): PIEExecutiveActionScore {
  const type = action.type;
  const readiness = readinessForAction(action, input);
  const confidenceCalibration = policyAdjustment(input, 'confidence_calibration');
  const wisdomCaution = input.decisionMemory?.whenNotToActReasons[0];
  const escalationTriggers = type === 'escalate'
    ? identifyEscalationTriggers(input, identifyExecutiveRisks(input), [action]).filter(trigger => trigger.present)
    : [];
  const escalationPolicyRaised = /raise/i.test(policyAdjustment(input, 'escalation_threshold'));
  const escalationIsJustified = type !== 'escalate' ||
    (escalationTriggers.length > 0 && (!escalationPolicyRaised || escalationTriggers.length > 1));
  const score: Omit<PIEExecutiveActionScore, 'total' | 'readiness' | 'readinessReason'> = {
    valueCreated: type === 'no_action' ? (wisdomCaution ? 5 : 1) : valueScore(action, input),
    riskReduced: /risk|block|escalat|recover/i.test(`${action.action} ${action.why}`) ? (escalationIsJustified ? 9 : 3) : 4,
    uncertaintyReduced: type === 'capture_evidence' || type === 'verify' ? 9 : 5,
    scheduleImpact: /schedule|critical|overdue|inspection|milestone/i.test(`${action.action} ${action.why}`) ? 8 : 3,
    safetyImpact: /safety|hazard|unsafe/i.test(`${action.action} ${action.why}`) ? 10 : 2,
    qualityImpact: /quality|rework|inspect|verification/i.test(`${action.action} ${action.why}`) ? 7 : 3,
    communicationImpact: /communicat|report|owner|assign|escalat/i.test(`${action.action} ${action.why}`) ? (escalationIsJustified ? 8 : 2) : 3,
    effortRequired: effortScore(type) + (escalationIsJustified ? 0 : 5) + (wisdomCaution && type !== 'no_action' && type !== 'wait' && type !== 'verify' && type !== 'capture_evidence' ? 3 : 0),
    urgency: urgencyScoreFromAction(action),
    reversibility: type === 'communicate' || type === 'approve' || type === 'reject' ? 3 : 8,
    confidenceReadiness: Math.max(1, readinessScore(readiness) + (/lower/i.test(confidenceCalibration) || wisdomCaution ? -2 : /raise/i.test(confidenceCalibration) ? 1 : 0)),
    downstreamEffect: input.predictiveReality?.cascadingEffects.length ? 8 : 4,
  };
  const total =
    score.valueCreated +
    score.riskReduced +
    score.uncertaintyReduced +
    score.scheduleImpact +
    score.safetyImpact +
    score.qualityImpact +
    score.communicationImpact +
    score.urgency +
    score.reversibility +
    score.confidenceReadiness +
    score.downstreamEffect -
    score.effortRequired;

  return {
    ...score,
    total,
    readiness,
    readinessReason: readinessReason(readiness, action, input),
  };
}

function defaultActionScore(type: PIEExecutiveActionType): PIEExecutiveActionScore {
  return {
    valueCreated: type === 'no_action' ? 1 : 5,
    riskReduced: 5,
    uncertaintyReduced: 5,
    scheduleImpact: 3,
    safetyImpact: 2,
    qualityImpact: 3,
    communicationImpact: 3,
    effortRequired: effortScore(type),
    urgency: 4,
    reversibility: 7,
    confidenceReadiness: 5,
    downstreamEffect: 4,
    total: 0,
    readiness: 'Needs Verification',
    readinessReason: 'Scoring has not been finalized yet.',
  };
}

function readinessForAction(
  action: PIEExecutiveAction,
  input: PIEExecutiveJudgmentInput,
): PIEExecutiveReadiness {
  if (action.type === 'no_action') {
    return (input.predictiveReality?.risks.length || input.situationIntelligence?.situationBlockers.length)
      ? 'Uncertain'
      : 'Ready';
  }
  if (input.situationIntelligence?.situationState === 'blocked') return 'Blocked';
  if (input.missingEvidence?.highestImpactEvidenceGap && (action.type !== 'capture_evidence' && action.type !== 'verify')) {
    return 'Needs Verification';
  }
  if (input.evidenceQuality?.evidenceReadiness === 'strong' || input.evidenceQuality?.evidenceReadiness === 'good') {
    return 'Ready';
  }
  if (input.beliefSystem?.beliefReadiness === 'Blocked') return 'Blocked';
  if (input.beliefSystem?.beliefReadiness === 'Uncertain') return 'Uncertain';
  return 'Needs Verification';
}

function readinessFromInputs(input: PIEExecutiveJudgmentInput): PIEExecutiveReadiness {
  if (input.situationIntelligence?.situationState === 'blocked') return 'Blocked';
  if (input.missingEvidence?.highestImpactEvidenceGap) return 'Needs Verification';
  if (input.evidenceQuality?.evidenceReadiness === 'strong' || input.realityModel.summary.confidence === 'high') return 'Ready';
  return 'Uncertain';
}

function readinessFromConfidence(confidence: ProjectConfidenceLevel): PIEExecutiveReadiness {
  if (confidence === 'high') return 'Ready';
  if (confidence === 'medium') return 'Needs Verification';
  return 'Uncertain';
}

function confidenceFromReadiness(
  readiness: PIEExecutiveReadiness,
  input: PIEExecutiveJudgmentInput,
): ProjectConfidenceLevel {
  if (readiness === 'Ready') return input.realityModel.summary.confidence === 'low' ? 'medium' : 'high';
  if (readiness === 'Blocked' || readiness === 'Uncertain') return 'low';
  return 'medium';
}

function readinessReason(
  readiness: PIEExecutiveReadiness,
  action: PIEExecutiveAction,
  input: PIEExecutiveJudgmentInput,
) {
  if (readiness === 'Ready') return 'Evidence is strong enough for user-reviewed action.';
  if (readiness === 'Blocked') return input.situationIntelligence?.situationReadiness.reason || 'A blocker prevents confident action.';
  if (readiness === 'Uncertain') return 'DAVE does not have enough confidence to treat this as final.';
  return action.type === 'capture_evidence' || action.type === 'verify'
    ? 'This action is appropriate because evidence is incomplete.'
    : 'Verify before treating this action as final.';
}

function buildAssumptions(input: PIEExecutiveJudgmentInput) {
  return [
    input.situationIntelligence?.situationSummary.whatIsHappening,
    input.predictiveReality?.predictiveRealitySummary,
    input.beliefSystem?.strongestBeliefs[0]?.statement,
  ].filter((item): item is string => Boolean(item)).slice(0, 5);
}

function buildWhatWouldChange(input: PIEExecutiveJudgmentInput) {
  return [
    input.missingEvidence?.minimumEvidenceNeeded[0]?.suggestedCaptureAction,
    input.predictiveReality?.recoveryForecast.realityEvolution.verificationNeeded,
    input.beliefSystem?.beliefsNeedingVerification[0]?.recommendedEvidence[0],
    input.evidenceTimeline?.staleAreas[0]?.recommendedEvidence,
  ].filter((item): item is string => Boolean(item)).slice(0, 5);
}

function noActionRationale(input: PIEExecutiveJudgmentInput) {
  if (
    input.predictiveReality?.risks.length ||
    input.situationIntelligence?.situationBlockers.length ||
    input.missingEvidence?.highestImpactEvidenceGap
  ) {
    return 'No action is only correct after verifying that current risks, blockers, and missing evidence do not affect schedule, safety, quality, or communication.';
  }

  return 'No action is correct when no high-value action is ready and monitoring preserves focus.';
}

function actionTypeFromText(text: string): PIEExecutiveActionType {
  if (/photo|evidence|capture/i.test(text)) return 'capture_evidence';
  if (/escalat/i.test(text)) return 'escalate';
  if (/communicat|report/i.test(text)) return 'communicate';
  if (/owner|assign/i.test(text)) return 'assign_owner';
  if (/approve/i.test(text)) return 'approve';
  if (/reject/i.test(text)) return 'reject';
  if (/recover|schedule/i.test(text)) return 'recover_schedule';
  if (/block|resolve/i.test(text)) return 'resolve_blocker';
  if (/inspect|inspection/i.test(text)) return 'inspect';
  if (/defer/i.test(text)) return 'defer';
  if (/wait/i.test(text)) return 'wait';
  if (/monitor/i.test(text)) return 'monitor';
  return 'verify';
}

function valueScore(action: PIEExecutiveAction, input: PIEExecutiveJudgmentInput) {
  const text = `${action.action} ${action.why}`;
  let score = 5;
  if (/critical|blocked|risk|safety/i.test(text)) score += 3;
  if (/schedule|inspection|owner|communication/i.test(text)) score += 2;
  if (input.predictiveReality?.risks[0]) score += 1;
  return Math.min(10, score);
}

function effortScore(type: PIEExecutiveActionType) {
  if (type === 'no_action' || type === 'monitor' || type === 'wait') return 1;
  if (type === 'verify' || type === 'capture_evidence' || type === 'assign_owner') return 3;
  if (type === 'communicate' || type === 'approve' || type === 'defer') return 4;
  return 6;
}

function urgencyScoreFromAction(action: PIEExecutiveAction) {
  if (/critical|blocked|safety|overdue|tomorrow/i.test(`${action.action} ${action.why}`)) return 10;
  if (/risk|schedule|inspection|owner/i.test(`${action.action} ${action.why}`)) return 7;
  return 4;
}

function urgencyFromObject(object: PIERealityObject): PIEExecutivePriority['urgency'] {
  if (object.intelligence.riskLevel === 'critical' || object.currentStatus === 'blocked') return 'critical';
  if (object.intelligence.riskLevel === 'high' || object.currentStatus === 'at_risk') return 'high';
  if (object.intelligence.readiness !== 'Ready') return 'medium';
  return 'low';
}

function urgencyScore(urgency: PIEExecutivePriority['urgency']) {
  if (urgency === 'critical') return 4;
  if (urgency === 'high') return 3;
  if (urgency === 'medium') return 2;
  return 1;
}

function confidenceScore(confidence: ProjectConfidenceLevel) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;
  return 1;
}

function readinessScore(readiness: PIERealityReadiness | PIEExecutiveReadiness) {
  if (readiness === 'Ready') return 10;
  if (readiness === 'Needs Verification') return 6;
  if (readiness === 'Uncertain') return 3;
  return 1;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function policyAdjustment(
  input: PIEExecutiveJudgmentInput,
  area: PIEAdaptivePolicy['area'],
) {
  return input.adaptivePolicies?.find(policy => policy.area === area)?.proposedAdjustment || '';
}

function uniquePriorities(priorities: PIEExecutivePriority[]) {
  const seen = new Set<string>();
  return priorities.filter(priority => {
    const key = priority.priority.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueRisks(risks: PIEExecutiveRisk[]) {
  const seen = new Set<string>();
  return risks.filter(risk => {
    const key = risk.risk.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
