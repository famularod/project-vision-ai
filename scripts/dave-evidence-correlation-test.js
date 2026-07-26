#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();

function loadTs(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  if (cache.has(absolutePath)) return cache.get(absolutePath).exports;
  const moduleUnderTest = { exports: {} };
  cache.set(absolutePath, moduleUnderTest);
  const compiled = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: absolutePath,
  }).outputText;
  const localRequire = specifier => {
    if (!specifier.startsWith('.')) return require(specifier);
    const base = path.resolve(path.dirname(absolutePath), specifier);
    const resolved = [base, `${base}.ts`, path.join(base, 'index.ts')].find(candidate => fs.existsSync(candidate));
    if (!resolved) throw new Error(`Cannot resolve ${specifier}`);
    return loadTs(path.relative(root, resolved));
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, moduleUnderTest, moduleUnderTest.exports);
  return moduleUnderTest.exports;
}

const { buildDAVEEvidenceCorrelations } = loadTs('services/DAVEEvidenceCorrelation.ts');

function task(id, overrides = {}) {
  return {
    id,
    scheduleProjectName: 'Alpha',
    projectName: 'Alpha',
    locationName: 'Pump House',
    taskName: id,
    startDate: '2026-07-01',
    finishDate: '2026-07-20',
    milestone: '',
    owner: 'Trade partner',
    contractor: 'Trade partner',
    percentComplete: 40,
    priority: 'High',
    status: 'In Progress',
    notes: '',
    createdAt: '2026-07-01T12:00:00.000Z',
    completionVerification: null,
    ...overrides,
  };
}

function verification(status, evidence) {
  return {
    status,
    reportedAt: '2026-07-16T12:00:00.000Z',
    reportedBy: 'Foreman',
    priorScheduleStatus: 'In Progress',
    priorPercentComplete: 40,
    verifiedAt: status === 'pm_verified' ? '2026-07-16T15:00:00.000Z' : null,
    verifiedBy: status === 'pm_verified' ? 'Project manager' : null,
    verificationNote: null,
    evidence,
  };
}

function evidence(id, kind, summary) {
  return { id, kind, sourceRecordId: id, sourceName: 'Source', summary, recordedAt: '2026-07-16T12:00:00.000Z' };
}

function update(id, taskId, notes, photos = [], date = '2026-07-16T13:00:00.000Z', overrides = {}) {
  return {
    id,
    projectName: 'Alpha',
    date,
    photos,
    notes,
    recipients: { contactIds: [] },
    scheduleItemId: taskId,
    scheduleTaskName: taskId,
    selectedAreaName: 'Pump House',
    status: 'sent',
    ...overrides,
  };
}

function photo(id, progress = 'supported') {
  return {
    id,
    uri: `file:///${id}.jpg`,
    caption: 'Equipment installation is visible.',
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    selectedAreaName: 'Pump House',
    photoIntelligence: {
      status: 'analysis_complete',
      title: 'Comparison',
      summary: 'Installation advanced.',
      visibleChange: 'Additional equipment is visible.',
      location: 'Pump House',
      comparisonConfidence: 'high',
      comparability: 'strong',
      captureLimitations: [],
      projectProgress: progress,
      repeatPhotoGuidance: null,
      authorityMessage: 'PM verification required.',
      currentObservation: 'Additional installed equipment is visible.',
      priorEvidenceId: 'prior-photo-evidence',
      provenance: 'visual_only',
      updatedAt: '2026-07-16T13:01:00.000Z',
    },
  };
}

const reportedTask = task('reported', {
  completionVerification: verification('reported_complete', [
    evidence('email-1', 'email', 'The work is complete.'),
  ]),
});
const reported = buildDAVEEvidenceCorrelations({
  scheduleItems: [reportedTask],
  updates: [update('update-reported', 'reported', '', [photo('photo-reported')])],
  now: '2026-07-16T18:00:00.000Z',
});
assert.strictEqual(reported.tasks[0].conclusion, 'completion_reported');
assert.strictEqual(reported.tasks[0].needsVerification, true);
assert.match(reported.tasks[0].explanation, /does not independently prove completion/i);
assert.strictEqual(reported.multiSourceTaskCount, 1);

const conflict = buildDAVEEvidenceCorrelations({
  scheduleItems: [reportedTask],
  updates: [update('update-conflict', 'reported', 'Work remains unfinished.')],
});
assert.strictEqual(conflict.tasks[0].conclusion, 'conflicting_evidence');
assert.strictEqual(conflict.tasks[0].confidence, 'high');
assert.strictEqual(conflict.tasks[0].needsVerification, true);
assert.match(conflict.tasks[0].explanation, /one source reports completion/i);

const externalConflictTask = task('external-conflict', {
  completionVerification: verification('conflicting_evidence', [
    evidence('email-conflict', 'email', 'The work is complete.'),
  ]),
});
const externalConflict = buildDAVEEvidenceCorrelations({ scheduleItems: [externalConflictTask] });
assert.strictEqual(externalConflict.tasks[0].conclusion, 'conflicting_evidence');
assert.strictEqual(externalConflict.tasks[0].needsVerification, true);

const verifiedTask = task('verified', {
  status: 'Complete',
  percentComplete: 100,
  completionVerification: verification('pm_verified', [
    evidence('email-2', 'email', 'The work is complete.'),
    evidence('pm-1', 'pm_confirmation', 'I inspected the completed work.'),
  ]),
});
const verified = buildDAVEEvidenceCorrelations({ scheduleItems: [verifiedTask] });
assert.strictEqual(verified.tasks[0].conclusion, 'verified_complete');
assert.strictEqual(verified.tasks[0].needsVerification, false);
assert.strictEqual(verified.tasks[0].confidence, 'high');

const pmPercent = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('pm-percent', {
    status: 'In Progress',
    percentComplete: 10,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-16T15:00:00.000Z',
    progressConfirmedBy: 'David',
  })],
});
assert.strictEqual(pmPercent.tasks[0].conclusion, 'schedule_only');
assert.strictEqual(pmPercent.tasks[0].needsVerification, false);
assert.strictEqual(pmPercent.tasks[0].confidence, 'high');
assert.match(pmPercent.tasks[0].explanation, /professional judgment is the current progress evidence/i);
assert(!/no connected.*evidence/i.test(pmPercent.tasks[0].explanation));

const pmSaidComplete = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('pm-complete', {
    status: 'Complete',
    percentComplete: 100,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-16T15:00:00.000Z',
    progressConfirmedBy: 'David',
  })],
});
assert.strictEqual(pmSaidComplete.tasks[0].conclusion, 'verified_complete');
assert.strictEqual(pmSaidComplete.tasks[0].needsVerification, false);
assert.match(pmSaidComplete.tasks[0].explanation, /authoritative completion evidence/i);

const pmCompletionAfterFieldProgress = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('pm-complete-after-progress', {
    status: 'Complete',
    percentComplete: 100,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-16T15:00:00.000Z',
    progressConfirmedBy: 'David',
  })],
  updates: [update(
    'older-progress',
    'pm-complete-after-progress',
    'The work is still in progress.',
    [],
    '2026-07-16T13:00:00.000Z',
  )],
});
assert.strictEqual(pmCompletionAfterFieldProgress.tasks[0].conclusion, 'verified_complete');
assert.strictEqual(pmCompletionAfterFieldProgress.tasks[0].needsVerification, false);

const fieldProgressAfterPmCompletion = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('progress-after-pm-complete', {
    status: 'Complete',
    percentComplete: 100,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-16T12:00:00.000Z',
    progressConfirmedBy: 'David',
  })],
  updates: [update(
    'newer-progress',
    'progress-after-pm-complete',
    'The work is still in progress.',
    [],
    '2026-07-16T15:00:00.000Z',
  )],
});
assert.strictEqual(fieldProgressAfterPmCompletion.tasks[0].conclusion, 'conflicting_evidence');
assert.strictEqual(fieldProgressAfterPmCompletion.tasks[0].needsVerification, true);
assert.match(fieldProgressAfterPmCompletion.tasks[0].explanation, /newer field evidence/i);

const pmFieldStatement = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('pm-field-statement', { status: 'In Progress', percentComplete: 80 })],
  updates: [update('pm-done-update', 'pm-field-statement', 'The work was completed.')],
});
assert.strictEqual(pmFieldStatement.tasks[0].conclusion, 'completion_reported');
assert.strictEqual(pmFieldStatement.tasks[0].needsVerification, true);

const fieldQuestion = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('field-question', { status: 'In Progress', percentComplete: 80 })],
  updates: [update('field-question-update', 'field-question', 'Is the work complete?')],
});
assert.notStrictEqual(fieldQuestion.tasks[0].conclusion, 'verified_complete');
assert.notStrictEqual(fieldQuestion.tasks[0].conclusion, 'completion_reported');

const pmFutureStatement = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('pm-future-statement', { status: 'In Progress', percentComplete: 80 })],
  updates: [update('pm-future-update', 'pm-future-statement', 'The work will be completed tomorrow.')],
});
assert.notStrictEqual(pmFutureStatement.tasks[0].conclusion, 'verified_complete');

const workflowTimestampAfterPm = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('workflow-after-pm', {
    status: 'Complete',
    percentComplete: 100,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-16T12:00:00.000Z',
    progressConfirmedBy: 'David',
  })],
  updates: [update(
    'workflow-after-pm-update',
    'workflow-after-pm',
    'The work is still in progress.',
    [],
    '2026-07-15T12:00:00.000Z',
    { workflowTimestamps: { sendResolvedAt: '2026-07-16T15:00:00.000Z' } },
  )],
});
assert.strictEqual(workflowTimestampAfterPm.tasks[0].conclusion, 'conflicting_evidence',
  'The actual send timestamp, not a stale display date, must determine evidence recency.');

const oldPhotoWithNewAnalysis = photo('old-photo-new-analysis');
oldPhotoWithNewAnalysis.locationCapturedAt = '2026-07-16T10:00:00.000Z';
oldPhotoWithNewAnalysis.photoIntelligence.updatedAt = '2026-07-16T16:00:00.000Z';
const oldPhotoAfterPmAnalysis = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('old-photo-analysis', {
    status: 'Complete',
    percentComplete: 100,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-16T12:00:00.000Z',
    progressConfirmedBy: 'David',
  })],
  updates: [update('old-photo-analysis-update', 'old-photo-analysis', '', [oldPhotoWithNewAnalysis])],
});
assert.strictEqual(oldPhotoAfterPmAnalysis.tasks[0].conclusion, 'verified_complete',
  'A later analysis timestamp must not make an older captured photo supersede PM authority.');

const unverifiedScheduleComplete = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('schedule-complete', { status: 'Complete', percentComplete: 100 })],
});
assert.strictEqual(unverifiedScheduleComplete.tasks[0].conclusion, 'schedule_only');
assert.strictEqual(unverifiedScheduleComplete.tasks[0].needsVerification, false);
assert.match(unverifiedScheduleComplete.tasks[0].explanation, /current schedule records this task complete/i);

const importedCompletionAfterOlderFieldProgress = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('imported-complete-after-progress', {
    status: 'Complete',
    percentComplete: 100,
    importedAt: '2026-07-16T15:00:00.000Z',
  })],
  updates: [update(
    'older-import-progress',
    'imported-complete-after-progress',
    'The work is still in progress.',
    [],
    '2026-07-16T13:00:00.000Z',
  )],
});
assert.strictEqual(importedCompletionAfterOlderFieldProgress.tasks[0].conclusion, 'schedule_only');
assert.strictEqual(importedCompletionAfterOlderFieldProgress.tasks[0].needsVerification, false);

const fieldProgressAfterImportedCompletion = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('progress-after-imported-complete', {
    status: 'Complete',
    percentComplete: 100,
    importedAt: '2026-07-16T12:00:00.000Z',
  })],
  updates: [update(
    'newer-import-progress',
    'progress-after-imported-complete',
    'The work is still in progress.',
    [],
    '2026-07-16T15:00:00.000Z',
  )],
});
assert.strictEqual(fieldProgressAfterImportedCompletion.tasks[0].conclusion, 'conflicting_evidence');
assert.strictEqual(fieldProgressAfterImportedCompletion.tasks[0].needsVerification, true);
assert.match(fieldProgressAfterImportedCompletion.tasks[0].explanation, /newer field evidence/i);

const visibleAgainstNotStarted = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('visual-task', { status: 'Not Started', percentComplete: 0 })],
  updates: [update('visual-update', 'visual-task', '', [photo('visual-photo')])],
});
assert.strictEqual(visibleAgainstNotStarted.tasks[0].conclusion, 'conflicting_evidence');
assert.match(visibleAgainstNotStarted.tasks[0].contradiction, /schedule still says not started/i);

const blockedVisual = photo('blocked-visual-photo');
blockedVisual.photoIntelligence.comparability = 'not_comparable';
blockedVisual.photoIntelligence.projectProgress = 'supported';
const blockedVisualAgainstNotStarted = buildDAVEEvidenceCorrelations({
  scheduleItems: [task('blocked-visual-task', { status: 'Not Started', percentComplete: 0 })],
  updates: [update('blocked-visual-update', 'blocked-visual-task', '', [blockedVisual])],
});
assert.notStrictEqual(
  blockedVisualAgainstNotStarted.tasks[0].conclusion,
  'conflicting_evidence',
  'a not-comparable photo must not contradict schedule status even when legacy data says projectProgress=supported',
);
assert.notStrictEqual(
  blockedVisualAgainstNotStarted.tasks[0].conclusion,
  'progress_observed',
);

const duplicateNameTasks = [
  task('first', { taskName: 'Install Pump', locationName: 'Pump House' }),
  task('second', { taskName: 'Install Pump', locationName: 'Pump House' }),
];
const ambiguousUpdate = { ...update('ambiguous', null, 'Installation is underway.'), scheduleItemId: null, scheduleTaskName: 'Install Pump' };
const ambiguous = buildDAVEEvidenceCorrelations({ scheduleItems: duplicateNameTasks, updates: [ambiguousUpdate] });
assert(ambiguous.tasks.every(item => item.evidence.length === 1), 'DAVE must not attach ambiguous evidence to multiple tasks.');

console.log('PASS DAVE evidence correlation');
