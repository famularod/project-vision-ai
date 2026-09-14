import { useEffect, useRef } from 'react';
import { createECOSConversation } from '../services/ECOSConversation';

/** Replaces continuity on any owner/project change; late results cannot revive it. */
export function useECOSConversation(scopeKey: string) {
  const scoped = useRef<{ key: string; conversation: ReturnType<typeof createECOSConversation> } | null>(null);
  if (!scoped.current || scoped.current.key !== scopeKey) {
    scoped.current?.conversation.invalidate();
    scoped.current = { key: scopeKey, conversation: createECOSConversation() };
  }
  const conversation = scoped.current.conversation;
  useEffect(() => () => conversation.invalidate(), [conversation]);
  return conversation;
}
