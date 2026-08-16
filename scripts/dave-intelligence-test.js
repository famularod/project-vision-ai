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

const moduleCache = new Map();
const { buildProjectIntelligence } = loadTs('services/DAVEIntelligence.ts', moduleCache);
const { buildProjectDailyBrief } = loadTs('services/DAVEDailyBrief.ts', moduleCache);
const { buildProjectActionCenter } = loadTs('services/DAVEProjectActionCenter.ts', moduleCache);
const { buildProjectCommitments } = loadTs('services/DAVEProjectCommitments.ts', moduleCache);
const { buildProjectEvidenceQuality } = loadTs('services/DAVEProjectEvidenceQuality.ts', moduleCache);

const now = '2026-07-12T12:00:00.000Z';
const update = {
  id: 'update-safety',
  projectName: 'Alpha',
  date: '2026-07-11T10:00:00.000Z',
  safetyFlag: true,
  photos: [{
    id: 'photo-safety',
    category: 'Safety Concern',
    actionRequired: 'Confirm guardrail condition',
    actionOwner: 'Alex',
    actionDueDate: '2026-07-10',
    actionStatus: 'Open',
    locationCapturedAt: '2026-07-11T10:00:00.000Z',
    photoIntelligence: {
      status: 'analysis_complete',
      updatedAt: '2026-07-11T10:01:00.000Z',
      comparisonConfidence: 'high',
      priorEvidenceId: 'baseline-evidence',
      findings: [{ findingType: 'visible_concern', description: 'An open guardrail condition is visible.', confidence: 0.9 }],
    },
  }],
};
const input = {
  projectId: 'project-alpha',
  projectName: 'Alpha',
  updates: [update],
  documents: [{
    id: 'inspection-document',
    projectId: 'project-alpha',
    updateId: 'update-safety',
    name: 'Inspection record',
    category: 'Inspection',
    status: 'uploaded',
    createdAt: '2026-07-11T09:00:00.000Z',
    updatedAt: '2026-07-11T09:00:00.000Z',
  }],
  scheduleItems: [{
    id: 'schedule-1',
    projectName: 'Alpha',
    taskName: 'Safety review',
    status: 'In Progress',
    createdAt: '2026-07-11T08:00:00.000Z',
  }],
  now,
};

const intelligence = buildProjectIntelligence(input);

assert.strictEqual(intelligence.schemaVersion, 'dave-intelligence/1.0');
assert.strictEqual(intelligence.projectId, 'project-alpha');
assert.strictEqual(intelligence.generatedAt, now);
assert(Object.isFrozen(intelligence), 'Canonical intelligence object must be immutable.');
assert(Object.isFrozen(intelligence.projectReality));
assert(Object.isFrozen(intelligence.timeline));
assert(Object.isFrozen(intelligence.dailyBrief));
assert(Object.isFrozen(intelligence.actionCenter));
assert(Object.isFrozen(intelligence.commitments));
assert(Object.isFrozen(intelligence.evidenceQuality));
assert(Object.isFrozen(intelligence.scheduleSummary));
assert.strictEqual(intelligence.scheduleSummary.taskCount, 1);
assert.strictEqual(intelligence.scheduleSummary.completedCount, 0);

assert.strictEqual(intelligence.dailyBrief.reality, intelligence.projectReality,
  'Daily Brief must retain the one canonical Reality object.');
assert.strictEqual(intelligence.timeline, intelligence.projectReality.timelineEvents,
  'Timeline output must be the canonical Reality timeline array.');
assert.strictEqual(intelligence.commitments, intelligence.projectReality.commitments,
  'Commitments output must be the canonical Reality commitment array.');
assert.strictEqual(intelligence.evidenceQuality, intelligence.projectReality.evidenceSummary,
  'Evidence Quality output must be the canonical Reality evidence object.');

const directDaily = buildProjectDailyBrief({
  reality: intelligence.projectReality,
  timeline: intelligence.timeline,
});
const directAction = buildProjectActionCenter({ reality: intelligence.projectReality });
const directCommitments = buildProjectCommitments({ reality: intelligence.projectReality });
const directEvidence = buildProjectEvidenceQuality({ reality: intelligence.projectReality });
assert.strictEqual(JSON.stringify(directDaily), JSON.stringify(intelligence.dailyBrief),
  'Daily Brief projection must be consistent.');
assert.strictEqual(JSON.stringify(directAction), JSON.stringify(intelligence.actionCenter),
  'Action Center projection must be consistent.');
assert.strictEqual(directCommitments, intelligence.commitments);
assert.strictEqual(directEvidence, intelligence.evidenceQuality);

const realityRecommendation = intelligence.projectReality.topRecommendation;
assert(realityRecommendation, 'Safety Reality must produce a recommendation.');
assert.strictEqual(intelligence.dailyBrief.recommendedAction.text, realityRecommendation.action,
  'Daily Brief recommendation must match Reality.');
assert.strictEqual(intelligence.actionCenter.recommendedAction, realityRecommendation.action,
  'Action Center recommendation must match Reality.');
assert.strictEqual(intelligence.actionCenter.realityState, intelligence.projectReality.state);
assert(intelligence.actionCenter.supportingEvidence.length > 0);
assert(intelligence.actionCenter.supportingEvidence.every(item => item.timelineEventId),
  'Action Center citations must resolve to canonical timeline events when recent evidence exists.');

assert.strictEqual(intelligence.dailyBrief.reality.timelineEvents, intelligence.timeline);
assert.strictEqual(
  new Set(intelligence.timeline.map(item => item.id)).size,
  intelligence.timeline.length,
  'Canonical timeline must remain deduplicated.',
);

const intelligenceSource = fs.readFileSync(path.join(root, 'services/DAVEIntelligence.ts'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
assert.strictEqual((intelligenceSource.match(/buildProjectReality\s*\(/g) || []).length, 1,
  'Intelligence must build Project Reality exactly once.');
assert(!intelligenceSource.includes('buildProjectTimeline('),
  'Intelligence must consume the timeline already owned by Project Reality.');
assert(appSource.includes('const projectIntelligence = liveAuthority.projectTruth.intelligence'),
  'Project Workspace must consume the canonical intelligence object from Project Truth.');
assert(
  appSource.includes('updates: (') &&
  appSource.includes('projectDocuments: projectDocuments') &&
  appSource.includes('captureMemories,'),
  'The live authority must receive canonical project records, documents, and confirmed memories.',
);
for (const duplicateBuilder of [
  'buildProjectReality({',
  'buildProjectTimeline({',
  'buildProjectDailyBrief({',
  'buildProjectEvidenceQuality({',
  'buildProjectCommitments({',
  'buildProjectActionCenter({',
]) {
  assert(!appSource.includes(duplicateBuilder), `UI must not independently call ${duplicateBuilder}`);
}

console.log('DAVE Intelligence Layer behavioral tests passed.');
