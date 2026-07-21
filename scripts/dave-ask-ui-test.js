#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

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
    encodeURIComponent,
  }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const moduleCache = new Map();
const { buildProjectIntelligence } = loadTs('services/DAVEIntelligence.ts', moduleCache);
const { askDAVE } = loadTs('services/DAVEAsk.ts', moduleCache);
const {
  DAVE_ASK_SUGGESTED_QUESTIONS,
  appendDAVEAskHistory,
  buildDAVEAskWhyModel,
  daveAskHistoryStorageKey,
  historyForDAVEProject,
  parseDAVEAskHistory,
  resolveDAVEAskEvidenceNavigation,
  resolveDAVEAskTimelineNavigation,
} = loadTs('services/DAVEAskConversation.ts', moduleCache);

assert.strictEqual(
  Array.from(DAVE_ASK_SUGGESTED_QUESTIONS).join('|'),
  'How is this project doing?|What needs attention?|What changed?|What is overdue?|What should I do next?',
  'Ask Vitruvius must expose five schedule-backed project questions.',
);

const now = '2026-07-12T12:00:00.000Z';
const intelligence = buildProjectIntelligence({
  projectId: 'project-alpha',
  projectName: 'Alpha',
  now,
  updates: [{
    id: 'update-alpha',
    projectName: 'Alpha',
    date: '2026-07-11T10:00:00.000Z',
    safetyFlag: true,
    photos: [{
      id: 'photo-alpha',
      category: 'Safety Concern',
      actionRequired: 'Confirm guardrail status',
      actionOwner: 'Alex',
      actionDueDate: '2026-07-10',
      actionStatus: 'Open',
      locationCapturedAt: '2026-07-11T10:00:00.000Z',
      photoIntelligence: {
        status: 'analysis_complete',
        updatedAt: '2026-07-11T10:01:00.000Z',
        comparisonConfidence: 'high',
        priorEvidenceId: 'baseline-alpha',
        findings: [{ findingType: 'visible_concern', description: 'An open guardrail condition is visible.', confidence: 0.9 }],
      },
    }],
  }],
  documents: [],
  scheduleItems: [],
});

const firstAnswer = askDAVE({ question: DAVE_ASK_SUGGESTED_QUESTIONS[1], intelligence });
const alphaEntry = {
  id: 'ask-alpha-1',
  projectId: 'project-alpha',
  question: DAVE_ASK_SUGGESTED_QUESTIONS[1],
  answer: firstAnswer,
  createdAt: now,
};
const betaEntry = { ...alphaEntry, id: 'ask-beta-1', projectId: 'project-beta' };
const history = appendDAVEAskHistory(appendDAVEAskHistory([], alphaEntry), betaEntry);
assert.strictEqual(history.length, 2, 'Conversation history must append answers without editing prior entries.');
assert(Object.isFrozen(history[0]) && Object.isFrozen(history[1]), 'Conversation entries must be read-only.');
assert.strictEqual(historyForDAVEProject(history, 'project-alpha').length, 1, 'History must be project scoped.');
assert.strictEqual(historyForDAVEProject(history, 'project-beta')[0].id, 'ask-beta-1');
assert.notStrictEqual(daveAskHistoryStorageKey('project-alpha'), daveAskHistoryStorageKey('project-beta'));

const parsedAlpha = parseDAVEAskHistory(JSON.stringify([alphaEntry]), 'project-alpha');
assert.strictEqual(parsedAlpha.length, 1, 'Persisted history must hydrate only the selected project.');
assert.strictEqual(parseDAVEAskHistory(JSON.stringify(history), 'project-alpha').length, 0,
  'A mixed-project payload must fail closed instead of silently dropping records.');
assert.strictEqual(parseDAVEAskHistory('{bad json', 'project-alpha').length, 0);
assert.strictEqual(parseDAVEAskHistory(JSON.stringify([{ projectId: 'project-alpha' }]), 'project-alpha').length, 0);

const why = buildDAVEAskWhyModel(firstAnswer);
assert(why.evidenceUsed.length > 0, 'Why expansion must show evidence used.');
assert.strictEqual(why.confidence, firstAnswer.confidence);
assert.strictEqual(why.limitations, firstAnswer.limitations);
assert.strictEqual(why.timelineEvents, firstAnswer.timelineReferences);
assert.strictEqual(why.supportingRecords, firstAnswer.supportingEvidence);

const citation = firstAnswer.supportingEvidence[0];
const citationDestination = resolveDAVEAskEvidenceNavigation(intelligence, citation);
assert.strictEqual(citationDestination.target, 'update_detail');
assert.strictEqual(citationDestination.sourceRecordId, 'update-alpha');
assert(citationDestination.timelineEventId, 'Citation navigation must retain its timeline event.');

const timelineReference = firstAnswer.timelineReferences[0];
const timelineDestination = resolveDAVEAskTimelineNavigation(intelligence, timelineReference.id);
assert(timelineDestination && timelineDestination.target === 'update_detail');

const component = fs.readFileSync(path.join(root, 'components/DAVEAskExperience.tsx'), 'utf8');
const conversation = fs.readFileSync(path.join(root, 'services/DAVEAskConversation.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
for (const marker of [
  'Ask Vitruvius',
  'Current project questions',
  'Ask me about this project.',
  'Examples are listed above.',
  'Ask a follow-up...',
  'Next step',
  'View source details',
  'Answer confidence',
  'Project records',
  'Related activity',
  'Important notes',
]) {
  assert(component.includes(marker), `Ask DAVE experience must include ${marker}`);
}
for (const question of [
  'How is this project doing?',
  'What needs attention?',
  'What changed?',
  'What is overdue?',
  'What should I do next?',
]) {
  assert(conversation.includes(question), `Suggested question must remain directly answerable: ${question}`);
}
for (const developerFacingLabel of ['Supporting Evidence', 'Timeline References', 'Evidence Used', 'Evidence Missing', 'Supporting Records']) {
  assert(!component.includes(`>${developerFacingLabel}<`), `${developerFacingLabel} must not lead the PM-facing answer.`);
}
assert(component.includes('resolveDAVEConversationContext'));
assert(component.includes('answerDAVEConversationContext'));
assert(component.includes("context.status === 'ambiguous_follow_up'"));
assert(component.includes('One detail needed'));
assert(component.includes('history.map(entry =>'));
assert(component.includes('createDAVEAskHistoryPersistence'));
assert(component.includes('historyPersistence.read(intelligence.projectId)'));
assert(component.includes('historyPersistence.append(intelligence.projectId, entry)'));
assert(!component.includes('AsyncStorage.setItem(storageKey'),
  'Inline Ask history writes must use the ordered retrying persistence helper.');
assert(!component.includes('<Modal') && !component.includes('position: \'absolute\''),
  'Ask DAVE must remain inline and must not use a modal or floating overlay.');
for (const forbidden of ['buildProjectIntelligence(', 'projectRealitySourceRecords', '.updates', '.documents', '.scheduleItems']) {
  assert(!component.includes(forbidden), `Ask DAVE UI must not access or rebuild raw intelligence via ${forbidden}.`);
}

const workspaceStart = app.indexOf('function ProjectWorkspaceScreen');
const workspace = app.slice(workspaceStart);
assert(workspace.indexOf('<DAVEAskExperience') < 0,
  'The suggested-question Project Assistant must remain hidden until its answers are dependable.');
assert(workspace.indexOf('>Project Snapshot<') < 0,
  'The retired Project Brief/Snapshot must not return with the hidden Assistant.');
assert(workspace.indexOf('<ProjectTaskControlPanel') >= 0,
  'Hiding the Assistant must leave the task-first project workflow available.');
assert(app.includes('const projectIntelligence = liveAuthority.projectTruth.intelligence'));
assert(app.includes('createDAVEAskHistoryPersistence'));
assert(app.includes('history = await talkHistoryPersistence.read(projectId)'));
assert(app.includes('await talkHistoryPersistence.append(projectId, entry)'));
assert(app.includes("'Talk history unavailable'"));
assert(app.includes('reportTalkAnswerPersistenceFailure(projectName, error)'));
assert(!app.includes('AsyncStorage.getItem(daveAskHistoryStorageKey(projectId)).catch(() => null)'),
  'Talk must never convert a failed history read into authoritative empty history.');
assert.strictEqual((workspace.match(/buildProjectIntelligence\s*\(/g) || []).length, 0,
  'Project Workspace must consume shared Project Truth without rebuilding intelligence.');

console.log('DAVE Ask Experience behavioral tests passed.');
