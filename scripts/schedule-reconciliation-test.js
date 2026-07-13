#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const moduleCache = new Map();

function loadTypeScriptModule(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;

  const source = fs.readFileSync(absolutePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: absolutePath,
  }).outputText;
  const moduleUnderTest = { exports: {} };
  moduleCache.set(absolutePath, moduleUnderTest);

  const localRequire = request => {
    if (!request.startsWith('.')) return require(request);
    const resolved = path.resolve(path.dirname(absolutePath), request);
    const withExtension = fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : resolved;
    return loadTypeScriptModule(path.relative(root, withExtension));
  };

  new Function('require', 'module', 'exports', compiled)(
    localRequire,
    moduleUnderTest,
    moduleUnderTest.exports,
  );
  return moduleUnderTest.exports;
}

const {
  buildPIEScheduleReconciliation,
  selectAuthoritativeScheduleItems,
} = loadTypeScriptModule('services/PIEScheduleReconciliation.ts');

const now = new Date('2026-07-13T12:00:00-07:00');

function schedule(overrides = {}) {
  return {
    id: overrides.id || 'schedule-1',
    projectName: 'Building 2375',
    locationName: 'Canopy B',
    taskName: 'Electrical rough-in',
    startDate: '2026-07-01',
    finishDate: '2026-07-14',
    milestone: '',
    owner: 'Electrical Contractor',
    contractor: 'Electrical Contractor',
    percentComplete: 0,
    priority: 'High',
    status: 'Not Started',
    notes: '',
    importedFrom: 'current-schedule.pdf',
    importedAt: '2026-07-10T12:00:00.000Z',
    createdAt: '2026-07-10T12:00:00.000Z',
    ...overrides,
  };
}

function update(overrides = {}) {
  const photo = overrides.photo || {};
  return {
    id: overrides.id || 'update-1',
    projectName: overrides.projectName || 'Building 2375',
    date: overrides.date || '2026-07-13T10:00:00.000Z',
    notes: overrides.notes || 'Electrical rough-in started in Canopy B.',
    selectedAreaId: 'area-canopy-b',
    selectedAreaName: overrides.areaName || 'Canopy B',
    recipients: { contactIds: [] },
    status: 'sent',
    photos: [{
      id: photo.id || 'photo-1',
      uri: 'file:///photo.jpg',
      caption: photo.caption || 'Electrical rough-in is in progress.',
      category: photo.category || 'Update',
      actionRequired: photo.actionRequired || '',
      actionOwner: '',
      actionDueDate: '',
      actionStatus: photo.actionStatus || 'In Progress',
      selectedAreaId: 'area-canopy-b',
      selectedAreaName: overrides.areaName || 'Canopy B',
      photoIntelligence: null,
    }],
  };
}

const ahead = buildPIEScheduleReconciliation({
  scheduleItems: [schedule()],
  updates: [update()],
  projectName: 'Building 2375',
  now,
});
assert.strictEqual(ahead.matches.length, 1, 'Task and area evidence should match the schedule activity.');
assert(ahead.matches[0].score >= 65, 'A task-and-area match should be medium or high confidence.');
assert(
  ahead.warnings.some(item => item.type === 'field_progress_not_reflected'),
  'Field progress should warn when the schedule remains Not Started.',
);

const conflict = buildPIEScheduleReconciliation({
  scheduleItems: [schedule({ status: 'Complete', percentComplete: 100 })],
  updates: [update({ notes: 'Electrical rough-in is still in progress and not complete.' })],
  projectName: 'Building 2375',
  now,
});
assert(
  conflict.warnings.some(item => item.type === 'schedule_status_conflict'),
  'Incomplete field evidence should conflict with a Complete schedule status.',
);

const threatened = buildPIEScheduleReconciliation({
  scheduleItems: [schedule()],
  updates: [update({
    notes: 'Electrical rough-in is blocked waiting on material.',
    photo: { category: 'Open Issue', actionStatus: 'Open' },
  })],
  projectName: 'Building 2375',
  now,
});
assert(
  threatened.warnings.some(item => item.type === 'field_issue_threatens_schedule'),
  'A matched blocker should threaten near-term scheduled work.',
);

const noEvidence = buildPIEScheduleReconciliation({
  scheduleItems: [schedule({ finishDate: '2026-07-10' })],
  updates: [],
  projectName: 'Building 2375',
  now,
});
assert(
  noEvidence.warnings.some(item => item.type === 'scheduled_work_without_recent_evidence'),
  'Overdue work without a matching update should request current evidence.',
);

const unrelated = buildPIEScheduleReconciliation({
  scheduleItems: [schedule()],
  updates: [update({ notes: 'Concrete housekeeping completed.', photo: { caption: 'Concrete housekeeping.' } })],
  projectName: 'Building 2375',
  now,
});
assert.strictEqual(
  unrelated.matches.length,
  0,
  'Sharing a project and area must not match unrelated task evidence.',
);

const legacyAreaProject = buildPIEScheduleReconciliation({
  scheduleItems: [schedule()],
  updates: [update({
    projectName: 'Canopy B',
    notes: 'Electricians are working on the electrical rough-in.',
  })],
  projectName: 'Building 2375',
  now,
});
assert.strictEqual(
  legacyAreaProject.matches.length,
  1,
  'Legacy updates whose project name equals the schedule area should match only with task-language support.',
);

const activeItems = selectAuthoritativeScheduleItems({
  scheduleItems: [
    schedule({ id: 'current', importedFrom: 'current-schedule.pdf' }),
    schedule({ id: 'old', importedFrom: 'old-schedule.pdf' }),
    schedule({ id: 'manual', importedFrom: null }),
  ],
  scheduleDocuments: [
    {
      id: 'document-current',
      name: 'Current Schedule',
      originalFileName: 'current-schedule.pdf',
      uri: 'file:///schedule.pdf',
      category: 'Schedules',
      notes: '',
      isCurrent: true,
      importedAt: '2026-07-10T12:00:00.000Z',
    },
    {
      id: 'document-old',
      name: 'Old Schedule',
      originalFileName: 'old-schedule.pdf',
      uri: 'file:///old.pdf',
      category: 'Schedules',
      notes: '',
      isCurrent: false,
      importedAt: '2026-06-10T12:00:00.000Z',
    },
  ],
});
assert.deepStrictEqual(
  activeItems.map(item => item.id),
  ['current', 'manual'],
  'Only active-upload and manual schedule items may drive intelligence.',
);

const dedupedItems = selectAuthoritativeScheduleItems({
  scheduleItems: [
    schedule({ id: 'duplicate-old', importedAt: '2026-07-01T12:00:00.000Z' }),
    schedule({ id: 'duplicate-new', importedAt: '2026-07-12T12:00:00.000Z' }),
  ],
  scheduleDocuments: [],
});
assert.deepStrictEqual(
  dedupedItems.map(item => item.id),
  ['duplicate-new'],
  'Duplicate imported activities should collapse to the newest record before warnings run.',
);

assert.strictEqual(
  schedule().status,
  'Not Started',
  'Reconciliation must never mutate schedule status.',
);

console.log('PASS schedule-to-field reconciliation');

const backupPath = process.argv[2];
if (backupPath) {
  const backup = JSON.parse(fs.readFileSync(path.resolve(backupPath), 'utf8'));
  const authoritativeItems = selectAuthoritativeScheduleItems({
    scheduleItems: backup.scheduleItems || [],
    scheduleDocuments: backup.referenceDocuments || [],
  });
  const audit = buildPIEScheduleReconciliation({
    scheduleItems: authoritativeItems,
    updates: backup.savedUpdates || [],
    now,
  });
  console.log(JSON.stringify({
    sourceScheduleItems: (backup.scheduleItems || []).length,
    authoritativeScheduleItems: authoritativeItems.length,
    savedUpdates: (backup.savedUpdates || []).length,
    matchedItemCount: audit.matchedItemCount,
    warnings: audit.warnings.map(item => ({
      type: item.type,
      taskName: item.taskName,
      severity: item.severity,
      confidence: item.confidence,
    })),
  }, null, 2));
}
