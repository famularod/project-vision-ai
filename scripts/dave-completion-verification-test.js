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

const completion = loadTypeScriptModule('services/DAVECompletionVerification.ts');
const communication = loadTypeScriptModule('services/PIEScheduleCommunicationImport.ts');
const importBatch = loadTypeScriptModule('services/PIEScheduleImportBatch.ts');

const imported = communication.extractScheduleItemsFromCommunicationText({
  text: 'Task A was completed in Canopy B.',
  sourceName: 'completion-email.png',
  projects: ['Building 2375 Compliance'],
  projectAreas: [{ id: 'canopy-b', name: 'Canopy B', latitude: 0, longitude: 0, radiusFeet: 250 }],
  now: new Date('2026-07-15T12:00:00-07:00'),
});

assert.strictEqual(imported.items.length, 1, 'A completion report should become one reviewable activity.');
const claim = imported.items[0];
assert.strictEqual(claim.status, 'Not Started', 'A message claim must not overwrite the schedule status.');
assert.strictEqual(claim.percentComplete, 0, 'A message claim must not set progress to 100%.');
assert.strictEqual(claim.completionVerification.status, 'reported_complete');
assert(completion.scheduleItemNeedsCompletionVerification(claim));
assert(importBatch.scheduleImportItemHasCoreFacts(claim), 'A completion claim can be reviewed without an invented finish date.');
assert(!importBatch.scheduleImportReviewFields(claim).includes('date'), 'DAVE must not demand an invented completion date.');

const scheduled = {
  ...claim,
  id: 'schedule-task-a',
  taskName: 'Task A',
  status: 'In Progress',
  percentComplete: 65,
  completionVerification: null,
};
const matched = completion.findExactScheduleTaskForCompletionClaim(claim, [scheduled]);
assert.strictEqual(matched.id, scheduled.id, 'A unique exact task match should receive the completion report.');

const merged = completion.mergeReportedCompletionClaim(scheduled, claim);
assert.strictEqual(merged.status, 'In Progress', 'Attaching a claim must preserve schedule status.');
assert.strictEqual(merged.percentComplete, 65, 'Attaching a claim must preserve scheduled progress.');
assert.strictEqual(merged.completionVerification.priorScheduleStatus, 'In Progress');
assert.strictEqual(merged.completionVerification.evidence.length, 1, 'The original message must remain linked.');

const verified = completion.verifyScheduleItemCompletion(merged, {
  verifiedAt: '2026-07-15T20:00:00.000Z',
  verifiedBy: 'Project manager',
  note: 'I inspected the completed work in the field.',
});
assert.strictEqual(verified.status, 'Complete');
assert.strictEqual(verified.percentComplete, 100);
assert.strictEqual(verified.completionVerification.status, 'pm_verified');
assert.strictEqual(verified.completionVerification.evidence.length, 2, 'PM verification must append evidence without replacing the source.');
assert(verified.completionVerification.evidence.some(item => item.kind === 'email'));
assert(verified.completionVerification.evidence.some(item => item.kind === 'pm_note'));

const rejected = completion.rejectScheduleItemCompletion(merged, {
  rejectedAt: '2026-07-15T20:05:00.000Z',
  rejectedBy: 'Project manager',
  note: 'The lower connection is unfinished.',
});
assert.strictEqual(rejected.status, 'In Progress');
assert.strictEqual(rejected.percentComplete, 65);
assert.strictEqual(rejected.completionVerification.status, 'rejected');

const ambiguous = completion.findExactScheduleTaskForCompletionClaim(claim, [scheduled, { ...scheduled, id: 'duplicate-task-a' }]);
assert.strictEqual(ambiguous, null, 'DAVE must not guess when more than one schedule task matches.');

const negative = communication.extractScheduleItemsFromCommunicationText({
  text: 'Task A was not completed.',
  sourceName: 'follow-up-email.png',
  now: new Date('2026-07-15T12:00:00-07:00'),
});
assert.strictEqual(negative.items[0].completionVerification, null, 'A negative statement must never become a completion claim.');

const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
assert(app.includes('Confirm Completed') && app.includes('Capture Verification Photo') && app.includes('Not Complete'));
assert(app.includes('findExactScheduleTaskForCompletionClaim') && app.includes('mergeReportedCompletionClaim'));

console.log('PASS DAVE completion verification');
