const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const truth = read('services/DAVEProjectTruth.ts');
const provider = read('providers/PIELiveAuthorityProvider.tsx');
const signature = read('services/PIELiveAuthoritySignature.ts');
const app = read('App.tsx');
const appTree = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const TALK_SERVICE = 'services/ECOSTalkProjectIntelligence.ts';

const checks = [
  ['single Project Truth contract', truth.includes("DAVE_PROJECT_TRUTH_VERSION = 'dave-project-truth/1.0'")],
  ['live authority builds Project Truth', provider.includes('buildDAVEProjectTruth({')],
  ['live authority exposes Project Truth', provider.includes('projectTruth: DAVEProjectTruth')],
  ['confirmed memories enter authority signature',
    provider.includes("from '../services/PIELiveAuthoritySignature'") &&
      signature.includes('captureMemories: cachedStableStringify(input.captureMemories || [])')],
  ['project documents enter authority signature',
    provider.includes("from '../services/PIELiveAuthoritySignature'") &&
      signature.includes('projectDocuments: cachedStableStringify(input.projectDocuments || [])')],
  ['workspace consumes live Project Truth', app.includes('const projectIntelligence = liveAuthority.projectTruth.intelligence')],
  // Ask DAVE is the Talk sheet today. Its step that gathers what is known
  // about a project used to sit in App.tsx as "return buildDAVEProjectTruth({";
  // it was moved, whole, into services/ECOSTalkProjectIntelligence.ts before
  // the oldest commit this repository keeps (eaed575). The four checks below
  // follow it there and test what it does, not only that a text exists.
  ['Ask DAVE uses Project Truth builder', talkAsksItsServiceForProjectIntelligence()],
  // Review pass 1, L11: the check above reads the NAMES App.tsx hands the
  // Talk service, so "updates: []", the unfiltered schedule or every saved
  // update (archived included) passed it. The three below read the VALUES,
  // and run the app's own two steps that make the lists.
  ['Ask DAVE is handed the app\'s own record lists', talkIsHandedTheAppsOwnLists()],
  ['the field updates Ask DAVE is handed leave out archived and deleted-task ones', talkUpdatesAreTheActiveOnes()],
  ['the schedule Ask DAVE is handed is the one in use', talkScheduleIsTheOneInUse()],
  ['Ask DAVE service returns what the Project Truth builder made', talkServiceReturnsProjectTruthIntelligence()],
  ['Ask DAVE answers only from that intelligence', talkAnswersComeFromThatIntelligence()],
  ['Ask DAVE has no way around Project Truth', talkHasNoOtherIntelligenceBuilder()],
  ['Home displays the authoritative next action',
    app.includes('liveAuthority.projectTruth.briefing.nextActions') &&
      app.includes('const authoritativePriority =')],
  ['evidence accounting records connected evidence', truth.includes("disposition: input.connected ? 'connected' : 'unresolved'")],
  ['evidence accounting exposes unresolved records', truth.includes("unresolvedRecords: records.filter(item => item.disposition === 'unresolved')")],
  ['duplicate evidence is identified', truth.includes("disposition: 'duplicate' as const")],
  ['cross-source task links are built', truth.includes("targetType: 'project' | 'area' | 'schedule-task' | 'equipment'")],
  ['equipment identifiers are normalized', truth.includes('function extractEntityKeys')],
  ['low-confidence entity links require verification', truth.includes("needsVerification: confidence === 'low'")],
  ['photo evidence requires visual provenance', truth.includes("intelligence?.provenance === 'visual_only'")],
  ['photo baseline limitation is explicit', truth.includes('No confirmed prior photo is available.')],
  ['unsupported photo evidence cannot claim progress', truth.includes("progressClaim = safeVisualEvidence")],
  ['schedule urgency is calculated', truth.includes("'overdue' | 'due_soon' | 'upcoming' | 'not_urgent'")],
  ['reported completion stays unverified', truth.includes("completionState === 'reported_complete'")],
  ['only contradictory completion records become conflicts', truth.includes('Current project records disagree about task completion.')],
  ['general verification queue exists', truth.includes('function buildVerificationQueue')],
  ['PM briefing contains risks and conflicts', truth.includes('risksAndConflicts: risks')],
  ['PM briefing contains exactly prioritized next actions', truth.includes(').slice(0, 3)')],
  ['PM briefing reports evidence coverage', truth.includes('evidenceCoverage:')],
  ['workspace keeps project task control available', app.includes('<ProjectTaskControlPanel')],
  ['Overview renders current task and schedule facts',
    app.includes('currentFocus.owner') &&
      app.includes('currentFocus.timing') &&
      app.includes('liveAuthority.projectTruth.briefing.schedule')],
];

let failures = 0;
for (const [name, passed] of checks) {
  if (passed) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

if (failures > 0) {
  console.error(`\nDAVE field-test readiness contract failed: ${failures} check(s).`);
  process.exit(1);
}

console.log(`\nDAVE field-test readiness contract passed: ${checks.length} checks.`);

/** Every node in a tree for which `test` is true. */
function findNodes(tree, test) {
  const found = [];
  const visit = node => {
    if (test(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

function functionsNamed(tree, name) {
  return findNodes(tree, node =>
    ts.isFunctionDeclaration(node) && node.name?.text === name && Boolean(node.body));
}

/** The module a file imports `name` from (unrenamed), or null. */
function importSourceOf(tree, name) {
  let source = null;
  tree.forEachChild(node => {
    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(element =>
        !element.isTypeOnly && !element.propertyName && element.name.text === name)
    ) {
      source = node.moduleSpecifier.text;
    }
  });
  return source;
}

function callsTo(tree, name) {
  return findNodes(tree, node =>
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name);
}

/**
 * App.tsx has one step that gathers a project's intelligence for Talk, and
 * all it does is hand the app's records to the Talk service and return the
 * answer.
 */
function talkAsksItsServiceForProjectIntelligence() {
  const declarations = functionsNamed(appTree, 'projectIntelligenceForTalk');
  if (declarations.length !== 1) return false;
  const returns = findNodes(declarations[0].body, ts.isReturnStatement);
  if (returns.length !== 1) return false;
  const returned = returns[0].expression;
  if (
    !returned ||
    !ts.isCallExpression(returned) ||
    !ts.isIdentifier(returned.expression) ||
    returned.expression.text !== 'buildECOSTalkProjectIntelligence' ||
    returned.arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(returned.arguments[0])
  ) {
    return false;
  }
  const handedOver = returned.arguments[0].properties.map(property => property.name?.getText(appTree));
  return importSourceOf(appTree, 'buildECOSTalkProjectIntelligence') === './services/ECOSTalkProjectIntelligence' &&
    ['projectId', 'projectName', 'taskId', 'updates', 'scheduleItems', 'projectDocuments', 'referenceDocuments', 'captureMemories']
      .every(name => handedOver.includes(name));
}

/** The one step in App.tsx that asks the Talk service, and the object it hands over; or null. */
function talkHandOver() {
  const declarations = functionsNamed(appTree, 'projectIntelligenceForTalk');
  if (declarations.length !== 1) return null;
  const calls = callsTo(declarations[0].body, 'buildECOSTalkProjectIntelligence');
  if (calls.length !== 1 || calls[0].arguments.length !== 1 || !ts.isObjectLiteralExpression(calls[0].arguments[0])) return null;
  const values = new Map();
  for (const property of calls[0].arguments[0].properties) {
    if (ts.isShorthandPropertyAssignment(property)) values.set(property.name.text, property.name);
    else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) values.set(property.name.text, property.initializer);
    else return null;
  }
  return { declaration: declarations[0], values };
}

/** The function a node sits in. */
function enclosingFunction(node) {
  let enclosing = node.parent;
  while (enclosing && !ts.isFunctionLike(enclosing)) enclosing = enclosing.parent;
  return enclosing || null;
}

/** The declarations of `name` made directly in `scope` (not inside a function nested in it). */
function declaredIn(scope, name) {
  return findNodes(scope, node =>
    ts.isVariableDeclaration(node) && enclosingFunction(node) === scope &&
    (ts.isIdentifier(node.name)
      ? node.name.text === name
      : ts.isArrayBindingPattern(node.name) && node.name.elements.some(element =>
        ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === name)));
}

/**
 * What App.tsx hands the Talk service, value by value: the app's own lists
 * and nothing else. Not an empty list, not another list, not one made on the
 * spot.
 *   updates            the app's active field updates (activeSavedUpdates)
 *   scheduleItems      the schedule in use (authoritativeScheduleItems)
 *   projectDocuments   the app's project documents
 *   captureMemories    the app's confirmed memories
 *   referenceDocuments the documents the caller gives, by default the app's
 *   projectId          worked out from the project asked about
 *   projectName/taskId the project and task asked about
 * Each of those names is declared once in the app's main function, so there
 * is no second list of the same name it could be.
 */
function talkIsHandedTheAppsOwnLists() {
  const handOver = talkHandOver();
  if (!handOver) return false;
  const { declaration, values } = handOver;
  const app = enclosingFunction(declaration);
  if (!app) return false;
  const isName = (node, name) => Boolean(node) && ts.isIdentifier(node) && node.text === name;
  const parameter = name => declaration.parameters.find(item => ts.isIdentifier(item.name) && item.name.text === name);
  const referenceParameter = declaration.parameters.find(item =>
    ts.isIdentifier(item.name) && isName(values.get('referenceDocuments'), item.name.text));
  const projectId = values.get('projectId');
  return isName(values.get('updates'), 'activeSavedUpdates') &&
    isName(values.get('scheduleItems'), 'authoritativeScheduleItems') &&
    isName(values.get('projectDocuments'), 'projectDocuments') &&
    isName(values.get('captureMemories'), 'captureMemories') &&
    isName(values.get('projectName'), 'projectName') && Boolean(parameter('projectName')) &&
    isName(values.get('taskId'), 'taskId') && Boolean(parameter('taskId')) &&
    Boolean(referenceParameter) && isName(referenceParameter.initializer, 'referenceDocuments') &&
    Boolean(projectId) && ts.isCallExpression(projectId) && isName(projectId.expression, 'authorityProjectId') &&
    projectId.arguments.length === 1 && isName(projectId.arguments[0], 'projectName') &&
    ['activeSavedUpdates', 'authoritativeScheduleItems', 'projectDocuments', 'captureMemories', 'referenceDocuments']
      .every(name => declaredIn(app, name).length === 1);
}

/**
 * The step in the app's main function that makes `name`, as a function that
 * can be run here: `const name = useMemo(() => ..., [...])`. `given` are the
 * things that step reads from the app. Null when it is not made that way.
 */
function appStepThatMakes(name, given) {
  const handOver = talkHandOver();
  const app = handOver && enclosingFunction(handOver.declaration);
  if (!app) return null;
  const declarations = declaredIn(app, name);
  if (declarations.length !== 1) return null;
  const made = declarations[0].initializer;
  if (
    !made || !ts.isCallExpression(made) || !ts.isIdentifier(made.expression) || made.expression.text !== 'useMemo' ||
    made.arguments.length !== 2 || !ts.isArrowFunction(made.arguments[0]) || made.arguments[0].parameters.length !== 0
  ) {
    return null;
  }
  const compiled = ts.transpileModule(`module.exports = (${made.arguments[0].getText(appTree)});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  });
  const module = { exports: null };
  vm.runInNewContext(compiled.outputText, { module, ...given }, { filename: `App.tsx (${name})` });
  return typeof module.exports === 'function' ? module.exports : null;
}

/**
 * Runs the app's own step that makes the field updates it hands on, with
 * stand-in records: an archived update is left out, and so is one kept only
 * as history for a deleted task.
 */
function talkUpdatesAreTheActiveOnes() {
  try {
    const step = appStepThatMakes('activeSavedUpdates', {
      savedUpdateTaskEvidence: {
        active: [
          { id: 'kept' },
          { id: 'archived', isArchived: true },
          { id: 'kept-too', isArchived: false },
        ],
        historical: [{ id: 'history-of-a-deleted-task' }],
      },
    });
    return Boolean(step) && step().map(update => update.id).join(',') === 'kept,kept-too';
  } catch (error) {
    console.error(`  (the app's step that makes its active field updates could not be run: ${error.message})`);
    return false;
  }
}

/**
 * Runs the app's own step that makes the schedule it hands on, with a
 * stand-in for the selector of the schedule in use: the selector is asked
 * once, with all the app's tasks and its documents, and what it answers is
 * what the step gives. So the schedule handed to Talk is the selector's, not
 * every saved task.
 */
function talkScheduleIsTheOneInUse() {
  try {
    const scheduleItems = [{ id: 'task-in-use' }, { id: 'task-of-a-replaced-schedule' }];
    const referenceDocuments = [{ id: 'current-schedule' }, { id: 'replaced-schedule' }];
    const inUse = [{ id: 'task-in-use' }];
    const asked = [];
    const step = appStepThatMakes('authoritativeScheduleItems', {
      scheduleItems,
      referenceDocuments,
      selectAuthoritativeScheduleItems: input => {
        asked.push(input);
        return inUse;
      },
    });
    return Boolean(step) &&
      step() === inUse &&
      asked.length === 1 &&
      asked[0].scheduleItems === scheduleItems &&
      asked[0].scheduleDocuments === referenceDocuments &&
      importSourceOf(appTree, 'selectAuthoritativeScheduleItems') === './services/PIEScheduleReconciliation';
  } catch (error) {
    console.error(`  (the app's step that selects the schedule in use could not be run: ${error.message})`);
    return false;
  }
}

/**
 * Runs the Talk service with a stand-in for the Project Truth builder and
 * checks three things: the builder is asked exactly once, it is given this
 * project's records only, and what the service returns is the very
 * intelligence the builder made.
 */
function talkServiceReturnsProjectTruthIntelligence() {
  try {
    return talkServiceRunsAgainstStandInBuilder();
  } catch (error) {
    console.error(`  (the Talk service could not be run: ${error.message})`);
    return false;
  }
}

function talkServiceRunsAgainstStandInBuilder() {
  const run = (taskId) => {
    const builderCalls = [];
    const builtIntelligence = { madeBy: 'project-truth-builder' };
    const { buildECOSTalkProjectIntelligence } = loadTs(TALK_SERVICE, new Map(), {
      'services/DAVEProjectTruth.ts': {
        buildDAVEProjectTruth: input => {
          builderCalls.push(input);
          return { intelligence: builtIntelligence };
        },
      },
    });
    const referenceDocuments = [{ id: 'reference-1', name: 'Drawing' }];
    const captureMemories = [{ id: 'memory-1', projectId: 'project-alpha' }];
    const result = buildECOSTalkProjectIntelligence({
      projectId: 'project-alpha',
      projectName: 'Alpha',
      taskId,
      updates: [
        { id: 'update-alpha', projectName: 'Alpha' },
        { id: 'update-beta', projectName: 'Beta' },
      ],
      scheduleItems: [
        { id: 'task-alpha-1', projectName: 'Alpha', taskName: 'Footings' },
        { id: 'task-alpha-2', projectName: 'Alpha', taskName: 'Slab' },
        { id: 'task-beta-1', projectName: 'Beta', taskName: 'Roof' },
      ],
      projectDocuments: [
        { id: 'document-alpha', projectId: 'project-alpha', name: 'Alpha record' },
        { id: 'document-alpha-archived', projectId: 'project-alpha', name: 'Old record', isArchived: true },
        { id: 'document-beta', projectId: 'project-beta', name: 'Beta record' },
      ],
      referenceDocuments,
      captureMemories,
    });
    return { builderCalls, builtIntelligence, result, referenceDocuments, captureMemories };
  };
  const ids = records => records.map(record => record.id).join(',');

  const whole = run(null);
  const input = whole.builderCalls[0];
  const wholeProject =
    whole.builderCalls.length === 1 &&
    whole.result === whole.builtIntelligence &&
    input.projectId === 'project-alpha' &&
    input.projectName === 'Alpha' &&
    ids(input.updates) === 'update-alpha' &&
    ids(input.scheduleItems) === 'task-alpha-1,task-alpha-2' &&
    ids(input.projectDocuments) === 'document-alpha' &&
    ids(input.referenceDocuments) === ids(whole.referenceDocuments) &&
    input.captureMemories === whole.captureMemories;

  const oneTask = run('task-alpha-2');
  const oneTaskOnly =
    oneTask.builderCalls.length === 1 &&
    oneTask.result === oneTask.builtIntelligence &&
    ids(oneTask.builderCalls[0].scheduleItems) === 'task-alpha-2';

  return wholeProject && oneTaskOnly;
}

/**
 * Wherever App.tsx works out a Talk answer, a follow-up answer, or where a
 * cited source opens, the intelligence it uses is the one made by the step
 * above, in the same function.
 */
function talkAnswersComeFromThatIntelligence() {
  const usesIntelligence = {
    routeDAVEConversation: call =>
      ts.isObjectLiteralExpression(call.arguments[0]) &&
      call.arguments[0].properties.some(property =>
        ts.isShorthandPropertyAssignment(property) && property.name.text === 'intelligence'),
    answerDAVEConversationContext: call =>
      ts.isObjectLiteralExpression(call.arguments[0]) &&
      call.arguments[0].properties.some(property =>
        ts.isShorthandPropertyAssignment(property) && property.name.text === 'intelligence'),
    resolveDAVEAskEvidenceNavigation: call =>
      ts.isIdentifier(call.arguments[0]) && call.arguments[0].text === 'intelligence',
  };
  return Object.entries(usesIntelligence).every(([name, isGivenIntelligence]) => {
    const calls = callsTo(appTree, name);
    return calls.length > 0 && calls.every(call => {
      if (!isGivenIntelligence(call)) return false;
      let enclosing = call.parent;
      while (enclosing && !ts.isFunctionLike(enclosing)) enclosing = enclosing.parent;
      if (!enclosing) return false;
      const declared = findNodes(enclosing, node =>
        ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'intelligence');
      return declared.length === 1 &&
        Boolean(declared[0].initializer) &&
        ts.isCallExpression(declared[0].initializer) &&
        ts.isIdentifier(declared[0].initializer.expression) &&
        declared[0].initializer.expression.text === 'projectIntelligenceForTalk' &&
        (declared[0].parent.flags & ts.NodeFlags.Const) !== 0;
    });
  });
}

/**
 * App.tsx itself calls neither the Project Truth builder nor the plain
 * intelligence builder underneath it, so Talk cannot be handed intelligence
 * that did not come through Project Truth; and the Talk service makes its
 * intelligence nowhere but in the Project Truth builder.
 */
function talkHasNoOtherIntelligenceBuilder() {
  const serviceSource = read(TALK_SERVICE);
  const serviceTree = ts.createSourceFile(TALK_SERVICE, serviceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const serviceFunctions = functionsNamed(serviceTree, 'buildECOSTalkProjectIntelligence');
  if (serviceFunctions.length !== 1) return false;
  const returns = findNodes(serviceFunctions[0].body, ts.isReturnStatement)
    .filter(statement => {
      let enclosing = statement.parent;
      while (enclosing && !ts.isFunctionLike(enclosing)) enclosing = enclosing.parent;
      return enclosing === serviceFunctions[0];
    });
  return callsTo(appTree, 'buildProjectIntelligence').length === 0 &&
    callsTo(appTree, 'buildDAVEProjectTruth').length === 0 &&
    callsTo(serviceTree, 'buildProjectIntelligence').length === 0 &&
    callsTo(serviceTree, 'buildDAVEProjectTruth').length === 1 &&
    importSourceOf(serviceTree, 'buildDAVEProjectTruth') === './DAVEProjectTruth' &&
    returns.length === 1 &&
    /^buildDAVEProjectTruth\(\{[\s\S]*\}\)\.intelligence$/.test(returns[0].expression.getText(serviceTree));
}

/**
 * Loads a TypeScript service and the services it imports. `standIns` maps a
 * file path to an object to use in its place.
 */
function loadTs(relativePath, cache, standIns = {}) {
  if (Object.prototype.hasOwnProperty.call(standIns, relativePath)) return standIns[relativePath];
  const filename = path.join(root, relativePath);
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const localRequire = request => request.startsWith('.')
    ? loadTs(path.relative(root, path.resolve(path.dirname(filename), `${request}.ts`)), cache, standIns)
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
    Intl,
    console,
    encodeURIComponent,
  }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}
