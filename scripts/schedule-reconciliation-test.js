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
  reconcileCurrentScheduleDocuments,
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
  const areaName = Object.prototype.hasOwnProperty.call(overrides, 'areaName')
    ? overrides.areaName
    : 'Canopy B';
  return {
    id: overrides.id || 'update-1',
    projectName: overrides.projectName || 'Building 2375',
    date: overrides.date || '2026-07-13T10:00:00.000Z',
    notes: overrides.notes || 'Electrical rough-in started in Canopy B.',
    scheduleItemId: overrides.scheduleItemId || null,
    scheduleTaskName: overrides.scheduleTaskName || null,
    scheduleProjectName: overrides.scheduleProjectName || null,
    selectedAreaId: areaName ? `area-${String(areaName).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : null,
    selectedAreaName: areaName,
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
      selectedAreaId: areaName ? `area-${String(areaName).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : null,
      selectedAreaName: areaName,
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
assert.strictEqual(ahead.matches[0].matchBasis, 'semantic_fallback');

const explicitTaskLink = buildPIEScheduleReconciliation({
  scheduleItems: [schedule({ id: 'task-linked' })],
  updates: [update({
    id: 'linked-update',
    notes: 'Work observed in the field with no useful task wording.',
    scheduleItemId: 'task-linked',
    scheduleTaskName: 'Electrical rough-in',
    photo: { caption: 'General progress view.' },
  })],
  projectName: 'Building 2375',
  now,
});
assert.strictEqual(explicitTaskLink.matches.length, 1, 'An explicit task ID must link its field update.');
assert.strictEqual(explicitTaskLink.matches[0].matchBasis, 'explicit_task_id');
assert.strictEqual(explicitTaskLink.matches[0].score, 100);

const explicitBeatsNewerSemantic = buildPIEScheduleReconciliation({
  scheduleItems: [schedule({ id: 'task-precedence' })],
  updates: [
    update({
      id: 'newer-semantic',
      date: '2026-07-13T11:00:00.000Z',
      notes: 'Electrical rough-in installation work is underway in Canopy B.',
      photo: { caption: 'Electrical rough-in installation work in progress.' },
    }),
    update({
      id: 'older-explicit',
      date: '2026-07-10T11:00:00.000Z',
      scheduleItemId: 'task-precedence',
      notes: 'General field view.',
      photo: { caption: 'General field view.', actionStatus: 'Open' },
    }),
  ],
  projectName: 'Building 2375',
  now,
});
assert.strictEqual(explicitBeatsNewerSemantic.matches[0].updateId, 'older-explicit');
assert.strictEqual(explicitBeatsNewerSemantic.matches[0].matchBasis, 'explicit_task_id');

const repeatedWallPackTasks = ['A', 'B', 'C'].map(canopy => schedule({
  id: `wall-packs-canopy-${canopy.toLowerCase()}`,
  locationName: `Canopy ${canopy}`,
  taskName: 'INSTALL ELECTRICAL WALL PACKS',
  status: 'Complete',
  percentComplete: 100,
}));

const explicitCanopyAOnly = buildPIEScheduleReconciliation({
  scheduleItems: repeatedWallPackTasks,
  updates: [update({
    id: 'wall-packs-update-canopy-a',
    areaName: 'Canopy A',
    scheduleItemId: 'wall-packs-canopy-a',
    scheduleTaskName: 'INSTALL ELECTRICAL WALL PACKS',
    notes: 'INSTALL ELECTRICAL WALL PACKS is still in progress.',
    photo: { caption: 'Wall pack installation remains in progress.' },
  })],
  projectName: 'Building 2375',
  now,
});
assert.deepStrictEqual(
  explicitCanopyAOnly.matches.map(match => match.scheduleItemId),
  ['wall-packs-canopy-a'],
  'An explicit Canopy A task link must not fall back to same-named Canopy B or C tasks.',
);
assert.deepStrictEqual(
  explicitCanopyAOnly.warnings
    .filter(warning => warning.type === 'schedule_status_conflict')
    .map(warning => warning.scheduleItemId),
  ['wall-packs-canopy-a'],
  'An explicit Canopy A update must create at most the Canopy A schedule conflict.',
);

const orphanedExplicitTaskLink = buildPIEScheduleReconciliation({
  scheduleItems: repeatedWallPackTasks,
  updates: [update({
    id: 'wall-packs-update-orphaned-link',
    areaName: 'Canopy A',
    scheduleItemId: 'wall-packs-task-no-longer-present',
    scheduleTaskName: 'INSTALL ELECTRICAL WALL PACKS',
    notes: 'INSTALL ELECTRICAL WALL PACKS is still in progress.',
  })],
  projectName: 'Building 2375',
  now,
});
assert.strictEqual(
  orphanedExplicitTaskLink.matches.length,
  0,
  'An update targeting a missing explicit task ID must not fall back to any same-named task.',
);

const confirmedCanopyBOnly = buildPIEScheduleReconciliation({
  scheduleItems: repeatedWallPackTasks,
  updates: [update({
    id: 'wall-packs-update-canopy-b',
    areaName: 'Canopy B',
    scheduleTaskName: 'INSTALL ELECTRICAL WALL PACKS',
    notes: 'INSTALL ELECTRICAL WALL PACKS is still in progress.',
    photo: { caption: 'Wall pack installation remains in progress.' },
  })],
  projectName: 'Building 2375',
  now,
});
assert.deepStrictEqual(
  confirmedCanopyBOnly.matches.map(match => match.scheduleItemId),
  ['wall-packs-canopy-b'],
  'A confirmed Canopy B area must not match same-named Canopy A or C tasks.',
);

const legacyNoAreaMatch = buildPIEScheduleReconciliation({
  scheduleItems: [repeatedWallPackTasks[2]],
  updates: [update({
    id: 'wall-packs-update-without-area',
    areaName: null,
    scheduleTaskName: 'INSTALL ELECTRICAL WALL PACKS',
    notes: 'INSTALL ELECTRICAL WALL PACKS is still in progress.',
    photo: { caption: 'Wall pack installation remains in progress.' },
  })],
  projectName: 'Building 2375',
  now,
});
assert.strictEqual(
  legacyNoAreaMatch.matches.length,
  1,
  'A legacy update with no recorded area must retain task-name fallback matching.',
);
assert.strictEqual(legacyNoAreaMatch.matches[0].scheduleItemId, 'wall-packs-canopy-c');

const multiAreaWallPackUpdate = update({
  id: 'wall-packs-multi-area-update',
  areaName: null,
  scheduleTaskName: 'INSTALL ELECTRICAL WALL PACKS',
});
multiAreaWallPackUpdate.notes = '';
multiAreaWallPackUpdate.photos = [
  {
    ...multiAreaWallPackUpdate.photos[0],
    id: 'wall-packs-photo-canopy-a',
    caption: 'INSTALL ELECTRICAL WALL PACKS is complete.',
    selectedAreaId: 'area-canopy-a',
    selectedAreaName: 'Canopy A',
  },
  {
    ...multiAreaWallPackUpdate.photos[0],
    id: 'wall-packs-photo-canopy-b',
    caption: 'INSTALL ELECTRICAL WALL PACKS is still in progress.',
    selectedAreaId: 'area-canopy-b',
    selectedAreaName: 'Canopy B',
  },
];
const isolatedMultiAreaEvidence = buildPIEScheduleReconciliation({
  scheduleItems: repeatedWallPackTasks.slice(0, 2),
  updates: [multiAreaWallPackUpdate],
  projectName: 'Building 2375',
  now,
});
const isolatedMatches = Object.fromEntries(
  isolatedMultiAreaEvidence.matches.map(match => [match.scheduleItemId, match]),
);
assert.strictEqual(
  isolatedMatches['wall-packs-canopy-a'].signal,
  'complete',
  'Canopy B in-progress text must not override Canopy A completion evidence.',
);
assert.deepStrictEqual(
  isolatedMatches['wall-packs-canopy-a'].photoIds,
  ['wall-packs-photo-canopy-a'],
  'Canopy A must return only Canopy A evidence IDs.',
);
assert.strictEqual(
  isolatedMatches['wall-packs-canopy-b'].signal,
  'in_progress',
  'Canopy A completion text must not override Canopy B in-progress evidence.',
);
assert.deepStrictEqual(
  isolatedMatches['wall-packs-canopy-b'].photoIds,
  ['wall-packs-photo-canopy-b'],
  'Canopy B must return only Canopy B evidence IDs.',
);
const canopyBConflict = isolatedMultiAreaEvidence.warnings.find(warning =>
  warning.type === 'schedule_status_conflict' &&
  warning.scheduleItemId === 'wall-packs-canopy-b',
);
assert(canopyBConflict, 'Only Canopy B should conflict with its Complete schedule status.');
assert.deepStrictEqual(
  canopyBConflict.evidenceIds,
  [
    'schedule:wall-packs-canopy-b',
    'update:wall-packs-multi-area-update',
    'photo:wall-packs-photo-canopy-b',
  ],
  'The Canopy B warning must cite only Canopy B photo evidence.',
);
assert(
  !isolatedMultiAreaEvidence.warnings.some(warning =>
    warning.type === 'schedule_status_conflict' &&
    warning.scheduleItemId === 'wall-packs-canopy-a'
  ),
  'Canopy A completion evidence must not create a false conflict.',
);

for (const actionStatus of ['Closed', 'In Progress']) {
  const workflowStatusOnly = buildPIEScheduleReconciliation({
    scheduleItems: [schedule({ id: `task-${actionStatus}` })],
    updates: [update({
      id: `workflow-${actionStatus}`,
      scheduleItemId: `task-${actionStatus}`,
      notes: 'General field view.',
      photo: { caption: 'General field view.', category: 'Update', actionStatus },
    })],
    projectName: 'Building 2375',
    now,
  });
  assert.strictEqual(
    workflowStatusOnly.matches[0].signal,
    'unknown',
    `photo issue workflow status ${actionStatus} must not become schedule progress`,
  );
  assert(
    !workflowStatusOnly.warnings.some(item => item.type === 'field_progress_not_reflected'),
    `photo issue workflow status ${actionStatus} must not create a schedule progress warning`,
  );
}

const storedTaskName = buildPIEScheduleReconciliation({
  scheduleItems: [schedule()],
  updates: [update({
    notes: 'General progress documented.',
    scheduleTaskName: 'Electrical rough-in',
    photo: { caption: 'Project progress.' },
  })],
  projectName: 'Building 2375',
  now,
});
assert.strictEqual(storedTaskName.matches.length, 1, 'A stored task name must link before semantic guessing.');
assert.strictEqual(storedTaskName.matches[0].matchBasis, 'stored_task_name');

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

const pmCompletionOverridesOlderFieldUpdate = buildPIEScheduleReconciliation({
  scheduleItems: [schedule({
    id: 'pm-complete-after-field-update',
    status: 'Complete',
    percentComplete: 100,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-16T17:00:00.000Z',
  })],
  updates: [update({
    id: 'older-in-progress-update',
    date: '2026-07-16T12:00:00.000Z',
    notes: 'Electrical rough-in is still in progress and not complete.',
    scheduleItemId: 'pm-complete-after-field-update',
  })],
  projectName: 'Building 2375',
  now,
});
assert(
  !pmCompletionOverridesOlderFieldUpdate.warnings.some(item => item.type === 'schedule_status_conflict'),
  'A newer PM completion decision must override an older in-progress field update.',
);

const newerFieldUpdateReopensPmCompletion = buildPIEScheduleReconciliation({
  scheduleItems: [schedule({
    id: 'pm-complete-before-field-update',
    status: 'Complete',
    percentComplete: 100,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-16T12:00:00.000Z',
  })],
  updates: [update({
    id: 'newer-in-progress-update',
    date: '2026-07-16T17:00:00.000Z',
    notes: 'Electrical rough-in is still in progress and not complete.',
    scheduleItemId: 'pm-complete-before-field-update',
  })],
  projectName: 'Building 2375',
  now,
});
assert(
  newerFieldUpdateReopensPmCompletion.warnings.some(item => item.type === 'schedule_status_conflict'),
  'Field evidence recorded after PM completion must reopen the conflict.',
);

const importedCompletionOverridesOlderFieldUpdate = buildPIEScheduleReconciliation({
  scheduleItems: [schedule({
    id: 'import-complete-after-field-update',
    status: 'Complete',
    percentComplete: 100,
    progressSource: 'schedule_import',
    importedAt: '2026-07-16T17:00:00.000Z',
  })],
  updates: [update({
    id: 'older-field-update-before-import',
    date: '2026-07-16T12:00:00.000Z',
    notes: 'Electrical rough-in is still in progress and not complete.',
    scheduleItemId: 'import-complete-after-field-update',
  })],
  projectName: 'Building 2375',
  now,
});
assert(
  !importedCompletionOverridesOlderFieldUpdate.warnings.some(item => item.type === 'schedule_status_conflict'),
  'A newer imported schedule completion must override older in-progress field evidence.',
);

const newerFieldUpdateReopensImportedCompletion = buildPIEScheduleReconciliation({
  scheduleItems: [schedule({
    id: 'import-complete-before-field-update',
    status: 'Complete',
    percentComplete: 100,
    progressSource: 'schedule_import',
    importedAt: '2026-07-16T12:00:00.000Z',
  })],
  updates: [update({
    id: 'newer-field-update-after-import',
    date: '2026-07-16T17:00:00.000Z',
    notes: 'Electrical rough-in is still in progress and not complete.',
    scheduleItemId: 'import-complete-before-field-update',
  })],
  projectName: 'Building 2375',
  now,
});
assert(
  newerFieldUpdateReopensImportedCompletion.warnings.some(item => item.type === 'schedule_status_conflict'),
  'Field evidence recorded after imported completion must reopen the conflict.',
);

const newestReliableStoredTaskMatch = buildPIEScheduleReconciliation({
  scheduleItems: [schedule({
    id: 'newest-stored-task-match',
    status: 'Complete',
    percentComplete: 100,
  })],
  updates: [
    update({
      id: 'older-detailed-stored-task-update',
      date: '2026-07-16T12:00:00.000Z',
      notes: 'Electrical rough-in in Canopy B is still in progress and not complete.',
      scheduleTaskName: 'Electrical rough-in',
      scheduleItemId: null,
    }),
    update({
      id: 'newer-current-stored-task-update',
      date: '2026-07-16T17:00:00.000Z',
      notes: 'Work is complete.',
      scheduleTaskName: 'Electrical rough-in',
      scheduleItemId: null,
      photo: { caption: 'Work is complete.' },
    }),
  ],
  projectName: 'Building 2375',
  now,
});
assert.strictEqual(
  newestReliableStoredTaskMatch.matches[0]?.updateId,
  'newer-current-stored-task-update',
  'The newest equally reliable stored-task match must outrank a stronger stale match.',
);
assert(
  !newestReliableStoredTaskMatch.warnings.some(item => item.type === 'schedule_status_conflict'),
  'A stale same-quality update must not create a conflict after a newer complete update.',
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

const pmProgressJudgment = buildPIEScheduleReconciliation({
  scheduleItems: [schedule({
    id: 'pm-progress',
    finishDate: '2026-07-10',
    status: 'In Progress',
    percentComplete: 10,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-13T09:00:00.000Z',
    progressConfirmedBy: 'Project manager',
  })],
  updates: [],
  projectName: 'Building 2375',
  now,
});
assert(
  !pmProgressJudgment.warnings.some(item => item.type === 'scheduled_work_without_recent_evidence'),
  'A PM-entered progress percentage is authoritative and must not require separate field evidence.',
);

const legacyPmProgressJudgment = buildPIEScheduleReconciliation({
  scheduleItems: [schedule({
    id: 'legacy-pm-progress',
    finishDate: '2026-07-10',
    status: 'In Progress',
    percentComplete: 10,
  })],
  updates: [],
  projectName: 'Building 2375',
  now,
});
assert(
  !legacyPmProgressJudgment.warnings.some(item => item.type === 'scheduled_work_without_recent_evidence'),
  'A legacy saved in-progress percentage must remain trusted even before provenance fields existed.',
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

const sameFilenameByBatch = selectAuthoritativeScheduleItems({
  scheduleItems: [
    schedule({ id: 'batch-current-task', importedFrom: 'schedule.pdf', importBatchId: 'batch-current', sourceDocumentId: 'document-current-batch' }),
    schedule({ id: 'batch-old-task', importedFrom: 'schedule.pdf', importBatchId: 'batch-old', sourceDocumentId: 'document-old-batch' }),
  ],
  scheduleDocuments: [
    {
      id: 'document-current-batch', name: 'Schedule', originalFileName: 'schedule.pdf',
      uri: 'file:///current-batch.pdf', category: 'Schedules', notes: '', isCurrent: true,
      importedAt: '2026-07-18T12:00:00.000Z', importBatchId: 'batch-current',
    },
    {
      id: 'document-old-batch', name: 'Schedule', originalFileName: 'schedule.pdf',
      uri: 'file:///old-batch.pdf', category: 'Schedules', notes: '', isCurrent: false,
      importedAt: '2026-07-10T12:00:00.000Z', importBatchId: 'batch-old',
    },
  ],
});
assert.deepStrictEqual(
  sameFilenameByBatch.map(item => item.id),
  ['batch-current-task'],
  'Immutable document and batch identity must outrank a reused schedule filename.',
);

const deletedDuplicateUpload = selectAuthoritativeScheduleItems({
  scheduleItems: [
    schedule({
      id: 'current-upload-task',
      importedFrom: 'same-upload.pdf',
      importBatchId: 'current-upload-batch',
      sourceDocumentId: 'current-upload-document',
    }),
    schedule({
      id: 'orphaned-duplicate-task',
      importedFrom: 'same-upload.pdf',
      importBatchId: 'deleted-upload-batch',
      sourceDocumentId: 'deleted-upload-document',
    }),
    schedule({
      id: 'orphaned-unique-task',
      taskName: 'Unique task retained after deleting PDF only',
      importedFrom: 'same-upload.pdf',
      importBatchId: 'deleted-upload-batch',
      sourceDocumentId: 'deleted-upload-document',
    }),
  ],
  scheduleDocuments: [{
    id: 'current-upload-document', name: 'Schedule', originalFileName: 'same-upload.pdf',
    uri: 'file:///current-upload.pdf', category: 'Schedules', notes: '', isCurrent: true,
    importedAt: '2026-07-20T22:55:37.883Z', importBatchId: 'current-upload-batch',
  }],
});
assert.deepStrictEqual(
  deletedDuplicateUpload.map(item => item.id),
  ['current-upload-task', 'orphaned-unique-task'],
  'Deleting a duplicate schedule PDF must not leave a second visible copy of tasks already supplied by the current schedule.',
);

const authoritativeOrphan = selectAuthoritativeScheduleItems({
  scheduleItems: [
    schedule({
      id: 'current-import-task',
      importedFrom: 'same-upload.pdf',
      importBatchId: 'current-upload-batch',
      sourceDocumentId: 'current-upload-document',
    }),
    schedule({
      id: 'orphaned-pm-task',
      importedFrom: 'same-upload.pdf',
      importBatchId: 'deleted-upload-batch',
      sourceDocumentId: 'deleted-upload-document',
      status: 'In Progress',
      percentComplete: 45,
      progressSource: 'project_manager',
      progressConfirmedAt: '2026-07-20T23:56:29.181Z',
    }),
  ],
  scheduleDocuments: [{
    id: 'current-upload-document', name: 'Schedule', originalFileName: 'same-upload.pdf',
    uri: 'file:///current-upload.pdf', category: 'Schedules', notes: '', isCurrent: true,
    importedAt: '2026-07-20T22:55:37.883Z', importBatchId: 'current-upload-batch',
  }],
});
assert.deepStrictEqual(
  authoritativeOrphan.map(item => item.id),
  ['orphaned-pm-task'],
  'A project-manager correction must outrank an otherwise identical current-schedule import.',
);

const noCurrentItems = selectAuthoritativeScheduleItems({
  scheduleItems: [
    schedule({ id: 'inactive-upload', importedFrom: 'inactive.pdf', importBatchId: 'inactive-batch' }),
    schedule({ id: 'manual-without-source', importedFrom: null, importBatchId: null, sourceDocumentId: null }),
  ],
  scheduleDocuments: [{
    id: 'inactive-document', name: 'Inactive', originalFileName: 'inactive.pdf', uri: 'file:///inactive.pdf',
    category: 'Schedules', notes: '', isCurrent: false, importedAt: '2026-07-10T12:00:00.000Z', importBatchId: 'inactive-batch',
  }],
});
assert.deepStrictEqual(
  noCurrentItems.map(item => item.id),
  ['manual-without-source'],
  'An explicitly inactive upload must not reactivate merely because no schedule is current.',
);

const competingCurrentDocuments = [
  { id: 'older-current', name: 'Schedule', originalFileName: 'same.pdf', uri: 'file:///older.pdf', category: 'Schedules', notes: '', isCurrent: true, importedAt: '2026-07-10T12:00:00.000Z', importBatchId: 'older-batch' },
  { id: 'newer-current', name: 'Schedule', originalFileName: 'same.pdf', uri: 'file:///newer.pdf', category: 'Schedules', notes: '', isCurrent: true, importedAt: '2026-07-18T12:00:00.000Z', importBatchId: 'newer-batch' },
];
assert.deepStrictEqual(
  selectAuthoritativeScheduleItems({
    scheduleItems: [
      schedule({ id: 'older-current-task', importedFrom: 'same.pdf', importBatchId: 'older-batch', sourceDocumentId: 'older-current' }),
      schedule({ id: 'newer-current-task', importedFrom: 'same.pdf', importBatchId: 'newer-batch', sourceDocumentId: 'newer-current' }),
    ],
    scheduleDocuments: competingCurrentDocuments,
  }).map(item => item.id),
  ['newer-current-task'],
  'Only the newest marked-current schedule may drive intelligence after a merge conflict.',
);
assert.deepStrictEqual(
  reconcileCurrentScheduleDocuments(competingCurrentDocuments).filter(document => document.isCurrent).map(document => document.id),
  ['newer-current'],
  'Merged reference documents must converge to one deterministic current schedule.',
);

const misclassifiedScheduleCopies = [
  { id: 'legacy-copy', name: 'MASTER CONSTRUCTION SCHEDULE 3-WEEK LOOKAHEAD', originalFileName: 'lookahead.pdf', uri: '', category: 'Other', notes: '', isCurrent: true, importedAt: '2026-06-30T12:00:00.000Z' },
  { id: 'latest-copy', name: 'MASTER CONSTRUCTION SCHEDULE 3-WEEK LOOKAHEAD', originalFileName: 'lookahead.pdf', uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt: '2026-07-18T12:00:00.000Z' },
];
assert.deepStrictEqual(
  reconcileCurrentScheduleDocuments(misclassifiedScheduleCopies).map(document => [document.id, document.isCurrent]),
  [['legacy-copy', false], ['latest-copy', true]],
  'Schedule-like legacy copies categorized as Other must not remain concurrently Current.',
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

const latestInferredBatch = selectAuthoritativeScheduleItems({
  scheduleItems: [
    schedule({
      id: 'older-device-import',
      importedFrom: 'shared-lookahead.pdf',
      importBatchId: 'device-import-a',
      sourceDocumentId: 'device-document-a',
      importedAt: '2026-07-20T22:55:37.883Z',
    }),
    schedule({
      id: 'newer-device-import',
      importedFrom: 'shared-lookahead.pdf',
      importBatchId: 'device-import-b',
      sourceDocumentId: 'device-document-b',
      importedAt: '2026-07-20T23:56:29.181Z',
    }),
    schedule({
      id: 'manual-task',
      importedFrom: null,
      importBatchId: null,
      sourceDocumentId: null,
    }),
  ],
  scheduleDocuments: [],
});
assert.deepStrictEqual(
  latestInferredBatch.map(item => item.id),
  ['newer-device-import', 'manual-task'],
  'When a document row is unavailable, repeated device imports of the same schedule must select only the newest batch.',
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
