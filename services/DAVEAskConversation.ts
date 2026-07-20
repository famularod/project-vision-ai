import type { DAVEAskAnswer, DAVEAskEvidence } from './DAVEAsk';
import type { DAVEBriefNavigationTarget } from './DAVEDailyBrief';
import type { DAVEProjectIntelligence } from './DAVEIntelligence';

export const DAVE_ASK_SUGGESTED_QUESTIONS = [
  'How is this project doing?',
  'What needs attention?',
  'What changed?',
  'What is overdue?',
  'What should I do next?',
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

export type DAVEAskHistoryParseResult = Readonly<{
  status: 'missing' | 'valid' | 'corrupt';
  history: DAVEAskConversationEntry[];
}>;

export class DAVEAskHistoryPersistenceError extends Error {
  readonly code: 'read_failed' | 'corrupt_history' | 'write_failed';
  readonly cause: unknown;

  constructor(code: DAVEAskHistoryPersistenceError['code'], cause?: unknown) {
    super(code === 'corrupt_history'
      ? 'Saved DAVE Ask history is corrupt.'
      : code === 'read_failed'
        ? 'Saved DAVE Ask history could not be read.'
        : 'DAVE Ask history could not be saved.');
    this.name = 'DAVEAskHistoryPersistenceError';
    this.code = code;
    this.cause = cause;
  }
}

// Talk and the inline Ask Vitruvius experience share these keys. Keeping the tails
// module-scoped serializes read-modify-write transactions across both views.
const daveAskHistoryMutationTails = new Map<string, Promise<void>>();

/**
 * Serializes each project's complete read-modify-write transaction. A failed
 * or corrupt read never becomes an authoritative empty history.
 */
export function createDAVEAskHistoryPersistence(dependencies: Readonly<{
  readItem: (storageKey: string) => Promise<string | null>;
  persistItem: (storageKey: string, value: string) => Promise<void>;
}>) {
  function enqueue<T>(storageKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = daveAskHistoryMutationTails.get(storageKey) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tail = current.then(() => undefined, () => undefined);
    daveAskHistoryMutationTails.set(storageKey, tail);
    void tail.finally(() => {
      if (daveAskHistoryMutationTails.get(storageKey) === tail) {
        daveAskHistoryMutationTails.delete(storageKey);
      }
    });
    return current;
  }

  async function readParsed(storageKey: string, projectId: string) {
    let raw: string | null;
    try {
      raw = await dependencies.readItem(storageKey);
    } catch (error) {
      throw new DAVEAskHistoryPersistenceError('read_failed', error);
    }
    const parsed = parseDAVEAskHistoryResult(raw, projectId);
    if (parsed.status === 'corrupt') {
      throw new DAVEAskHistoryPersistenceError('corrupt_history');
    }
    return parsed.history;
  }

  return Object.freeze({
    read(projectId: string) {
      const storageKey = daveAskHistoryStorageKey(projectId);
      return enqueue(storageKey, () => readParsed(storageKey, projectId));
    },
    append(projectId: string, entry: DAVEAskConversationEntry) {
      const storageKey = daveAskHistoryStorageKey(projectId);
      return enqueue(storageKey, async () => {
        const history = await readParsed(storageKey, projectId);
        const next = appendDAVEAskHistory(history, entry);
        try {
          await dependencies.persistItem(storageKey, JSON.stringify(next));
        } catch (error) {
          throw new DAVEAskHistoryPersistenceError('write_failed', error);
        }
        return next;
      });
    },
  });
}

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
  return parseDAVEAskHistoryResult(value, projectId).history;
}

export function parseDAVEAskHistoryResult(
  value: string | null,
  projectId: string,
): DAVEAskHistoryParseResult {
  if (!value) return { status: 'missing', history: [] };
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return { status: 'corrupt', history: [] };
    const history = parsed.filter((item): item is DAVEAskConversationEntry =>
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
    if (history.length !== parsed.length) {
      return { status: 'corrupt', history: [] };
    }
    return { status: 'valid', history };
  } catch {
    return { status: 'corrupt', history: [] };
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
