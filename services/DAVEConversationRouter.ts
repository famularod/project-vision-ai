import {
  askDAVE,
  routeDAVEAskIntent,
  type DAVEAskAnswer,
} from './DAVEAsk';
import {
  createCaptureMemory,
  type DAVECaptureMemory,
  type DAVECaptureMemoryFields,
} from './DAVECaptureMemory';
import type { DAVEProjectIntelligence } from './DAVEIntelligence';
import {
  parseDAVETaskUpdateCommand,
  type DAVETaskUpdateCommand,
} from './DAVETaskConversation';
import type { DAVEVoiceUnderstandingResponse } from './DAVEVoiceUnderstanding';
import {
  ecosProjectIdentifier,
  ecosProjectNumberMentions,
} from '../supabase/functions/_shared/ecos-project-reference';

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
  // Whole-app audit A11 pass 1 F6 (30 Sep 2026): a name matches whole words
  // only ("Oak" is not in "Oakland"), and a number that is a quantity, an
  // amount or part of a date ("2375 feet", "$2375", "9/30/2026") is not
  // read as a project number. A bare number ("What changed at 2375?") still is.
  const searchable = ` ${normalize(transcript)} `;
  const exact = projectNames.find(project => {
    const name = normalize(project);
    return Boolean(name) && searchable.includes(` ${name} `);
  });
  if (exact) return exact;

  // Audit A9 pass 3 L2: the same number rule as Ask ECOS, so a phone number,
  // "RFI 2375", "unit 2375" or "2375 Main Street" does not move the note either.
  const numbers = new Set(ecosProjectNumberMentions(transcript, projectNames));
  const numberMatches = projectNames.filter(project => {
    const number = ecosProjectIdentifier(project);
    return Boolean(number && numbers.has(number));
  });
  return numberMatches.length === 1 ? numberMatches[0] : null;
}

/**
 * The confirmation draft for a note said or typed in Talk.
 * Whole-app audit A11 pass 1 F6 (30 Sep 2026): a number in the note can move
 * it to another project, and that move was saved pre-confirmed with the
 * location heard against the first project's areas. A moved note now needs
 * the manager to confirm the project, and starts with no location.
 */
export function buildDAVETalkMemoryDraft({
  id,
  createdAt,
  projectName,
  switchedProject,
  transcript,
  fields,
  voiceResult,
}: {
  id: string;
  createdAt: string;
  projectName: string;
  switchedProject: boolean;
  transcript: string;
  fields: Partial<DAVECaptureMemoryFields>;
  voiceResult?: DAVEVoiceUnderstandingResponse;
}): DAVECaptureMemory {
  const location = switchedProject ? null : voiceResult?.understanding.recommendedLocation;
  return createCaptureMemory({
    id,
    transcript,
    transcriptSourceRecordId: voiceResult
      ? `voice-transcription:${id}`
      : `typed-entry:${id}`,
    createdAt,
    recommendedProject: {
      value: projectName,
      confidence: switchedProject ? 'medium' : 'high',
      confirmed: !switchedProject,
    },
    recommendedLocation: {
      value: location?.value || null,
      confidence: location?.confidence || 'unknown',
      confirmed: false,
    },
    fields,
  });
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
