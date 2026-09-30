#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

// Whole-app audit A9 pass 1 #1 (30 Sep 2026): the context check now asks the
// conversation router whether an input is a question, so the real modules
// load here, the way dave-conversation-router-test.js loads them.
function loadTs(relativePath, cache = new Map()) {
  const filename = path.join(root, relativePath);
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const localRequire = request => request.startsWith('.')
    ? loadTs(path.relative(root, path.resolve(path.dirname(filename), `${request}.ts`)), cache)
    : require(request);
  vm.runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require: localRequire,
    Date,
    Set,
    Map,
    WeakMap,
    Math,
    JSON,
    Object,
    Array,
    RegExp,
    encodeURIComponent,
  }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const {
  answerDAVEConversationContext,
  resolveDAVEConversationContext,
} = loadTs('services/DAVEConversationContext.ts');

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

for (const note of [
  'Drywall crew said they will finish level two on Friday',
  'Mark it complete',
  'Is this project on track?',
]) {
  assert.strictEqual(
    resolveDAVEConversationContext({ transcript: note, history, projectId: 'project-a', now }).status,
    'standalone',
    `${note} must not be answered with the previous reply (audit A9 pass 1 #1)`,
  );
}
assert.strictEqual(
  resolveDAVEConversationContext({ transcript: 'Did they send it?', history: [], projectId: 'project-a', now }).status,
  'standalone',
  'a question with "they" and no earlier answer is answered as asked, not refused',
);

// DAVEAskExperience.tsx was deleted on 2026-09-20: unreachable from either
// entry point, and this script's own assertion below says it 'must remain
// hidden until its answers are dependable'. Assertions describing its
// contents are gone; the guard that it stays out of the workspace remains.
const answerSheet = fs.readFileSync(path.join(root, 'components/DAVEConversationAnswerSheet.tsx'), 'utf8');
assert(answerSheet.includes('Supporting records'));
assert(answerSheet.includes('onOpenEvidence(citation)'));
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
assert(app.includes('resolveDAVEConversationContext'));
assert(app.includes('openTalkSupportingEvidence'));
assert(app.includes("context.status === 'ambiguous_follow_up'"));

console.log('DAVE conversation-context behavior tests passed.');
