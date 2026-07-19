#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'services/PIELiveAuthoritySignature.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  specifier => { throw new Error(`Unexpected runtime dependency: ${specifier}`); },
  moduleUnderTest,
  moduleUnderTest.exports,
);
const {
  PIE_LIVE_AUTHORITY_SIGNATURE_VERSION,
  authorityInputScopeSignature,
  authorityInputSignature,
} = moduleUnderTest.exports;

assert.strictEqual(PIE_LIVE_AUTHORITY_SIGNATURE_VERSION, 'pie-live-authority-input/2.1');

function input() {
  return {
    organizationId: 'org-1',
    projectId: 'project-1',
    projectName: 'Hospital',
    projectNames: ['Hospital'],
    updates: [{
      id: 'update-1',
      projectName: 'Hospital',
      date: '2026-07-16T12:00:00.000Z',
      selectedAreaId: 'area-1',
      selectedAreaName: 'Level 2',
      status: 'sent',
      pieStatus: 'complete',
      pieCompletedAt: '2026-07-16T12:05:00.000Z',
      notes: 'Field observation.',
      photos: [{
        id: 'photo-1',
        caption: 'AHU inspection.',
        category: 'Update',
        actionRequired: '',
        actionOwner: '',
        actionDueDate: '',
        actionStatus: 'Open',
        selectedAreaId: 'area-1',
        selectedAreaName: 'Level 2',
        photoIntelligence: {
          status: 'analysis_complete',
          updatedAt: '2026-07-16T12:05:00.000Z',
          title: 'AHU condition',
          summary: 'Unit appears installed.',
          visibleChange: 'Unit is now present.',
          location: 'Level 2',
          comparisonConfidence: 'high',
          captureLimitations: [],
          projectProgress: 'supported',
          repeatPhotoGuidance: 'Repeat from the same doorway.',
          authorityMessage: 'Visual evidence only.',
        },
      }],
    }],
    scheduleItems: [],
  };
}

const base = input();
const baseSignature = authorityInputSignature(base);
assert.strictEqual(authorityInputSignature(JSON.parse(JSON.stringify(base))), baseSignature);

const sameLengthSummary = input();
sameLengthSummary.updates[0].photos[0].photoIntelligence.summary = 'Unit appears removed...';
assert.strictEqual(
  sameLengthSummary.updates[0].photos[0].photoIntelligence.summary.length,
  base.updates[0].photos[0].photoIntelligence.summary.length,
);
assert.notStrictEqual(authorityInputSignature(sameLengthSummary), baseSignature, 'same-length semantic changes must refresh authority');

const guidance = input();
guidance.updates[0].photos[0].photoIntelligence.repeatPhotoGuidance = 'Repeat from the south wall.';
assert.notStrictEqual(authorityInputSignature(guidance), baseSignature);

const status = input();
status.updates[0].photos[0].photoIntelligence.status = 'completed_with_limitations';
status.updates[0].photos[0].photoIntelligence.updatedAt = '2026-07-16T12:06:00.000Z';
assert.notStrictEqual(authorityInputSignature(status), baseSignature);

const uncappedSchedule = input();
uncappedSchedule.scheduleItems = Array.from({ length: 180 }, (_, index) => ({
  id: `schedule-${index}`,
  createdAt: '2026-07-16T12:00:00.000Z',
  importedAt: '2026-07-16T12:00:00.000Z',
  taskName: `Task ${index}`,
  projectName: 'Hospital',
  locationName: 'Level 2',
  finishDate: '07/31/2026',
  status: 'Not Started',
  percentComplete: 0,
  owner: 'PM A',
}));
const changedUncappedSchedule = JSON.parse(JSON.stringify(uncappedSchedule));
changedUncappedSchedule.scheduleItems[179].owner = 'PM B';
assert.notStrictEqual(
  authorityInputSignature(changedUncappedSchedule),
  authorityInputSignature(uncappedSchedule),
  'an entity beyond the old cap must refresh authority',
);

const projectAreaChanged = input();
projectAreaChanged.projectAreas = [{
  id: 'area-1',
  name: 'Level 2',
  building: 'Hospital',
  latitude: 34.1,
  longitude: -118.2,
  radiusFeet: 100,
}];
const projectAreaMoved = JSON.parse(JSON.stringify(projectAreaChanged));
projectAreaMoved.projectAreas[0].radiusFeet = 125;
assert.notStrictEqual(authorityInputSignature(projectAreaMoved), authorityInputSignature(projectAreaChanged));

const contactChanged = input();
contactChanged.contacts = { contacts: [{ id: 'contact-1', name: 'PM', email: 'pm@example.com', phone: '' }] };
const contactChangedAgain = JSON.parse(JSON.stringify(contactChanged));
contactChangedAgain.contacts.contacts[0].email = 'new-pm@example.com';
assert.notStrictEqual(authorityInputSignature(contactChangedAgain), authorityInputSignature(contactChanged));

const syncChanged = input();
syncChanged.syncMetadata = { status: 'fresh', lastSuccessfulSyncAt: '2026-07-16T12:00:00.000Z' };
const syncDegraded = JSON.parse(JSON.stringify(syncChanged));
syncDegraded.syncMetadata.status = 'degraded';
assert.notStrictEqual(authorityInputSignature(syncDegraded), authorityInputSignature(syncChanged));

const canonicalKeyOrder = input();
canonicalKeyOrder.currentUpdate = { id: 'draft-1', projectName: 'Hospital', notes: 'Note', photos: [] };
const reorderedKeys = JSON.parse(JSON.stringify(canonicalKeyOrder));
reorderedKeys.currentUpdate = {
  photos: reorderedKeys.currentUpdate.photos,
  notes: reorderedKeys.currentUpdate.notes,
  projectName: reorderedKeys.currentUpdate.projectName,
  id: reorderedKeys.currentUpdate.id,
};
assert.strictEqual(
  authorityInputSignature(reorderedKeys),
  authorityInputSignature(canonicalKeyOrder),
  'object key insertion order must not create a false authority refresh',
);

const editedDraft = input();
editedDraft.currentUpdate = {
  ...editedDraft.updates[0],
  id: 'draft-1',
  notes: 'Typing a field note.',
};
const editedDraftAgain = JSON.parse(JSON.stringify(editedDraft));
editedDraftAgain.currentUpdate.notes = 'Typing a field note with more detail.';
assert.notStrictEqual(authorityInputSignature(editedDraftAgain), authorityInputSignature(editedDraft));
assert.strictEqual(
  authorityInputScopeSignature(editedDraftAgain),
  authorityInputScopeSignature(editedDraft),
  'draft typing should refresh within the same debounced authority scope',
);

const changedProject = JSON.parse(JSON.stringify(editedDraft));
changedProject.projectId = 'project-2';
changedProject.projectName = 'School';
changedProject.projectNames = ['School'];
assert.notStrictEqual(
  authorityInputScopeSignature(changedProject),
  authorityInputScopeSignature(editedDraft),
  'project changes must bypass the typing debounce',
);

const ephemeralPortfolio = input();
ephemeralPortfolio.projectTruthPersistencePolicy = 'ephemeral_portfolio';
assert.notStrictEqual(
  authorityInputSignature(ephemeralPortfolio),
  authorityInputSignature(input()),
  'project-truth persistence policy must be part of the full signature',
);
assert.notStrictEqual(
  authorityInputScopeSignature(ephemeralPortfolio),
  authorityInputScopeSignature(input()),
  'project-truth persistence policy must be part of the priority scope signature',
);

const provider = fs.readFileSync(path.join(root, 'providers/PIELiveAuthorityProvider.tsx'), 'utf8');
assert(provider.includes("from '../services/PIELiveAuthoritySignature'"));
assert(provider.includes('useDebouncedSnapshot'));
assert(provider.includes('LIVE_AUTHORITY_INPUT_DEBOUNCE_MS'));
assert(
  provider.includes("refreshInput.projectTruthPersistencePolicy === 'ephemeral_portfolio'") &&
    provider.includes('? buildPIECoreIntelligence(coreInput)') &&
    provider.includes(': await buildLivePIECoreIntelligence(coreInput)'),
  'Ephemeral portfolio authority must use the non-persisting Core builder.',
);
assert(
  provider.includes('if (!ephemeralPortfolio && result.longitudinalPhotoIntelligence)') &&
    provider.includes("if (authorityInput.projectTruthPersistencePolicy === 'ephemeral_portfolio') return;"),
  'Ephemeral portfolio authority must skip photo-progress and project-truth persistence.',
);

console.log('DAVE live-authority semantic signature tests passed.');
