#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'services/DAVEFollowThroughPlanner.ts'), 'utf8');
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
  parseDAVEFollowThroughReviewStates,
  planDAVEFollowThrough,
  reviewedDAVEFollowThroughStates,
} = moduleUnderTest.exports;

function item(overrides = {}) {
  return {
    id: overrides.id || 'action-1',
    kind: overrides.kind || 'field_action',
    priority: overrides.priority || 'high',
    projectName: 'Hospital',
    areaName: 'Level 2',
    title: overrides.title || 'Install access panel',
    summary: overrides.summary || 'Open with no due date.',
    requestedAction: 'Confirm owner and date.',
    owner: overrides.owner ?? null,
    dueDate: overrides.dueDate ?? null,
    dueDays: overrides.dueDays ?? null,
    scheduleItemId: null,
    updateId: 'update-1',
    photoId: 'photo-1',
    requiresVerification: overrides.requiresVerification || false,
  };
}

const now = new Date('2026-07-16T12:30:00.000Z');
const first = planDAVEFollowThrough({
  items: [
    item({ id: 'critical', priority: 'critical' }),
    item({ id: 'verify', requiresVerification: true }),
    item({ id: 'medium', priority: 'medium' }),
  ],
  now,
});
assert.strictEqual(first.reminders.length, 0, 'new responsibilities are visible in the inbox but are not falsely overdue for re-review');
assert.strictEqual(first.reviewStates.length, 3);

const beforeCriticalDue = planDAVEFollowThrough({
  items: first.reviewStates.map(review => first.reviewStates.find(candidate => candidate.itemId === review.itemId) && [
    item({ id: 'critical', priority: 'critical' }),
    item({ id: 'verify', requiresVerification: true }),
    item({ id: 'medium', priority: 'medium' }),
  ].find(candidate => candidate.id === review.itemId)).filter(Boolean),
  reviewStates: first.reviewStates,
  now: new Date('2026-07-16T16:29:59.000Z'),
});
assert.strictEqual(beforeCriticalDue.reminders.length, 0);

const criticalDue = planDAVEFollowThrough({
  items: [
    item({ id: 'critical', priority: 'critical' }),
    item({ id: 'verify', requiresVerification: true }),
    item({ id: 'medium', priority: 'medium' }),
  ],
  reviewStates: first.reviewStates,
  now: new Date('2026-07-16T16:30:00.000Z'),
});
assert.strictEqual(criticalDue.reminders.length, 1);
assert.strictEqual(criticalDue.reminders[0].item.id, 'critical');
assert.strictEqual(criticalDue.reminders[0].cadenceHours, 4);

const reviewed = reviewedDAVEFollowThroughStates(
  criticalDue.reviewStates,
  criticalDue.reminders[0].fingerprint,
  new Date('2026-07-16T16:30:00.000Z'),
);
const afterReview = planDAVEFollowThrough({
  items: criticalDue.reviewStates.map(review => [
    item({ id: 'critical', priority: 'critical' }),
    item({ id: 'verify', requiresVerification: true }),
    item({ id: 'medium', priority: 'medium' }),
  ].find(candidate => candidate.id === review.itemId)),
  reviewStates: reviewed,
  now: new Date('2026-07-16T20:29:59.000Z'),
});
assert(!afterReview.reminders.some(reminder => reminder.item.id === 'critical'));

const nextWindow = planDAVEFollowThrough({
  items: [
    item({ id: 'critical', priority: 'critical' }),
    item({ id: 'verify', requiresVerification: true }),
    item({ id: 'medium', priority: 'medium' }),
  ],
  reviewStates: reviewed,
  now: new Date('2026-07-16T20:30:00.000Z'),
});
assert(nextWindow.reminders.some(reminder => reminder.item.id === 'critical'), 'unresolved critical work must resurface exactly one cadence after review');

const changed = planDAVEFollowThrough({
  items: [item({ id: 'critical', priority: 'critical', summary: 'Condition worsened.' })],
  reviewStates: reviewed,
  now: new Date('2026-07-16T20:30:00.000Z'),
});
assert.strictEqual(changed.reminders.length, 0, 'a materially changed state starts a new truthful review cadence instead of appearing retroactively overdue');
assert.notStrictEqual(changed.reviewStates[0].fingerprint, reviewed[0].fingerprint);

const deterministic = planDAVEFollowThrough({ items: [item()], now });
assert.strictEqual(
  deterministic.reviewStates[0].fingerprint,
  planDAVEFollowThrough({ items: [item()], now }).reviewStates[0].fingerprint,
  'the same responsibility state must produce the same fingerprint',
);

assert.deepStrictEqual(
  parseDAVEFollowThroughReviewStates(JSON.stringify(deterministic.reviewStates)),
  deterministic.reviewStates,
  'review timing must survive app restart',
);

const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
assert(app.includes("'dave-follow-through-reviews:v2'"));
assert(app.includes('Reviewed for Now'));
assert(app.includes('planDAVEFollowThrough'));

console.log('DAVE follow-through planner behavior tests passed.');
