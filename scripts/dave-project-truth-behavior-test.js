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
  const compiled = ts.transpileModule(
    fs.readFileSync(absolutePath, 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
      fileName: absolutePath,
    },
  ).outputText;
  const localRequire = specifier => {
    if (!specifier.startsWith('.')) return require(specifier);
    const base = path.resolve(path.dirname(absolutePath), specifier);
    const resolved = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]
      .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) throw new Error(`Cannot resolve ${specifier} from ${absolutePath}`);
    return loadTs(path.relative(root, resolved));
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
    localRequire,
    moduleUnderTest,
    moduleUnderTest.exports,
    absolutePath,
    path.dirname(absolutePath),
  );
  return moduleUnderTest.exports;
}

const { buildDAVEProjectTruth } = loadTs('services/DAVEProjectTruth.ts');
const now = '2026-07-16T12:00:00.000Z';

function verification(status) {
  return {
    status,
    reportedAt: '2026-07-15T12:00:00.000Z',
    reportedBy: 'Field report',
    priorScheduleStatus: 'In Progress',
    priorPercentComplete: 80,
    verifiedAt: status === 'pm_verified' ? '2026-07-15T18:00:00.000Z' : null,
    verifiedBy: status === 'pm_verified' ? 'Project manager' : null,
    verificationNote: status === 'pm_verified' ? 'Observed in the field.' : null,
    evidence: [],
  };
}

function task(id, overrides = {}) {
  return {
    id,
    scheduleProjectName: 'Alpha',
    projectName: 'Alpha',
    locationName: 'Mechanical Room',
    taskName: id.replace(/-/g, ' '),
    startDate: '2026-07-01',
    finishDate: '2026-07-10',
    milestone: '',
    owner: 'Trade partner',
    contractor: 'Trade partner',
    percentComplete: 50,
    priority: 'High',
    status: 'In Progress',
    notes: '',
    createdAt: '2026-07-01T12:00:00.000Z',
    completionVerification: null,
    ...overrides,
  };
}

function update(id, projectName, photo) {
  return {
    id,
    projectName,
    date: '2026-07-15T12:00:00.000Z',
    photos: photo ? [photo] : [],
    notes: `${projectName} field observation`,
    recipients: { contactIds: [] },
    selectedAreaName: 'Mechanical Room',
    status: 'sent',
  };
}

function photo(id) {
  return {
    id,
    uri: `file:///${id}.jpg`,
    caption: 'Visible installed equipment.',
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    selectedAreaName: 'Mechanical Room',
    photoIntelligence: {
      status: 'analysis_complete',
      title: 'Photo comparison',
      summary: 'Visible equipment is present.',
      visibleChange: 'Visible equipment position changed.',
      location: 'Mechanical Room',
      comparisonConfidence: 'high',
      comparability: 'strong',
      captureLimitations: ['The equipment label is partly obscured.'],
      projectProgress: 'unsupported',
      repeatPhotoGuidance: 'Repeat from the same marked position.',
      authorityMessage: 'Project manager verification is required.',
      currentObservation: 'Visible equipment is present.',
      changedFromPrior: 'Equipment position appears different.',
      priorEvidenceId: 'prior-photo-alpha',
      provenance: 'visual_only',
      updatedAt: '2026-07-15T12:01:00.000Z',
    },
  };
}

const truth = buildDAVEProjectTruth({
  projectId: 'project-alpha',
  projectName: 'Alpha',
  now,
  updates: [
    update('update-alpha', 'Alpha', photo('photo-alpha')),
    update('update-beta', 'Beta', photo('photo-beta')),
  ],
  scheduleItems: [
    task('reported-overdue', { completionVerification: verification('reported_complete') }),
    task('plain-overdue'),
    task('unsupported-complete-a', { status: 'Complete', percentComplete: 100 }),
    task('unsupported-complete-b', { status: 'Complete', percentComplete: 100 }),
    task('pm-verified', {
      status: 'Complete',
      percentComplete: 100,
      completionVerification: verification('pm_verified'),
    }),
    task('beta-task', {
      scheduleProjectName: 'Beta',
      projectName: 'Beta',
      locationName: 'Beta Area',
    }),
  ],
});

const byTask = id => truth.schedule.find(item => item.taskId === id);
assert.strictEqual(byTask('reported-overdue').urgency, 'overdue');
assert.strictEqual(byTask('reported-overdue').completionState, 'reported_complete');
assert.strictEqual(byTask('reported-overdue').needsVerification, true);
const overdueRequest = truth.verificationQueue.find(item => item.subjectId === 'reported-overdue');
assert.strictEqual(overdueRequest.priority, 'high');
assert.strictEqual(truth.verificationQueue[0].subjectId, 'reported-overdue');

assert.strictEqual(byTask('unsupported-complete-a').completionState, 'scheduled');
assert.strictEqual(byTask('unsupported-complete-a').needsVerification, false);
assert.strictEqual(byTask('unsupported-complete-a').contradiction, null);
assert(!truth.verificationQueue.some(item => item.subjectId === 'unsupported-complete-a'));

assert.strictEqual(byTask('pm-verified').completionState, 'pm_verified');
assert.strictEqual(byTask('pm-verified').needsVerification, false);
assert(!truth.verificationQueue.some(item => item.subjectId === 'pm-verified'));

assert(!truth.schedule.some(item => item.taskId === 'beta-task'));
assert(!truth.photoComparisons.some(item => item.photoId === 'photo-beta'));
assert(!truth.evidence.records.some(item =>
  item.sourceRecordId === 'update-beta' || item.sourceRecordId === 'photo-beta',
));
assert.strictEqual(truth.briefing.nextActions.length, 3);

const unsupportedPhoto = truth.photoComparisons.find(item => item.photoId === 'photo-alpha');
assert.strictEqual(unsupportedPhoto.progressClaim, 'unsupported');
assert.strictEqual(unsupportedPhoto.comparablePriorAvailable, true);
assert.strictEqual(unsupportedPhoto.needsVerification, true);
assert(truth.verificationQueue.some(item =>
  item.subjectType === 'photo' && item.subjectId === 'photo-alpha',
));

const notComparableInput = photo('photo-not-comparable');
notComparableInput.photoIntelligence.comparability = 'not_comparable';
notComparableInput.photoIntelligence.projectProgress = 'supported';
const notComparableTruth = buildDAVEProjectTruth({
  projectId: 'project-alpha',
  projectName: 'Alpha',
  now,
  updates: [update('update-not-comparable', 'Alpha', notComparableInput)],
  scheduleItems: [],
});
const notComparable = notComparableTruth.photoComparisons[0];
assert.strictEqual(notComparable.comparablePriorAvailable, false);
assert.strictEqual(notComparable.changeFromPrior, null);
assert.strictEqual(notComparable.progressClaim, 'unable_to_determine');
assert(notComparable.limitations.some(item => /not sufficiently comparable/i.test(item)));

console.log('PASS DAVE Project Truth behavior');
