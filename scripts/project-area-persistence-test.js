#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');

function sliceBetween(start, end) {
  const startIndex = app.indexOf(start);
  const endIndex = app.indexOf(end, startIndex);
  assert(startIndex >= 0 && endIndex > startIndex, `Expected ${start} before ${end}.`);
  return app.slice(startIndex, endIndex);
}

const normalization = sliceBetween(
  'function normalizeProjectAreas',
  'function isStartupDeviceDraftEnvelope',
);
assert(normalization.includes('if (!Array.isArray(value)) return DEFAULT_PROJECT_AREAS'),
  'Defaults should remain the first-run and corrupt-storage fallback.');
assert(normalization.includes('return value.map(item => normalizeProjectArea'),
  'A valid stored area list must remain authoritative.');
assert(!normalization.includes('...DEFAULT_PROJECT_AREAS') && !normalization.includes('mergeProjectAreas'),
  'Startup must not recreate deleted default areas.');

const deletion = sliceBetween('function deleteProjectArea', 'function useCurrentLocationForArea');
assert(deletion.includes('prev.filter(item => item.id !== areaId)'),
  'Area deletion must remove the selected record.');
assert(deletion.includes("recordDAVESyncTombstone('project_area', areaId)")
  && deletion.includes("removeOperationalRecordFromSyncQueue('project_area', areaId)"),
  'Area deletion must persist a tombstone and remove stale queued writes.');

// The task card's Area row. This used to look for the text
// "projectAreas={projectAreas}" between the card and the next function. Since
// before the oldest commit this repository keeps (eaed575) the card hands its
// Area sheet "the areas of this task's own project" (itemProjectAreas), a
// narrower list made from the same areas, so the text was not there while the
// selector was. The checks below read the card's structure instead, and also
// every place the card is used: one of them (a project's own page) never
// handed the card any areas, which the old text check could not see.
const tree = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const findNodes = (start, test) => {
  const found = [];
  const visit = node => {
    if (test(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(start);
  return found;
};
const topLevelFunction = name => {
  const matches = tree.statements.filter(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === name && Boolean(node.body));
  assert.strictEqual(matches.length, 1, `App.tsx must declare ${name} exactly once.`);
  return matches[0];
};
const elementsNamed = (start, name) => findNodes(start, node =>
  (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(tree) === name);
const attributeText = (element, name) => {
  const attribute = element.attributes.properties.find(candidate =>
    ts.isJsxAttribute(candidate) && candidate.name.getText(tree) === name);
  if (!attribute || !attribute.initializer || !ts.isJsxExpression(attribute.initializer)) return null;
  return attribute.initializer.expression.getText(tree).replace(/\s+/g, ' ');
};

const taskCard = topLevelFunction('ScheduleItemRow');
const cardProps = taskCard.parameters[0].name.elements.map(element => element.name.getText(tree));
assert(cardProps.includes('projectAreas') && cardProps.includes('scheduleItems') && cardProps.includes('onUpdate'),
  'A task card must be given the areas, the task list and the normal task update path.');

const areaRows = elementsNamed(taskCard, 'AreaRow');
const areaSheets = elementsNamed(taskCard, 'AreaSelectionSheet');
assert(
  areaRows.length === 1 &&
    areaSheets.length === 1 &&
    attributeText(areaRows[0], 'onChange') === '() => setAreaSheetOpen(true)' &&
    attributeText(areaSheets[0], 'visible') === 'areaSheetOpen' &&
    attributeText(areaSheets[0], 'projectAreas') === 'itemProjectAreas',
  'Expanded task cards must provide the shared Area selector.',
);

// "Shared": the row and the sheet are the app's one Area row and one Area
// sheet, the same two the field update screen uses.
topLevelFunction('AreaRow');
topLevelFunction('AreaSelectionSheet');
const fieldUpdateScreen = topLevelFunction('AddPhotosScreen');
assert(
  elementsNamed(fieldUpdateScreen, 'AreaRow').length === 1 &&
    elementsNamed(fieldUpdateScreen, 'AreaSelectionSheet').length === 1,
  'The task card must use the same Area row and Area sheet as the field update screen.',
);

// The areas the sheet offers are the card's own, narrowed to the task's project.
const offeredAreas = findNodes(taskCard, node =>
  ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'itemProjectAreas');
assert.strictEqual(offeredAreas.length, 1, 'A task card must work out the areas it offers exactly once.');
const scopeCall = offeredAreas[0].initializer;
assert(
  ts.isCallExpression(scopeCall) &&
    scopeCall.expression.getText(tree) === 'projectAreasForProject' &&
    scopeCall.arguments.length === 1 &&
    ts.isObjectLiteralExpression(scopeCall.arguments[0]),
  'A task card must take the areas it offers from projectAreasForProject.',
);
const scopeInput = Object.fromEntries(scopeCall.arguments[0].properties.map(property => [
  property.name.getText(tree),
  ts.isShorthandPropertyAssignment(property)
    ? property.name.getText(tree)
    : property.initializer.getText(tree).replace(/\s+/g, ' '),
]));
assert.deepStrictEqual(
  scopeInput,
  {
    projectAreas: 'projectAreas',
    projectName: 'item.scheduleProjectName?.trim() || item.projectName',
    scheduleItems: 'scheduleItems',
  },
  'A task card must offer the areas of its own task\'s project, from the areas it was given.',
);
assert(
  /import \{[^}]*\bprojectAreasForProject\b[^}]*\} from '\.\/services\/DAVEProjectAreaScope';/.test(app),
  'The areas a task card offers must come from the one project-area scope service.',
);

// Choosing a row saves it on the task.
const onSelect = attributeText(areaSheets[0], 'onSelect') || '';
assert(
  onSelect.includes('itemProjectAreas.find(candidate => candidate.id === areaId)') &&
    onSelect.includes("onUpdate({ locationName: area?.name || '' })") &&
    onSelect.includes('setAreaSheetOpen(false)'),
  'Choosing an Area must save the task location through the normal task update path.',
);

// Everywhere a task card is shown, it is handed the areas and the task list.
const cardUses = elementsNamed(tree, 'ScheduleItemRow');
assert(cardUses.length >= 4, 'The task card is expected on the Tasks tab (three places) and on a project\'s page.');
for (const use of cardUses) {
  const line = tree.getLineAndCharacterOfPosition(use.getStart(tree)).line + 1;
  assert(
    attributeText(use, 'projectAreas') === 'projectAreas' && attributeText(use, 'scheduleItems') === 'scheduleItems',
    `The task card at App.tsx line ${line} must be given projectAreas and scheduleItems, or its Area sheet offers nothing.`,
  );
}

// And the narrowing does what it says, run for real.
const { projectAreasForProject } = loadTs('services/DAVEProjectAreaScope.ts');
const sampleAreas = [
  { id: 'north', name: 'North Pad', projectName: 'Lot 9' },
  { id: 'south', name: 'South Pad', projectName: 'lot 9 ' },
  { id: 'roof', name: 'Roof Deck', projectName: 'Main St' },
  { id: 'old', name: 'Old Yard' },
];
const sampleTasks = [{ id: 'task-1', projectName: 'Lot 9', locationName: 'Old Yard' }];
const offered = input => projectAreasForProject(input).map(area => area.id).join(',');
assert.strictEqual(
  offered({ projectAreas: sampleAreas, projectName: 'Lot 9', scheduleItems: sampleTasks }),
  'north,south,old',
  'A Lot 9 task must be offered Lot 9\'s areas, and an older unowned area only Lot 9\'s tasks use.',
);
assert.strictEqual(
  offered({ projectAreas: sampleAreas, projectName: 'Main St', scheduleItems: sampleTasks }),
  'roof',
  'A Main St task must not be offered another project\'s areas.',
);
assert.strictEqual(
  offered({ projectAreas: sampleAreas, projectName: 'Lot 9', scheduleItems: [] }),
  'north,south',
  'An older unowned area no task ties to the project must not be offered.',
);
assert.strictEqual(
  offered({ projectAreas: [], projectName: 'Lot 9', scheduleItems: sampleTasks }),
  '',
  'A card given no areas offers none (why every use of the card must be handed them).',
);

console.log('Project area deletion persistence checks passed.');

/** Loads a TypeScript service and the services it imports. */
function loadTs(relativePath, cache = new Map()) {
  const filename = path.join(root, relativePath);
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const localRequire = request => request.startsWith('.')
    ? loadTs(path.relative(root, path.resolve(path.dirname(filename), `${request}.ts`)), cache)
    : require(request);
  vm.runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require: localRequire,
    Date,
    Set,
    Map,
    WeakMap,
    Math,
    console,
  }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}
