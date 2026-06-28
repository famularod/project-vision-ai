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
  ProjectIntelligenceSource,
  ProjectIntelligenceSummary,
  ProjectRecommendation,
  ProjectRiskSignal,
} from './ProjectIntelligenceEngine';
import type { ProjectEvent } from './ProjectEventService';

export type PIEPriority = 'low' | 'medium' | 'high';

export type PIEReasoningSource =
  | ProjectIntelligenceSource
  | 'project-intelligence'
  | 'project-event'
  | 'project-update'
  | 'schedule-item'
  | 'document'
  | 'reasoning';

export type PIEEvidence = {
  id: string;
  projectName: string;
  title: string;
  detail: string;
  source: PIEReasoningSource;
  confidence: ProjectConfidenceLevel;
  occurredAt: string | null;
  relatedEventId: string | null;
  relatedRecordId: string | null;
  metadata: Record<string, unknown>;
};

export type PIEFact = {
  id: string;
  projectName: string;
  statement: string;
  evidenceIds: string[];
  confidence: ProjectConfidenceLevel;
  source: PIEReasoningSource;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type PIEConcern = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  impact: string;
  evidenceIds: string[];
  confidence: ProjectConfidenceLevel;
  priority: PIEPriority;
  source: PIEReasoningSource;
  suggestedNextAction: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type PIEQuestion = {
  id: string;
  projectName: string;
  question: string;
  reason: string;
  evidenceIds: string[];
  confidence: ProjectConfidenceLevel;
  priority: PIEPriority;
  source: PIEReasoningSource;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type PIEThoughtRecommendation = {
  id: string;
  projectName: string;
  title: string;
  why: string;
  evidence: string[];
  confidence: ProjectConfidenceLevel;
  impact: string;
  suggestedNextAction: string;
  evidenceIds: string[];
  priority: PIEPriority;
  source: PIEReasoningSource;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type PIERelationship = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  factIds: string[];
  evidenceIds: string[];
  confidence: ProjectConfidenceLevel;
  source: PIEReasoningSource;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type PIECommunicationInsight = {
  projectName: string;
  readiness: ProjectIntelligenceSummary['communicationReadiness']['level'];
  summary: string;
  talkingPoints: string[];
  missingContext: string[];
  evidenceIds: string[];
  confidence: ProjectConfidenceLevel;
  createdAt: string;
};

export type PIEThought = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  evidence: PIEEvidence[];
  facts: PIEFact[];
  concern: PIEConcern | null;
  question: PIEQuestion | null;
  recommendation: PIEThoughtRecommendation | null;
  confidence: ProjectConfidenceLevel;
  priority: PIEPriority;
  createdAt: string;
  source: PIEReasoningSource;
};

export type PIEReasoningResult = {
  projectName: string;
  generatedAt: string;
  evidence: PIEEvidence[];
  facts: PIEFact[];
  relationships: PIERelationship[];
  concerns: PIEConcern[];
  questions: PIEQuestion[];
  recommendations: PIEThoughtRecommendation[];
  thoughts: PIEThought[];
  communicationInsight: PIECommunicationInsight;
};

export type BuildPIEReasoningParams = {
  projectName?: string;
  intelligence: ProjectIntelligenceSummary;
  projectEvents?: ProjectEvent[];
  updates?: ProjectUpdate[];
  scheduleItems?: ScheduleItem[];
  referenceDocuments?: ReferenceDocument[];
  now?: Date;
};

type ReasoningParts = {
  projectName: string;
  createdAt: string;
  intelligence: ProjectIntelligenceSummary;
  events: ProjectEvent[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  documents: ReferenceDocument[];
  evidence: PIEEvidence[];
  facts: PIEFact[];
  relationships: PIERelationship[];
  concerns: PIEConcern[];
  questions: PIEQuestion[];
  recommendations: PIEThoughtRecommendation[];
  communicationInsight: PIECommunicationInsight;
};

type PIEEvidenceInput = Omit<
  PIEEvidence,
  'occurredAt' | 'relatedEventId' | 'relatedRecordId' | 'metadata'
> &
  Partial<
    Pick<
      PIEEvidence,
      'occurredAt' | 'relatedEventId' | 'relatedRecordId' | 'metadata'
    >
  >;

export function buildPIEReasoning(
  params: BuildPIEReasoningParams,
): PIEReasoningResult {
  const parts = buildReasoningParts(params);
  const thoughts = buildThoughtsFromParts(parts);

  return {
    projectName: parts.projectName,
    generatedAt: parts.createdAt,
    evidence: parts.evidence,
    facts: parts.facts,
    relationships: parts.relationships,
    concerns: parts.concerns,
    questions: parts.questions,
    recommendations: parts.recommendations,
    thoughts,
    communicationInsight: parts.communicationInsight,
  };
}

export function buildPIEThoughts(
  params: BuildPIEReasoningParams,
): PIEThought[] {
  return buildThoughtsFromParts(buildReasoningParts(params));
}

export function getPIEConcerns(
  reasoning: PIEReasoningResult | PIEThought[],
): PIEConcern[] {
  if (Array.isArray(reasoning)) {
    return uniqueById(
      reasoning
        .map(thought => thought.concern)
        .filter((concern): concern is PIEConcern => Boolean(concern)),
    );
  }

  return reasoning.concerns;
}

export function getPIEQuestions(
  reasoning: PIEReasoningResult | PIEThought[],
): PIEQuestion[] {
  if (Array.isArray(reasoning)) {
    return uniqueById(
      reasoning
        .map(thought => thought.question)
        .filter((question): question is PIEQuestion => Boolean(question)),
    );
  }

  return reasoning.questions;
}

export function getPIERecommendations(
  reasoning: PIEReasoningResult | PIEThought[],
): PIEThoughtRecommendation[] {
  if (Array.isArray(reasoning)) {
    return uniqueById(
      reasoning
        .map(thought => thought.recommendation)
        .filter(
          (recommendation): recommendation is PIEThoughtRecommendation =>
            Boolean(recommendation),
        ),
    );
  }

  return reasoning.recommendations;
}

function buildReasoningParts({
  projectName: explicitProjectName,
  intelligence,
  projectEvents,
  updates = [],
  scheduleItems = [],
  referenceDocuments = [],
  now = new Date(),
}: BuildPIEReasoningParams): ReasoningParts {
  const projectName = explicitProjectName?.trim() || intelligence.projectName;
  const createdAt = now.toISOString();
  const events = relatedProjectEvents(
    projectName,
    projectEvents ?? intelligence.recentEvents,
  );
  const projectUpdates = updates.filter(update =>
    isSameProject(projectName, update.projectName),
  );
  const projectScheduleItems = scheduleItems.filter(item =>
    isSameProject(projectName, item.projectName),
  );
  const documents = relatedDocuments(projectName, referenceDocuments);
  const evidence = buildEvidence({
    projectName,
    intelligence,
    events,
    updates: projectUpdates,
    scheduleItems: projectScheduleItems,
    documents,
    createdAt,
    now,
  });
  const facts = buildFacts({
    projectName,
    intelligence,
    events,
    updates: projectUpdates,
    scheduleItems: projectScheduleItems,
    documents,
    evidence,
    createdAt,
  });
  const relationships = buildRelationships({
    projectName,
    intelligence,
    evidence,
    facts,
    createdAt,
  });
  const concerns = buildConcerns({
    projectName,
    intelligence,
    evidence,
    createdAt,
  });
  const questions = buildQuestions({
    projectName,
    intelligence,
    concerns,
    evidence,
    createdAt,
  });
  const recommendations = buildRecommendations({
    projectName,
    intelligence,
    concerns,
    evidence,
    createdAt,
  });
  const communicationInsight = buildCommunicationInsight({
    projectName,
    intelligence,
    evidence,
    facts,
    createdAt,
  });

  return {
    projectName,
    createdAt,
    intelligence,
    events,
    updates: projectUpdates,
    scheduleItems: projectScheduleItems,
    documents,
    evidence,
    facts,
    relationships,
    concerns,
    questions,
    recommendations,
    communicationInsight,
  };
}

function buildEvidence({
  projectName,
  intelligence,
  events,
  updates,
  scheduleItems,
  documents,
  createdAt,
  now,
}: {
  projectName: string;
  intelligence: ProjectIntelligenceSummary;
  events: ProjectEvent[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  documents: ReferenceDocument[];
  createdAt: string;
  now: Date;
}): PIEEvidence[] {
  const evidence: PIEEvidence[] = [
    evidenceItem({
      id: 'health-signal',
      projectName,
      title: intelligence.healthSignal.label,
      detail: intelligence.healthSignal.message,
      source: 'project-intelligence',
      confidence: intelligence.healthSignal.confidence,
      occurredAt: intelligence.generatedAt,
      metadata: {
        status: intelligence.healthStatus,
        score: intelligence.healthSignal.score,
        evidence: intelligence.healthSignal.evidence,
      },
    }),
    evidenceItem({
      id: 'confidence-signal',
      projectName,
      title: 'Project confidence',
      detail: intelligence.confidence.message,
      source: 'confidence',
      confidence: intelligence.confidence.level,
      occurredAt: intelligence.generatedAt,
      metadata: {
        score: intelligence.confidence.score,
        factors: intelligence.confidence.factors.map(factor => ({
          id: factor.id,
          present: factor.present,
          message: factor.message,
        })),
      },
    }),
    evidenceItem({
      id: 'communication-readiness',
      projectName,
      title: 'Communication readiness',
      detail: intelligence.communicationReadiness.message,
      source: 'project-intelligence',
      confidence: intelligence.communicationReadiness.confidence,
      occurredAt: intelligence.generatedAt,
      metadata: {
        score: intelligence.communicationReadiness.score,
        level: intelligence.communicationReadiness.level,
        strengths: intelligence.communicationReadiness.strengths,
        missingItems: intelligence.communicationReadiness.missingItems,
      },
    }),
  ];

  intelligence.riskSignals.forEach(risk => {
    evidence.push(evidenceFromRisk(projectName, risk, intelligence.generatedAt));
  });

  intelligence.recommendations.forEach(recommendation => {
    evidence.push(
      evidenceItem({
        id: stableId('pie-recommendation', recommendation.id),
        projectName,
        title: recommendation.title,
        detail: recommendation.reason,
        source: recommendation.source,
        confidence: recommendation.confidence,
        occurredAt: intelligence.generatedAt,
        relatedRecordId: recommendation.id,
        metadata: {
          action: recommendation.action,
          priority: recommendation.priority,
          sources: recommendation.sources,
        },
      }),
    );
  });

  events.forEach(event => {
    evidence.push(
      evidenceItem({
        id: stableId('event', event.id),
        projectName,
        title: event.title,
        detail: event.description,
        source: 'project-event',
        confidence: event.confidence,
        occurredAt: event.occurredAt,
        relatedEventId: event.id,
        relatedRecordId: event.id,
        metadata: {
          eventType: event.eventType,
          eventSource: event.source,
          relatedArea: event.relatedArea,
          relatedPeople: event.relatedPeople,
          relatedDocuments: event.relatedDocuments,
        },
      }),
    );
  });

  updates.forEach(update => {
    if (update.notes.trim()) {
      evidence.push(
        evidenceItem({
          id: stableId('update-note', update.id),
          projectName,
          title: 'Typed update note',
          detail: update.notes.trim(),
          source: 'typed-update',
          confidence: 'high',
          occurredAt: normalizeDateValue(update.date, createdAt),
          relatedRecordId: update.id,
          metadata: {
            selectedAreaId: update.selectedAreaId ?? null,
            selectedAreaName: update.selectedAreaName ?? null,
            photoCount: update.photos.length,
          },
        }),
      );
    }

    update.photos.forEach(photo => {
      evidence.push(...evidenceFromPhoto(projectName, update, photo, createdAt));
    });
  });

  scheduleItems.forEach(item => {
    const dueDate = parseFlexibleDate(item.finishDate);
    const isOverdue =
      item.status !== 'Complete' &&
      item.percentComplete < 100 &&
      Boolean(dueDate && dueDate < startOfDay(now));
    const shouldSurface =
      isOverdue ||
      item.status === 'Waiting' ||
      item.priority === 'High' ||
      Boolean(item.notes.trim());

    if (!shouldSurface) return;

    evidence.push(
      evidenceItem({
        id: stableId('schedule-item', item.id),
        projectName,
        title: item.taskName || 'Schedule item',
        detail: scheduleEvidenceDetail(item, isOverdue),
        source: 'schedule',
        confidence: item.finishDate.trim() ? 'high' : 'medium',
        occurredAt: normalizeDateValue(item.finishDate || item.createdAt, createdAt),
        relatedRecordId: item.id,
        metadata: {
          status: item.status,
          priority: item.priority,
          owner: item.owner,
          contractor: item.contractor,
          percentComplete: item.percentComplete,
          finishDate: item.finishDate,
          isOverdue,
        },
      }),
    );
  });

  documents.forEach(document => {
    evidence.push(
      evidenceItem({
        id: stableId('document', document.id),
        projectName,
        title: document.name || document.originalFileName,
        detail: document.notes.trim() || `${document.category} document metadata is available.`,
        source: 'document-metadata',
        confidence: document.isCurrent ? 'high' : 'medium',
        occurredAt: normalizeDateValue(document.importedAt, createdAt),
        relatedRecordId: document.id,
        metadata: {
          category: document.category,
          isCurrent: document.isCurrent,
          originalFileName: document.originalFileName,
        },
      }),
    );
  });

  return uniqueById(evidence);
}

function buildFacts({
  projectName,
  intelligence,
  events,
  updates,
  scheduleItems,
  documents,
  evidence,
  createdAt,
}: {
  projectName: string;
  intelligence: ProjectIntelligenceSummary;
  events: ProjectEvent[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  documents: ReferenceDocument[];
  evidence: PIEEvidence[];
  createdAt: string;
}): PIEFact[] {
  const facts: PIEFact[] = [
    factItem({
      id: 'health-status',
      projectName,
      statement: `Project health is ${intelligence.healthStatus}.`,
      evidenceIds: evidenceIdsBySource(evidence, ['project-intelligence']),
      confidence: intelligence.healthSignal.confidence,
      source: 'project-intelligence',
      createdAt,
      metadata: {
        score: intelligence.healthSignal.score,
      },
    }),
    factItem({
      id: 'schedule-status',
      projectName,
      statement: `Schedule status is ${intelligence.scheduleStatus}.`,
      evidenceIds: evidenceIdsBySource(evidence, ['schedule', 'project-event']),
      confidence: confidenceFromCounts(intelligence.metrics.scheduleItemCount),
      source: 'schedule',
      createdAt,
      metadata: {
        scheduleItemCount: intelligence.metrics.scheduleItemCount,
        overdueScheduleItems: intelligence.overdueScheduleItems,
        upcomingScheduleItems: intelligence.upcomingScheduleItems,
      },
    }),
    factItem({
      id: 'progress-status',
      projectName,
      statement:
        intelligence.metrics.averageScheduleProgress === null
          ? 'Average schedule progress is not available.'
          : `Average schedule progress is ${intelligence.metrics.averageScheduleProgress}%.`,
      evidenceIds: evidenceIdsBySource(evidence, ['schedule']),
      confidence: confidenceFromCounts(intelligence.metrics.scheduleItemCount),
      source: 'schedule',
      createdAt,
      metadata: {
        progressStatus: intelligence.progressStatus,
      },
    }),
    factItem({
      id: 'confidence-level',
      projectName,
      statement: `Project intelligence confidence is ${intelligence.confidence.level} at ${intelligence.confidence.score}%.`,
      evidenceIds: evidenceIdsBySource(evidence, ['confidence']),
      confidence: intelligence.confidence.level,
      source: 'confidence',
      createdAt,
      metadata: {
        score: intelligence.confidence.score,
      },
    }),
    factItem({
      id: 'communication-readiness',
      projectName,
      statement: `Communication readiness is ${intelligence.communicationReadiness.level}.`,
      evidenceIds: evidenceIdsBySource(evidence, ['project-intelligence', 'document-metadata']),
      confidence: intelligence.communicationReadiness.confidence,
      source: 'project-intelligence',
      createdAt,
      metadata: {
        score: intelligence.communicationReadiness.score,
      },
    }),
    factItem({
      id: 'latest-activity',
      projectName,
      statement: intelligence.latestActivity
        ? `Latest project activity was recorded at ${intelligence.latestActivity}.`
        : 'No latest project activity event is available.',
      evidenceIds: evidenceIdsBySource(evidence, ['project-event', 'typed-update']),
      confidence: intelligence.latestActivity ? 'medium' : 'low',
      source: 'project-event',
      createdAt,
      metadata: {
        latestActivity: intelligence.latestActivity,
        daysSinceLatestActivity: intelligence.metrics.daysSinceLatestActivity,
      },
    }),
    factItem({
      id: 'event-memory',
      projectName,
      statement: `${events.length} project event${events.length === 1 ? '' : 's'} are available for reasoning.`,
      evidenceIds: evidenceIdsBySource(evidence, ['project-event']),
      confidence: confidenceFromCounts(events.length),
      source: 'project-event',
      createdAt,
      metadata: {
        eventCount: events.length,
      },
    }),
    factItem({
      id: 'issue-counts',
      projectName,
      statement: `${intelligence.metrics.openIssueCount} open issue${intelligence.metrics.openIssueCount === 1 ? '' : 's'} and ${intelligence.metrics.safetyConcernCount} safety concern${intelligence.metrics.safetyConcernCount === 1 ? '' : 's'} are visible to PIE.`,
      evidenceIds: evidenceIdsBySource(evidence, ['photo-action', 'photo-category', 'project-event']),
      confidence:
        intelligence.metrics.openIssueCount > 0 ||
        intelligence.metrics.safetyConcernCount > 0
          ? 'high'
          : 'medium',
      source: 'photo-action',
      createdAt,
      metadata: {
        openIssueCount: intelligence.metrics.openIssueCount,
        safetyConcernCount: intelligence.metrics.safetyConcernCount,
      },
    }),
    factItem({
      id: 'document-context',
      projectName,
      statement: `${documents.length} related document${documents.length === 1 ? '' : 's'} are available, including ${intelligence.metrics.currentDocumentCount} current document${intelligence.metrics.currentDocumentCount === 1 ? '' : 's'}.`,
      evidenceIds: evidenceIdsBySource(evidence, ['document-metadata']),
      confidence: confidenceFromCounts(documents.length),
      source: 'document-metadata',
      createdAt,
      metadata: {
        documentCount: documents.length,
        currentDocumentCount: intelligence.metrics.currentDocumentCount,
      },
    }),
  ];

  if (updates.length > 0) {
    facts.push(
      factItem({
        id: 'update-history',
        projectName,
        statement: `${updates.length} update${updates.length === 1 ? '' : 's'} and ${intelligence.photoCount} photo${intelligence.photoCount === 1 ? '' : 's'} are available.`,
        evidenceIds: evidenceIdsBySource(evidence, ['typed-update', 'photo', 'photo-caption']),
        confidence: 'high',
        source: 'typed-update',
        createdAt,
        metadata: {
          updateCount: updates.length,
          photoCount: intelligence.photoCount,
          noteCount: intelligence.metrics.noteCount,
          captionCount: intelligence.metrics.captionCount,
        },
      }),
    );
  }

  if (scheduleItems.length > 0) {
    facts.push(
      factItem({
        id: 'schedule-responsibility',
        projectName,
        statement: `${intelligence.metrics.scheduleOwnerCount} schedule owner${intelligence.metrics.scheduleOwnerCount === 1 ? '' : 's'} and ${intelligence.metrics.scheduleContractorCount} contractor${intelligence.metrics.scheduleContractorCount === 1 ? '' : 's'} are identified.`,
        evidenceIds: evidenceIdsBySource(evidence, ['schedule']),
        confidence:
          intelligence.metrics.scheduleOwnerCount > 0 ||
          intelligence.metrics.scheduleContractorCount > 0
            ? 'medium'
            : 'low',
        source: 'schedule',
        createdAt,
        metadata: {
          ownerCount: intelligence.metrics.scheduleOwnerCount,
          contractorCount: intelligence.metrics.scheduleContractorCount,
        },
      }),
    );
  }

  return uniqueById(facts);
}

function buildRelationships({
  projectName,
  intelligence,
  evidence,
  facts,
  createdAt,
}: {
  projectName: string;
  intelligence: ProjectIntelligenceSummary;
  evidence: PIEEvidence[];
  facts: PIEFact[];
  createdAt: string;
}): PIERelationship[] {
  const relationships: PIERelationship[] = [];

  if (intelligence.overdueScheduleItems > 0) {
    relationships.push(
      relationshipItem({
        id: 'schedule-risk-relationship',
        projectName,
        title: 'Schedule evidence is driving risk',
        summary: 'Overdue schedule evidence is connected to project health, concerns, and recommended next action.',
        factIds: factIdsById(facts, ['schedule-status', 'progress-status']),
        evidenceIds: evidenceIdsBySource(evidence, ['schedule', 'project-event']),
        confidence: 'high',
        source: 'reasoning',
        createdAt,
        metadata: {
          overdueScheduleItems: intelligence.overdueScheduleItems,
        },
      }),
    );
  }

  if (
    intelligence.metrics.openIssueCount > 0 ||
    intelligence.metrics.safetyConcernCount > 0 ||
    intelligence.metrics.photoActionCount > 0
  ) {
    relationships.push(
      relationshipItem({
        id: 'field-action-relationship',
        projectName,
        title: 'Field photos are creating action signals',
        summary: 'Photo categories and action fields connect field evidence to concerns and follow-up recommendations.',
        factIds: factIdsById(facts, ['issue-counts', 'update-history']),
        evidenceIds: evidenceIdsBySource(evidence, ['photo-action', 'photo-category', 'photo-caption']),
        confidence: 'high',
        source: 'reasoning',
        createdAt,
        metadata: {
          openIssueCount: intelligence.metrics.openIssueCount,
          safetyConcernCount: intelligence.metrics.safetyConcernCount,
          photoActionCount: intelligence.metrics.photoActionCount,
        },
      }),
    );
  }

  if (intelligence.communicationReadiness.level !== 'ready') {
    relationships.push(
      relationshipItem({
        id: 'communication-context-relationship',
        projectName,
        title: 'Missing context affects communication readiness',
        summary: 'PIE is connecting missing notes, photos, recipients, documents, or sync freshness to stakeholder communication quality.',
        factIds: factIdsById(facts, ['communication-readiness', 'document-context', 'confidence-level']),
        evidenceIds: evidenceIdsBySource(evidence, ['project-intelligence', 'document-metadata', 'confidence']),
        confidence: intelligence.communicationReadiness.confidence,
        source: 'reasoning',
        createdAt,
        metadata: {
          missingItems: intelligence.communicationReadiness.missingItems,
        },
      }),
    );
  }

  return uniqueById(relationships);
}

function buildConcerns({
  projectName,
  intelligence,
  evidence,
  createdAt,
}: {
  projectName: string;
  intelligence: ProjectIntelligenceSummary;
  evidence: PIEEvidence[];
  createdAt: string;
}): PIEConcern[] {
  const concerns = intelligence.riskSignals.map(risk =>
    concernFromRisk(projectName, risk, evidence, createdAt),
  );

  if (intelligence.healthStatus === 'at-risk' || intelligence.healthStatus === 'watch') {
    concerns.push(
      concernItem({
        id: 'project-health-concern',
        projectName,
        title: intelligence.healthSignal.label,
        summary: intelligence.healthSignal.message,
        impact:
          intelligence.healthStatus === 'at-risk'
            ? 'Project risk may affect schedule, safety, or stakeholder confidence.'
            : 'Project should be monitored before risks become harder to correct.',
        evidenceIds: evidenceIdsBySource(evidence, ['project-intelligence', 'confidence']),
        confidence: intelligence.healthSignal.confidence,
        priority: intelligence.healthStatus === 'at-risk' ? 'high' : 'medium',
        source: 'project-intelligence',
        suggestedNextAction: intelligence.recommendedNextAction.description,
        createdAt,
        metadata: {
          healthStatus: intelligence.healthStatus,
          healthScore: intelligence.healthSignal.score,
        },
      }),
    );
  }

  if (intelligence.confidence.level === 'low') {
    concerns.push(
      concernItem({
        id: 'low-confidence-concern',
        projectName,
        title: 'Project context is limited',
        summary: intelligence.confidence.message,
        impact: 'PIE may be missing project reality needed for confident decisions.',
        evidenceIds: evidenceIdsBySource(evidence, ['confidence']),
        confidence: 'high',
        priority: 'medium',
        source: 'confidence',
        suggestedNextAction: 'Capture updates, photos, schedule items, or document context.',
        createdAt,
        metadata: {
          confidenceScore: intelligence.confidence.score,
        },
      }),
    );
  }

  if (intelligence.communicationReadiness.level === 'not-ready') {
    concerns.push(
      concernItem({
        id: 'communication-not-ready-concern',
        projectName,
        title: 'Communication is not ready',
        summary: intelligence.communicationReadiness.message,
        impact: 'A stakeholder update may be incomplete or misleading without more context.',
        evidenceIds: evidenceIdsBySource(evidence, ['project-intelligence', 'document-metadata']),
        confidence: intelligence.communicationReadiness.confidence,
        priority: 'medium',
        source: 'project-intelligence',
        suggestedNextAction: 'Capture missing context before preparing stakeholder communication.',
        createdAt,
        metadata: {
          missingItems: intelligence.communicationReadiness.missingItems,
        },
      }),
    );
  }

  return uniqueById(concerns);
}

function buildQuestions({
  projectName,
  intelligence,
  concerns,
  evidence,
  createdAt,
}: {
  projectName: string;
  intelligence: ProjectIntelligenceSummary;
  concerns: PIEConcern[];
  evidence: PIEEvidence[];
  createdAt: string;
}): PIEQuestion[] {
  const questions: PIEQuestion[] = concerns
    .map(concern => questionForConcern(projectName, concern, evidence, createdAt))
    .filter((question): question is PIEQuestion => Boolean(question));

  if (
    intelligence.communicationReadiness.level !== 'ready' &&
    intelligence.communicationReadiness.missingItems.length > 0
  ) {
    questions.push(
      questionItem({
        id: 'communication-context-question',
        projectName,
        question: 'What context should be added before sharing this project status?',
        reason: intelligence.communicationReadiness.missingItems[0],
        evidenceIds: evidenceIdsBySource(evidence, ['project-intelligence']),
        confidence: intelligence.communicationReadiness.confidence,
        priority: 'medium',
        source: 'project-intelligence',
        createdAt,
        metadata: {
          missingItems: intelligence.communicationReadiness.missingItems,
        },
      }),
    );
  }

  if (questions.length === 0 && intelligence.recommendedNextAction.action === 'continue-monitoring') {
    questions.push(
      questionItem({
        id: 'next-verification-question',
        projectName,
        question: 'Is there anything new in the field that has not been captured yet?',
        reason: 'PIE does not see urgent risks, so the useful next question is whether the record is current.',
        evidenceIds: evidenceIdsBySource(evidence, ['project-intelligence', 'project-event']),
        confidence: 'medium',
        priority: 'low',
        source: 'reasoning',
        createdAt,
        metadata: {},
      }),
    );
  }

  return uniqueById(questions);
}

function buildRecommendations({
  projectName,
  intelligence,
  concerns,
  evidence,
  createdAt,
}: {
  projectName: string;
  intelligence: ProjectIntelligenceSummary;
  concerns: PIEConcern[];
  evidence: PIEEvidence[];
  createdAt: string;
}): PIEThoughtRecommendation[] {
  const recommendations = intelligence.recommendations.map(recommendation =>
    recommendationFromPIE(projectName, recommendation, evidence, createdAt),
  );

  concerns.forEach(concern => {
    if (
      recommendations.some(recommendation =>
        recommendation.suggestedNextAction === concern.suggestedNextAction,
      )
    ) {
      return;
    }

    recommendations.push(
      recommendationItem({
        id: stableId('concern-recommendation', concern.id),
        projectName,
        title: concern.suggestedNextAction,
        why: concern.summary,
        evidence: evidenceDetails(evidence, concern.evidenceIds),
        confidence: concern.confidence,
        impact: concern.impact,
        suggestedNextAction: concern.suggestedNextAction,
        evidenceIds: concern.evidenceIds,
        priority: concern.priority,
        source: concern.source,
        createdAt,
        metadata: {
          concernId: concern.id,
        },
      }),
    );
  });

  return uniqueById(recommendations).sort(comparePriority);
}

function buildCommunicationInsight({
  projectName,
  intelligence,
  evidence,
  facts,
  createdAt,
}: {
  projectName: string;
  intelligence: ProjectIntelligenceSummary;
  evidence: PIEEvidence[];
  facts: PIEFact[];
  createdAt: string;
}): PIECommunicationInsight {
  const healthFact = facts.find(fact => fact.id === 'health-status');
  const scheduleFact = facts.find(fact => fact.id === 'schedule-status');
  const issueFact = facts.find(fact => fact.id === 'issue-counts');
  const nextAction = intelligence.recommendedNextAction;
  const talkingPoints = [
    healthFact?.statement,
    scheduleFact?.statement,
    issueFact?.statement,
    `Recommended next action: ${nextAction.label}.`,
  ].filter((point): point is string => Boolean(point));

  return {
    projectName,
    readiness: intelligence.communicationReadiness.level,
    summary:
      intelligence.communicationReadiness.level === 'ready'
        ? 'PIE sees enough project context to support a stakeholder-ready update.'
        : intelligence.communicationReadiness.level === 'needs-context'
          ? 'PIE can support a draft, but the communication should be reviewed for missing context.'
          : 'PIE needs more project context before this is ready for stakeholder communication.',
    talkingPoints,
    missingContext: intelligence.communicationReadiness.missingItems,
    evidenceIds: evidenceIdsBySource(evidence, ['project-intelligence', 'typed-update', 'photo-caption', 'schedule', 'document-metadata']),
    confidence: intelligence.communicationReadiness.confidence,
    createdAt,
  };
}

function buildThoughtsFromParts(parts: ReasoningParts): PIEThought[] {
  const thoughts: PIEThought[] = [];
  const statusFacts = factsById(parts.facts, [
    'health-status',
    'schedule-status',
    'progress-status',
    'confidence-level',
  ]);

  thoughts.push(
    thoughtItem({
      id: 'project-status-thought',
      projectName: parts.projectName,
      title:
        parts.intelligence.healthStatus === 'healthy'
          ? 'Project status is understandable'
          : 'Project status needs attention',
      summary: parts.intelligence.healthSignal.message,
      evidence: evidenceByIds(
        parts.evidence,
        uniqueValues(statusFacts.flatMap(fact => fact.evidenceIds)).slice(0, 8),
      ),
      facts: statusFacts,
      concern: firstConcern(parts.concerns, ['project-health-concern']),
      question: firstQuestion(parts.questions, ['next-verification-question']),
      recommendation: recommendationForAction(
        parts.recommendations,
        parts.intelligence.recommendedNextAction.action,
      ),
      confidence: parts.intelligence.healthSignal.confidence,
      priority:
        parts.intelligence.healthStatus === 'at-risk'
          ? 'high'
          : parts.intelligence.healthStatus === 'watch'
            ? 'medium'
            : 'low',
      createdAt: parts.createdAt,
      source: 'project-intelligence',
    }),
  );

  if (parts.events.length > 0 || parts.updates.length > 0) {
    const recentFacts = factsById(parts.facts, [
      'latest-activity',
      'event-memory',
      'update-history',
    ]);

    thoughts.push(
      thoughtItem({
        id: 'recent-activity-thought',
        projectName: parts.projectName,
        title: 'Recent activity is becoming a project story',
        summary: parts.intelligence.projectStory.summary,
        evidence: evidenceBySource(parts.evidence, ['project-event', 'typed-update', 'photo-caption']).slice(0, 8),
        facts: recentFacts,
        concern: firstConcern(parts.concerns, ['stale-update', 'missing-updates']),
        question: firstQuestion(parts.questions, ['stale-update-question', 'missing-updates-question']),
        recommendation: recommendationForAction(parts.recommendations, 'capture-update'),
        confidence: confidenceFromCounts(parts.events.length + parts.updates.length),
        priority: parts.intelligence.metrics.daysSinceLastUpdate !== null &&
          parts.intelligence.metrics.daysSinceLastUpdate > 7
          ? 'medium'
          : 'low',
        createdAt: parts.createdAt,
        source: 'project-event',
      }),
    );
  }

  if (
    parts.intelligence.metrics.scheduleItemCount > 0 ||
    hasConcern(parts.concerns, ['missing-schedule', 'overdue-schedule'])
  ) {
    const scheduleConcern = firstConcern(parts.concerns, [
      'overdue-schedule',
      'waiting-schedule-items',
      'high-priority-schedule',
      'missing-schedule',
    ]);

    thoughts.push(
      thoughtItem({
        id: 'schedule-reasoning-thought',
        projectName: parts.projectName,
        title: scheduleConcern ? 'Schedule needs review' : 'Schedule context is available',
        summary:
          scheduleConcern?.summary ||
          `PIE sees ${parts.intelligence.metrics.scheduleItemCount} schedule item${parts.intelligence.metrics.scheduleItemCount === 1 ? '' : 's'} for this project.`,
        evidence: evidenceBySource(parts.evidence, ['schedule', 'project-event']).slice(0, 8),
        facts: factsById(parts.facts, [
          'schedule-status',
          'progress-status',
          'schedule-responsibility',
        ]),
        concern: scheduleConcern,
        question: firstQuestion(parts.questions, [
          'overdue-schedule-question',
          'waiting-schedule-items-question',
          'missing-schedule-question',
        ]),
        recommendation:
          recommendationForAction(parts.recommendations, 'review-overdue-schedule') ||
          recommendationForAction(parts.recommendations, 'review-upcoming-schedule') ||
          recommendationForAction(parts.recommendations, 'add-schedule'),
        confidence: confidenceFromCounts(parts.intelligence.metrics.scheduleItemCount),
        priority: scheduleConcern?.priority ?? 'low',
        createdAt: parts.createdAt,
        source: 'schedule',
      }),
    );
  }

  if (
    parts.intelligence.metrics.openIssueCount > 0 ||
    parts.intelligence.metrics.safetyConcernCount > 0 ||
    parts.intelligence.metrics.photoActionCount > 0
  ) {
    const issueConcern = firstConcern(parts.concerns, [
      'open-safety',
      'overdue-photo-actions',
      'open-issues',
      'unassigned-photo-actions',
    ]);

    thoughts.push(
      thoughtItem({
        id: 'issue-safety-thought',
        projectName: parts.projectName,
        title: issueConcern ? 'Issue and safety follow-up is needed' : 'Issue and safety context is visible',
        summary:
          issueConcern?.summary ||
          `${parts.intelligence.metrics.openIssueCount} open issue${parts.intelligence.metrics.openIssueCount === 1 ? '' : 's'} and ${parts.intelligence.metrics.safetyConcernCount} safety concern${parts.intelligence.metrics.safetyConcernCount === 1 ? '' : 's'} are visible.`,
        evidence: evidenceBySource(parts.evidence, ['photo-action', 'photo-category', 'photo-caption', 'project-event']).slice(0, 8),
        facts: factsById(parts.facts, ['issue-counts', 'update-history']),
        concern: issueConcern,
        question: firstQuestion(parts.questions, [
          'open-safety-question',
          'open-issues-question',
          'unassigned-photo-actions-question',
        ]),
        recommendation:
          recommendationForAction(parts.recommendations, 'review-safety') ||
          recommendationForAction(parts.recommendations, 'review-open-issues') ||
          recommendationForAction(parts.recommendations, 'review-photo-actions') ||
          recommendationForAction(parts.recommendations, 'assign-action-owner'),
        confidence: 'high',
        priority: issueConcern?.priority ?? 'medium',
        createdAt: parts.createdAt,
        source: 'photo-action',
      }),
    );
  }

  if (parts.intelligence.metrics.openDecisionCount > 0) {
    thoughts.push(
      thoughtItem({
        id: 'open-decision-thought',
        projectName: parts.projectName,
        title: 'Open decisions need closure',
        summary: `${parts.intelligence.metrics.openDecisionCount} decision event${parts.intelligence.metrics.openDecisionCount === 1 ? '' : 's'} still need review.`,
        evidence: evidenceBySource(parts.evidence, ['project-event']).slice(0, 8),
        facts: factsById(parts.facts, ['event-memory']),
        concern: firstConcern(parts.concerns, ['open-decisions']),
        question: firstQuestion(parts.questions, ['open-decisions-question']),
        recommendation: recommendationForAction(parts.recommendations, 'review-decisions'),
        confidence: 'medium',
        priority: 'medium',
        createdAt: parts.createdAt,
        source: 'project-event',
      }),
    );
  }

  thoughts.push(
    thoughtItem({
      id: 'communication-insight-thought',
      projectName: parts.projectName,
      title:
        parts.communicationInsight.readiness === 'ready'
          ? 'Communication is ready to prepare'
          : 'Communication needs context',
      summary: parts.communicationInsight.summary,
      evidence: evidenceByIds(parts.evidence, parts.communicationInsight.evidenceIds).slice(0, 8),
      facts: factsById(parts.facts, [
        'communication-readiness',
        'document-context',
        'health-status',
        'schedule-status',
      ]),
      concern: firstConcern(parts.concerns, ['communication-not-ready-concern']),
      question: firstQuestion(parts.questions, ['communication-context-question']),
      recommendation:
        recommendationForAction(parts.recommendations, 'generate-report') ||
        recommendationForAction(parts.recommendations, 'review-documents') ||
        recommendationForAction(parts.recommendations, 'capture-update'),
      confidence: parts.communicationInsight.confidence,
      priority: parts.communicationInsight.readiness === 'not-ready' ? 'medium' : 'low',
      createdAt: parts.createdAt,
      source: 'project-intelligence',
    }),
  );

  return uniqueById(thoughts).sort(comparePriority);
}

function evidenceFromRisk(
  projectName: string,
  risk: ProjectRiskSignal,
  occurredAt: string,
) {
  return evidenceItem({
    id: stableId('risk', risk.id),
    projectName,
    title: risk.label,
    detail: `${risk.message} ${risk.suggestedAction}`,
    source: risk.source,
    confidence: risk.confidence,
    occurredAt,
    relatedRecordId: risk.id,
    metadata: {
      severity: risk.severity,
      count: risk.count ?? null,
      evidence: risk.evidence,
      sources: risk.sources,
    },
  });
}

function evidenceFromPhoto(
  projectName: string,
  update: ProjectUpdate,
  photo: UpdatePhoto,
  fallbackDate: string,
): PIEEvidence[] {
  const evidence: PIEEvidence[] = [
    evidenceItem({
      id: stableId('photo-category', update.id, photo.id),
      projectName,
      title: `${photo.category} photo`,
      detail: photo.caption.trim() || `${photo.category} photo captured.`,
      source: 'photo-category',
      confidence: 'high',
      occurredAt: normalizeDateValue(photo.locationCapturedAt || update.date, fallbackDate),
      relatedRecordId: photo.id,
      metadata: {
        updateId: update.id,
        category: photo.category,
        selectedAreaId: photo.selectedAreaId ?? update.selectedAreaId ?? null,
        selectedAreaName: photo.selectedAreaName ?? update.selectedAreaName ?? null,
      },
    }),
  ];

  if (photo.caption.trim()) {
    evidence.push(
      evidenceItem({
        id: stableId('photo-caption', update.id, photo.id),
        projectName,
        title: 'Photo caption',
        detail: photo.caption.trim(),
        source: 'photo-caption',
        confidence: 'high',
        occurredAt: normalizeDateValue(photo.locationCapturedAt || update.date, fallbackDate),
        relatedRecordId: photo.id,
        metadata: {
          updateId: update.id,
          category: photo.category,
        },
      }),
    );
  }

  if (
    photo.actionRequired.trim() ||
    photo.actionOwner.trim() ||
    photo.actionDueDate.trim()
  ) {
    evidence.push(
      evidenceItem({
        id: stableId('photo-action', update.id, photo.id),
        projectName,
        title: 'Photo action',
        detail: photo.actionRequired.trim() || `${photo.actionStatus} action captured from photo.`,
        source: 'photo-action',
        confidence: photo.actionRequired.trim() ? 'high' : 'medium',
        occurredAt: normalizeDateValue(photo.locationCapturedAt || update.date, fallbackDate),
        relatedRecordId: photo.id,
        metadata: {
          updateId: update.id,
          actionOwner: photo.actionOwner,
          actionDueDate: photo.actionDueDate,
          actionStatus: photo.actionStatus,
        },
      }),
    );
  }

  return evidence;
}

function concernFromRisk(
  projectName: string,
  risk: ProjectRiskSignal,
  evidence: PIEEvidence[],
  createdAt: string,
) {
  return concernItem({
    id: risk.id,
    projectName,
    title: risk.label,
    summary: risk.message,
    impact: impactForRisk(risk),
    evidenceIds: matchingEvidenceIds(evidence, risk.source, risk.id),
    confidence: risk.confidence,
    priority: priorityForRisk(risk),
    source: risk.source,
    suggestedNextAction: risk.suggestedAction,
    createdAt,
    metadata: {
      severity: risk.severity,
      count: risk.count ?? null,
      evidence: risk.evidence,
      sources: risk.sources,
    },
  });
}

function questionForConcern(
  projectName: string,
  concern: PIEConcern,
  evidence: PIEEvidence[],
  createdAt: string,
): PIEQuestion | null {
  const mapping: Record<string, string> = {
    'missing-updates': 'What changed on site since the last captured update?',
    'stale-update': 'Is the latest saved update still accurate, or should a fresh update be captured?',
    'missing-schedule': 'Which schedule or milestone should PIE use for this project?',
    'overdue-schedule': 'What is blocking the overdue schedule work, and who owns recovery?',
    'open-safety': 'Who owns each open safety concern, and what is the closure target?',
    'open-issues': 'Which open issues still need owner, due date, or closure?',
    'overdue-photo-actions': 'Which overdue photo actions need escalation today?',
    'unassigned-photo-actions': 'Who should own the unassigned photo actions?',
    'waiting-schedule-items': 'What is each waiting schedule item waiting on?',
    'high-priority-schedule': 'Which high-priority schedule work needs confirmation first?',
    'missing-area-context': 'Which project areas should future updates be tied to?',
    'missing-document-context': 'Which reference documents should be linked to this project?',
    'no-current-documents': 'Which document should be marked as the current reference?',
    'missing-schedule-document': 'Which schedule document should be classified as the current schedule reference?',
    'sync-conflicts': 'Which sync conflicts need review before this status is shared?',
    'queued-sync-changes': 'Should local changes be synced before this project is communicated?',
    'stale-sync': 'Should cloud sync be refreshed before relying on cloud status?',
    'open-decisions': 'What decision outcome should be recorded so this item can be closed?',
    'project-health-concern': 'What action would most improve this project status today?',
    'low-confidence-concern': 'What missing project context would most improve PIE confidence?',
    'communication-not-ready-concern': 'What context is needed before this can become a stakeholder update?',
  };
  const question = mapping[concern.id];

  if (!question) return null;

  return questionItem({
    id: stableId(concern.id, 'question'),
    projectName,
    question,
    reason: concern.summary,
    evidenceIds: concern.evidenceIds.length > 0
      ? concern.evidenceIds
      : matchingEvidenceIds(evidence, concern.source, concern.id),
    confidence: concern.confidence,
    priority: concern.priority,
    source: concern.source,
    createdAt,
    metadata: {
      concernId: concern.id,
    },
  });
}

function recommendationFromPIE(
  projectName: string,
  recommendation: ProjectRecommendation,
  evidence: PIEEvidence[],
  createdAt: string,
) {
  const evidenceIds = matchingEvidenceIds(
    evidence,
    recommendation.source,
    recommendation.id,
  );

  return recommendationItem({
    id: recommendation.id,
    projectName,
    title: recommendation.title,
    why: recommendation.reason,
    evidence: evidenceDetails(evidence, evidenceIds),
    confidence: recommendation.confidence,
    impact: impactForAction(recommendation.action),
    suggestedNextAction: recommendation.title,
    evidenceIds,
    priority: recommendation.priority,
    source: recommendation.source,
    createdAt,
    metadata: {
      action: recommendation.action,
      sources: recommendation.sources,
    },
  });
}

function evidenceItem({
  id,
  projectName,
  title,
  detail,
  source,
  confidence,
  occurredAt = null,
  relatedEventId = null,
  relatedRecordId = null,
  metadata = {},
}: PIEEvidenceInput): PIEEvidence {
  return {
    id,
    projectName,
    title,
    detail,
    source,
    confidence,
    occurredAt,
    relatedEventId,
    relatedRecordId,
    metadata,
  };
}

function factItem(fact: PIEFact): PIEFact {
  return {
    ...fact,
    evidenceIds: uniqueValues(fact.evidenceIds),
  };
}

function concernItem(concern: PIEConcern): PIEConcern {
  return {
    ...concern,
    evidenceIds: uniqueValues(concern.evidenceIds),
  };
}

function questionItem(question: PIEQuestion): PIEQuestion {
  return {
    ...question,
    evidenceIds: uniqueValues(question.evidenceIds),
  };
}

function recommendationItem(
  recommendation: PIEThoughtRecommendation,
): PIEThoughtRecommendation {
  return {
    ...recommendation,
    evidenceIds: uniqueValues(recommendation.evidenceIds),
  };
}

function relationshipItem(relationship: PIERelationship): PIERelationship {
  return {
    ...relationship,
    factIds: uniqueValues(relationship.factIds),
    evidenceIds: uniqueValues(relationship.evidenceIds),
  };
}

function thoughtItem(thought: PIEThought): PIEThought {
  return thought;
}

function relatedProjectEvents(projectName: string, events: ProjectEvent[]) {
  return events.filter(event => isSameProject(projectName, event.projectName));
}

function relatedDocuments(
  projectName: string,
  documents: ReferenceDocument[],
) {
  const normalizedProject = projectName.trim().toLowerCase();

  return documents.filter(document => {
    if (!normalizedProject) return true;

    return [
      document.name,
      document.originalFileName,
      document.category,
      document.notes,
    ].some(value => value.toLowerCase().includes(normalizedProject));
  });
}

function isSameProject(projectName: string, nextProjectName: string) {
  return projectName.trim().toLowerCase() === nextProjectName.trim().toLowerCase();
}

function evidenceIdsBySource(
  evidence: PIEEvidence[],
  sources: PIEReasoningSource[],
) {
  return evidence
    .filter(item => sources.includes(item.source))
    .map(item => item.id);
}

function matchingEvidenceIds(
  evidence: PIEEvidence[],
  source: PIEReasoningSource,
  relatedId: string,
) {
  const exact = evidence
    .filter(item => item.relatedRecordId === relatedId || item.id.includes(relatedId))
    .map(item => item.id);

  if (exact.length > 0) return exact;

  return evidenceIdsBySource(evidence, [source]);
}

function evidenceBySource(
  evidence: PIEEvidence[],
  sources: PIEReasoningSource[],
) {
  return evidence.filter(item => sources.includes(item.source));
}

function evidenceByIds(evidence: PIEEvidence[], evidenceIds: string[]) {
  const wanted = new Set(evidenceIds);

  return evidence.filter(item => wanted.has(item.id));
}

function evidenceDetails(evidence: PIEEvidence[], evidenceIds: string[]) {
  return evidenceByIds(evidence, evidenceIds)
    .map(item => `${item.title}: ${item.detail}`)
    .slice(0, 5);
}

function factsById(facts: PIEFact[], factIds: string[]) {
  const wanted = new Set(factIds);

  return facts.filter(fact => wanted.has(fact.id));
}

function factIdsById(facts: PIEFact[], factIds: string[]) {
  return factsById(facts, factIds).map(fact => fact.id);
}

function firstConcern(concerns: PIEConcern[], concernIds: string[]) {
  return concerns.find(concern => concernIds.includes(concern.id)) ?? null;
}

function firstQuestion(questions: PIEQuestion[], questionIds: string[]) {
  return questions.find(question => questionIds.includes(question.id)) ?? null;
}

function hasConcern(concerns: PIEConcern[], concernIds: string[]) {
  return concerns.some(concern => concernIds.includes(concern.id));
}

function recommendationForAction(
  recommendations: PIEThoughtRecommendation[],
  action: ProjectRecommendation['action'],
) {
  return (
    recommendations.find(
      recommendation => recommendation.metadata.action === action,
    ) ?? null
  );
}

function priorityForRisk(risk: ProjectRiskSignal): PIEPriority {
  if (risk.severity === 'critical') return 'high';
  if (risk.severity === 'warning') return 'medium';

  return 'low';
}

function impactForRisk(risk: ProjectRiskSignal) {
  if (risk.id.includes('safety')) {
    return 'Safety concerns can affect field readiness and should be reviewed quickly.';
  }
  if (risk.id.includes('schedule')) {
    return 'Schedule risk can affect milestone confidence and stakeholder expectations.';
  }
  if (risk.id.includes('sync')) {
    return 'Sync issues can make project status less reliable across devices or cloud views.';
  }
  if (risk.id.includes('document')) {
    return 'Missing document context can weaken communication and decision confidence.';
  }
  if (risk.id.includes('decision')) {
    return 'Open decisions can leave project direction unclear.';
  }

  return 'This condition may reduce project clarity, confidence, or follow-through.';
}

function impactForAction(action: ProjectRecommendation['action']) {
  if (
    action === 'review-safety' ||
    action === 'review-open-issues' ||
    action === 'review-photo-actions'
  ) {
    return 'Helps close field risks and clarify owner accountability.';
  }
  if (
    action === 'review-overdue-schedule' ||
    action === 'review-upcoming-schedule' ||
    action === 'add-schedule'
  ) {
    return 'Improves schedule confidence and next-step planning.';
  }
  if (action === 'capture-update') {
    return 'Refreshes project reality so PIE can reason from current field information.';
  }
  if (action === 'generate-report') {
    return 'Turns current project intelligence into stakeholder communication.';
  }
  if (action === 'sync-project') {
    return 'Improves confidence that local and cloud project data match.';
  }
  if (action === 'review-decisions') {
    return 'Closes open decision loops and strengthens project direction.';
  }

  return 'Supports clearer project understanding and better next actions.';
}

function confidenceFromCounts(count: number): ProjectConfidenceLevel {
  if (count >= 3) return 'high';
  if (count > 0) return 'medium';

  return 'low';
}

function scheduleEvidenceDetail(item: ScheduleItem, isOverdue: boolean) {
  const parts = [
    `${item.taskName || 'Schedule item'} is ${item.status.toLowerCase()}.`,
    item.finishDate.trim() ? `Finish date: ${item.finishDate}.` : '',
    item.priority === 'High' ? 'Priority is high.' : '',
    isOverdue ? 'This item is overdue.' : '',
    item.owner.trim() ? `Owner: ${item.owner}.` : '',
    item.contractor.trim() ? `Contractor: ${item.contractor}.` : '',
    item.notes.trim() ? `Notes: ${item.notes.trim()}` : '',
  ].filter(Boolean);

  return parts.join(' ');
}

function normalizeDateValue(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;

  const parsedDate = parseDueDate(trimmed) || parseFlexibleDate(trimmed);
  if (parsedDate) return parsedDate.toISOString();

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function comparePriority<T extends { priority: PIEPriority }>(left: T, right: T) {
  const priorityRank: Record<PIEPriority, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  return priorityRank[right.priority] - priorityRank[left.priority];
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

function stableId(...parts: Array<string | number | null | undefined>) {
  return parts
    .map(part => String(part ?? 'none').trim().toLowerCase())
    .join('|')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}
