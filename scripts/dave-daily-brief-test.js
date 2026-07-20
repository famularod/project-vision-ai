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
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const localRequire = request => {
    if (!request.startsWith('.')) return require(request);
    const target = path.relative(root, path.resolve(path.dirname(filename), `${request}.ts`));
    return loadTs(target, cache);
  };
  const sandbox = {
    module,
    exports: module.exports,
    require: localRequire,
    console,
    Date,
    Set,
    Map,
    WeakMap,
    encodeURIComponent,
  };
  vm.runInNewContext(compiled.outputText, sandbox, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const { buildProjectDailyBrief } = loadTs('services/DAVEDailyBrief.ts');

const now = '2026-07-11T12:00:00.000Z';
const projectId = 'project-alpha';
const projectName = 'Alpha';

function photo(overrides = {}) {
  return {
    id: 'photo-current',
    category: 'Update',
    actionRequired: '',
    actionStatus: 'Closed',
    photoIntelligence: null,
    ...overrides,
  };
}

function update(overrides = {}) {
  return {
    id: 'update-current',
    projectName,
    date: '2026-07-11T10:00:00.000Z',
    notes: '',
    photos: [],
    ...overrides,
  };
}

function brief(overrides = {}) {
  return buildProjectDailyBrief({
    projectId,
    projectName,
    updates: [],
    documents: [],
    scheduleItems: [],
    now,
    ...overrides,
  });
}

const tanCaseResult = {
  status: 'analysis_complete',
  visibleChange: 'A tan case appears in the foreground near the laptop.',
  comparisonConfidence: 'high',
  comparability: 'strong',
  captureLimitations: [],
  priorEvidenceId: 'baseline-evidence',
  updatedAt: '2026-07-11T10:01:00.000Z',
  findings: [{
    findingType: 'added',
    description: 'A tan case appears in the foreground near the laptop.',
    confidence: 0.9,
    limitations: [],
  }],
  diagnostics: { providerName: 'must-not-leak' },
  requestId: 'must-not-leak',
};

const changed = brief({ updates: [update({ photos: [photo({ photoIntelligence: tanCaseResult })] })] });
assert.strictEqual(changed.changedItems.length, 1, 'A completed paired comparison must appear under Changed.');
assert.match(changed.changedItems[0].text, /tan case/i, 'The observed tan-case finding must survive aggregation.');
assert.strictEqual(changed.changedItems[0].evidenceClass, 'observation');
assert.strictEqual(changed.changedItems[0].navigationTarget, 'update_detail');

const baseline = brief({ updates: [update({ photos: [photo({ photoIntelligence: {
  status: 'no_suitable_prior_photo',
  visibleChange: 'First visual baseline saved for future comparison.',
  updatedAt: now,
} })] })] });
assert.strictEqual(baseline.changedItems.length, 0, 'Baseline-only photos must not be presented as changes.');
assert(baseline.uncertaintyItems.some(item => item.category === 'missing_verification'));

const failed = brief({ updates: [update({ photos: [photo({ photoIntelligence: {
  status: 'comparison_unavailable',
  visibleChange: 'Work progressed significantly.',
  updatedAt: now,
  rawResponse: 'must-not-leak',
} })] })] });
assert.strictEqual(failed.changedItems.length, 0, 'Failed analysis must not create a changed claim.');
assert(failed.uncertaintyItems.some(item => item.text === 'Analysis unavailable · Retry'));

const notComparable = brief({ updates: [update({ photos: [photo({ photoIntelligence: {
  ...tanCaseResult,
  comparability: 'not_comparable',
} })] })] });
assert.strictEqual(notComparable.changedItems.length, 0, 'Not-comparable photos must not be presented as changes.');
assert(notComparable.uncertaintyItems.some(item => /not sufficiently comparable/i.test(item.text)));

const missing = brief();
assert(!JSON.stringify(missing).toLowerCase().includes('work is incomplete'), 'Missing evidence must not claim incomplete work.');
assert.strictEqual(missing.emptyStates.changed, 'No verified project changes since the last update.');
assert.strictEqual(missing.emptyStates.uncertainty, 'No major evidence gaps detected.');
assert.strictEqual(missing.emptyStates.attention, 'No immediate attention items.');
assert.strictEqual(missing.emptyStates.recommendation, 'No action recommended until more evidence is available.');

const attentionUpdate = update({
  id: 'attention-update',
  blockerFlag: true,
  photos: [
    photo({ id: 'issue-photo', category: 'Open Issue', actionStatus: 'Open', actionRequired: 'Old action wording' }),
    photo({ id: 'safety-photo', category: 'Safety Concern', actionStatus: 'Open', actionRequired: 'Inspect guardrail' }),
    photo({ id: 'safety-photo', category: 'Safety Concern', actionStatus: 'Open', actionRequired: 'Changed visible wording' }),
  ],
});
const attention = brief({ updates: [attentionUpdate] });
assert.strictEqual(attention.attentionItems[0].category, 'safety_concern', 'Safety must rank first.');
assert.strictEqual(attention.attentionItems.filter(item => item.id.includes('safety-photo')).length, 1, 'Stable identity must deduplicate repeated attention items.');
assert(attention.recommendedAction, 'One supported action must be selected.');
assert(attention.recommendedAction.reason && attention.recommendedAction.navigationTarget, 'Recommendation must include reason and navigation target.');

const reworded = brief({ updates: [update({
  ...attentionUpdate,
  photos: attentionUpdate.photos.map(item => item.id === 'issue-photo'
    ? { ...item, actionRequired: 'Entirely new action copy', caption: 'New caption copy' }
    : item),
})] });
const originalIssueId = attention.attentionItems.find(item => item.category === 'open_issue').id;
const rewordedIssueId = reworded.attentionItems.find(item => item.category === 'open_issue').id;
assert.strictEqual(originalIssueId, rewordedIssueId, 'User-facing caption/action text must not affect identity.');

const unsupported = brief({ updates: [update({ photos: [photo({ photoIntelligence: {
  ...tanCaseResult,
  findings: [{ findingType: 'uncertain', description: 'Work progressed significantly.', confidence: 0.8 }],
  visibleChange: 'Work completed.',
} })] })] });
assert.strictEqual(unsupported.changedItems.length, 0, 'Unsupported progress claims must be excluded.');

const serialized = JSON.stringify(changed);
for (const forbidden of ['providerName', 'diagnostics', 'signedUrl', 'storagePath', 'rawResponse', 'requestId', 'hash']) {
  assert(!serialized.includes(forbidden), `${forbidden} must not enter the Daily Brief display model.`);
}

const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
assert(
  app.includes('Project Snapshot') &&
    app.includes('const dailyBrief = projectIntelligence.dailyBrief') &&
    app.includes('liveAuthority.projectTruth.intelligence'),
  'Project Workspace must render the PM-facing Project Snapshot from canonical Project Truth intelligence.',
);
assert(!app.includes("title=\"DAVE Daily Brief\""), 'Daily Brief must not add a top-level navigation screen.');

console.log('DAVE Daily Brief behavioral tests passed.');
