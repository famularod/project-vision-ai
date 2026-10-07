#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const PARSER_MODULE = 'services/DAVEAssertionParser.ts';
const parserSource = fs.readFileSync(path.join(root, PARSER_MODULE), 'utf8');
const parserExports = exportedFunctionNames(parserSource, path.join(root, PARSER_MODULE));
const authorityTerms =
  /\b(?:complete|completed|incomplete|unfinished|not started|approved|accepted|rejected|blocked|blocker|safety|hazard|unsafe)\b/i;
const completionAuthorityTerms =
  /\b(?:complete|completed|incomplete|unfinished|not started|done|finished)\b/i;
const migratedAuthorityFunctions = [
  ['services/PIERealityModel.ts', 'inferStatus', /parseDAVEAssertions|classifyDAVE/],
  ['services/PIEEvidenceQuality.ts', 'detectEvidenceConflicts', /parseDAVEAssertions|classifyDAVE/],
  ['services/PIEReporter.ts', 'resolveWorkAreaStatus', /classifyDAVE/],
  ['services/PIEReporter.ts', 'isRiskText', /classifyDAVE/],
  ['services/PIECoreIntelligence.ts', 'issueStatusIsResolved', /classifyDAVE/],
  [
    'services/PIEBeliefEngine.ts',
    'inferBeliefType',
    /parseDAVEAssertions/,
    completionAuthorityTerms,
  ],
  ['services/ECOSCognitiveFramework.ts', 'findConflicts', /parseDAVEAssertions/],
  ['services/PIEScheduleCommunicationImport.ts', 'communicationStatus', /classifyDAVE/],
  // The oldest commit this repository keeps (eaed575) already has this function
  // asking the parser's hasDAVEExplicitCompletionReport, a parser export made
  // for exactly this question: unlike classifyDAVECompletion it accepts a
  // past-tense report ("was completed"), which is evidence for the PM to
  // verify, not a claim about the task's status today. The row used to ask
  // for the text "classifyDAVE", which that parser function does not carry.
  [
    'services/PIEScheduleCommunicationImport.ts',
    'completionWasReported',
    /^hasDAVEExplicitCompletionReport$/,
  ],
  ['services/PIEEvidenceFusion.ts', 'extractUserUpdateEvidence', /classifyDAVE|parseDAVEAssertions/],
  ['App.tsx', 'isSafeObservedBriefFinding', /parseDAVEAssertions/],
];

for (const [
  relativePath,
  functionName,
  parserCall,
  targetAuthorityTerms = authorityTerms,
] of migratedAuthorityFunctions) {
  const absolutePath = path.join(root, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const body = functionBody(source, absolutePath, functionName);
  const directRegexCalls = body.match(/\/(?:\\.|[^/\n])+\/[dgimsuvy]*\s*\.\s*(?:test|exec)\s*\([^)]*\)/g) || [];
  const directStringCalls = body.match(/\.\s*(?:includes|startsWith|endsWith)\s*\(\s*(['"`])[^\n]*?\1\s*\)/g) || [];
  const violations = [...directRegexCalls, ...directStringCalls]
    .filter(candidate => targetAuthorityTerms.test(candidate.replace(/\\s\+|\\b/g, ' ')));

  assert.strictEqual(
    violations.length,
    0,
    `${relativePath}:${functionName} reintroduced direct authority substring inference: ${violations.join(' | ')}`,
  );
  // The function must CALL a function this file imports from the parser and
  // the parser really exports. A name in a comment, a string, or a local
  // function that happens to be called "classifyDAVE..." does not count.
  const parserCalls = calledNames(body, absolutePath)
    .filter(name => importedFromParser(source, absolutePath).has(name))
    .filter(name => parserExports.has(name));
  assert(
    parserCalls.some(name => parserCall.test(name)),
    `${relativePath}:${functionName} must keep status authority behind DAVEAssertionParser.`,
  );
}

// The completion-report question is answered one step inside the parser, so
// that step is held to the same rule as the callers above: it reads the
// parser's own typed assertions and matches no status word directly.
{
  const body = functionBody(
    parserSource,
    path.join(root, PARSER_MODULE),
    'hasDAVEExplicitCompletionReport',
  );
  const directRegexCalls = body.match(/\/(?:\\.|[^/\n])+\/[dgimsuvy]*\s*\.\s*(?:test|exec)\s*\([^)]*\)/g) || [];
  const directStringCalls = body.match(/\.\s*(?:includes|startsWith|endsWith)\s*\(\s*(['"`])[^\n]*?\1\s*\)/g) || [];
  const violations = [...directRegexCalls, ...directStringCalls]
    .filter(candidate => completionAuthorityTerms.test(candidate.replace(/\\s\+|\\b/g, ' ')));
  assert.strictEqual(
    violations.length,
    0,
    `${PARSER_MODULE}:hasDAVEExplicitCompletionReport reintroduced direct authority substring inference: ${violations.join(' | ')}`,
  );
  const used = usedNames(body, path.join(root, PARSER_MODULE));
  assert(
    calledNames(body, path.join(root, PARSER_MODULE)).includes('parsedInput') &&
      used.includes('isAffirmedCompletionAssertion') &&
      used.includes('isNegativeCompletionAssertion'),
    `${PARSER_MODULE}:hasDAVEExplicitCompletionReport must decide from the parser's typed assertions.`,
  );
  assert(
    calledNames(
      functionBody(parserSource, path.join(root, PARSER_MODULE), 'parsedInput'),
      path.join(root, PARSER_MODULE),
    ).includes('parseDAVEAssertions'),
    `${PARSER_MODULE}:parsedInput must parse plain text with parseDAVEAssertions.`,
  );
}

console.log('PASS typed assertion authority static contract');

function functionBody(source, filename, functionName) {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let body = null;

  sourceFile.forEachChild(node => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === functionName &&
      node.body
    ) {
      body = node.body.getText(sourceFile);
    }
  });

  assert(body, `${filename} must contain function ${functionName}.`);
  return body;
}

function scriptKindFor(filename) {
  return filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Names of the functions a body calls directly, as `name(...)`. */
function calledNames(body, filename) {
  const sourceFile = ts.createSourceFile(
    filename,
    `function __body__() ${body}`,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  );
  const names = [];
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      names.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** Every plain name a body uses, called or handed on (`.some(name)`). */
function usedNames(body, filename) {
  const sourceFile = ts.createSourceFile(
    filename,
    `function __body__() ${body}`,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  );
  const names = [];
  const visit = node => {
    if (ts.isIdentifier(node)) names.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** Names a file imports (unrenamed) from the assertion parser module. */
function importedFromParser(source, filename) {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  );
  const names = new Set();
  sourceFile.forEachChild(node => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /(?:^|\/)DAVEAssertionParser$/.test(node.moduleSpecifier.text) &&
      !node.importClause?.isTypeOnly &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        if (!element.isTypeOnly && !element.propertyName) names.add(element.name.text);
      }
    }
  });
  return names;
}

/** Names of the functions a module exports as `export function name`. */
function exportedFunctionNames(source, filename) {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  );
  const names = new Set();
  sourceFile.forEachChild(node => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.body &&
      (ts.getModifiers(node) || []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      names.add(node.name.text);
    }
  });
  return names;
}
