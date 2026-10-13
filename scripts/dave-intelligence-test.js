#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

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
    encodeURIComponent,
  }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const moduleCache = new Map();
const { buildProjectIntelligence } = loadTs('services/DAVEIntelligence.ts', moduleCache);
const { buildProjectDailyBrief } = loadTs('services/DAVEDailyBrief.ts', moduleCache);
const { buildProjectActionCenter } = loadTs('services/DAVEProjectActionCenter.ts', moduleCache);
const { buildProjectCommitments } = loadTs('services/DAVEProjectCommitments.ts', moduleCache);
const { buildProjectEvidenceQuality } = loadTs('services/DAVEProjectEvidenceQuality.ts', moduleCache);

const now = '2026-07-12T12:00:00.000Z';
const update = {
  id: 'update-safety',
  projectName: 'Alpha',
  date: '2026-07-11T10:00:00.000Z',
  safetyFlag: true,
  photos: [{
    id: 'photo-safety',
    category: 'Safety Concern',
    actionRequired: 'Confirm guardrail condition',
    actionOwner: 'Alex',
    actionDueDate: '2026-07-10',
    actionStatus: 'Open',
    locationCapturedAt: '2026-07-11T10:00:00.000Z',
    photoIntelligence: {
      status: 'analysis_complete',
      updatedAt: '2026-07-11T10:01:00.000Z',
      comparisonConfidence: 'high',
      priorEvidenceId: 'baseline-evidence',
      findings: [{ findingType: 'visible_concern', description: 'An open guardrail condition is visible.', confidence: 0.9 }],
    },
  }],
};
const input = {
  projectId: 'project-alpha',
  projectName: 'Alpha',
  updates: [update],
  documents: [{
    id: 'inspection-document',
    projectId: 'project-alpha',
    updateId: 'update-safety',
    name: 'Inspection record',
    category: 'Inspection',
    status: 'uploaded',
    createdAt: '2026-07-11T09:00:00.000Z',
    updatedAt: '2026-07-11T09:00:00.000Z',
  }],
  scheduleItems: [{
    id: 'schedule-1',
    projectName: 'Alpha',
    taskName: 'Safety review',
    status: 'In Progress',
    createdAt: '2026-07-11T08:00:00.000Z',
  }],
  now,
};

const intelligence = buildProjectIntelligence(input);

assert.strictEqual(intelligence.schemaVersion, 'dave-intelligence/1.0');
assert.strictEqual(intelligence.projectId, 'project-alpha');
assert.strictEqual(intelligence.generatedAt, now);
assert(Object.isFrozen(intelligence), 'Canonical intelligence object must be immutable.');
assert(Object.isFrozen(intelligence.projectReality));
assert(Object.isFrozen(intelligence.timeline));
assert(Object.isFrozen(intelligence.dailyBrief));
assert(Object.isFrozen(intelligence.actionCenter));
assert(Object.isFrozen(intelligence.commitments));
assert(Object.isFrozen(intelligence.evidenceQuality));
assert(Object.isFrozen(intelligence.scheduleSummary));
assert.strictEqual(intelligence.scheduleSummary.taskCount, 1);
assert.strictEqual(intelligence.scheduleSummary.completedCount, 0);

assert.strictEqual(intelligence.dailyBrief.reality, intelligence.projectReality,
  'Daily Brief must retain the one canonical Reality object.');
assert.strictEqual(intelligence.timeline, intelligence.projectReality.timelineEvents,
  'Timeline output must be the canonical Reality timeline array.');
assert.strictEqual(intelligence.commitments, intelligence.projectReality.commitments,
  'Commitments output must be the canonical Reality commitment array.');
assert.strictEqual(intelligence.evidenceQuality, intelligence.projectReality.evidenceSummary,
  'Evidence Quality output must be the canonical Reality evidence object.');

const directDaily = buildProjectDailyBrief({
  reality: intelligence.projectReality,
  timeline: intelligence.timeline,
});
const directAction = buildProjectActionCenter({ reality: intelligence.projectReality });
const directCommitments = buildProjectCommitments({ reality: intelligence.projectReality });
const directEvidence = buildProjectEvidenceQuality({ reality: intelligence.projectReality });
assert.strictEqual(JSON.stringify(directDaily), JSON.stringify(intelligence.dailyBrief),
  'Daily Brief projection must be consistent.');
assert.strictEqual(JSON.stringify(directAction), JSON.stringify(intelligence.actionCenter),
  'Action Center projection must be consistent.');
assert.strictEqual(directCommitments, intelligence.commitments);
assert.strictEqual(directEvidence, intelligence.evidenceQuality);

const realityRecommendation = intelligence.projectReality.topRecommendation;
assert(realityRecommendation, 'Safety Reality must produce a recommendation.');
assert.strictEqual(intelligence.dailyBrief.recommendedAction.text, realityRecommendation.action,
  'Daily Brief recommendation must match Reality.');
assert.strictEqual(intelligence.actionCenter.recommendedAction, realityRecommendation.action,
  'Action Center recommendation must match Reality.');
assert.strictEqual(intelligence.actionCenter.realityState, intelligence.projectReality.state);
assert(intelligence.actionCenter.supportingEvidence.length > 0);
assert(intelligence.actionCenter.supportingEvidence.every(item => item.timelineEventId),
  'Action Center citations must resolve to canonical timeline events when recent evidence exists.');

assert.strictEqual(intelligence.dailyBrief.reality.timelineEvents, intelligence.timeline);
assert.strictEqual(
  new Set(intelligence.timeline.map(item => item.id)).size,
  intelligence.timeline.length,
  'Canonical timeline must remain deduplicated.',
);

const intelligenceSource = fs.readFileSync(path.join(root, 'services/DAVEIntelligence.ts'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
assert.strictEqual((intelligenceSource.match(/buildProjectReality\s*\(/g) || []).length, 1,
  'Intelligence must build Project Reality exactly once.');
assert(!intelligenceSource.includes('buildProjectTimeline('),
  'Intelligence must consume the timeline already owned by Project Reality.');
assert(appSource.includes('const projectIntelligence = liveAuthority.projectTruth.intelligence'),
  'Project Workspace must consume the canonical intelligence object from Project Truth.');
// This used to look for three texts in App.tsx, one of them
// "projectDocuments: projectDocuments". Before the oldest commit this
// repository keeps (eaed575) that line became "this project's documents when
// a project scope is in force, otherwise all of them", so the text was gone
// while the app still fed the live authority from its own saved records. The
// check now reads what the code does, field by field (see the function).
const liveAuthorityFeedProblems = liveAuthorityFeedProblemsIn(appSource);
assert.deepStrictEqual(
  liveAuthorityFeedProblems,
  [],
  'The live authority must receive canonical project records, documents, and confirmed memories.',
);
for (const duplicateBuilder of [
  'buildProjectReality({',
  'buildProjectTimeline({',
  'buildProjectDailyBrief({',
  'buildProjectEvidenceQuality({',
  'buildProjectCommitments({',
  'buildProjectActionCenter({',
]) {
  assert(!appSource.includes(duplicateBuilder), `UI must not independently call ${duplicateBuilder}`);
}

console.log('DAVE Intelligence Layer behavioral tests passed.');

/**
 * Reads App.tsx's structure and lists every way the live authority is NOT
 * fed from the app's own saved records. An empty list means:
 *  - the provider is handed the one `liveAuthorityInput`;
 *  - its updates, project documents and confirmed memories are each "the
 *    project scope's copy when a scope is in force, otherwise the app's own
 *    list" (saved field updates, saved project documents, confirmed memories);
 *  - every project scope it can use was itself built from those same lists;
 *  - the input is rebuilt whenever one of those lists changes.
 */
function liveAuthorityFeedProblemsIn(source) {
  const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findNodes = (start, test) => {
    const found = [];
    const visit = node => {
      if (test(node)) found.push(node);
      ts.forEachChild(node, visit);
    };
    visit(start);
    return found;
  };
  // `(x as unknown as T)` and `(x)` say nothing about where x came from.
  const plain = node => {
    let current = node;
    while (
      current &&
      (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current))
    ) {
      current = current.expression;
    }
    return current;
  };
  const isName = (node, name) => Boolean(node) && ts.isIdentifier(node) && node.text === name;
  const propertyNamed = (objectLiteral, name) =>
    objectLiteral.properties.find(property => property.name && property.name.getText(tree) === name);
  // `name` (shorthand) or `name: value`, as the value handed over.
  const propertyValue = property => {
    if (!property) return null;
    if (ts.isShorthandPropertyAssignment(property)) return property.name;
    return ts.isPropertyAssignment(property) ? plain(property.initializer) : null;
  };

  const canonical = [
    ['updates', 'activeSavedUpdates'],
    ['projectDocuments', 'projectDocuments'],
    ['captureMemories', 'captureMemories'],
  ];
  // A project scope is made by a "build...AuthorityScope" function that
  // App.tsx imports from the one scope service.
  const scopeBuilders = [];
  tree.forEachChild(node => {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === './services/ReportAuthorityScope' &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        if (!element.propertyName && /^build\w+AuthorityScope$/.test(element.name.text)) {
          scopeBuilders.push(element.name.text);
        }
      }
    }
  });
  const problems = [];

  const providers = findNodes(tree, node =>
    ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'PIELiveAuthorityProvider');
  if (
    providers.length !== 1 ||
    !providers[0].attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(tree) === 'input' &&
      attribute.initializer &&
      ts.isJsxExpression(attribute.initializer) &&
      isName(attribute.initializer.expression, 'liveAuthorityInput'))
  ) {
    problems.push('The one PIELiveAuthorityProvider must be given input={liveAuthorityInput}.');
  }

  const inputs = findNodes(tree, node =>
    ts.isVariableDeclaration(node) && isName(node.name, 'liveAuthorityInput'));
  const memo = inputs.length === 1 ? inputs[0].initializer : null;
  if (
    !memo ||
    !ts.isCallExpression(memo) ||
    !isName(memo.expression, 'useMemo') ||
    memo.arguments.length !== 2 ||
    !ts.isArrowFunction(memo.arguments[0]) ||
    !ts.isBlock(memo.arguments[0].body) ||
    !ts.isArrayLiteralExpression(memo.arguments[1])
  ) {
    return [...problems, 'App.tsx must build liveAuthorityInput once, in one useMemo.'];
  }
  const body = memo.arguments[0].body;
  const dependencies = memo.arguments[1].elements.map(element => element.getText(tree));
  const returns = body.statements.filter(ts.isReturnStatement);
  const returned = returns.length === 1 ? plain(returns[0].expression) : null;
  if (!returned || !ts.isObjectLiteralExpression(returned)) {
    return [...problems, 'liveAuthorityInput must return one object.'];
  }

  for (const [field, list] of canonical) {
    const value = propertyValue(propertyNamed(returned, field));
    const scopedOrOwn =
      value &&
      ts.isConditionalExpression(value) &&
      isName(plain(value.condition), 'reportEvidenceScope') &&
      ts.isPropertyAccessExpression(plain(value.whenTrue)) &&
      isName(plain(value.whenTrue).expression, 'reportEvidenceScope') &&
      plain(value.whenTrue).name.text === field &&
      isName(plain(value.whenFalse), list);
    if (!scopedOrOwn && !isName(value, list)) {
      problems.push(`liveAuthorityInput.${field} must be the project scope's ${field} or the app's own ${list}.`);
    }
    if (!dependencies.includes(list)) {
      problems.push(`liveAuthorityInput must be rebuilt when ${list} changes.`);
    }
  }

  // Where the project scope comes from: `a || b || builder({...})`, each of
  // a and b being `condition ? builder({...}) : null`.
  const constantsInBody = new Map();
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) constantsInBody.set(declaration.name.text, declaration.initializer);
    }
  }
  const alternatives = node => {
    const current = plain(node);
    return current && ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.BarBarToken
      ? [...alternatives(current.left), ...alternatives(current.right)]
      : [current];
  };
  const builderCalls = [];
  for (const alternative of constantsInBody.has('reportEvidenceScope')
    ? alternatives(constantsInBody.get('reportEvidenceScope'))
    : []) {
    let made = alternative && ts.isIdentifier(alternative)
      ? plain(constantsInBody.get(alternative.text))
      : alternative;
    if (made && ts.isConditionalExpression(made) && plain(made.whenFalse).kind === ts.SyntaxKind.NullKeyword) {
      made = plain(made.whenTrue);
    }
    if (
      made &&
      ts.isCallExpression(made) &&
      ts.isIdentifier(made.expression) &&
      scopeBuilders.includes(made.expression.text) &&
      made.arguments.length === 1 &&
      ts.isObjectLiteralExpression(made.arguments[0])
    ) {
      builderCalls.push(made);
    } else {
      problems.push('The project scope must come only from the scope service\'s builders.');
    }
  }
  if (builderCalls.length === 0) {
    problems.push('liveAuthorityInput must take its project scope from the scope service.');
  }
  for (const call of builderCalls) {
    for (const [field, list] of canonical) {
      if (!isName(propertyValue(propertyNamed(call.arguments[0], field)), list)) {
        problems.push(`${call.expression.text} must be given ${field} from the app's own ${list}.`);
      }
    }
  }
  return problems;
}
