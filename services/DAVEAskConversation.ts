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

export const DAVE_ASK_HISTORY_LIMIT = 100;
export const DAVE_ASK_HISTORY_PAGE_SIZE = 20;
const DAVE_ASK_HISTORY_JOURNAL_VERSION = 1 as const;

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

export type DAVEAskHistoryPage = Readonly<{
  entries: DAVEAskConversationEntry[];
  nextBeforeId: string | null;
  totalCount: number;
}>;

type DAVEAskHistoryJournal = Readonly<{
  version: typeof DAVE_ASK_HISTORY_JOURNAL_VERSION;
  projectId: string;
  historyStorageKey: string;
  entryId: string;
  beforeValue: string;
  nextValue: string;
}>;

export class DAVEAskHistoryPersistenceError extends Error {
  readonly code:
    | 'read_failed'
    | 'corrupt_history'
    | 'write_failed'
    | 'corrupt_journal'
    | 'journal_conflict';
  readonly cause: unknown;

  constructor(code: DAVEAskHistoryPersistenceError['code'], cause?: unknown) {
    super(
      code === 'corrupt_history'
        ? 'Saved DAVE Ask history is corrupt.'
        : code === 'corrupt_journal'
          ? 'The pending DAVE Ask history journal is corrupt.'
          : code === 'journal_conflict'
            ? 'The pending DAVE Ask history journal conflicts with saved history.'
            : code === 'read_failed'
              ? 'Saved DAVE Ask history could not be read.'
              : 'DAVE Ask history could not be saved.',
    );
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
  removeItem?: (storageKey: string) => Promise<void>;
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

  async function readRawParsed(storageKey: string, projectId: string) {
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
    return {
      raw,
      history: parsed.history,
      canonicalValue: JSON.stringify(parsed.history),
    };
  }

  async function removeJournal(journalStorageKey: string) {
    try {
      await dependencies.removeItem?.(journalStorageKey);
    } catch (error) {
      throw new DAVEAskHistoryPersistenceError('write_failed', error);
    }
  }

  async function recoverJournal(storageKey: string, projectId: string) {
    if (!dependencies.removeItem) return;
    const journalStorageKey = daveAskHistoryJournalStorageKey(projectId);
    let raw: string | null;
    try {
      raw = await dependencies.readItem(journalStorageKey);
    } catch (error) {
      throw new DAVEAskHistoryPersistenceError('read_failed', error);
    }
    if (raw === null) return;
    const journal = parseDAVEAskHistoryJournal(raw, projectId, storageKey);
    if (!journal) {
      throw new DAVEAskHistoryPersistenceError('corrupt_journal');
    }

    const current = await readRawParsed(storageKey, projectId);
    if (
      current.canonicalValue === journal.nextValue ||
      current.history.some(entry => entry.id === journal.entryId)
    ) {
      await removeJournal(journalStorageKey);
      return;
    }
    if (current.canonicalValue !== journal.beforeValue) {
      throw new DAVEAskHistoryPersistenceError('journal_conflict');
    }

    try {
      await dependencies.persistItem(storageKey, journal.nextValue);
    } catch (error) {
      throw new DAVEAskHistoryPersistenceError('write_failed', error);
    }
    const verified = await readRawParsed(storageKey, projectId);
    if (verified.canonicalValue !== journal.nextValue) {
      throw new DAVEAskHistoryPersistenceError('write_failed');
    }
    await removeJournal(journalStorageKey);
  }

  return Object.freeze({
    read(projectId: string) {
      const storageKey = daveAskHistoryStorageKey(projectId);
      return enqueue(storageKey, async () => {
        await recoverJournal(storageKey, projectId);
        return (await readRawParsed(storageKey, projectId)).history;
      });
    },
    readPage(
      projectId: string,
      options?: Readonly<{ beforeId?: string | null; limit?: number }>,
    ) {
      const storageKey = daveAskHistoryStorageKey(projectId);
      return enqueue(storageKey, async () => {
        await recoverJournal(storageKey, projectId);
        const history = (await readRawParsed(storageKey, projectId)).history;
        return pageDAVEAskHistory(history, options);
      });
    },
    append(projectId: string, entry: DAVEAskConversationEntry) {
      const storageKey = daveAskHistoryStorageKey(projectId);
      return enqueue(storageKey, async () => {
        await recoverJournal(storageKey, projectId);
        const current = await readRawParsed(storageKey, projectId);
        const next = appendDAVEAskHistory(current.history, entry);
        const nextValue = JSON.stringify(next);
        const journalStorageKey = daveAskHistoryJournalStorageKey(projectId);
        if (dependencies.removeItem) {
          const journal: DAVEAskHistoryJournal = {
            version: DAVE_ASK_HISTORY_JOURNAL_VERSION,
            projectId,
            historyStorageKey: storageKey,
            entryId: entry.id,
            beforeValue: current.canonicalValue,
            nextValue,
          };
          const serializedJournal = JSON.stringify(journal);
          try {
            await dependencies.persistItem(journalStorageKey, serializedJournal);
            if (await dependencies.readItem(journalStorageKey) !== serializedJournal) {
              throw new Error('Ask history journal read-back mismatch.');
            }
          } catch (error) {
            throw new DAVEAskHistoryPersistenceError('write_failed', error);
          }
        }
        try {
          await dependencies.persistItem(storageKey, nextValue);
        } catch (error) {
          throw new DAVEAskHistoryPersistenceError('write_failed', error);
        }
        const verified = await readRawParsed(storageKey, projectId);
        if (verified.canonicalValue !== nextValue) {
          throw new DAVEAskHistoryPersistenceError('write_failed');
        }
        if (dependencies.removeItem) await removeJournal(journalStorageKey);
        return next;
      });
    },
  });
}

export function daveAskHistoryStorageKey(projectId: string): string {
  return `dave-ask-history:${encodeURIComponent(projectId)}`;
}

export function daveAskHistoryJournalStorageKey(projectId: string): string {
  return `dave-ask-history-journal:${encodeURIComponent(projectId)}`;
}

export function appendDAVEAskHistory(
  history: DAVEAskConversationEntry[],
  entry: DAVEAskConversationEntry,
): DAVEAskConversationEntry[] {
  const next = [...history, Object.freeze(entry)];
  return next.length > DAVE_ASK_HISTORY_LIMIT
    ? next.slice(next.length - DAVE_ASK_HISTORY_LIMIT)
    : next;
}

export function pageDAVEAskHistory(
  history: DAVEAskConversationEntry[],
  options: Readonly<{ beforeId?: string | null; limit?: number }> = {},
): DAVEAskHistoryPage {
  const bounded = history.slice(-DAVE_ASK_HISTORY_LIMIT);
  const requestedLimit = options.limit ?? DAVE_ASK_HISTORY_PAGE_SIZE;
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.max(1, Math.min(DAVE_ASK_HISTORY_LIMIT, requestedLimit))
    : DAVE_ASK_HISTORY_PAGE_SIZE;
  let end = bounded.length;
  if (options.beforeId) {
    end = bounded.findIndex(entry => entry.id === options.beforeId);
    if (end < 0) {
      throw new DAVEAskHistoryPersistenceError('corrupt_history');
    }
  }
  const start = Math.max(0, end - limit);
  const entries = bounded.slice(start, end);
  return {
    entries,
    nextBeforeId: start > 0 ? entries[0]?.id || null : null,
    totalCount: bounded.length,
  };
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
    return {
      status: 'valid',
      history: history.slice(-DAVE_ASK_HISTORY_LIMIT),
    };
  } catch {
    return { status: 'corrupt', history: [] };
  }
}

function parseDAVEAskHistoryJournal(
  value: string,
  projectId: string,
  historyStorageKey: string,
): DAVEAskHistoryJournal | null {
  try {
    const parsed = JSON.parse(value) as Partial<DAVEAskHistoryJournal>;
    if (
      !parsed ||
      parsed.version !== DAVE_ASK_HISTORY_JOURNAL_VERSION ||
      parsed.projectId !== projectId ||
      parsed.historyStorageKey !== historyStorageKey ||
      typeof parsed.entryId !== 'string' ||
      !parsed.entryId ||
      typeof parsed.beforeValue !== 'string' ||
      typeof parsed.nextValue !== 'string'
    ) {
      return null;
    }
    const before = parseDAVEAskHistoryResult(parsed.beforeValue, projectId);
    const next = parseDAVEAskHistoryResult(parsed.nextValue, projectId);
    if (
      before.status === 'corrupt' ||
      next.status !== 'valid' ||
      JSON.stringify(before.history) !== parsed.beforeValue ||
      JSON.stringify(next.history) !== parsed.nextValue ||
      !next.history.some(entry => entry.id === parsed.entryId)
    ) {
      return null;
    }
    return parsed as DAVEAskHistoryJournal;
  } catch {
    return null;
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
