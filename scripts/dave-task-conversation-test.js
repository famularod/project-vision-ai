#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'services/DAVETaskConversation.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const moduleRecord = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: moduleRecord,
  exports: moduleRecord.exports,
  require,
  Math,
  Number,
  RegExp,
}, { filename });

const { parseDAVETaskUpdateCommand, findDAVETaskCandidates } = moduleRecord.exports;

const complete = parseDAVETaskUpdateCommand('Mark electrical rough-in complete.');
assert.deepStrictEqual(JSON.parse(JSON.stringify(complete)), {
  taskReference: 'electrical rough-in',
  changes: { status: 'Complete', percentComplete: 100 },
  changeSummary: 'Mark complete and set progress to 100%',
});

const progress = parseDAVETaskUpdateCommand('Change concrete paving to 75 percent.');
assert.strictEqual(progress.taskReference, 'concrete paving');
assert.strictEqual(progress.changes.percentComplete, 75);
assert.strictEqual(progress.changes.status, 'In Progress');

const waiting = parseDAVETaskUpdateCommand('Set fire alarm inspection to waiting');
assert.strictEqual(waiting.changes.status, 'Waiting');
assert.strictEqual(waiting.changes.percentComplete, undefined);

assert.strictEqual(
  parseDAVETaskUpdateCommand('Electrical rough-in looks complete.'),
  null,
  'An observation must not silently become a task mutation.',
);
assert.strictEqual(parseDAVETaskUpdateCommand('What is complete?'), null);

const tasks = [
  { id: 'task-1', taskName: 'Electrical rough-in', locationName: 'Canopy B' },
  { id: 'task-2', taskName: 'Concrete paving', locationName: 'East Driveway' },
  { id: 'task-3', taskName: 'Concrete paving', locationName: 'North Lot' },
];
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(findDAVETaskCandidates(complete, tasks))).map(item => item.id),
  ['task-1'],
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(findDAVETaskCandidates(progress, tasks))).map(item => item.id),
  ['task-2', 'task-3'],
  'Duplicate task names must remain ambiguous until the PM chooses one.',
);

const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const sheet = fs.readFileSync(path.join(root, 'components/dave-task-action-confirmation-sheet.tsx'), 'utf8');
assert(app.includes("route.intent === 'task_update'"));
assert(app.includes('const selectedContextTask = taskContextId'), 'An explicitly selected task must constrain task commands.');
assert(app.includes('? [selectedContextTask]'), 'An explicitly selected task must become the sole confirmation candidate.');
assert(app.includes('<DAVETaskActionConfirmationSheet'));
assert(app.includes("text: 'Undo'"), 'A confirmed task change must offer Undo.');
assert(sheet.includes('Nothing will change until you choose one and confirm.'));
assert(sheet.includes('Confirm Change'));

console.log('DAVE Talk task control tests passed.');
