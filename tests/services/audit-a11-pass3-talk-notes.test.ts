import {
  resolveDAVEConversationContext,
  type DAVEConversationContextResolution,
} from '../../services/DAVEConversationContext';
import { classifyDAVEConversationIntent } from '../../services/DAVEConversationRouter';
import type { DAVEAskAnswer } from '../../services/DAVEAsk';
import type { DAVEAskConversationEntry } from '../../services/DAVEAskConversation';

// Whole-app audit A11 pass 3 (30 Sep 2026): after a Talk answer, a short note
// starting "And…", "Also…" or "What about…" with no "?" was answered as a
// follow-up, and handleTalkInput returned before drafting a memory, so the
// note never reached Confirm Memory. Without "?", only a follow-up subject
// continues the answer now. Synthetic project data only.

const PROJECT_ID = 'project-2321-compliance-project';
const now = new Date('2026-09-30T12:00:00.000Z');
const answer: DAVEAskAnswer = {
  answer: 'Controls startup is overdue.',
  confidence: 'high',
  limitations: [],
  supportingEvidence: [],
  timelineReferences: [],
  recommendedNextAction: null,
  navigationTargets: [],
};
const afterAnswer: DAVEAskConversationEntry[] = [{
  id: 'session-1', projectId: PROJECT_ID, question: 'What is overdue?', answer,
  createdAt: '2026-09-30T11:59:00.000Z',
}];
const resolve = (transcript: string, history = afterAnswer): DAVEConversationContextResolution =>
  resolveDAVEConversationContext({ transcript, history, projectId: PROJECT_ID, now });

describe('audit A11 pass 3: a short "And…/Also…" note after an answer', () => {
  it.each([
    'And the guardrail missing at the roof edge',
    'Also the roof hatch open',
    'And the dumpster full',
    'Also east stair handrail loose',
    'And the ramp',
  ])('"%s" is a note, not a follow-up', input => {
    expect(['remember', 'field_information', 'follow_up']).toContain(classifyDAVEConversationIntent(input));
    const context = resolve(input);
    expect(context.status).toBe('standalone');
    expect(context.followUpKind).toBeNull();
  });

  it.each([
    ['And the schedule', 'schedule'],
    ['Also the inspections', 'added_subject'],
    ['And the evidence', 'supporting_evidence'],
    ['And the next steps', 'next_action'],
    ['Also the overdue dates', 'schedule'],
  ])('"%s" (no "?") still continues the answer (%s)', (input, kind) => {
    const context = resolve(input);
    expect(context.status).toBe('resolved_follow_up');
    expect(context.followUpKind).toBe(kind);
    expect(resolve(input, []).status).toBe('standalone'); // with no answer it is a note
  });

  it('with "?" any subject is still a follow-up', () => {
    expect(resolve('And the dumpster?').followUpKind).toBe('added_subject');
    expect(resolve('Also the roof hatch?').status).toBe('resolved_follow_up');
  });
});
