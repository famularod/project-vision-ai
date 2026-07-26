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
    Array,
    RegExp,
    encodeURIComponent,
  }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const cache = new Map();
const { buildProjectIntelligence } = loadTs('services/DAVEIntelligence.ts', cache);
const { mentionedDAVEProject, routeDAVEConversation } = loadTs('services/DAVEConversationRouter.ts', cache);

const intelligence = buildProjectIntelligence({
  projectId: 'project-2321-compliance-project',
  projectName: '2321 Compliance Project',
  now: '2026-07-14T12:00:00.000Z',
  updates: [{
    id: 'update-1',
    projectName: '2321 Compliance Project',
    date: '2026-07-14T10:00:00.000Z',
    photos: [],
  }],
  documents: [],
  scheduleItems: [],
});

assert.strictEqual(routeDAVEConversation({ transcript: 'What changed today?', intelligence }).intent, 'ask');
for (const question of [
  'How is this project doing?',
  'How is project 2375 going?',
  'What needs attention?',
  'What is the latest field update?',
  'What commitments are still open?',
  'How reliable is the project evidence?',
  'What is overdue?',
  "What's coming up?",
]) {
  const routed = routeDAVEConversation({ transcript: question, intelligence });
  assert.strictEqual(routed.intent, 'ask', `${question} must route as a project question.`);
  assert.notStrictEqual(routed.answer.answer, "I don't have enough project evidence to answer that.",
    `${question} must receive a supported evidence-aware answer.`);
}
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(routeDAVEConversation({ transcript: 'Open reports', intelligence }))),
  { intent: 'navigate', transcript: 'Open reports', target: 'reports' },
);

const commitment = routeDAVEConversation({ transcript: 'ABC Electric promised to finish Friday.', intelligence });
assert.strictEqual(commitment.intent, 'remember');
assert.strictEqual(commitment.suggestedFields.commitment, 'ABC Electric promised to finish Friday.');

const followUp = routeDAVEConversation({ transcript: 'Remind me to call the inspector.', intelligence });
assert.strictEqual(followUp.intent, 'follow_up');
assert.strictEqual(followUp.suggestedFields.followUp, 'Remind me to call the inspector.');

const fieldInformation = routeDAVEConversation({ transcript: 'East wall installation is complete.', intelligence });
assert.strictEqual(fieldInformation.intent, 'field_information');
assert.strictEqual(fieldInformation.suggestedFields.generalMemory, 'East wall installation is complete.');

const taskUpdate = routeDAVEConversation({ transcript: 'Mark electrical rough-in complete.', intelligence });
assert.strictEqual(taskUpdate.intent, 'task_update');
assert.strictEqual(taskUpdate.command.taskReference, 'electrical rough-in');
assert.strictEqual(taskUpdate.command.changes.status, 'Complete');
assert.strictEqual(taskUpdate.command.changes.percentComplete, 100);

assert.strictEqual(
  mentionedDAVEProject('What changed at 2375?', ['2321 Compliance Project', '2375 Compliance Project']),
  '2375 Compliance Project',
);
assert.strictEqual(
  mentionedDAVEProject('Summarize 2321 Compliance Project.', ['2321 Compliance Project', '2375 Compliance Project']),
  '2321 Compliance Project',
);

const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const tabs = fs.readFileSync(path.join(root, 'components/app-bottom-tabs.tsx'), 'utf8');
const voiceSheet = fs.readFileSync(path.join(root, 'components/DAVEVoiceCaptureSheet.tsx'), 'utf8');
const typedSheet = fs.readFileSync(path.join(root, 'components/DAVETypedCaptureSheet.tsx'), 'utf8');

assert(app.includes('routeDAVEConversation({'), 'The live app must use the unified conversation router.');
assert(app.includes('onTalk={openTalk}'), 'The live app must wire the global Talk action.');
assert(app.includes('showWalkContext={false}'), 'Global Talk must not masquerade as a Project Walk.');
assert(app.includes('<DAVEConversationAnswerSheet'), 'Questions must show an answer in the live app.');
assert(app.includes('<DAVECaptureConfirmationSheet'), 'Remembered information must keep confirmation before save.');
assert(app.includes('<DAVETaskActionConfirmationSheet'), 'Task changes must keep confirmation before save.');
assert(tabs.includes('accessibilityLabel="Talk to project assistant"'));
assert(tabs.includes('<Text style={styles.talkText}>Talk</Text>'));
assert(voiceSheet.includes("title = 'Capture Memory'") && voiceSheet.includes('showWalkContext = true'),
  'Voice capture defaults must preserve the existing Project Walk experience.');
assert(typedSheet.includes("title = 'Capture Memory'"),
  'Typed capture defaults must preserve the existing memory experience.');

console.log('DAVE conversation router and global Talk wiring tests passed.');
