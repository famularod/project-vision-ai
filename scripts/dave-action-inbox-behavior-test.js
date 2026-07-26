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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: absolutePath,
  }).outputText;
  const moduleUnderTest = { exports: {} };
  moduleCache.set(absolutePath, moduleUnderTest);
  new Function('require', 'module', 'exports', compiled)(
    request => {
      if (!request.startsWith('.')) return require(request);
      const resolved = path.resolve(path.dirname(absolutePath), request);
      const withExtension = fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : resolved;
      return loadTypeScriptModule(path.relative(root, withExtension));
    },
    moduleUnderTest,
    moduleUnderTest.exports,
  );
  return moduleUnderTest.exports;
}

const { buildDAVEActionInbox } = loadTypeScriptModule('services/DAVEActionInbox.ts');

function schedule(overrides = {}) {
  return {
    id: overrides.id || 'schedule-1',
    projectName: 'Hospital',
    locationName: 'Level 2',
    taskName: overrides.taskName || 'Install AHU-7',
    startDate: '',
    finishDate: overrides.finishDate ?? '',
    milestone: '',
    owner: 'Mechanical contractor',
    contractor: '',
    percentComplete: overrides.percentComplete ?? 0,
    priority: overrides.priority || 'Medium',
    status: overrides.status || 'Not Started',
    notes: '',
    completionVerification: overrides.completionVerification || null,
    createdAt: '2026-07-01T12:00:00.000Z',
  };
}

function update(overrides = {}) {
  return {
    id: 'update-undated',
    projectName: 'Hospital',
    date: '2026-07-15T12:00:00.000Z',
    notes: '',
    scheduleItemId: overrides.scheduleItemId || null,
    recipients: { contactIds: [] },
    photos: [{
      id: 'photo-undated',
      uri: 'file:///photo.jpg',
      caption: 'Missing access panel.',
      category: 'Open Issue',
      actionRequired: 'Install access panel',
      actionOwner: 'Mechanical contractor',
      actionDueDate: '',
      actionStatus: 'Open',
    }],
  };
}

const completionVerification = {
  status: 'reported_complete',
  reportedAt: '2026-07-15T12:00:00.000Z',
  reportedBy: 'Contractor',
  priorScheduleStatus: 'In Progress',
  priorPercentComplete: 60,
  verifiedAt: null,
  verifiedBy: null,
  verificationNote: null,
  evidence: [{ summary: 'Email says AHU-7 installation is complete.' }],
};

const inbox = buildDAVEActionInbox({
  scheduleItems: [
    schedule({ id: 'reported', completionVerification, finishDate: '07/18/2026' }),
    schedule({ id: 'overdue', taskName: 'Controls startup', finishDate: '07/10/2026', priority: 'High' }),
    schedule({ id: 'pm-progress', taskName: 'Grout walls', finishDate: '07/01/2026', priority: 'High', status: 'In Progress', percentComplete: 10 }),
    schedule({ id: 'undated-high', taskName: 'Resolve TAB issue', priority: 'High' }),
  ],
  updates: [update({ scheduleItemId: 'reported' })],
  reconciliationWarnings: [{
    id: 'reported-conflict',
    type: 'schedule_status_conflict',
    scheduleItemId: 'reported',
    updateId: 'update-undated',
    projectName: 'Hospital',
    areaName: 'Level 2',
    taskName: 'Install AHU-7',
    title: 'Field evidence conflicts with schedule status',
    summary: 'Completion evidence conflicts with the field record.',
    severity: 'high',
    confidence: 'high',
    suggestedAction: 'Verify the actual field condition.',
    evidenceIds: ['update-undated'],
  }],
  dependencyNodes: [{
      scheduleItemId: 'reported',
      activityId: 'A200',
      taskName: 'Install AHU-7',
      predecessorItemIds: [],
      unresolvedPredecessors: ['A100'],
      blockingPredecessorIds: [],
      blocked: false,
      blockedReason: 'One or more predecessor references could not be matched.',
      cycle: false,
    }, {
      scheduleItemId: 'undated-high',
      activityId: 'A300',
      taskName: 'Resolve TAB issue',
      predecessorItemIds: ['reported'],
      unresolvedPredecessors: [],
      blockingPredecessorIds: ['reported'],
      blocked: true,
      blockedReason: '1 predecessor must finish first.',
      cycle: false,
    }],
  now: new Date('2026-07-16T12:00:00.000Z'),
});

assert(
  inbox.items.some(item => item.scheduleItemId === 'reported' && item.requiresVerification),
  'reported completion must remain visibly verification-gated after aggregation',
);
assert(inbox.items.some(item => item.kind === 'field_action' && item.dueDate === null), 'undated field actions must remain visible');
assert(inbox.items.some(item => item.kind === 'schedule_deadline' && item.scheduleItemId === 'overdue'));
const pmProgress = inbox.items.find(item => item.scheduleItemId === 'pm-progress');
assert(pmProgress, 'PM-entered progress still requires overdue recovery follow-through.');
assert.match(pmProgress.requestedAction, /preserving the project manager progress judgment/i);
assert(!/confirm current field status/i.test(pmProgress.requestedAction));
assert(inbox.items.some(item => item.kind === 'dependency_blocker'));
assert.strictEqual(inbox.items[0].priority, 'critical', 'critical/overdue work must sort ahead of routine actions');
assert.strictEqual(inbox.verificationCount, 1);
assert.strictEqual(inbox.undatedActionCount, 1);
assert.strictEqual(new Set(inbox.items.map(item => item.id)).size, inbox.items.length, 'stable IDs must deduplicate the inbox');
assert.strictEqual(
  inbox.items.filter(item => item.scheduleItemId === 'reported' && item.kind !== 'field_action').length,
  1,
  'verification, deadline, conflict, and dependency reasons for one task must be one responsibility',
);
assert(
  inbox.items.some(item => item.scheduleItemId === 'reported' && item.kind === 'field_action'),
  'a distinct photo responsibility must remain independently actionable',
);
assert(
  inbox.items.find(item => item.id === 'dave-action:schedule:reported').requestedAction.includes('Verify'),
  'aggregated schedule responsibility must preserve its verification action',
);

const closed = buildDAVEActionInbox({
  scheduleItems: [schedule({ id: 'complete', status: 'Complete', percentComplete: 100, finishDate: '2026-07-01' })],
  updates: [{ ...update(), photos: [{ ...update().photos[0], actionStatus: 'Closed' }] }],
  now: new Date('2026-07-16T12:00:00.000Z'),
});
assert.strictEqual(closed.items.length, 0, 'completed tasks and closed actions must leave the inbox');

console.log('DAVE action-inbox behavior tests passed.');
