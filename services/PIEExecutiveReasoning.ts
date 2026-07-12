import type {
  PIEBelief,
  PIEBeliefEngineResult,
  PIEBeliefReadiness,
} from './PIEBeliefEngine';
import type { PIEDeliberationResult } from './PIEDeliberationEngine';
import type { PIEMemoryRecallResult } from './PIEMemoryRecall';
import type {
  PIEPatternIntelligence,
  PIEPatternRecommendation,
  PIEPatternWarning,
} from './PIEPatternEngine';
import type { PIERuntimeState } from './PIERuntime';
import type {
  PIEDecisionQualityScore,
  PIEScientificResult,
} from './PIEScientificMethod';
import type { PIEPredictionResult } from './PIEPredictiveEngine';
import type { PIEPredictiveRealityResult } from './PIEPredictiveReality';
import type {
  PIERealityModel,
  PIERealityObjectIntelligenceResult,
} from './PIERealityModel';
import type { PIESituationResult } from './PIESituationIntelligence';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEExecutiveReadiness =
  | 'Ready'
  | 'Needs Verification'
  | 'Uncertain'
  | 'Blocked';

export type PIEExecutiveDecisionScore = {
  expectedValue: number;
  riskReduction: number;
  uncertaintyReduction: number;
  scheduleImpact: number;
  safetyImpact: number;
  communicationImpact: number;
  effortLevel: 'low' | 'medium' | 'high';
  total: number;
  readiness: PIEExecutiveReadiness;
  whyRecommended: string;
};

export type PIEExecutiveRisk = {
  id: string;
  risk: string;
  whyItMatters: string;
  likelyToGrow: boolean;
  source: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutivePriority = {
  id: string;
  priority: string;
  reason: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  recommendedAction: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveDecisionNeed = {
  id: string;
  decisionNeeded: string;
  whyNow: string;
  options: string[];
  owner: string;
  readiness: PIEExecutiveReadiness;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveOpportunity = {
  id: string;
  opportunity: string;
  valueCreated: string;
  recommendedAction: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveConcern = {
  id: string;
  concern: string;
  category:
    | 'schedule'
    | 'inspection'
    | 'contractor'
    | 'communication'
    | 'safety'
    | 'belief'
    | 'evidence'
    | 'other';
  whyItMatters: string;
  recommendedVerification: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveTradeoff = {
  id: string;
  optionA: string;
  optionB: string;
  benefit: string;
  cost: string;
  preferredOption: string;
  reason: string;
};

export type PIEExecutiveAction = {
  id: string;
  action: string;
  expectedValue: number;
  riskReduction: number;
  uncertaintyReduction: number;
  scheduleImpact: number;
  safetyImpact: number;
  communicationImpact: number;
  effortLevel: 'low' | 'medium' | 'high';
  readiness: PIEExecutiveReadiness;
  whyRecommended: string;
  score: PIEExecutiveDecisionScore;
};

export type PIEExecutiveBriefingPoint = {
  id: string;
  title: string;
  summary: string;
  recommendedAction: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveJudgment = {
  whatMattersMost: string;
  biggestRisk: string;
  highestValueAction: string;
  decisionNeeded: string;
  issueLikelyToGrow: string;
  stoppedMoving: string;
  shouldBeCommunicated: string;
  verifyBeforeActing: string;
  canWait: string;
  ignoreForNow: string;
  explanation: string;
};

export type PIEExecutiveReasoningResult = {
  generatedAt: string;
  judgment: PIEExecutiveJudgment;
  priorities: PIEExecutivePriority[];
  biggestRisk: PIEExecutiveRisk | null;
  biggestOpportunity: PIEExecutiveOpportunity | null;
  decisionNeeds: PIEExecutiveDecisionNeed[];
  scheduleThreats: PIEExecutiveConcern[];
  inspectionRisks: PIEExecutiveConcern[];
  contractorConcerns: PIEExecutiveConcern[];
  communicationNeeds: PIEExecutiveConcern[];
  tradeoffs: PIEExecutiveTradeoff[];
  actions: PIEExecutiveAction[];
  highestValueAction: PIEExecutiveAction | null;
  briefingPoints: PIEExecutiveBriefingPoint[];
  executiveReadiness: PIEExecutiveReadiness;
  answers: {
    whatMattersMost: string;
    biggestRisk: string;
    highestValueAction: string;
    decisionNeeded: string;
    issueLikelyToGrow: string;
    stoppedMoving: string;
    shouldBeCommunicated: string;
    verifyBeforeActing: string;
    canWait: string;
    ignoreForNow: string;
  };
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveReasoningInput = {
  runtime: PIERuntimeState;
  beliefSystem?: PIEBeliefEngineResult | null;
  patternIntelligence?: PIEPatternIntelligence | null;
  memoryRecall?: PIEMemoryRecallResult | null;
  scientificResult?: PIEScientificResult | null;
  deliberation?: PIEDeliberationResult | null;
  predictions?: PIEPredictionResult | null;
  realityModel?: PIERealityModel | null;
  objectIntelligence?: PIERealityObjectIntelligenceResult | null;
  situationIntelligence?: PIESituationResult | null;
  predictiveReality?: PIEPredictiveRealityResult | null;
  generatedAt?: string;
};

export function buildPIEExecutiveReasoning(
  input: PIEExecutiveReasoningInput,
): PIEExecutiveReasoningResult {
  const priorities = rankExecutivePriorities(input);
  const scheduleThreats = identifyScheduleThreats(input);
  const inspectionRisks = identifyInspectionRisks(input);
  const contractorConcerns = identifyContractorConcerns(input);
  const communicationNeeds = identifyCommunicationNeeds(input);
  const biggestRisk = identifyBiggestRisk(input, {
    scheduleThreats,
    inspectionRisks,
    contractorConcerns,
    communicationNeeds,
  });
  const biggestOpportunity = identifyBiggestOpportunity(input);
  const decisionNeeds = identifyDecisionNeeds(input);
  const actions = scoreExecutiveActions(input, {
    priorities,
    biggestRisk,
    biggestOpportunity,
    decisionNeeds,
  });
  const highestValueAction = actions[0] || null;
  const executiveReadiness = resolveExecutiveReadiness(input, highestValueAction);
  const judgment = explainExecutiveJudgment(input, {
    priorities,
    biggestRisk,
    biggestOpportunity,
    decisionNeeds,
    highestValueAction,
    executiveReadiness,
  });
  const briefingPoints = buildExecutiveBriefingPoints(input, {
    judgment,
    priorities,
    biggestRisk,
    biggestOpportunity,
    highestValueAction,
  });

  return {
    generatedAt: input.generatedAt || input.runtime.generatedAt || new Date().toISOString(),
    judgment,
    priorities,
    biggestRisk,
    biggestOpportunity,
    decisionNeeds,
    scheduleThreats,
    inspectionRisks,
    contractorConcerns,
    communicationNeeds,
    tradeoffs: buildExecutiveTradeoffs(input, highestValueAction),
    actions,
    highestValueAction,
    briefingPoints,
    executiveReadiness,
    answers: {
      whatMattersMost: judgment.whatMattersMost,
      biggestRisk: judgment.biggestRisk,
      highestValueAction: judgment.highestValueAction,
      decisionNeeded: judgment.decisionNeeded,
      issueLikelyToGrow: judgment.issueLikelyToGrow,
      stoppedMoving: judgment.stoppedMoving,
      shouldBeCommunicated: judgment.shouldBeCommunicated,
      verifyBeforeActing: judgment.verifyBeforeActing,
      canWait: judgment.canWait,
      ignoreForNow: judgment.ignoreForNow,
    },
    confidence: confidenceFromExecutiveReadiness(executiveReadiness, input),
  };
}

export function rankExecutivePriorities(
  input: PIEExecutiveReasoningInput,
): PIEExecutivePriority[] {
  const runtimePriorities = input.runtime.executivePriorities.map(priority => ({
    id: `executive-runtime-${priority.id}`,
    priority: priority.title,
    reason: priority.summary || priority.recommendedAction,
    urgency: priority.priority,
    recommendedAction: priority.recommendedAction,
    confidence: priority.confidence,
  }));
  const beliefPriority = input.beliefSystem?.beliefsNeedingVerification[0]
    ? priorityFromBelief(input.beliefSystem.beliefsNeedingVerification[0])
    : null;
  const warningPriorities = (input.patternIntelligence?.earlyWarnings || [])
    .slice(0, 3)
    .map(priorityFromPatternWarning);
  const scientificPriority = input.scientificResult?.primaryUncertainty
    ? {
        id: 'executive-scientific-uncertainty',
        priority: input.scientificResult.primaryUncertainty.uncertainty,
        reason: input.scientificResult.primaryUncertainty.whyItMatters,
        urgency: input.scientificResult.primaryUncertainty.severity === 'high'
          ? 'high' as const
          : 'medium' as const,
        recommendedAction:
          input.scientificResult.uncertaintyReductionActions[0]?.action ||
          'Reduce uncertainty before acting.',
        confidence: input.scientificResult.confidence,
      }
    : null;
  const predictionPriority = input.predictions?.scheduleImpact || input.predictions?.cascadingImpacts[0]
    ? {
        id: 'executive-prediction-impact',
        priority: input.predictions.scheduleImpact?.summary ||
          input.predictions.cascadingImpacts[0]?.summary ||
          'Predicted impact needs review.',
        reason: input.predictions.noActionOutcome.scheduleImpact,
        urgency: input.predictions.noActionOutcome.riskLevel === 'high'
          ? 'high' as const
          : 'medium' as const,
        recommendedAction:
          input.predictions.recoveryActions[0]?.action ||
          input.predictions.evidenceThatWouldImprovePrediction[0] ||
          'Verify predicted risk before acting.',
        confidence: input.predictions.predictionConfidence,
      }
    : null;
  const predictiveRealityPriority = input.predictiveReality?.risks[0]
    ? {
        id: `executive-predictive-reality-${input.predictiveReality.risks[0].id}`,
        priority: input.predictiveReality.risks[0].risk,
        reason: input.predictiveReality.noActionForecast.summary,
        urgency: input.predictiveReality.risks[0].severity === 'critical' ||
          input.predictiveReality.risks[0].severity === 'high'
          ? 'high' as const
          : 'medium' as const,
        recommendedAction:
          input.predictiveReality.opportunities[0]?.recoveryAction ||
          input.predictiveReality.risks[0].verificationNeeded,
        confidence: input.predictiveReality.risks[0].confidence,
      }
    : null;
  const situationPriority = input.situationIntelligence?.situationPriorities[0]
    ? {
        id: `executive-situation-${input.situationIntelligence.situationPriorities[0].id}`,
        priority: input.situationIntelligence.situationPriorities[0].priority,
        reason: input.situationIntelligence.situationPriorities[0].reason,
        urgency: input.situationIntelligence.situationState === 'blocked' ||
          input.situationIntelligence.situationState === 'at_risk'
          ? 'high' as const
          : 'medium' as const,
        recommendedAction: input.situationIntelligence.situationPriorities[0].action,
        confidence: input.situationIntelligence.situationPriorities[0].confidence,
      }
    : null;

  return [
    ...runtimePriorities,
    situationPriority,
    predictiveRealityPriority,
    beliefPriority,
    ...warningPriorities,
    scientificPriority,
    predictionPriority,
  ]
    .filter((priority): priority is PIEExecutivePriority => Boolean(priority))
    .sort((left, right) =>
      urgencyScore(right.urgency) - urgencyScore(left.urgency) ||
      confidenceScore(right.confidence) - confidenceScore(left.confidence),
    )
    .slice(0, 8);
}

export function identifyBiggestRisk(
  input: PIEExecutiveReasoningInput,
  concerns: {
    scheduleThreats?: PIEExecutiveConcern[];
    inspectionRisks?: PIEExecutiveConcern[];
    contractorConcerns?: PIEExecutiveConcern[];
    communicationNeeds?: PIEExecutiveConcern[];
  } = {},
): PIEExecutiveRisk | null {
  const challengedBelief = input.beliefSystem?.challengedBeliefs[0] ||
    input.beliefSystem?.beliefsNeedingVerification[0];
  const firstConcern = [
    ...(concerns.scheduleThreats || identifyScheduleThreats(input)),
    ...(concerns.inspectionRisks || identifyInspectionRisks(input)),
    ...(concerns.contractorConcerns || identifyContractorConcerns(input)),
    ...(concerns.communicationNeeds || identifyCommunicationNeeds(input)),
  ][0];
  const warning = input.patternIntelligence?.earlyWarnings[0];
  const predictedRisk = input.predictions?.cascadingImpacts.find(impact =>
    impact.severity === 'high',
  ) || input.predictions?.scheduleImpact;
  const situationRisk = input.situationIntelligence?.situationRisks[0];
  const predictiveRealityRisk = input.predictiveReality?.risks[0];

  if (predictiveRealityRisk) {
    return {
      id: `risk-predictive-reality-${predictiveRealityRisk.id}`,
      risk: predictiveRealityRisk.risk,
      whyItMatters: input.predictiveReality?.noActionForecast.summary ||
        predictiveRealityRisk.verificationNeeded,
      likelyToGrow: predictiveRealityRisk.growsIfNothingChanges,
      source: 'Predictive Reality',
      confidence: predictiveRealityRisk.confidence,
    };
  }

  if (situationRisk) {
    return {
      id: `risk-situation-${situationRisk.id}`,
      risk: situationRisk.risk,
      whyItMatters: situationRisk.whyItMatters,
      likelyToGrow: situationRisk.severity === 'high' || situationRisk.severity === 'critical',
      source: 'Situation Intelligence',
      confidence: situationRisk.confidence,
    };
  }

  if (predictedRisk) {
    return {
      id: `risk-prediction-${predictedRisk.id}`,
      risk: predictedRisk.summary,
      whyItMatters: input.predictions?.noActionOutcome.likelyOutcome ||
        propagationForPredictedImpact(predictedRisk.area),
      likelyToGrow: predictedRisk.severity === 'high',
      source: 'Predictive Simulation',
      confidence: predictedRisk.confidence,
    };
  }

  if (challengedBelief?.contradictingEvidence.length) {
    return {
      id: `risk-${challengedBelief.id}`,
      risk: challengedBelief.statement,
      whyItMatters: challengedBelief.explanation.contradictingEvidence[0] ||
        challengedBelief.explanation.readinessReason,
      likelyToGrow: true,
      source: 'Belief Engine contradicting evidence',
      confidence: challengedBelief.confidence,
    };
  }

  if (firstConcern) {
    return {
      id: `risk-${firstConcern.id}`,
      risk: firstConcern.concern,
      whyItMatters: firstConcern.whyItMatters,
      likelyToGrow: firstConcern.category !== 'communication',
      source: firstConcern.category,
      confidence: firstConcern.confidence,
    };
  }

  if (warning) {
    return {
      id: `risk-pattern-${warning.id}`,
      risk: warning.warning,
      whyItMatters: warning.whatToVerify,
      likelyToGrow: true,
      source: 'Pattern Intelligence early warning',
      confidence: warning.confidence,
    };
  }

  return null;
}

export function identifyBiggestOpportunity(
  input: PIEExecutiveReasoningInput,
): PIEExecutiveOpportunity | null {
  const recommendation = input.patternIntelligence?.patternBasedRecommendations[0];
  const deliberated = input.deliberation?.deliberatedRecommendation;
  const recovery = input.predictions?.recoveryActions[0];
  const nextAction = input.runtime.nextBestAction;

  if (recovery) {
    return {
      id: `opportunity-prediction-${recovery.id}`,
      opportunity: recovery.recovers,
      valueCreated: recovery.expectedRecovery,
      recommendedAction: recovery.action,
      confidence: recovery.confidence,
    };
  }
  if (recommendation) return opportunityFromPatternRecommendation(recommendation);
  if (deliberated) {
    return {
      id: 'opportunity-deliberation',
      opportunity: deliberated.action,
      valueCreated: deliberated.whyBetterThanAlternatives,
      recommendedAction: deliberated.whyRecommended,
      confidence: deliberated.confidence,
    };
  }
  if (nextAction?.suggestedNextAction) {
    return {
      id: 'opportunity-runtime-next-action',
      opportunity: nextAction.title,
      valueCreated: nextAction.summary,
      recommendedAction: nextAction.suggestedNextAction,
      confidence: nextAction.confidence,
    };
  }

  return null;
}

export function identifyDecisionNeeds(
  input: PIEExecutiveReasoningInput,
): PIEExecutiveDecisionNeed[] {
  const runtimeNeeds = [
    ...input.runtime.priorityQueue.approvalRequired.map(item => ({
      id: `decision-approval-${item.id}`,
      decisionNeeded: item.title,
      whyNow: item.summary,
      options: ['Approve', 'Correct', 'Collect more evidence'],
      owner: 'User',
      readiness: readinessFromConfidence(item.confidence),
      confidence: item.confidence,
    })),
    ...input.runtime.executiveQuestions.map(question => ({
      id: `decision-question-${question.id}`,
      decisionNeeded: question.question,
      whyNow: question.reason,
      options: ['Answer now', 'Verify in field', 'Defer'],
      owner: 'User',
      readiness: readinessFromConfidence(question.confidence),
      confidence: question.confidence,
    })),
  ];
  const beliefNeeds = (input.beliefSystem?.beliefsNeedingVerification || [])
    .slice(0, 3)
    .map(belief => ({
      id: `decision-belief-${belief.id}`,
      decisionNeeded: `Can DAVE rely on this belief: ${belief.statement}`,
      whyNow: belief.explanation.readinessReason,
      options: ['Verify', 'Correct belief', 'Defer action'],
      owner: 'User',
      readiness: belief.readiness,
      confidence: belief.confidence,
    }));

  const predictionNeeds = input.predictions?.noActionOutcome.riskLevel === 'high'
    ? [{
        id: 'decision-prediction-no-action',
        decisionNeeded: `Act on predicted risk: ${input.predictions.noActionOutcome.likelyOutcome}`,
        whyNow: input.predictions.noActionOutcome.scheduleImpact,
        options: ['Recover now', 'Verify first', 'Accept schedule risk'],
        owner: 'User',
        readiness: input.predictions.predictionConfidence === 'high'
          ? 'Ready' as const
          : 'Needs Verification' as const,
        confidence: input.predictions.predictionConfidence,
      }]
    : [];

  return [...predictionNeeds, ...runtimeNeeds, ...beliefNeeds].slice(0, 8);
}

export function identifyScheduleThreats(
  input: PIEExecutiveReasoningInput,
): PIEExecutiveConcern[] {
  return [
    ...input.runtime.overdueTasks.slice(0, 3).map((task, index) => ({
      id: `schedule-overdue-${task.id || index}`,
      concern: `${task.task || 'Schedule task'} is overdue.`,
      category: 'schedule' as const,
      whyItMatters: `${task.area || task.project || 'Project'} may be blocking the next step.`,
      recommendedVerification: 'Verify status in the field or confirm with the responsible owner.',
      confidence: 'high' as ProjectConfidenceLevel,
    })),
    ...input.runtime.criticalTasks.slice(0, 3).map((task, index) => ({
      id: `schedule-critical-${task.id || index}`,
      concern: `${task.task || 'Critical task'} is on the critical path.`,
      category: 'schedule' as const,
      whyItMatters: `${task.finish || 'The current finish date'} may drive the project sequence.`,
      recommendedVerification: 'Confirm current progress and remaining work.',
      confidence: 'medium' as ProjectConfidenceLevel,
    })),
  ];
}

export function identifyInspectionRisks(
  input: PIEExecutiveReasoningInput,
): PIEExecutiveConcern[] {
  const inspectionAreas = [
    ...input.runtime.recommendedWalkAreas.filter(area => /inspection|inspect|permit/i.test(area)),
    ...input.runtime.criticalTasks
      .filter(task => /inspection|inspect|permit/i.test(`${task.task} ${task.notes || ''}`))
      .map(task => task.area || task.project),
  ].filter(Boolean);

  return inspectionAreas.slice(0, 4).map((area, index) => ({
    id: `inspection-${index + 1}`,
    concern: `${area} may need inspection readiness verification.`,
    category: 'inspection',
    whyItMatters: 'Inspection readiness can block follow-on work if evidence is missing.',
    recommendedVerification: `Collect current evidence for ${area}.`,
    confidence: input.runtime.overallConfidence,
  }));
}

export function identifyContractorConcerns(
  input: PIEExecutiveReasoningInput,
): PIEExecutiveConcern[] {
  const sources = [
    ...input.runtime.insights.map(issue => issue.summary),
    ...input.runtime.evidenceGaps.map(gap => gap.summary),
    ...(input.patternIntelligence?.recurringIssues || []).map(issue => issue.summary),
  ];

  return sources
    .filter(summary => /contractor|owner|waiting|blocked|slow|delay|crew|trade/i.test(summary))
    .slice(0, 4)
    .map((summary, index) => ({
      id: `contractor-${index + 1}`,
      concern: summary,
      category: 'contractor',
      whyItMatters: 'Contractor or owner delay can become a schedule and communication risk.',
      recommendedVerification: 'Confirm owner, blocker, and expected recovery action.',
      confidence: input.runtime.overallConfidence,
    }));
}

export function identifyCommunicationNeeds(
  input: PIEExecutiveReasoningInput,
): PIEExecutiveConcern[] {
  const reportNeedsCommunication = input.runtime.response.reportActionItems.length > 0 ||
    input.runtime.intelligence.communicationReadiness.level === 'ready';
  const decisionNeeds = identifyDecisionNeeds(input).slice(0, 3);
  const needs: Array<PIEExecutiveConcern | null> = [
    reportNeedsCommunication
      ? {
          id: 'communication-report-ready',
          concern: 'Project update may be ready to communicate.',
          category: 'communication' as const,
          whyItMatters: 'Clear communication can prevent missed action items.',
          recommendedVerification: 'Review and approve the report before sending or copying.',
          confidence: input.runtime.response.reportReadiness,
        }
      : null,
    ...decisionNeeds.map(decision => ({
      id: `communication-${decision.id}`,
      concern: decision.decisionNeeded,
      category: 'communication' as const,
      whyItMatters: decision.whyNow,
      recommendedVerification: 'Communicate the decision need to the responsible person.',
      confidence: decision.confidence,
    })),
  ];

  return needs.filter((need): need is PIEExecutiveConcern => Boolean(need));
}

export function scoreExecutiveActions(
  input: PIEExecutiveReasoningInput,
  context: {
    priorities?: PIEExecutivePriority[];
    biggestRisk?: PIEExecutiveRisk | null;
    biggestOpportunity?: PIEExecutiveOpportunity | null;
    decisionNeeds?: PIEExecutiveDecisionNeed[];
  } = {},
): PIEExecutiveAction[] {
  const priority = context.priorities?.[0] || rankExecutivePriorities(input)[0];
  const biggestRisk = context.biggestRisk === undefined
    ? identifyBiggestRisk(input)
    : context.biggestRisk;
  const biggestOpportunity = context.biggestOpportunity === undefined
    ? identifyBiggestOpportunity(input)
    : context.biggestOpportunity;
  const decision = context.decisionNeeds?.[0] || identifyDecisionNeeds(input)[0];
  const recovery = input.predictions?.recoveryActions[0];
  const candidates = [
    recovery
      ? {
          id: `action-prediction-${recovery.id}`,
          action: recovery.action,
          reason: `${recovery.expectedRecovery} No-action consequence: ${input.predictions?.noActionOutcome.likelyOutcome || 'risk may continue'}.`,
          confidence: recovery.confidence,
          schedule: /schedule|slip|critical|overdue|due/i.test(`${recovery.recovers} ${recovery.expectedRecovery}`),
          safety: /safety|hazard/i.test(`${recovery.recovers} ${recovery.expectedRecovery}`),
          communication: /communicat|decision|owner|action item/i.test(`${recovery.action} ${recovery.requiredEvidence.join(' ')}`),
        }
      : null,
    priority
      ? {
          id: `action-priority-${priority.id}`,
          action: priority.recommendedAction,
          reason: priority.reason,
          confidence: priority.confidence,
          schedule: /schedule|critical|overdue|due/i.test(priority.priority + priority.reason),
          safety: /safety|hazard/i.test(priority.priority + priority.reason),
          communication: /communicat|report|owner|action item/i.test(priority.reason),
        }
      : null,
    biggestRisk
      ? {
          id: `action-risk-${biggestRisk.id}`,
          action: `Reduce risk: ${biggestRisk.risk}`,
          reason: biggestRisk.whyItMatters,
          confidence: biggestRisk.confidence,
          schedule: /schedule|critical|overdue|due/i.test(biggestRisk.risk),
          safety: /safety|hazard/i.test(biggestRisk.risk),
          communication: /communicat|owner|contractor/i.test(biggestRisk.risk),
        }
      : null,
    biggestOpportunity
      ? {
          id: `action-opportunity-${biggestOpportunity.id}`,
          action: biggestOpportunity.recommendedAction,
          reason: biggestOpportunity.valueCreated,
          confidence: biggestOpportunity.confidence,
          schedule: /schedule|critical|overdue|due/i.test(biggestOpportunity.opportunity),
          safety: /safety|hazard/i.test(biggestOpportunity.opportunity),
          communication: /communicat|report|update/i.test(biggestOpportunity.opportunity),
        }
      : null,
    decision
      ? {
          id: `action-decision-${decision.id}`,
          action: `Decide: ${decision.decisionNeeded}`,
          reason: decision.whyNow,
          confidence: decision.confidence,
          schedule: /schedule|critical|overdue|due/i.test(decision.decisionNeeded),
          safety: /safety|hazard/i.test(decision.decisionNeeded),
          communication: true,
        }
      : null,
    input.deliberation?.deliberatedRecommendation
      ? {
          id: 'action-deliberation',
          action: input.deliberation.deliberatedRecommendation.action,
          reason: input.deliberation.deliberatedRecommendation.whyRecommended,
          confidence: input.deliberation.deliberatedRecommendation.confidence,
          schedule: /schedule|critical|overdue|due/i.test(input.deliberation.deliberatedRecommendation.action),
          safety: /safety|hazard/i.test(input.deliberation.deliberatedRecommendation.action),
          communication: /communicat|report|update/i.test(input.deliberation.deliberatedRecommendation.action),
        }
      : null,
  ].filter((candidate): candidate is {
    id: string;
    action: string;
    reason: string;
    confidence: ProjectConfidenceLevel;
    schedule: boolean;
    safety: boolean;
    communication: boolean;
  } => Boolean(candidate?.action));

  return uniqueActions(candidates.map(candidate => {
    const expectedValue = 2 + confidenceScore(candidate.confidence);
    const predictedHighRisk = input.predictions?.noActionOutcome.riskLevel === 'high';
    const riskReduction = candidate.id.includes('risk') || biggestRisk || predictedHighRisk ? 3 : 1;
    const uncertaintyReduction = input.beliefSystem?.beliefsNeedingVerification.length ||
      input.scientificResult?.uncertainty.length
      ? 3
      : 1;
    const predictedScheduleImpact = input.predictions?.scheduleImpact?.severity === 'high' ? 3 : 0;
    const scheduleImpact = candidate.schedule ? 3 : Math.max(1, predictedScheduleImpact);
    const safetyImpact = candidate.safety ? 3 : 1;
    const communicationImpact = candidate.communication ? 3 : 1;
    const effortLevel = candidate.id.includes('decision') ? 'low' : 'medium';
    const readiness = readinessFromConfidence(candidate.confidence, input.beliefSystem?.beliefReadiness);
    const total =
      expectedValue +
      riskReduction +
      uncertaintyReduction +
      scheduleImpact +
      safetyImpact +
      communicationImpact -
      effortPenalty(effortLevel) +
      (candidate.id.includes('prediction') ? 2 : 0);
    const score: PIEExecutiveDecisionScore = {
      expectedValue,
      riskReduction,
      uncertaintyReduction,
      scheduleImpact,
      safetyImpact,
      communicationImpact,
      effortLevel,
      total,
      readiness,
      whyRecommended: candidate.reason,
    };

    return {
      id: candidate.id,
      action: candidate.action,
      expectedValue,
      riskReduction,
      uncertaintyReduction,
      scheduleImpact,
      safetyImpact,
      communicationImpact,
      effortLevel,
      readiness,
      whyRecommended: candidate.reason,
      score,
    };
  })).sort((left, right) => right.score.total - left.score.total);
}

export function buildExecutiveBriefingPoints(
  input: PIEExecutiveReasoningInput,
  context: {
    judgment?: PIEExecutiveJudgment;
    priorities?: PIEExecutivePriority[];
    biggestRisk?: PIEExecutiveRisk | null;
    biggestOpportunity?: PIEExecutiveOpportunity | null;
    highestValueAction?: PIEExecutiveAction | null;
  } = {},
): PIEExecutiveBriefingPoint[] {
  const judgment = context.judgment || explainExecutiveJudgment(input);
  const points = [
    {
      id: 'brief-what-matters',
      title: 'What matters most',
      summary: judgment.whatMattersMost,
      recommendedAction: context.priorities?.[0]?.recommendedAction ||
        input.runtime.nextBestAction.suggestedNextAction,
      confidence: input.runtime.overallConfidence,
    },
    context.biggestRisk
      ? {
          id: 'brief-biggest-risk',
          title: 'Biggest risk',
          summary: context.biggestRisk.risk,
          recommendedAction: context.biggestRisk.whyItMatters,
          confidence: context.biggestRisk.confidence,
        }
      : null,
    context.highestValueAction
      ? {
          id: 'brief-highest-value-action',
          title: 'Highest-value action',
          summary: context.highestValueAction.action,
          recommendedAction: context.highestValueAction.whyRecommended,
          confidence: confidenceFromReadiness(context.highestValueAction.readiness),
        }
      : null,
    context.biggestOpportunity
      ? {
          id: 'brief-opportunity',
          title: 'Opportunity',
          summary: context.biggestOpportunity.opportunity,
          recommendedAction: context.biggestOpportunity.recommendedAction,
          confidence: context.biggestOpportunity.confidence,
        }
      : null,
  ];

  return points.filter((point): point is PIEExecutiveBriefingPoint => Boolean(point));
}

export function explainExecutiveJudgment(
  input: PIEExecutiveReasoningInput,
  context: {
    priorities?: PIEExecutivePriority[];
    biggestRisk?: PIEExecutiveRisk | null;
    biggestOpportunity?: PIEExecutiveOpportunity | null;
    decisionNeeds?: PIEExecutiveDecisionNeed[];
    highestValueAction?: PIEExecutiveAction | null;
    executiveReadiness?: PIEExecutiveReadiness;
  } = {},
): PIEExecutiveJudgment {
  const priorities = context.priorities || rankExecutivePriorities(input);
  const biggestRisk = context.biggestRisk === undefined
    ? identifyBiggestRisk(input)
    : context.biggestRisk;
  const biggestOpportunity = context.biggestOpportunity === undefined
    ? identifyBiggestOpportunity(input)
    : context.biggestOpportunity;
  const decisionNeeds = context.decisionNeeds || identifyDecisionNeeds(input);
  const highestValueAction = context.highestValueAction ||
    scoreExecutiveActions(input, {
      priorities,
      biggestRisk,
      biggestOpportunity,
      decisionNeeds,
    })[0] ||
    null;
  const stoppedMoving = input.runtime.overdueTasks[0]?.task ||
    input.situationIntelligence?.situationBlockers[0]?.blocker ||
    input.predictiveReality?.futureObjectStates.find(state =>
      state.likelyChange === 'becomes_blocked' ||
      state.likelyChange === 'stays_blocked',
    )?.objectName ||
    input.runtime.blockedItems[0]?.summary ||
    'No stalled item is clear from current evidence.';
  const verifyBeforeActing = input.beliefSystem?.beliefsNeedingVerification[0]?.recommendedEvidence[0] ||
    input.predictiveReality?.risks[0]?.verificationNeeded ||
    input.predictiveReality?.opportunities[0]?.recoveryAction ||
    input.situationIntelligence?.situationUnknowns[0]?.recommendedEvidence ||
    input.predictions?.evidenceThatWouldImprovePrediction[0] ||
    input.scientificResult?.uncertaintyReductionActions[0]?.action ||
    input.deliberation?.missingEvidence[0] ||
    'Verify the current field condition before treating this as final.';
  const canWait = input.runtime.priorityQueue.communication[0]?.title ||
    input.runtime.recommendedEvidence[1] ||
    'Lower-confidence items without schedule, safety, or decision impact can wait.';
  const alternativeConsidered = input.deliberation?.alternativesConsidered[1]?.action;
  const ignoreForNow = input.runtime.unknowns[0]?.summary ||
    'Do not spend time on unsupported details that do not affect schedule, safety, communication, or decisions.';

  return {
    whatMattersMost: priorities[0]?.priority ||
      input.runtime.nextBestAction.title ||
      'No executive priority is clear yet.',
    biggestRisk: biggestRisk?.risk || 'No major risk is clear from current evidence.',
    highestValueAction: highestValueAction?.action ||
      input.runtime.nextBestAction.suggestedNextAction ||
      'Collect evidence before making an executive recommendation.',
    decisionNeeded: decisionNeeds[0]?.decisionNeeded ||
      'No immediate decision is required.',
    issueLikelyToGrow: biggestRisk?.likelyToGrow
      ? biggestRisk.risk
      : input.patternIntelligence?.earlyWarnings[0]?.warning ||
        'No growing issue is clear from current evidence.',
    stoppedMoving,
    shouldBeCommunicated: input.runtime.response.reportActionItems[0]?.action ||
      input.runtime.intelligentSummary.nextAction ||
      'Communicate only reviewed action items and decisions.',
    verifyBeforeActing,
    canWait,
    ignoreForNow,
    explanation: [
      priorities[0]?.reason,
      biggestRisk?.whyItMatters,
      biggestOpportunity?.valueCreated,
      input.predictions?.explanation.summary,
      input.predictiveReality?.explanation,
      input.situationIntelligence?.explanation,
      input.beliefSystem?.strongestBeliefs[0]?.explanation.summary,
      input.memoryRecall?.summaryForPIE,
      input.deliberation?.explanation,
      alternativeConsidered ? `Alternative considered: ${alternativeConsidered}.` : null,
      input.scientificResult?.explanation.summary,
    ].filter(Boolean).join(' '),
  };
}

function priorityFromBelief(belief: PIEBelief): PIEExecutivePriority {
  return {
    id: `executive-belief-${belief.id}`,
    priority: belief.statement,
    reason: belief.explanation.readinessReason,
    urgency: belief.contradictingEvidence.length > 0 ? 'high' : 'medium',
    recommendedAction: belief.recommendedEvidence[0] || 'Verify this belief.',
    confidence: belief.confidence,
  };
}

function priorityFromPatternWarning(warning: PIEPatternWarning): PIEExecutivePriority {
  return {
    id: `executive-pattern-${warning.id}`,
    priority: warning.warning,
    reason: warning.whatToVerify,
    urgency: warning.patternType === 'recurring_safety_issue' || warning.patternType === 'schedule_slippage'
      ? 'high'
      : 'medium',
    recommendedAction: warning.whatToVerify,
    confidence: warning.confidence,
  };
}

function opportunityFromPatternRecommendation(
  recommendation: PIEPatternRecommendation,
): PIEExecutiveOpportunity {
  return {
    id: `opportunity-pattern-${recommendation.id}`,
    opportunity: recommendation.recommendation,
    valueCreated: recommendation.reason,
    recommendedAction: recommendation.recommendation,
    confidence: recommendation.confidence,
  };
}

function buildExecutiveTradeoffs(
  input: PIEExecutiveReasoningInput,
  highestValueAction: PIEExecutiveAction | null,
): PIEExecutiveTradeoff[] {
  const deliberationTradeoff = input.deliberation?.tradeoffs[0];
  const tradeoffs = [
    deliberationTradeoff
      ? {
          id: `executive-${deliberationTradeoff.id}`,
          optionA: deliberationTradeoff.optionA,
          optionB: deliberationTradeoff.optionB,
          benefit: deliberationTradeoff.benefit,
          cost: deliberationTradeoff.cost,
          preferredOption: deliberationTradeoff.preferredOption,
          reason: 'Executive Reasoning uses Deliberation tradeoffs before action scoring.',
        }
      : null,
    highestValueAction
      ? {
          id: 'executive-action-verification-tradeoff',
          optionA: highestValueAction.action,
          optionB: 'Collect more evidence first',
          benefit: highestValueAction.whyRecommended,
          cost: highestValueAction.readiness === 'Ready'
            ? 'Small risk of waiting too long.'
            : 'Acting now may rely on weak or contradicted evidence.',
          preferredOption: highestValueAction.readiness === 'Ready'
            ? highestValueAction.action
            : 'Collect more evidence first',
          reason: `Executive readiness is ${highestValueAction.readiness}.`,
        }
      : null,
  ];

  return tradeoffs.filter((tradeoff): tradeoff is PIEExecutiveTradeoff => Boolean(tradeoff));
}

function resolveExecutiveReadiness(
  input: PIEExecutiveReasoningInput,
  highestValueAction: PIEExecutiveAction | null,
): PIEExecutiveReadiness {
  if (input.beliefSystem?.beliefReadiness === 'Blocked') return 'Blocked';
  if (input.deliberation?.recommendationReadiness === 'Blocked') return 'Blocked';
  if (input.scientificResult?.decisionQualitySignals.readiness === 'Blocked') return 'Blocked';
  if (highestValueAction?.readiness) return highestValueAction.readiness;
  if (input.beliefSystem?.beliefReadiness && input.beliefSystem.beliefReadiness !== 'Ready') {
    return input.beliefSystem.beliefReadiness;
  }
  if (input.scientificResult?.decisionQualitySignals.readiness) {
    return input.scientificResult.decisionQualitySignals.readiness;
  }

  return readinessFromConfidence(input.runtime.overallConfidence);
}

function readinessFromConfidence(
  confidence: ProjectConfidenceLevel,
  beliefReadiness?: PIEBeliefReadiness,
): PIEExecutiveReadiness {
  if (beliefReadiness === 'Blocked') return 'Blocked';
  if (beliefReadiness === 'Uncertain') return 'Uncertain';
  if (beliefReadiness === 'Needs Verification') return 'Needs Verification';
  if (confidence === 'high') return 'Ready';
  if (confidence === 'medium') return 'Needs Verification';
  return 'Uncertain';
}

function confidenceFromExecutiveReadiness(
  readiness: PIEExecutiveReadiness,
  input: PIEExecutiveReasoningInput,
): ProjectConfidenceLevel {
  if (readiness === 'Ready') return 'high';
  if (readiness === 'Blocked') return 'low';
  if (
    input.scientificResult?.decisionQualitySignals.total !== undefined &&
    input.scientificResult.decisionQualitySignals.total < 45
  ) return 'low';
  return input.runtime.overallConfidence === 'low' ? 'low' : 'medium';
}

function confidenceFromReadiness(readiness: PIEExecutiveReadiness): ProjectConfidenceLevel {
  if (readiness === 'Ready') return 'high';
  if (readiness === 'Blocked' || readiness === 'Uncertain') return 'low';
  return 'medium';
}

function confidenceScore(confidence: ProjectConfidenceLevel) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;
  return 1;
}

function urgencyScore(urgency: PIEExecutivePriority['urgency']) {
  if (urgency === 'critical') return 4;
  if (urgency === 'high') return 3;
  if (urgency === 'medium') return 2;
  return 1;
}

function propagationForPredictedImpact(area: string) {
  if (area === 'schedule') return 'Predicted schedule impact could affect successor work.';
  if (area === 'inspection') return 'Predicted inspection impact could delay readiness.';
  if (area === 'contractor') return 'Predicted contractor impact could delay recovery.';
  if (area === 'safety') return 'Predicted safety impact should be verified before work continues.';
  return 'Predicted impact could reduce confidence or delay action if not verified.';
}

function effortPenalty(effort: PIEExecutiveAction['effortLevel']) {
  if (effort === 'high') return 3;
  if (effort === 'medium') return 2;
  return 1;
}

function uniqueActions(actions: PIEExecutiveAction[]) {
  const seen = new Set<string>();
  return actions.filter(action => {
    const key = action.action.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
