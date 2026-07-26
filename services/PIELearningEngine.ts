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
  provenanceRecordIds?: readonly string[];
};

export type PIELearningEvent = {
  id: string;
  source: PIELearningSource;
  event: string;
  outcome: PIELearningOutcome;
  evidence: string[];
  confidence: ProjectConfidenceLevel;
  provenanceRecordIds?: readonly string[];
};

export type PIEVerifiedLearningEvent = PIELearningEvent & {
  organizationId: string;
  projectId: string;
  verifiedAt: string;
  verifiedBy: string;
  verificationStatus: 'human_validated' | 'authority_approved';
  provenanceRecordIds: string[];
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
  organizationId?: string;
  projectId?: string;
  reflection?: PIEReflectionResult | null;
  beliefSystem?: PIEBeliefEngineResult | null;
  patternIntelligence?: PIEPatternIntelligence | null;
  predictionResult?: PIEPredictionResult | null;
  executiveReasoning?: PIEExecutiveReasoningResult | null;
  reportDraft?: PIEReportDraft | null;
  adaptiveIntelligence?: PIEAdaptiveResult | null;
  decisionMemory?: PIEDecisionMemoryResult | null;
  verifiedLearningEvents?: readonly PIEVerifiedLearningEvent[];
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
      provenanceRecordIds: event.provenanceRecordIds,
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
    provenanceRecordIds: event.provenanceRecordIds,
  }));
}

export function learnFromReportEdits(
  input: PIELearningInput,
  events: PIELearningEvent[] = buildLearningEvents(input),
): PIELearningSignal[] {
  return events
    .filter(event => event.source === 'report_edit')
    .map((event, index) => ({
      id: `learning-report-edit-${index + 1}`,
      source: 'report_edit',
      outcome: 'corrected',
      signal: event.event,
      whatPIELearned: 'The verified edit identifies wording or structure that should change in future drafts.',
      shouldTrustMore: ['verified user-edited report language', 'source evidence'],
      shouldTrustLess: ['the replaced draft wording'],
      futureBehavior: 'Apply the verified edit pattern while preserving human approval before communication.',
      confidence: event.confidence,
      provenanceRecordIds: event.provenanceRecordIds,
    }));
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
        : event.source === 'recommendation_accepted'
          ? 'The user accepted this recommendation, which is a preference signal but not proof that the outcome worked.'
          : 'A verified decision outcome can strengthen similar future patterns when evidence is comparable.',
      shouldTrustMore: event.outcome === 'rejected'
        ? ['user correction']
        : event.source === 'recommendation_accepted'
          ? ['the user preference represented by this acceptance']
          : ['similar evidence-backed decision outcomes'],
      shouldTrustLess: event.outcome === 'rejected' ? ['same recommendation pattern without new evidence'] : [],
      futureBehavior: event.outcome === 'rejected'
        ? 'Ask what would change the recommendation before repeating it.'
        : event.source === 'recommendation_accepted'
          ? 'Offer similar recommendations when relevant, but verify the actual outcome before learning that they work.'
          : 'Reuse the recommendation pattern when comparable evidence and a verified outcome are present.',
      confidence: event.confidence,
      provenanceRecordIds: event.provenanceRecordIds,
    }));
}

export function learnFromPredictionOutcome(
  input: PIELearningInput,
  events: PIELearningEvent[] = buildLearningEvents(input),
): PIELearningSignal[] {
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
      provenanceRecordIds: source.provenanceRecordIds,
    }];
  }

  return [];
}

export function learnFromReflection(
  input: PIELearningInput,
  events: PIELearningEvent[] = buildLearningEvents(input),
): PIELearningSignal[] {
  return [];
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
      .filter(signal => signal.source === 'prediction_confirmed')
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
      confidenceChange: signals.some(signal =>
        signalAppliesToPattern(signal, match) &&
        (signal.source === 'prediction_failed' || signal.source === 'recommendation_rejected')
      )
        ? 'decrease' as const
        : signals.some(signal =>
            signalAppliesToPattern(signal, match) &&
            (signal.source === 'prediction_confirmed' ||
              signal.source === 'decision_outcome' && signal.outcome === 'worked')
          )
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
      signals.some(signal =>
        signalAppliesToBelief(signal, belief) &&
        (signal.source === 'prediction_confirmed' ||
          signal.source === 'decision_outcome' && signal.outcome === 'worked')
      )
        ? 'increase'
        : signals.some(signal =>
            signalAppliesToBelief(signal, belief) &&
            (signal.source === 'user_correction' || signal.source === 'prediction_failed')
          )
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
  if ((input.verifiedLearningEvents || []).length > 0 && (!input.organizationId || !input.projectId)) {
    return [];
  }
  return (input.verifiedLearningEvents || [])
    .filter(isVerifiedLearningEvent)
    .filter(event =>
      event.organizationId === input.organizationId &&
      event.projectId === input.projectId
    )
    .map(event => Object.freeze({
      id: event.id.trim(),
      source: event.source,
      event: event.event.trim(),
      outcome: event.outcome,
      evidence: Object.freeze([...event.evidence]) as unknown as string[],
      confidence: event.confidence,
      provenanceRecordIds: Object.freeze([...event.provenanceRecordIds]),
    }));
}

export function isVerifiedLearningEvent(
  event: PIEVerifiedLearningEvent,
): boolean {
  if (
    !event ||
    !event.id?.trim() ||
    !event.event?.trim() ||
    !event.organizationId?.trim() ||
    !event.projectId?.trim() ||
    !event.verifiedBy?.trim() ||
    /\b(?:dave|system|automation|bot|service)\b/i.test(event.verifiedBy.trim()) ||
    (event.verificationStatus !== 'human_validated' && event.verificationStatus !== 'authority_approved') ||
    !validTimestamp(event.verifiedAt) ||
    !Array.isArray(event.evidence) ||
    event.evidence.filter(value => typeof value === 'string' && value.trim()).length === 0 ||
    !Array.isArray(event.provenanceRecordIds) ||
    event.provenanceRecordIds.filter(value => typeof value === 'string' && value.trim()).length === 0
  ) return false;

  const allowedOutcomes: Partial<Record<PIELearningSource, PIELearningOutcome[]>> = {
    user_correction: ['corrected'],
    GPS_correction: ['corrected'],
    report_approval: ['approved'],
    report_edit: ['corrected'],
    recommendation_accepted: ['approved'],
    recommendation_rejected: ['rejected'],
    prediction_confirmed: ['confirmed'],
    prediction_failed: ['failed'],
    decision_outcome: ['worked', 'failed', 'partially_worked'],
  };
  if (!allowedOutcomes[event.source]?.includes(event.outcome)) return false;
  return event.source === 'report_approval'
    ? event.verificationStatus === 'authority_approved'
    : event.verificationStatus === 'human_validated';
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
      signal.source === 'recommendation_rejected' ||
      signal.source === 'prediction_failed' ||
      signal.source === 'decision_outcome',
    )
    .slice(0, 6)
    .map(signal => ({
      id: `recommendation-improvement-${signal.id}`,
      recommendationPattern: signal.signal,
      worked: signal.outcome === 'worked' || signal.outcome === 'confirmed',
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
  return signals
    .filter(signal => signal.source === 'decision_outcome')
    .map(signal => ({
      id: `decision-quality-${signal.id}`,
      signal: signal.signal,
      decisionQualityLearning: signal.futureBehavior,
      confidence: signal.confidence,
    }));
}

function memoryInfluenceType(signal: PIELearningSignal): PIELearningMemoryConsolidation['influenceType'] {
  if (signal.source === 'user_correction' || signal.source === 'GPS_correction') return 'user correction pattern';
  if (signal.source === 'report_approval' || signal.source === 'report_edit' || signal.source === 'recommendation_accepted') return 'preference pattern';
  if (signal.source === 'prediction_failed' || signal.source === 'recommendation_rejected') return 'failed response';
  if (signal.source === 'prediction_confirmed' || signal.source === 'decision_outcome' && signal.outcome === 'worked') return 'successful response';
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
  return 'low';
}

function validTimestamp(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(new Date(value).getTime());
}

function signalAppliesToPattern(
  signal: PIELearningSignal,
  match: PIEPatternIntelligence['patternMatches'][number],
) {
  const provenance = new Set(signal.provenanceRecordIds || []);
  if (provenance.size === 0) return false;
  return [
    match.id,
    match.pattern.id,
    ...match.pattern.evidence.map(item => item.id),
  ].some(id => provenance.has(id));
}

function signalAppliesToBelief(signal: PIELearningSignal, belief: PIEBelief) {
  const provenance = new Set(signal.provenanceRecordIds || []);
  if (provenance.size === 0) return false;
  return [
    belief.id,
    ...(belief.supportingEvidence || []).map(item => item.id),
    ...(belief.contradictingEvidence || []).map(item => item.id),
  ].some(id => provenance.has(id));
}
