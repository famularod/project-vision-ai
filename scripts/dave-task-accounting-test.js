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
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: absolutePath,
  }).outputText;
  const localRequire = specifier => {
    if (!specifier.startsWith('.')) return require(specifier);
    const base = path.resolve(path.dirname(absolutePath), specifier);
    const resolved = [base, `${base}.ts`, path.join(base, 'index.ts')]
      .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) throw new Error(`Cannot resolve ${specifier}`);
    return loadTs(path.relative(root, resolved));
  };
  new Function('require', 'module', 'exports', compiled)(
    localRequire,
    moduleUnderTest,
    moduleUnderTest.exports,
  );
  return moduleUnderTest.exports;
}

const {
  buildDAVEProjectScheduleRollup,
  buildScheduleTaskAccounting,
} = loadTs('services/dave-project-schedule-rollup.ts');

function tasks(projectName, complete, inProgress, notStarted) {
  const rows = [];
  for (let index = 0; index < complete; index += 1) {
    rows.push(task(`${projectName}-complete-${index}`, projectName, 'Complete', 100));
  }
  for (let index = 0; index < inProgress; index += 1) {
    rows.push(task(`${projectName}-progress-${index}`, projectName, 'In Progress', 50));
  }
  for (let index = 0; index < notStarted; index += 1) {
    rows.push(task(`${projectName}-not-started-${index}`, projectName, 'Not Started', 0));
  }
  return rows;
}

function task(id, projectName, status, percentComplete) {
  return {
    id,
    scheduleProjectName: projectName,
    projectName,
    projectTimeZone: 'America/Los_Angeles',
    taskName: id,
    status,
    percentComplete,
    durationDays: 1,
    finishDate: '2026-08-15',
    notes: '',
  };
}

const allTasks = [
  ...tasks('2321 Compliance Project', 36, 5, 6),
  ...tasks('2375 Compliance Project', 17, 0, 2),
];
const accounting = buildScheduleTaskAccounting(allTasks);

assert.deepStrictEqual(accounting, {
  total: 66,
  complete: 53,
  open: 13,
  inProgress: 5,
  waiting: 0,
  notStarted: 8,
});
assert.strictEqual(accounting.total, accounting.complete + accounting.open);
assert.strictEqual(
  accounting.total,
  accounting.complete + accounting.inProgress + accounting.waiting + accounting.notStarted,
);

assert.deepStrictEqual(
  buildScheduleTaskAccounting([
    { status: 'Complete', percentComplete: 99 },
    { status: 'In Progress', percentComplete: 100 },
  ]),
  {
    total: 2,
    complete: 0,
    open: 2,
    inProgress: 2,
    waiting: 0,
    notStarted: 0,
  },
  'Contradictory legacy rows must fail closed instead of inflating completion.',
);

const rollup2321 = buildDAVEProjectScheduleRollup({
  projectName: '2321 Compliance Project',
  items: allTasks,
  now: new Date('2026-07-20T12:00:00.000Z'),
});
const rollup2375 = buildDAVEProjectScheduleRollup({
  projectName: '2375 Compliance Project',
  items: allTasks,
  now: new Date('2026-07-20T12:00:00.000Z'),
});

assert.deepStrictEqual(
  [rollup2321.taskCount, rollup2321.completedCount, rollup2321.openCount],
  [47, 36, 11],
);
assert.deepStrictEqual(
  [rollup2375.taskCount, rollup2375.completedCount, rollup2375.openCount],
  [19, 17, 2],
);

const admin = fs.readFileSync(path.join(root, 'screens/AdminScreen.tsx'), 'utf8');
assert(admin.includes('label="Active Projects" value={localProjects.length}'));
assert(!admin.includes('label="Cloud Projects"'));

console.log('PASS DAVE task accounting');
