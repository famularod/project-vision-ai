/**
 * Audit P1-50: Ask history is bounded so it cannot grow without limit.
 */

import { waitFor } from '@testing-library/react-native';
import {
  appendDAVEAskHistory,
  createDAVEAskHistoryPersistence,
  DAVE_ASK_HISTORY_LIMIT,
  DAVE_ASK_HISTORY_PAGE_SIZE,
  daveAskHistoryJournalStorageKey,
  daveAskHistoryStorageKey,
  pageDAVEAskHistory,
  type DAVEAskConversationEntry,
} from '../../services/DAVEAskConversation';

function entry(id: string): DAVEAskConversationEntry {
  return {
    id,
    projectId: 'project-1',
    question: `Q ${id}`,
    answer: {
      answer: 'A',
      confidence: 'medium',
      limitations: [],
      supportingEvidence: [],
      timelineReferences: [],
      navigationTargets: [],
    } as never,
    createdAt: new Date().toISOString(),
  };
}

describe('appendDAVEAskHistory (audit P1-50)', () => {
  it('appends below the limit', () => {
    const history = appendDAVEAskHistory([entry('a')], entry('b'));
    expect(history.map(item => item.id)).toEqual(['a', 'b']);
  });

  it('drops the oldest entries beyond the limit, keeping the newest', () => {
    let history: DAVEAskConversationEntry[] = [];
    for (let i = 0; i < DAVE_ASK_HISTORY_LIMIT + 5; i += 1) {
      history = appendDAVEAskHistory(history, entry(`e${i}`));
    }

    expect(history).toHaveLength(DAVE_ASK_HISTORY_LIMIT);
    expect(history[0].id).toBe('e5');
    expect(history[history.length - 1].id).toBe(`e${DAVE_ASK_HISTORY_LIMIT + 4}`);
  });
});

describe('DAVE Ask history persistence', () => {
  it('fails closed when stored history is corrupt', async () => {
    const persistItem = jest.fn<Promise<void>, [string, string]>();
    const persistence = createDAVEAskHistoryPersistence({
      readItem: async () => '{not-json',
      persistItem,
    });

    await expect(persistence.read('project-1')).rejects.toMatchObject({
      code: 'corrupt_history',
    });
    await expect(persistence.append('project-1', entry('new'))).rejects.toMatchObject({
      code: 'corrupt_history',
    });
    expect(persistItem).not.toHaveBeenCalled();
  });

  it('does not convert a storage read failure into empty history', async () => {
    const persistence = createDAVEAskHistoryPersistence({
      readItem: async () => { throw new Error('storage unavailable'); },
      persistItem: async () => undefined,
    });

    await expect(persistence.read('project-1')).rejects.toMatchObject({
      code: 'read_failed',
    });
  });

  it('serializes complete read-modify-write transactions without losing answers', async () => {
    let stored = '[]';
    let releaseFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>(resolve => { releaseFirstWrite = resolve; });
    let writeCount = 0;
    const readItem = jest.fn(async () => stored);
    const persistence = createDAVEAskHistoryPersistence({
      readItem,
      persistItem: async (_storageKey, value) => {
        writeCount += 1;
        if (writeCount === 1) await firstWriteGate;
        stored = value;
      },
    });
    const otherViewPersistence = createDAVEAskHistoryPersistence({
      readItem,
      persistItem: async (_storageKey, value) => { stored = value; },
    });

    const first = persistence.append('project-1', entry('first'));
    await waitFor(() => expect(readItem).toHaveBeenCalledTimes(1));
    const second = otherViewPersistence.append('project-1', entry('second'));
    expect(readItem).toHaveBeenCalledTimes(1);

    releaseFirstWrite();
    await Promise.all([first, second]);

    expect(JSON.parse(stored).map((item: DAVEAskConversationEntry) => item.id))
      .toEqual(['first', 'second']);
    expect(readItem).toHaveBeenCalledTimes(4);
  });

  it('recovers a prepared append journal after the history write fails', async () => {
    const historyKey = daveAskHistoryStorageKey('project-1');
    const journalKey = daveAskHistoryJournalStorageKey('project-1');
    const values = new Map<string, string>([[historyKey, '[]']]);
    let failHistoryWrite = true;
    const persistence = createDAVEAskHistoryPersistence({
      readItem: async key => values.get(key) ?? null,
      persistItem: async (key, value) => {
        if (key === historyKey && failHistoryWrite) throw new Error('disk busy');
        values.set(key, value);
      },
      removeItem: async key => { values.delete(key); },
    });

    await expect(persistence.append('project-1', entry('recover-me')))
      .rejects.toMatchObject({ code: 'write_failed' });
    expect(values.has(journalKey)).toBe(true);
    expect(values.get(historyKey)).toBe('[]');

    failHistoryWrite = false;
    await expect(persistence.read('project-1'))
      .resolves.toEqual([expect.objectContaining({ id: 'recover-me' })]);
    expect(values.has(journalKey)).toBe(false);
  });

  it('cleans a committed journal without duplicating its answer', async () => {
    const historyKey = daveAskHistoryStorageKey('project-1');
    const journalKey = daveAskHistoryJournalStorageKey('project-1');
    const values = new Map<string, string>([[historyKey, '[]']]);
    let failJournalCleanup = true;
    const persistence = createDAVEAskHistoryPersistence({
      readItem: async key => values.get(key) ?? null,
      persistItem: async (key, value) => { values.set(key, value); },
      removeItem: async key => {
        if (key === journalKey && failJournalCleanup) throw new Error('cleanup blocked');
        values.delete(key);
      },
    });

    await expect(persistence.append('project-1', entry('saved-once')))
      .rejects.toMatchObject({ code: 'write_failed' });
    expect(JSON.parse(values.get(historyKey) || '[]')).toHaveLength(1);
    expect(values.has(journalKey)).toBe(true);

    failJournalCleanup = false;
    const recovered = await persistence.read('project-1');
    expect(recovered.map(item => item.id)).toEqual(['saved-once']);
    expect(values.has(journalKey)).toBe(false);
  });

  it('fails closed instead of overwriting history from a corrupt journal', async () => {
    const historyKey = daveAskHistoryStorageKey('project-1');
    const values = new Map<string, string>([
      [historyKey, JSON.stringify([entry('existing')])],
      [daveAskHistoryJournalStorageKey('project-1'), '{not-json'],
    ]);
    const persistItem = jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    });
    const persistence = createDAVEAskHistoryPersistence({
      readItem: async key => values.get(key) ?? null,
      persistItem,
      removeItem: async key => { values.delete(key); },
    });

    await expect(persistence.read('project-1'))
      .rejects.toMatchObject({ code: 'corrupt_journal' });
    expect(persistItem).not.toHaveBeenCalled();
    expect(JSON.parse(values.get(historyKey) || '[]')[0].id).toBe('existing');
  });
});

describe('DAVE Ask history paging', () => {
  const history = Array.from(
    { length: DAVE_ASK_HISTORY_PAGE_SIZE + 5 },
    (_, index) => entry(`page-${index}`),
  );

  it('returns the newest bounded page with a stable earlier-page cursor', () => {
    const newest = pageDAVEAskHistory(history);
    expect(newest.entries).toHaveLength(DAVE_ASK_HISTORY_PAGE_SIZE);
    expect(newest.entries[0].id).toBe('page-5');
    expect(newest.entries.at(-1)?.id).toBe(`page-${DAVE_ASK_HISTORY_PAGE_SIZE + 4}`);
    expect(newest.nextBeforeId).toBe('page-5');
    expect(newest.totalCount).toBe(DAVE_ASK_HISTORY_PAGE_SIZE + 5);

    const earlier = pageDAVEAskHistory(history, {
      beforeId: newest.nextBeforeId,
    });
    expect(earlier.entries.map(item => item.id)).toEqual([
      'page-0',
      'page-1',
      'page-2',
      'page-3',
      'page-4',
    ]);
    expect(earlier.nextBeforeId).toBeNull();
  });

  it('exposes paging through persisted legacy-array history without migration', async () => {
    const persistence = createDAVEAskHistoryPersistence({
      readItem: async key =>
        key === daveAskHistoryStorageKey('project-1')
          ? JSON.stringify(history)
          : null,
      persistItem: async () => undefined,
    });

    const page = await persistence.readPage('project-1', { limit: 3 });
    expect(page.entries.map(item => item.id)).toEqual([
      `page-${DAVE_ASK_HISTORY_PAGE_SIZE + 2}`,
      `page-${DAVE_ASK_HISTORY_PAGE_SIZE + 3}`,
      `page-${DAVE_ASK_HISTORY_PAGE_SIZE + 4}`,
    ]);
    expect(page.totalCount).toBe(history.length);
  });
});
