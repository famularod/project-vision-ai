import * as Crypto from 'expo-crypto';

export type ECOSConversationRequest = Readonly<{ conversationId?: string; priorTurnId?: string }>;
export type ECOSConversationReceipt = Readonly<{
  conversationId: string;
  turnId: string;
  priorTurnId: string | null;
}>;

const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function validECOSConversationRequest(input: ECOSConversationRequest): boolean {
  return (input.conversationId === undefined || uuid(input.conversationId)) &&
    (input.priorTurnId === undefined || (uuid(input.priorTurnId) && uuid(input.conversationId)));
}

export function parseECOSConversationReceipt(value: unknown): ECOSConversationReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 'ecos-agent-conversation-context/1.0' ||
    !uuid(record.conversationId) || !uuid(record.turnId) ||
    !(record.priorTurnId === null || uuid(record.priorTurnId))) return null;
  // No previous answer or document excerpt becomes client-supplied evidence.
  return Object.freeze({ conversationId: record.conversationId, turnId: record.turnId, priorTurnId: record.priorTurnId });
}

/** Ephemeral UI continuity only. The server independently authorizes every turn. */
export function createECOSConversation() {
  let conversationId = Crypto.randomUUID();
  let priorTurnId: string | undefined;
  let generation = 0;
  return {
    begin() {
      const sequence = ++generation;
      const request = { conversationId, ...(priorTurnId ? { priorTurnId } : {}) };
      return {
        request,
        isCurrent: () => sequence === generation,
        accept(receipt: ECOSConversationReceipt | null | undefined) {
          if (sequence !== generation) return;
          if (receipt && receipt.conversationId === conversationId && receipt.priorTurnId === (priorTurnId || null)) {
            priorTurnId = receipt.turnId;
          } else {
            conversationId = Crypto.randomUUID();
            priorTurnId = undefined;
          }
        },
      };
    },
    invalidate() { generation += 1; },
  };
}
