import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  parseDueDate,
  parseFlexibleDate,
} from '../utils/date';
import type {
  ProjectConfidenceLevel,
  ProjectIntelligenceSummary,
  ProjectReportHistoryMetadata,
} from './ProjectIntelligenceEngine';
import type {
  ProjectEvent,
  ProjectEventType,
} from './ProjectEventService';
import type {
  PIEConcern,
  PIEQuestion,
  PIEReasoningResult,
} from './PIEReasoningEngine';

export type PIEMemoryPriority = 'low' | 'medium' | 'high';

export type PIEMemorySource =
  | 'project-event'
  | 'pie-reasoning'
  | 'project-intelligence'
  | 'typed-update'
  | 'photo'
  | 'schedule'
  | 'document-metadata'
  | 'report-history'
  | 'memory';

export type PIEProjectPhase =
  | 'unknown'
  | 'setup'
  | 'active-work'
  | 'risk-response'
  | 'closeout'
  | 'reporting';

export type PIEMemorySnapshot = {
  projectName: string;
  generatedAt: string;
  story: PIEProjectStory;
  timelineSegments: PIEProjectTimelineSegment[];
  patterns: PIEMemoryPattern[];
  gaps: PIEMemoryGap[];
  insights: PIEMemoryInsight[];
  confidence: ProjectConfidenceLevel;
  sourceCounts: {
    projectEvents: number;
    updates: number;
    photos: number;
    scheduleItems: number;
    documents: number;
    reports: number;
    reasoningThoughts: number;
  };
};

export type PIEProjectStory = {
  projectName: string;
  generatedAt: string;
  whatHappened: string;
  whatChangedOverTime: string;
  currentPhase: PIEProjectPhase;
  majorRisks: string[];
  unresolvedQuestions: string[];
  likelyNextStep: string;
  confidence: ProjectConfidenceLevel;
  supportingInsightIds: string[];
};

export type PIEProjectTimelineSegment = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  startAt: string | null;
  endAt: string | null;
  eventCount: number;
  updateCount: number;
  photoCount: number;
  scheduleItemCount: number;
  reportCount: number;
  documentCount: number;
  riskCount: number;
  eventTypes: ProjectEventType[];
  source: PIEMemorySource;
  confidence: ProjectConfidenceLevel;
};

export type PIEMemoryPattern = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  frequency: number;
  evidence: string[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  source: PIEMemorySource;
  confidence: ProjectConfidenceLevel;
  priority: PIEMemoryPriority;
  metadata: Record<string, unknown>;
};

export type PIEMemoryGap = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  impact: string;
  suggestedAction: string;
  source: PIEMemorySource;
  confidence: ProjectConfidenceLevel;
  priority: PIEMemoryPriority;
  metadata: Record<string, unknown>;
};

export type PIEMemoryInsight = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  whyItMatters: string;
  suggestedNextAction: string;
  supportingPatternIds: string[];
  supportingGapIds: string[];
  supportingEventIds: string[];
  source: PIEMemorySource;
  confidence: ProjectConfidenceLevel;
  priority: PIEMemoryPriority;
  metadata: Record<string, unknown>;
};

export type BuildPIEMemoryParams = {
  projectName?: string;
  intelligence: ProjectIntelligenceSummary;
  reasoning: PIEReasoningResult;
  projectEvents?: ProjectEvent[];
  updates?: ProjectUpdate[];
  scheduleItems?: ScheduleItem[];
  referenceDocuments?: ReferenceDocument[];
  reportHistory?: ProjectReportHistoryMetadata[];
  now?: Date;
};

type MemoryParts = {
  projectName: string;
  generatedAt: string;
  intelligence: ProjectIntelligenceSummary;
  reasoning: PIEReasoningResult;
  projectEvents: ProjectEvent[];
  updates: ProjectUpdate[];
  photos: UpdatePhoto[];
  scheduleItems: ScheduleItem[];
  documents: ReferenceDocument[];
  reportHistory: ProjectReportHistoryMetadata[];
  timelinePoints: MemoryTimelinePoint[];
};

type MemoryTimelinePoint = {
  id: string;
  title: string;
  detail: string;
  occurredAt: string;
  source: PIEMemorySource;
  eventType?: ProjectEventType;
  updateId?: string;
  photoId?: string;
  scheduleItemId?: string;
  documentId?: string;
  reportId?: string;
  isRisk?: boolean;
};

const RECENT_UPDATE_DAYS = 7;

export function buildPIEMemory(
  params: BuildPIEMemoryParams,
): PIEMemorySnapshot {
  const parts = buildMemoryParts(params);
  const timelineSegments = buildTimelineSegmentsFromParts(parts);
  const patterns = buildProjectPatternsFromParts(parts);
  const gaps = buildMemoryGapsFromParts(parts);
  const insights = buildMemoryInsightsFromParts(parts, patterns, gaps);
  const story = buildProjectStoryFromParts(
    parts,
    timelineSegments,
    patterns,
    gaps,
    insights,
  );

  return {
    projectName: parts.projectName,
    generatedAt: parts.generatedAt,
    story,
    timelineSegments,
    patterns,
    gaps,
    insights,
    confidence: memoryConfidence(parts, gaps),
    sourceCounts: {
      projectEvents: parts.projectEvents.length,
      updates: parts.updates.length,
      photos: parts.photos.length,
      scheduleItems: parts.scheduleItems.length,
      documents: parts.documents.length,
      reports: parts.reportHistory.length,
      reasoningThoughts: parts.reasoning.thoughts.length,
    },
  };
}

export function buildProjectStory(
  params: BuildPIEMemoryParams,
): PIEProjectStory {
  const parts = buildMemoryParts(params);
  const timelineSegments = buildTimelineSegmentsFromParts(parts);
  const patterns = buildProjectPatternsFromParts(parts);
  const gaps = buildMemoryGapsFromParts(parts);
  const insights = buildMemoryInsightsFromParts(parts, patterns, gaps);

  return buildProjectStoryFromParts(
    parts,
    timelineSegments,
    patterns,
    gaps,
    insights,
  );
}

export function getMemoryGaps(
  memoryOrParams: PIEMemorySnapshot | BuildPIEMemoryParams,
): PIEMemoryGap[] {
  if (isMemorySnapshot(memoryOrParams)) return memoryOrParams.gaps;

  return buildMemoryGapsFromParts(buildMemoryParts(memoryOrParams));
}

export function getTimelineSegments(
  memoryOrParams: PIEMemorySnapshot | BuildPIEMemoryParams,
): PIEProjectTimelineSegment[] {
  if (isMemorySnapshot(memoryOrParams)) return memoryOrParams.timelineSegments;

  return buildTimelineSegmentsFromParts(buildMemoryParts(memoryOrParams));
}

export function getProjectPatterns(
  memoryOrParams: PIEMemorySnapshot | BuildPIEMemoryParams,
): PIEMemoryPattern[] {
  if (isMemorySnapshot(memoryOrParams)) return memoryOrParams.patterns;

  return buildProjectPatternsFromParts(buildMemoryParts(memoryOrParams));
}

export function getMemoryInsights(
  memoryOrParams: PIEMemorySnapshot | BuildPIEMemoryParams,
): PIEMemoryInsight[] {
  if (isMemorySnapshot(memoryOrParams)) return memoryOrParams.insights;

  const parts = buildMemoryParts(memoryOrParams);
  return buildMemoryInsightsFromParts(
    parts,
    buildProjectPatternsFromParts(parts),
    buildMemoryGapsFromParts(parts),
  );
}

function buildMemoryParts({
  projectName: explicitProjectName,
  intelligence,
  reasoning,
  projectEvents,
  updates = [],
  scheduleItems = [],
  referenceDocuments = [],
  reportHistory = [],
  now = new Date(),
}: BuildPIEMemoryParams): MemoryParts {
  const projectName = explicitProjectName?.trim() || intelligence.projectName;
  const generatedAt = now.toISOString();
  const relatedEvents = relatedProjectEvents(
    projectName,
    projectEvents ?? intelligence.recentEvents,
  );
  const relatedUpdates = updates.filter(update =>
    isSameProject(projectName, update.projectName),
  );
  const relatedPhotos = relatedUpdates.flatMap(update => update.photos);
  const relatedScheduleItems = scheduleItems.filter(item =>
    isSameProject(projectName, item.projectName),
  );
  const relatedDocuments = relatedReferenceDocuments(
    projectName,
    referenceDocuments,
    relatedScheduleItems,
  );
  const relatedReports = reportHistory.filter(report =>
    !report.projectName || isSameProject(projectName, report.projectName),
  );
  const timelinePoints = buildTimelinePoints({
    projectName,
    projectEvents: relatedEvents,
    updates: relatedUpdates,
    scheduleItems: relatedScheduleItems,
    documents: relatedDocuments,
    reportHistory: relatedReports,
    generatedAt,
  });

  return {
    projectName,
    generatedAt,
    intelligence,
    reasoning,
    projectEvents: relatedEvents,
    updates: relatedUpdates,
    photos: relatedPhotos,
    scheduleItems: relatedScheduleItems,
    documents: relatedDocuments,
    reportHistory: relatedReports,
    timelinePoints,
  };
}

function buildProjectStoryFromParts(
  parts: MemoryParts,
  timelineSegments: PIEProjectTimelineSegment[],
  patterns: PIEMemoryPattern[],
  gaps: PIEMemoryGap[],
  insights: PIEMemoryInsight[],
): PIEProjectStory {
  const phase = currentPhase(parts);
  const majorRisks = majorRiskStatements(parts);
  const unresolvedQuestions = parts.reasoning.questions
    .slice(0, 4)
    .map(question => question.question);
  const patternSummary = patterns.length > 0
    ? ` PIE sees ${patterns.length} recurring pattern${patterns.length === 1 ? '' : 's'}, led by ${patterns[0].title.toLowerCase()}.`
    : '';
  const gapSummary = gaps.length > 0
    ? ` Memory still has ${gaps.length} gap${gaps.length === 1 ? '' : 's'} that limit certainty.`
    : '';

  return {
    projectName: parts.projectName,
    generatedAt: parts.generatedAt,
    whatHappened: whatHappened(parts),
    whatChangedOverTime: whatChangedOverTime(parts, timelineSegments) + patternSummary + gapSummary,
    currentPhase: phase,
    majorRisks,
    unresolvedQuestions,
    likelyNextStep: parts.intelligence.recommendedNextAction.label,
    confidence: memoryConfidence(parts, gaps),
    supportingInsightIds: insights.slice(0, 4).map(insight => insight.id),
  };
}

function buildTimelineSegmentsFromParts(
  parts: MemoryParts,
): PIEProjectTimelineSegment[] {
  if (parts.timelinePoints.length === 0) {
    return [
      {
        id: stableId(parts.projectName, 'timeline-empty'),
        projectName: parts.projectName,
        title: 'No timeline history yet',
        summary: 'PIE does not have project events, updates, schedule dates, documents, or reports to build a timeline.',
        startAt: null,
        endAt: null,
        eventCount: 0,
        updateCount: 0,
        photoCount: 0,
        scheduleItemCount: 0,
        reportCount: 0,
        documentCount: 0,
        riskCount: 0,
        eventTypes: [],
        source: 'memory',
        confidence: 'low',
      },
    ];
  }

  const grouped = groupByMonth(parts.timelinePoints);

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([monthKey, points]) => {
      const sorted = [...points].sort(compareTimelinePoints);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];

      return {
        id: stableId(parts.projectName, 'timeline', monthKey),
        projectName: parts.projectName,
        title: monthTitle(monthKey),
        summary: timelineSegmentSummary(sorted),
        startAt: first?.occurredAt ?? null,
        endAt: last?.occurredAt ?? null,
        eventCount: sorted.filter(point => point.source === 'project-event').length,
        updateCount: uniqueValues(sorted.map(point => point.updateId)).length,
        photoCount: uniqueValues(sorted.map(point => point.photoId)).length,
        scheduleItemCount: uniqueValues(sorted.map(point => point.scheduleItemId)).length,
        reportCount: uniqueValues(sorted.map(point => point.reportId)).length,
        documentCount: uniqueValues(sorted.map(point => point.documentId)).length,
        riskCount: sorted.filter(point => point.isRisk).length,
        eventTypes: uniqueEventTypes(sorted),
        source: 'memory',
        confidence: confidenceFromCount(sorted.length),
      };
    });
}

function buildProjectPatternsFromParts(parts: MemoryParts): PIEMemoryPattern[] {
  const patterns: PIEMemoryPattern[] = [];
  const issueEvents = parts.projectEvents.filter(event =>
    event.eventType === 'issue_created',
  );
  const safetyEvents = parts.projectEvents.filter(event =>
    event.eventType === 'safety_observation',
  );
  const overdueScheduleEvents = parts.projectEvents.filter(event =>
    event.eventType === 'schedule_item_overdue',
  );
  const photoActions = parts.photos.filter(photo =>
    Boolean(
      photo.actionRequired.trim() ||
        photo.actionOwner.trim() ||
        photo.actionDueDate.trim(),
    ),
  );
  const waitingScheduleItems = parts.scheduleItems.filter(item =>
    item.status === 'Waiting',
  );

  if (issueEvents.length >= 2 || parts.intelligence.metrics.openIssueCount >= 2) {
    patterns.push(patternItem({
      id: 'recurring-open-issues',
      projectName: parts.projectName,
      title: 'Recurring open issue activity',
      summary: 'Multiple open issue signals appear in project memory.',
      frequency: Math.max(issueEvents.length, parts.intelligence.metrics.openIssueCount),
      evidence: [
        `${parts.intelligence.metrics.openIssueCount} open issue${parts.intelligence.metrics.openIssueCount === 1 ? '' : 's'} currently visible.`,
        ...issueEvents.slice(0, 3).map(event => event.description),
      ],
      firstSeenAt: firstDate(issueEvents.map(event => event.occurredAt)),
      lastSeenAt: lastDate(issueEvents.map(event => event.occurredAt)),
      source: 'project-event',
      confidence: issueEvents.length > 0 ? 'high' : 'medium',
      priority: 'medium',
      metadata: {
        openIssueCount: parts.intelligence.metrics.openIssueCount,
      },
    }));
  }

  if (safetyEvents.length > 0 || parts.intelligence.metrics.safetyConcernCount > 0) {
    patterns.push(patternItem({
      id: 'safety-follow-up',
      projectName: parts.projectName,
      title: 'Safety follow-up needed',
      summary: 'Safety observations are part of this project memory and should remain visible until closed.',
      frequency: Math.max(safetyEvents.length, parts.intelligence.metrics.safetyConcernCount),
      evidence: [
        `${parts.intelligence.metrics.safetyConcernCount} safety concern${parts.intelligence.metrics.safetyConcernCount === 1 ? '' : 's'} currently visible.`,
        ...safetyEvents.slice(0, 3).map(event => event.description),
      ],
      firstSeenAt: firstDate(safetyEvents.map(event => event.occurredAt)),
      lastSeenAt: lastDate(safetyEvents.map(event => event.occurredAt)),
      source: 'project-event',
      confidence: safetyEvents.length > 0 ? 'high' : 'medium',
      priority: 'high',
      metadata: {
        safetyConcernCount: parts.intelligence.metrics.safetyConcernCount,
      },
    }));
  }

  if (overdueScheduleEvents.length > 0 || parts.intelligence.overdueScheduleItems > 0) {
    patterns.push(patternItem({
      id: 'schedule-slippage',
      projectName: parts.projectName,
      title: 'Schedule slippage pattern',
      summary: 'Overdue schedule activity is present in memory.',
      frequency: Math.max(overdueScheduleEvents.length, parts.intelligence.overdueScheduleItems),
      evidence: [
        `${parts.intelligence.overdueScheduleItems} overdue schedule item${parts.intelligence.overdueScheduleItems === 1 ? '' : 's'} currently visible.`,
        ...overdueScheduleEvents.slice(0, 3).map(event => event.description),
      ],
      firstSeenAt: firstDate(overdueScheduleEvents.map(event => event.occurredAt)),
      lastSeenAt: lastDate(overdueScheduleEvents.map(event => event.occurredAt)),
      source: 'schedule',
      confidence: overdueScheduleEvents.length > 0 ? 'high' : 'medium',
      priority: 'high',
      metadata: {
        overdueScheduleItems: parts.intelligence.overdueScheduleItems,
      },
    }));
  }

  if (waitingScheduleItems.length > 0) {
    patterns.push(patternItem({
      id: 'waiting-work',
      projectName: parts.projectName,
      title: 'Waiting work pattern',
      summary: 'Schedule memory includes work that is waiting on another action or decision.',
      frequency: waitingScheduleItems.length,
      evidence: waitingScheduleItems
        .slice(0, 4)
        .map(item => `${item.taskName || 'Schedule item'} is waiting.`),
      firstSeenAt: firstDate(waitingScheduleItems.map(item => item.createdAt)),
      lastSeenAt: lastDate(waitingScheduleItems.map(item => item.finishDate || item.createdAt)),
      source: 'schedule',
      confidence: 'high',
      priority: 'medium',
      metadata: {
        waitingScheduleItemCount: waitingScheduleItems.length,
      },
    }));
  }

  if (photoActions.length >= 2) {
    patterns.push(patternItem({
      id: 'photo-action-tracking',
      projectName: parts.projectName,
      title: 'Photo-driven action tracking',
      summary: 'Photos are repeatedly being used to create owner, status, or due-date action context.',
      frequency: photoActions.length,
      evidence: photoActions
        .slice(0, 4)
        .map(photo => photo.actionRequired || `${photo.category} action is ${photo.actionStatus}.`),
      firstSeenAt: null,
      lastSeenAt: null,
      source: 'photo',
      confidence: 'high',
      priority: parts.intelligence.metrics.overduePhotoActionCount > 0 ? 'high' : 'medium',
      metadata: {
        photoActionCount: photoActions.length,
        overduePhotoActionCount: parts.intelligence.metrics.overduePhotoActionCount,
      },
    }));
  }

  if (parts.updates.length >= 3 || parts.photos.length >= 5) {
    patterns.push(patternItem({
      id: 'active-capture-rhythm',
      projectName: parts.projectName,
      title: 'Active capture rhythm',
      summary: 'Project memory has a useful field-capture trail from updates and photos.',
      frequency: parts.updates.length + parts.photos.length,
      evidence: [
        `${parts.updates.length} update${parts.updates.length === 1 ? '' : 's'} captured.`,
        `${parts.photos.length} photo${parts.photos.length === 1 ? '' : 's'} captured.`,
      ],
      firstSeenAt: firstDate(parts.updates.map(update => update.date)),
      lastSeenAt: lastDate(parts.updates.map(update => update.date)),
      source: 'typed-update',
      confidence: 'high',
      priority: 'low',
      metadata: {
        updateCount: parts.updates.length,
        photoCount: parts.photos.length,
      },
    }));
  }

  if (parts.reportHistory.length > 0) {
    patterns.push(patternItem({
      id: 'reporting-history',
      projectName: parts.projectName,
      title: 'Reporting history exists',
      summary: 'Project memory includes generated report history that can support future communication.',
      frequency: parts.reportHistory.length,
      evidence: parts.reportHistory
        .slice(0, 4)
        .map(report => report.title || report.reportType || 'Report generated'),
      firstSeenAt: firstDate(parts.reportHistory.map(report => report.generatedAt || null)),
      lastSeenAt: lastDate(parts.reportHistory.map(report => report.generatedAt || null)),
      source: 'report-history',
      confidence: 'medium',
      priority: 'low',
      metadata: {
        reportHistoryCount: parts.reportHistory.length,
      },
    }));
  }

  return uniqueById(patterns).sort(comparePriority);
}

function buildMemoryGapsFromParts(parts: MemoryParts): PIEMemoryGap[] {
  const gaps: PIEMemoryGap[] = [];
  const hasRecentUpdate =
    parts.intelligence.metrics.daysSinceLastUpdate !== null &&
    parts.intelligence.metrics.daysSinceLastUpdate <= RECENT_UPDATE_DAYS;
  const hasScheduleImport =
    parts.projectEvents.some(event => event.eventType === 'schedule_imported') ||
    parts.scheduleItems.some(item => item.importedAt || item.importedFrom);
  const hasInspectionStatus = parts.projectEvents.some(event =>
    event.eventType === 'inspection_event',
  );
  const hasReportHistory =
    parts.reportHistory.length > 0 ||
    parts.projectEvents.some(event => event.eventType === 'report_generated') ||
    parts.intelligence.metrics.reportHistoryCount > 0;

  if (!hasRecentUpdate) {
    gaps.push(gapItem({
      id: 'no-recent-updates',
      projectName: parts.projectName,
      title: 'No recent update memory',
      summary:
        parts.intelligence.lastUpdate
          ? `Latest saved update is ${parts.intelligence.metrics.daysSinceLastUpdate ?? 'unknown'} days old.`
          : 'No saved update is available for this project.',
      impact: 'PIE may not know what changed most recently in the field.',
      suggestedAction: 'Capture a fresh field update.',
      source: 'typed-update',
      confidence: 'high',
      priority: 'high',
      metadata: {
        lastUpdate: parts.intelligence.lastUpdate,
        daysSinceLastUpdate: parts.intelligence.metrics.daysSinceLastUpdate,
      },
    }));
  }

  if (!hasScheduleImport) {
    gaps.push(gapItem({
      id: 'no-schedule-imported',
      projectName: parts.projectName,
      title: 'No imported schedule memory',
      summary: 'PIE does not see an imported schedule source for this project.',
      impact: 'Schedule comparisons, phase recognition, and future prediction are weaker.',
      suggestedAction: 'Import or classify a project schedule.',
      source: 'schedule',
      confidence: 'high',
      priority: parts.intelligence.metrics.scheduleItemCount > 0 ? 'medium' : 'high',
      metadata: {
        scheduleItemCount: parts.intelligence.metrics.scheduleItemCount,
      },
    }));
  }

  if (parts.photos.length === 0) {
    gaps.push(gapItem({
      id: 'no-photos',
      projectName: parts.projectName,
      title: 'No photo memory',
      summary: 'PIE does not see photos for this project.',
      impact: 'Project memory lacks visual evidence for field progress, issues, and safety conditions.',
      suggestedAction: 'Add photos to the next project update.',
      source: 'photo',
      confidence: 'high',
      priority: 'medium',
      metadata: {
        photoCount: parts.photos.length,
      },
    }));
  }

  if (!hasInspectionStatus) {
    gaps.push(gapItem({
      id: 'missing-inspection-status',
      projectName: parts.projectName,
      title: 'Inspection status missing',
      summary: 'PIE does not see inspection events for this project.',
      impact: 'PIE cannot tell whether inspections are blocking, passed, failed, or pending.',
      suggestedAction: 'Record inspection status when it becomes available.',
      source: 'project-event',
      confidence: 'medium',
      priority: 'medium',
      metadata: {},
    }));
  }

  if (parts.documents.length === 0 || parts.intelligence.metrics.currentDocumentCount === 0) {
    gaps.push(gapItem({
      id: 'missing-document-context',
      projectName: parts.projectName,
      title: 'Document context incomplete',
      summary:
        parts.documents.length === 0
          ? 'PIE does not see related document metadata.'
          : 'PIE sees documents, but no current reference document is marked.',
      impact: 'Project memory may not know which drawings, specs, or schedules support the current status.',
      suggestedAction:
        parts.documents.length === 0
          ? 'Add or link current reference documents.'
          : 'Mark the current reference document.',
      source: 'document-metadata',
      confidence: 'medium',
      priority: 'medium',
      metadata: {
        documentCount: parts.documents.length,
        currentDocumentCount: parts.intelligence.metrics.currentDocumentCount,
      },
    }));
  }

  if (!hasReportHistory) {
    gaps.push(gapItem({
      id: 'no-report-history',
      projectName: parts.projectName,
      title: 'No report history',
      summary: 'PIE does not see generated report history for this project.',
      impact: 'PIE cannot compare current communication needs against prior reporting cadence or commitments.',
      suggestedAction: 'Generate and save a project report when stakeholder communication is needed.',
      source: 'report-history',
      confidence: 'medium',
      priority: 'low',
      metadata: {
        reportHistoryCount: parts.reportHistory.length,
      },
    }));
  }

  return uniqueById(gaps).sort(comparePriority);
}

function buildMemoryInsightsFromParts(
  parts: MemoryParts,
  patterns: PIEMemoryPattern[],
  gaps: PIEMemoryGap[],
): PIEMemoryInsight[] {
  const insights: PIEMemoryInsight[] = [];
  const highPriorityPatterns = patterns.filter(pattern => pattern.priority === 'high');
  const highPriorityGaps = gaps.filter(gap => gap.priority === 'high');
  const riskConcerns = parts.reasoning.concerns.filter(concern =>
    concern.priority === 'high' || concern.priority === 'medium',
  );

  if (riskConcerns.length > 0 || highPriorityPatterns.length > 0) {
    const concern = riskConcerns[0];
    const pattern = highPriorityPatterns[0];

    insights.push(insightItem({
      id: 'memory-risk-focus',
      projectName: parts.projectName,
      title: 'Project memory points to risk follow-up',
      summary:
        concern?.summary ||
        pattern?.summary ||
        'PIE memory sees project conditions that should be reviewed.',
      whyItMatters: 'Repeated or high-priority risk signals are more important than isolated raw data.',
      suggestedNextAction:
        concern?.suggestedNextAction ||
        parts.intelligence.recommendedNextAction.label,
      supportingPatternIds: pattern ? [pattern.id] : [],
      supportingGapIds: [],
      supportingEventIds: eventIdsForRisk(parts.projectEvents),
      source: 'memory',
      confidence: concern?.confidence || pattern?.confidence || 'medium',
      priority: concern?.priority || pattern?.priority || 'medium',
      metadata: {
        concernId: concern?.id ?? null,
      },
    }));
  }

  if (highPriorityGaps.length > 0 || gaps.length >= 3) {
    insights.push(insightItem({
      id: 'memory-gaps-limit-confidence',
      projectName: parts.projectName,
      title: 'Memory gaps are limiting confidence',
      summary: `${gaps.length} memory gap${gaps.length === 1 ? '' : 's'} should be filled to improve project understanding.`,
      whyItMatters: 'PIE can reason better when updates, schedule, photos, inspections, documents, and report history are present.',
      suggestedNextAction: highPriorityGaps[0]?.suggestedAction || gaps[0]?.suggestedAction || 'Add missing project history.',
      supportingPatternIds: [],
      supportingGapIds: gaps.slice(0, 4).map(gap => gap.id),
      supportingEventIds: [],
      source: 'memory',
      confidence: 'high',
      priority: highPriorityGaps.length > 0 ? 'high' : 'medium',
      metadata: {
        gapCount: gaps.length,
      },
    }));
  }

  if (parts.intelligence.communicationReadiness.level === 'ready') {
    insights.push(insightItem({
      id: 'communication-memory-ready',
      projectName: parts.projectName,
      title: 'Memory can support communication',
      summary: 'PIE sees enough current context to support stakeholder communication.',
      whyItMatters: 'Reports and Project Assistant answers can reuse memory instead of asking the user to restate project status.',
      suggestedNextAction: 'Prepare the next project report or stakeholder update.',
      supportingPatternIds: patterns
        .filter(pattern => pattern.source === 'report-history' || pattern.source === 'typed-update')
        .slice(0, 3)
        .map(pattern => pattern.id),
      supportingGapIds: [],
      supportingEventIds: parts.projectEvents
        .filter(event => event.eventType === 'report_generated' || event.eventType === 'update_created')
        .slice(0, 5)
        .map(event => event.id),
      source: 'project-intelligence',
      confidence: parts.intelligence.communicationReadiness.confidence,
      priority: 'low',
      metadata: {
        communicationReadiness: parts.intelligence.communicationReadiness.level,
      },
    }));
  } else {
    insights.push(insightItem({
      id: 'communication-memory-not-ready',
      projectName: parts.projectName,
      title: 'Memory needs context before communication',
      summary: parts.intelligence.communicationReadiness.message,
      whyItMatters: 'Stakeholder updates should not rely on stale or incomplete memory.',
      suggestedNextAction: parts.intelligence.communicationReadiness.missingItems[0] || parts.intelligence.recommendedNextAction.label,
      supportingPatternIds: [],
      supportingGapIds: gaps.slice(0, 4).map(gap => gap.id),
      supportingEventIds: [],
      source: 'project-intelligence',
      confidence: parts.intelligence.communicationReadiness.confidence,
      priority: parts.intelligence.communicationReadiness.level === 'not-ready' ? 'medium' : 'low',
      metadata: {
        missingItems: parts.intelligence.communicationReadiness.missingItems,
      },
    }));
  }

  if (patterns.length > 0 && parts.timelinePoints.length > 0) {
    insights.push(insightItem({
      id: 'timeline-pattern-memory',
      projectName: parts.projectName,
      title: 'Timeline and patterns are forming project memory',
      summary: `PIE sees ${parts.timelinePoints.length} timeline point${parts.timelinePoints.length === 1 ? '' : 's'} and ${patterns.length} pattern${patterns.length === 1 ? '' : 's'}.`,
      whyItMatters: 'This gives Project Assistant and reports a durable project story instead of isolated current-state readings.',
      suggestedNextAction: patterns[0].priority === 'high'
        ? patterns[0].summary
        : parts.intelligence.recommendedNextAction.label,
      supportingPatternIds: patterns.slice(0, 4).map(pattern => pattern.id),
      supportingGapIds: [],
      supportingEventIds: parts.projectEvents.slice(0, 6).map(event => event.id),
      source: 'memory',
      confidence: confidenceFromCount(parts.timelinePoints.length),
      priority: patterns.some(pattern => pattern.priority === 'high') ? 'medium' : 'low',
      metadata: {
        timelinePointCount: parts.timelinePoints.length,
        patternCount: patterns.length,
      },
    }));
  }

  return uniqueById(insights).sort(comparePriority);
}

function whatHappened(parts: MemoryParts) {
  const pieces = [
    `${parts.updates.length} update${parts.updates.length === 1 ? '' : 's'}`,
    `${parts.photos.length} photo${parts.photos.length === 1 ? '' : 's'}`,
    `${parts.scheduleItems.length} schedule item${parts.scheduleItems.length === 1 ? '' : 's'}`,
    `${parts.projectEvents.length} project event${parts.projectEvents.length === 1 ? '' : 's'}`,
  ];
  const latest = parts.intelligence.latestActivity || parts.intelligence.lastUpdate;

  return latest
    ? `${pieces.join(', ')} are in memory. Latest activity: ${formatMemoryDate(latest)}.`
    : `${pieces.join(', ')} are in memory. No latest activity date is available yet.`;
}

function whatChangedOverTime(
  parts: MemoryParts,
  timelineSegments: PIEProjectTimelineSegment[],
) {
  if (timelineSegments.length === 0 || parts.timelinePoints.length === 0) {
    return 'Project memory does not have enough timeline history to compare change over time.';
  }

  const first = timelineSegments[0];
  const last = timelineSegments[timelineSegments.length - 1];

  if (!first || !last || first.id === last.id) {
    return `Project memory is concentrated in ${first?.title || 'one timeline segment'}.`;
  }

  return `Project memory spans from ${first.title} to ${last.title}, moving through ${timelineSegments.length} timeline segment${timelineSegments.length === 1 ? '' : 's'}.`;
}

function currentPhase(parts: MemoryParts): PIEProjectPhase {
  if (
    parts.updates.length === 0 &&
    parts.scheduleItems.length === 0 &&
    parts.projectEvents.length === 0
  ) {
    return 'unknown';
  }

  if (
    parts.intelligence.healthStatus === 'at-risk' ||
    parts.intelligence.overdueScheduleItems > 0 ||
    parts.intelligence.metrics.safetyConcernCount > 0
  ) {
    return 'risk-response';
  }

  if (
    parts.intelligence.progressStatus === 'complete' ||
    parts.projectEvents.some(event => event.eventType === 'issue_closed')
  ) {
    return 'closeout';
  }

  if (
    parts.reportHistory.length > 0 &&
    parts.intelligence.communicationReadiness.level === 'ready'
  ) {
    return 'reporting';
  }

  if (parts.scheduleItems.length > 0 || parts.updates.length > 0) {
    return 'active-work';
  }

  return 'setup';
}

function majorRiskStatements(parts: MemoryParts) {
  const risks = parts.reasoning.concerns
    .filter(concern => concern.priority === 'high' || concern.priority === 'medium')
    .slice(0, 4)
    .map(concern => `${concern.title}: ${concern.summary}`);

  if (risks.length > 0) return risks;

  return parts.intelligence.riskSignals
    .slice(0, 4)
    .map(risk => `${risk.label}: ${risk.message}`);
}

function buildTimelinePoints({
  projectEvents,
  updates,
  scheduleItems,
  documents,
  reportHistory,
  generatedAt,
}: {
  projectName: string;
  projectEvents: ProjectEvent[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  documents: ReferenceDocument[];
  reportHistory: ProjectReportHistoryMetadata[];
  generatedAt: string;
}): MemoryTimelinePoint[] {
  const points: MemoryTimelinePoint[] = [];

  projectEvents.forEach(event => {
    points.push({
      id: stableId('event', event.id),
      title: event.title,
      detail: event.description,
      occurredAt: normalizeDateValue(event.occurredAt, generatedAt),
      source: 'project-event',
      eventType: event.eventType,
      isRisk: isRiskEvent(event),
    });
  });

  updates.forEach(update => {
    const occurredAt = normalizeDateValue(update.date, generatedAt);

    points.push({
      id: stableId('update', update.id),
      title: 'Update captured',
      detail: update.notes.trim() || `${update.photos.length} photo${update.photos.length === 1 ? '' : 's'} captured.`,
      occurredAt,
      source: 'typed-update',
      updateId: update.id,
    });

    update.photos.forEach(photo => {
      points.push({
        id: stableId('photo', update.id, photo.id),
        title: `${photo.category} photo`,
        detail: photo.caption.trim() || photo.actionRequired.trim() || `${photo.category} photo captured.`,
        occurredAt: normalizeDateValue(photo.locationCapturedAt || update.date, generatedAt),
        source: 'photo',
        updateId: update.id,
        photoId: photo.id,
        isRisk: photo.category === 'Open Issue' || photo.category === 'Safety Concern',
      });
    });
  });

  scheduleItems.forEach(item => {
    points.push({
      id: stableId('schedule', item.id),
      title: item.taskName || 'Schedule item',
      detail: `${item.status} schedule item${item.finishDate ? ` finishing ${item.finishDate}` : ''}.`,
      occurredAt: normalizeDateValue(item.finishDate || item.createdAt, generatedAt),
      source: 'schedule',
      scheduleItemId: item.id,
      isRisk: item.status === 'Waiting' || item.priority === 'High',
    });
  });

  documents.forEach(document => {
    points.push({
      id: stableId('document', document.id),
      title: document.name || document.originalFileName,
      detail: `${document.category} document metadata ${document.isCurrent ? 'is current' : 'is available'}.`,
      occurredAt: normalizeDateValue(document.importedAt, generatedAt),
      source: 'document-metadata',
      documentId: document.id,
    });
  });

  reportHistory.forEach((report, index) => {
    points.push({
      id: stableId('report', report.id || report.generatedAt || index),
      title: report.title || report.reportType || 'Report generated',
      detail: `${report.reportType || 'Report'} history is available.`,
      occurredAt: normalizeDateValue(report.generatedAt || generatedAt, generatedAt),
      source: 'report-history',
      reportId: report.id || nullToUndefined(report.generatedAt) || String(index),
    });
  });

  return uniqueById(points).sort(compareTimelinePoints);
}

function timelineSegmentSummary(points: MemoryTimelinePoint[]) {
  const counts = {
    events: points.filter(point => point.source === 'project-event').length,
    updates: uniqueValues(points.map(point => point.updateId)).length,
    photos: uniqueValues(points.map(point => point.photoId)).length,
    schedule: uniqueValues(points.map(point => point.scheduleItemId)).length,
    reports: uniqueValues(points.map(point => point.reportId)).length,
    documents: uniqueValues(points.map(point => point.documentId)).length,
    risks: points.filter(point => point.isRisk).length,
  };
  const parts = [
    counts.events > 0 ? `${counts.events} event${counts.events === 1 ? '' : 's'}` : '',
    counts.updates > 0 ? `${counts.updates} update${counts.updates === 1 ? '' : 's'}` : '',
    counts.photos > 0 ? `${counts.photos} photo${counts.photos === 1 ? '' : 's'}` : '',
    counts.schedule > 0 ? `${counts.schedule} schedule item${counts.schedule === 1 ? '' : 's'}` : '',
    counts.reports > 0 ? `${counts.reports} report${counts.reports === 1 ? '' : 's'}` : '',
    counts.documents > 0 ? `${counts.documents} document${counts.documents === 1 ? '' : 's'}` : '',
    counts.risks > 0 ? `${counts.risks} risk signal${counts.risks === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  return parts.length > 0
    ? `Memory includes ${parts.join(', ')}.`
    : 'Memory has timeline points but no categorized activity.';
}

function memoryConfidence(
  parts: MemoryParts,
  gaps: PIEMemoryGap[],
): ProjectConfidenceLevel {
  const highPriorityGaps = gaps.filter(gap => gap.priority === 'high').length;
  const sourceCount = [
    parts.projectEvents.length > 0,
    parts.updates.length > 0,
    parts.photos.length > 0,
    parts.scheduleItems.length > 0,
    parts.documents.length > 0,
    parts.reportHistory.length > 0,
    parts.reasoning.thoughts.length > 0,
  ].filter(Boolean).length;

  if (sourceCount >= 5 && highPriorityGaps === 0) return 'high';
  if (sourceCount >= 2 && highPriorityGaps <= 1) return 'medium';

  return 'low';
}

function patternItem(pattern: PIEMemoryPattern): PIEMemoryPattern {
  return {
    ...pattern,
    evidence: uniqueValues(pattern.evidence),
  };
}

function gapItem(gap: PIEMemoryGap): PIEMemoryGap {
  return gap;
}

function insightItem(insight: PIEMemoryInsight): PIEMemoryInsight {
  return {
    ...insight,
    supportingPatternIds: uniqueValues(insight.supportingPatternIds),
    supportingGapIds: uniqueValues(insight.supportingGapIds),
    supportingEventIds: uniqueValues(insight.supportingEventIds),
  };
}

function relatedProjectEvents(projectName: string, events: ProjectEvent[]) {
  return events.filter(event => isSameProject(projectName, event.projectName));
}

function relatedReferenceDocuments(
  projectName: string,
  documents: ReferenceDocument[],
  scheduleItems: ScheduleItem[],
) {
  const normalizedProject = projectName.trim().toLowerCase();
  const scheduleSources = uniqueValues(scheduleItems.map(item => item.importedFrom))
    .map(source => source.toLowerCase());

  return documents.filter(document => {
    const category = document.category.trim().toLowerCase();
    const values = [
      document.name,
      document.originalFileName,
      document.category,
      document.notes,
      document.uri,
    ];

    return (
      values.some(value => value.toLowerCase().includes(normalizedProject)) ||
      scheduleSources.some(source =>
        values.some(value => value.toLowerCase().includes(source)),
      ) ||
      (category === 'schedules' && scheduleItems.length > 0)
    );
  });
}

function isSameProject(projectName: string, nextProjectName: string) {
  return projectName.trim().toLowerCase() === nextProjectName.trim().toLowerCase();
}

function isMemorySnapshot(
  value: PIEMemorySnapshot | BuildPIEMemoryParams,
): value is PIEMemorySnapshot {
  return 'story' in value && 'timelineSegments' in value;
}

function isRiskEvent(event: ProjectEvent) {
  return [
    'schedule_item_overdue',
    'issue_created',
    'safety_observation',
    'decision_recorded',
    'inspection_event',
  ].includes(event.eventType);
}

function eventIdsForRisk(events: ProjectEvent[]) {
  return events
    .filter(isRiskEvent)
    .slice(0, 6)
    .map(event => event.id);
}

function groupByMonth(points: MemoryTimelinePoint[]) {
  return points.reduce<Map<string, MemoryTimelinePoint[]>>((grouped, point) => {
    const key = monthKey(point.occurredAt);
    grouped.set(key, [...(grouped.get(key) || []), point]);
    return grouped;
  }, new Map());
}

function monthKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthTitle(key: string) {
  if (key === 'unknown') return 'Unknown Date';

  const [year, month] = key.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return key;

  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function uniqueEventTypes(points: MemoryTimelinePoint[]) {
  return Array.from(
    new Set(
      points
        .map(point => point.eventType)
        .filter((eventType): eventType is ProjectEventType => Boolean(eventType)),
    ),
  );
}

function firstDate(values: Array<string | null | undefined>) {
  return sortedDates(values)[0] ?? null;
}

function lastDate(values: Array<string | null | undefined>) {
  const dates = sortedDates(values);
  return dates[dates.length - 1] ?? null;
}

function sortedDates(values: Array<string | null | undefined>) {
  return values
    .map(value => normalizeOptionalDate(value))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeDateValue(value: string | null | undefined, fallback: string) {
  const normalized = normalizeOptionalDate(value);
  return normalized ?? fallback;
}

function normalizeOptionalDate(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const parsedDate = parseDueDate(trimmed) || parseFlexibleDate(trimmed);
  if (parsedDate) return parsedDate.toISOString();

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatMemoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function compareTimelinePoints(
  left: MemoryTimelinePoint,
  right: MemoryTimelinePoint,
) {
  return left.occurredAt.localeCompare(right.occurredAt);
}

function comparePriority<T extends { priority: PIEMemoryPriority }>(
  left: T,
  right: T,
) {
  const priorityRank: Record<PIEMemoryPriority, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  return priorityRank[right.priority] - priorityRank[left.priority];
}

function confidenceFromCount(count: number): ProjectConfidenceLevel {
  if (count >= 4) return 'high';
  if (count > 0) return 'medium';

  return 'low';
}

function uniqueValues(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const unique: string[] = [];

  values.forEach(value => {
    const trimmed = value?.trim();
    if (!trimmed) return;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    unique.push(trimmed);
  });

  return unique;
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];

  items.forEach(item => {
    if (seen.has(item.id)) return;

    seen.add(item.id);
    unique.push(item);
  });

  return unique;
}

function nullToUndefined(value: string | null | undefined) {
  return value ?? undefined;
}

function stableId(...parts: Array<string | number | null | undefined>) {
  return parts
    .map(part => String(part ?? 'none').trim().toLowerCase())
    .join('|')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}
