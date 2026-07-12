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
    WeakMap,
    Math,
    encodeURIComponent,
  }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const { buildProjectReality } = loadTs('services/DAVEProjectReality.ts');
const { buildProjectDailyBrief } = loadTs('services/DAVEDailyBrief.ts');
const { buildProjectActionCenter } = loadTs('services/DAVEProjectActionCenter.ts');
const now = '2026-07-11T12:00:00.000Z';

function photo(id, overrides = {}) {
  return {
    id,
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    locationCapturedAt: '2026-07-10T10:00:00.000Z',
    photoIntelligence: { status: 'analysis_complete', updatedAt: '2026-07-10T10:01:00.000Z' },
    ...overrides,
  };
}

function update(id, photos, overrides = {}) {
  return {
    id,
    projectName: 'Alpha',
    date: '2026-07-10T10:00:00.000Z',
    photos,
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildProjectReality({
    projectId: 'project-alpha',
    projectName: 'Alpha',
    updates: [],
    documents: [],
    scheduleItems: [],
    now,
    ...overrides,
  });
}

const safety = build({ updates: [update('safety-update', [photo('safety-photo', {
  category: 'Safety Concern',
  actionStatus: 'Open',
})])] });
assert.strictEqual(safety.state, 'Blocked', 'Open safety evidence must produce Blocked.');
assert.strictEqual(safety.blockers[0].evidenceClass, 'fact');
assert(safety.topRecommendation.supportingEvidence.length > 0);

const waiting = build({
  updates: [update('waiting-update', [photo('waiting-photo', { actionStatus: 'Waiting', actionRequired: 'Await utility release' })])],
});
assert.strictEqual(waiting.state, 'Waiting', 'A recorded external dependency must produce Waiting.');

const overdue = build({ updates: [update('overdue-update', [photo('overdue-photo', {
  category: 'Open Issue',
  actionRequired: 'Confirm inspection status',
  actionOwner: 'Alex',
  actionDueDate: '2026-07-01',
  actionStatus: 'Open',
})])] });
assert.strictEqual(overdue.state, 'At Risk', 'Overdue commitment without a blocker must produce At Risk.');
assert(overdue.openCommitments.some(item => item.status === 'Overdue'));

const healthyUpdates = [
  update('healthy-1', [photo('healthy-photo-1')]),
  update('healthy-2', [photo('healthy-photo-2')]),
];
const healthyDocuments = [
  { id: 'inspection', projectId: 'project-alpha', name: 'Inspection', category: 'Inspection', status: 'uploaded', createdAt: '2026-07-10T09:00:00.000Z', updatedAt: '2026-07-10T09:00:00.000Z' },
  { id: 'drawing', projectId: 'project-alpha', name: 'Drawing', category: 'Drawing', status: 'uploaded', createdAt: '2026-07-10T09:00:00.000Z', updatedAt: '2026-07-10T09:00:00.000Z' },
];
const healthySchedule = [{ id: 'schedule', projectName: 'Alpha', taskName: 'Current task', status: 'In Progress', createdAt: '2026-07-10T09:00:00.000Z' }];
const moving = build({ updates: healthyUpdates, documents: healthyDocuments, scheduleItems: healthySchedule });
assert.strictEqual(moving.state, 'Moving', 'Healthy current evidence without blockers must produce Moving.');
assert.strictEqual(moving.confidence, 'high');

const missing = build();
assert.strictEqual(missing.confidence, 'low', 'Weak evidence must lower confidence.');
const missingText = JSON.stringify(missing).toLowerCase();
assert(!missingText.includes('work is incomplete') && !missingText.includes('work is delayed'),
  'Missing evidence must not create false delay or incomplete-work claims.');

const dailyBrief = buildProjectDailyBrief({
  projectId: 'project-alpha',
  projectName: 'Alpha',
  updates: healthyUpdates,
  documents: healthyDocuments,
  scheduleItems: healthySchedule,
  now,
});
const actionCenter = buildProjectActionCenter({
  dailyBrief,
  evidenceQuality: dailyBrief.reality.evidenceSummary,
  commitments: dailyBrief.reality.openCommitments,
  attentionItems: dailyBrief.attentionItems,
  reality: dailyBrief.reality,
});
assert.strictEqual(dailyBrief.realityState, dailyBrief.reality.state);
assert.strictEqual(actionCenter.realityState, dailyBrief.realityState,
  'Daily Brief and Action Center must use the same reality state.');

for (const reality of [safety, waiting, overdue]) {
  assert(reality.topRecommendation, 'Actionable reality must include a recommendation.');
  assert(reality.topRecommendation.supportingEvidence.length > 0,
    'Every reality recommendation must cite supporting evidence.');
}

console.log('DAVE Project Reality behavioral tests passed.');
