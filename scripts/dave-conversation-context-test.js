#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'services/DAVEConversationContext.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  specifier => {
    if (specifier === './DAVEAsk') {
      return {
        askDAVE: () => ({
          answer: 'Fresh project answer.',
          confidence: 'medium',
          limitations: [],
          supportingEvidence: [{ sourceType: 'schedule', recordId: 'fresh-task', summary: 'Fresh schedule evidence.', timelineEventId: null }],
          timelineReferences: [],
          recommendedNextAction: 'Review the fresh task.',
          navigationTargets: [],
        }),
      };
    }
    throw new Error(`Unexpected runtime dependency: ${specifier}`);
  },
  moduleUnderTest,
  moduleUnderTest.exports,
);
const {
  answerDAVEConversationContext,
  resolveDAVEConversationContext,
} = moduleUnderTest.exports;

const answer = {
  answer: 'The project is at risk because controls startup is overdue.',
  confidence: 'high',
  limitations: [],
  supportingEvidence: [{ sourceType: 'schedule', recordId: 'task-1', summary: 'Controls startup overdue.', timelineEventId: null }],
  timelineReferences: [],
  recommendedNextAction: 'Confirm the controls contractor recovery date.',
  navigationTargets: [],
};
const history = [{
  id: 'entry-a',
  projectId: 'project-a',
  question: 'Why is this project at risk?',
  answer,
  createdAt: '2026-07-16T10:00:00.000Z',
}, {
  id: 'entry-b',
  projectId: 'project-b',
  question: 'What changed?',
  answer: { ...answer, recommendedNextAction: null },
  createdAt: '2026-07-16T11:00:00.000Z',
}];
const now = new Date('2026-07-16T12:00:00.000Z');

const why = resolveDAVEConversationContext({ transcript: 'Why?', history, projectId: 'project-a', now });
assert.strictEqual(why.status, 'resolved_follow_up');
assert.strictEqual(why.priorEntryId, 'entry-a');
assert(/recommend/i.test(why.effectiveQuestion));

const evidence = resolveDAVEConversationContext({ transcript: 'Show me the evidence.', history, projectId: 'project-a', now });
assert.strictEqual(evidence.followUpKind, 'supporting_evidence');
const contextualEvidence = answerDAVEConversationContext({
  resolution: evidence,
  intelligence: {},
});
assert.deepStrictEqual(
  contextualEvidence.supportingEvidence.map(item => item.recordId),
  ['task-1'],
  'evidence follow-up must preserve the records from the answer it refers to',
);
assert(contextualEvidence.answer.includes(answer.answer));

const schedule = resolveDAVEConversationContext({ transcript: 'And the schedule?', history, projectId: 'project-a', now });
assert(/project status.*schedule/i.test(schedule.effectiveQuestion));

const standalone = resolveDAVEConversationContext({ transcript: 'What changed today?', history, projectId: 'project-a', now });
assert.strictEqual(standalone.status, 'standalone');
assert.strictEqual(standalone.effectiveQuestion, 'What changed today?');

const standaloneSchedule = resolveDAVEConversationContext({
  transcript: 'What is the project schedule?',
  history: [],
  projectId: 'project-a',
  now,
});
assert.strictEqual(standaloneSchedule.status, 'standalone', 'a self-contained schedule question must not require prior conversation');

const isolated = resolveDAVEConversationContext({ transcript: 'Why?', history, projectId: 'project-c', now });
assert.strictEqual(isolated.status, 'ambiguous_follow_up');
assert.strictEqual(isolated.priorEntryId, null, 'another project conversation must never supply context');
assert(!isolated.effectiveQuestion.includes('controls'), 'ambiguous follow-ups must not invent prior evidence');
assert.strictEqual(
  answerDAVEConversationContext({ resolution: isolated, intelligence: {} }),
  null,
  'ambiguous follow-ups must request clarification instead of generating an answer',
);

const stale = resolveDAVEConversationContext({
  transcript: 'Show me those records.',
  history: [{ ...history[0], createdAt: '2026-01-01T00:00:00.000Z' }],
  projectId: 'project-a',
  now,
});
assert.strictEqual(stale.status, 'ambiguous_follow_up', 'stale history must not silently control a new conversation');

const askExperience = fs.readFileSync(path.join(root, 'components/DAVEAskExperience.tsx'), 'utf8');
assert(askExperience.includes('resolveDAVEConversationContext'));
assert(askExperience.includes('Follow-up understood as:'));
assert(askExperience.includes('One detail needed'));
const answerSheet = fs.readFileSync(path.join(root, 'components/DAVEConversationAnswerSheet.tsx'), 'utf8');
assert(answerSheet.includes('Supporting records'));
assert(answerSheet.includes('onOpenEvidence(citation)'));
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
assert(app.includes('resolveDAVEConversationContext'));
assert(app.includes('openTalkSupportingEvidence'));
assert(app.includes("context.status === 'ambiguous_follow_up'"));

console.log('DAVE conversation-context behavior tests passed.');
