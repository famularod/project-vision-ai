#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadTs(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  const moduleUnderTest = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: absolutePath,
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(
    require,
    moduleUnderTest,
    moduleUnderTest.exports,
  );
  return moduleUnderTest.exports;
}

const {
  buildDAVEIdentityRegistry,
  canonicalizeDAVEScheduleItems,
  resolveDAVEIdentity,
  scheduleTaskGroupName,
} = loadTs('services/DAVEIdentity.ts');

function task(id, overrides = {}) {
  return {
    id,
    scheduleProjectName: '2321 Compliance Project',
    projectName: '2321 Compliance Project',
    locationName: 'East Driveway',
    taskName: 'Place concrete paving',
    startDate: '07/10/2026',
    finishDate: '07/20/2026',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 60,
    priority: 'High',
    status: 'In Progress',
    notes: '',
    createdAt: '2026-07-16T12:00:00.000Z',
    ...overrides,
  };
}

const projectAsArea = task('project-as-area', {
  locationName: '2321 Compliance Project',
  taskName: 'Install gunite adhesive',
});
const eastDriveway = task('east-driveway');
const canonicalized = canonicalizeDAVEScheduleItems(
  [projectAsArea, eastDriveway],
  { projectNames: ['2321 Compliance Project'] },
);

assert.strictEqual(canonicalized.items[0].locationName, '');
assert.strictEqual(scheduleTaskGroupName(canonicalized.items[0]), 'Area Not Assigned');
assert(canonicalized.issues.some(issue =>
  issue.itemId === 'project-as-area' &&
  issue.field === 'area' &&
  issue.status === 'kind_conflict',
));
assert.strictEqual(canonicalized.items[1].locationName, 'East Driveway');
assert.strictEqual(scheduleTaskGroupName(canonicalized.items[1]), 'East Driveway');

const correctedRegistry = buildDAVEIdentityRegistry({
  projectNames: ['2321 Compliance Project'],
  corrections: [{
    id: 'correction-pump-house',
    kind: 'area',
    rawName: 'Pump Hse',
    canonicalName: 'Pump House',
    parentProjectName: '2321 Compliance Project',
    sourceRecordId: 'pm-correction-1',
    confirmedAt: '2026-07-16T12:00:00.000Z',
    confirmedBy: 'Project manager',
  }],
});
const corrected = resolveDAVEIdentity({
  rawName: 'Pump Hse',
  expectedKind: 'area',
  parentProjectName: '2321 Compliance Project',
  registry: correctedRegistry,
});
assert.strictEqual(corrected.status, 'resolved');
assert.strictEqual(corrected.entity.canonicalName, 'Pump House');
assert.strictEqual(corrected.needsVerification, false);
const correctedSchedule = canonicalizeDAVEScheduleItems(
  [task('corrected-area', { locationName: 'Pump Hse' })],
  {
    projectNames: ['2321 Compliance Project'],
    corrections: correctedRegistry.corrections,
  },
);
assert.strictEqual(correctedSchedule.items[0].locationName, 'Pump House');
assert(!correctedSchedule.issues.some(issue => issue.field === 'area'));

const ambiguousRegistry = buildDAVEIdentityRegistry({
  projectNames: ['2321 Compliance Project', '2375 Compliance Project'],
  scheduleItems: [
    task('north-2321', { locationName: 'North Lot' }),
    task('north-2375', {
      scheduleProjectName: '2375 Compliance Project',
      projectName: '2375 Compliance Project',
      locationName: 'North Lot',
    }),
  ],
});
const ambiguous = resolveDAVEIdentity({
  rawName: 'North Lot',
  expectedKind: 'area',
  registry: ambiguousRegistry,
});
assert.strictEqual(ambiguous.status, 'ambiguous');
assert.strictEqual(ambiguous.needsVerification, true);

console.log('PASS DAVE canonical identity behavior');
