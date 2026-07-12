import type {
  PIEBelief,
  PIEBeliefEngineResult,
  PIEBeliefReadiness,
} from './PIEBeliefEngine';
import type { PIEDeliberationResult } from './PIEDeliberationEngine';
import type { PIEExecutiveReasoningResult } from './PIEExecutiveReasoning';
import type { PIELearningResult } from './PIELearningEngine';
import type { PIEMemoryRecallResult } from './PIEMemoryRecall';
import type { PIEPatternIntelligence } from './PIEPatternEngine';
import type {
  PIERealityModel,
  PIERealityObjectIntelligenceResult,
} from './PIERealityModel';
import type { PIESituationResult } from './PIESituationIntelligence';
import type { PIERuntimeState } from './PIERuntime';
import type { PIEScientificResult } from './PIEScientificMethod';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEPredictionScenario =
  | 'schedule_delay'
  | 'inspection_delay'
  | 'contractor_delay'
  | 'missing_evidence'
  | 'safety_issue'
  | 'quality_issue'
  | 'decision_delay'
  | 'recovery_plan'
  | 'no_action'
  | 'best_case'
  | 'most_likely'
  | 'worst_case';

export type PIEPredictionConfidence = ProjectConfidenceLevel;

export type PIEPredictionDependency = {
  id: string;
  type:
    | 'schedule predecessor/successor'
    | 'inspection dependency'
    | 'contractor dependency'
    | 'material dependency'
    | 'approval dependency'
    | 'safety dependency'
    | 'evidence dependency';
  summary: string;
  atRisk: boolean;
  confidence: PIEPredictionConfidence;
};

export type PIEPredictionTimeline = {
  horizonDays: number;
  likelyStart: string | null;
  likelyFinish: string | null;
  estimatedSlipDays: number;
};

export type PIEPredictionImpact = {
  id: string;
  area: 'schedule' | 'inspection' | 'contractor' | 'safety' | 'quality' | 'communication' | 'evidence';
  summary: string;
  severity: 'low' | 'medium' | 'high';
  confidence: PIEPredictionConfidence;
};

export type PIEPredictionRisk = {
  id: string;
  risk: string;
  propagation: string;
  likelyToGrow: boolean;
  impact: PIEPredictionImpact;
  confidence: PIEPredictionConfidence;
};

export type PIEPredictionRecoveryAction = {
  id: string;
  action: string;
  recovers: string;
  expectedRecovery: string;
  value: number;
  requiredEvidence: string[];
  confidence: PIEPredictionConfidence;
};

export type PIEPredictionOutcome = {
  id: string;
  scenario: PIEPredictionScenario;
  likelyOutcome: string;
  scheduleImpact: string;
  inspectionImpact: string;
  contractorImpact: string;
  riskLevel: 'low' | 'medium' | 'high';
  timeline: PIEPredictionTimeline;
  dependencies: PIEPredictionDependency[];
  evidenceNeeded: string[];
  confidence: PIEPredictionConfidence;
};

export type PIEPredictionExplanation = {
  summary: string;
  evidence: string[];
  uncertainty: string[];
  doNotOverstate: boolean;
};

export type PIEPrediction = {
  id: string;
  scenario: PIEPredictionScenario;
  outcome: PIEPredictionOutcome;
  risks: PIEPredictionRisk[];
  impacts: PIEPredictionImpact[];
  recoveryActions: PIEPredictionRecoveryAction[];
  explanation: PIEPredictionExplanation;
  confidence: PIEPredictionConfidence;
};

export type PIEPredictionInput = {
  runtime: PIERuntimeState;
  beliefSystem?: PIEBeliefEngineResult | null;
  patternIntelligence?: PIEPatternIntelligence | null;
  memoryRecall?: PIEMemoryRecallResult | null;
  scientificResult?: PIEScientificResult | null;
  deliberation?: PIEDeliberationResult | null;
  executiveReasoning?: PIEExecutiveReasoningResult | null;
  learningResult?: PIELearningResult | null;
  realityModel?: PIERealityModel | null;
  objectIntelligence?: PIERealityObjectIntelligenceResult | null;
  situationIntelligence?: PIESituationResult | null;
  generatedAt?: string;
};

export type PIEPredictionResult = {
  generatedAt: string;
  predictions: PIEPrediction[];
  scenarios: PIEPredictionScenario[];
  mostLikelyOutcome: PIEPredictionOutcome;
  bestCaseOutcome: PIEPredictionOutcome;
  worstCaseOutcome: PIEPredictionOutcome;
  noActionOutcome: PIEPredictionOutcome;
  cascadingImpacts: PIEPredictionImpact[];
  scheduleImpact: PIEPredictionImpact | null;
  inspectionImpact: PIEPredictionImpact | null;
  contractorImpact: PIEPredictionImpact | null;
  dependencies: PIEPredictionDependency[];
  recoveryActions: PIEPredictionRecoveryAction[];
  predictionConfidence: PIEPredictionConfidence;
  evidenceThatWouldImprovePrediction: string[];
  explanation: PIEPredictionExplanation;
};

export function buildPIEPredictions(input: PIEPredictionInput): PIEPredictionResult {
  const dependencies = buildPredictionDependencies(input);
  const scenarios = buildPredictionScenarios(input);
  const mostLikelyOutcome = simulateLikelyOutcome(input, dependencies);
  const bestCaseOutcome = simulateBestCase(input, dependencies);
  const worstCaseOutcome = simulateWorstCase(input, dependencies);
  const noActionOutcome = simulateNoAction(input, dependencies);
  const cascadingImpacts = identifyCascadingImpacts(input, dependencies);
  const scheduleImpact = identifyScheduleImpact(input, cascadingImpacts);
  const inspectionImpact = identifyInspectionImpact(input, cascadingImpacts);
  const contractorImpact = identifyContractorImpact(input, cascadingImpacts);
  const recoveryActions = buildRecoveryActions(input, {
    mostLikelyOutcome,
    noActionOutcome,
    cascadingImpacts,
  });
  const predictions = scenarios.map(scenario => {
    const outcome =
      scenario === 'best_case'
        ? bestCaseOutcome
        : scenario === 'worst_case'
          ? worstCaseOutcome
          : scenario === 'no_action'
            ? noActionOutcome
            : scenario === 'most_likely'
              ? mostLikelyOutcome
              : outcomeForScenario(scenario, mostLikelyOutcome, dependencies, cascadingImpacts);
    const impacts = cascadingImpacts.filter(impact =>
      scenario === 'most_likely' ||
      impact.area === impactAreaForScenario(scenario),
    );

    return {
      id: `prediction-${scenario}`,
      scenario,
      outcome,
      risks: impacts.map((impact, index) => ({
        id: `risk-${scenario}-${index + 1}`,
        risk: impact.summary,
        propagation: propagationForImpact(impact),
        likelyToGrow: impact.severity === 'high' || scenario === 'no_action',
        impact,
        confidence: impact.confidence,
      })),
      impacts,
      recoveryActions,
      explanation: explainPrediction(input, outcome, impacts),
      confidence: scorePredictionConfidence(input, impacts),
    };
  });
  const explanation = explainPrediction(input, mostLikelyOutcome, cascadingImpacts);

  return {
    generatedAt: input.generatedAt || input.runtime.generatedAt || new Date().toISOString(),
    predictions,
    scenarios,
    mostLikelyOutcome,
    bestCaseOutcome,
    worstCaseOutcome,
    noActionOutcome,
    cascadingImpacts,
    scheduleImpact,
    inspectionImpact,
    contractorImpact,
    dependencies,
    recoveryActions,
    predictionConfidence: scorePredictionConfidence(input, cascadingImpacts),
    evidenceThatWouldImprovePrediction: buildPredictionEvidenceNeeds(input, dependencies),
    explanation,
  };
}

export function buildPredictionScenarios(input: PIEPredictionInput): PIEPredictionScenario[] {
  const scenarios: PIEPredictionScenario[] = ['most_likely', 'best_case', 'worst_case', 'no_action'];

  if (input.runtime.overdueTasks.length > 0 || input.runtime.criticalTasks.length > 0) {
    scenarios.push('schedule_delay');
  }
  if (hasInspectionSignal(input)) scenarios.push('inspection_delay');
  if (hasContractorSignal(input)) scenarios.push('contractor_delay');
  if (input.runtime.evidenceGaps.length > 0 || input.beliefSystem?.beliefReadiness !== 'Ready') {
    scenarios.push('missing_evidence');
  }
  if (hasSafetySignal(input)) scenarios.push('safety_issue');
  if (hasQualitySignal(input)) scenarios.push('quality_issue');
  if (input.runtime.priorityQueue.approvalRequired.length > 0 || input.executiveReasoning?.decisionNeeds.length) {
    scenarios.push('decision_delay');
  }
  if (input.deliberation?.recommendationReadiness !== 'Blocked') {
    scenarios.push('recovery_plan');
  }

  return Array.from(new Set(scenarios));
}

export function simulateLikelyOutcome(
  input: PIEPredictionInput,
  dependencies: PIEPredictionDependency[] = buildPredictionDependencies(input),
): PIEPredictionOutcome {
  const slipDays = estimateSlipDays(input, 'most_likely');
  const riskLevel = slipDays >= 3 || dependencies.some(item => item.atRisk) ? 'high' : slipDays > 0 ? 'medium' : 'low';

  return {
    id: 'outcome-most-likely',
    scenario: 'most_likely',
    likelyOutcome: likelyOutcomeText(input, slipDays),
    scheduleImpact: scheduleImpactText(input, slipDays),
    inspectionImpact: inspectionImpactText(input, slipDays),
    contractorImpact: contractorImpactText(input),
    riskLevel,
    timeline: buildTimeline(input, slipDays),
    dependencies,
    evidenceNeeded: buildPredictionEvidenceNeeds(input, dependencies),
    confidence: confidenceFromRiskLevel(riskLevel, input),
  };
}

export function simulateBestCase(
  input: PIEPredictionInput,
  dependencies: PIEPredictionDependency[] = buildPredictionDependencies(input),
): PIEPredictionOutcome {
  const slipDays = Math.max(0, estimateSlipDays(input, 'best_case'));

  return {
    id: 'outcome-best-case',
    scenario: 'best_case',
    likelyOutcome: 'If verification and recovery actions happen quickly, current risk can be contained.',
    scheduleImpact: slipDays > 0 ? `Schedule impact may be limited to ${slipDays} day${slipDays === 1 ? '' : 's'}.` : 'No schedule slip is predicted in the best case.',
    inspectionImpact: hasInspectionSignal(input) ? 'Inspection readiness can recover if prerequisite evidence is confirmed.' : 'No inspection impact is predicted in the best case.',
    contractorImpact: hasContractorSignal(input) ? 'Contractor impact can be limited by confirming owner and next action.' : 'No contractor impact is predicted in the best case.',
    riskLevel: 'low',
    timeline: buildTimeline(input, slipDays),
    dependencies,
    evidenceNeeded: buildPredictionEvidenceNeeds(input, dependencies).slice(0, 2),
    confidence: input.runtime.overallConfidence === 'high' ? 'high' : 'medium',
  };
}

export function simulateWorstCase(
  input: PIEPredictionInput,
  dependencies: PIEPredictionDependency[] = buildPredictionDependencies(input),
): PIEPredictionOutcome {
  const slipDays = Math.max(2, estimateSlipDays(input, 'worst_case'));

  return {
    id: 'outcome-worst-case',
    scenario: 'worst_case',
    likelyOutcome: 'If the current risk propagates, follow-on work may wait for verification, decision, or recovery action.',
    scheduleImpact: `Schedule readiness could slip by ${slipDays} day${slipDays === 1 ? '' : 's'} or more if dependencies are not cleared.`,
    inspectionImpact: hasInspectionSignal(input) ? 'Inspection readiness may slip until prerequisite work or evidence is verified.' : 'Inspection impact is not the primary worst-case driver.',
    contractorImpact: hasContractorSignal(input) ? 'Contractor sequencing may be affected if responsibility and recovery action remain unclear.' : 'Contractor impact is uncertain.',
    riskLevel: 'high',
    timeline: buildTimeline(input, slipDays),
    dependencies,
    evidenceNeeded: buildPredictionEvidenceNeeds(input, dependencies),
    confidence: input.runtime.overallConfidence === 'low' ? 'medium' : input.runtime.overallConfidence,
  };
}

export function simulateNoAction(
  input: PIEPredictionInput,
  dependencies: PIEPredictionDependency[] = buildPredictionDependencies(input),
): PIEPredictionOutcome {
  const slipDays = Math.max(1, estimateSlipDays(input, 'no_action'));

  return {
    id: 'outcome-no-action',
    scenario: 'no_action',
    likelyOutcome: 'If no action is taken, the highest-risk dependency remains unresolved and may affect the next scheduled activity.',
    scheduleImpact: `No action could allow a ${slipDays} day${slipDays === 1 ? '' : 's'} schedule impact to persist or grow.`,
    inspectionImpact: hasInspectionSignal(input) ? 'Inspection or turnover evidence may remain incomplete.' : 'No direct inspection impact is confirmed.',
    contractorImpact: hasContractorSignal(input) ? 'Contractor delay or responsibility may remain unresolved.' : 'Contractor impact remains uncertain.',
    riskLevel: 'high',
    timeline: buildTimeline(input, slipDays),
    dependencies,
    evidenceNeeded: buildPredictionEvidenceNeeds(input, dependencies),
    confidence: scorePredictionConfidence(input, identifyCascadingImpacts(input, dependencies)),
  };
}

export function identifyCascadingImpacts(
  input: PIEPredictionInput,
  dependencies: PIEPredictionDependency[] = buildPredictionDependencies(input),
): PIEPredictionImpact[] {
  const impacts: PIEPredictionImpact[] = [
    ...(input.situationIntelligence?.situationRisks.slice(0, 3).map((risk, index) => ({
      id: `impact-situation-${index + 1}`,
      area: impactAreaForSituationRisk(risk.risk),
      summary: risk.whyItMatters,
      severity: risk.severity === 'critical' ? 'high' as const : risk.severity,
      confidence: risk.confidence,
    })) || []),
    ...input.runtime.overdueTasks.slice(0, 3).map((task, index) => ({
      id: `impact-schedule-${task.id || index}`,
      area: 'schedule' as const,
      summary: `${task.task || 'Overdue work'} may push successor work in ${task.area || task.project || 'the project'}.`,
      severity: 'high' as const,
      confidence: 'high' as ProjectConfidenceLevel,
    })),
    ...input.runtime.criticalTasks.slice(0, 2).map((task, index) => ({
      id: `impact-critical-${task.id || index}`,
      area: 'schedule' as const,
      summary: `${task.task || 'Critical work'} may affect the critical path if it does not advance.`,
      severity: 'medium' as const,
      confidence: task.confidence,
    })),
    ...input.runtime.evidenceGaps.slice(0, 3).map((gap, index) => ({
      id: `impact-evidence-${index + 1}`,
      area: 'evidence' as const,
      summary: gap.summary,
      severity: gap.severity === 'critical' ? 'high' as const : gap.severity,
      confidence: input.runtime.overallConfidence,
    })),
    ...dependencies.filter(item => item.atRisk).slice(0, 4).map((dependency, index) => ({
      id: `impact-dependency-${index + 1}`,
      area: impactAreaFromDependency(dependency),
      summary: dependency.summary,
      severity: 'medium' as const,
      confidence: dependency.confidence,
    })),
  ];
  const patternWarning = input.patternIntelligence?.earlyWarnings[0];
  if (patternWarning) {
    impacts.push({
      id: `impact-pattern-${patternWarning.id}`,
      area: impactAreaForPattern(patternWarning.patternType),
      summary: patternWarning.warning,
      severity: patternWarning.patternType === 'recurring_safety_issue' ? 'high' : 'medium',
      confidence: patternWarning.confidence,
    });
  }
  const challengedBelief = input.beliefSystem?.beliefsNeedingVerification[0] ||
    input.beliefSystem?.challengedBeliefs[0];
  if (challengedBelief) {
    impacts.push({
      id: `impact-belief-${challengedBelief.id}`,
      area: 'evidence',
      summary: `Prediction depends on belief readiness: ${challengedBelief.statement}`,
      severity: challengedBelief.readiness === 'Blocked' ? 'high' : 'medium',
      confidence: challengedBelief.confidence,
    });
  }

  return uniqueImpacts(impacts);
}

export function identifyScheduleImpact(
  input: PIEPredictionInput,
  impacts: PIEPredictionImpact[] = identifyCascadingImpacts(input),
): PIEPredictionImpact | null {
  return impacts.find(impact => impact.area === 'schedule') || null;
}

export function identifyInspectionImpact(
  input: PIEPredictionInput,
  impacts: PIEPredictionImpact[] = identifyCascadingImpacts(input),
): PIEPredictionImpact | null {
  return impacts.find(impact => impact.area === 'inspection') ||
    (hasInspectionSignal(input)
      ? {
          id: 'impact-inspection-inferred',
          area: 'inspection',
          summary: 'Inspection readiness may depend on verifying prerequisite work and evidence.',
          severity: 'medium',
          confidence: input.runtime.overallConfidence,
        }
      : null);
}

export function identifyContractorImpact(
  input: PIEPredictionInput,
  impacts: PIEPredictionImpact[] = identifyCascadingImpacts(input),
): PIEPredictionImpact | null {
  return impacts.find(impact => impact.area === 'contractor') ||
    (hasContractorSignal(input)
      ? {
          id: 'impact-contractor-inferred',
          area: 'contractor',
          summary: 'Contractor sequencing may depend on confirming the responsible party and recovery action.',
          severity: 'medium',
          confidence: input.runtime.overallConfidence,
        }
      : null);
}

export function buildRecoveryActions(
  input: PIEPredictionInput,
  context: {
    mostLikelyOutcome?: PIEPredictionOutcome;
    noActionOutcome?: PIEPredictionOutcome;
    cascadingImpacts?: PIEPredictionImpact[];
  } = {},
): PIEPredictionRecoveryAction[] {
  const impacts = context.cascadingImpacts || identifyCascadingImpacts(input);
  const actions = [
    input.scientificResult?.uncertaintyReductionActions[0]
      ? {
          id: 'recovery-scientific-uncertainty',
          action: input.scientificResult.uncertaintyReductionActions[0].action,
          recovers: input.scientificResult.uncertaintyReductionActions[0].reducesUncertainty,
          expectedRecovery: 'Reduces uncertainty before DAVE recommends a stronger action.',
          value: 8,
          requiredEvidence: [input.scientificResult.uncertaintyReductionActions[0].recommendedNextEvidence],
          confidence: input.scientificResult.confidence,
        }
      : null,
    input.deliberation?.deliberatedRecommendation
      ? {
          id: 'recovery-deliberation',
          action: input.deliberation.deliberatedRecommendation.action,
          recovers: input.deliberation.deliberatedRecommendation.whyRecommended,
          expectedRecovery: input.deliberation.deliberatedRecommendation.whyBetterThanAlternatives,
          value: input.deliberation.recommendationReadiness === 'Ready' ? 9 : 6,
          requiredEvidence: input.deliberation.missingEvidence.slice(0, 3),
          confidence: input.deliberation.confidence,
        }
      : null,
    input.patternIntelligence?.patternBasedRecommendations[0]
      ? {
          id: 'recovery-pattern',
          action: input.patternIntelligence.patternBasedRecommendations[0].recommendation,
          recovers: input.patternIntelligence.patternBasedRecommendations[0].reason,
          expectedRecovery: 'Uses a recurring pattern to prevent a repeated failure or delay.',
          value: 7,
          requiredEvidence: input.patternIntelligence.earlyWarnings.slice(0, 2).map(warning => warning.whatToVerify),
          confidence: input.patternIntelligence.patternBasedRecommendations[0].confidence,
        }
      : null,
    input.executiveReasoning?.highestValueAction
      ? {
          id: 'recovery-executive-highest-value',
          action: input.executiveReasoning.highestValueAction.action,
          recovers: input.executiveReasoning.highestValueAction.whyRecommended,
          expectedRecovery: 'Aligns recovery with Executive Reasoning highest-value action.',
          value: input.executiveReasoning.highestValueAction.score.total,
          requiredEvidence: [input.executiveReasoning.judgment.verifyBeforeActing],
          confidence: input.executiveReasoning.confidence,
        }
      : null,
    impacts[0]
      ? {
          id: 'recovery-impact-verification',
          action: `Verify ${impacts[0].area} risk before acting.`,
          recovers: impacts[0].summary,
          expectedRecovery: 'Prevents DAVE from overstating a weak prediction.',
          value: impacts[0].severity === 'high' ? 8 : 5,
          requiredEvidence: buildPredictionEvidenceNeeds(input).slice(0, 3),
          confidence: impacts[0].confidence,
        }
      : null,
  ];

  return actions
    .filter((action): action is PIEPredictionRecoveryAction => Boolean(action))
    .sort((left, right) => right.value - left.value)
    .slice(0, 6);
}

export function scorePredictionConfidence(
  input: PIEPredictionInput,
  impacts: PIEPredictionImpact[] = identifyCascadingImpacts(input),
): PIEPredictionConfidence {
  if (
    input.runtime.evidenceConflicts.length > 0 ||
    input.beliefSystem?.beliefReadiness === 'Blocked' ||
    input.beliefSystem?.beliefReadiness === 'Uncertain' ||
    input.learningResult?.confidenceCalibration.some(item =>
      item.source === 'prediction_failed' || item.adjustment === 'lower',
    )
  ) {
    return 'low';
  }
  if (
    input.runtime.overallConfidence === 'high' &&
    impacts.every(impact => impact.confidence !== 'low') &&
    input.runtime.evidenceGaps.length <= 1
  ) {
    return 'high';
  }
  return 'medium';
}

export function explainPrediction(
  input: PIEPredictionInput,
  outcome: PIEPredictionOutcome = simulateLikelyOutcome(input),
  impacts: PIEPredictionImpact[] = identifyCascadingImpacts(input),
): PIEPredictionExplanation {
  const uncertainty = [
    ...input.runtime.evidenceGaps.slice(0, 3).map(gap => gap.summary),
    ...(input.scientificResult?.uncertainty.slice(0, 3).map(item => item.uncertainty) || []),
    ...(input.beliefSystem?.beliefsNeedingVerification.slice(0, 2).map(belief => belief.explanation.readinessReason) || []),
  ];

  return {
    summary: outcome.likelyOutcome,
    evidence: [
      input.runtime.intelligentSummary.scheduleStatus,
      input.runtime.nextBestAction.why,
      input.memoryRecall?.summaryForPIE,
      input.patternIntelligence?.summary,
    input.executiveReasoning?.judgment.explanation,
      input.situationIntelligence?.situationSummary.whatMattersNow,
      ...impacts.slice(0, 3).map(impact => impact.summary),
    ].filter((item): item is string => Boolean(item)),
    uncertainty,
    doNotOverstate: scorePredictionConfidence(input, impacts) !== 'high',
  };
}

function buildPredictionDependencies(input: PIEPredictionInput): PIEPredictionDependency[] {
  const dependencies: PIEPredictionDependency[] = [
    ...input.runtime.criticalTasks.slice(0, 4).map((task, index) => ({
      id: `dependency-schedule-${task.id || index}`,
      type: 'schedule predecessor/successor' as const,
      summary: `${task.task || 'Critical task'} depends on ${task.dependencies.join(', ') || 'current predecessor work'} in ${task.area || task.project || 'the project'}.`,
      atRisk: task.critical || input.runtime.overdueTasks.some(overdue => overdue.id === task.id),
      confidence: task.confidence,
    })),
    ...input.runtime.graphGaps.slice(0, 3).map((gap, index) => ({
      id: `dependency-evidence-${index + 1}`,
      type: 'evidence dependency' as const,
      summary: gap.summary,
      atRisk: true,
      confidence: gap.confidence,
    })),
    ...input.runtime.priorityQueue.approvalRequired.slice(0, 3).map((item, index) => ({
      id: `dependency-approval-${item.id || index}`,
      type: 'approval dependency' as const,
      summary: item.summary,
      atRisk: true,
      confidence: item.confidence,
    })),
  ];

  if (hasInspectionSignal(input)) {
    dependencies.push({
      id: 'dependency-inspection',
      type: 'inspection dependency',
      summary: 'Inspection readiness depends on verified prerequisite work and current supporting evidence.',
      atRisk: input.runtime.evidenceGaps.length > 0,
      confidence: input.runtime.overallConfidence,
    });
  }
  if (hasContractorSignal(input)) {
    dependencies.push({
      id: 'dependency-contractor',
      type: 'contractor dependency',
      summary: 'Contractor sequencing depends on owner confirmation, manpower, or recovery action.',
      atRisk: true,
      confidence: input.runtime.overallConfidence,
    });
  }
  if (hasSafetySignal(input)) {
    dependencies.push({
      id: 'dependency-safety',
      type: 'safety dependency',
      summary: 'Safety conditions should be verified before advancing work.',
      atRisk: true,
      confidence: input.runtime.overallConfidence,
    });
  }
  if (hasMaterialSignal(input)) {
    dependencies.push({
      id: 'dependency-material',
      type: 'material dependency',
      summary: 'Material availability may affect the next activity.',
      atRisk: true,
      confidence: input.runtime.overallConfidence,
    });
  }

  return uniqueDependencies(dependencies);
}

function outcomeForScenario(
  scenario: PIEPredictionScenario,
  baseOutcome: PIEPredictionOutcome,
  dependencies: PIEPredictionDependency[],
  impacts: PIEPredictionImpact[],
): PIEPredictionOutcome {
  const impact = impacts.find(item => item.area === impactAreaForScenario(scenario));
  return {
    ...baseOutcome,
    id: `outcome-${scenario}`,
    scenario,
    likelyOutcome: impact?.summary || baseOutcome.likelyOutcome,
    dependencies,
  };
}

function buildTimeline(input: PIEPredictionInput, slipDays: number): PIEPredictionTimeline {
  const nextTask = input.runtime.overdueTasks[0] || input.runtime.criticalTasks[0] || input.runtime.upcomingTasks[0];
  return {
    horizonDays: slipDays > 0 ? Math.max(7, slipDays) : 7,
    likelyStart: nextTask?.start || null,
    likelyFinish: nextTask?.finish || null,
    estimatedSlipDays: slipDays,
  };
}

function estimateSlipDays(
  input: PIEPredictionInput,
  scenario: 'best_case' | 'most_likely' | 'worst_case' | 'no_action',
) {
  const overduePressure = input.runtime.overdueTasks.length * 2;
  const criticalPressure = input.runtime.criticalTasks.length > 0 ? 1 : 0;
  const evidencePressure = input.runtime.evidenceGaps.length > 2 ? 1 : 0;
  const patternPressure = input.patternIntelligence?.earlyWarnings.length ? 1 : 0;
  const beliefPressure = input.beliefSystem?.beliefReadiness !== 'Ready' ? 1 : 0;
  const base = overduePressure + criticalPressure + evidencePressure + patternPressure + beliefPressure;

  if (scenario === 'best_case') return Math.max(0, base - 3);
  if (scenario === 'worst_case') return base + 3;
  if (scenario === 'no_action') return base + 2;
  return base;
}

function likelyOutcomeText(input: PIEPredictionInput, slipDays: number) {
  if (slipDays > 0) {
    return `${input.runtime.projectName} may see a ${slipDays} day${slipDays === 1 ? '' : 's'} schedule or readiness impact unless the current risk is verified and recovered.`;
  }
  if (input.runtime.evidenceGaps.length > 0) {
    return 'The likely outcome depends on filling missing evidence before DAVE can recommend action confidently.';
  }
  return 'Current evidence does not predict a major slip, but DAVE should continue monitoring schedule, safety, and inspection dependencies.';
}

function scheduleImpactText(input: PIEPredictionInput, slipDays: number) {
  if (slipDays > 0) return `Schedule may slip by about ${slipDays} day${slipDays === 1 ? '' : 's'}.`;
  if (input.runtime.criticalTasks.length > 0) return 'Critical work should be monitored, but no slip is currently predicted.';
  return 'No schedule impact is predicted from current evidence.';
}

function inspectionImpactText(input: PIEPredictionInput, slipDays: number) {
  if (!hasInspectionSignal(input)) return 'No direct inspection impact is confirmed.';
  return slipDays > 0
    ? 'Inspection readiness may slip if prerequisite work or evidence is not verified.'
    : 'Inspection readiness should be verified before the next dependent activity.';
}

function contractorImpactText(input: PIEPredictionInput) {
  if (!hasContractorSignal(input)) return 'No direct contractor impact is confirmed.';
  return 'Contractor sequencing or owner follow-up may affect recovery.';
}

function buildPredictionEvidenceNeeds(
  input: PIEPredictionInput,
  dependencies: PIEPredictionDependency[] = buildPredictionDependencies(input),
) {
  return Array.from(new Set([
    ...input.runtime.recommendedEvidence,
    ...(input.scientificResult?.recommendedNextEvidence || []),
    ...(input.scientificResult?.hypotheses.slice(0, 2).map(hypothesis => hypothesis.testNeeded) || []),
    ...(input.scientificResult?.alternatives.slice(0, 2).map(alternative => alternative.risk) || []),
    ...(input.deliberation?.alternativesConsidered.slice(0, 2).map(alternative => alternative.risk) || []),
    ...(input.learningResult?.futureAdjustments.slice(0, 3) || []),
    ...(input.learningResult?.memoryConsolidation
      .filter(item => item.influenceType === 'failed response' || item.influenceType === 'future caution')
      .slice(0, 3)
      .map(item => item.influence) || []),
    ...(input.deliberation?.missingEvidence || []),
    ...(input.situationIntelligence?.situationUnknowns.slice(0, 3).map(unknown => unknown.recommendedEvidence) || []),
    ...(input.situationIntelligence?.situationPriorities.slice(0, 2).map(priority => priority.action) || []),
    ...(input.patternIntelligence?.earlyWarnings.map(warning => warning.whatToVerify) || []),
    ...(input.beliefSystem?.beliefsNeedingVerification.map(belief =>
      belief.recommendedEvidence[0] || belief.explanation.readinessReason,
    ) || []),
    ...dependencies.filter(dependency => dependency.atRisk).map(dependency => dependency.summary),
  ].filter(Boolean))).slice(0, 8);
}

function hasInspectionSignal(input: PIEPredictionInput) {
  return /inspection|inspect|permit/i.test([
    input.runtime.intelligentSummary.scheduleStatus,
    ...input.runtime.recommendedWalkAreas,
    ...input.runtime.criticalTasks.map(task => `${task.task} ${task.notes || ''}`),
    input.executiveReasoning?.judgment.verifyBeforeActing,
  ].filter(Boolean).join(' '));
}

function hasContractorSignal(input: PIEPredictionInput) {
  return /contractor|owner|crew|trade|manpower|waiting|blocked/i.test([
    input.runtime.intelligentSummary.risksAndIssues,
    input.executiveReasoning?.judgment.stoppedMoving,
    ...input.runtime.insights.map(insight => insight.summary),
    ...(input.patternIntelligence?.recurringIssues.map(issue => issue.summary) || []),
  ].filter(Boolean).join(' '));
}

function hasSafetySignal(input: PIEPredictionInput) {
  return /safety|hazard|hot work|injury|unsafe/i.test([
    input.runtime.intelligentSummary.safetySummary,
    ...input.runtime.insights.map(insight => insight.summary),
    ...(input.beliefSystem?.beliefs.map(belief => belief.statement) || []),
  ].join(' '));
}

function hasQualitySignal(input: PIEPredictionInput) {
  return /quality|rework|defect|failed|punch|not acceptable/i.test([
    input.runtime.intelligentSummary.risksAndIssues,
    ...(input.patternIntelligence?.failedPatterns.map(pattern => pattern.summary) || []),
    ...(input.beliefSystem?.challengedBeliefs.map(belief => belief.statement) || []),
  ].join(' '));
}

function hasMaterialSignal(input: PIEPredictionInput) {
  return /material|delivery|staged|equipment|procurement/i.test([
    input.runtime.intelligentSummary.risksAndIssues,
    ...input.runtime.insights.map(insight => insight.summary),
  ].join(' '));
}

function impactAreaForScenario(scenario: PIEPredictionScenario): PIEPredictionImpact['area'] {
  if (scenario === 'inspection_delay') return 'inspection';
  if (scenario === 'contractor_delay') return 'contractor';
  if (scenario === 'safety_issue') return 'safety';
  if (scenario === 'quality_issue') return 'quality';
  if (scenario === 'missing_evidence') return 'evidence';
  if (scenario === 'decision_delay') return 'communication';
  return 'schedule';
}

function impactAreaForPattern(patternType: string): PIEPredictionImpact['area'] {
  if (/inspection/i.test(patternType)) return 'inspection';
  if (/contractor|resource/i.test(patternType)) return 'contractor';
  if (/safety/i.test(patternType)) return 'safety';
  if (/quality/i.test(patternType)) return 'quality';
  if (/communication/i.test(patternType)) return 'communication';
  if (/missing_evidence/i.test(patternType)) return 'evidence';
  return 'schedule';
}

function impactAreaForSituationRisk(risk: string): PIEPredictionImpact['area'] {
  if (/inspection|inspect|permit/i.test(risk)) return 'inspection';
  if (/contractor|owner|crew|trade/i.test(risk)) return 'contractor';
  if (/safety|hazard/i.test(risk)) return 'safety';
  if (/quality|rework|defect/i.test(risk)) return 'quality';
  if (/report|communicat|decision|approval/i.test(risk)) return 'communication';
  if (/evidence|photo|note|unknown|verify/i.test(risk)) return 'evidence';
  return 'schedule';
}

function impactAreaFromDependency(dependency: PIEPredictionDependency): PIEPredictionImpact['area'] {
  if (dependency.type === 'inspection dependency') return 'inspection';
  if (dependency.type === 'contractor dependency' || dependency.type === 'material dependency') return 'contractor';
  if (dependency.type === 'safety dependency') return 'safety';
  if (dependency.type === 'approval dependency') return 'communication';
  if (dependency.type === 'evidence dependency') return 'evidence';
  return 'schedule';
}

function propagationForImpact(impact: PIEPredictionImpact) {
  if (impact.area === 'schedule') return 'May push successor work or readiness dates.';
  if (impact.area === 'inspection') return 'May delay inspection readiness and follow-on work.';
  if (impact.area === 'contractor') return 'May delay recovery until owner or contractor action is confirmed.';
  if (impact.area === 'safety') return 'May require immediate verification before work continues.';
  if (impact.area === 'communication') return 'May delay decisions or action-item closure.';
  return 'May reduce DAVE confidence until more evidence is collected.';
}

function confidenceFromRiskLevel(
  riskLevel: PIEPredictionOutcome['riskLevel'],
  input: PIEPredictionInput,
): PIEPredictionConfidence {
  if (input.runtime.overallConfidence === 'low') return 'low';
  if (riskLevel === 'high' && input.runtime.overallConfidence === 'high') return 'high';
  return 'medium';
}

function uniqueImpacts(impacts: PIEPredictionImpact[]) {
  const seen = new Set<string>();
  return impacts.filter(impact => {
    const key = `${impact.area}|${impact.summary}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueDependencies(dependencies: PIEPredictionDependency[]) {
  const seen = new Set<string>();
  return dependencies.filter(dependency => {
    const key = `${dependency.type}|${dependency.summary}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
