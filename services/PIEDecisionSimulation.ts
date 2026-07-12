import type {
  PIEExecutiveAction,
  PIEExecutiveJudgmentResult,
} from './PIEExecutiveJudgment';
import type { PIEExecutiveJudgmentRecord } from './PIEExecutiveJudgmentRepository';
import type { PIEMissingEvidenceResult } from './PIEMissingEvidence';
import type {
  PIEPredictiveRealityResult,
  PIERealityForecast,
} from './PIEPredictiveReality';
import type {
  PIERealityConflict,
  PIERealityModel,
  PIERealityUncertaintyRecord,
} from './PIERealityModel';
import type { PIEPhotoProgressIntelligenceResult } from './PIEPhotoProgressIntelligence';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEDecisionOptionType =
  | 'recommended_action'
  | 'credible_alternative'
  | 'no_action'
  | 'delay_and_gather_evidence'
  | 'escalation';

export type PIEDecisionSimulationScenarioType =
  | 'expected_case'
  | 'best_reasonable_case'
  | 'worst_reasonable_case'
  | 'evidence_deficient_case'
  | 'delay_case'
  | 'execution_failure_case'
  | 'resource_shortage'
  | 'vendor_delay'
  | 'inspection_failure'
  | 'permit_delay'
  | 'cost_increase'
  | 'schedule_compression'
  | 'incomplete_implementation'
  | 'conflicting_stakeholder_direction'
  | 'recurrence_of_original_issue'
  | 'visual_progress_not_matching_reported_progress';

export type PIEDecisionScoreCategory =
  | 'safety'
  | 'compliance'
  | 'project_objective_alignment'
  | 'risk_reduction'
  | 'schedule_impact'
  | 'cost_impact'
  | 'resource_feasibility'
  | 'operational_disruption'
  | 'evidence_strength'
  | 'reversibility'
  | 'implementation_complexity'
  | 'stakeholder_impact'
  | 'uncertainty'
  | 'future_flexibility'
  | 'execution_reliability';

export type PIEDecisionRobustness =
  | 'robust'
  | 'moderately_sensitive'
  | 'highly_sensitive'
  | 'unstable'
  | 'insufficient_evidence';

export type PIEDecisionOption = {
  optionId: string;
  optionType: PIEDecisionOptionType;
  action: string;
  rationale: string;
  prerequisites: string[];
  expectedOutcome: string;
  expectedTimeframe: string;
  estimatedCostDirection: 'decrease' | 'neutral' | 'increase' | 'unknown';
  scheduleImpact: 'improves' | 'neutral' | 'delays' | 'unknown';
  resourceImpact: string;
  safetyImpact: string;
  complianceImpact: string;
  operationalImpact: string;
  reversibility: 'high' | 'medium' | 'low';
  evidenceRequired: string[];
  assumptions: string[];
  risks: string[];
  uncertainty: string[];
  authorityRequired: string;
};

export type PIEDecisionScenarioResult = {
  scenarioId: string;
  optionId: string;
  scenarioType: PIEDecisionSimulationScenarioType;
  outcome: string;
  scheduleImpact: string;
  costImpact: string;
  riskImpact: string;
  confidence: ProjectConfidenceLevel;
  assumptionsUsed: string[];
  evidenceUsed: string[];
  reproducibilityKey: string;
};

export type PIEDecisionScoreComponent = {
  category: PIEDecisionScoreCategory;
  score: number;
  weight: number;
  evidenceUsed: string[];
  assumptions: string[];
  uncertaintyRange: [number, number];
  adjustment: number;
  explanation: string;
  gateStatus?: 'pass' | 'warning' | 'fail';
};

export type PIEDecisionOptionScore = {
  optionId: string;
  components: PIEDecisionScoreComponent[];
  totalWeightedScore: number;
  disqualified: boolean;
  disqualificationReasons: string[];
  explanation: string;
};

export type PIEDecisionSensitivityFactor = {
  factor:
    | 'cost'
    | 'duration'
    | 'resource_availability'
    | 'evidence_confidence'
    | 'risk_likelihood'
    | 'risk_severity'
    | 'implementation_quality'
    | 'deadline'
    | 'stakeholder_availability'
    | 'schedule_deadlines'
    | 'photo_progress_interpretation'
    | 'regulatory_interpretation';
  currentAssumption: string;
  testedChange: string;
  preferredOptionAfterChange: string;
  changesRecommendation: boolean;
  explanation: string;
};

export type PIEDecisionSensitivityAnalysis = {
  robustness: PIEDecisionRobustness;
  factors: PIEDecisionSensitivityFactor[];
  assumptionsThatMatterMost: string[];
  changeThatWouldSwitchRecommendation: string[];
  missingEvidenceThatImprovesDecision: string[];
};

export type PIEDecisionSimulationProvenance = {
  realityModelId: string;
  realityModelVersion: number;
  executiveJudgmentId: string | null;
  simulationRunId: string;
  optionIdsConsidered: string[];
  selectedOptionId: string | null;
  rejectedAlternativeIds: string[];
  scoringBreakdownIds: string[];
  evidenceCutoff: string;
  conflictsConsidered: string[];
  uncertaintiesConsidered: string[];
  assumptions: string[];
  conditionsThatWouldChangeRecommendation: string[];
  photoProgressEventIdsUsed: string[];
  inputSignature: string;
};

export type PIEDecisionSimulationResult = {
  generatedAt: string;
  simulationRunId: string;
  inputSignature: string;
  cacheable: boolean;
  rerunRequired: boolean;
  materialChangeReasons: string[];
  options: PIEDecisionOption[];
  scenarios: PIEDecisionScenarioResult[];
  scores: PIEDecisionOptionScore[];
  selectedOption: PIEDecisionOption | null;
  rejectedAlternatives: PIEDecisionOption[];
  sensitivityAnalysis: PIEDecisionSensitivityAnalysis;
  safetyGateFailures: string[];
  complianceGateFailures: string[];
  provenance: PIEDecisionSimulationProvenance;
  summary: string;
};

export type PIEDecisionSimulationInput = {
  realityModel: PIERealityModel;
  executiveJudgment: PIEExecutiveJudgmentResult;
  executiveJudgmentRecord?: PIEExecutiveJudgmentRecord | null;
  predictiveReality?: PIEPredictiveRealityResult | null;
  missingEvidence?: PIEMissingEvidenceResult | null;
  longitudinalPhotoIntelligence?: Pick<PIEPhotoProgressIntelligenceResult, 'progressEvents' | 'conflicts' | 'progressEstimate'> | null;
  priorSimulation?: Pick<PIEDecisionSimulationResult, 'inputSignature' | 'selectedOption' | 'scores'> | null;
  projectGoals?: string[];
  activeRisks?: string[];
  activeConstraints?: string[];
  dependencies?: string[];
  scheduleState?: string[];
  costInformation?: string[];
  resourceAvailability?: string[];
  authorityBoundaries?: string[];
  generatedAt?: string;
};

const BASE_SCENARIOS: PIEDecisionSimulationScenarioType[] = [
  'expected_case',
  'best_reasonable_case',
  'worst_reasonable_case',
  'evidence_deficient_case',
  'delay_case',
  'execution_failure_case',
];

const SCORE_WEIGHTS: Record<PIEDecisionScoreCategory, number> = {
  safety: 12,
  compliance: 12,
  project_objective_alignment: 10,
  risk_reduction: 10,
  schedule_impact: 8,
  cost_impact: 7,
  resource_feasibility: 7,
  operational_disruption: 6,
  evidence_strength: 9,
  reversibility: 5,
  implementation_complexity: 5,
  stakeholder_impact: 5,
  uncertainty: 8,
  future_flexibility: 6,
  execution_reliability: 8,
};

export function buildPIEDecisionSimulation(
  input: PIEDecisionSimulationInput,
): PIEDecisionSimulationResult {
  const generatedAt = input.generatedAt || input.executiveJudgment.generatedAt || new Date().toISOString();
  const inputSignature = buildSimulationInputSignature(input);
  const options = generateDecisionOptions(input);
  const scenarios = options.flatMap(option => simulateDecisionOption(option, input, generatedAt));
  const scores = options.map(option => scoreDecisionOption(option, input, scenarios));
  const selectedOption = selectPreferredOption(options, scores);
  const rejectedAlternatives = options.filter(option => option.optionId !== selectedOption?.optionId);
  const sensitivityAnalysis = runDecisionSensitivityAnalysis(input, options, scores, selectedOption);
  const safetyGateFailures = scores.flatMap(score =>
    score.components
      .filter(component => component.category === 'safety' && component.gateStatus === 'fail')
      .map(component => `${score.optionId}: ${component.explanation}`),
  );
  const complianceGateFailures = scores.flatMap(score =>
    score.components
      .filter(component => component.category === 'compliance' && component.gateStatus === 'fail')
      .map(component => `${score.optionId}: ${component.explanation}`),
  );
  const materialChangeReasons = detectMaterialSimulationChange(input, inputSignature, selectedOption, scores);
  const simulationRunId = `simulation-${input.realityModel.organizationId}-${input.realityModel.projectId}-v${input.realityModel.version}-${hashText(inputSignature)}`;

  return {
    generatedAt,
    simulationRunId,
    inputSignature,
    cacheable: true,
    rerunRequired: materialChangeReasons.length > 0,
    materialChangeReasons,
    options,
    scenarios,
    scores,
    selectedOption,
    rejectedAlternatives,
    sensitivityAnalysis,
    safetyGateFailures,
    complianceGateFailures,
    provenance: buildDecisionSimulationProvenance(input, simulationRunId, inputSignature, options, selectedOption, scores),
    summary: summarizeDecisionSimulation(selectedOption, sensitivityAnalysis, safetyGateFailures, complianceGateFailures),
  };
}

export function generateDecisionOptions(input: PIEDecisionSimulationInput): PIEDecisionOption[] {
  const options: PIEDecisionOption[] = [];
  const action = input.executiveJudgment.highestValueAction;
  if (action) options.push(optionFromExecutiveAction(action, input, 'recommended_action'));

  const alternative = input.executiveJudgment.tradeoffAnalysis.options
    .find(item => item.label !== action?.action && item.actionType !== action?.type);
  if (alternative) {
    options.push({
      optionId: `option-alt-${hashText(alternative.label)}`,
      optionType: 'credible_alternative',
      action: alternative.label,
      rationale: alternative.gains[0] || 'Credible alternative considered by Executive Judgment.',
      prerequisites: ['Confirm owner and current field conditions before execution.'],
      expectedOutcome: alternative.gains.join(' ') || 'Alternative may reduce uncertainty or protect schedule.',
      expectedTimeframe: 'Current decision window.',
      estimatedCostDirection: alternative.losses.some(item => /cost/i.test(item)) ? 'increase' : 'unknown',
      scheduleImpact: alternative.gains.some(item => /schedule|time/i.test(item)) ? 'improves' : 'unknown',
      resourceImpact: alternative.losses.find(item => /resource|crew|owner/i.test(item)) || 'Resource impact must be confirmed.',
      safetyImpact: inferSafetyImpact(input),
      complianceImpact: inferComplianceImpact(input),
      operationalImpact: alternative.losses[0] || 'Operational impact depends on implementation quality.',
      reversibility: 'medium',
      evidenceRequired: evidenceRequired(input),
      assumptions: assumptionsFromInput(input),
      risks: risksFromInput(input),
      uncertainty: uncertaintyFromInput(input),
      authorityRequired: input.executiveJudgment.escalationAnalysis.target.role || 'User',
    });
  }

  options.push(buildNoActionOption(input));
  if (input.executiveJudgment.waitForEvidenceReasoning.shouldWaitForEvidence || uncertaintyFromInput(input).length > 0) {
    options.push(buildDelayEvidenceOption(input));
  }
  if (input.executiveJudgment.escalationAnalysis.shouldEscalate) {
    options.push(buildEscalationOption(input));
  }

  return dedupeOptions(options);
}

export function simulateDecisionOption(
  option: PIEDecisionOption,
  input: PIEDecisionSimulationInput,
  generatedAt: string = new Date().toISOString(),
): PIEDecisionScenarioResult[] {
  const scenarioTypes = [
    ...BASE_SCENARIOS,
    ...relevantOptionalScenarios(input),
  ];
  return scenarioTypes.map(scenarioType => {
    const confidence = scenarioConfidence(option, input, scenarioType);
    return {
      scenarioId: `scenario-${option.optionId}-${scenarioType}`,
      optionId: option.optionId,
      scenarioType,
      outcome: scenarioOutcome(option, input, scenarioType),
      scheduleImpact: scenarioScheduleImpact(option, scenarioType),
      costImpact: scenarioCostImpact(option, scenarioType),
      riskImpact: scenarioRiskImpact(option, input, scenarioType),
      confidence,
      assumptionsUsed: option.assumptions,
      evidenceUsed: option.evidenceRequired,
      reproducibilityKey: hashText([
        option.optionId,
        scenarioType,
        input.realityModel.version,
        input.executiveJudgment.authority.evidenceCutoffTime,
        generatedAt.slice(0, 10),
      ].join('|')),
    };
  });
}

export function scoreDecisionOption(
  option: PIEDecisionOption,
  input: PIEDecisionSimulationInput,
  scenarios: PIEDecisionScenarioResult[],
): PIEDecisionOptionScore {
  const optionScenarios = scenarios.filter(scenario => scenario.optionId === option.optionId);
  const components = (Object.keys(SCORE_WEIGHTS) as PIEDecisionScoreCategory[])
    .map(category => scoreCategory(category, option, input, optionScenarios));
  const disqualificationReasons = components
    .filter(component => component.gateStatus === 'fail')
    .map(component => component.explanation);
  const weighted = components.reduce(
    (total, component) => total + Math.max(0, component.score + component.adjustment) * component.weight,
    0,
  );
  const weights = components.reduce((total, component) => total + component.weight, 0);

  return {
    optionId: option.optionId,
    components,
    totalWeightedScore: disqualificationReasons.length > 0 ? 0 : Math.round(weighted / Math.max(1, weights)),
    disqualified: disqualificationReasons.length > 0,
    disqualificationReasons,
    explanation: disqualificationReasons.length
      ? `Disqualified because ${disqualificationReasons.join(' ')}`
      : `${option.action} scored from traceable category evidence, assumptions, and uncertainty.`,
  };
}

export function runDecisionSensitivityAnalysis(
  input: PIEDecisionSimulationInput,
  options: PIEDecisionOption[],
  scores: PIEDecisionOptionScore[],
  selectedOption: PIEDecisionOption | null,
): PIEDecisionSensitivityAnalysis {
  const factors: PIEDecisionSensitivityFactor[] = [
    sensitivity('cost', 'Cost information is estimated from current evidence.', 'Cost increases by one category.', input, options, scores, selectedOption),
    sensitivity('duration', 'Duration is inferred from schedule/readiness.', 'Duration extends past the decision window.', input, options, scores, selectedOption),
    sensitivity('resource_availability', 'Required owner/resources remain available.', 'Key resource becomes unavailable.', input, options, scores, selectedOption),
    sensitivity('evidence_confidence', `Evidence readiness is ${input.missingEvidence?.summary || input.realityModel.summary.confidence}.`, 'Evidence confidence drops one level.', input, options, scores, selectedOption),
    sensitivity('risk_likelihood', 'Risk likelihood follows current Reality risks.', 'Risk becomes more likely.', input, options, scores, selectedOption),
    sensitivity('risk_severity', 'Risk severity remains as currently classified.', 'Risk severity increases one level.', input, options, scores, selectedOption),
    sensitivity('implementation_quality', 'Implementation follows approved scope.', 'Implementation is incomplete or low fidelity.', input, options, scores, selectedOption),
    sensitivity('deadline', 'Deadline pressure follows the authoritative schedule state.', 'Decision deadline moves earlier or becomes less flexible.', input, options, scores, selectedOption),
    sensitivity('stakeholder_availability', 'Stakeholders can respond inside the decision window.', 'Stakeholder response is delayed.', input, options, scores, selectedOption),
    sensitivity('schedule_deadlines', 'Schedule deadlines remain as currently imported.', 'Deadline moves earlier.', input, options, scores, selectedOption),
    sensitivity('photo_progress_interpretation', 'Photo progress is treated as qualified observation or inference, not proof of completion.', 'Photo interpretation is downgraded or conflicts with written status.', input, options, scores, selectedOption),
    sensitivity('regulatory_interpretation', 'Compliance interpretation remains unchanged.', 'Compliance interpretation becomes stricter.', input, options, scores, selectedOption),
  ];
  const changes = factors.filter(factor => factor.changesRecommendation);
  const robustness: PIEDecisionRobustness =
    options.length === 0 || input.executiveJudgment.confidence === 'low'
      ? 'insufficient_evidence'
      : changes.length === 0
        ? 'robust'
        : changes.length <= 2
          ? 'moderately_sensitive'
          : changes.length <= 5
            ? 'highly_sensitive'
            : 'unstable';

  return {
    robustness,
    factors,
    assumptionsThatMatterMost: factors
      .filter(factor => factor.changesRecommendation)
      .map(factor => factor.currentAssumption)
      .slice(0, 5),
    changeThatWouldSwitchRecommendation: factors
      .filter(factor => factor.changesRecommendation)
      .map(factor => factor.testedChange)
      .slice(0, 5),
    missingEvidenceThatImprovesDecision: evidenceRequired(input).slice(0, 3),
  };
}

export function buildSimulationInputSignature(input: PIEDecisionSimulationInput): string {
  return stableStringify({
    realityModelVersion: input.realityModel.version,
    evidenceCutoff: input.executiveJudgment.authority.evidenceCutoffTime,
    recommendation: input.executiveJudgment.highestValueAction?.action,
    conflicts: input.realityModel.evidenceConflicts.map(conflict => `${conflict.id}:${conflict.status}`),
    uncertainties: input.realityModel.activeUncertainties.map(uncertainty => `${uncertainty.id}:${uncertainty.status}`),
    constraints: input.executiveJudgment.executiveConstraints.map(constraint => constraint.constraint),
    risks: input.executiveJudgment.executiveRisks.map(risk => `${risk.risk}:${risk.severity}`),
    missingEvidence: input.missingEvidence?.minimumEvidenceNeeded.map(request => request.id) || [],
    photoProgressEvents: input.longitudinalPhotoIntelligence?.progressEvents.map(event => `${event.id}:${event.progressDirection}:${event.verificationStatus}`) || [],
    photoProgressConflicts: input.longitudinalPhotoIntelligence?.conflicts.map(conflict => `${conflict.id}:${conflict.conflictType}`) || [],
    authority: input.executiveJudgment.escalationAnalysis.target.role,
  });
}

export function detectMaterialSimulationChange(
  input: PIEDecisionSimulationInput,
  inputSignature: string,
  selectedOption: PIEDecisionOption | null,
  scores: PIEDecisionOptionScore[],
): string[] {
  const prior = input.priorSimulation;
  if (!prior) return ['No prior simulation cache is available.'];
  const reasons: string[] = [];
  if (prior.inputSignature !== inputSignature) reasons.push('Simulation input signature changed.');
  if (prior.selectedOption?.optionId !== selectedOption?.optionId) reasons.push('Preferred option changed.');
  const priorTop = prior.scores[0]?.totalWeightedScore ?? null;
  const nextTop = scores[0]?.totalWeightedScore ?? null;
  if (priorTop !== null && nextTop !== null && Math.abs(priorTop - nextTop) >= 10) {
    reasons.push('Option ranking or score changed materially.');
  }
  if (input.executiveJudgment.confidence !== 'high') reasons.push('Recommendation confidence is not high.');
  return reasons;
}

function optionFromExecutiveAction(
  action: PIEExecutiveAction,
  input: PIEDecisionSimulationInput,
  optionType: PIEDecisionOptionType,
): PIEDecisionOption {
  return {
    optionId: `option-${optionType}-${hashText(action.action)}`,
    optionType,
    action: action.action,
    rationale: action.why,
    prerequisites: action.governance.assumptions.length
      ? action.governance.assumptions
      : ['Confirm current Reality Model evidence remains valid.'],
    expectedOutcome: action.expectedOutcome,
    expectedTimeframe: input.executiveJudgment.decisionTiming.decisionWindow,
    estimatedCostDirection: costDirection(action.action),
    scheduleImpact: scheduleImpact(action.action, action.score.scheduleImpact),
    resourceImpact: input.executiveJudgment.executiveResourceNeeds[0]?.reason || 'Resource impact appears manageable with assigned ownership.',
    safetyImpact: inferSafetyImpact(input),
    complianceImpact: inferComplianceImpact(input),
    operationalImpact: action.governance.expectedOutcome,
    reversibility: action.score.reversibility >= 7 ? 'high' : action.score.reversibility >= 4 ? 'medium' : 'low',
    evidenceRequired: action.governance.supportingEvidence.length
      ? action.governance.supportingEvidence
      : evidenceRequired(input),
    assumptions: action.governance.assumptions,
    risks: risksFromInput(input),
    uncertainty: action.governance.uncertainty.length ? action.governance.uncertainty : uncertaintyFromInput(input),
    authorityRequired: input.executiveJudgment.escalationAnalysis.shouldEscalate
      ? input.executiveJudgment.escalationAnalysis.target.role
      : input.executiveJudgment.authority.projectId ? 'Project authority' : 'User',
  };
}

function buildNoActionOption(input: PIEDecisionSimulationInput): PIEDecisionOption {
  return {
    optionId: 'option-no-action',
    optionType: 'no_action',
    action: 'Take no immediate action and monitor for material change.',
    rationale: input.executiveJudgment.noActionReasoning.reason,
    prerequisites: input.executiveJudgment.noActionReasoning.monitoringNeeded,
    expectedOutcome: input.executiveJudgment.noActionReasoning.isValid
      ? 'Avoid unnecessary action while monitoring reassessment triggers.'
      : 'Risk may remain unresolved if no action is taken.',
    expectedTimeframe: input.executiveJudgment.decisionTiming.decisionWindow,
    estimatedCostDirection: 'neutral',
    scheduleImpact: input.executiveJudgment.executiveRisks.some(risk => /schedule/i.test(risk.risk)) ? 'delays' : 'neutral',
    resourceImpact: 'Lowest immediate resource use.',
    safetyImpact: inferSafetyImpact(input),
    complianceImpact: inferComplianceImpact(input),
    operationalImpact: 'Minimal disruption, but unresolved uncertainty may persist.',
    reversibility: 'high',
    evidenceRequired: input.executiveJudgment.noActionReasoning.monitoringNeeded,
    assumptions: ['Current risk does not worsen before reassessment.'],
    risks: input.executiveJudgment.noActionReasoning.unnecessaryActionRisks,
    uncertainty: uncertaintyFromInput(input),
    authorityRequired: 'User',
  };
}

function buildDelayEvidenceOption(input: PIEDecisionSimulationInput): PIEDecisionOption {
  return {
    optionId: 'option-delay-evidence',
    optionType: 'delay_and_gather_evidence',
    action: input.executiveJudgment.waitForEvidenceReasoning.smallestEvidenceRequest || 'Delay briefly and collect the highest-value missing evidence.',
    rationale: input.executiveJudgment.waitForEvidenceReasoning.reason,
    prerequisites: evidenceRequired(input).slice(0, 3),
    expectedOutcome: 'DAVE can make a stronger recommendation with less uncertainty.',
    expectedTimeframe: 'Before the next irreversible or high-impact decision.',
    estimatedCostDirection: 'neutral',
    scheduleImpact: input.executiveJudgment.decisionTiming.timeSensitivity === 'immediate' ? 'delays' : 'neutral',
    resourceImpact: 'Requires targeted evidence capture only.',
    safetyImpact: 'Improves safety confidence if safety evidence is missing.',
    complianceImpact: 'Improves compliance confidence if compliance evidence is missing.',
    operationalImpact: 'Small interruption in exchange for better certainty.',
    reversibility: 'high',
    evidenceRequired: evidenceRequired(input).slice(0, 3),
    assumptions: ['Evidence can be collected within the decision window.'],
    risks: ['Delay may reduce schedule flexibility if the issue is urgent.'],
    uncertainty: uncertaintyFromInput(input),
    authorityRequired: 'User',
  };
}

function buildEscalationOption(input: PIEDecisionSimulationInput): PIEDecisionOption {
  return {
    optionId: 'option-escalation',
    optionType: 'escalation',
    action: input.executiveJudgment.escalationAnalysis.target.ask,
    rationale: input.executiveJudgment.escalationAnalysis.justification,
    prerequisites: input.executiveJudgment.escalationAnalysis.evidenceRequiredBeforeEscalation,
    expectedOutcome: 'Authority resolves the blocking decision or assigns accountable ownership.',
    expectedTimeframe: input.executiveJudgment.escalationAnalysis.timing === 'now' ? 'Now' : 'After verification.',
    estimatedCostDirection: 'unknown',
    scheduleImpact: 'improves',
    resourceImpact: `Requires ${input.executiveJudgment.escalationAnalysis.target.role}.`,
    safetyImpact: inferSafetyImpact(input),
    complianceImpact: inferComplianceImpact(input),
    operationalImpact: input.executiveJudgment.escalationAnalysis.escalationRisk,
    reversibility: 'medium',
    evidenceRequired: input.executiveJudgment.escalationAnalysis.evidenceRequiredBeforeEscalation,
    assumptions: ['Escalation target is available and has authority.'],
    risks: [input.executiveJudgment.escalationAnalysis.escalationRisk],
    uncertainty: uncertaintyFromInput(input),
    authorityRequired: input.executiveJudgment.escalationAnalysis.target.role,
  };
}

function relevantOptionalScenarios(input: PIEDecisionSimulationInput): PIEDecisionSimulationScenarioType[] {
  const text = stableStringify(input).toLowerCase();
  return [
    text.includes('resource') || text.includes('crew') ? 'resource_shortage' : null,
    text.includes('vendor') ? 'vendor_delay' : null,
    text.includes('inspection') ? 'inspection_failure' : null,
    text.includes('permit') ? 'permit_delay' : null,
    text.includes('cost') ? 'cost_increase' : null,
    text.includes('schedule') ? 'schedule_compression' : null,
    'incomplete_implementation',
    text.includes('stakeholder') || text.includes('owner') ? 'conflicting_stakeholder_direction' : null,
    input.executiveJudgment.executiveJudgment.whenNoActionIsCorrect ? 'recurrence_of_original_issue' : null,
    hasVisualWrittenConflict(input) ? 'visual_progress_not_matching_reported_progress' : null,
  ].filter((item): item is PIEDecisionSimulationScenarioType => Boolean(item));
}

function scoreCategory(
  category: PIEDecisionScoreCategory,
  option: PIEDecisionOption,
  input: PIEDecisionSimulationInput,
  scenarios: PIEDecisionScenarioResult[],
): PIEDecisionScoreComponent {
  const base = baseScore(category, option, input, scenarios);
  const uncertaintyPenalty = option.uncertainty.length > 2 ? -1 : 0;
  const gateStatus =
    category === 'safety' && /violat|unsafe|critical safety/i.test(option.safetyImpact)
      ? 'fail'
      : category === 'compliance' && /violat|non.?compliance/i.test(option.complianceImpact)
        ? 'fail'
        : base <= 3 && (category === 'safety' || category === 'compliance')
          ? 'warning'
          : 'pass';
  return {
    category,
    score: base,
    weight: SCORE_WEIGHTS[category],
    evidenceUsed: option.evidenceRequired.slice(0, 4),
    assumptions: option.assumptions.slice(0, 4),
    uncertaintyRange: [Math.max(0, base - 2), Math.min(10, base + 2)],
    adjustment: uncertaintyPenalty,
    explanation: explainCategoryScore(category, option, base),
    gateStatus,
  };
}

function baseScore(
  category: PIEDecisionScoreCategory,
  option: PIEDecisionOption,
  input: PIEDecisionSimulationInput,
  scenarios: PIEDecisionScenarioResult[],
): number {
  const recommended = option.optionType === 'recommended_action';
  const delay = option.optionType === 'delay_and_gather_evidence';
  const noAction = option.optionType === 'no_action';
  const escalation = option.optionType === 'escalation';
  const hasCriticalRisk = input.executiveJudgment.executiveRisks.some(risk => risk.severity === 'critical' || risk.severity === 'high');
  const hasWeakEvidence = input.executiveJudgment.confidence === 'low' || (input.missingEvidence?.minimumEvidenceNeeded.length || 0) > 0;
  const scenarioRisk = scenarios.some(scenario => scenario.scenarioType === 'worst_reasonable_case' && /increase|remain/i.test(scenario.riskImpact));

  switch (category) {
    case 'safety':
      return hasCriticalRisk && noAction ? 4 : /safety/i.test(option.action + option.risks.join(' ')) ? 8 : 7;
    case 'compliance':
      return /compliance|permit|inspection/i.test(option.action + option.risks.join(' ')) ? 8 : 7;
    case 'project_objective_alignment':
      return recommended ? 9 : delay && hasWeakEvidence ? 8 : noAction && hasCriticalRisk ? 3 : 6;
    case 'risk_reduction':
      return noAction ? (hasCriticalRisk ? 2 : 6) : escalation ? 8 : recommended ? 8 : 6;
    case 'schedule_impact':
      return option.scheduleImpact === 'improves' ? 8 : option.scheduleImpact === 'delays' ? 4 : 6;
    case 'cost_impact':
      return option.estimatedCostDirection === 'decrease' ? 8 : option.estimatedCostDirection === 'increase' ? 4 : 6;
    case 'resource_feasibility':
      return /missing|unavailable/i.test(option.resourceImpact) ? 4 : 7;
    case 'operational_disruption':
      return /minimal|small|low/i.test(option.operationalImpact) ? 8 : 6;
    case 'evidence_strength':
      return hasWeakEvidence ? (delay ? 8 : 4) : 8;
    case 'reversibility':
      return option.reversibility === 'high' ? 8 : option.reversibility === 'medium' ? 6 : 3;
    case 'implementation_complexity':
      return scenarioRisk ? 5 : 7;
    case 'stakeholder_impact':
      return escalation ? 6 : 7;
    case 'uncertainty':
      return option.uncertainty.length === 0 ? 8 : delay ? 7 : 4;
    case 'future_flexibility':
      return option.reversibility === 'high' ? 8 : 6;
    case 'execution_reliability':
      return scenarios.some(scenario =>
        scenario.scenarioType === 'execution_failure_case' ||
        scenario.scenarioType === 'incomplete_implementation'
      ) && option.reversibility === 'low'
        ? 4
        : /control|verify|confirm|owner/i.test(option.action + option.prerequisites.join(' '))
          ? 8
          : 6;
    default:
      return 5;
  }
}

function selectPreferredOption(
  options: PIEDecisionOption[],
  scores: PIEDecisionOptionScore[],
): PIEDecisionOption | null {
  const bestScore = [...scores]
    .filter(score => !score.disqualified)
    .sort((left, right) => right.totalWeightedScore - left.totalWeightedScore)[0];
  return options.find(option => option.optionId === bestScore?.optionId) || null;
}

function sensitivity(
  factor: PIEDecisionSensitivityFactor['factor'],
  currentAssumption: string,
  testedChange: string,
  input: PIEDecisionSimulationInput,
  options: PIEDecisionOption[],
  scores: PIEDecisionOptionScore[],
  selectedOption: PIEDecisionOption | null,
): PIEDecisionSensitivityFactor {
  const alternative = options.find(option => option.optionId !== selectedOption?.optionId);
  const changesRecommendation =
    (factor === 'evidence_confidence' && input.executiveJudgment.confidence !== 'high') ||
    (factor === 'implementation_quality' && selectedOption?.reversibility === 'low') ||
    (factor === 'deadline' && input.executiveJudgment.decisionTiming.timeSensitivity === 'immediate') ||
    (factor === 'regulatory_interpretation' && /permit|compliance|inspection/i.test(stableStringify(input.executiveJudgment))) ||
    (factor === 'schedule_deadlines' && input.executiveJudgment.decisionTiming.timeSensitivity === 'immediate') ||
    (factor === 'photo_progress_interpretation' && hasMaterialPhotoUncertainty(input));
  return {
    factor,
    currentAssumption,
    testedChange,
    preferredOptionAfterChange: changesRecommendation
      ? alternative?.optionId || selectedOption?.optionId || 'none'
      : selectedOption?.optionId || scores[0]?.optionId || 'none',
    changesRecommendation,
    explanation: changesRecommendation
      ? `${factor} can change the preferred option and must be disclosed.`
      : `${factor} does not change the preferred option under reasonable variation.`,
  };
}

function buildDecisionSimulationProvenance(
  input: PIEDecisionSimulationInput,
  simulationRunId: string,
  inputSignature: string,
  options: PIEDecisionOption[],
  selectedOption: PIEDecisionOption | null,
  scores: PIEDecisionOptionScore[],
): PIEDecisionSimulationProvenance {
  return {
    realityModelId: input.executiveJudgment.authority.realityModelId,
    realityModelVersion: input.executiveJudgment.authority.realityModelVersion,
    executiveJudgmentId: input.executiveJudgmentRecord?.id || null,
    simulationRunId,
    optionIdsConsidered: options.map(option => option.optionId),
    selectedOptionId: selectedOption?.optionId || null,
    rejectedAlternativeIds: options.filter(option => option.optionId !== selectedOption?.optionId).map(option => option.optionId),
    scoringBreakdownIds: scores.map(score => score.optionId),
    evidenceCutoff: input.executiveJudgment.authority.evidenceCutoffTime,
    conflictsConsidered: input.realityModel.evidenceConflicts.map(conflict => conflict.id),
    uncertaintiesConsidered: input.realityModel.activeUncertainties.map(uncertainty => uncertainty.id),
    assumptions: assumptionsFromInput(input),
    conditionsThatWouldChangeRecommendation: input.executiveJudgment.highestValueAction?.governance.whatWouldChangeRecommendation ||
      input.executiveJudgment.waitForEvidenceReasoning.evidenceNeeded,
    photoProgressEventIdsUsed: input.longitudinalPhotoIntelligence?.progressEvents.map(event => event.id) || [],
    inputSignature,
  };
}

function scenarioOutcome(
  option: PIEDecisionOption,
  input: PIEDecisionSimulationInput,
  scenarioType: PIEDecisionSimulationScenarioType,
): string {
  if (scenarioType === 'best_reasonable_case') return `${option.action} resolves the primary issue with minimal rework.`;
  if (scenarioType === 'worst_reasonable_case') return `${option.action} fails to reduce the primary risk and requires recovery action.`;
  if (scenarioType === 'evidence_deficient_case') return option.uncertainty.length
    ? `Unresolved uncertainty limits confidence: ${option.uncertainty[0]}`
    : 'Available evidence remains sufficient under this scenario.';
  if (scenarioType === 'delay_case') return option.optionType === 'delay_and_gather_evidence'
    ? 'Delay produces targeted evidence without unnecessary extra workflow.'
    : 'Delay may reduce schedule flexibility before action.';
  if (scenarioType === 'execution_failure_case' || scenarioType === 'incomplete_implementation') {
    return 'If implementation controls are missed, outcome quality cannot be attributed to recommendation quality.';
  }
  if (scenarioType === 'inspection_failure') return 'Inspection failure keeps readiness uncertain and triggers reassessment.';
  if (scenarioType === 'resource_shortage') return 'Resource shortage delays execution and lowers execution confidence.';
  if (scenarioType === 'conflicting_stakeholder_direction') return 'Stakeholder conflict requires authority clarification before action.';
  if (scenarioType === 'recurrence_of_original_issue') return 'Recurring issue pattern increases monitoring and verification value.';
  if (scenarioType === 'visual_progress_not_matching_reported_progress') {
    return 'Visual progress and written status disagree; DAVE lowers confidence and requests targeted confirmation instead of choosing one source silently.';
  }
  return option.expectedOutcome || input.executiveJudgment.executiveJudgmentSummary;
}

function scenarioScheduleImpact(option: PIEDecisionOption, scenarioType: PIEDecisionSimulationScenarioType): string {
  if (scenarioType === 'best_reasonable_case') return option.scheduleImpact === 'improves' ? 'Schedule risk decreases.' : 'Schedule remains stable.';
  if (scenarioType === 'worst_reasonable_case' || scenarioType === 'delay_case') return 'Schedule flexibility decreases.';
  if (scenarioType === 'schedule_compression') return 'Compressed schedule increases execution pressure.';
  return option.scheduleImpact;
}

function scenarioCostImpact(option: PIEDecisionOption, scenarioType: PIEDecisionSimulationScenarioType): string {
  if (scenarioType === 'cost_increase') return 'Cost may increase above current estimate.';
  if (scenarioType === 'execution_failure_case') return 'Rework cost may increase.';
  if (scenarioType === 'visual_progress_not_matching_reported_progress') return 'Cost impact remains uncertain until the field condition is confirmed.';
  return option.estimatedCostDirection;
}

function scenarioRiskImpact(
  option: PIEDecisionOption,
  input: PIEDecisionSimulationInput,
  scenarioType: PIEDecisionSimulationScenarioType,
): string {
  if (scenarioType === 'best_reasonable_case') return 'Risk decreases.';
  if (scenarioType === 'worst_reasonable_case') return 'Risk remains or increases.';
  if (scenarioType === 'evidence_deficient_case') return input.missingEvidence?.summary || 'Evidence deficiency remains.';
  if (scenarioType === 'visual_progress_not_matching_reported_progress') return 'Risk increases until the photo/status conflict is resolved.';
  if (option.optionType === 'no_action' && input.executiveJudgment.executiveRisks.length > 0) return 'Risk remains active under no action.';
  return 'Risk changes according to implementation quality.';
}

function scenarioConfidence(
  option: PIEDecisionOption,
  input: PIEDecisionSimulationInput,
  scenarioType: PIEDecisionSimulationScenarioType,
): ProjectConfidenceLevel {
  if (scenarioType === 'worst_reasonable_case' || scenarioType === 'evidence_deficient_case' || scenarioType === 'visual_progress_not_matching_reported_progress' || option.uncertainty.length > 2) return 'low';
  if (input.executiveJudgment.confidence === 'high' && option.optionType === 'recommended_action') return 'high';
  return 'medium';
}

function summarizeDecisionSimulation(
  selectedOption: PIEDecisionOption | null,
  sensitivity: PIEDecisionSensitivityAnalysis,
  safetyGateFailures: string[],
  complianceGateFailures: string[],
): string {
  if (!selectedOption) return 'No safe decision option could be selected from the current authoritative inputs.';
  const gates = [...safetyGateFailures, ...complianceGateFailures];
  const gateText = gates.length ? ` Gate failures: ${gates.join(' ')}` : '';
  return `${selectedOption.action} is preferred after deterministic option simulation. Robustness: ${sensitivity.robustness}.${gateText}`;
}

function evidenceRequired(input: PIEDecisionSimulationInput): string[] {
  return [
    ...(input.executiveJudgment.highestValueAction?.governance.supportingEvidence || []),
    ...(input.missingEvidence?.minimumEvidenceNeeded.map(request => request.minimumEvidence) || []),
    ...input.realityModel.objects.flatMap(object => object.sourceEvidenceReferences.map(evidence => evidence.summary)).slice(0, 4),
  ].filter(Boolean).slice(0, 8);
}

function risksFromInput(input: PIEDecisionSimulationInput): string[] {
  return [
    ...input.executiveJudgment.executiveRisks.map(risk => risk.risk),
    ...(input.predictiveReality?.risks.map(risk => risk.risk) || []),
  ].filter(Boolean).slice(0, 8);
}

function uncertaintyFromInput(input: PIEDecisionSimulationInput): string[] {
  return [
    ...input.executiveJudgment.waitForEvidenceReasoning.evidenceNeeded,
    ...input.realityModel.activeUncertainties.map(uncertainty => uncertainty.description),
    ...input.realityModel.evidenceConflicts.map(conflict => conflict.conflictType),
    ...(input.longitudinalPhotoIntelligence?.conflicts.map(conflict => conflict.summary) || []),
  ].filter(Boolean).slice(0, 8);
}

function assumptionsFromInput(input: PIEDecisionSimulationInput): string[] {
  return [
    ...(input.executiveJudgment.highestValueAction?.governance.assumptions || []),
    ...input.executiveJudgment.executiveConstraints.map(constraint => constraint.constraint),
    'Reality Model version and evidence cutoff are authoritative for this simulation.',
  ].filter(Boolean).slice(0, 8);
}

function inferSafetyImpact(input: PIEDecisionSimulationInput): string {
  const safetyRisk = input.executiveJudgment.executiveRisks.find(risk => /safety/i.test(risk.risk + risk.whyItMatters));
  return safetyRisk ? `Safety risk considered: ${safetyRisk.risk}` : 'No explicit safety gate violation detected.';
}

function inferComplianceImpact(input: PIEDecisionSimulationInput): string {
  const compliance = input.executiveJudgment.executiveConstraints.find(constraint => /compliance|permit|inspection/i.test(constraint.constraint + constraint.limits));
  return compliance ? `Compliance constraint considered: ${compliance.constraint}` : 'No explicit compliance gate violation detected.';
}

function hasVisualWrittenConflict(input: PIEDecisionSimulationInput): boolean {
  return Boolean(input.longitudinalPhotoIntelligence?.conflicts.length) ||
    input.realityModel.evidenceConflicts.some(conflict =>
      conflict.conflictType === 'status_contradiction' ||
      conflict.conflictType === 'schedule_contradiction' ||
      conflict.supportingEvidenceSideA.concat(conflict.supportingEvidenceSideB).some(id => /photo|visual/i.test(id)),
    );
}

function hasMaterialPhotoUncertainty(input: PIEDecisionSimulationInput): boolean {
  const photoEvents = input.longitudinalPhotoIntelligence?.progressEvents || [];
  const weakPhotoEvent = photoEvents.some(event =>
    event.confidence !== 'high' ||
    event.verificationStatus === 'unverified' ||
    event.verificationStatus === 'needs_review' ||
    event.progressDirection === 'uncertain' ||
    event.progressDirection === 'not_comparable',
  );
  return weakPhotoEvent || hasVisualWrittenConflict(input);
}

function costDirection(action: string): PIEDecisionOption['estimatedCostDirection'] {
  if (/avoid|reduce|reuse|monitor/i.test(action)) return 'decrease';
  if (/expedite|recover|extra|rework|escalate/i.test(action)) return 'increase';
  return 'unknown';
}

function scheduleImpact(action: string, score: number): PIEDecisionOption['scheduleImpact'] {
  if (score >= 7 || /recover|accelerate|due|schedule/i.test(action)) return 'improves';
  if (/wait|delay|defer/i.test(action)) return 'delays';
  return 'neutral';
}

function explainCategoryScore(category: PIEDecisionScoreCategory, option: PIEDecisionOption, score: number): string {
  return `${category} scored ${score}/10 for ${option.optionId} based on option evidence, assumptions, and scenario results.`;
}

function dedupeOptions(options: PIEDecisionOption[]): PIEDecisionOption[] {
  const seen = new Set<string>();
  return options.filter(option => {
    const key = option.action.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, key) => {
      const next = (value as Record<string, unknown>)[key];
      if (typeof next !== 'function') acc[key] = sortValue(next);
      return acc;
    }, {});
  }
  return value;
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return `${Math.abs(hash)}`;
}
