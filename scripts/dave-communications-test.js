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
const {
  buildCommunicationDraft,
  buildDAVECommunicationCenter,
} = loadTs('services/DAVECommunicationCenter.ts', moduleCache);

const now = '2026-07-12T12:00:00.000Z';
const intelligence = buildProjectIntelligence({
  projectId: 'project-alpha',
  projectName: 'Alpha',
  now,
  updates: [{
    id: 'update-current',
    projectName: 'Alpha',
    date: '2026-07-11T10:00:00.000Z',
    safetyFlag: true,
    photos: [
      {
        id: 'photo-observation',
        category: 'Update',
        actionRequired: '',
        actionOwner: '',
        actionDueDate: '',
        actionStatus: 'Open',
        locationCapturedAt: '2026-07-11T10:00:00.000Z',
        photoIntelligence: {
          status: 'analysis_complete',
          updatedAt: '2026-07-11T10:01:00.000Z',
          comparisonConfidence: 'high',
          priorEvidenceId: 'baseline-evidence',
          findings: [{
            findingType: 'added',
            description: 'A tan case appears in the foreground near the laptop.',
            confidence: 0.9,
          }],
        },
      },
      {
        id: 'photo-commitment',
        category: 'Open Issue',
        actionRequired: 'Confirm inspection status',
        actionOwner: 'Alex',
        actionDueDate: '2026-07-10',
        actionStatus: 'Open',
        locationCapturedAt: '2026-07-11T10:00:00.000Z',
        photoIntelligence: null,
      },
    ],
  }],
  documents: [{
    id: 'inspection-document',
    projectId: 'project-alpha',
    updateId: 'update-current',
    name: 'Inspection record',
    category: 'Inspection',
    status: 'uploaded',
    createdAt: '2026-07-11T09:00:00.000Z',
    updatedAt: '2026-07-11T09:00:00.000Z',
  }],
  scheduleItems: [{
    id: 'schedule-current',
    projectName: 'Alpha',
    taskName: 'Inspection review',
    status: 'In Progress',
    createdAt: '2026-07-11T08:00:00.000Z',
  }],
});

const center = buildDAVECommunicationCenter(intelligence);
assert(Object.isFrozen(center) && Object.isFrozen(center.drafts));
assert.strictEqual(center.drafts.length, 6);
assert.strictEqual(
  center.drafts.map(item => item.title).join('|'),
  'Owner Update|Customer Update|Contractor Follow-up|Internal Team Update|Weekly Summary|Inspection Readiness',
);

for (const draft of center.drafts) {
  assert.strictEqual(draft.reviewRequired, true);
  assert(['high', 'medium', 'low'].includes(draft.confidence));
  assert(draft.knownLimitations.length > 0);
  const statements = [
    ...draft.facts,
    ...draft.observations,
    ...draft.interpretations,
    ...draft.recommendations,
  ];
  const evidenceIds = new Set(draft.evidenceUsed.map(item => item.id));
  for (const statement of statements) {
    assert(statement.evidenceIds.length > 0, `${draft.title} statement must cite evidence.`);
    assert(statement.evidenceIds.every(id => evidenceIds.has(id)), `${draft.title} citation must resolve.`);
  }
  assert(draft.facts.every(item => item.statementClass === 'fact'));
  assert(draft.observations.every(item => item.statementClass === 'observation'));
  assert(draft.interpretations.every(item => item.statementClass === 'interpretation'));
  assert(draft.recommendations.every(item => item.statementClass === 'recommendation'));
  assert(!Object.prototype.hasOwnProperty.call(draft, 'send'));
  assert(!Object.prototype.hasOwnProperty.call(draft, 'recipients'));
}

const ownerDraft = center.drafts.find(item => item.draftType === 'owner_update');
assert(ownerDraft.observations.some(item => /tan case/i.test(item.text)),
  'Qualified photo observations must remain in the Observation section.');
assert(ownerDraft.recommendations.length === 1);
assert(ownerDraft.recommendations[0].evidenceIds.length > 0);
assert(!ownerDraft.facts.some(item => /tan case/i.test(item.text)),
  'Visual observations must not be presented as record facts.');

const serialized = JSON.stringify(center).toLowerCase();
for (const unsupported of ['work progressed significantly', 'work is complete', 'percent complete']) {
  assert(!serialized.includes(unsupported), `Drafts must exclude unsupported claim: ${unsupported}`);
}
for (const forbidden of ['signedurl', 'storagepath', 'rawresponse', 'diagnostics', 'apikey']) {
  assert(!serialized.includes(forbidden), `${forbidden} must not enter communication drafts.`);
}

const inspectionDraft = buildCommunicationDraft(intelligence, 'inspection_readiness');
assert.strictEqual(inspectionDraft.title, 'Inspection Readiness');
assert(inspectionDraft.evidenceUsed.some(item => item.recordId === 'inspection-document'));

const weakIntelligence = buildProjectIntelligence({
  projectId: 'project-empty',
  projectName: 'Empty',
  updates: [],
  documents: [],
  scheduleItems: [],
  now,
});
const weakDraft = buildCommunicationDraft(weakIntelligence, 'owner_update');
assert.strictEqual(weakDraft.confidence, 'low');
assert(weakDraft.knownLimitations.some(item => /evidence is weak/i.test(item)));
assert.strictEqual(weakDraft.recommendations.length, 0);

const serviceSource = fs.readFileSync(path.join(root, 'services/DAVECommunicationCenter.ts'), 'utf8');
for (const forbiddenDependency of [
  'projectRealitySourceRecords',
  'DAVEDailyBriefUpdate',
  'DAVEDailyBriefDocument',
  'DAVEDailyBriefScheduleItem',
  'photoIntelligence',
  '.updates',
  '.documents',
  '.scheduleItems',
]) {
  assert(!serviceSource.includes(forbiddenDependency),
    `Communication Center must not inspect raw records via ${forbiddenDependency}.`);
}
assert(serviceSource.includes('intelligence: DAVEProjectIntelligence'));
assert(!/function\s+(send|email|message)|\.send\s*\(/i.test(serviceSource),
  'Communication Center must not implement autonomous sending.');

console.log('DAVE Communication Center behavioral tests passed.');
