/**
 * Audit P1-50: Ask history is bounded so it cannot grow without limit.
 */

import {
  appendDAVEAskHistory,
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
