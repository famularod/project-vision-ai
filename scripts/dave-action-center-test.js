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
    Set,
  }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const { buildProjectActionCenter } = loadTs('services/DAVEProjectActionCenter.ts');

function attention(overrides = {}) {
  return {
    id: 'attention-1',
    evidenceClass: 'fact',
    category: 'open_issue',
    text: 'Open issue needs follow-up.',
    sourceType: 'issue',
    sourceRecordId: 'update-1',
    timestamp: '2026-07-11T10:00:00.000Z',
    confidence: 'recorded',
    navigationTarget: 'update_detail',
    limitations: [],
    priority: 6,
    whyItMatters: 'The issue remains unresolved.',
    evidence: 'Update update-1 contains the recorded issue.',
    actionText: 'Review the open issue.',
    ...overrides,
  };
}

function daily(attentionItems = [], latestUpdateAt = '2026-07-11T10:00:00.000Z') {
  return {
    projectId: 'project-alpha',
    generatedAt: '2026-07-11T12:00:00.000Z',
    changedItems: [],
    uncertaintyItems: [],
    attentionItems,
    recommendedAction: null,
    evidenceSummary: {
      latestUpdateAt,
      photoFindingCount: 0,
      openIssueCount: 0,
      failedAnalysisCount: 0,
      staleEvidenceCount: 0,
      overdueCommitmentCount: 0,
    },
    emptyStates: {},
  };
}

function quality(strength = 'High') {
  return {
    projectId: 'project-alpha',
    generatedAt: '2026-07-11T12:00:00.000Z',
    strength,
    score: strength === 'High' ? 12 : strength === 'Medium' ? 7 : 2,
    maximumScore: 12,
    signals: [],
    limitation: 'Evidence strength does not verify progress.',
  };
}

function commitment(overrides = {}) {
  return {
    id: 'commitment-1',
    projectId: 'project-alpha',
    owner: 'Alex',
    description: 'Confirm inspection status',
    dueDate: '2026-07-10',
    status: 'Overdue',
    linkedEvidence: [
      { type: 'update', recordId: 'update-overdue' },
      { type: 'photo', recordId: 'photo-overdue' },
    ],
    recommendedFollowUpAction: 'Confirm status with Alex.',
    sourceUpdateId: 'update-overdue',
    sourcePhotoId: 'photo-overdue',
    priority: 2,
    ...overrides,
  };
}

function build({ attentions = [], commitments = [], strength = 'High', latestUpdateAt } = {}) {
  return buildProjectActionCenter({
    dailyBrief: daily(attentions, latestUpdateAt),
    evidenceQuality: quality(strength),
    commitments,
    attentionItems: attentions,
  });
}

const safety = attention({
  id: 'safety',
  category: 'safety_concern',
  text: 'Safety observation requires review.',
  whyItMatters: 'A photo is recorded as a safety concern.',
  evidence: 'Safety Concern photo in update-safety.',
  sourceRecordId: 'update-safety',
});
const safetyFirst = build({
  attentions: [attention({ id: 'analysis', category: 'analysis', text: 'Photo analysis is unavailable.' }), safety],
  commitments: [commitment()],
});
assert.match(safetyFirst.priority, /Safety/i, 'Safety must rank above every other candidate.');
assert.strictEqual(safetyFirst.supportingEvidence[0].recordId, 'update-safety');

const stale = attention({
  id: 'stale',
  category: 'stale_evidence',
  text: 'Current evidence is needed for an unresolved issue.',
});
const overdueFirst = build({ attentions: [stale], commitments: [commitment()] });
assert.match(overdueFirst.priority, /Overdue commitment/i, 'Overdue commitments must outrank stale evidence.');
assert.match(overdueFirst.recommendedAction, /Alex/);

const weak = build({ attentions: [safety], strength: 'Low' });
assert.strictEqual(weak.confidence, 'low');
assert(weak.limitations.some(item => /evidence is weak/i.test(item)), 'Weak evidence must be disclosed.');

const duplicate = attention();
const collapsed = build({ attentions: [duplicate, { ...duplicate }] });
assert.strictEqual(collapsed.supportingEvidence.length, 1, 'Duplicate priority evidence must collapse.');

for (const result of [safetyFirst, overdueFirst, weak, collapsed]) {
  assert(result.recommendedAction, 'A selected priority must include a recommendation.');
  assert(result.supportingEvidence.length > 0, 'Every recommendation must cite supporting evidence.');
}

const empty = build({ latestUpdateAt: null });
assert.strictEqual(empty.priority, 'No priority today.');
assert.strictEqual(empty.recommendedAction, null);
assert.strictEqual(empty.supportingEvidence.length, 0);

const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const priorityIndex = app.indexOf(">Today's Priority<");
const briefIndex = app.indexOf('>DAVE Daily Brief<');
assert(priorityIndex >= 0 && priorityIndex < briefIndex, "Today's Priority must render above DAVE Daily Brief.");
assert(app.includes('Dismiss for Today') && app.includes('actionCenterDismissKey'));
assert(app.includes('onOpenDailyBriefItem({') && app.includes('sourceRecordId: actionCenterSource.recordId'));

console.log('DAVE Action Center behavioral tests passed.');
