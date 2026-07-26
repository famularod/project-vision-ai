#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'services/PIEScheduleDependencyNetwork.ts'),
  'utf8',
);
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
  SCHEDULE_DEPENDENCY_EXTRACTION_ENABLED,
  buildPIEScheduleDependencyNetwork,
  stripScheduleDependencyMetadata,
} = moduleUnderTest.exports;

function task(id, status, notes, taskName = id, dependencies = []) {
  return {
    id,
    projectName: 'Hospital',
    locationName: 'Level 2',
    taskName,
    startDate: '',
    finishDate: '',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: status === 'Complete' ? 100 : 0,
    priority: 'Medium',
    status,
    notes,
    dependencies,
    createdAt: '2026-07-16T12:00:00.000Z',
  };
}

const foundations = task('foundations', 'In Progress', 'Activity ID: A100.');
const structure = task(
  'structure',
  'Not Started',
  'Activity ID: A200. Predecessors: A100.',
  'Structure',
  [{ predecessorItemId: 'foundations', type: 'FS' }],
);
const enclosure = task(
  'enclosure',
  'Not Started',
  'Activity ID: A300. Dependencies: A200.',
  'Enclosure',
  [{ predecessorItemId: 'structure', type: 'FS', lagDays: 2 }],
);
const network = buildPIEScheduleDependencyNetwork([foundations, structure, enclosure]);

assert.strictEqual(SCHEDULE_DEPENDENCY_EXTRACTION_ENABLED, false);
assert.strictEqual(network.nodes.length, 3);
assert.deepStrictEqual(network.edges, [
  {
    fromScheduleItemId: 'foundations',
    toScheduleItemId: 'structure',
    sourceLabel: 'FS',
  },
  {
    fromScheduleItemId: 'structure',
    toScheduleItemId: 'enclosure',
    sourceLabel: 'FS+2d',
  },
]);
assert.deepStrictEqual(network.cycles, []);
assert.strictEqual(network.blockedItemCount, 2);
assert.strictEqual(network.unresolvedReferenceCount, 0);
assert.deepStrictEqual(
  network.nodes.find(node => node.scheduleItemId === 'structure').blockingPredecessorIds,
  ['foundations'],
);
assert.deepStrictEqual(
  network.nodes.find(node => node.scheduleItemId === 'enclosure').blockingPredecessorIds,
  ['structure'],
);

assert.strictEqual(
  stripScheduleDependencyMetadata('Activity ID: A200. Predecessors: A100FS+2d, B200SS-1d. Duration: 5 days.'),
  'Activity ID: A200. Duration: 5 days.',
);
assert.strictEqual(
  stripScheduleDependencyMetadata('Dependencies: A200. Imported from a structured schedule.'),
  'Imported from a structured schedule.',
);
assert.strictEqual(
  stripScheduleDependencyMetadata('Field note remains. Schedule confidence: high.'),
  'Field note remains. Schedule confidence: high.',
);

console.log('PASS structured schedule dependencies with free-text extraction disabled');
