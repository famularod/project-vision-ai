import type {
  ProjectUpdate,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import type {
  PIECoreOutput,
  PIEOpinion,
  PIERecommendation as PIECoreRecommendation,
} from './PIECoreIntelligence';
import type { PIELearningResult } from './PIELearningEngine';
import type { PIELessonLearned } from './PIEReflectionEngine';
import type { PIEAdaptiveResult } from './PIEAdaptiveIntelligence';
import type { PIEDecisionMemoryResult } from './PIEDecisionMemory';
import type {
  PIEBelief,
  PIERecommendation,
} from './PIERuntime';
import type {
  ProjectEvent,
} from './ProjectEventService';
import type {
  ProjectConfidenceLevel,
  ProjectReportHistoryMetadata,
} from './ProjectIntelligenceEngine';

export type PIEMemoryConfidence = ProjectConfidenceLevel;

export type PIEMemoryRecallSource =
  | 'project_event'
  | 'update'
  | 'photo'
  | 'schedule_item'
  | 'recommendation'
  | 'report_history'
  | 'user_correction'
  | 'reflection_lesson'
  | 'learning_signal'
  | 'core_belief'
  | 'core_opinion';

export type PIERelevantMemory = {
  id: string;
  source: PIEMemoryRecallSource;
  dateTime: string | null;
  project: string | null;
  area: string | null;
  summary: string;
  whyRelevant: string;
  confidence: PIEMemoryConfidence;
  influence: string;
};

export type PIEMemoryPattern = {
  id: string;
  pattern: string;
  summary: string;
  frequency: number;
  relatedMemoryIds: string[];
  confidence: PIEMemoryConfidence;
};

export type PIEMemoryComparison = {
  id: string;
  question:
    | 'seen_before'
    | 'recurring'
    | 'different_from_last_time'
    | 'previous_recommendation_worked'
    | 'user_corrected_similar_item'
    | 'matches_or_contradicts_past'
    | 'last_condition_outcome'
    | 'history_caution';
  summary: string;
  relatedMemoryIds: string[];
  confidence: PIEMemoryConfidence;
};

export type PIEPastLesson = {
  id: string;
  lesson: string;
  event: string;
  shouldDoDifferently: string;
  confidence: PIEMemoryConfidence;
};

export type PIEPastRecommendation = {
  id: string;
  recommendation: string;
  suggestedNextAction: string;
  project: string | null;
  area: string | null;
  confidence: PIEMemoryConfidence;
};

export type PIEPastCorrection = {
  id: string;
  correctionType: 'gps' | 'project' | 'area' | 'recommendation' | 'report' | 'other';
  project: string | null;
  area: string | null;
  summary: string;
  confidenceAdjustment: 'lower' | 'raise' | 'hold';
  confidence: PIEMemoryConfidence;
};

export type PIEMemoryInfluence = {
  id: string;
  appliesTo:
    | 'interpretation'
    | 'belief'
    | 'opinion'
    | 'recommendation'
    | 'explanation'
    | 'attention'
    | 'experience'
    | 'report';
  summary: string;
  influence: string;
  confidence: PIEMemoryConfidence;
  relatedMemoryIds: string[];
};

export type PIEMemoryRecallInput = {
  projectName?: string | null;
  areaName?: string | null;
  newEvidenceSummary?: string | null;
  newEvidenceType?: string | null;
  currentUpdate?: ProjectUpdate | null;
  pastEvents?: ProjectEvent[];
  pastUpdates?: ProjectUpdate[];
  pastPhotos?: UpdatePhoto[];
  pastScheduleItems?: ScheduleItem[];
  pastRecommendations?: Array<PIERecommendation | PIECoreRecommendation>;
  reportHistory?: ProjectReportHistoryMetadata[];
  pastCorrections?: PIEPastCorrection[];
  pastLessons?: PIELessonLearned[];
  pastBeliefs?: Array<PIEBelief | PIECoreOutput['beliefs'][number]>;
  pastOpinions?: PIEOpinion[];
  coreIntelligence?: PIECoreOutput | null;
  learningResult?: PIELearningResult | null;
  adaptiveIntelligence?: PIEAdaptiveResult | null;
  decisionMemory?: PIEDecisionMemoryResult | null;
  now?: Date;
};

export type PIEMemoryRecallResult = {
  generatedAt: string;
  projectName: string | null;
  areaName: string | null;
  memories: PIERelevantMemory[];
  similarPastSituations: PIERelevantMemory[];
  relatedBeliefs: PIERelevantMemory[];
  patterns: PIEMemoryPattern[];
  comparisons: PIEMemoryComparison[];
  pastLessons: PIEPastLesson[];
  pastRecommendations: PIEPastRecommendation[];
  pastCorrections: PIEPastCorrection[];
  memoryInfluences: PIEMemoryInfluence[];
  summaryForPIE: string;
  confidence: PIEMemoryConfidence;
};

export const PIE_MEMORY_RECALL_QUESTIONS = [
  'Have we seen this before?',
  'Is this recurring?',
  'Is this different from last time?',
  'Did a previous recommendation work?',
  'Did the user correct DAVE on something similar?',
  'Does this match or contradict past evidence?',
  'What happened the last time this condition existed?',
  'What should DAVE be careful about based on history?',
] as const;

export function buildPIEMemoryRecall(
  input: PIEMemoryRecallInput,
): PIEMemoryRecallResult {
  const generatedAt = (input.now || new Date()).toISOString();
  const memories = dedupeMemories([
    ...findRelevantPastEvents(input),
    ...findRelevantPastUpdates(input),
    ...findRelevantPastPhotos(input),
    ...findRelevantPastScheduleItems(input),
    ...findRelevantPastRecommendations(input).map(recommendationToMemory),
    ...findRelevantCorrections(input).map(correctionToMemory),
    ...findRelevantLessons(input).map(lessonToMemory),
    ...findRelevantLearning(input),
    ...findRelevantBeliefsAndOpinions(input),
    ...findRelevantReportHistory(input),
  ]);
  const comparisons = compareNewEvidenceToPast(input, memories);
  const patterns = buildRecurringPatterns(memories, comparisons);
  const similarPastSituations = memories
    .filter(memory =>
      memory.source === 'project_event' ||
      memory.source === 'update' ||
      memory.source === 'photo' ||
      memory.source === 'schedule_item' ||
      memory.source === 'report_history' ||
      memory.source === 'core_belief',
    )
    .slice(0, 8);
  const relatedBeliefs = memories.filter(memory => memory.source === 'core_belief').slice(0, 8);
  const memoryInfluences = buildMemoryInfluences({
    ...input,
    memories,
    comparisons,
    patterns,
  });

  return {
    generatedAt,
    projectName: input.projectName || input.currentUpdate?.projectName || null,
    areaName: input.areaName || input.currentUpdate?.selectedAreaName || null,
    memories,
    similarPastSituations,
    relatedBeliefs,
    patterns,
    comparisons,
    pastLessons: findRelevantLessons(input),
    pastRecommendations: findRelevantPastRecommendations(input),
    pastCorrections: findRelevantCorrections(input),
    memoryInfluences,
    summaryForPIE: summarizeRecallForPIE({
      memories,
      comparisons,
      patterns,
      memoryInfluences,
    }),
    confidence: recallConfidence(memories, comparisons, memoryInfluences),
  };
}

export function findRelevantLearning(
  input: PIEMemoryRecallInput,
): PIERelevantMemory[] {
  return (input.learningResult?.memoryConsolidation || [])
    .filter(item => matchesContext(input, input.projectName, input.areaName, `${item.summary} ${item.influence}`))
    .slice(0, 8)
    .map(item => ({
      id: `learning-${item.id}`,
      source: 'learning_signal',
      dateTime: input.learningResult?.generatedAt || null,
      project: input.projectName || null,
      area: input.areaName || null,
      summary: item.summary,
      whyRelevant: `Continuous Learning created a ${item.influenceType} memory influence.`,
      confidence: item.confidence,
      influence: item.influence,
    }));
}

export function findRelevantPastEvents(
  input: PIEMemoryRecallInput,
): PIERelevantMemory[] {
  return (input.pastEvents || [])
    .filter(event => matchesContext(input, event.projectName, event.relatedArea?.name, event.description))
    .slice(0, 8)
    .map(event => ({
      id: `event-${event.id}`,
      source: 'project_event',
      dateTime: event.occurredAt,
      project: event.projectName,
      area: event.relatedArea?.name || null,
      summary: event.description,
      whyRelevant: relevanceReason(input, event.description, 'past project event'),
      confidence: event.confidence,
      influence: 'Use this event as historical project context before interpreting the new evidence.',
    }));
}

export function findRelevantPastUpdates(
  input: PIEMemoryRecallInput,
): PIERelevantMemory[] {
  return (input.pastUpdates || [])
    .filter(update => update.id !== input.currentUpdate?.id)
    .filter(update => matchesContext(input, update.projectName, update.selectedAreaName, update.notes))
    .slice(0, 8)
    .map(update => ({
      id: `update-${update.id}`,
      source: 'update',
      dateTime: update.date,
      project: update.projectName,
      area: update.selectedAreaName || null,
      summary: update.notes || `${update.photos.length} photo update.`,
      whyRelevant: relevanceReason(input, update.notes, 'past update'),
      confidence: update.notes ? 'high' : 'medium',
      influence: 'Compare the new evidence against this prior update for recurrence or change.',
    }));
}

export function findRelevantPastPhotos(
  input: PIEMemoryRecallInput,
): PIERelevantMemory[] {
  const photos = [
    ...(input.pastPhotos || []),
    ...(input.pastUpdates || []).flatMap(update =>
      update.photos.map(photo => ({
        ...photo,
        projectName: update.projectName,
        updateDate: update.date,
        updateArea: update.selectedAreaName,
      })),
    ),
  ];

  return photos
    .filter(photo => matchesContext(
      input,
      'projectName' in photo ? String(photo.projectName) : input.projectName,
      photo.selectedAreaName || ('updateArea' in photo ? String(photo.updateArea || '') : null),
      `${photo.caption} ${photo.actionRequired} ${photo.actionOwner} ${photo.actionStatus}`,
    ))
    .slice(0, 8)
    .map(photo => ({
      id: `photo-${photo.id}`,
      source: 'photo',
      dateTime: 'updateDate' in photo ? String(photo.updateDate || '') : photo.locationCapturedAt || null,
      project: 'projectName' in photo ? String(photo.projectName) : input.projectName || null,
      area: photo.selectedAreaName || ('updateArea' in photo ? String(photo.updateArea || '') : null),
      summary: photo.caption || photo.actionRequired || `${photo.category} photo`,
      whyRelevant: relevanceReason(input, `${photo.caption} ${photo.actionRequired}`, 'past photo'),
      confidence: photo.caption || photo.actionRequired ? 'high' : 'medium',
      influence: 'Use this photo history to judge whether the condition is unchanged, improved, or recurring.',
    }));
}

export function findRelevantPastScheduleItems(
  input: PIEMemoryRecallInput,
): PIERelevantMemory[] {
  return (input.pastScheduleItems || [])
    .filter(item => matchesContext(input, item.projectName, item.locationName, `${item.taskName} ${item.notes} ${item.status}`))
    .slice(0, 8)
    .map(item => ({
      id: `schedule-${item.id}`,
      source: 'schedule_item',
      dateTime: item.finishDate || item.startDate || item.createdAt,
      project: item.projectName,
      area: item.locationName || null,
      summary: `${item.taskName || 'Schedule item'} is ${item.status}.`,
      whyRelevant: relevanceReason(input, `${item.taskName} ${item.notes}`, 'past schedule item'),
      confidence: item.percentComplete >= 100 || item.status === 'Complete' ? 'high' : 'medium',
      influence: 'Use this schedule history to interpret whether the new evidence supports or contradicts planned progress.',
    }));
}

export function findRelevantPastRecommendations(
  input: PIEMemoryRecallInput,
): PIEPastRecommendation[] {
  return (input.pastRecommendations || [])
    .filter(recommendation => matchesContext(
      input,
      'projectName' in recommendation ? recommendation.projectName : input.projectName,
      null,
      `${recommendationText(recommendation)} ${recommendationNextAction(recommendation)}`,
    ))
    .slice(0, 8)
    .map(recommendation => ({
      id: recommendation.id,
      recommendation: recommendationText(recommendation),
      suggestedNextAction: recommendationNextAction(recommendation),
      project: 'projectName' in recommendation ? recommendation.projectName : input.projectName || null,
      area: null,
      confidence: recommendation.confidence,
    }));
}

export function findRelevantCorrections(
  input: PIEMemoryRecallInput,
): PIEPastCorrection[] {
  const provided = input.pastCorrections || [];
  const lessonCorrections = (input.pastLessons || [])
    .filter(lesson => /correct|wrong|lower confidence|assumption/i.test(
      `${lesson.lesson} ${lesson.whatPIEShouldDoDifferently}`,
    ))
    .map<PIEPastCorrection>(lesson => ({
      id: `lesson-correction-${lesson.id}`,
      correctionType: /gps/i.test(lesson.lesson) ? 'gps' : 'other',
      project: input.projectName || null,
      area: input.areaName || null,
      summary: lesson.lesson,
      confidenceAdjustment: 'lower',
      confidence: lesson.confidence,
    }));

  return [...provided, ...lessonCorrections]
    .filter(correction => matchesContext(input, correction.project, correction.area, correction.summary))
    .slice(0, 8);
}

export function findRelevantLessons(
  input: PIEMemoryRecallInput,
): PIEPastLesson[] {
  return (input.pastLessons || [])
    .filter(lesson => matchesText(input, `${lesson.lesson} ${lesson.whatPIEShouldDoDifferently}`))
    .slice(0, 8)
    .map(lesson => ({
      id: lesson.id,
      lesson: lesson.lesson,
      event: lesson.event,
      shouldDoDifferently: lesson.whatPIEShouldDoDifferently,
      confidence: lesson.confidence,
    }));
}

export function compareNewEvidenceToPast(
  input: PIEMemoryRecallInput,
  memories: PIERelevantMemory[] = dedupeMemories([
    ...findRelevantPastEvents(input),
    ...findRelevantPastUpdates(input),
    ...findRelevantPastPhotos(input),
    ...findRelevantPastScheduleItems(input),
  ]),
): PIEMemoryComparison[] {
  const comparisons: PIEMemoryComparison[] = [];
  const recurring = memories.filter(memory =>
    hasSharedMeaning(input.newEvidenceSummary, memory.summary),
  );
  const corrections = findRelevantCorrections(input);
  const recommendations = findRelevantPastRecommendations(input);

  if (memories.length > 0) {
    comparisons.push({
      id: 'seen-before',
      question: 'seen_before',
      summary: `DAVE found ${memories.length} past memor${memories.length === 1 ? 'y' : 'ies'} related to this evidence.`,
      relatedMemoryIds: memories.slice(0, 6).map(memory => memory.id),
      confidence: confidenceFromCount(memories.length),
    });
  }

  if (recurring.length >= 2) {
    comparisons.push({
      id: 'recurring-condition',
      question: 'recurring',
      summary: 'This appears similar to prior evidence and may be recurring.',
      relatedMemoryIds: recurring.slice(0, 6).map(memory => memory.id),
      confidence: confidenceFromCount(recurring.length),
    });
  }

  if (recommendations.length > 0) {
    comparisons.push({
      id: 'previous-recommendation',
      question: 'previous_recommendation_worked',
      summary: `DAVE previously recommended: ${recommendations[0].suggestedNextAction}`,
      relatedMemoryIds: recommendations.slice(0, 4).map(item => `recommendation-${item.id}`),
      confidence: recommendations[0].confidence,
    });
  }

  if (corrections.length > 0) {
    comparisons.push({
      id: 'similar-correction',
      question: 'user_corrected_similar_item',
      summary: corrections[0].summary,
      relatedMemoryIds: corrections.slice(0, 4).map(item => `correction-${item.id}`),
      confidence: corrections[0].confidence,
    });
  }

  if (memories.some(memory => /waiting|incomplete|overdue|open|blocked|still/i.test(memory.summary))) {
    comparisons.push({
      id: 'history-caution',
      question: 'history_caution',
      summary: 'Past memory includes open, waiting, incomplete, blocked, or overdue language; DAVE should avoid overconfident progress claims.',
      relatedMemoryIds: memories
        .filter(memory => /waiting|incomplete|overdue|open|blocked|still/i.test(memory.summary))
        .slice(0, 6)
        .map(memory => memory.id),
      confidence: 'medium',
    });
  }

  return comparisons;
}

export function buildMemoryInfluences(
  input: PIEMemoryRecallInput & {
    memories?: PIERelevantMemory[];
    comparisons?: PIEMemoryComparison[];
    patterns?: PIEMemoryPattern[];
  },
): PIEMemoryInfluence[] {
  const memories = input.memories || [];
  const comparisons = input.comparisons || compareNewEvidenceToPast(input, memories);
  const patterns = input.patterns || buildRecurringPatterns(memories, comparisons);
  const influences: PIEMemoryInfluence[] = [];

  if (patterns.length > 0) {
    influences.push({
      id: 'recurring-pattern-influence',
      appliesTo: 'interpretation',
      summary: 'Past memory shows a recurring pattern.',
      influence: 'Interpret new evidence as potentially recurring until the user verifies it is resolved.',
      confidence: patterns[0].confidence,
      relatedMemoryIds: patterns[0].relatedMemoryIds,
    });
    influences.push({
      id: 'recurring-attention-influence',
      appliesTo: 'attention',
      summary: 'Recurring conditions deserve higher attention.',
      influence: 'Raise attention for repeated issues, repeated incomplete work, or repeated corrections.',
      confidence: patterns[0].confidence,
      relatedMemoryIds: patterns[0].relatedMemoryIds,
    });
    influences.push({
      id: 'recurring-opinion-influence',
      appliesTo: 'opinion',
      summary: 'Past recurrence should make DAVE more opinionated but still evidence-bound.',
      influence: 'If the same condition keeps appearing, DAVE should treat it as more important than a one-off note.',
      confidence: patterns[0].confidence,
      relatedMemoryIds: patterns[0].relatedMemoryIds,
    });
    influences.push({
      id: 'recurring-recommendation-influence',
      appliesTo: 'recommendation',
      summary: 'Recurring memory should shape the next recommendation.',
      influence: 'Recommend verification or follow-up when similar evidence appeared before.',
      confidence: patterns[0].confidence,
      relatedMemoryIds: patterns[0].relatedMemoryIds,
    });
  }

  if (comparisons.some(comparison => comparison.question === 'user_corrected_similar_item')) {
    influences.push({
      id: 'correction-confidence-influence',
      appliesTo: 'experience',
      summary: 'The user previously corrected DAVE on similar context.',
      influence: 'Lower confidence and ask the user to verify before acting.',
      confidence: 'high',
      relatedMemoryIds: comparisons
        .filter(comparison => comparison.question === 'user_corrected_similar_item')
        .flatMap(comparison => comparison.relatedMemoryIds),
    });
    influences.push({
      id: 'correction-recommendation-influence',
      appliesTo: 'recommendation',
      summary: 'Past corrections should constrain the recommendation.',
      influence: 'Ask for confirmation before recommending action from a context the user previously corrected.',
      confidence: 'high',
      relatedMemoryIds: comparisons
        .filter(comparison => comparison.question === 'user_corrected_similar_item')
        .flatMap(comparison => comparison.relatedMemoryIds),
    });
  }

  if (comparisons.some(comparison => comparison.question === 'history_caution')) {
    influences.push({
      id: 'report-history-caution',
      appliesTo: 'report',
      summary: 'History contains unresolved or incomplete context.',
      influence: 'Use concise past context in reports only when it clarifies current status.',
      confidence: 'medium',
      relatedMemoryIds: comparisons
        .filter(comparison => comparison.question === 'history_caution')
        .flatMap(comparison => comparison.relatedMemoryIds),
    });
  }

  const learningMemories = memories.filter(memory => memory.source === 'learning_signal');
  const futureCaution = learningMemories.find(memory => /caution|failed|lower|verify|do not/i.test(`${memory.summary} ${memory.influence}`));
  const preferencePattern = learningMemories.find(memory => /style|report|wording|preference|approved/i.test(`${memory.summary} ${memory.influence}`));
  const successfulResponse = learningMemories.find(memory => /successful|worked|trust more|reuse/i.test(`${memory.summary} ${memory.influence}`));
  const userCorrectionPattern = learningMemories.find(memory => /correction|GPS|area|project|corrected/i.test(`${memory.summary} ${memory.influence}`));

  if (futureCaution) {
    influences.push({
      id: 'learning-future-caution',
      appliesTo: 'recommendation',
      summary: 'Continuous Learning found future caution.',
      influence: futureCaution.influence,
      confidence: futureCaution.confidence,
      relatedMemoryIds: [futureCaution.id],
    });
  }

  if (preferencePattern) {
    influences.push({
      id: 'learning-report-preference',
      appliesTo: 'report',
      summary: 'Continuous Learning found a report preference pattern.',
      influence: preferencePattern.influence,
      confidence: preferencePattern.confidence,
      relatedMemoryIds: [preferencePattern.id],
    });
  }

  if (successfulResponse) {
    influences.push({
      id: 'learning-successful-response',
      appliesTo: 'opinion',
      summary: 'Continuous Learning found a successful response pattern.',
      influence: successfulResponse.influence,
      confidence: successfulResponse.confidence,
      relatedMemoryIds: [successfulResponse.id],
    });
  }

  if (userCorrectionPattern) {
    influences.push({
      id: 'learning-user-correction-pattern',
      appliesTo: 'experience',
      summary: 'Continuous Learning found a user correction pattern.',
      influence: userCorrectionPattern.influence,
      confidence: userCorrectionPattern.confidence,
      relatedMemoryIds: [userCorrectionPattern.id],
    });
  }

  if (memories.length > 0) {
    influences.push({
      id: 'explanation-memory-support',
      appliesTo: 'explanation',
      summary: 'Past evidence should be part of the explanation.',
      influence: 'Explain whether current evidence matches, differs from, or contradicts prior memory.',
      confidence: recallConfidence(memories, comparisons, []),
      relatedMemoryIds: memories.slice(0, 6).map(memory => memory.id),
    });
  }

  return influences;
}

export function summarizeRecallForPIE({
  memories,
  comparisons,
  patterns,
  memoryInfluences,
}: {
  memories: PIERelevantMemory[];
  comparisons: PIEMemoryComparison[];
  patterns: PIEMemoryPattern[];
  memoryInfluences: PIEMemoryInfluence[];
}): string {
  if (memories.length === 0) {
    return 'DAVE did not find relevant past memory for this evidence yet.';
  }

  const patternLine = patterns[0]
    ? ` ${patterns[0].summary}`
    : '';
  const comparisonLine = comparisons[0]
    ? ` ${comparisons[0].summary}`
    : '';
  const influenceLine = memoryInfluences[0]
    ? ` ${memoryInfluences[0].influence}`
    : '';

  return `DAVE recalled ${memories.length} relevant past memor${memories.length === 1 ? 'y' : 'ies'}.${comparisonLine}${patternLine}${influenceLine}`.trim();
}

function findRelevantBeliefsAndOpinions(
  input: PIEMemoryRecallInput,
): PIERelevantMemory[] {
  const beliefs = [
    ...(input.pastBeliefs || []),
    ...(input.coreIntelligence?.beliefs || []),
  ];
  const opinions = [
    ...(input.pastOpinions || []),
    ...(input.coreIntelligence?.opinions || []),
  ];

  return [
    ...beliefs
      .filter(belief => matchesText(input, beliefText(belief)))
      .slice(0, 5)
      .map((belief, index) => ({
        id: `belief-${'id' in belief ? belief.id : index}`,
        source: 'core_belief' as const,
        dateTime: null,
        project: input.projectName || null,
        area: input.areaName || null,
        summary: beliefText(belief),
        whyRelevant: 'A prior DAVE belief uses similar language or context.',
        confidence: belief.confidence,
        influence: 'Use this prior belief to decide whether current evidence strengthens or weakens DAVE understanding.',
      })),
    ...opinions
      .filter(opinion => matchesText(input, `${opinion.opinion} ${opinion.reason}`))
      .slice(0, 5)
      .map(opinion => ({
        id: `opinion-${opinion.id}`,
        source: 'core_opinion' as const,
        dateTime: null,
        project: input.projectName || null,
        area: input.areaName || null,
        summary: opinion.opinion,
        whyRelevant: 'A prior DAVE opinion uses similar language or context.',
        confidence: opinion.confidence,
        influence: 'Use this prior opinion as context, but verify it against current evidence before recommending action.',
      })),
  ];
}

function findRelevantReportHistory(
  input: PIEMemoryRecallInput,
): PIERelevantMemory[] {
  return (input.reportHistory || [])
    .filter(report => matchesContext(input, report.projectName || input.projectName, null, report.title || report.reportType || 'report'))
    .slice(0, 5)
    .map(report => ({
      id: `report-${report.id}`,
      source: 'report_history',
      dateTime: report.generatedAt || null,
      project: report.projectName || input.projectName || null,
      area: null,
      summary: report.title || report.reportType || 'Prior report draft/history is available.',
      whyRelevant: 'Prior report history may explain whether the issue was previously communicated.',
      confidence: 'medium',
      influence: 'Use sparingly in reports when past context clarifies current status.',
    }));
}

function buildRecurringPatterns(
  memories: PIERelevantMemory[],
  comparisons: PIEMemoryComparison[],
): PIEMemoryPattern[] {
  const byArea = new Map<string, PIERelevantMemory[]>();
  memories.forEach(memory => {
    const key = normalize(memory.area || memory.project || memory.source);
    byArea.set(key, [...(byArea.get(key) || []), memory]);
  });

  const patterns = Array.from(byArea.entries())
    .filter(([, items]) => items.length >= 2)
    .map(([key, items]) => ({
      id: `pattern-${key}`,
      pattern: 'recurring_context',
      summary: `${items.length} recalled memories point to similar project or area context.`,
      frequency: items.length,
      relatedMemoryIds: items.map(item => item.id),
      confidence: confidenceFromCount(items.length),
    }));

  if (comparisons.some(comparison => comparison.question === 'recurring')) {
    patterns.push({
      id: 'pattern-recurring-evidence',
      pattern: 'recurring_evidence',
      summary: 'New evidence appears similar to multiple past memories.',
      frequency: comparisons
        .filter(comparison => comparison.question === 'recurring')
        .flatMap(comparison => comparison.relatedMemoryIds).length,
      relatedMemoryIds: comparisons
        .filter(comparison => comparison.question === 'recurring')
        .flatMap(comparison => comparison.relatedMemoryIds),
      confidence: 'high',
    });
  }

  return patterns.slice(0, 6);
}

function recommendationToMemory(
  recommendation: PIEPastRecommendation,
): PIERelevantMemory {
  return {
    id: `recommendation-${recommendation.id}`,
    source: 'recommendation',
    dateTime: null,
    project: recommendation.project,
    area: recommendation.area,
    summary: recommendation.recommendation,
    whyRelevant: 'A prior recommendation used similar context.',
    confidence: recommendation.confidence,
    influence: 'Check whether the previous recommendation was followed or remains open.',
  };
}

function correctionToMemory(correction: PIEPastCorrection): PIERelevantMemory {
  return {
    id: `correction-${correction.id}`,
    source: 'user_correction',
    dateTime: null,
    project: correction.project,
    area: correction.area,
    summary: correction.summary,
    whyRelevant: 'The user corrected DAVE on similar context before.',
    confidence: correction.confidence,
    influence: correction.confidenceAdjustment === 'lower'
      ? 'Lower confidence and ask for verification.'
      : 'Use correction history before recommending action.',
  };
}

function lessonToMemory(lesson: PIEPastLesson): PIERelevantMemory {
  return {
    id: `lesson-${lesson.id}`,
    source: 'reflection_lesson',
    dateTime: null,
    project: null,
    area: null,
    summary: lesson.lesson,
    whyRelevant: 'Reflection created a lesson that applies to similar evidence.',
    confidence: lesson.confidence,
    influence: lesson.shouldDoDifferently,
  };
}

function matchesContext(
  input: PIEMemoryRecallInput,
  project: string | null | undefined,
  area: string | null | undefined,
  text: string | null | undefined,
) {
  const projectMatches =
    !input.projectName ||
    !project ||
    normalize(input.projectName) === normalize(project);
  const areaMatches =
    !input.areaName ||
    !area ||
    normalize(input.areaName) === normalize(area);

  return projectMatches && areaMatches && matchesText(input, text || '');
}

function matchesText(input: PIEMemoryRecallInput, text: string) {
  const evidence = input.newEvidenceSummary || input.currentUpdate?.notes || '';
  if (!evidence.trim()) return true;

  return hasSharedMeaning(evidence, text);
}

function hasSharedMeaning(left: string | null | undefined, right: string | null | undefined) {
  const leftTokens = meaningfulTokens(left || '');
  const rightTokens = meaningfulTokens(right || '');
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;

  return leftTokens.some(token => rightTokens.includes(token));
}

function meaningfulTokens(value: string) {
  return normalize(value)
    .split(/\s+/)
    .filter(token =>
      token.length > 3 &&
      ![
        'this',
        'that',
        'with',
        'from',
        'have',
        'been',
        'were',
        'will',
        'area',
        'project',
      ].includes(token),
    )
    .slice(0, 20);
}

function relevanceReason(
  input: PIEMemoryRecallInput,
  text: string | null | undefined,
  fallbackSource: string,
) {
  if (hasSharedMeaning(input.newEvidenceSummary, text)) {
    return `This ${fallbackSource} shares language with the new evidence.`;
  }
  if (input.areaName) return `This ${fallbackSource} is tied to the same area.`;
  if (input.projectName) return `This ${fallbackSource} is tied to the same project.`;

  return `This ${fallbackSource} may provide useful historical context.`;
}

function beliefText(belief: PIEBelief | PIECoreOutput['beliefs'][number]) {
  return 'statement' in belief
    ? belief.statement
    : (belief as { belief?: string }).belief || '';
}

function recommendationText(
  recommendation: PIERecommendation | PIECoreRecommendation,
) {
  return 'title' in recommendation
    ? recommendation.title
    : recommendation.recommendation;
}

function recommendationNextAction(
  recommendation: PIERecommendation | PIECoreRecommendation,
) {
  return 'suggestedNextAction' in recommendation
    ? recommendation.suggestedNextAction
    : recommendation.nextAction;
}

function recallConfidence(
  memories: PIERelevantMemory[],
  comparisons: PIEMemoryComparison[],
  influences: PIEMemoryInfluence[],
): PIEMemoryConfidence {
  if (memories.length >= 4 && comparisons.length >= 2 && influences.length > 0) return 'high';
  if (memories.length >= 2 || comparisons.length > 0 || influences.length > 0) return 'medium';

  return 'low';
}

function confidenceFromCount(count: number): PIEMemoryConfidence {
  if (count >= 3) return 'high';
  if (count >= 1) return 'medium';

  return 'low';
}

function dedupeMemories(memories: PIERelevantMemory[]) {
  const byId = new Map<string, PIERelevantMemory>();
  memories.forEach(memory => byId.set(memory.id, memory));

  return Array.from(byId.values()).slice(0, 24);
}

function normalize(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}
