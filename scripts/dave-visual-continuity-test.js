#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function loadDependencyFreeTypeScriptModule(relativePath) {
  const servicePath = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(servicePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleUnderTest = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    specifier => {
      throw new Error(`Unexpected runtime dependency: ${specifier}`);
    },
    moduleUnderTest,
    moduleUnderTest.exports,
  );
  return moduleUnderTest.exports;
}

const {
  createDAVEAreaIdentity,
  daveAreaIdentitiesMatch,
  createDAVEPhotoContinuityAnchor,
  scoreDAVEVisualContinuityCandidate,
} = loadDependencyFreeTypeScriptModule('services/PIEVisualContinuity.ts');
const {
  selectWinningPriorPhotoCandidate,
} = loadDependencyFreeTypeScriptModule('services/PhotoPairPreparation.ts');

assert.strictEqual(
  daveAreaIdentitiesMatch(
    createDAVEAreaIdentity('opaque-area-id', 'Mechanical Room'),
    createDAVEAreaIdentity(null, 'Mechanical Room'),
  ),
  true,
  'an ID-bearing current area must match a legacy name-only record by the shared name',
);
assert.strictEqual(
  daveAreaIdentitiesMatch(
    createDAVEAreaIdentity('area-one', 'Mechanical Room'),
    createDAVEAreaIdentity('area-two', 'Mechanical Room'),
  ),
  false,
  'two explicit, different area IDs must remain distinct even when labels match',
);

function update({
  id,
  projectName = 'Hospital Renovation',
  areaId = 'mechanical-room',
  taskId = null,
  taskName = '',
  notes = '',
  photos = [],
}) {
  return {
    id,
    projectName,
    selectedAreaId: areaId,
    selectedAreaName: 'Mechanical Room',
    scheduleItemId: taskId,
    scheduleTaskName: taskName,
    notes,
    photos,
  };
}

function photo({
  id,
  caption = '',
  continuityAnchor = null,
  areaId = 'mechanical-room',
  areaName = 'Mechanical Room',
}) {
  return {
    id,
    uri: `file:///${id}.jpg`,
    caption,
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    selectedAreaId: areaId,
    selectedAreaName: areaName,
    continuityAnchor,
  };
}

const guidance = {
  needed: true,
  projectId: 'hospital-renovation',
  projectName: 'Hospital Renovation',
  areaName: 'Mechanical Room',
  realityObjectId: 'ahu-7',
  referencePhotoId: 'ahu-reference',
  referencePhotoUri: 'file:///ahu-reference.jpg',
  instruction: 'Match the air-handler view.',
  reason: 'A repeat view will verify installation progress.',
  alignmentGuide: 'Keep AHU-7 centered with the north wall visible.',
  priority: 'high',
};

const anchor = createDAVEPhotoContinuityAnchor({
  guidance,
  projectName: 'Hospital Renovation',
  areaName: 'Mechanical Room',
  confirmedAt: '2026-07-16T10:00:00.000Z',
});
assert(anchor, 'a valid same-project reference must produce a continuity anchor');
assert.strictEqual(anchor.referencePhotoId, 'ahu-reference');
assert.strictEqual(
  createDAVEPhotoContinuityAnchor({
    guidance,
    projectName: 'Different Project',
    areaName: 'Mechanical Room',
  }),
  null,
  'a cross-project reference must never attach to a new photo',
);
assert.strictEqual(
  createDAVEPhotoContinuityAnchor({
    guidance,
    projectName: 'Hospital Renovation',
    areaName: 'Roof',
  }),
  null,
  'a confirmed cross-area reference must never attach to a new photo',
);

const currentPhoto = photo({
  id: 'current',
  caption: 'AHU-7 duct connection and insulation progress',
});
const currentUpdate = update({
  id: 'current-update',
  taskId: 'install-ahu-7',
  taskName: 'Install AHU-7 and connect ductwork',
  photos: [currentPhoto],
});
const matchingPhoto = photo({
  id: 'older-matching',
  caption: 'AHU-7 duct connection before insulation',
});
const matchingUpdate = update({
  id: 'older-matching-update',
  taskId: 'install-ahu-7',
  taskName: 'Install AHU-7 and connect ductwork',
  photos: [matchingPhoto],
});
const recentWrongPhoto = photo({
  id: 'recent-wrong',
  caption: 'Electrical panel labeling complete',
});
const recentWrongUpdate = update({
  id: 'recent-wrong-update',
  taskName: 'Label electrical panels',
  photos: [recentWrongPhoto],
});

const matchingScore = scoreDAVEVisualContinuityCandidate({
  currentUpdate,
  currentPhoto,
  candidateUpdate: matchingUpdate,
  candidatePhoto: matchingPhoto,
});
const wrongSubjectScore = scoreDAVEVisualContinuityCandidate({
  currentUpdate,
  currentPhoto,
  candidateUpdate: recentWrongUpdate,
  candidatePhoto: recentWrongPhoto,
});
assert(
  matchingScore > wrongSubjectScore,
  'matching subject and task context must outrank a merely newer photo',
);

const anchoredCurrentPhoto = photo({ id: 'anchored-current', continuityAnchor: anchor });
const anchoredScore = scoreDAVEVisualContinuityCandidate({
  currentUpdate,
  currentPhoto: anchoredCurrentPhoto,
  candidateUpdate: matchingUpdate,
  candidatePhoto: photo({ id: 'ahu-reference' }),
});
assert.strictEqual(anchoredScore, 10_000, 'the PM-selected reference must win deterministically');

const opaqueAreaAnchoredScore = scoreDAVEVisualContinuityCandidate({
  currentUpdate,
  currentPhoto: anchoredCurrentPhoto,
  candidateUpdate: matchingUpdate,
  candidatePhoto: photo({
    id: 'ahu-reference',
    areaId: '7e7d8f88-opaque-area-id',
    areaName: 'Mechanical Room',
  }),
});
assert.strictEqual(
  opaqueAreaAnchoredScore,
  10_000,
  'an exact PM-selected reference must not be rejected because its area ID is opaque',
);

assert.strictEqual(
  scoreDAVEVisualContinuityCandidate({
    currentUpdate,
    currentPhoto: anchoredCurrentPhoto,
    candidateUpdate: matchingUpdate,
    candidatePhoto: photo({ id: 'ahu-reference', areaName: 'Roof' }),
  }),
  -1,
  'an exact reference with a genuinely different named area must still be rejected',
);

assert.strictEqual(
  scoreDAVEVisualContinuityCandidate({
    currentUpdate,
    currentPhoto,
    candidateUpdate: update({ id: 'other', projectName: 'Other Project' }),
    candidatePhoto: matchingPhoto,
  }),
  -1,
  'cross-project photos must be rejected',
);

const appSource = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
assert(appSource.includes('Match the Previous View'));
assert(appSource.includes('createDAVEPhotoContinuityAnchor'));
assert(appSource.includes('continuityAnchor: continuityAnchor || null'));
assert(appSource.includes('repeatPhotoReferenceImage'));

const workflowSource = fs.readFileSync(
  path.join(root, 'services/PIEPhotoVisionMobileWorkflow.ts'),
  'utf8',
);
const photoPairPreparationSource = fs.readFileSync(
  path.join(root, 'services/PhotoPairPreparation.ts'),
  'utf8',
);
assert(workflowSource.includes('scoreDAVEVisualContinuityCandidate'));
assert(workflowSource.includes('selectWinningPriorPhotoCandidate'));
assert(photoPairPreparationSource.includes('right.continuityScore - left.continuityScore'));

const selectedContinuityCandidate = selectWinningPriorPhotoCandidate([
  {
    photo: matchingPhoto,
    continuityScore: matchingScore,
    capturedAt: 100,
    candidateIndex: 1,
  },
  {
    photo: recentWrongPhoto,
    continuityScore: wrongSubjectScore,
    capturedAt: 200,
    candidateIndex: 2,
  },
], []);
assert.strictEqual(
  selectedContinuityCandidate?.photo.id,
  matchingPhoto.id,
  'the production ranking contract must prefer higher visual continuity over a merely newer photo',
);

console.log('DAVE visual-continuity behavior tests passed.');
