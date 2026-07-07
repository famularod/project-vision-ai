import type { PIEDecisionSimulationResult } from './PIEDecisionSimulation';
import type { PIEExecutiveJudgmentResult } from './PIEExecutiveJudgment';
import type { PIEJarvisReasoningValidation } from './PIEJarvisReasoningValidation';
import type { PIERecommendationChallengeResult } from './PIERecommendationChallenge';
import type { PIEEvidenceQualityResult } from './PIEEvidenceQuality';
import type { PIEPredictiveRealityResult } from './PIEPredictiveReality';
import type { PIERealityModel } from './PIERealityModel';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEConfidenceComponentName =
  | 'evidence'
  | 'reality_model'
  | 'identity'
  | 'causal'
  | 'forecast'
  | 'option_generation'
  | 'option_comparison'
  | 'simulation'
  | 'execution'
  | 'photo_evidence'
  | 'outcome_measurement'
  | 'overall_recommendation';

export type PIEConfidenceComponent = {
  name: PIEConfidenceComponentName;
  level: ProjectConfidenceLevel;
  score: number;
  explanation: string;
  loweringFactors: string[];
};

export type PIEConfidenceDecomposition = {
  generatedAt: string;
  components: PIEConfidenceComponent[];
  weakestComponents: PIEConfidenceComponent[];
  overallLevel: ProjectConfidenceLevel;
  overallScore: number;
  primaryConfidenceLimiter: string;
  explanation: string;
};

export type PIEConfidenceDecompositionInput = {
  realityModel: PIERealityModel;
  executiveJudgment: PIEExecutiveJudgmentResult;
  evidenceQuality?: PIEEvidenceQualityResult | null;
  predictiveReality?: PIEPredictiveRealityResult | null;
  simulation?: PIEDecisionSimulationResult | null;
  challenge?: PIERecommendationChallengeResult | null;
  jarvisValidation?: PIEJarvisReasoningValidation | null;
  generatedAt?: string;
};

export function decomposePIERecommendationConfidence(
  input: PIEConfidenceDecompositionInput,
): PIEConfidenceDecomposition {
  const generatedAt = input.generatedAt || input.executiveJudgment.generatedAt || new Date().toISOString();
  const components: PIEConfidenceComponent[] = [
    evidenceConfidence(input),
    realityModelConfidence(input),
    identityConfidence(input),
    causalConfidence(input),
    forecastConfidence(input),
    optionGenerationConfidence(input),
    optionComparisonConfidence(input),
    simulationConfidence(input),
    executionConfidence(input),
    photoEvidenceConfidence(input),
    outcomeMeasurementConfidence(input),
  ];
  const average = Math.round(components.reduce((total, component) => total + component.score, 0) / Math.max(1, components.length));
  const overallLevel = levelFromScore(Math.min(average, scoreForLevel(input.executiveJudgment.confidence)));
  const overall: PIEConfidenceComponent = {
    name: 'overall_recommendation',
    level: overallLevel,
    score: Math.min(average, scoreForLevel(input.executiveJudgment.confidence)),
    explanation: `Overall recommendation confidence is bounded by Executive Judgment, evidence quality, simulation robustness, and JARVIS validation.`,
    loweringFactors: components.flatMap(component => component.loweringFactors).slice(0, 6),
  };
  const allComponents = [...components, overall];
  const weakestComponents = [...allComponents].sort((left, right) => left.score - right.score).slice(0, 3);
  const primaryConfidenceLimiter = weakestComponents[0]?.loweringFactors[0] || weakestComponents[0]?.explanation || 'No single confidence limiter detected.';

  return {
    generatedAt,
    components: allComponents,
    weakestComponents,
    overallLevel,
    overallScore: overall.score,
    primaryConfidenceLimiter,
    explanation: `Confidence is ${overallLevel}. Limiting factor: ${primaryConfidenceLimiter}`,
  };
}

function evidenceConfidence(input: PIEConfidenceDecompositionInput): PIEConfidenceComponent {
  const readiness = input.evidenceQuality?.evidenceReadiness || 'weak';
  const level: ProjectConfidenceLevel = readiness === 'strong' || readiness === 'good' ? 'high' : readiness === 'weak' ? 'medium' : 'low';
  return component('evidence', level, `Evidence readiness is ${readiness}.`, input.evidenceQuality?.weakEvidence.map(item => item.evidence.summary).slice(0, 3) || []);
}

function realityModelConfidence(input: PIEConfidenceDecompositionInput): PIEConfidenceComponent {
  return component('reality_model', input.realityModel.summary.confidence, input.realityModel.summary.summary, [
    ...input.realityModel.evidenceConflicts.map(conflict => `Conflict: ${conflict.conflictType}`),
    ...input.realityModel.activeUncertainties.map(uncertainty => uncertainty.description),
  ].slice(0, 4));
}

function identityConfidence(input: PIEConfidenceDecompositionInput): PIEConfidenceComponent {
  const ambiguous = input.realityModel.evidenceConflicts.some(conflict => conflict.conflictType === 'identity_mismatch' || conflict.conflictType === 'duplicate_object_conflict');
  return component('identity', ambiguous ? 'low' : 'high', ambiguous ? 'Identity conflicts remain active.' : 'No active identity conflict detected.', ambiguous ? ['Resolve identity conflict before treating object as certain.'] : []);
}

function causalConfidence(input: PIEConfidenceDecompositionInput): PIEConfidenceComponent {
  const hasMechanism = input.executiveJudgment.executiveRisks.some(risk => /because|caus|block|affect|due/i.test(risk.whyItMatters));
  const hasContradiction = input.realityModel.evidenceConflicts.length > 0;
  const level: ProjectConfidenceLevel = hasMechanism && !hasContradiction ? 'medium' : hasMechanism ? 'low' : 'low';
  return component('causal', level, hasMechanism ? 'Causal language has a plausible mechanism but remains bounded.' : 'Cause is not established; use associated-with language.', hasContradiction ? ['Contradictory evidence prevents strong causal claims.'] : []);
}

function forecastConfidence(input: PIEConfidenceDecompositionInput): PIEConfidenceComponent {
  return component('forecast', input.predictiveReality?.confidence || 'medium', input.predictiveReality?.predictiveRealitySummary || 'Forecast confidence follows Predictive Reality.', input.predictiveReality?.risks.map(risk => risk.verificationNeeded).slice(0, 3) || []);
}

function optionComparisonConfidence(input: PIEConfidenceDecompositionInput): PIEConfidenceComponent {
  const robustness = input.simulation?.sensitivityAnalysis.robustness;
  const level: ProjectConfidenceLevel = robustness === 'robust' ? 'high' : robustness === 'moderately_sensitive' ? 'medium' : 'low';
  return component('option_comparison', level, `Option comparison robustness is ${robustness || 'not available'}.`, input.simulation?.sensitivityAnalysis.assumptionsThatMatterMost || []);
}

function optionGenerationConfidence(input: PIEConfidenceDecompositionInput): PIEConfidenceComponent {
  const options = input.simulation?.options || [];
  const hasNoAction = options.some(option => option.optionType === 'no_action');
  const hasMaterialOption = options.some(option => option.optionType === 'recommended_action');
  const hasCredibleAlternative = options.some(option => option.optionType === 'credible_alternative');
  const level: ProjectConfidenceLevel = hasMaterialOption && hasNoAction && hasCredibleAlternative
    ? 'high'
    : hasMaterialOption && hasNoAction
      ? 'medium'
      : 'low';
  return component('option_generation', level, `Generated ${options.length} decision option${options.length === 1 ? '' : 's'} with no-action ${hasNoAction ? 'included' : 'missing'}.`, [
    !hasNoAction ? 'No-action option is missing.' : null,
    !hasCredibleAlternative ? 'Credible alternative is missing or not meaningful.' : null,
  ].filter((item): item is string => Boolean(item)));
}

function simulationConfidence(input: PIEConfidenceDecompositionInput): PIEConfidenceComponent {
  const scenarios = input.simulation?.scenarios || [];
  const reproducible = Boolean(input.simulation?.inputSignature) && scenarios.every(scenario => scenario.reproducibilityKey);
  const hasRequiredScenarios = [
    'expected_case',
    'best_reasonable_case',
    'worst_reasonable_case',
    'evidence_deficient_case',
    'delay_case',
    'execution_failure_case',
  ].every(type => scenarios.some(scenario => scenario.scenarioType === type));
  const level: ProjectConfidenceLevel = reproducible && hasRequiredScenarios
    ? 'high'
    : reproducible
      ? 'medium'
      : 'low';
  return component('simulation', level, reproducible ? 'Simulation has deterministic input and scenario signatures.' : 'Simulation reproducibility is incomplete.', [
    !hasRequiredScenarios ? 'Required scenario coverage is incomplete.' : null,
    !reproducible ? 'Input signature or scenario reproducibility keys are missing.' : null,
  ].filter((item): item is string => Boolean(item)));
}

function executionConfidence(input: PIEConfidenceDecompositionInput): PIEConfidenceComponent {
  const implementationRisk = input.challenge?.implementationFailureRisks.some(risk => risk.severity === 'high' || risk.severity === 'critical');
  return component('execution', implementationRisk ? 'low' : 'medium', implementationRisk ? 'Implementation failure risk is material.' : 'Execution confidence is bounded by implementation quality.', implementationRisk ? ['Track implementation fidelity before judging outcome.'] : []);
}

function photoEvidenceConfidence(input: PIEConfidenceDecompositionInput): PIEConfidenceComponent {
  const photoEvents = input.simulation?.provenance.photoProgressEventIdsUsed || [];
  const visualChallenge = input.challenge?.visualEvidenceOverinterpretationChallenge;
  const level: ProjectConfidenceLevel = photoEvents.length === 0
    ? 'medium'
    : visualChallenge?.severity === 'high' || visualChallenge?.severity === 'critical'
      ? 'low'
      : 'medium';
  return component('photo_evidence', level, photoEvents.length
    ? 'Photo progress evidence was used as qualified observation or inference.'
    : 'No material photo-progress evidence affected this recommendation.', [
    visualChallenge?.severity === 'high' || visualChallenge?.severity === 'critical'
      ? visualChallenge.actionRequired
      : null,
  ].filter((item): item is string => Boolean(item)));
}

function outcomeMeasurementConfidence(input: PIEConfidenceDecompositionInput): PIEConfidenceComponent {
  const hasSuccess = Boolean(input.executiveJudgment.highestValueAction?.successMeasure);
  return component('outcome_measurement', hasSuccess ? 'medium' : 'low', hasSuccess ? 'Success measure exists but needs outcome evidence later.' : 'Outcome measurement is not yet defined strongly.', hasSuccess ? [] : ['Define accepted outcome evidence before learning from this decision.']);
}

function component(
  name: PIEConfidenceComponentName,
  level: ProjectConfidenceLevel,
  explanation: string,
  loweringFactors: string[],
): PIEConfidenceComponent {
  return {
    name,
    level,
    score: scoreForLevel(level),
    explanation,
    loweringFactors,
  };
}

function scoreForLevel(level: ProjectConfidenceLevel): number {
  if (level === 'high') return 85;
  if (level === 'medium') return 62;
  return 35;
}

function levelFromScore(score: number): ProjectConfidenceLevel {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}
