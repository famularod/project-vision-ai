import type { PIEAdaptiveResult } from './PIEAdaptiveIntelligence';
import type { PIEExecutiveJudgmentResult } from './PIEExecutiveJudgment';
import type { PIELearningResult } from './PIELearningEngine';
import type { PIEMemoryRecallResult } from './PIEMemoryRecall';
import type { PIEPredictionResult } from './PIEPredictiveEngine';
import type { PIEReflectionResult } from './PIEReflectionEngine';
import type { PIEReportDraft } from './PIEReporter';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEDecisionRecord = {
  id: string;
  decision: string;
  why: string;
  evidenceUsed: string[];
  assumptions: string[];
  alternativesConsidered: string[];
  uncertainty: string[];
  recommendedAction: string;
  createdAt: string;
  confidence: ProjectConfidenceLevel;
};

export type PIERecommendationRecord = {
  id: string;
  recommendation: string;
  whyRecommended: string;
  evidenceUsed: string[];
  assumptions: string[];
  alternativesConsidered: string[];
  uncertainty: string[];
  userAction: 'accepted' | 'rejected' | 'modified' | 'approved' | 'ignored' | 'unknown';
  createdAt: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEDecisionOutcomeRecord = {
  id: string;
  decisionId: string;
  actualOutcome: string;
  recommendationWasCorrect: boolean | null;
  impact: 'improved' | 'worsened' | 'unchanged' | 'unknown';
  lessonLearned: string;
  futureAdjustment: string;
  recordedAt: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveWisdomLesson = {
  id: string;
  lesson: string;
  sourceDecisionId: string | null;
  whenToApply: string;
  futureAdjustment: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEWisdomPattern = {
  id: string;
  pattern: string;
  repeatedCount: number;
  evidence: string[];
  recommendation: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEWhenNotToActReason = {
  id: string;
  reason:
    | 'evidence_too_weak'
    | 'issue_already_resolving'
    | 'escalation_creates_noise'
    | 'waiting_reduces_risk'
    | 'action_irreversible'
    | 'decision_impact_low'
    | 'user_correction_history_suggests_caution'
    | 'prediction_confidence_low'
    | 'truth_over_speed';
  explanation: string;
  recommendedAlternative: string;
  confidence: ProjectConfidenceLevel;
};

export type PIETrustCalibrationRecord = {
  id: string;
  source: string;
  trustAdjustment: 'trust_more' | 'trust_less' | 'hold';
  reason: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEWisdomRecommendation = {
  id: string;
  recommendation: string;
  reason: string;
  shouldAct: boolean;
  preferredAction: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEDecisionMemory = {
  generatedAt: string;
  decisions: PIEDecisionRecord[];
  recommendations: PIERecommendationRecord[];
  outcomes: PIEDecisionOutcomeRecord[];
  wisdomLessons: PIEExecutiveWisdomLesson[];
  wisdomPatterns: PIEWisdomPattern[];
  whenNotToActReasons: PIEWhenNotToActReason[];
  trustCalibrationHistory: PIETrustCalibrationRecord[];
  wisdomRecommendations: PIEWisdomRecommendation[];
  summary: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEDecisionMemoryResult = {
  generatedAt: string;
  decisionMemory: PIEDecisionMemory;
  decisionHistory: PIEDecisionRecord[];
  recommendationHistory: PIERecommendationRecord[];
  outcomeHistory: PIEDecisionOutcomeRecord[];
  wisdomLessons: PIEExecutiveWisdomLesson[];
  wisdomPatterns: PIEWisdomPattern[];
  whenNotToActReasons: PIEWhenNotToActReason[];
  wisdomRecommendations: PIEWisdomRecommendation[];
  trustCalibrationHistory: PIETrustCalibrationRecord[];
  summary: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEDecisionMemoryInput = {
  generatedAt?: string;
  existingMemory?: PIEDecisionMemory | null;
  executiveJudgment?: PIEExecutiveJudgmentResult | null;
  adaptiveIntelligence?: PIEAdaptiveResult | null;
  learningResult?: PIELearningResult | null;
  reflection?: PIEReflectionResult | {
    summary?: string;
    lessonsLearned?: string[];
    confidenceChanges?: string[];
    recommendedEvidence?: string[];
    confidence?: ProjectConfidenceLevel;
  } | null;
  memoryRecall?: PIEMemoryRecallResult | null;
  predictionResult?: PIEPredictionResult | null;
  reportDraft?: PIEReportDraft | null;
};

export function buildPIEDecisionMemory(
  input: PIEDecisionMemoryInput = {},
): PIEDecisionMemoryResult {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const decisions = [
    ...(input.existingMemory?.decisions || []),
    ...recordDecision(input, generatedAt),
  ];
  const recommendations = [
    ...(input.existingMemory?.recommendations || []),
    ...recordRecommendation(input, generatedAt),
  ];
  const outcomes = [
    ...(input.existingMemory?.outcomes || []),
    ...recordDecisionOutcome(input, decisions, generatedAt),
  ];
  const wisdomLessons = extractWisdomLessons(input, decisions, recommendations, outcomes);
  const whenNotToActReasons = identifyWhenNotToAct(input, wisdomLessons);
  const wisdomPatterns = identifyRepeatedDecisionPatterns(input, decisions, recommendations, outcomes);
  const trustCalibrationHistory = calibrateTrustFromDecisionHistory(input, outcomes, wisdomLessons);
  const wisdomRecommendations = buildWisdomRecommendation(input, whenNotToActReasons, wisdomLessons);
  const summary = summarizeDecisionMemory({
    decisions,
    recommendations,
    outcomes,
    wisdomLessons,
    whenNotToActReasons,
  });
  const confidence = strongestConfidence([
    input.executiveJudgment?.confidence,
    input.adaptiveIntelligence?.confidence,
    input.learningResult?.confidence,
    input.memoryRecall?.confidence,
  ]);
  const decisionMemory: PIEDecisionMemory = {
    generatedAt,
    decisions,
    recommendations,
    outcomes,
    wisdomLessons,
    wisdomPatterns,
    whenNotToActReasons,
    trustCalibrationHistory,
    wisdomRecommendations,
    summary,
    confidence,
  };

  return {
    generatedAt,
    decisionMemory,
    decisionHistory: decisions,
    recommendationHistory: recommendations,
    outcomeHistory: outcomes,
    wisdomLessons,
    wisdomPatterns,
    whenNotToActReasons,
    wisdomRecommendations,
    trustCalibrationHistory,
    summary,
    confidence,
  };
}

export function recordDecision(
  input: PIEDecisionMemoryInput,
  generatedAt: string = input.generatedAt || new Date().toISOString(),
): PIEDecisionRecord[] {
  const judgment = input.executiveJudgment;
  const decision = judgment?.executiveDecisions[0];
  const action = judgment?.highestValueAction;
  if (!judgment || (!decision && !action)) return [];
  return [
    {
      id: `decision-${Date.parse(generatedAt) || Date.now()}`,
      decision: decision?.decision || action?.action || 'No executive decision selected.',
      why: decision?.whyNow || action?.why || judgment.executiveJudgmentSummary,
      evidenceUsed: action?.governance.supportingEvidence || [],
      assumptions: action?.governance.assumptions || [],
      alternativesConsidered: action?.governance.alternativesConsidered || [],
      uncertainty: action?.governance.uncertainty || [],
      recommendedAction: action?.action || judgment.executiveJudgment.bestActionIfEvidenceIncomplete,
      createdAt: generatedAt,
      confidence: action?.confidence || judgment.confidence,
    },
  ];
}

export function recordRecommendation(
  input: PIEDecisionMemoryInput,
  generatedAt: string = input.generatedAt || new Date().toISOString(),
): PIERecommendationRecord[] {
  const action = input.executiveJudgment?.highestValueAction;
  const adaptiveResponse = input.adaptiveIntelligence?.outcomeIntelligence.userResponse;
  if (!action && !input.reportDraft) return [];
  return [
    {
      id: `recommendation-${Date.parse(generatedAt) || Date.now()}`,
      recommendation: action?.action || input.reportDraft?.title || 'Report recommendation pending review.',
      whyRecommended: action?.why || input.reportDraft?.executiveSummary[0] || 'Recommendation is pending stronger evidence.',
      evidenceUsed: action?.governance.supportingEvidence || input.reportDraft?.sourceEvidence.map(source => source.summary) || [],
      assumptions: action?.governance.assumptions || [],
      alternativesConsidered: action?.governance.alternativesConsidered || [],
      uncertainty: action?.governance.uncertainty || input.reportDraft?.reviewFlags || [],
      userAction: adaptiveResponse === 'accepted' || adaptiveResponse === 'approved' || adaptiveResponse === 'rejected' ||
        adaptiveResponse === 'modified' || adaptiveResponse === 'edited'
        ? adaptiveResponse === 'edited' ? 'modified' : adaptiveResponse
        : 'unknown',
      createdAt: generatedAt,
      confidence: action?.confidence || input.reportDraft?.confidence || 'low',
    },
  ];
}

export function recordDecisionOutcome(
  input: PIEDecisionMemoryInput,
  decisions: PIEDecisionRecord[] = [],
  generatedAt: string = input.generatedAt || new Date().toISOString(),
): PIEDecisionOutcomeRecord[] {
  const outcome = input.adaptiveIntelligence?.outcomeIntelligence;
  const learningSignal = input.learningResult?.learningSignals[0];
  const decision = decisions[0];
  if (!outcome && !learningSignal && !decision) return [];
  const comparison = compareDecisionToOutcome(input, decision);
  return [
    {
      id: `outcome-${Date.parse(generatedAt) || Date.now()}`,
      decisionId: decision?.id || 'decision-unknown',
      actualOutcome: outcome?.realityAlignment || learningSignal?.outcome || 'unknown',
      recommendationWasCorrect: comparison.recommendationWasCorrect,
      impact: outcome?.projectOutcomeEffect || comparison.impact,
      lessonLearned: comparison.lessonLearned,
      futureAdjustment: comparison.futureAdjustment,
      recordedAt: generatedAt,
      confidence: outcome?.confidence || learningSignal?.confidence || 'low',
    },
  ];
}

export function compareDecisionToOutcome(
  input: PIEDecisionMemoryInput,
  decision?: PIEDecisionRecord,
): {
  recommendationWasCorrect: boolean | null;
  impact: PIEDecisionOutcomeRecord['impact'];
  lessonLearned: string;
  futureAdjustment: string;
} {
  const outcome = input.adaptiveIntelligence?.outcomeIntelligence;
  const rejected = outcome?.userResponse === 'rejected' ||
    input.learningResult?.learningSignals.some(signal => /rejected|failed|wrong|contradicted/i.test(`${signal.outcome} ${signal.signal} ${signal.whatPIELearned}`));
  const confirmed = outcome?.recommendationCorrectness === 'confirmed' ||
    input.learningResult?.learningSignals.some(signal => /worked|confirmed|approved/i.test(`${signal.outcome} ${signal.signal}`));
  if (rejected) {
    return {
      recommendationWasCorrect: false,
      impact: 'worsened',
      lessonLearned: 'Recommendation was rejected, contradicted, or failed.',
      futureAdjustment: 'Use more evidence and lower confidence before repeating this decision pattern.',
    };
  }
  if (confirmed) {
    return {
      recommendationWasCorrect: true,
      impact: 'improved',
      lessonLearned: 'Recommendation matched the outcome or user approval.',
      futureAdjustment: 'Reuse this pattern when evidence, assumptions, and uncertainty match.',
    };
  }
  return {
    recommendationWasCorrect: null,
    impact: 'unknown',
    lessonLearned: decision
      ? 'Outcome is not known yet.'
      : 'No decision outcome is available yet.',
    futureAdjustment: 'Track outcome before changing future judgment.',
  };
}

export function extractWisdomLessons(
  input: PIEDecisionMemoryInput,
  decisions: PIEDecisionRecord[] = [],
  recommendations: PIERecommendationRecord[] = [],
  outcomes: PIEDecisionOutcomeRecord[] = [],
): PIEExecutiveWisdomLesson[] {
  const adaptiveLessons = input.adaptiveIntelligence?.adaptiveLessons.map((lesson, index) => ({
    id: `wisdom-adaptive-${index + 1}`,
    lesson: lesson.lesson,
    sourceDecisionId: decisions[0]?.id || null,
    whenToApply: lesson.futureUse,
    futureAdjustment: lesson.futureUse,
    confidence: lesson.confidence,
  })) || [];
  const outcomeLessons = outcomes.map((outcome, index) => ({
    id: `wisdom-outcome-${index + 1}`,
    lesson: outcome.lessonLearned,
    sourceDecisionId: outcome.decisionId,
    whenToApply: recommendations[0]?.recommendation || 'Similar future decision context.',
    futureAdjustment: outcome.futureAdjustment,
    confidence: outcome.confidence,
  }));
  const reflectionLessons = (input.reflection?.lessonsLearned || []).map((lesson, index) => ({
    id: `wisdom-reflection-${index + 1}`,
    lesson: typeof lesson === 'string' ? lesson : lesson.lesson,
    sourceDecisionId: decisions[0]?.id || null,
    whenToApply: 'When similar evidence and uncertainty appear.',
    futureAdjustment: typeof lesson === 'string'
      ? 'Apply this reflection before repeating the recommendation.'
      : lesson.whatPIEShouldDoDifferently,
    confidence: reflectionConfidence(input.reflection),
  }));
  return dedupeByText([...adaptiveLessons, ...outcomeLessons, ...reflectionLessons], item => item.lesson).slice(0, 10);
}

export function identifyWhenNotToAct(
  input: PIEDecisionMemoryInput,
  wisdomLessons: PIEExecutiveWisdomLesson[] = [],
): PIEWhenNotToActReason[] {
  const reasons: PIEWhenNotToActReason[] = [];
  const action = input.executiveJudgment?.highestValueAction;
  const correctionCaution = input.memoryRecall?.pastCorrections[0];
  const weakPrediction = input.predictionResult?.predictionConfidence === 'low';
  const weakEvidence = action?.score.readiness !== 'Ready' || input.executiveJudgment?.waitForEvidenceReasoning.shouldWaitForEvidence;
  if (weakEvidence) {
    reasons.push(buildWhenNotToActReason('evidence_too_weak', 'Evidence is too weak for final action.', 'Verify or capture the smallest missing evidence.', action?.confidence || 'medium'));
  }
  if (input.executiveJudgment?.noActionReasoning.isValid) {
    reasons.push(buildWhenNotToActReason('decision_impact_low', input.executiveJudgment.noActionReasoning.reason, 'Monitor until impact changes.', input.executiveJudgment.confidence));
  }
  if (input.executiveJudgment?.escalationAnalysis.shouldEscalate === false) {
    reasons.push(buildWhenNotToActReason('escalation_creates_noise', input.executiveJudgment.escalationAnalysis.escalationRisk, 'Resolve locally or verify first.', input.executiveJudgment.confidence));
  }
  if (input.executiveJudgment?.decisionTiming.recommendation === 'wait_for_evidence') {
    reasons.push(buildWhenNotToActReason('waiting_reduces_risk', input.executiveJudgment.decisionTiming.reason, input.executiveJudgment.waitForEvidenceReasoning.smallestEvidenceRequest, input.executiveJudgment.confidence));
  }
  if (action && (action.type === 'communicate' || action.type === 'approve' || action.type === 'reject')) {
    reasons.push(buildWhenNotToActReason('action_irreversible', 'The action is harder to reverse after communication, approval, or rejection.', 'Review evidence before irreversible action.', action.confidence));
  }
  if (correctionCaution) {
    reasons.push(buildWhenNotToActReason('user_correction_history_suggests_caution', correctionCaution.summary, 'Ask the user to confirm before acting.', correctionCaution.confidence));
  }
  if (weakPrediction) {
    reasons.push(buildWhenNotToActReason('prediction_confidence_low', 'Prediction confidence is low.', 'Avoid action that depends on this forecast until verified.', 'medium'));
  }
  if (wisdomLessons.some(lesson => /truth|fabricat|assumption|uncertain/i.test(`${lesson.lesson} ${lesson.futureAdjustment}`))) {
    reasons.push(buildWhenNotToActReason('truth_over_speed', 'A constitutional principle requires truth over speed.', 'Separate evidence from assumption before acting.', 'high'));
  }
  return dedupeByText(reasons, item => item.reason).slice(0, 9);
}

export function identifyRepeatedDecisionPatterns(
  input: PIEDecisionMemoryInput,
  decisions: PIEDecisionRecord[] = [],
  recommendations: PIERecommendationRecord[] = [],
  outcomes: PIEDecisionOutcomeRecord[] = [],
): PIEWisdomPattern[] {
  const correctionPatterns = input.memoryRecall?.patterns.map((pattern, index) => ({
    id: `wisdom-pattern-memory-${index + 1}`,
    pattern: pattern.pattern,
    repeatedCount: pattern.frequency,
    evidence: pattern.relatedMemoryIds,
    recommendation: pattern.summary,
    confidence: pattern.confidence,
  })) || [];
  const failedOutcomes = outcomes.filter(outcome => outcome.recommendationWasCorrect === false);
  const failurePattern = failedOutcomes.length
    ? [{
        id: 'wisdom-pattern-failed-decision',
        pattern: 'Repeated failed or rejected decision pattern',
        repeatedCount: failedOutcomes.length,
        evidence: failedOutcomes.map(outcome => outcome.lessonLearned),
        recommendation: 'Use more evidence and lower confidence before repeating this action.',
        confidence: 'medium' as ProjectConfidenceLevel,
      }]
    : [];
  const noActionPattern = recommendations.some(recommendation => /no executive action|monitor|wait/i.test(recommendation.recommendation))
    ? [{
        id: 'wisdom-pattern-no-action',
        pattern: 'No-action or wait recommendation used',
        repeatedCount: decisions.filter(decision => /no action|wait|monitor/i.test(decision.recommendedAction)).length || 1,
        evidence: recommendations.map(recommendation => recommendation.whyRecommended).slice(0, 3),
        recommendation: 'Remember when waiting protected decision quality.',
        confidence: 'medium' as ProjectConfidenceLevel,
      }]
    : [];
  return [...correctionPatterns, ...failurePattern, ...noActionPattern].slice(0, 8);
}

export function buildWisdomRecommendation(
  input: PIEDecisionMemoryInput,
  whenNotToActReasons: PIEWhenNotToActReason[] = identifyWhenNotToAct(input),
  wisdomLessons: PIEExecutiveWisdomLesson[] = [],
): PIEWisdomRecommendation[] {
  const caution = whenNotToActReasons[0];
  const lesson = wisdomLessons[0];
  return [
    {
      id: 'wisdom-recommendation-primary',
      recommendation: caution
        ? `Do not act yet: ${caution.explanation}`
        : lesson?.futureAdjustment || 'Proceed only when evidence, uncertainty, and impact support action.',
      reason: caution?.reason || lesson?.lesson || 'Decision history does not show a strong caution pattern yet.',
      shouldAct: !caution,
      preferredAction: caution?.recommendedAlternative || input.executiveJudgment?.highestValueAction?.action || 'Monitor and record the outcome.',
      confidence: caution?.confidence || lesson?.confidence || 'low',
    },
  ];
}

export function calibrateTrustFromDecisionHistory(
  input: PIEDecisionMemoryInput,
  outcomes: PIEDecisionOutcomeRecord[] = [],
  wisdomLessons: PIEExecutiveWisdomLesson[] = [],
): PIETrustCalibrationRecord[] {
  const failed = outcomes.filter(outcome => outcome.recommendationWasCorrect === false);
  const confirmed = outcomes.filter(outcome => outcome.recommendationWasCorrect === true);
  const adaptiveTrust = input.adaptiveIntelligence?.trustIntelligence;
  return [
    {
      id: 'trust-decision-history',
      source: 'decision_history',
      trustAdjustment: failed.length ? 'trust_less' : confirmed.length ? 'trust_more' : adaptiveTrust?.trustAssessment || 'hold',
      reason: failed[0]?.lessonLearned || confirmed[0]?.lessonLearned || adaptiveTrust?.reason || 'Decision history is not strong enough to adjust trust.',
      confidence: failed.length || confirmed.length ? 'medium' : adaptiveTrust?.confidence || 'low',
    },
    ...wisdomLessons.slice(0, 2).map((lesson, index) => ({
      id: `trust-wisdom-${index + 1}`,
      source: lesson.id,
      trustAdjustment: /wrong|failed|caution|lower/i.test(`${lesson.lesson} ${lesson.futureAdjustment}`) ? 'trust_less' as const : 'hold' as const,
      reason: lesson.futureAdjustment,
      confidence: lesson.confidence,
    })),
  ];
}

export function summarizeDecisionMemory(input: {
  decisions: PIEDecisionRecord[];
  recommendations: PIERecommendationRecord[];
  outcomes: PIEDecisionOutcomeRecord[];
  wisdomLessons: PIEExecutiveWisdomLesson[];
  whenNotToActReasons: PIEWhenNotToActReason[];
}): string {
  return `Decision Memory reviewed ${input.decisions.length} decisions, ${input.recommendations.length} recommendations, ${input.outcomes.length} outcomes, ${input.wisdomLessons.length} wisdom lessons, and ${input.whenNotToActReasons.length} when-not-to-act reasons.`;
}

function buildWhenNotToActReason(
  reason: PIEWhenNotToActReason['reason'],
  explanation: string,
  recommendedAlternative: string,
  confidence: ProjectConfidenceLevel,
): PIEWhenNotToActReason {
  return {
    id: `when-not-to-act-${reason}`,
    reason,
    explanation,
    recommendedAlternative,
    confidence,
  };
}

function dedupeByText<T>(items: T[], getText: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = getText(item).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reflectionConfidence(input: PIEDecisionMemoryInput['reflection']): ProjectConfidenceLevel {
  if (!input) return 'medium';
  const values = Object.values(input as Record<string, unknown>);
  if (values.includes('high')) return 'high';
  if (values.includes('medium')) return 'medium';
  if (values.includes('low')) return 'low';
  return 'medium';
}

function strongestConfidence(levels: Array<ProjectConfidenceLevel | null | undefined>): ProjectConfidenceLevel {
  if (levels.includes('high')) return 'high';
  if (levels.includes('medium')) return 'medium';
  return 'low';
}
