const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const appPath = path.join(__dirname, '..', 'App.tsx');
const source = fs.readFileSync(appPath, 'utf8');
const lineCount = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
const maximumLines = 21066;
const failures = [];

const sourceFile = ts.createSourceFile(
  appPath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const topLevelFunctionNames = sourceFile.statements
  .filter(ts.isFunctionDeclaration)
  .map(statement => statement.name?.text)
  .filter(Boolean);
const identifierCounts = new Map();

function countIdentifiers(node) {
  if (ts.isIdentifier(node)) {
    identifierCounts.set(node.text, (identifierCounts.get(node.text) || 0) + 1);
  }
  ts.forEachChild(node, countIdentifiers);
}

countIdentifiers(sourceFile);

const unreachableTopLevelFunctions = topLevelFunctionNames.filter(
  name => name !== 'App' && identifierCounts.get(name) === 1,
);

if (unreachableTopLevelFunctions.length > 0) {
  failures.push(
    `App.tsx contains unreachable top-level functions: ${unreachableTopLevelFunctions.join(', ')}.`,
  );
}

if (lineCount > maximumLines) {
  failures.push(
    `App.tsx grew to ${lineCount} lines; the current architecture budget is ${maximumLines}.`,
  );
}

if (/useState\s*<\s*(?:AppScreen|Screen)\s*>/.test(source)) {
  failures.push('App.tsx owns screen navigation with useState instead of useAppNavigation.');
}

if (!source.includes("useAppNavigation('Home')")) {
  failures.push('App.tsx does not use the typed application navigation controller.');
}

if (
  !source.includes('useAndroidHardwareBack({') ||
  !source.includes("screen === 'AddPhotos'") ||
  !source.includes("screen === 'BuildUpdate'")
) {
  failures.push('App.tsx does not guard capture flows while wiring Android hardware Back.');
}

if (
  !source.includes("setScreen('UpdateDetail', { backTarget: returnScreen })") ||
  !source.includes("setScreen('UpdateDetail', { backTarget: screen })")
) {
  failures.push('Context-specific update details do not share their visible and hardware Back destination.');
}

if (failures.length > 0) {
  failures.forEach(failure => console.error(`FAIL ${failure}`));
  process.exit(1);
}

console.log(
  `PASS App shell architecture: ${lineCount}/${maximumLines} lines; navigation state is externalized; no unreachable top-level functions detected.`,
);
