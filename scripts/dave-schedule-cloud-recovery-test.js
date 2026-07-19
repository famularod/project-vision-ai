#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'services/DAVEScheduleRecovery.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', compiled)(moduleUnderTest, moduleUnderTest.exports);

const {
  isDAVESafeCloudScheduleRecord,
  reconcileDAVEScheduleRecords,
  recoverDAVEScheduleRecords,
} = moduleUnderTest.exports;

function schedule(overrides = {}) {
  return {
    id: 'task-1',
    scheduleProjectName: '2375 Compliance Project',
    projectTimeZone: 'America/Los_Angeles',
    projectName: '2375 Compliance Project',
    locationName: 'Canopy C',
    taskName: 'INSTALL HAND RAILS',
    startDate: '07/03/2026',
    finishDate: '07/21/2026',
    milestone: '',
    owner: '',
    contractor: '',
    durationDays: 2,
    percentComplete: 100,
    progressSource: 'schedule_import',
    progressConfirmedAt: null,
    progressConfirmedBy: null,
    priority: 'High',
    status: 'Complete',
    notes: '',
    importedFrom: 'master-schedule.pdf',
    importedAt: '2026-07-16T20:51:33.203Z',
    importBatchId: null,
    sourceDocumentId: null,
    completionVerification: null,
    createdAt: '2026-07-16T20:51:33.203Z',
    ...overrides,
  };
}

const pmComplete = schedule({
  id: 'pm-complete',
  progressSource: 'project_manager',
  progressConfirmedAt: '2026-07-17T20:07:19.887Z',
});
const legacyAlias = schedule({
  id: 'legacy-unassigned',
  scheduleProjectName: null,
  projectName: '',
  locationName: '',
  percentComplete: 0,
  progressSource: null,
  status: 'Not Started',
  importedAt: '2026-07-14T01:24:51.152Z',
  createdAt: '2026-07-14T01:24:51.152Z',
});

assert.deepStrictEqual(
  reconcileDAVEScheduleRecords([legacyAlias, pmComplete]).map(item => item.id),
  ['pm-complete'],
  'an older blank-project alias must not resurrect a completed assigned task at 0%',
);

const newerImported = schedule({ id: 'new-import', percentComplete: 100, status: 'Complete' });
const olderImported = schedule({
  id: 'old-import',
  percentComplete: 80,
  status: 'In Progress',
  importedAt: '2026-07-14T01:58:52.555Z',
  createdAt: '2026-07-14T01:58:52.555Z',
});
assert.deepStrictEqual(
  reconcileDAVEScheduleRecords([olderImported, newerImported]).map(item => item.id),
  ['new-import'],
  'the newer assigned import must replace its older logical copy',
);

const canopyA = schedule({ id: 'canopy-a', locationName: 'Canopy A' });
const canopyB = schedule({ id: 'canopy-b', locationName: 'Canopy B' });
assert.strictEqual(
  reconcileDAVEScheduleRecords([canopyA, canopyB]).length,
  2,
  'same-named work in distinct areas must remain distinct',
);
const firstInspection = schedule({
  id: 'inspection-1',
  taskName: 'INSPECTION',
  startDate: '07/01/2026',
  finishDate: '07/01/2026',
});
const secondInspection = schedule({
  id: 'inspection-2',
  taskName: 'INSPECTION',
  startDate: '07/15/2026',
  finishDate: '07/15/2026',
  importedAt: '2026-07-18T20:51:33.203Z',
  createdAt: '2026-07-18T20:51:33.203Z',
});
assert.strictEqual(
  reconcileDAVEScheduleRecords([firstInspection, secondInspection]).length,
  2,
  'same-named activities in different imports must remain distinct by date',
);
const firstBatch = schedule({ id: 'batch-a-task', importBatchId: 'batch-a', sourceDocumentId: 'doc-a' });
const secondBatch = schedule({ id: 'batch-b-task', importBatchId: 'batch-b', sourceDocumentId: 'doc-b' });
assert.strictEqual(
  reconcileDAVEScheduleRecords([firstBatch, secondBatch]).length,
  2,
  'identical displayed work from distinct immutable import batches must remain distinct',
);
const pmFirstInspection = schedule({
  id: 'pm-inspection-1', taskName: 'INSPECTION', startDate: '07/01/2026', finishDate: '07/01/2026',
  progressSource: 'project_manager', progressConfirmedAt: '2026-07-18T01:00:00.000Z',
});
assert.strictEqual(
  reconcileDAVEScheduleRecords([pmFirstInspection, secondInspection]).length,
  2,
  'PM progress for one dated occurrence must not remove another occurrence',
);
const punctuationAlias = schedule({
  ...legacyAlias,
  id: 'legacy-punctuation-alias',
  taskName: 'INSTALL-METAL LATH & STEEL STUD',
});
const provenancedAssigned = schedule({
  id: 'provenanced-assigned',
  taskName: 'INSTALL METAL LATH AND STEEL STUD',
  importBatchId: 'batch-current',
  sourceDocumentId: 'document-current',
});
assert.deepStrictEqual(
  reconcileDAVEScheduleRecords([punctuationAlias, provenancedAssigned]).map(item => item.id),
  ['provenanced-assigned'],
  'an unassigned 0% legacy alias may follow an exact dated occurrence into immutable provenance',
);

assert.deepStrictEqual(
  recoverDAVEScheduleRecords({
    local: [],
    cloud: [newerImported],
    allowCloudOnly: false,
  }),
  [],
  'an intentionally empty local schedule must remain empty during delayed startup recovery',
);
assert.deepStrictEqual(
  recoverDAVEScheduleRecords({
    local: [],
    cloud: [newerImported],
    allowCloudOnly: true,
  }).map(item => item.id),
  ['new-import'],
  'a genuinely missing local store may recover a complete cloud record',
);
assert.deepStrictEqual(
  recoverDAVEScheduleRecords({
    local: [pmComplete],
    cloud: [newerImported],
    deletedIds: ['new-import'],
    allowCloudOnly: true,
  }).map(item => item.id),
  ['pm-complete'],
  'tombstoned cloud ids must remain deleted',
);
const staleSameIdLocal = schedule({
  id: 'shared-id',
  percentComplete: 0,
  progressSource: null,
  status: 'Not Started',
  importedAt: '2026-07-14T01:24:51.152Z',
  createdAt: '2026-07-14T01:24:51.152Z',
});
const newerSameIdCloudPM = schedule({
  id: 'shared-id',
  percentComplete: 100,
  progressSource: 'project_manager',
  progressConfirmedAt: '2026-07-18T01:00:00.000Z',
});
assert.strictEqual(
  recoverDAVEScheduleRecords({
    local: [staleSameIdLocal],
    cloud: [newerSameIdCloudPM],
    allowCloudOnly: true,
  })[0].percentComplete,
  100,
  'a stale same-id local import must not overwrite a newer PM cloud judgment',
);
const oldVerification = {
  status: 'pm_verified', reportedAt: '2026-07-16T01:00:00.000Z', reportedBy: 'PM',
  priorScheduleStatus: 'In Progress', priorPercentComplete: 80,
  verifiedAt: '2026-07-16T02:00:00.000Z', verifiedBy: 'PM', verificationNote: null, evidence: [],
};
const verifiedCloud = schedule({
  id: 'pm-correction-shared', progressSource: 'project_manager',
  progressConfirmedAt: '2026-07-16T02:00:00.000Z', completionVerification: oldVerification,
});
const newerLocalCorrection = schedule({
  id: 'pm-correction-shared', status: 'In Progress', percentComplete: 70,
  progressSource: 'project_manager', progressConfirmedAt: '2026-07-18T02:00:00.000Z',
  completionVerification: oldVerification,
});
assert.strictEqual(
  recoverDAVEScheduleRecords({ local: [newerLocalCorrection], cloud: [verifiedCloud], allowCloudOnly: true })[0].percentComplete,
  70,
  'a newer explicit PM correction must reopen an older verified completion for the same id',
);

assert.strictEqual(isDAVESafeCloudScheduleRecord(newerImported), true);
assert.strictEqual(
  isDAVESafeCloudScheduleRecord({ ...legacyAlias, id: undefined }),
  false,
  'cloud records need a stable id',
);
assert.strictEqual(
  isDAVESafeCloudScheduleRecord(legacyAlias),
  false,
  'unassigned legacy rows must not be normalized into operational 0% tasks',
);
assert.strictEqual(
  isDAVESafeCloudScheduleRecord({ ...newerImported, percentComplete: undefined }),
  false,
  'missing cloud progress must be rejected rather than defaulted to 0%',
);

const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const recoveryHook = fs.readFileSync(path.join(root, 'hooks/use-startup-local-first-recovery.ts'), 'utf8');
assert(app.includes('useStartupLocalFirstRecovery<ScheduleItem, ScheduleItem, ScheduleItem>'));
assert(recoveryHook.includes('localSnapshotRef.current = { attempt: retryAttempt, found: result.found }'));
assert(recoveryHook.includes('if (snapshot.found) return;'));
assert(recoveryHook.includes('latestOptions.localAuthorityReady || latestOptions.localAuthorityRef.current'));
assert(app.includes('items.filter(isDAVESafeCloudScheduleRecord)'));
assert(app.includes('recoverDAVEScheduleRecords({'));
assert(app.includes('markProjectAreasAuthorityReady(true);'));
assert(app.includes('markReferenceDocumentsAuthorityReady(true);'));
assert(app.includes('markScheduleItemsAuthorityReady(true);'));
assert(recoveryHook.includes('latestOptions.localAuthorityRef.current'));
assert(!app.includes("'Project areas could not be loaded.'"));
assert(!app.includes("'Schedule items could not be loaded.'"));

const supabase = fs.readFileSync(path.join(root, 'services/SupabaseService.ts'), 'utf8');
assert(supabase.includes('.select(`id, updated_at, ${jsonColumn}`'));
assert(supabase.includes('bindDAVECloudDatabaseIdentity(jsonRecord, databaseRow.id)'));

console.log('DAVE schedule cloud recovery regression tests passed.');
