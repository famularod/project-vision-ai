export type DAVEConversationState =
  | 'idle' | 'listening' | 'understanding' | 'confirming' | 'saving'
  | 'follow_up' | 'cancelled' | 'failed';

export type DAVEConversationSnapshot = Readonly<{
  state: DAVEConversationState;
  previousState: DAVEConversationState | null;
  revision: number;
  failureReason: string | null;
}>;

const TRANSITIONS = {
  idle: ['listening'],
  listening: ['understanding', 'cancelled', 'failed'],
  understanding: ['confirming', 'cancelled', 'failed'],
  confirming: ['saving', 'follow_up', 'cancelled', 'failed'],
  saving: ['follow_up', 'failed'],
  follow_up: ['listening', 'idle', 'cancelled', 'failed'],
  cancelled: ['idle'],
  failed: ['idle', 'listening'],
} satisfies Record<DAVEConversationState, readonly DAVEConversationState[]>;

Object.values(TRANSITIONS).forEach(states => Object.freeze(states));
export const DAVE_CONVERSATION_TRANSITIONS: Readonly<Record<DAVEConversationState, readonly DAVEConversationState[]>> = Object.freeze(TRANSITIONS);

export function createConversationSnapshot(): DAVEConversationSnapshot {
  return Object.freeze({ state: 'idle', previousState: null, revision: 0, failureReason: null });
}

export function transitionConversation(
  snapshot: DAVEConversationSnapshot,
  nextState: DAVEConversationState,
  failureReason?: string | null,
): DAVEConversationSnapshot {
  if (!DAVE_CONVERSATION_TRANSITIONS[snapshot.state].includes(nextState)) {
    throw new Error(`Invalid DAVE conversation transition: ${snapshot.state} -> ${nextState}`);
  }
  return Object.freeze({
    state: nextState,
    previousState: snapshot.state,
    revision: snapshot.revision + 1,
    failureReason: nextState === 'failed' ? clean(failureReason) || 'Conversation unavailable.' : null,
  });
}

export function recoverConversation(snapshot: DAVEConversationSnapshot): DAVEConversationSnapshot {
  if (snapshot.state !== 'failed' && snapshot.state !== 'cancelled') return snapshot;
  return transitionConversation(snapshot, 'idle');
}

function clean(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
