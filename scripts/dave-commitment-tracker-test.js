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
    encodeURIComponent,
  }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const { buildProjectCommitments } = loadTs('services/DAVEProjectCommitments.ts');
const { buildProjectDailyBrief } = loadTs('services/DAVEDailyBrief.ts');
const now = '2026-07-11T12:00:00.000Z';

function photo(overrides = {}) {
  return {
    id: 'photo-1',
    category: 'Open Issue',
    actionRequired: 'Confirm electrical inspection status',
    actionOwner: 'Alex',
    actionDueDate: '2026-07-10',
    actionStatus: 'Open',
    ...overrides,
  };
}

function update(photos, overrides = {}) {
  return {
    id: 'update-1',
    projectName: 'Alpha',
    date: '2026-07-10T10:00:00.000Z',
    photos,
    ...overrides,
  };
}

function commitments(updates, overrides = {}) {
  return buildProjectCommitments({
    projectId: 'project-alpha',
    projectName: 'Alpha',
    updates,
    documents: [],
    now,
    ...overrides,
  });
}

const overdue = commitments([update([photo()])]);
assert.strictEqual(overdue.length, 1);
assert.strictEqual(overdue[0].status, 'Overdue');
assert.strictEqual(overdue[0].owner, 'Alex');
assert.strictEqual(overdue[0].dueDate, '2026-07-10');
assert.match(overdue[0].recommendedFollowUpAction, /Confirm status with Alex/);
assert.strictEqual(
  overdue[0].linkedEvidence.map(item => item.type).join(','),
  'update,photo',
  'Commitment must retain its supporting update and photo links.',
);

const completed = commitments([update([photo({ actionStatus: 'Closed' })])]);
assert.strictEqual(completed[0].status, 'Completed', 'A recorded Closed status supports completion.');

const missingEvidence = commitments([update([photo({ actionDueDate: '', actionStatus: undefined })])]);
assert.strictEqual(missingEvidence[0].status, 'Open', 'Missing due/status evidence must not infer completion.');
assert.notStrictEqual(missingEvidence[0].status, 'Completed');

const duplicatePhoto = photo();
const duplicates = commitments([update([duplicatePhoto, { ...duplicatePhoto }])]);
assert.strictEqual(duplicates.length, 1, 'Duplicate source identities must produce one commitment.');

const withDocument = commitments([update([photo()])], {
  documents: [{ id: 'document-1', projectId: 'project-alpha', updateId: 'update-1' }],
});
assert(withDocument[0].linkedEvidence.some(item => item.type === 'document' && item.recordId === 'document-1'));

const priorityCommitments = commitments([update([
  photo({ id: 'later', actionDueDate: '2026-07-10', actionOwner: 'Later owner' }),
  photo({ id: 'earlier', actionDueDate: '2026-07-01', actionOwner: 'Priority owner' }),
])]);
assert.strictEqual(priorityCommitments[0].sourcePhotoId, 'earlier', 'Earliest overdue commitment must rank first.');

const dailyBrief = buildProjectDailyBrief({
  projectId: 'project-alpha',
  projectName: 'Alpha',
  updates: [update([
    photo({ id: 'later', actionDueDate: '2026-07-10', actionOwner: 'Later owner' }),
    photo({ id: 'earlier', actionDueDate: '2026-07-01', actionOwner: 'Priority owner' }),
  ])],
  documents: [],
  scheduleItems: [],
  now,
});
assert(dailyBrief.attentionItems.some(item => item.text.includes('Overdue commitment')),
  'Overdue commitments must appear in Daily Brief attention.');
assert.strictEqual(dailyBrief.recommendedAction.sourceRecordId, 'update-1');
assert.match(dailyBrief.recommendedAction.text, /Priority owner/,
  'Highest-priority overdue commitment must drive the recommendation.');
assert.strictEqual(dailyBrief.evidenceSummary.overdueCommitmentCount, 2);

const noActions = commitments([update([photo({ actionRequired: '', actionOwner: '', actionDueDate: '' })])]);
assert.strictEqual(noActions.length, 0, 'Default empty action fields must not create a commitment.');

assert.strictEqual(dailyBrief.recommendedAction.navigationTarget, 'update_detail');
assert(dailyBrief.recommendedAction.limitations.some(item => /review only/i.test(item)),
  'Commitment recommendation must remain a review action without autonomous communication.');

console.log('DAVE Commitment Tracker behavioral tests passed.');
