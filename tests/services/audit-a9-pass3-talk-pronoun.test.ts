import {
  answerDAVEConversationContext,
  resolveDAVEConversationContext,
  type DAVEConversationContextResolution,
} from '../../services/DAVEConversationContext';
import { askDAVE, type DAVEAskAnswer } from '../../services/DAVEAsk';
import type { DAVEAskConversationEntry } from '../../services/DAVEAskConversation';
import { buildProjectIntelligence } from '../../services/DAVEIntelligence';

// Audit A9 pass 3 L4 (30 Sep 2026): in Talk, after "What is overdue?", the
// unrelated "Is this wall rated for 3 hours?" was answered "I don't have
// enough current project information…" yet listed the controls-startup record
// from the earlier answer as its support, and "Show me the evidence" then
// cited that record as supporting the wall answer. A question that only leans
// on this/that/it/they now stands on its own records. Synthetic project data.

const PROJECT_ID = 'project-2321-compliance-project';
const now = new Date('2026-09-30T12:00:00.000Z');

const overdueAnswer: DAVEAskAnswer = {
  answer: 'Controls startup is overdue; confirm the recovery date with the controls contractor.',
  confidence: 'high',
  limitations: [],
  supportingEvidence: [{ sourceType: 'schedule', recordId: 'controls-startup', summary: 'Controls startup overdue.', timelineEventId: null }],
  timelineReferences: [{ id: 'timeline-controls', label: 'Controls startup', date: '2026-09-29' }] as never,
  recommendedNextAction: 'Confirm the controls contractor recovery date.',
  navigationTargets: [{ target: 'schedule', sourceRecordId: 'controls-startup', timelineEventId: null }] as never,
};

const intelligence = buildProjectIntelligence({
  projectId: PROJECT_ID,
  projectName: '2321 Compliance Project',
  now: now.toISOString(),
  updates: [{ id: 'update-1', projectName: '2321 Compliance Project', date: '2026-09-30T10:00:00.000Z', photos: [] }],
  documents: [],
  scheduleItems: [],
} as unknown as Parameters<typeof buildProjectIntelligence>[0]);

let sequence = 0;
function record(session: DAVEAskConversationEntry[], context: DAVEConversationContextResolution, answer: DAVEAskAnswer) {
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
  if (answer) record(session, context, answer);
  return { context, answer: answer! };
}
function afterOverdue() {
  const session: DAVEAskConversationEntry[] = [];
  const context = resolveDAVEConversationContext({ transcript: 'What is overdue?', history: session, projectId: PROJECT_ID, now });
  record(session, context, overdueAnswer);
  return session;
}
const recordIds = (answer: DAVEAskAnswer) => answer.supportingEvidence.map(item => item.recordId);

describe('audit A9 pass 3 L4: a pronoun question does not borrow the earlier answer\'s records', () => {
  it.each([
    'Is this wall rated for 3 hours?',
    'Did they support the formwork?',
    'What blocking does this wall need?',
  ])('"%s" is answered on its own records only', question => {
    const { context, answer } = talk(afterOverdue(), question);
    expect(context.effectiveQuestion).toBe(question);
    const own = askDAVE({ question, intelligence });
    expect(answer.answer).toBe(own.answer);
    expect(recordIds(answer)).not.toContain('controls-startup');
    expect(answer.supportingEvidence).toEqual(own.supportingEvidence);
    expect(answer.timelineReferences).toEqual(own.timelineReferences);
    expect(answer.navigationTargets).toEqual(own.navigationTargets);
  });

  it('"Show me the evidence" after it does not cite the earlier record for the new answer', () => {
    const session = afterOverdue();
    talk(session, 'Is this wall rated for 3 hours?');
    const evidence = talk(session, 'Show me the evidence');
    expect(evidence.context.followUpKind).toBe('supporting_evidence');
    expect(recordIds(evidence.answer)).not.toContain('controls-startup');
    expect(evidence.answer.answer).not.toContain('These are the records that supported');
  });

  it.each([
    ['Why?', 'explanation'],
    ['Show me the evidence', 'supporting_evidence'],
    ['Explain that', 'explanation'],
    ['And the schedule?', 'schedule'],
    ['What next?', 'next_action'],
    ['And the drywall?', 'added_subject'],
  ])('the real follow-up "%s" still carries the earlier records (%s)', (question, kind) => {
    const { context, answer } = talk(afterOverdue(), question);
    expect(context.followUpKind).toBe(kind);
    expect(recordIds(answer)).toContain('controls-startup');
  });
});
