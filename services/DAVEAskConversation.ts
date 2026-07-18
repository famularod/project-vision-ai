import type { DAVEAskAnswer, DAVEAskEvidence } from './DAVEAsk';
import type { DAVEBriefNavigationTarget } from './DAVEDailyBrief';
import type { DAVEProjectIntelligence } from './DAVEIntelligence';

export const DAVE_ASK_SUGGESTED_QUESTIONS = [
  'What changed today?',
  'What should I do next?',
  'Why is this project At Risk?',
  'What evidence am I missing?',
  'Summarize this project.',
] as const;

export type DAVEAskConversationEntry = {
  id: string;
  projectId: string;
  question: string;
  answer: DAVEAskAnswer;
  createdAt: string;
  contextStatus?: 'standalone' | 'resolved_follow_up' | 'ambiguous_follow_up';
  resolvedQuestion?: string | null;
  priorEntryId?: string | null;
};

export type DAVEAskWhyModel = {
  evidenceUsed: DAVEAskEvidence[];
  evidenceMissing: string[];
  confidence: DAVEAskAnswer['confidence'];
  limitations: string[];
  timelineEvents: DAVEAskAnswer['timelineReferences'];
  supportingRecords: DAVEAskEvidence[];
};

export type DAVEAskResolvedNavigation = {
  target: DAVEBriefNavigationTarget;
  sourceRecordId: string;
  timelineEventId: string | null;
};

export function daveAskHistoryStorageKey(projectId: string): string {
  return `dave-ask-history:${encodeURIComponent(projectId)}`;
}

/**
 * Audit P1-50: Ask history is bounded. Older entries roll off so storage
 * cannot grow without limit or exceed the platform quota.
 */
export const DAVE_ASK_HISTORY_LIMIT = 100;

export function appendDAVEAskHistory(
  history: DAVEAskConversationEntry[],
  entry: DAVEAskConversationEntry,
): DAVEAskConversationEntry[] {
  const next = [...history, Object.freeze(entry)];
  return next.length > DAVE_ASK_HISTORY_LIMIT
    ? next.slice(next.length - DAVE_ASK_HISTORY_LIMIT)
    : next;
}

export function historyForDAVEProject(
  history: DAVEAskConversationEntry[],
  projectId: string,
): DAVEAskConversationEntry[] {
  return history.filter(item => item.projectId === projectId);
}

export function parseDAVEAskHistory(value: string | null, projectId: string): DAVEAskConversationEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DAVEAskConversationEntry =>
      Boolean(item) &&
      item.projectId === projectId &&
      typeof item.id === 'string' &&
      typeof item.question === 'string' &&
      typeof item.createdAt === 'string' &&
      typeof item.answer?.answer === 'string' &&
      typeof item.answer?.confidence === 'string' &&
      Array.isArray(item.answer?.limitations) &&
      Array.isArray(item.answer?.supportingEvidence) &&
      Array.isArray(item.answer?.timelineReferences) &&
      Array.isArray(item.answer?.navigationTargets));
  } catch {
    return [];
  }
}

export function buildDAVEAskWhyModel(answer: DAVEAskAnswer): DAVEAskWhyModel {
  const evidenceMissing = answer.limitations.filter(item =>
    /missing|weak|unavailable|no recent|not recorded|does not establish/i.test(item));
  return {
    evidenceUsed: answer.supportingEvidence,
    evidenceMissing,
    confidence: answer.confidence,
    limitations: answer.limitations,
    timelineEvents: answer.timelineReferences,
    supportingRecords: answer.supportingEvidence,
  };
}

export function resolveDAVEAskEvidenceNavigation(
  intelligence: DAVEProjectIntelligence,
  citation: Pick<DAVEAskEvidence, 'recordId' | 'timelineEventId'>,
): DAVEAskResolvedNavigation {
  const timelineEvent = citation.timelineEventId
    ? intelligence.timeline.find(item => item.id === citation.timelineEventId)
    : intelligence.timeline.find(item =>
      item.evidence.some(evidence => evidence.recordId === citation.recordId));
  if (!timelineEvent) {
    return { target: 'project_workspace', sourceRecordId: citation.recordId, timelineEventId: null };
  }
  const routeEvidence = timelineEvent.evidence.find(item => item.sourceType === 'update' || item.sourceType === 'issue') ||
    timelineEvent.evidence.find(item => item.sourceType === 'document' || item.sourceType === 'schedule') ||
    timelineEvent.evidence[0];
  return {
    target: timelineEvent.navigationTarget,
    sourceRecordId: routeEvidence?.recordId || citation.recordId,
    timelineEventId: timelineEvent.id,
  };
}

export function resolveDAVEAskTimelineNavigation(
  intelligence: DAVEProjectIntelligence,
  timelineEventId: string,
): DAVEAskResolvedNavigation | null {
  const timelineEvent = intelligence.timeline.find(item => item.id === timelineEventId);
  if (!timelineEvent) return null;
  const evidence = timelineEvent.evidence[0];
  return resolveDAVEAskEvidenceNavigation(intelligence, {
    recordId: evidence?.recordId || intelligence.projectId,
    timelineEventId,
  });
}
