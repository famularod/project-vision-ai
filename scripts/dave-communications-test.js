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

// A photo finding may inform a draft only when it is "qualified": the
// comparison finished against a recorded earlier photo the two can fairly be
// compared with, the finding came from the pictures themselves, and the user
// confirmed it (services/PhotoAssessment.ts, photoDisplayResultCanInformProject).
// This fixture was written before the last three were required and carried
// none of them, so the app, rightly, kept its finding out of every draft.
const qualifiedPhotoResult = {
  status: 'analysis_complete',
  updatedAt: '2026-07-11T10:01:00.000Z',
  comparisonConfidence: 'high',
  priorEvidenceId: 'baseline-evidence',
  comparability: 'strong',
  provenance: 'visual_only',
  userReview: 'confirmed',
  findings: [{
    findingType: 'added',
    description: 'A tan case appears in the foreground near the laptop.',
    confidence: 0.9,
  }],
};

function intelligenceWithPhotoResult(photoIntelligence) {
  return buildProjectIntelligence({
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
        photoIntelligence,
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
}

const intelligence = intelligenceWithPhotoResult(qualifiedPhotoResult);

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
const ownerObservation = ownerDraft.observations.find(item => /tan case/i.test(item.text));
assert(
  ownerObservation.evidenceIds.includes('evidence:photo:update-current') &&
    ownerObservation.evidenceIds.includes('evidence:photo:baseline-evidence'),
  'A photo observation must cite both the current photo and the earlier one it was compared with.',
);
assert(
  ownerObservation.limitations.includes('Visual change is not verified project progress.'),
  'A photo observation must say that a visible change is not verified progress.',
);
for (const draft of center.drafts) {
  for (const section of ['facts', 'interpretations', 'recommendations']) {
    assert(!draft[section].some(item => /tan case/i.test(item.text)),
      `${draft.title}: a photo observation must stay out of ${section}.`);
  }
}

// The other half of "qualified": the same finding, with any one of the things
// that qualify it missing, must not reach any section of any draft.
const unqualifiedPhotoResults = [
  ['not yet reviewed by the user', { userReview: undefined }],
  ['marked incorrect by the user', { userReview: 'incorrect' }],
  ['marked not useful by the user', { userReview: 'not_useful' }],
  ['taken from the caption, not the pictures', { provenance: 'caption_only' }],
  ['inferred, not seen', { provenance: 'inferred' }],
  ['with no stated source', { provenance: undefined }],
  ['from two photos that compare weakly', { comparability: 'weak' }],
  ['from two photos of unknown comparability', { comparability: undefined }],
  ['with no earlier photo on record', { priorEvidenceId: undefined }],
  ['from a comparison that failed', { status: 'analysis_failed_retry' }],
  ['from a comparison still running', { status: 'analyzing' }],
  ['from a comparison that was unavailable', { status: 'comparison_unavailable' }],
  ['the model itself marked uncertain', {
    findings: [{
      findingType: 'uncertain',
      description: 'A tan case appears in the foreground near the laptop.',
      confidence: 0.2,
    }],
  }],
];
for (const [label, change] of unqualifiedPhotoResults) {
  const unqualifiedCenter = buildDAVECommunicationCenter(
    intelligenceWithPhotoResult({ ...qualifiedPhotoResult, ...change }),
  );
  assert.strictEqual(unqualifiedCenter.drafts.length, 6);
  assert(
    !/tan case/i.test(JSON.stringify(unqualifiedCenter)),
    `A photo finding ${label} must not appear anywhere in a draft.`,
  );
}

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
