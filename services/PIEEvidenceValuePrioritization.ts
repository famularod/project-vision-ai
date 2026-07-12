import type { PIEDecisionSimulationResult } from './PIEDecisionSimulation';
import type { PIEExecutiveJudgmentResult } from './PIEExecutiveJudgment';
import type { PIEMissingEvidenceItem, PIEMissingEvidenceResult } from './PIEMissingEvidence';
import type { PIERealityModel } from './PIERealityModel';

export type PIEEvidenceDecisionValue = {
  id: string;
  missingEvidenceId: string;
  request: string;
  uncertaintyResolved: string;
  optionsItMayChange: string[];
  urgency: 'critical' | 'high' | 'medium' | 'low';
  effortToObtain: 'low' | 'medium' | 'high';
  likelySource: string;
  expectedConfidenceImprovement: number;
  safetyImpact: 'none' | 'low' | 'medium' | 'high' | 'critical';
  canProceedWithoutIt: boolean;
  reason: string;
};

export type PIEEvidenceValuePrioritization = {
  generatedAt: string;
  values: PIEEvidenceDecisionValue[];
  highestValueEvidence: PIEEvidenceDecisionValue | null;
  oneRequestForUser: string | null;
  summary: string;
};

export type PIEEvidenceValuePrioritizationInput = {
  realityModel: PIERealityModel;
  executiveJudgment: PIEExecutiveJudgmentResult;
  missingEvidence: PIEMissingEvidenceResult;
  simulation?: PIEDecisionSimulationResult | null;
  generatedAt?: string;
};

export function prioritizeEvidenceByDecisionValue(
  input: PIEEvidenceValuePrioritizationInput,
): PIEEvidenceValuePrioritization {
  const generatedAt = input.generatedAt || input.executiveJudgment.generatedAt || new Date().toISOString();
  const values = input.missingEvidence.prioritizedItems
    .map(item => buildEvidenceDecisionValue(item, input))
    .sort((left, right) =>
      right.expectedConfidenceImprovement - left.expectedConfidenceImprovement ||
      urgencyScore(right.urgency) - urgencyScore(left.urgency) ||
      effortScore(left.effortToObtain) - effortScore(right.effortToObtain),
    );
  const highestValueEvidence = values[0] || null;

  return {
    generatedAt,
    values,
    highestValueEvidence,
    oneRequestForUser: highestValueEvidence?.request || null,
    summary: highestValueEvidence
      ? `Highest-value evidence: ${highestValueEvidence.request}`
      : 'No additional evidence request is needed for the current recommendation.',
  };
}

function buildEvidenceDecisionValue(
  item: PIEMissingEvidenceItem,
  input: PIEEvidenceValuePrioritizationInput,
): PIEEvidenceDecisionValue {
  const matchingOptions = input.simulation?.options.filter(option =>
    option.uncertainty.some(uncertainty => uncertainty.toLowerCase().includes(item.type.replace(/_/g, ' '))) ||
    option.evidenceRequired.some(evidence => evidence.toLowerCase().includes(item.smallestEvidenceRequest.toLowerCase().slice(0, 12))),
  ) || [];
  const criticalDecision = input.executiveJudgment.decisionTiming.timeSensitivity === 'immediate' ||
    input.executiveJudgment.executiveRisks.some(risk => risk.severity === 'critical');
  const canProceedWithoutIt = item.priority === 'low' ||
    (!criticalDecision && input.executiveJudgment.confidence === 'high' && input.realityModel.evidenceConflicts.length === 0);

  return {
    id: `evidence-value-${item.id}`,
    missingEvidenceId: item.id,
    request: item.smallestEvidenceRequest,
    uncertaintyResolved: item.whyItMatters,
    optionsItMayChange: matchingOptions.length
      ? matchingOptions.map(option => option.optionId)
      : input.simulation?.sensitivityAnalysis.factors
        .filter(factor => factor.changesRecommendation)
        .map(factor => factor.factor) || [],
    urgency: item.priority,
    effortToObtain: effortFromEvidenceType(item.type),
    likelySource: item.reasons[0]?.source || 'User Confirmation',
    expectedConfidenceImprovement: Math.min(100, item.uncertaintyReduction + (canProceedWithoutIt ? 0 : 15)),
    safetyImpact: safetyImpactForEvidence(item, input),
    canProceedWithoutIt,
    reason: canProceedWithoutIt
      ? 'DAVE can proceed with bounded confidence, but this evidence would improve certainty.'
      : 'This evidence can change option ranking, confidence, or authority requirements.',
  };
}

function safetyImpactForEvidence(
  item: PIEMissingEvidenceItem,
  input: PIEEvidenceValuePrioritizationInput,
): PIEEvidenceDecisionValue['safetyImpact'] {
  const text = [
    item.title,
    item.summary,
    item.whyItMatters,
    item.smallestEvidenceRequest,
    ...input.executiveJudgment.executiveRisks.map(risk => `${risk.risk} ${risk.whyItMatters}`),
    ...input.realityModel.objects.map(object => `${object.name} ${object.description} ${object.currentState.summary}`),
  ].join(' ').toLowerCase();
  if (/critical safety|stop work|life safety/.test(text)) return 'critical';
  if (/safety|hazard|guardrail|fall protection|blocked egress/.test(text)) return 'high';
  if (/inspection|compliance/.test(text)) return 'medium';
  return 'none';
}

function effortFromEvidenceType(type: PIEMissingEvidenceItem['type']): PIEEvidenceDecisionValue['effortToObtain'] {
  if (type === 'missing_current_photo' || type === 'missing_photo' || type === 'missing_progress_note') return 'low';
  if (type === 'missing_owner' || type === 'missing_user_confirmation' || type === 'missing_location') return 'medium';
  return 'high';
}

function urgencyScore(value: PIEEvidenceDecisionValue['urgency']) {
  if (value === 'critical') return 4;
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
}

function effortScore(value: PIEEvidenceDecisionValue['effortToObtain']) {
  if (value === 'low') return 1;
  if (value === 'medium') return 2;
  return 3;
}
