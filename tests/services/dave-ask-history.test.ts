/**
 * Audit P1-50: Ask history is bounded so it cannot grow without limit.
 */

import {
  appendDAVEAskHistory,
  createDAVEAskHistoryPersistence,
  DAVE_ASK_HISTORY_LIMIT,
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
    await Promise.resolve();
    await Promise.resolve();
    const second = otherViewPersistence.append('project-1', entry('second'));
    expect(readItem).toHaveBeenCalledTimes(1);

    releaseFirstWrite();
    await Promise.all([first, second]);

    expect(JSON.parse(stored).map((item: DAVEAskConversationEntry) => item.id))
      .toEqual(['first', 'second']);
    expect(readItem).toHaveBeenCalledTimes(2);
  });
});
