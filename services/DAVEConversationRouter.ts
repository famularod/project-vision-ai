import {
  askDAVE,
  routeDAVEAskIntent,
  type DAVEAskAnswer,
} from './DAVEAsk';
import type { DAVECaptureMemoryFields } from './DAVECaptureMemory';
import type { DAVEProjectIntelligence } from './DAVEIntelligence';
import {
  parseDAVETaskUpdateCommand,
  type DAVETaskUpdateCommand,
} from './DAVETaskConversation';

export type DAVEConversationIntent =
  | 'ask'
  | 'remember'
  | 'field_information'
  | 'navigate'
  | 'follow_up'
  | 'task_update';

export type DAVEConversationNavigationTarget =
  | 'overview'
  | 'tasks'
  | 'reports'
  | 'project';

export type DAVEConversationRoute =
  | Readonly<{
      intent: 'ask';
      transcript: string;
      answer: DAVEAskAnswer;
    }>
  | Readonly<{
      intent: 'navigate';
      transcript: string;
      target: DAVEConversationNavigationTarget;
    }>
  | Readonly<{
      intent: 'task_update';
      transcript: string;
      command: DAVETaskUpdateCommand;
    }>
  | Readonly<{
      intent: 'remember' | 'field_information' | 'follow_up';
      transcript: string;
      suggestedFields: Partial<DAVECaptureMemoryFields>;
    }>;

export function routeDAVEConversation({
  transcript,
  intelligence,
  interface: conversationInterface = 'text',
}: {
  transcript: string;
  intelligence: DAVEProjectIntelligence;
  interface?: 'text' | 'voice';
}): DAVEConversationRoute {
  const route = classifyDAVEConversation(transcript);
  if (route.intent === 'navigate') {
    return { intent: 'navigate', transcript: route.text, target: route.target };
  }

  if (route.intent === 'task_update') {
    return { intent: 'task_update', transcript: route.text, command: route.command };
  }

  if (route.intent === 'ask') {
    return {
      intent: 'ask',
      transcript: route.text,
      answer: askDAVE({
        question: route.text,
        intelligence,
        interface: conversationInterface,
      }),
    };
  }

  return {
    intent: route.intent,
    transcript: route.text,
    suggestedFields: { [route.field]: route.text },
  };
}

/**
 * The intent routeDAVEConversation chooses, without building an answer.
 * Whole-app audit A9 pass 1 #1 (30 Sep 2026): the Talk context check uses
 * this to tell a field note or task update from a question before it reads
 * "it", "this" or "they" as pointing at a previous answer.
 */
export function classifyDAVEConversationIntent(transcript: string): DAVEConversationRoute['intent'] {
  return classifyDAVEConversation(transcript).intent;
}

export function mentionedDAVEProject(
  transcript: string,
  projectNames: readonly string[],
) {
  const searchable = normalize(transcript);
  const exact = projectNames.find(project => searchable.includes(normalize(project)));
  if (exact) return exact;

  const numberMatches = projectNames.filter(project => {
    const number = project.match(/\b\d{3,6}\b/)?.[0];
    return Boolean(number && new RegExp(`\\b${number}\\b`).test(searchable));
  });
  return numberMatches.length === 1 ? numberMatches[0] : null;
}

function classifyDAVEConversation(transcript: string):
  | { intent: 'navigate'; text: string; target: DAVEConversationNavigationTarget }
  | { intent: 'task_update'; text: string; command: DAVETaskUpdateCommand }
  | { intent: 'ask'; text: string }
  | { intent: 'remember' | 'field_information' | 'follow_up'; text: string; field: keyof DAVECaptureMemoryFields } {
  const text = transcript.replace(/\s+/g, ' ').trim();
  const target = navigationTargetFor(text);
  if (target) return { intent: 'navigate', text, target };

  const command = parseDAVETaskUpdateCommand(text);
  if (command) return { intent: 'task_update', text, command };

  if (routeDAVEAskIntent(text) !== 'unknown' || looksLikeQuestion(text)) return { intent: 'ask', text };

  return { ...memoryIntentFor(text), text };
}

function navigationTargetFor(value: string): DAVEConversationNavigationTarget | null {
  const text = normalize(value);
  if (!/^(?:open|show|go to|take me to|view)\b/.test(text)) return null;
  if (/\breports?\b/.test(text)) return 'reports';
  if (/\b(?:tasks?|schedule)\b/.test(text)) return 'tasks';
  if (/\b(?:overview|home)\b/.test(text)) return 'overview';
  if (/\bprojects?\b/.test(text) || /\b\d{3,6}\b/.test(text)) return 'project';
  return null;
}

function looksLikeQuestion(value: string) {
  const text = normalize(value);
  return value.trim().endsWith('?') ||
    /^(?:what|why|how|when|where|which|who|is|are|was|were|do|does|did|can|could|should|would|tell me|summarize|explain)\b/.test(text);
}

function memoryIntentFor(value: string): {
  intent: 'remember' | 'field_information' | 'follow_up';
  field: keyof DAVECaptureMemoryFields;
} {
  const text = normalize(value);
  if (/\b(?:follow up|follow-up|remind me|call|check back)\b/.test(text)) {
    return { intent: 'follow_up', field: 'followUp' };
  }
  if (/\b(?:committed|commitment|promised|will finish|will complete)\b/.test(text)) {
    return { intent: 'remember', field: 'commitment' };
  }
  if (/\b(?:decision|decided|approved|rejected)\b/.test(text)) {
    return { intent: 'remember', field: 'decision' };
  }
  if (/\b(?:schedule|delayed|moved to|rescheduled|due date)\b/.test(text)) {
    return { intent: 'field_information', field: 'scheduleChange' };
  }
  if (/\b(?:issue|problem|blocked|failed|damage|leak|unsafe|hazard)\b/.test(text)) {
    return { intent: 'field_information', field: 'issue' };
  }
  if (/\b(?:risk|concern)\b/.test(text)) {
    return { intent: 'field_information', field: 'risk' };
  }
  return { intent: 'field_information', field: 'generalMemory' };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
