import {
  answerDAVEConversationContext,
  resolveDAVEConversationContext,
} from '../../services/DAVEConversationContext';
import {
  classifyDAVEConversationIntent,
  routeDAVEConversation,
} from '../../services/DAVEConversationRouter';
import type { DAVEAskAnswer } from '../../services/DAVEAsk';
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
