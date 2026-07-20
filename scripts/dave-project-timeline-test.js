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

const { buildProjectTimeline } = loadTs('services/DAVEProjectTimeline.ts');
const { buildProjectCommitments } = loadTs('services/DAVEProjectCommitments.ts');
const { buildProjectReality } = loadTs('services/DAVEProjectReality.ts');
const now = '2026-07-12T12:00:00.000Z';
const sameTimestamp = '2026-07-10T10:00:00.000Z';

function photo(id, overrides = {}) {
  return {
    id,
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    locationCapturedAt: sameTimestamp,
    photoIntelligence: null,
    ...overrides,
  };
}

function update(id, timestamp, photos = [], overrides = {}) {
  return {
    id,
    projectName: 'Alpha',
    date: timestamp,
    photos,
    ...overrides,
  };
}

function reality(overrides = {}) {
  return {
    state: 'At Risk',
    confidence: 'medium',
    lastVerifiedAt: sameTimestamp,
    topRecommendation: null,
    ...overrides,
  };
}

function timeline(overrides = {}) {
  return buildProjectTimeline({
    projectId: 'project-alpha',
    projectName: 'Alpha',
    updates: [],
    documents: [],
    scheduleItems: [],
    commitments: [],
    reality: reality(),
    now,
    ...overrides,
  });
}

const older = update('older', '2026-07-08T10:00:00.000Z');
const newer = update('newer', '2026-07-11T10:00:00.000Z');
const chronological = timeline({ updates: [older, newer] });
assert.strictEqual(chronological[0].timestamp, '2026-07-11T10:00:00.000Z');
assert(chronological.every((item, index) => index === 0 ||
  new Date(chronological[index - 1].timestamp).getTime() >= new Date(item.timestamp).getTime()),
  'Timeline must be newest first.');

const comparison = {
  status: 'analysis_complete',
  updatedAt: sameTimestamp,
  comparisonConfidence: 'high',
  priorEvidenceId: 'baseline-evidence',
  findings: [{ findingType: 'added', description: 'A tan case appears near the laptop.', confidence: 0.9 }],
};
const orderedUpdate = update('ordered-update', sameTimestamp, [
  photo('safety', { category: 'Safety Concern', actionStatus: 'Open' }),
  photo('commitment', {
    actionRequired: 'Confirm inspection status',
    actionOwner: 'Alex',
    actionDueDate: '2026-07-15',
  }),
  photo('comparison', { photoIntelligence: comparison }),
]);
const orderedCommitments = buildProjectCommitments({
  projectId: 'project-alpha', projectName: 'Alpha', updates: [orderedUpdate], now,
});
const deterministic = timeline({
  updates: [orderedUpdate],
  commitments: orderedCommitments,
  documents: [{
    id: 'document', projectId: 'project-alpha', name: 'Drawing', category: 'Drawing',
    status: 'uploaded', createdAt: sameTimestamp, importedAt: sameTimestamp,
  }],
});
const sameTimeTypes = deterministic.filter(item => item.timestamp === sameTimestamp).map(item => item.eventType);
const positions = [
  sameTimeTypes.indexOf('safety_issue_opened'),
  sameTimeTypes.indexOf('commitment_created'),
  sameTimeTypes.indexOf('qualified_photo_observation'),
  sameTimeTypes.indexOf('document_added'),
  sameTimeTypes.indexOf('update_recorded'),
];
assert(positions.every(position => position >= 0));
assert(positions.every((position, index) => index === 0 || positions[index - 1] < position),
  'Identical timestamps must order safety, commitments, photos, documents, then updates.');

const duplicated = timeline({ updates: [orderedUpdate, { ...orderedUpdate }] });
assert.strictEqual(new Set(duplicated.map(item => item.id)).size, duplicated.length,
  'Duplicate source records must not duplicate timeline events.');

const baselineEvents = timeline({ updates: [update('baseline-update', sameTimestamp, [photo('baseline', {
  photoIntelligence: { status: 'no_suitable_prior_photo', updatedAt: sameTimestamp },
})])] });
assert(baselineEvents.some(item => item.eventType === 'baseline_established'));
assert(!baselineEvents.some(item => item.eventType === 'qualified_photo_observation'));
const baselineEvent = baselineEvents.find(item => item.eventType === 'baseline_established');
assert.match(baselineEvent.limitations.join(' '), /informational|does not establish project progress/i);

const comparisonEvents = timeline({ updates: [update('comparison-update', sameTimestamp, [photo('comparison', {
  photoIntelligence: comparison,
})])] });
const observation = comparisonEvents.find(item => item.eventType === 'qualified_photo_observation');
assert(observation && /tan case/i.test(observation.summary));
assert(observation.evidence.length === 2, 'Qualified observation must cite current and prior evidence.');
assert.strictEqual(observation.navigationTarget, 'update_detail');

const commitmentUpdate = update('commitment-update', '2026-07-05T10:00:00.000Z', [
  photo('overdue', {
    actionRequired: 'Follow up on permit', actionOwner: 'Jordan', actionDueDate: '2026-07-06', actionStatus: 'Open',
  }),
  photo('completed', {
    actionRequired: 'Confirm delivery', actionOwner: 'Sam', actionDueDate: '2026-07-09', actionStatus: 'Closed',
  }),
]);
const commitmentRecords = buildProjectCommitments({
  projectId: 'project-alpha', projectName: 'Alpha', updates: [commitmentUpdate], now,
});
const commitmentEvents = timeline({ updates: [commitmentUpdate], commitments: commitmentRecords });
assert(commitmentEvents.some(item => item.eventType === 'commitment_overdue'));
assert(commitmentEvents.some(item => item.eventType === 'commitment_completed'));
assert(commitmentEvents.filter(item => item.eventType.startsWith('commitment_')).every(item => item.evidence.length > 0));

const safetyEvents = timeline({ updates: [update('safety-update', sameTimestamp, [
  photo('open-safety', { category: 'Safety Concern', actionStatus: 'Open' }),
  photo('closed-safety', { category: 'Safety Concern', actionStatus: 'Closed' }),
])] });
assert(safetyEvents.some(item => item.eventType === 'safety_issue_opened'));
assert(safetyEvents.some(item => item.eventType === 'safety_issue_resolved'));

const actionEvents = timeline({ updates: [update('action-update', sameTimestamp, [
  photo('open-action', { actionRequired: 'Review field note', actionStatus: 'Open' }),
  photo('closed-action', { actionRequired: 'Archive field note', actionStatus: 'Closed' }),
])] });
assert(actionEvents.some(item => item.eventType === 'action_created'));
assert(actionEvents.some(item => item.eventType === 'action_completed'));
assert(!actionEvents.some(item => item.eventType === 'commitment_created'),
  'Unowned actions without due dates must not duplicate as commitments in the timeline.');

const structuredEvents = timeline({
  projectCreatedAt: '2026-07-01T09:00:00.000Z',
  scheduleItems: [{
    id: 'milestone', projectName: 'Alpha', taskName: 'Inspection', milestone: 'Rough-in inspection',
    status: 'Complete', finishDate: '2026-07-09', createdAt: '2026-07-01T10:00:00.000Z',
  }],
});
assert(structuredEvents.some(item => item.eventType === 'project_created'));
assert(structuredEvents.some(item => item.eventType === 'schedule_milestone_reached'));

const transitionEvents = timeline({ updates: [
  update('waiting-update', '2026-07-08T10:00:00.000Z', [photo('waiting', {
    actionStatus: 'Waiting', actionRequired: 'Await release', locationCapturedAt: '2026-07-08T10:00:00.000Z',
  })]),
  update('blocked-update', '2026-07-09T10:00:00.000Z', [], { blockerFlag: true }),
] });
const transition = transitionEvents.find(item => item.eventType === 'project_state_changed');
assert(transition && transition.evidenceClass === 'interpretation');
assert.match(transition.summary, /Waiting to Blocked/);
assert(transition.evidence.length === 2);

const recommendationEvidence = [{ sourceType: 'update', recordId: 'recommendation-update', summary: 'Recorded blocker.' }];
const recommendationEvents = timeline({
  updates: [update('recommendation-update', sameTimestamp, [], { blockerFlag: true })],
  reality: reality({
    state: 'Blocked',
    topRecommendation: {
      action: 'Confirm blocker status.',
      reason: 'A blocker is recorded.',
      sourceRecordId: 'recommendation-update',
      navigationTarget: 'update_detail',
      supportingEvidence: recommendationEvidence,
      limitations: ['Review only.'],
    },
  }),
});
const recommendation = recommendationEvents.find(item => item.eventType === 'recommendation_generated');
assert(recommendation && recommendation.evidenceClass === 'recommendation');
assert.strictEqual(recommendation.evidence[0].recordId, 'recommendation-update');
assert.strictEqual(recommendation.navigationTarget, 'update_detail');

const projectReality = buildProjectReality({
  projectId: 'project-alpha',
  projectName: 'Alpha',
  updates: [commitmentUpdate],
  documents: [],
  scheduleItems: [],
  now,
});
assert(projectReality.recentTimelineEvents.length > 0, 'Project Reality must expose recent timeline events.');
assert(projectReality.recentTimelineEvents.length <= 10);

for (const item of [...deterministic, ...commitmentEvents, ...recommendationEvents]) {
  assert(item.evidence.length > 0, `${item.eventType} must cite evidence.`);
  assert(['update_detail', 'project_documents', 'schedule', 'capture', 'project_workspace'].includes(item.navigationTarget));
  assert(['fact', 'interpretation', 'recommendation'].includes(item.evidenceClass));
}

const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
assert(app.includes('>Recent project records<') && /dailyBrief\.reality\.recentTimelineEvents\.slice\(0, \d+\)/.test(app),
  'Project Workspace must render a bounded set of recent canonical timeline events.');
assert(!app.includes("title=\"Project Timeline\""), 'Timeline must not add a new navigation screen.');

console.log('DAVE Project Timeline behavioral tests passed.');
