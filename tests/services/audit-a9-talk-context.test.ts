import {
  answerDAVEConversationContext,
  askECOSQuestionForTalk,
  resolveDAVEConversationContext,
  type DAVEConversationContextResolution,
} from '../../services/DAVEConversationContext';
import {
  classifyDAVEConversationIntent,
  routeDAVEConversation,
} from '../../services/DAVEConversationRouter';
import { askDAVE, routeDAVEAskIntent, type DAVEAskAnswer } from '../../services/DAVEAsk';
import type { DAVEAskConversationEntry } from '../../services/DAVEAskConversation';
import { buildProjectIntelligence } from '../../services/DAVEIntelligence';

// Whole-app audit A9 pass 1 #1 (30 Sep 2026): any Talk input of 14 words or
// fewer with it/this/they was caught as a follow-up. With a recent answer the
// old reply came back word for word and was saved as the new "question";
// without one the input was refused. Field notes, task updates and ordinary
// questions were all caught. Synthetic project data only.

const PROJECT_ID = 'project-2321-compliance-project';
const now = new Date('2026-09-30T12:00:00.000Z');

const priorAnswer: DAVEAskAnswer = {
  answer: 'Controls startup is overdue; confirm the recovery date with the controls contractor.',
  confidence: 'high',
  limitations: [],
  supportingEvidence: [{
    sourceType: 'schedule',
    recordId: 'prior-task',
    summary: 'Controls startup overdue.',
    timelineEventId: null,
  }],
  timelineReferences: [],
  recommendedNextAction: 'Confirm the controls contractor recovery date.',
  navigationTargets: [],
};
const history: DAVEAskConversationEntry[] = [{
  id: 'entry-1',
  projectId: PROJECT_ID,
  question: 'Why is this project at risk?',
  answer: priorAnswer,
  createdAt: '2026-09-30T11:00:00.000Z',
}];

const intelligence = buildProjectIntelligence({
  projectId: PROJECT_ID,
  projectName: '2321 Compliance Project',
  now: now.toISOString(),
  updates: [{
    id: 'update-1',
    projectName: '2321 Compliance Project',
    date: '2026-09-30T10:00:00.000Z',
    photos: [],
  }],
  documents: [],
  scheduleItems: [],
} as unknown as Parameters<typeof buildProjectIntelligence>[0]);

const CAPTURE = ['remember', 'field_information', 'follow_up'];

// [input, what the router does with it, how it depends on an earlier answer]
const cases: ReadonlyArray<readonly [string, 'capture' | 'task_update' | 'ask', 'none' | 'explicit' | 'pronoun']> = [
  ['Drywall crew said they will finish level two on Friday', 'capture', 'none'],
  ['Mark framing complete, it passed inspection', 'capture', 'none'],
  ['The inspector said this wall needs blocking at grid 4', 'capture', 'none'],
  ['Is this project on track?', 'ask', 'none'],
  ['Mark it complete', 'task_update', 'none'],
  ['Set it to 50%', 'task_update', 'none'],
  ['How is this project doing?', 'ask', 'none'],
  ['What happened this week?', 'ask', 'none'],
  ['Plumber promised they will be back Monday', 'capture', 'none'],
  ['Remind me to call them tomorrow', 'capture', 'none'],
  ['Electrician says it is late, they need two more days', 'capture', 'none'],
  ['Show me the evidence', 'capture', 'explicit'],
  ['Why?', 'ask', 'explicit'],
  ['And the schedule?', 'ask', 'explicit'],
  ['Did they send it?', 'ask', 'pronoun'],
];

function resolve(transcript: string, withHistory: boolean) {
  return resolveDAVEConversationContext({
    transcript,
    history: withHistory ? history : [],
    projectId: PROJECT_ID,
    now,
  });
}

describe('audit A9 pass 1 #1: Talk inputs with it/this/they', () => {
  it.each(cases)('%s routes as %s', (input, route) => {
    const intent = classifyDAVEConversationIntent(input);
    expect(intent).toBe(routeDAVEConversation({ transcript: input, intelligence }).intent);
    if (route === 'capture') expect(CAPTURE).toContain(intent);
    else expect(intent).toBe(route);
  });

  it.each(cases.filter(([, , dependence]) => dependence === 'none'))(
    '%s (%s) is standalone with and without an earlier answer',
    input => {
      for (const withHistory of [true, false]) {
        const context = resolve(input, withHistory);
        expect(context.status).toBe('standalone');
        expect(context.effectiveQuestion).toBe(input);
        expect(context.priorEntry).toBeNull();
      }
    },
  );

  it.each(cases.filter(([, , dependence]) => dependence !== 'none'))(
    '%s (%s) resolves against the earlier answer and never returns it verbatim',
    input => {
      const context = resolve(input, true);
      expect(context.status).toBe('resolved_follow_up');
      expect(context.priorEntryId).toBe('entry-1');
      const answer = answerDAVEConversationContext({ resolution: context, intelligence });
      expect(answer).not.toBeNull();
      expect(answer).not.toBe(priorAnswer);
      expect(answer!.answer).not.toBe(priorAnswer.answer);
      expect(answer!.supportingEvidence.map(item => item.recordId)).toContain('prior-task');
    },
  );

  it.each(cases.filter(([, , dependence]) => dependence === 'explicit'))(
    '%s with no earlier answer asks which information is meant',
    input => {
      const context = resolve(input, false);
      expect(context.status).toBe('ambiguous_follow_up');
      expect(answerDAVEConversationContext({ resolution: context, intelligence })).toBeNull();
    },
  );

  it('a question with "they" and no earlier answer is answered as asked, not refused', () => {
    const context = resolve('Did they send it?', false);
    expect(context.status).toBe('standalone');
    expect(context.effectiveQuestion).toBe('Did they send it?');
  });

  it('a pronoun follow-up gets a fresh answer with the earlier records, not the earlier reply', () => {
    const context = resolve('Did they send it?', true);
    expect(context.followUpKind).toBe('prior_answer');
    const answer = answerDAVEConversationContext({ resolution: context, intelligence })!;
    expect(answer).not.toBe(priorAnswer);
    expect(answer.answer).not.toBe(priorAnswer.answer);
    expect(answer.supportingEvidence.map(item => item.recordId)).toContain('prior-task');
  });
});

// Whole-app audit A9 pass 2 F1/F2/F3 (30 Sep 2026): a question leaning on
// "this/that/it/they" was answered from the earlier answer ("My previous answer
// was…", "These are the records…", or a summary around the old question);
// "Why?" after "Show me the evidence" nested replies; "And the drywall?" lost
// "drywall"; "And the schedule" without "?" became a note; and "Ask in Ask
// ECOS" sent a follow-up's bare words. `history` is now this Talk session.
describe('audit A9 pass 2: follow-ups within one Talk session', () => {
  let sequence = 0;
  /** What persistTalkAnswer adds to the Talk session. */
  function record(
    session: DAVEAskConversationEntry[],
    context: DAVEConversationContextResolution,
    answer: DAVEAskAnswer,
  ) {
    sequence += 1;
    session.push({
      id: `session-${sequence}`,
      projectId: PROJECT_ID,
      question: context.originalQuestion,
      answer,
      createdAt: new Date(now.getTime() + sequence * 1000).toISOString(),
      contextStatus: context.status,
      resolvedQuestion: context.status !== 'standalone' ? context.effectiveQuestion : null,
      priorEntryId: context.priorEntryId,
      followUpKind: context.followUpKind,
    });
  }
  function talk(session: DAVEAskConversationEntry[], transcript: string) {
    const context = resolveDAVEConversationContext({
      transcript, history: session, projectId: PROJECT_ID, now: new Date(now.getTime() + 3_600_000),
    });
    const answer = answerDAVEConversationContext({ resolution: context, intelligence });
    const askECOSQuestion = askECOSQuestionForTalk(context, session);
    if (answer) record(session, context, answer);
    return { context, answer, askECOSQuestion };
  }
  function sessionAfter(question: string, answer: DAVEAskAnswer = priorAnswer) {
    const session: DAVEAskConversationEntry[] = [];
    const context = resolveDAVEConversationContext({ transcript: question, history: session, projectId: PROJECT_ID, now });
    record(session, context, answer);
    return session;
  }

  it.each([
    'Why is this wall cracked?',
    'Did they support the formwork?',
    'What guardrail protection is required at this parking edge?',
  ])('"%s" is answered in the owner\'s own words, with the earlier records only', input => {
    const session = sessionAfter('What is overdue?');
    const { context, answer, askECOSQuestion } = talk(session, input);
    expect(context.effectiveQuestion).toBe(input);
    expect(context.followUpKind).toBe('prior_answer');
    expect(answer!.answer).toBe(askDAVE({ question: input, intelligence }).answer);
    expect(answer!.answer).not.toContain(priorAnswer.answer);
    expect(answer!.supportingEvidence.map(item => item.recordId)).toContain('prior-task');
    expect(askECOSQuestion).toBe(input);
  });

  it.each([
    ['Why?', 'explanation'],
    ['Why is that?', 'explanation'],
    ['Explain that', 'explanation'],
    ['Show me the evidence', 'supporting_evidence'],
    ['And the schedule?', 'schedule'],
    ['What next?', 'next_action'],
    ['And the drywall?', 'added_subject'],
  ])('"%s" stays a follow-up (%s)', (input, kind) => {
    const { context } = talk(sessionAfter('What is overdue?'), input);
    expect(context.status).toBe('resolved_follow_up');
    expect(context.followUpKind).toBe(kind);
  });

  it('"Why?" after "Show me the evidence" explains the original answer, and the evidence after "Why?" shows it, without nesting', () => {
    const session = sessionAfter('What is overdue?');
    expect(talk(session, 'Show me the evidence').answer!.answer).toBe(
      `These are the records that supported my previous answer: ${priorAnswer.answer}`,
    );
    const why = talk(session, 'Why?');
    expect(why.context.priorEntryId).toBe(session[0].id);
    expect(why.answer!.answer.startsWith(`My previous answer was: ${priorAnswer.answer} I recommended`)).toBe(true);
    const evidence = talk(session, 'Show me the evidence');
    expect(evidence.answer!.answer).toBe(`These are the records that supported my previous answer: ${priorAnswer.answer}`);
    expect(evidence.askECOSQuestion).toBe('What is overdue?');
    expect(why.askECOSQuestion).toBe('What is overdue?');
  });

  it('"And/Also/What about X" keeps X next to the question it continues, never nesting', () => {
    const session = sessionAfter('What guardrail is required at the parking edge?');
    const drywall = talk(session, 'And the drywall?');
    expect(drywall.context.effectiveQuestion).toBe('What guardrail is required at the parking edge? And the drywall?');
    expect(drywall.answer!.answer).not.toContain('Summarize');
    expect(drywall.askECOSQuestion).toBe('What guardrail is required at the parking edge? And the drywall?');
    const ramp = talk(session, 'What about the ramp?');
    expect(ramp.context.effectiveQuestion).toBe('What guardrail is required at the parking edge? What about the ramp?');
    expect(talk(session, 'Show me the evidence').askECOSQuestion).toBe('What guardrail is required at the parking edge? What about the ramp?');
    expect(talk(session, 'Also the inspections?').context.effectiveQuestion).toBe('What guardrail is required at the parking edge? Also the inspections?');
  });

  it.each(['And the schedule', 'Also the inspections', 'And the ramp'])(
    '"%s" without "?" is a follow-up after an answer in this session, and a note with none (F3)',
    input => {
      expect(CAPTURE).toContain(classifyDAVEConversationIntent(input));
      expect(talk([], input).context.status).toBe('standalone');
      const { context, answer } = talk(sessionAfter('What is overdue?'), input);
      expect(context.status).toBe('resolved_follow_up');
      expect(answer).not.toBeNull();
    },
  );

  it.each([
    'And the drywall crew finished level two',
    'Also the plumber will be back Monday',
    'And 20 sheets of drywall',
    'Also remind me to call the inspector',
  ])('"%s" stays a note after an answer (F3)', input => {
    expect(talk(sessionAfter('What is overdue?'), input).context.status).toBe('standalone');
  });

  it('Ask ECOS gets the owner\'s question, or nothing when a follow-up cannot stand alone (F2)', () => {
    expect(talk([], 'What guardrail is required at the parking edge?').askECOSQuestion)
      .toBe('What guardrail is required at the parking edge?');
    expect(talk([], 'Why?').askECOSQuestion).toBeNull();
    expect(talk(sessionAfter('What is overdue?'), 'What next?').askECOSQuestion).toBeNull();
    expect(talk(sessionAfter('What is overdue?'), 'And the schedule?').askECOSQuestion).toBe('What is overdue? And the schedule?');
    expect(talk(sessionAfter('What is overdue?'), 'And that?').askECOSQuestion).toBeNull();
  });
});
// Whole-app audit A9 pass 2 (optional item, 30 Sep 2026): the built-in
// question types matched parts of words, so a document question about a base
// plate, wall blocking or heat exchangers got a project summary instead.
describe('audit A9 pass 2: built-in question types match whole words', () => {
  it.each([
    ['What torque is required at this base plate?', 'unknown'],
    ['What blocking does this wall need?', 'unknown'],
    ['What is the blocking spacing?', 'unknown'],
    ['Were the heat exchanges delivered?', 'unknown'],
    ['What is blocking the drywall?', 'needs_attention'],
    ["What's blocking us?", 'needs_attention'],
    ['What needs attention?', 'needs_attention'],
    ['What are the risks?', 'needs_attention'],
    ['What is running late?', 'overdue_commitments'],
    ['What is overdue?', 'overdue_commitments'],
    ['What changed today?', 'what_changed'],
    ['What has changed?', 'what_changed'],
    ['Any change orders?', 'what_changed'],
    ['How are my projects doing?', 'project_status'],
    ['When was the drywall last updated?', 'latest_field_update'],
    ['Why did you recommend that?', 'recommendation_reason'],
    ['Draft an owner update', 'draft_owner_update'],
  ])('%s → %s', (question, intent) => {
    expect(routeDAVEAskIntent(question)).toBe(intent);
  });

  it('a whole-word document question with "this" is answered as asked, not as a built-in type', () => {
    const context = resolveDAVEConversationContext({
      transcript: 'What blocking does this wall need?', history, projectId: PROJECT_ID, now,
    });
    expect(context.followUpKind).toBe('prior_answer');
    expect(context.effectiveQuestion).toBe('What blocking does this wall need?');
  });
});
