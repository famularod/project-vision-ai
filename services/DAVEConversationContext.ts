import { askDAVE, routeDAVEAskIntent, type DAVEAskAnswer, type DAVEAskEvidence } from './DAVEAsk';
import type { DAVEAskConversationEntry } from './DAVEAskConversation';
import { classifyDAVEConversationIntent } from './DAVEConversationRouter';
import type { DAVEProjectIntelligence } from './DAVEIntelligence';

export type DAVEConversationFollowUpKind =
  | 'supporting_evidence'
  | 'explanation'
  | 'schedule'
  | 'next_action'
  | 'prior_answer'
  | 'added_subject';

export type DAVEConversationContextResolution = Readonly<{
  status: 'standalone' | 'resolved_follow_up' | 'ambiguous_follow_up';
  originalQuestion: string;
  effectiveQuestion: string;
  priorEntryId: string | null;
  priorEntry: DAVEAskConversationEntry | null;
  followUpKind: DAVEConversationFollowUpKind | null;
  reason: string;
}>;

/**
 * Whole-app audit A9 pass 2 F1 (30 Sep 2026): `history` is the answers given
 * since Talk was opened (hooks/use-talk-session.ts), not every saved answer of
 * the project. A question that only leans on "this", "that", "it" or "they"
 * ("Why is this wall cracked?") is answered in the owner's own words; the
 * earlier answer only lends its records. "Why?", "Show me the evidence",
 * "Explain that" and "And…/Also…/What about…" stay follow-ups, and the answer
 * they explain is the underlying one, so replies never nest.
 */
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
  const projectHistory = history.filter(entry => entry.projectId === projectId);
  const latest = latestEntry(projectHistory.filter(entry => recentEnough(entry.createdAt, now, maxAgeDays)));
  const dependence = contextDependence(originalQuestion, Boolean(latest));
  if (!dependence) {
    return resolution('standalone', originalQuestion, originalQuestion, null, null, 'The question is self-contained.');
  }

  if (!latest && dependence === 'pronoun') {
    // Whole-app audit A9 pass 1 #1 (30 Sep 2026): "Did they send it?" with
    // nothing earlier to point at is answered as asked, not refused.
    return resolution('standalone', originalQuestion, originalQuestion, null, null, 'No recent answer exists, so the question is answered as asked.');
  }
  if (!latest) {
    return resolution(
      'ambiguous_follow_up',
      originalQuestion,
      'What project information are you referring to?',
      null,
      null,
      'No recent answer exists for this project, so ECOS must ask for context instead of guessing.',
    );
  }

  if (dependence === 'pronoun') {
    // A9 pass 2 F1a: his own words are the question answered and searched.
    return resolved(originalQuestion, originalQuestion, latest, 'prior_answer', 'The question is answered as asked; the latest answer in this Talk session only adds its records.');
  }

  const text = normalize(originalQuestion);
  const subject = addedSubjectWords(text);
  const kind = subject
    ? subject.length === 0 ? null : FOLLOW_UP_RULES.find(rule => subject.every(word => rule.words.has(word)))?.kind || 'added_subject'
    : FOLLOW_UP_RULES.find(rule => rule.pattern.test(text))?.kind || null;
  // Evidence and explanation are about the answer itself, never a reply about a reply (A9 pass 2 F1c).
  const basis = answerBasis(latest, projectHistory);
  if (kind === 'supporting_evidence') {
    return resolved(originalQuestion, 'Show the supporting evidence for the previous answer.', basis, 'supporting_evidence', 'The follow-up asks for records supporting the previous answer.');
  }
  if (kind === 'explanation') {
    return resolved(
      originalQuestion,
      basis.answer.recommendedNextAction
        ? 'Why did you recommend the next action?'
        : `Explain why the project answer to "${shorten(answeredQuestion(basis), 90)}" is supported.`,
      basis,
      'explanation',
      'The follow-up asks ECOS to explain the previous conclusion or recommendation.',
    );
  }
  if (kind === 'schedule') {
    return resolved(originalQuestion, 'What is the project status, especially the schedule and overdue work?', latest, 'schedule', 'The follow-up narrows the prior project discussion to schedule status.');
  }
  if (kind === 'next_action') {
    return resolved(originalQuestion, 'What should I do next?', latest, 'next_action', 'The follow-up asks for the next accountable action.');
  }
  if (kind === 'added_subject') {
    // A9 pass 2 F1d: "And the drywall?" keeps "drywall" next to the question it continues.
    return resolved(
      originalQuestion,
      `${clean(baseQuestionEntry(latest, projectHistory).question)} ${originalQuestion}`,
      latest,
      'added_subject',
      'The follow-up asks the earlier question about another subject.',
    );
  }
  return resolved(
    originalQuestion,
    `Summarize the project with emphasis on the previous question: "${shorten(answeredQuestion(basis), 90)}".`,
    latest,
    'prior_answer',
    'The follow-up refers to the latest answer in this Talk session.',
  );
}

/**
 * Whole-app audit A9 pass 2 F2 (30 Sep 2026): the question "Ask in Ask ECOS"
 * sends for a Talk answer. Ask ECOS reads it on its own, so a follow-up's bare
 * words ("Show me the evidence", "Why?") are never sent: an evidence or "why"
 * follow-up sends the question it is about, "And the ramp?" sends the earlier
 * question followed by those words, and anything else returns null (the owner
 * asks the full question himself).
 */
export function askECOSQuestionForTalk(
  context: DAVEConversationContextResolution,
  history: readonly DAVEAskConversationEntry[],
): string | null {
  if (context.status === 'ambiguous_follow_up') return null;
  if (context.status === 'standalone') return askable(context.originalQuestion);
  if (context.followUpKind === 'added_subject') return askable(context.effectiveQuestion);
  const prior = history.find(entry => entry.id === context.priorEntryId) || context.priorEntry;
  if (context.followUpKind === 'supporting_evidence' || context.followUpKind === 'explanation') {
    return prior ? ecosQuestionForEntry(answerBasis(prior, history)) : null;
  }
  if (sameWords(context.effectiveQuestion, context.originalQuestion)) return askable(context.originalQuestion);
  // "And the schedule?" is answered here as a schedule summary; Ask ECOS gets his words after the question they continue.
  return prior && addedSubjectWords(normalize(context.originalQuestion))?.length
    ? askable(`${clean(baseQuestionEntry(prior, history).question)} ${context.originalQuestion}`)
    : null;
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
    // A pronoun question or a new subject takes only the earlier records, not its caveats.
    limitations: context.followUpKind === 'prior_answer' || context.followUpKind === 'added_subject'
      ? focused.limitations
      : uniqueText([...prior.limitations, ...focused.limitations]),
  };
}

const FOLLOW_UP_RULES: ReadonlyArray<Readonly<{ kind: DAVEConversationFollowUpKind; pattern: RegExp; words: ReadonlySet<string> }>> = [
  {
    kind: 'supporting_evidence',
    pattern: /\b(?:evidence|record|records|source|sources|show me|prove|support)\b/,
    words: new Set(['evidence', 'record', 'records', 'source', 'sources', 'prove', 'proof', 'support', 'supporting']),
  },
  { kind: 'explanation', pattern: /\b(?:why|explain|how come|reason)\b/, words: new Set(['why', 'explain', 'reason', 'reasons', 'come']) },
  {
    kind: 'schedule',
    pattern: /\b(?:schedule|dates?|deadline|deadlines|late|overdue|due)\b/,
    words: new Set(['schedule', 'date', 'dates', 'deadline', 'deadlines', 'late', 'overdue', 'due']),
  },
  {
    kind: 'next_action',
    pattern: /\b(?:what next|next|do now|should i do|action)\b/,
    words: new Set(['next', 'action', 'actions', 'step', 'steps', 'do', 'now', 'should', 'i']),
  },
];

/**
 * Whole-app audit A11 pass 3 (30 Sep 2026): after an answer, "And the dumpster
 * full" or "Also the roof hatch open" (no "?") was answered as a follow-up and
 * never reached Confirm Memory. Without "?", only these subjects continue the
 * answer ("And the schedule", "Also the inspections"); anything else is a note.
 */
const FOLLOW_UP_TOPIC_WORDS: ReadonlySet<string> = new Set([
  ...FOLLOW_UP_RULES.flatMap(rule => [...rule.words]),
  'status', 'risk', 'risks', 'attention', 'issues', 'problems', 'blockers', 'changes', 'commitments',
  'inspection', 'inspections', 'updates',
]);

// Words that carry no subject in "And the…?", "Also what about that?".
const FOLLOW_UP_FILLER = new Set([
  'the', 'a', 'an', 'and', 'also', 'what', 'about', 'how', 'is', 'are', 'me', 'show', 'please', 'of', 'for', 'to',
  'on', 'at', 'in', 'with', 'that', 'this', 'it', 'those', 'them', 'they', 'one', 'ones', 'then', 'so', 'just', 'there',
]);

/** The subject words after "And", "Also" or "What about"; null for any other opening. */
function addedSubjectWords(text: string): string[] | null {
  const match = /^(?:and|also|what about)\b(.*)$/.exec(text);
  return match ? match[1].split(' ').filter(word => word && !FOLLOW_UP_FILLER.has(word)) : null;
}

// A9 pass 2 F3: words that make "And…"/"Also…" a field note rather than a question.
const FIELD_NOTE_WORDS = new Set([
  'said', 'says', 'say', 'told', 'tell', 'tells', 'asked', 'will', 'would', 'wont', 'going', 'gonna', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'am', 'has', 'have', 'had', 'did', 'does', 'done', 'got', 'get', 'gets',
  'finished', 'finish', 'finishes', 'completed', 'complete', 'started', 'start', 'installed', 'install', 'delivered',
  'deliver', 'arrived', 'arrive', 'passed', 'pass', 'failed', 'fail', 'promised', 'promise', 'committed', 'approved',
  'rejected', 'decided', 'need', 'needs', 'needed', 'called', 'call', 'remind', 'remember', 'note', 'noted', 'moved',
  'move', 'delayed', 'rescheduled', 'broke', 'broken', 'cracked', 'leaking', 'leaked', 'came', 'left', 'went', 'back',
  'today', 'tomorrow', 'yesterday', 'tonight', 'morning', 'afternoon', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'week', 'll', 're', 've',
]);

/**
 * Whole-app audit A9 pass 1 #1 (30 Sep 2026): every short Talk input with
 * "it", "this" or "they" was read as a follow-up, so a field note or task
 * update was answered with the previous reply, or refused when there was
 * none. Only a question can point back at an answer. 'explicit' openings
 * ("And…", "Why?", "Show me the evidence") need one; a 'pronoun' question
 * uses one when it exists and is otherwise answered as asked.
 */
function contextDependence(value: string, hasPriorAnswer: boolean): 'explicit' | 'pronoun' | null {
  const text = normalize(value);
  const words = text.split(' ').filter(Boolean);
  if (words.length > 14) return null;
  const intent = classifyDAVEConversationIntent(value);
  if (intent !== 'ask') {
    // The router files "Show me the evidence" as a note, yet it asks about the previous answer.
    if (/^show me (?:the |that |those )?(?:evidence|records?|sources?)\b/.test(text)) return 'explicit';
    // A9 pass 2 F3: "And the schedule" without "?" continues this Talk session's answer, unless it reads as a note.
    return hasPriorAnswer && intent !== 'task_update' && intent !== 'navigate' &&
      /^(?:and|also|what about)\b/.test(text) && !/\d/.test(text) && words.length <= 8 &&
      !words.some(word => FIELD_NOTE_WORDS.has(word)) &&
      (addedSubjectWords(text) || []).every(word => FOLLOW_UP_TOPIC_WORDS.has(word)) ? 'explicit' : null;
  }
  if (/^(?:and\b|also\b|what about\b|what next\b|show me (?:the |that |those )?(?:evidence|records?|sources?)\b|explain (?:that|this|it)\b)/.test(text)) return 'explicit';
  if (/^(?:why|how come)(?:\s+(?:(?:is|was)\s+)?(?:that|this|it|so|the recommendation))?$/.test(text)) return 'explicit';
  if (routeDAVEAskIntent(value) !== 'unknown') return null;
  return /\b(?:that|this|it|those|them|they|previous)\b/.test(text) ? 'pronoun' : null;
}

/** The newest entry; of two saved in the same millisecond, the later one. */
function latestEntry(entries: readonly DAVEAskConversationEntry[]) {
  let latest: DAVEAskConversationEntry | null = null;
  for (const entry of entries) {
    if (!latest || timestamp(entry.createdAt) >= timestamp(latest.createdAt)) latest = entry;
  }
  return latest;
}

function earlierEntry(entry: DAVEAskConversationEntry, history: readonly DAVEAskConversationEntry[]) {
  return entry.priorEntryId ? history.find(item => item.id === entry.priorEntryId && item.id !== entry.id) || null : null;
}

/** Walks back through "Show me the evidence" and "Why?" replies to the answer they are about. */
function answerBasis(entry: DAVEAskConversationEntry, history: readonly DAVEAskConversationEntry[]) {
  let current = entry;
  for (let step = 0; step < history.length && (current.followUpKind === 'supporting_evidence' || current.followUpKind === 'explanation'); step += 1) {
    const earlier = earlierEntry(current, history);
    if (!earlier) break;
    current = earlier;
  }
  return current;
}

/** Walks back to the last question the owner asked in full ("What is overdue?" behind "And the drywall?"). */
function baseQuestionEntry(entry: DAVEAskConversationEntry, history: readonly DAVEAskConversationEntry[]) {
  let current = entry;
  for (let step = 0; step < history.length && !ownWordsAnswered(current); step += 1) {
    const earlier = earlierEntry(current, history);
    if (!earlier) break;
    current = earlier;
  }
  return current;
}

function ownWordsAnswered(entry: DAVEAskConversationEntry) {
  return entry.contextStatus !== 'resolved_follow_up' || !entry.resolvedQuestion || sameWords(entry.resolvedQuestion, entry.question);
}

function answeredQuestion(entry: DAVEAskConversationEntry) {
  return entry.followUpKind === 'added_subject' && entry.resolvedQuestion ? entry.resolvedQuestion : entry.question;
}

function ecosQuestionForEntry(entry: DAVEAskConversationEntry) {
  if (entry.followUpKind === 'added_subject') return askable(entry.resolvedQuestion || '');
  return ownWordsAnswered(entry) ? askable(entry.question) : null;
}

/** Ask ECOS accepts 3 to 1,000 characters (services/ECOSProjectQuestion.ts). */
function askable(question: string) {
  const text = clean(question);
  return text.length >= 3 && text.length <= 1_000 ? text : null;
}

function sameWords(left: string, right: string) {
  return normalize(left) === normalize(right);
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
