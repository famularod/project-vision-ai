#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
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
  ['services/PIEScheduleCommunicationImport.ts', 'completionWasReported', /classifyDAVE/],
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
  assert(
    parserCall.test(body),
    `${relativePath}:${functionName} must keep status authority behind DAVEAssertionParser.`,
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
