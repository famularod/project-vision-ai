import type {
  PIEBelief,
  PIEBeliefEngineResult,
} from './PIEBeliefEngine';
import type { PIEExecutiveReasoningResult } from './PIEExecutiveReasoning';
import type {
  PIEPatternConfidence,
  PIEPatternIntelligence,
} from './PIEPatternEngine';
import type { PIEPredictionResult } from './PIEPredictiveEngine';
import type {
  PIEBeliefChange,
  PIEConfidenceChange,
  PIELessonLearned,
  PIERecommendationImprovement,
  PIEReflectionResult,
} from './PIEReflectionEngine';
import type { PIEReportDraft } from './PIEReporter';
import type { PIERuntimeState } from './PIERuntime';
import type { PIEAdaptiveResult } from './PIEAdaptiveIntelligence';
import type { PIEDecisionMemoryResult } from './PIEDecisionMemory';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIELearningSource =
  | 'user_correction'
  | 'report_approval'
  | 'report_edit'
  | 'recommendation_accepted'
  | 'recommendation_rejected'
  | 'prediction_confirmed'
  | 'prediction_failed'
  | 'reflection_lesson'
  | 'pattern_match'
  | 'schedule_change'
  | 'photo_evidence'
  | 'GPS_correction'
  | 'decision_outcome';

export type PIELearningOutcome =
  | 'worked'
  | 'failed'
  | 'partially_worked'
  | 'confirmed'
  | 'corrected'
  | 'approved'
  | 'rejected'
  | 'unknown';

export type PIELearningSignal = {
  id: string;
  source: PIELearningSource;
  outcome: PIELearningOutcome;
  signal: string;
  whatPIELearned: string;
  shouldTrustMore: string[];
  shouldTrustLess: string[];
  futureBehavior: string;
  confidence: ProjectConfidenceLevel;
};

export type PIELearningEvent = {
  id: string;
  source: PIELearningSource;
  event: string;
  outcome: PIELearningOutcome;
  evidence: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIELearningLesson = {
  id: string;
  lesson: string;
  learnedFrom: PIELearningSource;
  appliesToFuture: string;
  confidence: ProjectConfidenceLevel;
};

export type PIELearningAdjustment = {
  id: string;
  adjustment: string;
  reason: string;
  appliesTo: 'recommendation' | 'prediction' | 'report' | 'memory' | 'belief' | 'pattern' | 'gps' | 'schedule';
  confidence: ProjectConfidenceLevel;
};

export type PIELearningPatternUpdate = {
  id: string;
  pattern: string;
  confidenceChange: 'increase' | 'decrease' | 'hold';
  reason: string;
  confidence: PIEPatternConfidence;
};

export type PIELearningBeliefUpdate = {
  id: string;
  belief: string;
  confidenceChange: 'increase' | 'decrease' | 'hold';
  reason: string;
  confidence: ProjectConfidenceLevel;
};

export type PIELearningConfidenceCalibration = {
  id: string;
  source: PIELearningSource | 'overall';
  adjustment: 'raise' | 'lower' | 'hold';
  reason: string;
  confidence: ProjectConfidenceLevel;
};

export type PIELearningRecommendationImprovement = {
  id: string;
  recommendationPattern: string;
  worked: boolean;
  improvement: string;
  confidence: ProjectConfidenceLevel;
};

export type PIELearningMemoryConsolidation = {
  id: string;
  influenceType:
    | 'future caution'
    | 'preference pattern'
    | 'recurring issue'
    | 'successful response'
    | 'failed response'
    | 'user correction pattern';
  summary: string;
  influence: string;
  confidence: ProjectConfidenceLevel;
};

export type PIELearningDecisionQuality = {
  id: string;
  signal: string;
  decisionQualityLearning: string;
  confidence: ProjectConfidenceLevel;
};

export type PIELearningResult = {
  generatedAt: string;
  learningSignals: PIELearningSignal[];
  learningEvents: PIELearningEvent[];
  lessonsLearned: PIELearningLesson[];
  adjustments: PIELearningAdjustment[];
  patternUpdates: PIELearningPatternUpdate[];
  beliefUpdates: PIELearningBeliefUpdate[];
  confidenceCalibration: PIELearningConfidenceCalibration[];
  recommendationImprovements: PIELearningRecommendationImprovement[];
  memoryConsolidation: PIELearningMemoryConsolidation[];
  futureAdjustments: string[];
  decisionQualityLearning: PIELearningDecisionQuality[];
  summary: string;
  confidence: ProjectConfidenceLevel;
};

export type PIELearningInput = {
  runtime: PIERuntimeState;
  reflection?: PIEReflectionResult | null;
  beliefSystem?: PIEBeliefEngineResult | null;
  patternIntelligence?: PIEPatternIntelligence | null;
  predictionResult?: PIEPredictionResult | null;
  executiveReasoning?: PIEExecutiveReasoningResult | null;
  reportDraft?: PIEReportDraft | null;
  adaptiveIntelligence?: PIEAdaptiveResult | null;
  decisionMemory?: PIEDecisionMemoryResult | null;
  generatedAt?: string;
};

export function buildPIELearning(input: PIELearningInput): PIELearningResult {
  const learningEvents = buildLearningEvents(input);
  const learningSignals = extractLearningSignals(input, learningEvents);
  const lessonsLearned = summarizeLessons(learningSignals);
  const confidenceCalibration = calibrateConfidence(input, learningSignals);
  const patternUpdates = updatePatternLearning(input, learningSignals);
  const beliefUpdates = updateBeliefLearning(input, learningSignals);
  const recommendationImprovements = buildRecommendationImprovements(input, learningSignals);
  const memoryConsolidation = consolidateMemory(input, learningSignals);
  const adjustments = buildAdjustments(input, learningSignals, confidenceCalibration);
  const futureAdjustments = buildFutureAdjustment(input, {
    learningSignals,
    confidenceCalibration,
    memoryConsolidation,
  });
  const decisionQualityLearning = buildDecisionQualityLearning(input, learningSignals);

  return {
    generatedAt: input.generatedAt || input.runtime.generatedAt || new Date().toISOString(),
    learningSignals,
    learningEvents,
    lessonsLearned,
    adjustments,
    patternUpdates,
    beliefUpdates,
    confidenceCalibration,
    recommendationImprovements,
    memoryConsolidation,
    futureAdjustments,
    decisionQualityLearning,
    summary: summarizeLearning({
      learningSignals,
      lessonsLearned,
      futureAdjustments,
      confidenceCalibration,
    }),
    confidence: learningConfidence(learningSignals, input),
  };
}

export function extractLearningSignals(
  input: PIELearningInput,
  events: PIELearningEvent[] = buildLearningEvents(input),
): PIELearningSignal[] {
  return [
    ...learnFromUserCorrections(input, events),
    ...learnFromReportApproval(input, events),
    ...learnFromReportEdits(input, events),
    ...learnFromRecommendationOutcome(input, events),
    ...learnFromPredictionOutcome(input, events),
    ...learnFromReflection(input, events),
  ];
}

export function learnFromUserCorrections(
  input: PIELearningInput,
  events: PIELearningEvent[] = buildLearningEvents(input),
): PIELearningSignal[] {
  return events
    .filter(event => event.source === 'user_correction' || event.source === 'GPS_correction')
    .map((event, index) => ({
      id: `learning-correction-${index + 1}`,
      source: event.source,
      outcome: event.outcome,
      signal: event.event,
      whatPIELearned: 'User corrections should reduce confidence for similar future assumptions until verified.',
      shouldTrustMore: ['recent user correction', 'explicit project or area selection'],
      shouldTrustLess: ['uncorrected GPS boundary inference', 'stale location memory'],
      futureBehavior: 'Lower confidence and ask for confirmation when similar GPS, project, or area ambiguity appears.',
      confidence: event.confidence,
    }));
}

export function learnFromReportApproval(
  input: PIELearningInput,
  events: PIELearningEvent[] = buildLearningEvents(input),
): PIELearningSignal[] {
  const approved = events.filter(event => event.source === 'report_approval');
  return approved.map((event, index) => ({
    id: `learning-report-approval-${index + 1}`,
    source: 'report_approval',
    outcome: 'approved',
    signal: event.event,
    whatPIELearned: 'Approved report structure and wording can be trusted slightly more next time.',
    shouldTrustMore: ['location grouping', 'numbered work areas', 'owner/action phrasing'],
    shouldTrustLess: [],
    futureBehavior: 'Prefer concise David-style wording and keep action items tied to named owners.',
    confidence: event.confidence,
  }));
}

export function learnFromReportEdits(
  input: PIELearningInput,
  events: PIELearningEvent[] = buildLearningEvents(input),
): PIELearningSignal[] {
  const reportNeedsReview = input.reportDraft?.needsReview || input.runtime.response.reportNeedsReview;
  if (!reportNeedsReview) return [];

  return [{
    id: 'learning-report-edit-style',
    source: 'report_edit',
    outcome: 'corrected',
    signal: 'Report draft needed review or editing.',
    whatPIELearned: 'Report style or evidence wording may need adjustment before future communication.',
    shouldTrustMore: ['review flags', 'user-edited report language', 'source evidence'],
    shouldTrustLess: ['unreviewed generated wording', 'low-confidence report bullets'],
    futureBehavior: 'Keep report language concise, avoid unsupported predictions, and preserve user approval before communication.',
    confidence: input.reportDraft?.confidence || input.runtime.response.reportReadiness,
  }];
}

export function learnFromRecommendationOutcome(
  input: PIELearningInput,
  events: PIELearningEvent[] = buildLearningEvents(input),
): PIELearningSignal[] {
  return events
    .filter(event =>
      event.source === 'recommendation_accepted' ||
      event.source === 'recommendation_rejected' ||
      event.source === 'decision_outcome',
    )
    .map((event, index) => ({
      id: `learning-recommendation-${index + 1}`,
      source: event.source,
      outcome: event.outcome,
      signal: event.event,
      whatPIELearned: event.outcome === 'rejected'
        ? 'A rejected recommendation should weaken similar future recommendation patterns.'
        : 'A recommendation or decision outcome can strengthen similar future patterns when evidence is comparable.',
      shouldTrustMore: event.outcome === 'rejected' ? ['user correction'] : ['similar evidence-backed recommendation'],
      shouldTrustLess: event.outcome === 'rejected' ? ['same recommendation pattern without new evidence'] : [],
      futureBehavior: event.outcome === 'rejected'
        ? 'Ask what would change the recommendation before repeating it.'
        : 'Reuse the recommendation pattern when similar evidence and readiness are present.',
      confidence: event.confidence,
    }));
}

export function learnFromPredictionOutcome(
  input: PIELearningInput,
  events: PIELearningEvent[] = buildLearningEvents(input),
): PIELearningSignal[] {
  const prediction = input.predictionResult;
  if (!prediction) return [];

  const failedPrediction = events.find(event => event.source === 'prediction_failed');
  const confirmedPrediction = events.find(event => event.source === 'prediction_confirmed');
  const source = failedPrediction || confirmedPrediction;

  if (source) {
    return [{
      id: `learning-${source.source}`,
      source: source.source,
      outcome: source.outcome,
      signal: source.event,
      whatPIELearned: source.source === 'prediction_failed'
        ? 'Prediction assumptions should be weakened for similar future cases.'
        : 'Prediction assumptions were useful and may be trusted more when evidence is similar.',
      shouldTrustMore: source.source === 'prediction_confirmed' ? ['similar schedule and dependency evidence'] : ['verification before prediction'],
      shouldTrustLess: source.source === 'prediction_failed' ? ['same prediction pattern without updated evidence'] : [],
      futureBehavior: source.source === 'prediction_failed'
        ? 'Lower prediction confidence until the failed assumption is verified.'
        : 'Use the same recovery sequence when matching dependencies recur.',
      confidence: source.confidence,
    }];
  }

  if (prediction.noActionOutcome.riskLevel === 'high') {
    return [{
      id: 'learning-prediction-no-action',
      source: 'prediction_confirmed',
      outcome: 'unknown',
      signal: prediction.noActionOutcome.likelyOutcome,
      whatPIELearned: 'No-action consequences should be monitored for future prediction quality.',
      shouldTrustMore: ['no-action simulation with clear dependencies'],
      shouldTrustLess: ['unverified high-impact prediction'],
      futureBehavior: 'Ask for outcome evidence after high-risk predictions so DAVE can calibrate future confidence.',
      confidence: prediction.predictionConfidence,
    }];
  }

  return [];
}

export function learnFromReflection(
  input: PIELearningInput,
  events: PIELearningEvent[] = buildLearningEvents(input),
): PIELearningSignal[] {
  const reflectionLessons = input.reflection?.lessonsLearned || input.runtime.lessonsLearned;
  return reflectionLessons.slice(0, 6).map((lesson, index) => ({
    id: `learning-reflection-${lesson.id || index}`,
    source: 'reflection_lesson',
    outcome: 'confirmed',
    signal: lesson.lesson,
    whatPIELearned: lesson.lesson,
    shouldTrustMore: ['Reflection lesson', 'verified project evidence'],
    shouldTrustLess: lesson.whatPIEShouldDoDifferently ? ['old behavior before reflection'] : [],
    futureBehavior: lesson.whatPIEShouldDoDifferently || 'Use this lesson when similar evidence appears.',
    confidence: lesson.confidence,
  }));
}

export function calibrateConfidence(
  input: PIELearningInput,
  signals: PIELearningSignal[] = extractLearningSignals(input),
): PIELearningConfidenceCalibration[] {
  const calibrations = [
    ...signals
      .filter(signal => signal.source === 'user_correction' || signal.source === 'GPS_correction')
      .map(signal => ({
        id: `confidence-${signal.id}`,
        source: signal.source,
        adjustment: 'lower' as const,
        reason: signal.futureBehavior,
        confidence: signal.confidence,
      })),
    ...signals
      .filter(signal => signal.source === 'report_approval' || signal.source === 'prediction_confirmed')
      .map(signal => ({
        id: `confidence-${signal.id}`,
        source: signal.source,
        adjustment: 'raise' as const,
        reason: signal.futureBehavior,
        confidence: signal.confidence,
      })),
    ...signals
      .filter(signal => signal.source === 'prediction_failed' || signal.source === 'recommendation_rejected')
      .map(signal => ({
        id: `confidence-${signal.id}`,
        source: signal.source,
        adjustment: 'lower' as const,
        reason: signal.futureBehavior,
        confidence: signal.confidence,
      })),
  ];

  return calibrations.length > 0
    ? calibrations
    : [{
        id: 'confidence-overall-hold',
        source: 'overall',
        adjustment: 'hold',
        reason: 'No strong learning outcome changed confidence calibration.',
        confidence: input.runtime.overallConfidence,
      }];
}

export function updatePatternLearning(
  input: PIELearningInput,
  signals: PIELearningSignal[] = extractLearningSignals(input),
): PIELearningPatternUpdate[] {
  return [
    ...(input.patternIntelligence?.patternMatches || []).slice(0, 4).map((match, index) => ({
      id: `pattern-learning-${match.id || index}`,
      pattern: match.pattern.summary,
      confidenceChange: signals.some(signal => signal.source === 'prediction_failed' || signal.source === 'recommendation_rejected')
        ? 'decrease' as const
        : signals.some(signal => signal.source === 'recommendation_accepted' || signal.source === 'prediction_confirmed')
          ? 'increase' as const
          : 'hold' as const,
      reason: match.explanation,
      confidence: match.confidence,
    })),
    ...signals
      .filter(signal => signal.source === 'pattern_match')
      .map(signal => ({
        id: `pattern-learning-${signal.id}`,
        pattern: signal.signal,
        confidenceChange: signal.outcome === 'failed' ? 'decrease' as const : 'increase' as const,
        reason: signal.whatPIELearned,
        confidence: signal.confidence,
      })),
  ];
}

export function updateBeliefLearning(
  input: PIELearningInput,
  signals: PIELearningSignal[] = extractLearningSignals(input),
): PIELearningBeliefUpdate[] {
  const beliefs = input.beliefSystem?.beliefs || [];
  return beliefs.slice(0, 6).map((belief: PIEBelief, index) => ({
    id: `belief-learning-${belief.id || index}`,
    belief: belief.statement,
    confidenceChange:
      belief.readiness === 'Ready'
        ? 'increase'
        : signals.some(signal => signal.source === 'user_correction' || signal.source === 'prediction_failed')
          ? 'decrease'
          : 'hold',
    reason: belief.explanation.readinessReason,
    confidence: belief.confidence,
  }));
}

export function consolidateMemory(
  input: PIELearningInput,
  signals: PIELearningSignal[] = extractLearningSignals(input),
): PIELearningMemoryConsolidation[] {
  return signals.slice(0, 10).map(signal => ({
    id: `memory-${signal.id}`,
    influenceType: memoryInfluenceType(signal),
    summary: signal.whatPIELearned,
    influence: signal.futureBehavior,
    confidence: signal.confidence,
  }));
}

export function buildFutureAdjustment(
  input: PIELearningInput,
  context: {
    learningSignals?: PIELearningSignal[];
    confidenceCalibration?: PIELearningConfidenceCalibration[];
    memoryConsolidation?: PIELearningMemoryConsolidation[];
  } = {},
): string[] {
  const signals = context.learningSignals || extractLearningSignals(input);
  const calibration = context.confidenceCalibration || calibrateConfidence(input, signals);
  return Array.from(new Set([
    ...signals.map(signal => signal.futureBehavior),
    ...calibration.map(item => `${item.adjustment} confidence: ${item.reason}`),
    ...(context.memoryConsolidation || []).map(item => item.influence),
  ])).filter(Boolean).slice(0, 10);
}

export function summarizeLearning({
  learningSignals,
  lessonsLearned,
  futureAdjustments,
  confidenceCalibration,
}: {
  learningSignals: PIELearningSignal[];
  lessonsLearned: PIELearningLesson[];
  futureAdjustments: string[];
  confidenceCalibration: PIELearningConfidenceCalibration[];
}): string {
  if (learningSignals.length === 0) {
    return 'DAVE did not find a strong learning outcome yet.';
  }

  return [
    `DAVE learned from ${learningSignals.length} signal${learningSignals.length === 1 ? '' : 's'}.`,
    lessonsLearned[0]?.lesson,
    futureAdjustments[0],
    confidenceCalibration[0]?.reason,
  ].filter(Boolean).join(' ');
}

function buildLearningEvents(input: PIELearningInput): PIELearningEvent[] {
  const events: PIELearningEvent[] = [
    ...input.runtime.beliefChanges
      .filter(change => change.direction === 'corrected' || change.wasPIEWrong)
      .map(change => ({
        id: `event-correction-${change.id}`,
        source: 'user_correction' as const,
        event: change.reason,
        outcome: 'corrected' as const,
        evidence: [change.previousBelief, change.updatedBelief].filter(Boolean),
        confidence: input.runtime.reflectionConfidence,
      })),
    ...input.runtime.confidenceChanges
      .filter(change => /gps/i.test(change.source + change.reason))
      .map(change => ({
        id: `event-gps-${change.id}`,
        source: 'GPS_correction' as const,
        event: change.reason,
        outcome: 'corrected' as const,
        evidence: [change.source],
        confidence: change.updatedConfidence,
      })),
    input.reportDraft?.needsReview === false && input.reportDraft.reportReadiness === 'high'
      ? {
          id: 'event-report-approval',
          source: 'report_approval',
          event: 'Report draft was approved or ready without review flags.',
          outcome: 'approved',
          evidence: input.reportDraft.executiveSummary,
          confidence: input.reportDraft.confidence,
        }
      : null,
    input.reportDraft?.needsReview
      ? {
          id: 'event-report-edit',
          source: 'report_edit',
          event: input.reportDraft.reviewFlags[0] || 'Report needed edits before communication.',
          outcome: 'corrected',
          evidence: input.reportDraft.reviewFlags,
          confidence: input.reportDraft.confidence,
        }
      : null,
    input.predictionResult?.predictionConfidence === 'high' && input.predictionResult.noActionOutcome.riskLevel !== 'high'
      ? {
          id: 'event-prediction-confirmed',
          source: 'prediction_confirmed',
          event: input.predictionResult.mostLikelyOutcome.likelyOutcome,
          outcome: 'confirmed',
          evidence: input.predictionResult.explanation.evidence,
          confidence: input.predictionResult.predictionConfidence,
        }
      : null,
    input.predictionResult?.predictionConfidence === 'low'
      ? {
          id: 'event-prediction-failed',
          source: 'prediction_failed',
          event: input.predictionResult.explanation.uncertainty[0] || 'Prediction confidence was low.',
          outcome: 'failed',
          evidence: input.predictionResult.evidenceThatWouldImprovePrediction,
          confidence: input.predictionResult.predictionConfidence,
        }
      : null,
    ...input.runtime.lessonsLearned.map(lesson => ({
      id: `event-reflection-${lesson.id}`,
      source: 'reflection_lesson' as const,
      event: lesson.lesson,
      outcome: 'confirmed' as const,
      evidence: [lesson.whatPIEShouldDoDifferently],
      confidence: lesson.confidence,
    })),
    ...(input.patternIntelligence?.patternMatches || []).slice(0, 3).map(match => ({
      id: `event-pattern-${match.id}`,
      source: 'pattern_match' as const,
      event: match.explanation,
      outcome: match.pattern.outcome.outcome === 'failed' ? 'failed' as const : 'confirmed' as const,
      evidence: match.pattern.evidence.map(item => item.summary),
      confidence: match.confidence,
    })),
  ].filter((event): event is PIELearningEvent => Boolean(event));

  if (input.runtime.scheduleSummary.totalItems > 0) {
    events.push({
      id: 'event-schedule-change',
      source: 'schedule_change',
      event: input.runtime.intelligentSummary.scheduleStatus || 'Schedule evidence changed.',
      outcome: 'confirmed',
      evidence: [input.runtime.intelligentSummary.scheduleStatus],
      confidence: input.runtime.scheduleConfidence,
    });
  }

  if (input.runtime.photoProgress.acceptedEvidence.length > 0) {
    events.push({
      id: 'event-photo-evidence',
      source: 'photo_evidence',
      event: input.runtime.photoProgressSummary,
      outcome: 'confirmed',
      evidence: input.runtime.photoProgress.acceptedEvidence.map(item => item.summary),
      confidence: input.runtime.comparisonConfidence,
    });
  }

  return events;
}

function summarizeLessons(signals: PIELearningSignal[]): PIELearningLesson[] {
  return signals.slice(0, 8).map(signal => ({
    id: `lesson-${signal.id}`,
    lesson: signal.whatPIELearned,
    learnedFrom: signal.source,
    appliesToFuture: signal.futureBehavior,
    confidence: signal.confidence,
  }));
}

function buildRecommendationImprovements(
  input: PIELearningInput,
  signals: PIELearningSignal[],
): PIELearningRecommendationImprovement[] {
  return signals
    .filter(signal =>
      signal.source === 'recommendation_accepted' ||
      signal.source === 'recommendation_rejected' ||
      signal.source === 'reflection_lesson' ||
      signal.source === 'prediction_failed',
    )
    .slice(0, 6)
    .map(signal => ({
      id: `recommendation-improvement-${signal.id}`,
      recommendationPattern: signal.signal,
      worked: signal.outcome !== 'failed' && signal.outcome !== 'rejected',
      improvement: signal.futureBehavior,
      confidence: signal.confidence,
    }));
}

function buildAdjustments(
  input: PIELearningInput,
  signals: PIELearningSignal[],
  confidenceCalibration: PIELearningConfidenceCalibration[],
): PIELearningAdjustment[] {
  return [
    ...signals.slice(0, 8).map(signal => ({
      id: `adjustment-${signal.id}`,
      adjustment: signal.futureBehavior,
      reason: signal.whatPIELearned,
      appliesTo: adjustmentTarget(signal),
      confidence: signal.confidence,
    })),
    ...confidenceCalibration.slice(0, 4).map(item => ({
      id: `adjustment-${item.id}`,
      adjustment: `${item.adjustment} confidence`,
      reason: item.reason,
      appliesTo: item.source === 'GPS_correction' ? 'gps' as const : 'recommendation' as const,
      confidence: item.confidence,
    })),
  ];
}

function buildDecisionQualityLearning(
  input: PIELearningInput,
  signals: PIELearningSignal[],
): PIELearningDecisionQuality[] {
  return [
    input.predictionResult
      ? {
          id: 'decision-quality-prediction',
          signal: input.predictionResult.explanation.summary,
          decisionQualityLearning: input.predictionResult.explanation.doNotOverstate
            ? 'Prediction should be verified before it affects a major decision.'
            : 'Prediction had enough support to influence executive decision quality.',
          confidence: input.predictionResult.predictionConfidence,
        }
      : null,
    input.executiveReasoning
      ? {
          id: 'decision-quality-executive',
          signal: input.executiveReasoning.judgment.highestValueAction,
          decisionQualityLearning: `Executive readiness was ${input.executiveReasoning.executiveReadiness}.`,
          confidence: input.executiveReasoning.confidence,
        }
      : null,
    ...signals
      .filter(signal => signal.source === 'decision_outcome')
      .map(signal => ({
        id: `decision-quality-${signal.id}`,
        signal: signal.signal,
        decisionQualityLearning: signal.futureBehavior,
        confidence: signal.confidence,
      })),
  ].filter((item): item is PIELearningDecisionQuality => Boolean(item));
}

function memoryInfluenceType(signal: PIELearningSignal): PIELearningMemoryConsolidation['influenceType'] {
  if (signal.source === 'user_correction' || signal.source === 'GPS_correction') return 'user correction pattern';
  if (signal.source === 'report_approval' || signal.source === 'report_edit') return 'preference pattern';
  if (signal.source === 'prediction_failed' || signal.source === 'recommendation_rejected') return 'failed response';
  if (signal.source === 'prediction_confirmed' || signal.source === 'recommendation_accepted') return 'successful response';
  if (signal.source === 'pattern_match') return 'recurring issue';
  return 'future caution';
}

function adjustmentTarget(signal: PIELearningSignal): PIELearningAdjustment['appliesTo'] {
  if (signal.source === 'report_approval' || signal.source === 'report_edit') return 'report';
  if (signal.source === 'prediction_confirmed' || signal.source === 'prediction_failed') return 'prediction';
  if (signal.source === 'pattern_match') return 'pattern';
  if (signal.source === 'GPS_correction') return 'gps';
  if (signal.source === 'schedule_change') return 'schedule';
  if (signal.source === 'reflection_lesson') return 'memory';
  return 'recommendation';
}

function learningConfidence(
  signals: PIELearningSignal[],
  input: PIELearningInput,
): ProjectConfidenceLevel {
  if (signals.some(signal => signal.confidence === 'high')) return 'high';
  if (signals.length > 0) return 'medium';
  return input.runtime.overallConfidence === 'low' ? 'low' : 'medium';
}
