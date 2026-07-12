import type {
  PIEBelief,
  PIETrustScore,
  PIEUnderstandingScore,
} from './PIERuntime';
import type {
  PIEEvidenceFusionSummary,
  PIEIntelligentSummary,
  PIEvidenceGap,
} from './PIEEvidenceFusion';
import type { PIEPhotoProgressResult } from './PIEPhotoProgress';
import type { PIEReportDraft } from './PIEReporter';
import type { PIEScheduleIntelligence } from './PIEScheduleIntelligence';
import type { PIEMemoryRecallResult } from './PIEMemoryRecall';
import type { PIELearningSignal } from './PIELearningEngine';
import type { PIEDecisionOutcome } from './PIEScientificMethod';
import type { PIEAdaptiveLesson, PIEAdaptivePolicy } from './PIEAdaptiveIntelligence';
import type { PIEExecutiveWisdomLesson, PIEWhenNotToActReason } from './PIEDecisionMemory';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEReflectionEvent =
  | 'schedule_import'
  | 'accepted_photo'
  | 'accepted_note'
  | 'gps_correction'
  | 'project_correction'
  | 'area_correction'
  | 'report_approval'
  | 'walk_completion'
  | 'daily_reflection';

export type PIELessonLearned = {
  id: string;
  event: PIEReflectionEvent;
  lesson: string;
  whatPIEShouldDoDifferently: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEBeliefChange = {
  id: string;
  beliefId: string;
  previousBelief: string;
  updatedBelief: string;
  direction: 'strengthened' | 'weakened' | 'unchanged' | 'corrected';
  wasPIEWrong: boolean;
  wasPIECorrect: boolean;
  reason: string;
  verificationNeeded: string | null;
};

export type PIEConfidenceChange = {
  id: string;
  source: string;
  previousConfidence: ProjectConfidenceLevel;
  updatedConfidence: ProjectConfidenceLevel;
  direction: 'increased' | 'decreased' | 'unchanged';
  reason: string;
};

export type PIERecommendationImprovement = {
  id: string;
  recommendation: string;
  reason: string;
  recommendedNextEvidence: string;
};

export type PIEReflectionSummary = {
  summary: string;
  whatChanged: string[];
  previousBeliefs: string[];
  beliefsStrengthened: string[];
  beliefsWeakened: string[];
  outstandingUnknowns: string[];
  recommendedEvidence: string[];
  reflectionConfidence: ProjectConfidenceLevel;
};

export type PIEReflection = {
  id: string;
  generatedAt: string;
  event: PIEReflectionEvent;
  reflectionSummary: PIEReflectionSummary;
  lessonsLearned: PIELessonLearned[];
  beliefChanges: PIEBeliefChange[];
  confidenceChanges: PIEConfidenceChange[];
  recommendationImprovements: PIERecommendationImprovement[];
  learningSignals: PIELearningSignal[];
  updatedBeliefs: PIEBelief[];
};

export type PIEReflectionFinding = {
  id: string;
  title: string;
  summary: string;
  evidence: string[];
  confidence: ProjectConfidenceLevel;
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
};

export type PIEReflectionQuestion = {
  id: string;
  question: string;
  reason: string;
  evidence: string[];
  confidence: ProjectConfidenceLevel;
  priority: 'low' | 'medium' | 'high' | 'critical';
};

export type PIEReflectionGap = {
  id: string;
  title: string;
  summary: string;
  evidence: string[];
  suggestedAction: string;
  confidence: ProjectConfidenceLevel;
  priority: 'low' | 'medium' | 'high' | 'critical';
  missingEvidenceType: 'document' | 'photo' | 'update' | 'schedule' | 'gps' | 'report';
};

export type PIEReflectionRisk = {
  id: string;
  title: string;
  risk: string;
  summary: string;
  evidence: string[];
  suggestedAction: string;
  suggestedVerification: string;
  confidence: ProjectConfidenceLevel;
  priority: 'low' | 'medium' | 'high' | 'critical';
};

export type PIEReflectionResult = PIEReflection & {
  findings: PIEReflectionFinding[];
  verificationQuestions: PIEReflectionQuestion[];
  gaps: PIEReflectionGap[];
  risks: PIEReflectionRisk[];
  whatPIEShouldVerifyFirst: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical';
  reflectionLevel: ProjectConfidenceLevel;
  evidenceAudit: {
    level: ProjectConfidenceLevel;
    summary: string;
  };
};

export type PIEReflectionInput = {
  event?: PIEReflectionEvent;
  generatedAt?: string;
  projectName: string;
  currentBeliefs: PIEBelief[];
  evidenceFusionSummary: PIEEvidenceFusionSummary;
  intelligentSummary: PIEIntelligentSummary;
  evidenceGaps: PIEvidenceGap[];
  scheduleIntelligence: PIEScheduleIntelligence;
  photoProgress: PIEPhotoProgressResult;
  trustScore: PIETrustScore;
  understandingScore: PIEUnderstandingScore;
  overallConfidence: ProjectConfidenceLevel;
  reportDraft?: PIEReportDraft | null;
  memoryRecall?: PIEMemoryRecallResult | null;
  decisionOutcomes?: PIEDecisionOutcome[];
  adaptiveLessons?: PIEAdaptiveLesson[];
  adaptivePolicies?: PIEAdaptivePolicy[];
  wisdomLessons?: PIEExecutiveWisdomLesson[];
  whenNotToActReasons?: PIEWhenNotToActReason[];
};

export const PIE_REFLECTION_QUESTIONS = [
  'What changed?',
  'What did DAVE previously believe?',
  'Did new evidence strengthen or weaken that belief?',
  'Was DAVE wrong?',
  'Was DAVE correct?',
  'What still needs verification?',
  'What should DAVE do differently next time?',
] as const;

export function buildPIEReflection(
  input: PIEReflectionInput,
): PIEReflectionResult {
  const event = input.event || inferReflectionEvent(input);
  const generatedAt = input.generatedAt || new Date().toISOString();
  const beliefChanges = buildBeliefChanges(input, event);
  const confidenceChanges = buildConfidenceChanges(input);
  const lessonsLearned = buildLessonsLearned(input, event, beliefChanges);
  const recommendationImprovements = buildRecommendationImprovements(input);
  const learningSignals = buildReflectionLearningSignals(
    lessonsLearned,
    beliefChanges,
    confidenceChanges,
    recommendationImprovements,
  );
  const reflectionSummary = buildReflectionSummary(
    input,
    beliefChanges,
    confidenceChanges,
    recommendationImprovements,
  );

  const findings = buildReflectionFindings(beliefChanges, confidenceChanges);
  const gaps = buildReflectionGaps(input);
  const verificationQuestions = buildVerificationQuestions(beliefChanges, gaps);
  const risks = buildReflectionRisks(input, beliefChanges);

  return {
    id: `reflection-${slug(input.projectName)}-${Date.parse(generatedAt) || Date.now()}`,
    generatedAt,
    event,
    reflectionSummary,
    lessonsLearned,
    beliefChanges,
    confidenceChanges,
    recommendationImprovements,
    learningSignals,
    updatedBeliefs: prepareUpdatedBeliefs(input.currentBeliefs, beliefChanges),
    findings,
    verificationQuestions,
    gaps,
    risks,
    whatPIEShouldVerifyFirst:
      verificationQuestions[0]?.question ||
      gaps[0]?.suggestedAction ||
      null,
    priority: risks.some(risk => risk.priority === 'critical' || risk.priority === 'high')
      ? 'high'
      : gaps.length > 0
        ? 'medium'
        : 'low',
    reflectionLevel: reflectionSummary.reflectionConfidence,
    evidenceAudit: {
      level: reflectionSummary.reflectionConfidence,
      summary: reflectionSummary.summary,
    },
  };
}

function buildReflectionLearningSignals(
  lessonsLearned: PIELessonLearned[],
  beliefChanges: PIEBeliefChange[],
  confidenceChanges: PIEConfidenceChange[],
  recommendationImprovements: PIERecommendationImprovement[],
): PIELearningSignal[] {
  return [
    ...lessonsLearned.slice(0, 4).map(lesson => ({
      id: `reflection-learning-${lesson.id}`,
      source: 'reflection_lesson' as const,
      outcome: 'confirmed' as const,
      signal: lesson.lesson,
      whatPIELearned: lesson.lesson,
      shouldTrustMore: ['reflection lesson', 'current evidence'],
      shouldTrustLess: lesson.whatPIEShouldDoDifferently ? ['previous behavior before this reflection'] : [],
      futureBehavior: lesson.whatPIEShouldDoDifferently || 'Apply this reflection when similar evidence appears.',
      confidence: lesson.confidence,
    })),
    ...beliefChanges
      .filter(change => change.wasPIEWrong || change.direction === 'corrected' || change.direction === 'weakened')
      .slice(0, 3)
      .map(change => ({
        id: `reflection-learning-belief-${change.id}`,
        source: change.wasPIEWrong ? 'user_correction' as const : 'reflection_lesson' as const,
        outcome: change.wasPIEWrong ? 'corrected' as const : 'partially_worked' as const,
        signal: change.reason,
        whatPIELearned: `Belief changed from "${change.previousBelief}" to "${change.updatedBelief}".`,
        shouldTrustMore: change.wasPIECorrect ? ['supporting evidence'] : ['verification evidence'],
        shouldTrustLess: change.wasPIEWrong ? ['unsupported belief'] : [],
        futureBehavior: change.verificationNeeded || 'Verify similar beliefs before recommending action.',
        confidence: 'medium' as const,
      })),
    ...confidenceChanges
      .filter(change => change.direction === 'decreased')
      .slice(0, 2)
      .map(change => ({
        id: `reflection-learning-confidence-${change.id}`,
        source: 'reflection_lesson' as const,
        outcome: 'corrected' as const,
        signal: change.reason,
        whatPIELearned: `Confidence for ${change.source} should be calibrated down when this pattern repeats.`,
        shouldTrustMore: ['fresh evidence'],
        shouldTrustLess: [change.source],
        futureBehavior: `Lower confidence for ${change.source} until verified.`,
        confidence: change.updatedConfidence,
      })),
    ...recommendationImprovements.slice(0, 2).map(improvement => ({
      id: `reflection-learning-recommendation-${improvement.id}`,
      source: 'reflection_lesson' as const,
      outcome: 'confirmed' as const,
      signal: improvement.recommendation,
      whatPIELearned: improvement.reason,
      shouldTrustMore: ['recommendation improvement'],
      shouldTrustLess: [],
      futureBehavior: improvement.recommendedNextEvidence,
      confidence: 'medium' as const,
    })),
  ];
}

export function buildDailyReflection(
  input: Omit<PIEReflectionInput, 'event'>,
): PIEReflectionResult {
  return buildPIEReflection({
    ...input,
    event: 'daily_reflection',
  });
}

export function inferReflectionEvent(
  input: PIEReflectionInput,
): PIEReflectionEvent {
  if (input.reportDraft?.needsReview === false && input.reportDraft?.confidence === 'high') {
    return 'report_approval';
  }

  if (input.photoProgress.acceptedEvidence.length > 0) return 'accepted_photo';
  if (input.photoProgress.lastComparison) return 'accepted_photo';
  if (input.scheduleIntelligence.scheduleSummary.totalItems > 0) {
    return 'schedule_import';
  }
  if (input.evidenceFusionSummary.gpsAvailable) return 'gps_correction';

  return 'daily_reflection';
}

function buildBeliefChanges(
  input: PIEReflectionInput,
  event: PIEReflectionEvent,
): PIEBeliefChange[] {
  const firstGap = input.evidenceGaps[0];
  const scheduleLoaded = input.scheduleIntelligence.scheduleSummary.totalItems > 0;
  const photoAccepted = input.photoProgress.acceptedEvidence.length > 0;
  const trustImproved =
    input.trustScore.level !== 'low' &&
    input.evidenceFusionSummary.sourceCount > 1;
  const beliefs = input.currentBeliefs.slice(0, 6);

  return beliefs.map((belief, index) => {
    const weakened =
      Boolean(firstGap) ||
      belief.status === 'uncertain' ||
      belief.status === 'contested';
    const strengthened =
      !weakened &&
      (scheduleLoaded || photoAccepted || trustImproved);
    const direction = weakened
      ? 'weakened'
      : strengthened
        ? 'strengthened'
        : 'unchanged';

    return {
      id: `belief-change-${index}`,
      beliefId: belief.id,
      previousBelief: belief.statement,
      updatedBelief: strengthened
        ? `${belief.statement} This belief is better supported after ${event.replace(/_/g, ' ')}.`
        : weakened
          ? `${belief.statement} This belief needs verification before DAVE relies on it.`
          : belief.statement,
      direction,
      wasPIEWrong: direction === 'weakened' && belief.status === 'contested',
      wasPIECorrect: direction === 'strengthened',
      reason: strengthened
        ? 'New evidence aligns with existing DAVE understanding.'
        : weakened
          ? firstGap?.summary || 'New evidence exposed uncertainty in the current belief.'
          : 'New evidence did not materially change this belief.',
      verificationNeeded: weakened
        ? firstGap?.suggestedAction || 'Collect confirming evidence before acting on this belief.'
        : null,
    };
  });
}

function buildConfidenceChanges(
  input: PIEReflectionInput,
): PIEConfidenceChange[] {
  const trustDirection = compareConfidence(
    input.overallConfidence,
    input.trustScore.level,
  );
  const understandingDirection = compareConfidence(
    input.overallConfidence,
    input.understandingScore.level,
  );
  const reportConfidence = input.reportDraft?.confidence || input.overallConfidence;

  return [
    {
      id: 'confidence-trust',
      source: 'Trust Score',
      previousConfidence: input.overallConfidence,
      updatedConfidence: input.trustScore.level,
      direction: trustDirection,
      reason: input.trustScore.reasons[0] || 'Trust was recalculated after new evidence.',
    },
    {
      id: 'confidence-understanding',
      source: 'Understanding Score',
      previousConfidence: input.overallConfidence,
      updatedConfidence: input.understandingScore.level,
      direction: understandingDirection,
      reason: input.understandingScore.improvementSuggestions[0] ||
        'Understanding was recalculated from evidence gaps and coverage.',
    },
    {
      id: 'confidence-report',
      source: 'Reporter',
      previousConfidence: input.overallConfidence,
      updatedConfidence: reportConfidence,
      direction: compareConfidence(input.overallConfidence, reportConfidence),
      reason: input.reportDraft?.reviewFlags[0] ||
        'Reporter confidence reflects whether the current evidence is communication-ready.',
    },
  ];
}

function buildLessonsLearned(
  input: PIEReflectionInput,
  event: PIEReflectionEvent,
  beliefChanges: PIEBeliefChange[],
): PIELessonLearned[] {
  const weakened = beliefChanges.filter(item => item.direction === 'weakened');
  const missingEvidence = input.evidenceGaps[0]?.suggestedAction;
  const lessons: PIELessonLearned[] = [];

  if (weakened.length > 0 || missingEvidence) {
    lessons.push({
      id: 'lesson-verify-before-recommend',
      event,
      lesson: 'New evidence exposed at least one belief that needs verification.',
      whatPIEShouldDoDifferently:
        missingEvidence || 'Ask for confirming evidence before prioritizing this recommendation again.',
      confidence: 'medium',
    });
  }

  if (input.photoProgress.comparisonNeedsReview) {
    lessons.push({
      id: 'lesson-photo-progress-review',
      event,
      lesson: 'Photo progress is useful but still needs user verification.',
      whatPIEShouldDoDifferently:
        'Prioritize a review prompt before using visual progress as project evidence.',
      confidence: input.photoProgress.comparisonConfidence,
    });
  }

  if (input.reportDraft?.needsReview) {
    lessons.push({
      id: 'lesson-report-review',
      event,
      lesson: 'Report readiness depends on resolving review flags first.',
      whatPIEShouldDoDifferently:
        input.reportDraft.reviewFlags[0] || 'Ask for the missing report evidence before communication.',
      confidence: input.reportDraft.confidence,
    });
  }

  if (input.memoryRecall?.memoryInfluences.length) {
    const influence = input.memoryRecall.memoryInfluences[0];
    lessons.push({
      id: `lesson-memory-${influence.id}`,
      event,
      lesson: `Past memory should influence DAVE interpretation: ${influence.summary}`,
      whatPIEShouldDoDifferently:
        influence.influence || 'Compare new evidence against past memory before recommending action.',
      confidence: influence.confidence,
    });
  }

  if (input.memoryRecall?.pastCorrections.some(correction => correction.confidenceAdjustment === 'lower')) {
    lessons.push({
      id: 'lesson-user-correction-confidence',
      event,
      lesson: 'User corrections indicate DAVE should be careful with similar future assumptions.',
      whatPIEShouldDoDifferently:
        'Lower confidence and ask for verification when similar GPS, project, area, report, or recommendation context appears again.',
      confidence: 'high',
    });
  }

  if (input.decisionOutcomes?.length) {
    const failedOutcome = input.decisionOutcomes.find(outcome =>
      outcome.qualitySignal === 'failed' || outcome.qualitySignal === 'partially_worked',
    );
    lessons.push({
      id: 'lesson-decision-outcome',
      event,
      lesson: failedOutcome
        ? `A past decision outcome was ${failedOutcome.qualitySignal}; DAVE should adjust future recommendations.`
        : 'Decision outcomes are available for future learning.',
      whatPIEShouldDoDifferently: failedOutcome
        ? `Re-check assumptions behind ${failedOutcome.decision} before recommending similar action.`
        : 'Use outcome evidence to improve future hypothesis testing and decision quality scoring.',
      confidence: failedOutcome ? 'high' : 'medium',
    });
  }

  if (lessons.length === 0) {
    lessons.push({
      id: 'lesson-understanding-stable',
      event,
      lesson: 'New evidence did not weaken DAVE understanding.',
      whatPIEShouldDoDifferently:
        'Continue using the same evidence pattern while watching for stale or missing inputs.',
      confidence: input.overallConfidence,
    });
  }

  return lessons;
}

function buildRecommendationImprovements(
  input: PIEReflectionInput,
): PIERecommendationImprovement[] {
  const evidence = [
    ...recommendedEvidenceFromInput(input),
    ...(input.memoryRecall?.memoryInfluences
      .filter(influence => influence.appliesTo === 'recommendation')
      .map(influence => influence.influence) || []),
  ];

  return evidence.map((item, index) => ({
    id: `reflection-recommendation-${index}`,
    recommendation: `Collect ${item.toLowerCase()}.`,
    reason: 'Reflection identified this as the next evidence that would strengthen DAVE understanding.',
    recommendedNextEvidence: item,
  }));
}

function buildReflectionSummary(
  input: PIEReflectionInput,
  beliefChanges: PIEBeliefChange[],
  confidenceChanges: PIEConfidenceChange[],
  improvements: PIERecommendationImprovement[],
): PIEReflectionSummary {
  const strengthened = beliefChanges
    .filter(item => item.direction === 'strengthened')
    .map(item => item.updatedBelief);
  const weakened = beliefChanges
    .filter(item => item.direction === 'weakened')
    .map(item => item.previousBelief);
  const recommendedEvidence = improvements.map(item => item.recommendedNextEvidence);
  const decreased = confidenceChanges.some(item => item.direction === 'decreased');
  const increased = confidenceChanges.some(item => item.direction === 'increased');

  return {
    summary: decreased
      ? 'Reflection found weaker confidence and recommends verification before DAVE acts.'
      : increased
        ? 'Reflection found stronger evidence support for DAVE understanding.'
        : 'Reflection found DAVE understanding mostly stable after new evidence.',
    whatChanged: [
      input.intelligentSummary.whatChanged,
      input.photoProgress.photoProgressSummary,
      input.scheduleIntelligence.executiveSummary,
    ].filter(Boolean).slice(0, 4),
    previousBeliefs: input.currentBeliefs.slice(0, 4).map(item => item.statement),
    beliefsStrengthened: strengthened,
    beliefsWeakened: weakened,
    outstandingUnknowns: input.evidenceGaps.map(item => item.summary).slice(0, 6),
    recommendedEvidence,
    reflectionConfidence: decreased
      ? 'medium'
      : input.evidenceGaps.length > 2
        ? 'low'
        : input.overallConfidence,
  };
}

function prepareUpdatedBeliefs(
  beliefs: PIEBelief[],
  changes: PIEBeliefChange[],
): PIEBelief[] {
  const byId = new Map(changes.map(change => [change.beliefId, change]));

  return beliefs.map(belief => {
    const change = byId.get(belief.id);
    if (!change) return belief;

    return {
      ...belief,
      statement: change.updatedBelief,
      status: change.direction === 'weakened' ? 'uncertain' : belief.status,
      confidence: change.direction === 'strengthened' ? 'high' : belief.confidence,
    };
  });
}

function buildReflectionFindings(
  beliefChanges: PIEBeliefChange[],
  confidenceChanges: PIEConfidenceChange[],
): PIEReflectionFinding[] {
  return [
    ...beliefChanges.slice(0, 4).map((change, index) => ({
      id: `reflection-finding-belief-${index}`,
      title: change.direction === 'weakened' ? 'Belief Needs Verification' : 'Belief Strengthened',
      summary: change.reason,
      evidence: [change.previousBelief, change.updatedBelief],
      confidence: change.direction === 'weakened' ? 'medium' as const : 'high' as const,
      priority: change.direction === 'weakened' ? 'high' as const : 'medium' as const,
      createdAt: new Date().toISOString(),
    })),
    ...confidenceChanges
      .filter(change => change.direction !== 'unchanged')
      .slice(0, 2)
      .map((change, index) => ({
        id: `reflection-finding-confidence-${index}`,
        title: 'Confidence Changed',
        summary: `${change.source} confidence ${change.direction}.`,
        evidence: [change.reason],
        confidence: change.updatedConfidence,
        priority: change.direction === 'decreased' ? 'high' as const : 'medium' as const,
        createdAt: new Date().toISOString(),
      })),
  ];
}

function buildReflectionGaps(input: PIEReflectionInput): PIEReflectionGap[] {
  return [
    ...input.evidenceGaps.slice(0, 4).map((gap, index) => ({
      id: `reflection-gap-${index}`,
      title: 'Reflection Evidence Gap',
      summary: gap.summary,
      evidence: [gap.summary],
      suggestedAction: gap.suggestedAction,
      confidence: gap.confidence,
      priority: gap.severity === 'high' || gap.severity === 'critical'
        ? 'high' as const
        : 'medium' as const,
      missingEvidenceType: evidenceTypeFromText(`${gap.summary} ${gap.suggestedAction}`),
    })),
    ...recommendedEvidenceFromInput(input).slice(0, 2).map((item, index) => ({
      id: `reflection-gap-recommended-${index}`,
      title: 'Recommended Evidence',
      summary: `DAVE needs ${item.toLowerCase()} to improve confidence.`,
      evidence: [item],
      suggestedAction: item,
      confidence: input.overallConfidence,
      priority: 'medium' as const,
      missingEvidenceType: evidenceTypeFromText(item),
    })),
  ];
}

function buildVerificationQuestions(
  beliefChanges: PIEBeliefChange[],
  gaps: PIEReflectionGap[],
): PIEReflectionQuestion[] {
  const weakened = beliefChanges.filter(change => change.direction === 'weakened');

  return [
    ...weakened.slice(0, 3).map((change, index) => ({
      id: `reflection-question-belief-${index}`,
      question: change.verificationNeeded || 'What evidence verifies this belief?',
      reason: change.reason,
      evidence: [change.previousBelief],
      confidence: 'medium' as const,
      priority: 'high' as const,
    })),
    ...gaps.slice(0, 2).map((gap, index) => ({
      id: `reflection-question-gap-${index}`,
      question: gap.suggestedAction,
      reason: gap.summary,
      evidence: [gap.summary],
      confidence: gap.confidence,
      priority: gap.priority,
    })),
  ];
}

function buildReflectionRisks(
  input: PIEReflectionInput,
  beliefChanges: PIEBeliefChange[],
): PIEReflectionRisk[] {
  const weakened = beliefChanges.filter(change => change.direction === 'weakened');

  return [
    ...weakened.slice(0, 3).map((change, index) => ({
      id: `reflection-risk-belief-${index}`,
      title: 'Weakened Belief',
      risk: change.reason,
      summary: change.reason,
      evidence: [change.previousBelief],
      suggestedAction: change.verificationNeeded || 'Verify weakened belief before acting.',
      suggestedVerification: change.verificationNeeded || 'Verify weakened belief before acting.',
      confidence: 'medium' as const,
      priority: 'high' as const,
    })),
    ...(input.reportDraft?.needsReview
      ? [{
          id: 'reflection-risk-report-review',
          title: 'Report Review Required',
          risk: 'Report has review flags that may weaken communication confidence.',
          summary: 'Report has review flags that may weaken communication confidence.',
          evidence: input.reportDraft.reviewFlags,
          suggestedAction: input.reportDraft.reviewFlags[0] || 'Resolve report review flags.',
          suggestedVerification: input.reportDraft.reviewFlags[0] || 'Resolve report review flags.',
          confidence: input.reportDraft.confidence,
          priority: 'medium' as const,
        }]
      : []),
  ];
}

function recommendedEvidenceFromInput(input: PIEReflectionInput) {
  const recommendations = [
    ...input.evidenceGaps.map(item => item.suggestedAction),
    input.photoProgress.comparisonNeedsReview
      ? 'Verified photo progress summary'
      : null,
    input.scheduleIntelligence.scheduleSummary.totalItems === 0
      ? 'Current project schedule'
      : null,
    input.reportDraft?.needsReview
      ? input.reportDraft.reviewFlags[0] || 'Resolved report review flags'
      : null,
  ].filter((item): item is string => Boolean(item?.trim()));

  return Array.from(new Set(recommendations)).slice(0, 6);
}

function compareConfidence(
  previous: ProjectConfidenceLevel,
  updated: ProjectConfidenceLevel,
): PIEConfidenceChange['direction'] {
  const score = { low: 1, medium: 2, high: 3 };
  if (score[updated] > score[previous]) return 'increased';
  if (score[updated] < score[previous]) return 'decreased';

  return 'unchanged';
}

function evidenceTypeFromText(value: string): PIEReflectionGap['missingEvidenceType'] {
  if (/photo|image|visual/i.test(value)) return 'photo';
  if (/schedule|milestone|critical|due/i.test(value)) return 'schedule';
  if (/gps|location|area/i.test(value)) return 'gps';
  if (/report|approval|communication/i.test(value)) return 'report';
  if (/document|inspection|permit/i.test(value)) return 'document';

  return 'update';
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
