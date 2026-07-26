import type { PIELearningResult, PIELearningSignal } from './PIELearningEngine';
import type { PIEMemoryRecallResult } from './PIEMemoryRecall';
import type { PIEExecutiveJudgmentResult } from './PIEExecutiveJudgment';
import type { PIEPredictionResult } from './PIEPredictiveEngine';
import type { PIEReportDraft } from './PIEReporter';
import type { PIEDecisionMemoryResult } from './PIEDecisionMemory';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEAdaptivePolicyArea =
  | 'preferred_report_style'
  | 'preferred_evidence_sequence'
  | 'escalation_threshold'
  | 'risk_threshold'
  | 'confidence_calibration'
  | 'user_communication_style'
  | 'inspection_readiness_threshold';

export type PIEAdaptivePolicy = {
  id: string;
  area: PIEAdaptivePolicyArea;
  currentPolicy: string;
  proposedAdjustment: string;
  reason: string;
  canChange: true;
  confidence: ProjectConfidenceLevel;
};

export type PIEConstitutionalPrinciple = {
  id: string;
  principle:
    | 'seek_truth'
    | 'separate_evidence_from_assumptions'
    | 'do_not_fabricate'
    | 'challenge_conclusions'
    | 'explain_reasoning'
    | 'identify_uncertainty'
    | 'prefer_decision_quality_over_appearance';
  rule: string;
  canChange: false;
};

export type PIEOutcomeIntelligence = {
  recommendationCorrectness: 'confirmed' | 'contradicted' | 'partially_confirmed' | 'unknown';
  realityAlignment: 'confirmed_judgment' | 'contradicted_judgment' | 'changed_after_judgment' | 'not_enough_evidence';
  userResponse: 'accepted' | 'rejected' | 'modified' | 'approved' | 'edited' | 'unknown';
  projectOutcomeEffect: 'improved' | 'worsened' | 'unchanged' | 'unknown';
  evidence: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIECalibrationIntelligence = {
  wasConfidenceTooHigh: boolean;
  wasConfidenceTooLow: boolean;
  adjustment: 'raise' | 'lower' | 'hold';
  reason: string;
  confidence: ProjectConfidenceLevel;
};

export type PIELearningIntelligence = {
  lessons: PIEAdaptiveLesson[];
  whatPIEShouldDoDifferently: string[];
  whatShouldNeverChange: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEStrategyIntelligence = {
  strategyAdjustments: PIEAdaptiveAdjustment[];
  evidenceSequence: string[];
  escalationThreshold: 'raise' | 'lower' | 'hold';
  riskThreshold: 'raise' | 'lower' | 'hold';
  inspectionReadinessThreshold: 'raise' | 'lower' | 'hold';
};

export type PIECommunicationIntelligence = {
  reportStyleAdjustment: string;
  userCommunicationStyle: string;
  reportEditingSignal: 'heavy_editing' | 'light_editing' | 'approved_as_written' | 'unknown';
  communicationAdjustments: PIEAdaptiveAdjustment[];
};

export type PIETrustIntelligence = {
  trustAssessment: 'trust_more' | 'trust_less' | 'hold';
  whereToTrustMore: string[];
  whereToTrustLess: string[];
  reason: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEEvolutionIntelligence = {
  summary: string;
  policyUpdates: PIEAdaptivePolicy[];
  protectedPrinciples: PIEConstitutionalPrinciple[];
  nextAdaptiveFocus: string;
};

export type PIEAdaptiveLesson = {
  id: string;
  lesson: string;
  learnedFrom: string;
  futureUse: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEAdaptiveAdjustment = {
  id: string;
  adjustment: string;
  appliesTo: PIEAdaptivePolicyArea | 'judgment' | 'recommendation' | 'communication' | 'confidence';
  reason: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEAdaptiveIntelligence = {
  generatedAt: string;
  outcomeIntelligence: PIEOutcomeIntelligence;
  calibrationIntelligence: PIECalibrationIntelligence;
  learningIntelligence: PIELearningIntelligence;
  strategyIntelligence: PIEStrategyIntelligence;
  communicationIntelligence: PIECommunicationIntelligence;
  trustIntelligence: PIETrustIntelligence;
  evolutionIntelligence: PIEEvolutionIntelligence;
  adaptivePolicies: PIEAdaptivePolicy[];
  constitutionalPrinciples: PIEConstitutionalPrinciple[];
  adaptiveLessons: PIEAdaptiveLesson[];
  adaptiveAdjustments: PIEAdaptiveAdjustment[];
  summary: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEAdaptiveResult = {
  generatedAt: string;
  adaptiveIntelligence: PIEAdaptiveIntelligence;
  outcomeIntelligence: PIEOutcomeIntelligence;
  calibrationIntelligence: PIECalibrationIntelligence;
  learningIntelligence: PIELearningIntelligence;
  strategyIntelligence: PIEStrategyIntelligence;
  communicationIntelligence: PIECommunicationIntelligence;
  trustIntelligence: PIETrustIntelligence;
  evolutionIntelligence: PIEEvolutionIntelligence;
  adaptiveLessons: PIEAdaptiveLesson[];
  adaptivePolicyUpdates: PIEAdaptivePolicy[];
  adaptiveAdjustments: PIEAdaptiveAdjustment[];
  protectedPrinciples: PIEConstitutionalPrinciple[];
  summary: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEAdaptiveInput = {
  generatedAt?: string;
  learningResult?: PIELearningResult | null;
  reflection?: {
    summary?: string;
    lessonsLearned?: string[];
    beliefChanges?: string[];
    confidenceChanges?: string[];
    recommendedEvidence?: string[];
    confidence?: ProjectConfidenceLevel;
  } | null;
  memoryRecall?: PIEMemoryRecallResult | null;
  executiveJudgment?: PIEExecutiveJudgmentResult | null;
  decisionMemory?: PIEDecisionMemoryResult | null;
  predictionResult?: PIEPredictionResult | null;
  reportDraft?: PIEReportDraft | null;
};

export function buildPIEAdaptiveIntelligence(
  input: PIEAdaptiveInput = {},
): PIEAdaptiveResult {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const outcomeIntelligence = evaluateDecisionOutcome(input);
  const recommendationOutcome = evaluateRecommendationOutcome(input);
  const calibrationIntelligence = calibrateConfidenceFromOutcome(input, outcomeIntelligence);
  const adaptiveLessons = extractAdaptiveLessons(input, outcomeIntelligence, recommendationOutcome);
  const adaptivePolicyUpdates = updateAdaptivePolicies(input, adaptiveLessons, calibrationIntelligence);
  const communicationIntelligence = evaluateCommunicationEffectiveness(input);
  const trustIntelligence = evaluatePIETrustInSituation(input, outcomeIntelligence, calibrationIntelligence);
  const strategyIntelligence = recommendStrategyAdjustment(input, adaptivePolicyUpdates);
  const protectedPrinciples = protectConstitutionalPrinciples(adaptivePolicyUpdates);
  const learningIntelligence: PIELearningIntelligence = {
    lessons: adaptiveLessons,
    whatPIEShouldDoDifferently: adaptiveLessons.map(lesson => lesson.futureUse).slice(0, 6),
    whatShouldNeverChange: protectedPrinciples.map(principle => principle.rule),
    confidence: strongestConfidence([
      outcomeIntelligence.confidence,
      calibrationIntelligence.confidence,
      trustIntelligence.confidence,
    ]),
  };
  const adaptiveAdjustments = [
    ...strategyIntelligence.strategyAdjustments,
    ...communicationIntelligence.communicationAdjustments,
    ...adaptivePolicyUpdates.map(policy => ({
      id: `adjustment-${policy.id}`,
      adjustment: policy.proposedAdjustment,
      appliesTo: policy.area,
      reason: policy.reason,
      confidence: policy.confidence,
    })),
  ];
  const evolutionIntelligence: PIEEvolutionIntelligence = {
    summary: 'DAVE adapts policies from outcomes while protecting constitutional principles.',
    policyUpdates: adaptivePolicyUpdates,
    protectedPrinciples,
    nextAdaptiveFocus: adaptiveLessons[0]?.futureUse || 'Collect more outcomes before changing strategy.',
  };
  const summary = summarizeAdaptiveIntelligence({
    outcomeIntelligence,
    calibrationIntelligence,
    adaptiveLessons,
    adaptivePolicyUpdates,
    protectedPrinciples,
  });
  const confidence = strongestConfidence([
    outcomeIntelligence.confidence,
    calibrationIntelligence.confidence,
    trustIntelligence.confidence,
  ]);
  const adaptiveIntelligence: PIEAdaptiveIntelligence = {
    generatedAt,
    outcomeIntelligence,
    calibrationIntelligence,
    learningIntelligence,
    strategyIntelligence,
    communicationIntelligence,
    trustIntelligence,
    evolutionIntelligence,
    adaptivePolicies: adaptivePolicyUpdates,
    constitutionalPrinciples: protectedPrinciples,
    adaptiveLessons,
    adaptiveAdjustments,
    summary,
    confidence,
  };

  return {
    generatedAt,
    adaptiveIntelligence,
    outcomeIntelligence,
    calibrationIntelligence,
    learningIntelligence,
    strategyIntelligence,
    communicationIntelligence,
    trustIntelligence,
    evolutionIntelligence,
    adaptiveLessons,
    adaptivePolicyUpdates,
    adaptiveAdjustments,
    protectedPrinciples,
    summary,
    confidence,
  };
}

export function evaluateDecisionOutcome(input: PIEAdaptiveInput): PIEOutcomeIntelligence {
  const signals = input.learningResult?.learningSignals || [];
  const rejected = hasOutcome(signals, 'rejected') || hasText(signals, /reject|wrong|failed/i);
  const accepted = hasOutcome(signals, 'approved') || hasOutcome(signals, 'confirmed') || hasOutcome(signals, 'worked');
  const modified = hasOutcome(signals, 'corrected') || hasText(signals, /edit|modified|correction/i);
  const predictionFailed = hasText(signals, /prediction failed|contradict|wrong/i) ||
    input.predictionResult?.predictionConfidence === 'low';
  const recommendationCorrectness = rejected || predictionFailed
    ? 'contradicted'
    : modified
      ? 'partially_confirmed'
      : accepted
        ? 'confirmed'
        : 'unknown';

  return {
    recommendationCorrectness,
    realityAlignment: predictionFailed
      ? 'contradicted_judgment'
      : accepted
        ? 'confirmed_judgment'
        : input.reflection?.beliefChanges?.length
          ? 'changed_after_judgment'
          : 'not_enough_evidence',
    userResponse: rejected ? 'rejected' : modified ? 'modified' : accepted ? 'approved' : 'unknown',
    projectOutcomeEffect: accepted ? 'improved' : rejected ? 'worsened' : 'unknown',
    evidence: [
      input.reflection?.summary,
      input.learningResult?.summary,
      input.executiveJudgment?.executiveJudgmentSummary,
      input.decisionMemory?.summary,
      input.memoryRecall?.comparisons[0]?.summary,
    ].filter((item): item is string => Boolean(item)).slice(0, 6),
    confidence: signals.length || input.reflection?.summary ? 'medium' : 'low',
  };
}

export function evaluateRecommendationOutcome(input: PIEAdaptiveInput): PIEOutcomeIntelligence {
  const signals = input.learningResult?.learningSignals || [];
  const accepted = hasText(signals, /recommendation accepted|worked|approved|confirmed/i);
  const rejected = hasText(signals, /recommendation rejected|failed|wrong/i);
  const edited = input.reportDraft?.needsReview || hasText(signals, /report edit|heavy editing|modified/i);
  return {
    recommendationCorrectness: rejected ? 'contradicted' : edited ? 'partially_confirmed' : accepted ? 'confirmed' : 'unknown',
    realityAlignment: rejected ? 'contradicted_judgment' : accepted ? 'confirmed_judgment' : 'not_enough_evidence',
    userResponse: rejected ? 'rejected' : edited ? 'edited' : accepted ? 'accepted' : 'unknown',
    projectOutcomeEffect: accepted ? 'improved' : 'unknown',
    evidence: signals.map(signal => signal.signal).slice(0, 5),
    confidence: signals.length ? 'medium' : 'low',
  };
}

export function calibrateConfidenceFromOutcome(
  input: PIEAdaptiveInput,
  outcome: PIEOutcomeIntelligence = evaluateDecisionOutcome(input),
): PIECalibrationIntelligence {
  const confidenceChanges = input.reflection?.confidenceChanges || [];
  const tooHigh = outcome.recommendationCorrectness === 'contradicted' ||
    confidenceChanges.some(change => /decrease|lower|too high|weaken/i.test(change));
  const tooLow = outcome.recommendationCorrectness === 'confirmed' &&
    confidenceChanges.some(change => /increase|raise|too low|strengthen/i.test(change));
  return {
    wasConfidenceTooHigh: tooHigh,
    wasConfidenceTooLow: tooLow,
    adjustment: tooHigh ? 'lower' : tooLow ? 'raise' : 'hold',
    reason: tooHigh
      ? 'Outcome or correction contradicted DAVE confidence.'
      : tooLow
        ? 'Outcome confirmed DAVE while confidence was conservative.'
        : 'No strong calibration change is justified yet.',
    confidence: confidenceChanges.length || outcome.confidence === 'medium' ? 'medium' : 'low',
  };
}

export function extractAdaptiveLessons(
  input: PIEAdaptiveInput,
  outcome: PIEOutcomeIntelligence = evaluateDecisionOutcome(input),
  recommendationOutcome: PIEOutcomeIntelligence = evaluateRecommendationOutcome(input),
): PIEAdaptiveLesson[] {
  const learningLessons = input.learningResult?.lessonsLearned.map((lesson, index) => ({
    id: `adaptive-learning-${index + 1}`,
    lesson: lesson.lesson,
    learnedFrom: lesson.learnedFrom,
    futureUse: lesson.appliesToFuture,
    confidence: lesson.confidence,
  })) || [];
  const reflectionLessons = input.reflection?.lessonsLearned?.map((lesson, index) => ({
    id: `adaptive-reflection-${index + 1}`,
    lesson,
    learnedFrom: 'reflection',
    futureUse: 'Use this reflection before repeating the same judgment.',
    confidence: input.reflection?.confidence || 'medium',
  })) || [];
  const decisionMemoryLessons = input.decisionMemory?.wisdomLessons.map((lesson, index) => ({
    id: `adaptive-decision-memory-${index + 1}`,
    lesson: lesson.lesson,
    learnedFrom: 'decision_memory',
    futureUse: lesson.futureAdjustment,
    confidence: lesson.confidence,
  })) || [];
  const outcomeLesson: PIEAdaptiveLesson = {
    id: 'adaptive-outcome-correctness',
    lesson: `Recommendation outcome: ${outcome.recommendationCorrectness}; user response: ${recommendationOutcome.userResponse}.`,
    learnedFrom: 'outcome_intelligence',
    futureUse: outcome.recommendationCorrectness === 'contradicted'
      ? 'Challenge similar recommendations and lower confidence until evidence improves.'
      : 'Reuse this decision pattern when evidence and context match.',
    confidence: outcome.confidence,
  };
  return dedupeLessons([outcomeLesson, ...decisionMemoryLessons, ...learningLessons, ...reflectionLessons]).slice(0, 10);
}

export function updateAdaptivePolicies(
  input: PIEAdaptiveInput,
  lessons: PIEAdaptiveLesson[] = extractAdaptiveLessons(input),
  calibration: PIECalibrationIntelligence = calibrateConfidenceFromOutcome(input),
): PIEAdaptivePolicy[] {
  const reportEdited = input.reportDraft?.needsReview || lessons.some(lesson => /report|edit/i.test(lesson.lesson));
  const corrections = input.memoryRecall?.pastCorrections || [];
  const wisdomCaution = input.decisionMemory?.whenNotToActReasons[0];
  const rejected = lessons.some(lesson => /rejected|contradicted|failed/i.test(`${lesson.lesson} ${lesson.futureUse}`));
  return [
    {
      id: 'policy-confidence-calibration',
      area: 'confidence_calibration',
      currentPolicy: 'Use evidence quality, belief readiness, and outcome history to calibrate confidence.',
      proposedAdjustment: calibration.adjustment === 'hold'
        ? 'Hold confidence calibration until stronger outcome evidence exists.'
        : `${calibration.adjustment} confidence for similar future judgments.`,
      reason: calibration.reason,
      canChange: true,
      confidence: calibration.confidence,
    },
    {
      id: 'policy-report-style',
      area: 'preferred_report_style',
      currentPolicy: 'Use concise David-style project updates with location grouping.',
      proposedAdjustment: reportEdited
        ? 'Tighten report wording and surface review warnings before communication.'
        : 'Keep current report style preference.',
      reason: reportEdited ? 'Report needed review or editing.' : 'No heavy report editing signal is present.',
      canChange: true,
      confidence: reportEdited ? 'medium' : 'low',
    },
    {
      id: 'policy-evidence-sequence',
      area: 'preferred_evidence_sequence',
      currentPolicy: 'Prefer minimum evidence that reduces uncertainty fastest.',
      proposedAdjustment: corrections.length
        ? 'Ask for confirmation earlier when user corrections recur.'
        : wisdomCaution
          ? `Ask for evidence earlier when wisdom says not to act: ${wisdomCaution.reason}.`
        : 'Continue requesting the smallest useful evidence item first.',
      reason: corrections[0]?.summary || wisdomCaution?.explanation || 'No recurring correction sequence is visible.',
      canChange: true,
      confidence: corrections.length ? 'medium' : 'low',
    },
    {
      id: 'policy-escalation-threshold',
      area: 'escalation_threshold',
      currentPolicy: 'Escalate only with blocked decisions, missing owners, safety risk, schedule impact, repeated unresolved issues, failed local action, or leadership timing need.',
      proposedAdjustment: rejected
        ? 'Raise escalation threshold for similar weak-evidence situations.'
        : 'Hold escalation threshold until outcome evidence supports a change.',
      reason: rejected ? 'A recommendation was rejected, contradicted, or failed.' : 'No failed escalation signal is present.',
      canChange: true,
      confidence: rejected ? 'medium' : 'low',
    },
  ];
}

export function evaluateCommunicationEffectiveness(input: PIEAdaptiveInput): PIECommunicationIntelligence {
  const reportEdited = input.reportDraft?.needsReview ||
    input.learningResult?.learningSignals.some(signal => /report edit|heavy editing|unclear/i.test(signal.signal));
  return {
    reportStyleAdjustment: reportEdited
      ? 'Make report language more specific, evidence-backed, and easier to approve.'
      : 'Keep current report style unless future edits show a pattern.',
    userCommunicationStyle: reportEdited
      ? 'Ask for review on uncertain items before drafting final communication.'
      : 'Continue concise professional communication.',
    reportEditingSignal: reportEdited ? 'heavy_editing' : input.reportDraft ? 'approved_as_written' : 'unknown',
    communicationAdjustments: [
      {
        id: 'adaptive-communication-report',
        adjustment: reportEdited
          ? 'Move uncertain items into review warnings instead of report body.'
          : 'Preserve concise location-based report structure.',
        appliesTo: 'communication',
        reason: reportEdited ? 'Report needed review.' : 'No communication correction is visible.',
        confidence: reportEdited ? 'medium' : 'low',
      },
    ],
  };
}

export function evaluatePIETrustInSituation(
  input: PIEAdaptiveInput,
  outcome: PIEOutcomeIntelligence = evaluateDecisionOutcome(input),
  calibration: PIECalibrationIntelligence = calibrateConfidenceFromOutcome(input, outcome),
): PIETrustIntelligence {
  const memoryTrustLess = input.memoryRecall?.pastCorrections.map(correction => correction.summary) || [];
  const decisionTrustLess = input.decisionMemory?.trustCalibrationHistory
    .filter(record => record.trustAdjustment === 'trust_less')
    .map(record => record.reason) || [];
  const trustAssessment = calibration.adjustment === 'lower'
    ? 'trust_less'
    : calibration.adjustment === 'raise'
      ? 'trust_more'
      : 'hold';
  return {
    trustAssessment,
    whereToTrustMore: outcome.recommendationCorrectness === 'confirmed'
      ? ['Similar evidence patterns with matching context.']
      : [],
    whereToTrustLess: [
      ...memoryTrustLess,
      ...decisionTrustLess,
      calibration.wasConfidenceTooHigh ? 'Similar judgments with contradicted outcomes.' : null,
    ].filter((item): item is string => Boolean(item)).slice(0, 5),
    reason: calibration.reason,
    confidence: calibration.confidence,
  };
}

export function recommendStrategyAdjustment(
  input: PIEAdaptiveInput,
  policies: PIEAdaptivePolicy[] = updateAdaptivePolicies(input),
): PIEStrategyIntelligence {
  const evidencePolicy = policies.find(policy => policy.area === 'preferred_evidence_sequence');
  const escalationPolicy = policies.find(policy => policy.area === 'escalation_threshold');
  const confidencePolicy = policies.find(policy => policy.area === 'confidence_calibration');
  return {
    strategyAdjustments: [
      {
        id: 'adaptive-strategy-evidence',
        adjustment: evidencePolicy?.proposedAdjustment || 'Keep minimum-evidence-first strategy.',
        appliesTo: 'preferred_evidence_sequence',
        reason: evidencePolicy?.reason || 'No evidence sequence correction is visible.',
        confidence: evidencePolicy?.confidence || 'low',
      },
      {
        id: 'adaptive-strategy-escalation',
        adjustment: escalationPolicy?.proposedAdjustment || 'Hold escalation threshold.',
        appliesTo: 'escalation_threshold',
        reason: escalationPolicy?.reason || 'No escalation outcome signal is visible.',
        confidence: escalationPolicy?.confidence || 'low',
      },
      {
        id: 'adaptive-strategy-confidence',
        adjustment: confidencePolicy?.proposedAdjustment || 'Hold confidence calibration.',
        appliesTo: 'confidence_calibration',
        reason: confidencePolicy?.reason || 'No confidence outcome signal is visible.',
        confidence: confidencePolicy?.confidence || 'low',
      },
    ],
    evidenceSequence: [
      'Confirm project and area.',
      'Capture the smallest evidence item that changes the decision.',
      'Ask for owner/status only when it affects judgment.',
    ],
    escalationThreshold: escalationPolicy?.proposedAdjustment.includes('Raise') ? 'raise' : 'hold',
    riskThreshold: input.predictionResult?.predictionConfidence === 'low' ? 'raise' : 'hold',
    inspectionReadinessThreshold: input.executiveJudgment?.executiveReadiness === 'Needs Verification' ? 'raise' : 'hold',
  };
}

export function protectConstitutionalPrinciples(
  policies: PIEAdaptivePolicy[] = [],
): PIEConstitutionalPrinciple[] {
  void policies;
  return [
    {
      id: 'principle-seek-truth',
      principle: 'seek_truth',
      rule: 'Always seek truth over convenience or appearance.',
      canChange: false,
    },
    {
      id: 'principle-evidence-assumptions',
      principle: 'separate_evidence_from_assumptions',
      rule: 'Separate evidence from assumptions in every judgment.',
      canChange: false,
    },
    {
      id: 'principle-no-fabrication',
      principle: 'do_not_fabricate',
      rule: 'Never fabricate facts, observations, owners, dates, or outcomes.',
      canChange: false,
    },
    {
      id: 'principle-challenge',
      principle: 'challenge_conclusions',
      rule: 'Challenge conclusions before recommendations.',
      canChange: false,
    },
    {
      id: 'principle-explain',
      principle: 'explain_reasoning',
      rule: 'Explain reasoning and identify uncertainty.',
      canChange: false,
    },
    {
      id: 'principle-decision-quality',
      principle: 'prefer_decision_quality_over_appearance',
      rule: 'Prefer decision quality over sounding confident.',
      canChange: false,
    },
  ];
}

export function summarizeAdaptiveIntelligence(input: {
  outcomeIntelligence: PIEOutcomeIntelligence;
  calibrationIntelligence: PIECalibrationIntelligence;
  adaptiveLessons: PIEAdaptiveLesson[];
  adaptivePolicyUpdates: PIEAdaptivePolicy[];
  protectedPrinciples: PIEConstitutionalPrinciple[];
}): string {
  return `Adaptive Intelligence reviewed ${input.outcomeIntelligence.recommendationCorrectness} outcomes, ${input.calibrationIntelligence.adjustment} confidence calibration, prepared ${input.adaptivePolicyUpdates.length} adaptive policy updates, and protected ${input.protectedPrinciples.length} constitutional principles.`;
}

function hasOutcome(signals: PIELearningSignal[], outcome: PIELearningSignal['outcome']) {
  return signals.some(signal => signal.outcome === outcome);
}

function hasText(signals: PIELearningSignal[], pattern: RegExp) {
  return signals.some(signal =>
    pattern.test(`${signal.source} ${signal.outcome} ${signal.signal} ${signal.whatPIELearned} ${signal.futureBehavior}`)
  );
}

function dedupeLessons(lessons: PIEAdaptiveLesson[]) {
  const seen = new Set<string>();
  return lessons.filter(lesson => {
    const key = lesson.lesson.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function strongestConfidence(levels: ProjectConfidenceLevel[]): ProjectConfidenceLevel {
  if (levels.includes('high')) return 'high';
  if (levels.includes('medium')) return 'medium';
  return 'low';
}
