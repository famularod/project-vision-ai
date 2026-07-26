#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function load(relative) {
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const moduleValue = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module: moduleValue,
    exports: moduleValue.exports,
    require,
    Object,
    Set,
  }, { filename: relative });
  return moduleValue.exports;
}

const {
  buildDAVEProjectWalkFieldUpdateDraft,
  unusedConfirmedProjectWalkMemories,
} = load('services/DAVEProjectWalkFieldUpdate.ts');
const { photoAssessmentReviewCopy } = load('services/PhotoAssessment.ts');

function memory(id, overrides = {}) {
  return {
    id,
    status: 'confirmed',
    confirmedAt: '2026-07-13T12:05:00.000Z',
    createdAt: '2026-07-13T12:00:00.000Z',
    transcript: 'Field observation source.',
    recommendedProject: { value: 'Alpha', confirmed: true },
    recommendedLocation: { value: 'Canopy B', confirmed: true },
    fields: {
      peopleOrCompany: null,
      commitment: null,
      dueDate: null,
      decision: null,
      ownerRequest: null,
      inspectionChange: null,
      scheduleChange: null,
      issue: null,
      risk: null,
      followUp: null,
      generalMemory: null,
    },
    ...overrides,
  };
}

const issue = memory('memory-issue', {
  createdAt: '2026-07-13T12:01:00.000Z',
  fields: {
    ...memory('fields').fields,
    issue: 'Guardrail is missing at the west edge.',
    followUp: 'Confirm replacement before the next shift.',
  },
});
const commitment = memory('memory-commitment', {
  createdAt: '2026-07-13T12:02:00.000Z',
  fields: {
    ...memory('fields').fields,
    peopleOrCompany: 'ABC Electric',
    commitment: 'Finish conduit rough-in.',
    dueDate: '2026-07-15',
  },
});
const otherProject = memory('memory-other', {
  recommendedProject: { value: 'Beta', confirmed: true },
});
const unconfirmed = memory('memory-draft', {
  status: 'draft',
  confirmedAt: null,
});

const available = unusedConfirmedProjectWalkMemories({
  projectName: 'Alpha',
  memories: [commitment, otherProject, issue, unconfirmed],
  usedMemoryIds: ['memory-commitment'],
});
assert.deepStrictEqual([...available].map(item => item.id), ['memory-issue']);

const draft = buildDAVEProjectWalkFieldUpdateDraft({
  projectName: 'Alpha',
  memories: [commitment, issue],
});
assert.deepStrictEqual([...draft.sourceMemoryIds], ['memory-issue', 'memory-commitment']);
assert.strictEqual(draft.recommendedAreaName, 'Canopy B');
assert(draft.notes.includes('Prepared from 2 confirmed field memories.'));
assert(draft.notes.includes('Issue: Guardrail is missing at the west edge.'));
assert(draft.notes.includes('Follow-up: Confirm replacement before the next shift.'));
assert(draft.notes.includes('Person or company: ABC Electric'));
assert(draft.notes.includes('Commitment: Finish conduit rough-in.'));
assert(draft.notes.includes('Due date: 2026-07-15'));
assert(Object.isFrozen(draft) && Object.isFrozen(draft.sourceMemoryIds));

const mixedAreas = buildDAVEProjectWalkFieldUpdateDraft({
  projectName: 'Alpha',
  memories: [issue, memory('memory-other-area', {
    recommendedLocation: { value: 'Roof', confirmed: true },
  })],
});
assert.strictEqual(mixedAreas.recommendedAreaName, null,
  'Different confirmed areas must not be collapsed into one draft area.');
assert(mixedAreas.notes.includes('Area: Canopy B') && mixedAreas.notes.includes('Area: Roof'));

const transcriptFallback = buildDAVEProjectWalkFieldUpdateDraft({
  projectName: 'Alpha',
  memories: [memory('memory-transcript', {
    transcript: 'Temporary fencing was moved to the north entrance.',
    recommendedLocation: { value: null, confirmed: false },
  })],
});
assert(transcriptFallback.notes.includes('Field note: Temporary fencing was moved to the north entrance.'));

assert.throws(() => buildDAVEProjectWalkFieldUpdateDraft({
  projectName: 'Alpha',
  memories: [otherProject, unconfirmed],
}), /confirmed Project Walk memory/i);

const app = read('App.tsx');
assert(app.includes('sourceCaptureMemoryIds?: string[]') && app.includes('sourceCaptureMemoryIds: Array.isArray') &&
  app.includes('sourceWalkSessionId?: string | null') && app.includes('sourceWalkSessionId: optionalString'),
  'Field Updates must persist and hydrate their source memory and walk-session IDs.');
assert(app.includes('Prepare Walk Update (') && app.includes('onPrepareWalkUpdate(legacyUnusedWalkMemories)'),
  'Project Workspace must expose the existing-review entry point only when unused memories exist.');
assert(app.includes("setScreen('BuildUpdate')") && app.includes("continueWithoutPhotosAcknowledged: true"),
  'Prepared walk updates must open the existing review screen as notes-only drafts.');
assert(app.includes('function saveFieldUpdateFromReview()') && app.includes('Save Field Update'),
  'Prepared walk updates must use the same explicit Field Update save boundary.');
assert(app.includes("photoAssessmentReviewCopy(photoAssessment.state, 'safety concern')") &&
  app.includes("photoAssessmentReviewCopy(photoAssessment.state, 'blocker')") &&
  photoAssessmentReviewCopy('not_assessed', 'safety concern') === 'Safety review is not complete' &&
  photoAssessmentReviewCopy('not_assessed', 'blocker') === 'Blocker review is not complete',
  'Notes-only walk drafts must not claim that missing photo evidence proves safety or blockers are clear.');

console.log('PASS DAVE Project Walk field-update draft checks');
