import { askDAVE, type DAVEAskAnswer, type DAVEAskEvidence } from './DAVEAsk';
import type { DAVEAskConversationEntry } from './DAVEAskConversation';
import type { DAVEProjectIntelligence } from './DAVEIntelligence';

export type DAVEConversationFollowUpKind =
  | 'supporting_evidence'
  | 'explanation'
  | 'schedule'
  | 'next_action'
  | 'prior_answer';

export type DAVEConversationContextResolution = Readonly<{
  status: 'standalone' | 'resolved_follow_up' | 'ambiguous_follow_up';
  originalQuestion: string;
  effectiveQuestion: string;
  priorEntryId: string | null;
  priorEntry: DAVEAskConversationEntry | null;
  followUpKind: DAVEConversationFollowUpKind | null;
  reason: string;
}>;

export function resolveDAVEConversationContext({
  transcript,
  history,
  projectId,
  now = new Date(),
  maxAgeDays = 30,
}: {
  transcript: string;
  history: readonly DAVEAskConversationEntry[];
  projectId: string;
  now?: Date;
  maxAgeDays?: number;
}): DAVEConversationContextResolution {
  const originalQuestion = clean(transcript);
  if (!looksContextDependent(originalQuestion)) {
    return resolution('standalone', originalQuestion, originalQuestion, null, null, 'The question is self-contained.');
  }

  const prior = [...history]
    .filter(entry => entry.projectId === projectId)
    .filter(entry => recentEnough(entry.createdAt, now, maxAgeDays))
    .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt))[0] || null;

  if (!prior) {
    return resolution(
      'ambiguous_follow_up',
      originalQuestion,
      'What project information are you referring to?',
      null,
      null,
      'No recent answer exists for this project, so DAVE must ask for context instead of guessing.',
    );
  }

  const text = normalize(originalQuestion);
  if (/\b(?:evidence|record|records|source|sources|show me|prove|support)\b/.test(text)) {
    return resolved(originalQuestion, 'Show the supporting evidence for the previous answer.', prior, 'supporting_evidence', 'The follow-up asks for records supporting the previous answer.');
  }
  if (/\b(?:why|explain|how come|reason)\b/.test(text)) {
    return resolved(
      originalQuestion,
      prior.answer.recommendedNextAction
        ? 'Why did you recommend the next action?'
        : `Explain why the project answer to "${shorten(prior.question, 90)}" is supported.`,
      prior,
      'explanation',
      'The follow-up asks DAVE to explain the previous conclusion or recommendation.',
    );
  }
  if (/\b(?:schedule|dates?|deadline|deadlines|late|overdue|due)\b/.test(text)) {
    return resolved(originalQuestion, 'What is the project status, especially the schedule and overdue work?', prior, 'schedule', 'The follow-up narrows the prior project discussion to schedule status.');
  }
  if (/\b(?:what next|next|do now|should i do|action)\b/.test(text)) {
    return resolved(originalQuestion, 'What should I do next?', prior, 'next_action', 'The follow-up asks for the next accountable action.');
  }
  if (/\b(?:that|this|it|those|them|they|one|ones|and)\b/.test(text)) {
    return resolved(
      originalQuestion,
      `Summarize the project with emphasis on the previous question: "${shorten(prior.question, 90)}".`,
      prior,
      'prior_answer',
      'The pronoun refers to the latest answer in this project conversation.',
    );
  }

  return resolution('standalone', originalQuestion, originalQuestion, null, null, 'The question can be answered without prior-turn context.');
}

export function answerDAVEConversationContext({
  resolution: context,
  intelligence,
  interface: conversationInterface = 'text',
}: {
  resolution: DAVEConversationContextResolution;
  intelligence: DAVEProjectIntelligence;
  interface?: 'text' | 'voice';
}): DAVEAskAnswer | null {
  if (context.status === 'ambiguous_follow_up') return null;
  if (context.status === 'standalone' || !context.priorEntry || !context.followUpKind) {
    return askDAVE({
      question: context.effectiveQuestion,
      intelligence,
      interface: conversationInterface,
    });
  }

  const prior = context.priorEntry.answer;
  if (context.followUpKind === 'supporting_evidence') {
    return {
      ...prior,
      answer: prior.supportingEvidence.length > 0
        ? `These are the records that supported my previous answer: ${prior.answer}`
        : `My previous answer did not include a supporting record. ${prior.answer}`,
      limitations: prior.supportingEvidence.length > 0
        ? prior.limitations
        : uniqueText([...prior.limitations, 'No supporting record was attached to the previous answer.']),
    };
  }

  if (context.followUpKind === 'explanation') {
    return {
      ...prior,
      answer: [
        `My previous answer was: ${prior.answer}`,
        prior.recommendedNextAction
          ? `I recommended “${prior.recommendedNextAction}” because the cited records and limitations below were the basis for that answer.`
          : 'The cited records and limitations below were the basis for that answer.',
      ].join(' '),
    };
  }

  if (context.followUpKind === 'prior_answer') return prior;

  const focused = askDAVE({
    question: context.effectiveQuestion,
    intelligence,
    interface: conversationInterface,
  });
  return {
    ...focused,
    supportingEvidence: uniqueEvidence([
      ...prior.supportingEvidence,
      ...focused.supportingEvidence,
    ]),
    timelineReferences: uniqueById([
      ...prior.timelineReferences,
      ...focused.timelineReferences,
    ]),
    navigationTargets: uniqueNavigation([
      ...prior.navigationTargets,
      ...focused.navigationTargets,
    ]),
    limitations: uniqueText([...prior.limitations, ...focused.limitations]),
  };
}

function looksContextDependent(value: string) {
  const text = normalize(value);
  const words = text.split(' ').filter(Boolean);
  if (words.length > 14) return false;
  if (/^(?:and\b|also\b|what about\b|what next\b|show me (?:the |that |those )?(?:evidence|records?|sources?)\b|explain (?:that|this|it)\b)/.test(text)) return true;
  if (/^(?:why|how come)(?:\s+(?:that|this|it|so|the recommendation))?$/.test(text)) return true;
  return /\b(?:that|this|it|those|them|they|previous)\b/.test(text);
}

function resolved(
  originalQuestion: string,
  effectiveQuestion: string,
  prior: DAVEAskConversationEntry,
  followUpKind: DAVEConversationFollowUpKind,
  reason: string,
) {
  return resolution('resolved_follow_up', originalQuestion, effectiveQuestion, prior, followUpKind, reason);
}

function resolution(
  status: DAVEConversationContextResolution['status'],
  originalQuestion: string,
  effectiveQuestion: string,
  priorEntry: DAVEAskConversationEntry | null,
  followUpKind: DAVEConversationFollowUpKind | null,
  reason: string,
): DAVEConversationContextResolution {
  return Object.freeze({
    status,
    originalQuestion,
    effectiveQuestion,
    priorEntryId: priorEntry?.id || null,
    priorEntry,
    followUpKind,
    reason,
  });
}

function uniqueEvidence(items: DAVEAskEvidence[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.sourceType}:${item.recordId}:${item.timelineEventId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function uniqueNavigation(items: DAVEAskAnswer['navigationTargets']) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.target}:${item.sourceRecordId}:${item.timelineEventId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueText(items: string[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = clean(item).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recentEnough(value: string, now: Date, maxAgeDays: number) {
  const time = timestamp(value);
  return time > 0 && now.getTime() - time <= maxAgeDays * 86_400_000;
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalize(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function shorten(value: string, maxLength: number) {
  const text = clean(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trim()}…`;
}
