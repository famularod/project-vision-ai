import { useState } from 'react';
import type { DAVEAskConversationEntry } from '../services/DAVEAskConversation';

/**
 * Whole-app audit A9 pass 2 F1 (30 Sep 2026): Talk treated any saved answer of
 * the project from the last 30 days as "my previous answer", one the owner
 * had not been shown since opening Talk. A Talk session is the answers given
 * since Talk was opened: opening Talk starts a new one, "Talk Again" stays in
 * it. Answers are still saved to storage; they are no longer read back as
 * context.
 */
export function createTalkSession() {
  let entries: readonly DAVEAskConversationEntry[] = [];
  return {
    start() {
      entries = [];
    },
    /** Called before the answer is saved, so a quick follow-up already sees it. */
    add(entry: DAVEAskConversationEntry) {
      entries = [...entries, entry];
    },
    history(): readonly DAVEAskConversationEntry[] {
      return entries;
    },
  };
}

export type TalkSession = ReturnType<typeof createTalkSession>;

export function useTalkSession(): TalkSession {
  const [session] = useState(createTalkSession);
  return session;
}
