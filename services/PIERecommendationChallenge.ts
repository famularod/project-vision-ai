import type { PIEDecisionSimulationResult } from './PIEDecisionSimulation';
import type { PIEExecutiveJudgmentResult } from './PIEExecutiveJudgment';
import type { PIERealityModel } from './PIERealityModel';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIERecommendationChallengeStatus =
  | 'unchanged'
  | 'changed'
  | 'needs_more_evidence'
  | 'human_review_required'
  | 'blocked';

export type PIERecommendationChallengeItem = {
  id: string;
  challenge: string;
  evidenceReference: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: ProjectConfidenceLevel;
  actionRequired: string;
};

export type PIERecommendationChallengeResult = {
  generatedAt: string;
  challengeRunId: string;
  preferredOptionBeforeChallenge: string | null;
  preferredOptionAfterChallenge: string | null;
  preferredOptionChanged: boolean;
  strongestArgumentAgainst: PIERecommendationChallengeItem;
  disconfirmingEvidenceNeeded: PIERecommendationChallengeItem;
  overlookedStakeholdersOrDependencies: PIERecommendationChallengeItem[];
  implementationFailureRisks: PIERecommendationChallengeItem[];
  noActionOrDelayCouldBeBetter: PIERecommendationChallengeItem;
  authorityBoundaryChallenge: PIERecommendationChallengeItem;
  confidenceOverstatementChallenge: PIERecommendationChallengeItem;
  visualEvidenceOverinterpretationChallenge: PIERecommendationChallengeItem;
  assumptionChangeChallenge: PIERecommendationChallengeItem;
  recalculatedRecommendation: string;
  status: PIERecommendationChallengeStatus;
  summary: string;
};

export type PIERecommendationChallengeInput = {
  realityModel: PIERealityModel;
  executiveJudgment: PIEExecutiveJudgmentResult;
  simulation: PIEDecisionSimulationResult;
  generatedAt?: string;
};

export function challengePIERecommendation(
  input: PIERecommendationChallengeInput,
): PIERecommendationChallengeResult {
  const generatedAt = input.generatedAt || input.executiveJudgment.generatedAt || new Date().toISOString();
  const preferredOptionBeforeChallenge = input.simulation.selectedOption?.optionId || null;
  const strongestArgumentAgainst = identifyStrongestArgumentAgainst(input);
  const disconfirmingEvidenceNeeded = identifyDisconfirmingEvidence(input);
  const overlookedStakeholdersOrDependencies = identifyOverlookedStakeholdersOrDependencies(input);
  const implementationFailureRisks = identifyImplementationFailureRisks(input);
  const noActionOrDelayCouldBeBetter = evaluateNoActionOrDelay(input);
  const authorityBoundaryChallenge = evaluateAuthorityBoundary(input);
  const confidenceOverstatementChallenge = evaluateConfidenceOverstatement(input);
  const visualEvidenceOverinterpretationChallenge = evaluateVisualEvidenceOverinterpretation(input);
  const assumptionChangeChallenge = evaluateDifferentReasonableAssumption(input);
  const status = determineChallengeStatus({
    strongestArgumentAgainst,
    disconfirmingEvidenceNeeded,
    overlookedStakeholdersOrDependencies,
    implementationFailureRisks,
    noActionOrDelayCouldBeBetter,
    authorityBoundaryChallenge,
    confidenceOverstatementChallenge,
    visualEvidenceOverinterpretationChallenge,
    assumptionChangeChallenge,
  });
  const preferredOptionAfterChallenge = status === 'blocked' || status === 'needs_more_evidence'
    ? optionByType(input, 'delay_and_gather_evidence') || preferredOptionBeforeChallenge
    : status === 'human_review_required'
      ? optionByType(input, 'escalation') || preferredOptionBeforeChallenge
      : preferredOptionBeforeChallenge;
  const preferredOptionChanged = preferredOptionAfterChallenge !== preferredOptionBeforeChallenge;
  const recalculatedRecommendation = recommendationForOption(input, preferredOptionAfterChallenge);

  return {
    generatedAt,
    challengeRunId: `challenge-${input.simulation.simulationRunId}`,
    preferredOptionBeforeChallenge,
    preferredOptionAfterChallenge,
    preferredOptionChanged,
    strongestArgumentAgainst,
    disconfirmingEvidenceNeeded,
    overlookedStakeholdersOrDependencies,
    implementationFailureRisks,
    noActionOrDelayCouldBeBetter,
    authorityBoundaryChallenge,
    confidenceOverstatementChallenge,
    visualEvidenceOverinterpretationChallenge,
    assumptionChangeChallenge,
    recalculatedRecommendation,
    status,
    summary: summarizeChallenge(status, strongestArgumentAgainst, preferredOptionChanged),
  };
}

function identifyStrongestArgumentAgainst(input: PIERecommendationChallengeInput): PIERecommendationChallengeItem {
  const conflict = input.realityModel.evidenceConflicts.find(item => item.status === 'open');
  const uncertainty = input.realityModel.activeUncertainties[0];
  const sensitivity = input.simulation.sensitivityAnalysis.factors.find(factor => factor.changesRecommendation);
  const challenge = conflict
    ? `Open conflict ${conflict.conflictType} could make the preferred option wrong.`
    : sensitivity
      ? `${sensitivity.factor} could change the recommendation.`
      : uncertainty
        ? `${uncertainty.description} remains unresolved.`
        : 'The preferred option may fail if implementation quality is low.';
  return item({
    id: 'challenge-strongest-argument',
    challenge,
    evidenceReference: [
      conflict?.id,
      uncertainty?.id,
      input.simulation.provenance.simulationRunId,
    ].filter((value): value is string => Boolean(value)),
    severity: conflict?.severity || (sensitivity ? 'high' : uncertainty?.severity || 'medium'),
    confidence: conflict?.confidence || uncertainty?.confidenceImpact || input.executiveJudgment.confidence,
    actionRequired: conflict
      ? 'Resolve the conflict or disclose it before acting.'
      : sensitivity
        ? 'Disclose the sensitive assumption and what would change the recommendation.'
        : 'Verify implementation controls before execution.',
  });
}

function identifyDisconfirmingEvidence(input: PIERecommendationChallengeInput): PIERecommendationChallengeItem {
  const evidence = input.simulation.sensitivityAnalysis.missingEvidenceThatImprovesDecision[0] ||
    input.executiveJudgment.waitForEvidenceReasoning.smallestEvidenceRequest ||
    'One current field confirmation tied to the affected Reality Object.';
  return item({
    id: 'challenge-disconfirming-evidence',
    challenge: `Evidence that could disprove the preferred option: ${evidence}`,
    evidenceReference: input.simulation.provenance.uncertaintiesConsidered,
    severity: input.executiveJudgment.confidence === 'low' ? 'high' : 'medium',
    confidence: input.executiveJudgment.confidence,
    actionRequired: evidence,
  });
}

function identifyOverlookedStakeholdersOrDependencies(input: PIERecommendationChallengeInput): PIERecommendationChallengeItem[] {
  const dependencyItems = input.realityModel.objects
    .flatMap(object => object.dependencies.map(dependency => ({
      object,
      dependency,
    })))
    .filter(item => item.dependency.blocked || item.object.owner);
  if (dependencyItems.length === 0) {
    return [item({
      id: 'challenge-stakeholder-default',
      challenge: 'No hidden dependency was found, but owner availability must still be confirmed.',
      evidenceReference: input.simulation.provenance.optionIdsConsidered,
      severity: 'low',
      confidence: 'medium',
      actionRequired: 'Confirm owner availability if action becomes high impact.',
    })];
  }
  return dependencyItems.slice(0, 3).map(({ object, dependency }, index) => item({
    id: `challenge-dependency-${index + 1}`,
    challenge: `${object.name} dependency may affect the recommendation: ${dependency.summary}`,
    evidenceReference: [dependency.id, object.identity.id],
    severity: dependency.blocked ? 'high' : 'medium',
    confidence: dependency.confidence,
    actionRequired: dependency.blocked ? 'Resolve dependency before treating recommendation as ready.' : 'Confirm dependency status.',
  }));
}

function identifyImplementationFailureRisks(input: PIERecommendationChallengeInput): PIERecommendationChallengeItem[] {
  const executionScenarios = input.simulation.scenarios.filter(scenario =>
    scenario.scenarioType === 'execution_failure_case' ||
    scenario.scenarioType === 'incomplete_implementation',
  );
  return executionScenarios.slice(0, 3).map((scenario, index) => item({
    id: `challenge-implementation-${index + 1}`,
    challenge: scenario.outcome,
    evidenceReference: [scenario.scenarioId],
    severity: scenario.confidence === 'low' ? 'high' : 'medium',
    confidence: scenario.confidence,
    actionRequired: 'Record implementation controls so outcome quality is not confused with recommendation quality.',
  }));
}

function evaluateNoActionOrDelay(input: PIERecommendationChallengeInput): PIERecommendationChallengeItem {
  const delay = input.simulation.options.find(option => option.optionType === 'delay_and_gather_evidence');
  const noAction = input.simulation.options.find(option => option.optionType === 'no_action');
  const noActionBetter = input.executiveJudgment.noActionReasoning.isValid && input.executiveJudgment.decisionTiming.recommendation === 'monitor';
  const delayBetter = input.executiveJudgment.waitForEvidenceReasoning.shouldWaitForEvidence;
  return item({
    id: 'challenge-no-action-delay',
    challenge: noActionBetter
      ? `No action could be better: ${noAction?.rationale || input.executiveJudgment.noActionReasoning.reason}`
      : delayBetter
        ? `Delay could be better: ${delay?.rationale || input.executiveJudgment.waitForEvidenceReasoning.reason}`
        : 'No-action and delay were considered but did not beat the preferred option.',
    evidenceReference: [noAction?.optionId, delay?.optionId].filter((value): value is string => Boolean(value)),
    severity: noActionBetter || delayBetter ? 'high' : 'low',
    confidence: input.executiveJudgment.confidence,
    actionRequired: noActionBetter || delayBetter
      ? 'Prefer monitoring or targeted evidence before high-impact action.'
      : 'Disclose that no-action and delay were considered.',
  });
}

function evaluateAuthorityBoundary(input: PIERecommendationChallengeInput): PIERecommendationChallengeItem {
  const escalation = input.executiveJudgment.escalationAnalysis;
  const exceedsAuthority = escalation.shouldEscalate && escalation.timing === 'now';
  return item({
    id: 'challenge-authority-boundary',
    challenge: exceedsAuthority
      ? `Recommendation requires ${escalation.target.role}: ${escalation.target.ask}`
      : 'Recommendation appears inside current authority boundaries.',
    evidenceReference: input.simulation.provenance.conflictsConsidered,
    severity: exceedsAuthority ? 'critical' : 'low',
    confidence: escalation.evidenceStrongEnough ? 'high' : 'medium',
    actionRequired: exceedsAuthority ? 'Require human authority before action.' : 'No authority escalation required.',
  });
}

function evaluateConfidenceOverstatement(input: PIERecommendationChallengeInput): PIERecommendationChallengeItem {
  const weakEvidence = input.executiveJudgment.confidence === 'high' &&
    (input.realityModel.summary.confidence !== 'high' ||
      input.simulation.sensitivityAnalysis.robustness === 'highly_sensitive' ||
      input.simulation.sensitivityAnalysis.robustness === 'unstable');
  return item({
    id: 'challenge-confidence-overstatement',
    challenge: weakEvidence
      ? 'Confidence may be overstated because Reality or sensitivity analysis is weaker than the recommendation.'
      : 'Confidence level appears consistent with current Reality and simulation sensitivity.',
    evidenceReference: [input.simulation.simulationRunId],
    severity: weakEvidence ? 'high' : 'low',
    confidence: input.executiveJudgment.confidence,
    actionRequired: weakEvidence ? 'Lower confidence wording or collect more evidence.' : 'Keep confidence wording bounded.',
  });
}

function evaluateVisualEvidenceOverinterpretation(input: PIERecommendationChallengeInput): PIERecommendationChallengeItem {
  const photoConflict = input.simulation.scenarios.find(scenario => scenario.scenarioType === 'visual_progress_not_matching_reported_progress');
  const photoEvidenceIds = input.simulation.provenance.photoProgressEventIdsUsed;
  const photoEvidenceWeak = photoConflict || input.realityModel.evidenceConflicts.some(conflict =>
    conflict.supportingEvidenceSideA.concat(conflict.supportingEvidenceSideB).some(id => /photo|visual/i.test(id)),
  );
  return item({
    id: 'challenge-visual-overinterpretation',
    challenge: photoEvidenceWeak
      ? 'Visual evidence may be overinterpreted or may conflict with written status.'
      : 'No material visual-evidence overinterpretation risk was detected.',
    evidenceReference: [
      photoConflict?.scenarioId,
      ...photoEvidenceIds,
    ].filter((value): value is string => Boolean(value)),
    severity: photoEvidenceWeak ? 'high' : 'low',
    confidence: photoEvidenceWeak ? 'medium' : input.executiveJudgment.confidence,
    actionRequired: photoEvidenceWeak
      ? 'Treat photos as observation or inference and request targeted confirmation before claiming completion.'
      : 'Keep photo wording qualified unless corroborating evidence verifies completion.',
  });
}

function evaluateDifferentReasonableAssumption(input: PIERecommendationChallengeInput): PIERecommendationChallengeItem {
  const switchingFactor = input.simulation.sensitivityAnalysis.factors.find(factor => factor.changesRecommendation);
  return item({
    id: 'challenge-different-reasonable-assumption',
    challenge: switchingFactor
      ? `A different reasonable assumption could change the recommendation: ${switchingFactor.testedChange}`
      : 'Reasonable assumption changes did not alter the preferred option in sensitivity analysis.',
    evidenceReference: switchingFactor ? [switchingFactor.factor] : input.simulation.provenance.optionIdsConsidered,
    severity: switchingFactor ? 'high' : 'low',
    confidence: input.executiveJudgment.confidence,
    actionRequired: switchingFactor
      ? 'Disclose the threshold that could change the recommendation or request the evidence that resolves it.'
      : 'Record the tested assumptions in provenance.',
  });
}

function determineChallengeStatus(input: {
  strongestArgumentAgainst: PIERecommendationChallengeItem;
  disconfirmingEvidenceNeeded: PIERecommendationChallengeItem;
  overlookedStakeholdersOrDependencies: PIERecommendationChallengeItem[];
  implementationFailureRisks: PIERecommendationChallengeItem[];
  noActionOrDelayCouldBeBetter: PIERecommendationChallengeItem;
  authorityBoundaryChallenge: PIERecommendationChallengeItem;
  confidenceOverstatementChallenge: PIERecommendationChallengeItem;
  visualEvidenceOverinterpretationChallenge: PIERecommendationChallengeItem;
  assumptionChangeChallenge: PIERecommendationChallengeItem;
}): PIERecommendationChallengeStatus {
  const all = [
    input.strongestArgumentAgainst,
    input.disconfirmingEvidenceNeeded,
    ...input.overlookedStakeholdersOrDependencies,
    ...input.implementationFailureRisks,
    input.noActionOrDelayCouldBeBetter,
    input.authorityBoundaryChallenge,
    input.confidenceOverstatementChallenge,
    input.visualEvidenceOverinterpretationChallenge,
    input.assumptionChangeChallenge,
  ];
  if (input.authorityBoundaryChallenge.severity === 'critical') return 'human_review_required';
  if (all.some(item => item.severity === 'critical')) return 'blocked';
  if (
    input.noActionOrDelayCouldBeBetter.severity === 'high' ||
    input.confidenceOverstatementChallenge.severity === 'high' ||
    input.visualEvidenceOverinterpretationChallenge.severity === 'high'
  ) {
    return 'needs_more_evidence';
  }
  if (all.some(item => item.severity === 'high')) return 'unchanged';
  return 'unchanged';
}

function recommendationForOption(input: PIERecommendationChallengeInput, optionId: string | null): string {
  const option = input.simulation.options.find(item => item.optionId === optionId);
  return option?.action || input.executiveJudgment.highestValueAction?.action || input.executiveJudgment.executiveJudgment.bestActionIfEvidenceIncomplete;
}

function optionByType(input: PIERecommendationChallengeInput, type: string): string | null {
  return input.simulation.options.find(option => option.optionType === type)?.optionId || null;
}

function summarizeChallenge(
  status: PIERecommendationChallengeStatus,
  strongestArgument: PIERecommendationChallengeItem,
  changed: boolean,
): string {
  return `Recommendation challenge ${status}. Strongest challenge: ${strongestArgument.challenge} Preferred option ${changed ? 'changed' : 'did not change'}.`;
}

function item(input: PIERecommendationChallengeItem): PIERecommendationChallengeItem {
  return input;
}
